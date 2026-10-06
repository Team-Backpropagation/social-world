# -*- coding: utf-8 -*-
"""
마을이장 v1 — 이벤트 결정 엔진 (소셜월드_게임흐름_NPC_설계.md 3-1·3-2·7절)

이장은 "새 이벤트를 만들어 모두에게 연다". 결정은 규칙이 하고(설명 가능성), v1은 대사도 템플릿이다(LLM은 v2).

입력 (전부 코호트 단위 집계 — 개인 행은 읽지 않는다)
  - cohort_feedback.event_theme     위험 탐지 ⑩ 환류가 준 이벤트 "주제"(등급·점수는 받지 않는다)
  - chief_interest_counts()         코호트별 관심사 분포(k명 미만 코호트는 DB가 아예 돌려주지 않음)
  - world_activity_metrics          최근 몇 주의 퀘스트 단계별 완료 수 → 이벤트 부담 수준
  - world_events (초안·공개 중)      이미 열린 이벤트와 겹치지 않게, 동시 진행 최대 CHIEF_MAX_ACTIVE개

출력: world_events
  - 시민에게 보이는 것: 제목·설명·장소·시각 (중립 문구, 금칙어 검사 통과분만)
  - 관리자 전용: target_*(먼저 보여줄 코호트), reason_note(근거), theme, template_key
  - status='draft' → 담당자가 approve 하면 'published' (config.CHIEF_AUTO_PUBLISH=True면 바로 공개)

실행
  python chief.py plan                 이벤트 초안 만들기(Supabase)
  python chief.py plan --dry-run       계산만 하고 쓰지 않기
  python chief.py plan --offline [outputs_youth/npc_feedback.json]   Supabase 없이 환류 파일로 미리보기
  python chief.py list                 진행 중·초안 이벤트 보기(관리자용 근거 포함)
  python chief.py approve <id> [...]   초안 → 공개
  python chief.py reject  <id> [...]   초안 → 반려
  python chief.py close   <id> [...]   공개 → 종료
  python chief.py seed-world           시연용 월드 활동 합성 배경(world_activity_metrics, source='synthetic')
"""
import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np

import config as C

HERE = os.path.dirname(os.path.abspath(__file__))
KST = timezone(timedelta(hours=9))

# ------------------------------------------------------------------
# 이벤트 주제 — pipeline.EVENT_THEME_FROM_FACTOR가 주는 코드
# ------------------------------------------------------------------
THEMES = {
    "outdoor_walk":  {"label": "부담 없는 야외 활동",   "why": "명절 등 이벤트 시기에도 생활 변화가 적음"},
    "free_activity": {"label": "돈 안 드는 활동",       "why": "최근 카드 결제 활동이 평소보다 낮게 유지됨"},
    "info_support":  {"label": "생활 정보·지원 안내",   "why": "통신 활동량이 6개월 추세로 낮아짐"},
    "small_talk":    {"label": "가벼운 대화 모임",      "why": "소셜 월드 대화에서 지친 기색이 많음"},
}

# 튜토리얼 6번 문항의 관심사(소셜월드_게임흐름_NPC_설계.md 13-1)
INTERESTS = ["운동", "게임", "음악", "독서", "요리", "취업", "공부", "휴식"]

# ------------------------------------------------------------------
# 이벤트 템플릿 — 시민에게 보이는 문구는 여기서만 나온다(설계 문서 7절 문구 원칙)
#   burden: 참여 부담 1(혼자 와도 되고 말 안 해도 됨) ~ 3(같이 무언가를 만들어야 함)
#   weekday: 0=월 … 6=일 (KST)
# ------------------------------------------------------------------
TEMPLATES = [
    {"key": "park_walk", "place": "park", "burden": 1, "weekday": 4, "hour": 19, "minute": 30, "hours": 1,
     "themes": ["outdoor_walk"], "interests": ["운동", "휴식"],
     "title": "🌙 금요일 저녁 공원 산책",
     "description": "금요일 저녁, 공원 한 바퀴를 같이 걸어요. 말 안 해도 괜찮아요. 걷다가 먼저 가도 돼요."},
    {"key": "slow_run", "place": "park", "burden": 2, "weekday": 5, "hour": 9, "minute": 0, "hours": 1,
     "themes": ["outdoor_walk"], "interests": ["운동"],
     "title": "🏃 토요일 아침 천천히 달리기",
     "description": "토요일 아침, 공원에서 천천히 달려요. 걷기와 달리기를 섞어도 되고, 기록은 재지 않아요."},
    {"key": "board_game", "place": "game_room", "burden": 2, "weekday": 2, "hour": 20, "minute": 0, "hours": 2,
     "themes": ["free_activity", "small_talk"], "interests": ["게임"],
     "title": "🎲 게임방 협동 보드게임 밤",
     "description": "수요일 밤, 게임방에서 다 같이 협동 게임을 해요. 규칙은 처음부터 알려 드려요."},
    {"key": "cafe_chat", "place": "cafe", "burden": 1, "weekday": 3, "hour": 20, "minute": 0, "hours": 1,
     "themes": ["small_talk"], "interests": ["휴식", "음악"],
     "title": "☕ 카페에서 차 한 잔",
     "description": "목요일 저녁, 카페에 들러 차 한 잔 해요. 듣기만 해도 괜찮고, 루미도 와 있어요."},
    {"key": "quiet_reading", "place": "club_center", "burden": 1, "weekday": 6, "hour": 15, "minute": 0, "hours": 2,
     "themes": ["free_activity"], "interests": ["독서", "공부"],
     "title": "📚 일요일 오후 조용한 책 시간",
     "description": "일요일 오후, 동아리센터에서 각자 읽고 싶은 책을 읽어요. 이야기는 마지막 10분만 원하는 사람끼리."},
    {"key": "recipe_share", "place": "club_center", "burden": 2, "weekday": 1, "hour": 19, "minute": 0, "hours": 1,
     "themes": ["free_activity"], "interests": ["요리"],
     "title": "🍳 집에 있는 재료 레시피 나눔",
     "description": "화요일 저녁, 집에 있는 재료로 만드는 간단한 레시피를 하나씩 나눠요. 사진만 올려도 돼요."},
    {"key": "info_day", "place": "support_center", "burden": 1, "weekday": 0, "hour": 18, "minute": 0, "hours": 2,
     "themes": ["info_support"], "interests": ["취업", "공부"],
     "title": "📋 지원센터 생활 정보 데이",
     "description": "월요일 저녁, 지원센터에서 하루가 이번 달 생활·일자리 정보를 정리해 알려줘요. 궁금한 것만 골라 들어도 돼요."},
    {"key": "playlist", "place": "plaza", "burden": 1, "weekday": 5, "hour": 20, "minute": 0, "hours": 1,
     "themes": ["small_talk", "free_activity"], "interests": ["음악", "휴식"],
     "title": "🎵 광장 플레이리스트 나눔",
     "description": "토요일 밤, 광장에서 요즘 듣는 노래를 한 곡씩 틀어요. 듣기만 해도 좋아요."},
]
TEMPLATE_BY_KEY = {t["key"]: t for t in TEMPLATES}

# 시민 화면에 쓰지 않는 표현 — 상태를 드러내거나 대상 집단을 짚는 말(설계 문서 7절)
FORBIDDEN = ["위험", "고립", "외로", "외톨이", "혼자 지내", "우울", "취약", "고독", "위기", "은둔",
             "20대", "30대", "청년층", "남성", "여성", "남자", "여자", "강남", "춘천", "대상자", "Lv"]

PLACE_LABEL = {"plaza": "광장", "park": "공원", "game_room": "게임방", "cafe": "카페",
               "club_center": "동아리센터", "support_center": "지원센터", "mission_room": "미션방"}
GENDER_LABEL = {"M": "남성", "F": "여성", "U": "성별 미상"}


# ------------------------------------------------------------------
# 순수 함수 (테스트 대상)
# ------------------------------------------------------------------
def forbidden_hits(text):
    return [w for w in FORBIDDEN if w in (text or "")]


def next_start(t, now):
    """now 이후(1시간 여유) 가장 가까운 템플릿 요일·시각. now는 aware datetime."""
    base = now.astimezone(KST)
    for d in range(0, 8):
        day = base + timedelta(days=d)
        if day.weekday() != t["weekday"]:
            continue
        s = day.replace(hour=t["hour"], minute=t["minute"], second=0, microsecond=0)
        if s > base + timedelta(hours=1):
            return s
    raise AssertionError("unreachable")


def burden_from_activity(quest_done):
    """최근 퀘스트 완료의 단계 가중평균 → 이 코호트에 맞는 참여 부담(1~3). 기록이 없으면 1(가장 가볍게)."""
    total = sum(int(v) for v in (quest_done or {}).values())
    if total == 0:
        return 1
    mean = sum(int(k) * int(v) for k, v in quest_done.items()) / total
    return 1 if mean < 1.75 else (2 if mean < 2.75 else 3)


def interest_shares(row):
    """{"user_count": n, "interests": {"운동": 4}} → {"운동": 0.67}. 없으면 {}."""
    if not row or not row.get("user_count"):
        return {}
    n = row["user_count"]
    return {k: min(1.0, v / n) for k, v in (row.get("interests") or {}).items()}


def score_template(t, theme, shares, burden):
    """주제 일치 3점 + 관심사 비율 합 × 3 + 부담 적합(딱 맞으면 +1, 더 가벼우면 +0.5, 무거우면 단계당 −1)."""
    s = 3.0 if theme and theme in t["themes"] else 0.0
    s += 3.0 * sum(shares.get(i, 0.0) for i in t["interests"])
    s += 1.0 if t["burden"] == burden else (0.5 if t["burden"] < burden else -(t["burden"] - burden))
    return round(s, 3)


def cohort_label(c):
    return f"{C.REGION_NAMES.get(c['sgg_code'], c['sgg_code'])} {c['age_group']} {GENDER_LABEL.get(c.get('gender') or 'U')}"


def _top_interests(shares, n=2):
    return ", ".join(f"{k} {round(v * 100)}%" for k, v in sorted(shares.items(), key=lambda x: -x[1])[:n]) or "자료 없음(k 미달)"


def plan_events(feedback, interests, activity, active, now, max_active=None):
    """
    feedback : [{sgg_code, age_group, gender, event_theme}]   (event_theme 없는 행은 무시)
    interests: [{sgg_code, age_group, gender, user_count, interests:{태그:수}}]   (k 충족 코호트만)
    activity : [{sgg_code, age_group, gender, quest_done:{단계:수}}]   (최근 몇 주 합산)
    active   : [{template_key, ...}]  이미 초안·공개 중인 이벤트
    반환: (새 이벤트 목록, 건너뛴 이유 목록)
    """
    max_active = C.CHIEF_MAX_ACTIVE if max_active is None else max_active
    key = lambda r: (r["sgg_code"], r["age_group"], r.get("gender") or "U")
    int_by = {key(r): r for r in interests}
    act_by = {}
    for r in activity:
        d = act_by.setdefault(key(r), {})
        for k, v in (r.get("quest_done") or {}).items():
            d[str(k)] = d.get(str(k), 0) + int(v)
    used = {e.get("template_key") for e in active if e.get("template_key")}
    slots = max_active - len(active)
    out, skipped = [], []
    if slots <= 0:
        return out, [f"진행 중 이벤트가 이미 {len(active)}개(최대 {max_active}) — 새로 만들지 않음"]

    # 1) 환류 주제가 있는 코호트 — 같은 주제는 한 번만(여러 코호트가 같은 주제면 첫 코호트 이벤트를 함께 쓴다)
    targets = sorted([r for r in feedback if r.get("event_theme") in THEMES], key=key)
    covered_themes = set()
    for r in targets:
        if slots <= 0:
            skipped.append(f"{cohort_label(r)}: 이벤트 자리 없음(최대 {max_active})")
            continue
        theme = r["event_theme"]
        if theme in covered_themes:
            skipped.append(f"{cohort_label(r)}: 같은 주제({THEMES[theme]['label']}) 이벤트를 이미 이번에 만듦")
            continue
        shares = interest_shares(int_by.get(key(r)))
        burden = burden_from_activity(act_by.get(key(r)))
        cands = [t for t in TEMPLATES if t["key"] not in used and theme in t["themes"]]
        if not cands:
            skipped.append(f"{cohort_label(r)}: 주제 {theme}에 맞는 남은 템플릿 없음")
            continue
        best = max(cands, key=lambda t: (score_template(t, theme, shares, burden), -TEMPLATES.index(t)))
        reason = (f"{cohort_label(r)} 환류 주제 '{THEMES[theme]['label']}' ({THEMES[theme]['why']}) · "
                  f"관심사 {_top_interests(shares)} · 최근 퀘스트 기준 부담 {burden}단계 → '{best['key']}' "
                  f"(점수 {score_template(best, theme, shares, burden)})")
        out.append(_event(best, now, theme, r, reason))
        used.add(best["key"]); covered_themes.add(theme); slots -= 1

    # 2) 자리가 남으면 월드 전체 이벤트 하나 — 전체 관심사 분포로 고른다(대상 코호트 없음)
    if slots > 0:
        tot, n = {}, 0
        for r in interests:
            n += r["user_count"]
            for k, v in (r.get("interests") or {}).items():
                tot[k] = tot.get(k, 0) + v
        shares = {k: v / n for k, v in tot.items()} if n else {}
        cands = [t for t in TEMPLATES if t["key"] not in used]
        if cands:
            best = max(cands, key=lambda t: (score_template(t, None, shares, 1), -TEMPLATES.index(t)))
            reason = (f"월드 전체 이벤트 · 관심사 {_top_interests(shares)} (k 충족 코호트 {len(interests)}개 합산) "
                      f"→ '{best['key']}'")
            out.append(_event(best, now, "world", None, reason))

    # 3) 공개 문구 금칙어 최종 검사 — 걸리면 만들지 않는다
    clean = []
    for e in out:
        hits = forbidden_hits(e["title"] + " " + (e["description"] or ""))
        if hits:
            skipped.append(f"'{e['title']}': 금칙어 {hits} — 만들지 않음")
        else:
            clean.append(e)
    return clean, skipped


def _event(t, now, theme, target, reason):
    s = next_start(t, now)
    return {
        "title": t["title"], "description": t["description"], "place": t["place"],
        "starts_at": s.isoformat(), "ends_at": (s + timedelta(hours=t["hours"])).isoformat(),
        "target_sgg_code": target["sgg_code"] if target else None,
        "target_age_group": target["age_group"] if target else None,
        "target_gender": (target.get("gender") or "U") if target else None,
        "reason_note": reason, "theme": theme, "template_key": t["key"],
        "model_version": C.CHIEF_MODEL_VERSION,
    }


# ------------------------------------------------------------------
# 시연용 월드 활동 합성 배경
# ------------------------------------------------------------------
def build_world_background(persona_table, weeks, today=None):
    """청년 코호트 × 최근 weeks주. 퀘스트는 1·2단계 위주, 이벤트 참여·스티커는 소수(평상시 수준).
    실제 집계(source='live')와 같은 표에 source='synthetic'으로만 들어간다."""
    today = today or datetime.now(KST).date()
    monday = today - timedelta(days=today.weekday())
    rows = []
    for p in persona_table:
        if p["age_group"] not in C.MICRO_ELIGIBLE_AGE_GROUPS:
            continue
        rng = np.random.default_rng(C.stable_seed("world", p["cohort_id"]))
        for w in range(weeks):
            users = int(max(C.K_ANONYMITY_MIN + 1, round(rng.normal(10, 2))))
            q1, q2, q3 = (int(max(0, round(rng.normal(m, 1.2)))) for m in (0.8 * users, 0.35 * users, 0.1 * users))
            rows.append({
                "week_start": (monday - timedelta(weeks=w + 1)).isoformat(),
                "sgg_code": p["sgg_code"], "age_group": p["age_group"], "gender": p["gender"],
                "source": "synthetic", "user_count": users,
                "quest_done": {k: v for k, v in (("1", q1), ("2", q2), ("3", q3)) if v},
                "event_participants": int(max(0, round(rng.normal(0.2 * users, 1)))),
                "cheer_count": int(max(0, round(rng.normal(0.6 * users, 2)))),
            })
    return rows


# ------------------------------------------------------------------
# Supabase 입출력
# ------------------------------------------------------------------
def fetch_inputs(sb, now):
    import supabase_sync as S
    if not S.has_column(sb, "world_events", "status"):
        raise SystemExit("world_events.status 칸이 없습니다 — database/05_chief.sql을 SQL Editor에서 먼저 실행하세요(03 다음).")
    if not S.has_column(sb, "cohort_feedback", "event_theme"):
        raise SystemExit("cohort_feedback.event_theme 칸이 없습니다 — database/03_world_update.sql을 먼저 실행하세요.")
    # 이장의 장부를 먼저 새로 맞춘다 — 퀘스트 완료·이벤트 참여·응원 스티커 → world_activity_metrics(live)
    n_live = sb.rpc("aggregate_world_activity")
    print(f"[장부] 월드 활동 집계 갱신: live {n_live if n_live is not None else '?'}행 (5명 미만 그룹은 계획에 안 씀)")
    fb = sb.select("cohort_feedback", "select=sgg_code,age_group,gender,event_theme&event_theme=not.is.null") or []
    ints = sb.rpc("chief_interest_counts", {"p_k": C.K_ANONYMITY_MIN}) or []
    since = (now.astimezone(KST).date() - timedelta(weeks=C.CHIEF_ACTIVITY_WEEKS)).isoformat()
    act = sb.select("world_activity_metrics", f"select=sgg_code,age_group,gender,quest_done,user_count&week_start=gte.{since}") or []
    act = [a for a in act if (a.get("user_count") or 0) >= C.K_ANONYMITY_MIN]
    now_utc = now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")   # URL에 '+'가 들어가지 않게 UTC 표기
    active = sb.select("world_events",
                       "select=id,template_key,status,title,ends_at&status=in.(draft,published)"
                       f"&or=(ends_at.is.null,ends_at.gt.{now_utc})") or []
    return fb, ints, act, active


def offline_inputs(path):
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    fb = [{"sgg_code": v["sgg_code"], "age_group": v["age_group"], "gender": v["gender"],
           "event_theme": v.get("event_theme")} for v in d.values()]
    if not any(r["event_theme"] for r in fb):
        print("[안내] 이 환류 파일에는 event_theme이 없습니다 — run_pipeline.py를 다시 돌려 최신 환류를 만드세요.")
    return fb, [], [], []


def _print_plan(events, skipped):
    for e in events:
        tgt = cohort_label({"sgg_code": e["target_sgg_code"], "age_group": e["target_age_group"],
                            "gender": e["target_gender"]}) if e["target_sgg_code"] else "월드 전체"
        print(f"  • {e['title']}  [{PLACE_LABEL[e['place']]} · {e['starts_at'][:16].replace('T', ' ')}]")
        print(f"      시민 화면: {e['description']}")
        print(f"      관리자용: 먼저 보여줄 곳 {tgt} / 근거 {e['reason_note']}")
    for s in skipped:
        print(f"  - 건너뜀: {s}")


def cmd_plan(args):
    now = datetime.now(KST)
    if args.offline is not None:
        path = args.offline or os.path.join(HERE, "outputs_youth", "npc_feedback.json")
        fb, ints, act, active = offline_inputs(path)
        sb = None
    else:
        import supabase_sync as S
        sb = S.client()
        fb, ints, act, active = fetch_inputs(sb, now)
    events, skipped = plan_events(fb, ints, act, active, now)
    print(f"[이장] 환류 주제 {sum(1 for r in fb if r.get('event_theme'))}개 코호트 · 관심사 집계 {len(ints)}개 코호트 · "
          f"진행 중 이벤트 {len(active)}개 → 새 이벤트 {len(events)}개")
    _print_plan(events, skipped)
    if sb is None or args.dry_run or not events:
        if sb is None or args.dry_run:
            print("(미리보기만 — DB에 쓰지 않았습니다)")
        return events
    status = "published" if C.CHIEF_AUTO_PUBLISH else "draft"
    rows = [{**e, "status": status, **({"approved_at": now.isoformat()} if status == "published" else {})} for e in events]
    sb.insert("world_events", rows)
    if status == "draft":
        print("초안으로 저장했습니다. 확인 후 공개: python chief.py list → python chief.py approve <id>")
    else:
        print("CHIEF_AUTO_PUBLISH=True 라서 바로 공개했습니다.")
    return events


def _kst(ts):
    """DB 시각(UTC 문자열) → 한국 시각 datetime. 없거나 못 읽으면 None"""
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(KST)
    except ValueError:
        return None


def _kst_label(ts):
    t = _kst(ts)
    return t.strftime("%m/%d(") + "월화수목금토일"[t.weekday()] + t.strftime(") %H:%M KST") if t else (ts or "")


def cmd_list(args):
    import supabase_sync as S
    sb = S.client()
    rows = sb.select("world_events", "select=id,status,title,place,starts_at,ends_at,target_sgg_code,target_age_group,"
                     "target_gender,reason_note&status=in.(draft,published)&order=starts_at") or []
    if not rows:
        print("초안·공개 중인 이벤트가 없습니다. python chief.py plan 으로 만드세요.")
    # 참여 인원(관리자만 볼 수 있음 — secret key라 RLS를 거치지 않는다). 누가 참여했는지는 출력하지 않는다
    joined = {}
    for p in (sb.select("event_participation", "select=event_id") or []) if rows else []:
        joined[p["event_id"]] = joined.get(p["event_id"], 0) + 1
    now = datetime.now(KST)
    for r in rows:
        tgt = cohort_label({"sgg_code": r["target_sgg_code"], "age_group": r["target_age_group"],
                            "gender": r["target_gender"]}) if r.get("target_sgg_code") else "월드 전체"
        ends = _kst(r.get("ends_at"))
        done = "  (끝남 — 시민 화면엔 안 보임)" if ends and ends < now else ""
        print(f"#{r['id']:<4} {r['status']:<9} {r['title']}  [{PLACE_LABEL.get(r['place'], r['place'])} · "
              f"{_kst_label(r.get('starts_at'))}]  → {tgt}  · 참여 {joined.get(r['id'], 0)}명{done}")
        print(f"       근거: {r.get('reason_note') or '-'}")


def cmd_status(args, new_status, allowed_from):
    import supabase_sync as S
    sb = S.client()
    now = datetime.now(KST).isoformat()
    extra = {"approved_at": now} if new_status == "published" else ({"closed_at": now} if new_status == "closed" else {})
    ids = []
    for raw in args.ids:
        tok = str(raw).strip().lstrip("#")          # list 출력의 "#12"를 그대로 붙여 넣어도 된다
        if tok.isdigit():
            ids.append(int(tok))
        else:
            print(f"'{raw}': 건너뜀 — 이벤트 번호(숫자)가 아닙니다. 번호는 python chief.py list 로 확인하세요")
    if not ids:
        print("바꿀 이벤트 번호가 없습니다. 예: python chief.py approve 12 13")
        return
    for i in ids:
        got = sb.update("world_events", f"id=eq.{i}&status=in.({','.join(allowed_from)})",
                        {"status": new_status, **extra}) or []
        if got:
            print(f"#{i} → {new_status}  ({got[0]['title']})")
        else:
            print(f"#{i}: 바꾸지 않음 — 없는 id이거나 상태가 {'/'.join(allowed_from)}가 아닙니다")


def cmd_seed_world(args):
    import supabase_sync as S
    sb = S.client()
    rows = build_world_background(S._youth_personas(), C.CHIEF_ACTIVITY_WEEKS)
    sb.delete("world_activity_metrics", "source=eq.synthetic")
    sb.insert("world_activity_metrics", rows)
    print(f"월드 활동 합성 배경 {len(rows)}행 적재 (청년 코호트 × 최근 {C.CHIEF_ACTIVITY_WEEKS}주, source='synthetic')")


def main(argv=None):
    ap = argparse.ArgumentParser(description="마을이장 v1 — 이벤트 결정 엔진")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan", help="이벤트 초안 만들기")
    p.add_argument("--dry-run", action="store_true", help="계산만 하고 DB에 쓰지 않음")
    p.add_argument("--offline", nargs="?", const="", default=None,
                   help="Supabase 없이 환류 파일(npc_feedback.json)로 미리보기")
    sub.add_parser("list", help="초안·공개 중 이벤트 보기")
    for name in ("approve", "reject", "close"):
        sp = sub.add_parser(name)
        sp.add_argument("ids", nargs="+")
    sub.add_parser("seed-world", help="시연용 월드 활동 합성 배경 적재")
    args = ap.parse_args(argv)
    if args.cmd == "plan":
        cmd_plan(args)
    elif args.cmd == "list":
        cmd_list(args)
    elif args.cmd == "approve":
        cmd_status(args, "published", ["draft"])
    elif args.cmd == "reject":
        cmd_status(args, "rejected", ["draft"])
    elif args.cmd == "close":
        cmd_status(args, "closed", ["published"])
    elif args.cmd == "seed-world":
        cmd_seed_world(args)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
