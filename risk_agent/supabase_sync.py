# -*- coding: utf-8 -*-
"""
Supabase 연결 — 위험 탐지 에이전트 ↔ 소셜 월드 순환의 DB 쪽 입출력

에이전트가 하는 일
  1) aggregate_npc_sessions() 호출 → 개인 대화 세션이 코호트×월 집계로 바뀜(DB 안에서, user_id 없이)
  2) npc_chat_metrics(psych) 읽기 → ① 미시 신호 입력
  3) ⑩ 환류 결과를 cohort_feedback에 upsert → 소셜 월드가 본인 코호트 행만 읽어 개인화
  4) aggregate_npc_demand() 호출 → 하루·코코 수요(npc_demand_metrics) 최근 4주 요약 → 대시보드 (위험 점수에는 안 씀)

필요한 설정: risk_agent/.env
  SUPABASE_URL=https://xxxx.supabase.co
  SUPABASE_SECRET_KEY=sb_secret_...      ← 대시보드 Project Settings → API Keys → Secret keys
  secret key는 RLS를 우회하는 관리자 키다. 브라우저 코드·깃·메신저에 절대 넣지 말 것.

단독 실행
  python supabase_sync.py check    연결·테이블 확인
  python supabase_sync.py seed     시연용 합성 배경 세션 적재(source='synthetic', 기존 합성분은 교체)
  python supabase_sync.py seed-demand  시연용 하루 수요 합성 배경(최근 4주, source='synthetic', 기존 합성분은 교체)
  python supabase_sync.py status   코호트별 최근 세션 수(합성/실제 구분)
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date

import numpy as np
import pandas as pd

import config as C

HERE = os.path.dirname(os.path.abspath(__file__))


# ------------------------------------------------------------------
# 설정·HTTP
# ------------------------------------------------------------------
def load_env(path=None):
    path = path or os.path.join(HERE, ".env")
    env = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    url = os.environ.get("SUPABASE_URL") or env.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY") or env.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        raise SystemExit(
            "Supabase 설정이 없습니다. risk_agent 폴더에 .env 파일을 만들고 아래 두 줄을 넣으세요.\n"
            "  SUPABASE_URL=https://<프로젝트>.supabase.co\n"
            "  SUPABASE_SECRET_KEY=<Project Settings → API Keys → Secret keys 의 값>\n"
            "(.env.example 참고)")
    if key.startswith("sb_publishable_"):
        raise SystemExit("SUPABASE_SECRET_KEY에 publishable 키가 들어 있습니다. 에이전트는 secret 키(sb_secret_...)가 필요합니다.")
    return url.rstrip("/"), key


class SupabaseRest:
    """PostgREST 최소 클라이언트 — 표준 라이브러리만 사용(추가 설치 없음)."""

    def __init__(self, url, key):
        self.base = url + "/rest/v1"
        self.headers = {"apikey": key, "Content-Type": "application/json"}
        if key.startswith("eyJ"):  # 구형 service_role JWT 키
            self.headers["Authorization"] = "Bearer " + key

    def _call(self, method, path, body=None, extra_headers=None):
        data = None if body is None else json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={**self.headers, **(extra_headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            hint = ""
            if e.code in (401, 403):
                hint = "\n→ 키가 틀렸거나 publishable 키를 넣었을 수 있습니다. secret 키인지 확인하세요."
            elif "PGRST204" in detail or "column" in detail:
                # 테이블은 있는데 컬럼이 없다 = DB 스키마가 코드보다 오래됨
                hint = ("\n→ 테이블은 있지만 컬럼이 없습니다. DB에 적용된 스키마가 지금 코드보다 오래된 버전입니다."
                        "\n  database/02_loop_schema.sql(최신)을 SQL Editor에서 다시 실행하세요. 여러 번 실행해도 안전합니다."
                        "\n  그래도 같은 오류면 SQL Editor에서  notify pgrst, 'reload schema';  를 한 번 실행하세요.")
            elif e.code == 404 or "Could not find" in detail:
                hint = "\n→ 테이블·함수가 없습니다. database/02_loop_schema.sql을 Supabase SQL Editor에서 먼저 실행하세요 (database/README.md 참고)."
            raise SystemExit(f"Supabase {method} {path} 실패 ({e.code}): {detail}{hint}")
        except urllib.error.URLError as e:
            raise SystemExit(f"Supabase에 연결할 수 없습니다: {e.reason} — 인터넷 연결과 SUPABASE_URL을 확인하세요.")

    def rpc(self, fn, args=None):
        return self._call("POST", f"/rpc/{fn}", args or {})

    def select(self, table, query):
        return self._call("GET", f"/{table}?{query}")

    def delete(self, table, query):
        return self._call("DELETE", f"/{table}?{query}", extra_headers={"Prefer": "return=minimal"})

    def insert(self, table, rows):
        return self._call("POST", f"/{table}", rows, extra_headers={"Prefer": "return=minimal"})

    def update(self, table, query, values):
        """조건에 맞는 행을 고치고 고친 행을 돌려준다(없으면 빈 목록)."""
        return self._call("PATCH", f"/{table}?{query}", values,
                          extra_headers={"Prefer": "return=representation"})

    def upsert(self, table, rows, on_conflict):
        return self._call("POST", f"/{table}?on_conflict={on_conflict}", rows,
                          extra_headers={"Prefer": "resolution=merge-duplicates,return=minimal"})


def client():
    return SupabaseRest(*load_env())


# ------------------------------------------------------------------
# 미시 신호 입출력
# ------------------------------------------------------------------
def _cohort_key(cohort_id):
    sgg, gender, age = cohort_id.split("-", 2)
    return sgg, gender, age


def recent_months(n=6, today=None):
    today = today or date.today()
    y, m = today.year, today.month
    out = []
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return sorted(out)


# 합성 배경의 키워드 구성비 — 평상시 대화에서 가볍게 나오는 수준. 소셜 월드 대본의 태그 이름과 같다.
BACKGROUND_TAG_MIX = {
    "무기력": 0.34, "소외감": 0.14, "대화상대없음": 0.12, "사회적회피": 0.10,
    "고립지속": 0.08, "장기구직": 0.12, "생계부담": 0.10,
}


def build_synthetic_background(persona_table, months):
    """시연용 배경 — 모든 코호트를 '평상시' 수준으로 채운다(원형 없음).
    시연자의 실제 대화가 이 위에 더해져 자기 코호트의 신호만 움직이게 하려는 목적이다.
    생성 규칙은 가상데이터_생성방식_설명자료.md 8절."""
    rows = []
    for p in persona_table:
        if p["age_group"] not in C.MICRO_ELIGIBLE_AGE_GROUPS:
            continue
        sgg, gender, age = p["sgg_code"], p["gender"], p["age_group"]
        rng = np.random.default_rng(C.stable_seed("bg", p["cohort_id"]))
        for ym in months:
            sessions = int(max(C.K_ANONYMITY_MIN + 1, round(rng.normal(10, 2))))
            severity = float(np.clip(rng.normal(0.28, 0.04), 0, 1))
            keywords = int(max(0, round(rng.normal(0.9 * sessions, 1.0))))
            names = list(BACKGROUND_TAG_MIX)
            drawn = rng.choice(names, size=keywords, p=list(BACKGROUND_TAG_MIX.values())) if keywords else []
            tags = {}
            for t in drawn:
                tags[str(t)] = tags.get(str(t), 0) + 1
            rows.append({
                "measured_on": f"{ym}-01", "sgg_code": sgg, "age_group": age, "gender": gender,
                "npc_type": "psych", "session_count": sessions, "user_count": sessions,
                "risk_keyword_count": keywords, "keyword_tags": tags,
                "severity_score": round(severity, 2), "source": "synthetic",
            })
    return rows


def seed_synthetic(sb, persona_table, months=None):
    months = months or recent_months(6)
    rows = build_synthetic_background(persona_table, months)
    sb.delete("npc_chat_metrics", "source=eq.synthetic")
    sb.insert("npc_chat_metrics", rows)
    return rows


def combine_metrics(rows, persona_table):
    """합성 배경 + 실제 집계를 코호트×월로 합친다. 심각도는 세션 수 가중평균."""
    if not rows:
        return pd.DataFrame(columns=["cohort_id", "measured_month", "session_count",
                                     "risk_keyword_count", "severity_score", "live_sessions",
                                     "user_count", "live_users", "keyword_tags"])
    df = pd.DataFrame(rows)
    df["cohort_id"] = df["sgg_code"] + "-" + df["gender"] + "-" + df["age_group"]
    df = df[df["cohort_id"].isin({p["cohort_id"] for p in persona_table})].copy()
    df["measured_month"] = df["measured_on"].astype(str).str[:7]
    df["severity_score"] = df["severity_score"].astype(float).fillna(0)
    df["sev_x_n"] = df["severity_score"] * df["session_count"]
    df["live_n"] = np.where(df["source"] == "live", df["session_count"], 0)
    if "user_count" not in df:
        df["user_count"] = df["session_count"]
    df["user_count"] = df["user_count"].fillna(0).astype(int)
    # 컬럼 추가 전에 적재된 합성 배경은 user_count=0 → 합성은 1세션=1명으로 간주
    syn0 = (df["source"] == "synthetic") & (df["user_count"] == 0)
    df.loc[syn0, "user_count"] = df.loc[syn0, "session_count"]
    df["live_u"] = np.where(df["source"] == "live", df["user_count"], 0)
    if "keyword_tags" not in df:
        df["keyword_tags"] = [{} for _ in range(len(df))]
    g = df.groupby(["cohort_id", "measured_month"], as_index=False).agg(
        session_count=("session_count", "sum"), risk_keyword_count=("risk_keyword_count", "sum"),
        sev_x_n=("sev_x_n", "sum"), live_sessions=("live_n", "sum"),
        user_count=("user_count", "sum"), live_users=("live_u", "sum"),
        keyword_tags=("keyword_tags", _merge_tags))
    g["severity_score"] = (g["sev_x_n"] / g["session_count"].replace(0, np.nan)).fillna(0).round(3)
    g["npc_type"] = "psych"
    return g.drop(columns="sev_x_n")


def _merge_tags(series):
    out = {}
    for d in series:
        if isinstance(d, str):
            d = json.loads(d or "{}")
        for k, v in (d or {}).items():
            out[k] = out.get(k, 0) + int(v)
    return out


def fetch_psych_metrics(sb, persona_table, aggregate_first=True):
    n = sb.rpc("aggregate_npc_sessions") if aggregate_first else None
    rows = sb.select("npc_chat_metrics",
                     "select=measured_on,sgg_code,age_group,gender,npc_type,session_count,user_count,"
                     "risk_keyword_count,keyword_tags,severity_score,source&npc_type=eq.psych")
    return combine_metrics(rows or [], persona_table), n


def micro_detail(psych_df):
    """대시보드용 — 코호트별 이번 달 대화 현황. 키워드 분포는 대화한 사람이 K명 이상일 때만 공개(k-익명성)."""
    if psych_df is None or psych_df.empty:
        return {}
    cur = sorted(psych_df["measured_month"].astype(str).unique())[-1]
    out = {}
    for _, r in psych_df[psych_df["measured_month"].astype(str) == cur].iterrows():
        users = int(r.get("user_count", r["session_count"]) or 0)
        visible = users >= C.K_ANONYMITY_MIN
        tags = r.get("keyword_tags") or {}
        out[r["cohort_id"]] = {
            "month": cur, "sessions": int(r["session_count"]), "live_sessions": int(r.get("live_sessions", 0)),
            "users": users, "live_users": int(r.get("live_users", 0)),
            "severity": float(r["severity_score"]),
            "tags": dict(sorted(tags.items(), key=lambda kv: -kv[1])) if visible else None,
            "k_hidden": not visible,
        }
    return out


def fetch_escalations(sb, days=30):
    """위기 발화 기록 — 지역·NPC·시각만 있다(user_id는 애초에 저장하지 않음)."""
    since = (pd.Timestamp.now(tz="UTC") - pd.Timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = sb.select("escalations",
                     f"select=sgg_code,npc_type,severity,created_at,handled_at&created_at=gte.{since}&order=created_at.desc")
    return rows or []


def has_column(sb, table, column):
    """칸이 있는지 확인(03·05 같은 마이그레이션 적용 전이면 False). 실패해도 멈추지 않는다."""
    try:
        sb.select(table, f"select={column}&limit=1")
        return True
    except SystemExit:
        return False


def push_feedback(sb, persona_table, feedback_payload):
    """⑩ 환류 — 모든 코호트 행을 덮어쓴다. 개인화 대상이 아니게 된 코호트는 비워서 원래 화면으로 돌린다.
    event_theme(마을이장용 이벤트 주제)은 03_world_update.sql 적용 뒤에만 쓴다."""
    with_theme = has_column(sb, "cohort_feedback", "event_theme")
    if not with_theme:
        print("[안내] cohort_feedback.event_theme 칸이 없어 이벤트 주제는 건너뜁니다 — database/03_world_update.sql 적용 후 다시 실행")
    rows = []
    for p in persona_table:
        fb = feedback_payload.get(p["cohort_id"])
        rows.append({
            "sgg_code": p["sgg_code"], "age_group": p["age_group"], "gender": p["gender"],
            "npc_emphasis": fb["npc_emphasis"] if fb else None,
            "priority_missions": fb["priority_missions"] if fb else [],
            "model_version": C.MODEL_VERSION,
            "updated_at": pd.Timestamp.now(tz="Asia/Seoul").isoformat(),
        })
        if with_theme:
            rows[-1]["event_theme"] = fb.get("event_theme") if fb else None
    sb.upsert("cohort_feedback", rows, "sgg_code,age_group,gender")
    return rows


# ------------------------------------------------------------------
# 하루·코코 수요 (03 npc_demand_metrics) — 대시보드 "소셜 월드에서 찾은 지원"
#   위험 신호가 아니라 수요 신호다. 위험 점수에는 쓰지 않고, 대시보드에 보여 주기만 한다.
#   자격 미달(ineligible) = 나이·지역 조건이 안 맞아 빠진 정책 수 → 제도 사각지대 근거
# ------------------------------------------------------------------
HARU_CATEGORIES = ["주거비", "생활비", "마음건강", "사람 만나기", "일·취업"]
DEMAND_FIELDS = ["views", "recommends", "apply_clicks", "self_reported", "ineligible"]
# 합성 배경(시연용) — 코호트·주마다 메뉴를 연 사람 수 평균과 행동 비율. 생성 규칙은 가상데이터_생성방식_설명자료.md
DEMAND_BACKGROUND = {
    "주거비":     {"users": 3.0, "view": 0.45, "apply": 0.16, "done": 0.35, "inel": 1.2},
    "생활비":     {"users": 2.6, "view": 0.40, "apply": 0.14, "done": 0.30, "inel": 0.6},
    "마음건강":   {"users": 1.6, "view": 0.35, "apply": 0.10, "done": 0.30, "inel": 0.3},
    "사람 만나기": {"users": 1.2, "view": 0.30, "apply": 0.08, "done": 0.25, "inel": 0.2},
    "일·취업":    {"users": 2.4, "view": 0.45, "apply": 0.18, "done": 0.30, "inel": 1.0},
}


def recent_weeks(n=4, today=None):
    """최근 n주의 월요일(오래된 것부터) — DB date_trunc('week')와 같은 기준"""
    today = today or date.today()
    monday = pd.Timestamp(today) - pd.Timedelta(days=pd.Timestamp(today).weekday())
    return [(monday - pd.Timedelta(weeks=i)).date().isoformat() for i in range(n - 1, -1, -1)]


def build_demand_background(persona_table, weeks):
    rows = []
    for p in persona_table:
        if p["age_group"] not in C.MICRO_ELIGIBLE_AGE_GROUPS:
            continue
        rng = np.random.default_rng(C.stable_seed("demand", p["cohort_id"]))
        for wk in weeks:
            for cat, b in DEMAND_BACKGROUND.items():
                users = int(rng.poisson(b["users"]))
                if users == 0:
                    continue
                rec = int(users * 3 + rng.integers(0, users + 1))        # 메뉴 한 번 열면 카드 3장(+더 보기)
                apply_ = int(rng.binomial(rec, b["apply"]))
                rows.append({
                    "week_start": wk, "sgg_code": p["sgg_code"], "age_group": p["age_group"], "gender": p["gender"],
                    "npc_type": "job" if cat == "일·취업" else "policy", "category": cat, "source": "synthetic",
                    "user_count": users, "recommends": rec, "views": int(rng.binomial(rec, b["view"])),
                    "apply_clicks": apply_, "self_reported": int(rng.binomial(apply_, b["done"])),
                    "ineligible": int(rng.poisson(b["inel"] * users)),
                })
    return rows


def seed_demand(sb, persona_table, weeks=None):
    rows = build_demand_background(persona_table, weeks or recent_weeks(4))
    sb.delete("npc_demand_metrics", "source=eq.synthetic")
    for i in range(0, len(rows), 500):
        sb.insert("npc_demand_metrics", rows[i:i + 500])
    return rows


def demand_summary(rows, persona_table, k=None):
    """대시보드용 — 하루 메뉴별 전체 합계 + 코호트별(사람 수 k명 미만이면 가림) + 코코 합계"""
    k = C.K_ANONYMITY_MIN if k is None else k
    known = {p["cohort_id"] for p in persona_table}
    empty = lambda: {f: 0 for f in DEMAND_FIELDS} | {"live_recommends": 0}
    overall = {c: empty() for c in HARU_CATEGORIES}
    coco = empty()
    by = {}                    # cohort -> cat -> sums, weekly users
    for r in rows or []:
        cid = f"{r['sgg_code']}-{r['gender']}-{r['age_group']}"
        live = r.get("source") == "live"
        if r.get("npc_type") == "coco":
            tgt = coco
        elif r.get("category") in overall:
            tgt = overall[r["category"]]
            if cid in known:
                d = by.setdefault(cid, {}).setdefault(r["category"], empty() | {"weeks": {}})
                for f in DEMAND_FIELDS:
                    d[f] += int(r.get(f) or 0)
                d["live_recommends"] += int(r.get("recommends") or 0) if live else 0
                d["weeks"][r["week_start"]] = d["weeks"].get(r["week_start"], 0) + int(r.get("user_count") or 0)
        else:
            continue
        for f in DEMAND_FIELDS:
            tgt[f] += int(r.get(f) or 0)
        tgt["live_recommends"] += int(r.get("recommends") or 0) if live else 0
    by_cohort = {}
    for cid, cats in by.items():
        users = max((max(d["weeks"].values()) for d in cats.values()), default=0)   # 한 주에 메뉴를 연 최대 인원
        hidden = users < k
        by_cohort[cid] = {"users": users, "k_hidden": hidden,
                          "cats": None if hidden else [{"category": c, **{f: cats[c][f] for f in DEMAND_FIELDS}}
                                                       for c in HARU_CATEGORIES if c in cats]}
    return {"haru": [{"category": c, **overall[c]} for c in HARU_CATEGORIES],
            "coco": coco, "by_cohort": by_cohort,
            "live_total": sum(o["live_recommends"] for o in overall.values()) + coco["live_recommends"]}


def fetch_demand(sb, persona_table, weeks=4, aggregate_first=True):
    """하루·코코 수요 로그 → 이장의 장부(npc_demand_metrics) 갱신 → 최근 n주 요약"""
    n = sb.rpc("aggregate_npc_demand") if aggregate_first else None
    wk = recent_weeks(weeks)
    rows = sb.select("npc_demand_metrics",
                     "select=week_start,sgg_code,age_group,gender,npc_type,category,source,user_count,"
                     + ",".join(DEMAND_FIELDS) + f"&week_start=gte.{wk[0]}")
    out = demand_summary(rows, persona_table)
    out.update({"since": wk[0], "weeks": weeks})
    return out, n


# ------------------------------------------------------------------
# CLI
# ------------------------------------------------------------------
def _youth_personas():
    from run_pipeline import find_youth_csv
    from real_youth import load_youth_master
    persona_table, _, _ = load_youth_master(find_youth_csv())
    return persona_table


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    sb = client()
    if cmd == "check":
        for t in ["npc_sessions", "npc_chat_metrics", "cohort_feedback", "escalations"]:
            sb.select(t, "select=*&limit=1")
            print(f"  ✓ {t}")
        print("연결 확인 완료.")
    elif cmd == "seed":
        rows = seed_synthetic(sb, _youth_personas())
        months = sorted({r["measured_on"][:7] for r in rows})
        print(f"합성 배경 {len(rows)}행 적재 (코호트 {len(rows)//len(months)}개 × {months[0]}~{months[-1]})")
    elif cmd == "seed-demand":
        rows = seed_demand(sb, _youth_personas())
        print(f"하루 수요 합성 배경 {len(rows)}행 적재 (청년 코호트 × 최근 4주 × 메뉴, source='synthetic')")
    elif cmd == "status":
        personas = _youth_personas()
        df, n = fetch_psych_metrics(sb, personas)
        print(f"실제 대화 집계 {n}행 갱신")
        last = sorted(df["measured_month"].unique())[-1:] if len(df) else []
        print(df[df["measured_month"].isin(last)].to_string(index=False))
    else:
        raise SystemExit("사용법: python supabase_sync.py [check|seed|seed-demand|status]")


if __name__ == "__main__":
    main()
