# -*- coding: utf-8 -*-
"""
하루 — 복지로 API를 받아 정리해 Supabase welfare_programs 에 저장 (주 1회)

  python haru_sync.py                  # 중앙부처 + 지자체(강남구·춘천시) 정책 → DB
  python haru_sync.py --dry-run        # 목록만 받아서 "상세를 몇 건 받을지"만 보여줌(DB에 안 씀)
  python haru_sync.py --only local     # central | local
  python haru_sync.py --max-calls 300  # 이번 실행 API 호출 상한(기본 900)
  python haru_sync.py --refresh-menus  # API 없이 저장된 정책에 메뉴·특정 대상·나이 규칙을 다시 적용(규칙을 바꾼 뒤)

흐름: ① 목록(청년·중장년 / 두 시군구) → ② 바뀐 것만 고르기 → ③ 상세(한도 안에서, 못 받으면 다음 실행에 이어서)
      → ④ 하루가 쓰기 좋게 정리(메뉴·대상 특성·나이 범위·문의처·복지로 링크) → ⑤ upsert, 목록에서 사라진 사업은 is_active=false
필요: risk_agent/.env 에 DATA_GO_KR_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY · DB에 database/06_haru.sql
시민 브라우저는 이 API를 부르지 않는다. 인증키·비밀키는 화면과 파일에 남기지 않는다.
설계: docs/planning/사회적고립_AI에이전트_통합기획서.md 6-3
"""
import argparse
import html
import re
import sys
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone

import haru_probe as HP          # 인증키 읽기·주소 만들기·요청(키 가림 포함)을 같이 쓴다

KST = timezone(timedelta(hours=9))
MAX_CALLS = 900                  # 복지서비스 2종 하루 한도 1,000회 — 여유를 둔다
PAGE = 100
REFRESH_DAYS = 30                # 중앙부처 목록엔 수정일이 없다 → 받은 지 30일 지나면 상세를 다시 받는다
CENTRAL = "NationalWelfareInformationsV001"
LOCAL = "LocalGovernmentWelfareInformations"
LIFE_CODES = {"004": "청년", "005": "중장년"}          # 소셜 월드는 20·30대 — 30대 후반은 중장년에 걸린다
REGIONS = [("서울특별시", "강남구", "11680"), ("강원특별자치도", "춘천시", "51110")]
KEEP_STAGES = {"청년", "중장년"}

# 복지로 관심주제 → 하루 메뉴. 여기에 없는 주제(보육·임신·출산 등)만 있는 사업은 받지 않는다(호출 절약)
MENU_FROM_THEME = {
    "주거": "housing",
    "생활지원": "living", "서민금융": "living",
    "정신건강": "mind",
    "문화·여가": "social",
    "일자리": "job",
}
# 관심주제만으로는 빠지는 경우 — "신혼부부 청년 전월세 대출이자"가 '서민금융'으로만 분류됨. 사업 이름의 낱말로 메뉴를 더한다
MENU_FROM_NAME = [
    (re.compile(r"월세|전세|주거|임대|주택|보증금"), "housing"),
    (re.compile(r"취업(?!\s*후\s*상환)|일자리|구직|자격증|직업훈련|면접"), "job"),     # '취업 후 상환 학자금대출'은 대출
    (re.compile(r"심리|마음건강|정신건강"), "mind"),
]
# 2026-10-08 검수: 20·30대 시민에게 보이면 안 되는 사업 — 고등학생·학교 대상, 기관용 사업. 메뉴를 비워 하루에 안 나오게 한다
EXCLUDE_NAME = re.compile(r"고교|고등학교|고졸|모델\s*개발")
# 2026-10-08 검수: 복지로 '가구상황'에 안 걸리지만 특정한 사람만 받는 사업 — 이름으로 특정 대상을 더한다
GROUP_FROM_NAME = [
    (re.compile(r"의사상자"), "의사상자"),
    (re.compile(r"자립준비청년|보호종료|퇴소\s*청소년"), "자립준비청년"),
    (re.compile(r"경계선\s*지능"), "경계선지능"),
    (re.compile(r"입양|가정위탁"), "입양·위탁가정"),
]
MENU_LABEL = {"housing": "주거비", "living": "생활비", "mind": "마음건강", "social": "사람 만나기", "job": "일·취업"}


class ApiError(Exception):
    pass


class QuotaExceeded(ApiError):
    """공공데이터포털 일일 한도(코드 22) — 그 API만 오늘 끝"""


class CallCap(QuotaExceeded):
    """이번 실행 상한(--max-calls) — 실행 전체를 멈춤"""


API_NAME = {"central": "중앙부처 복지서비스", "local": "지자체 복지서비스"}


# ------------------------------------------------------------------
# XML 읽기
# ------------------------------------------------------------------
def _txt(el):
    return re.sub(r"\s+", " ", (el.text or "")).strip() if el is not None else ""


def parse_root(body):
    try:
        root = ET.fromstring(body.strip())
    except ET.ParseError:
        raise ApiError("XML이 아닌 응답: " + body.strip()[:120])
    code = _txt(root.find(".//resultCode")) or _txt(root.find(".//returnReasonCode"))
    msg = _txt(root.find(".//resultMessage")) or _txt(root.find(".//returnAuthMsg"))
    if "LIMITED_NUMBER" in msg or code == "22":
        raise QuotaExceeded(f"오늘 호출 한도를 다 썼습니다({code} {msg})")
    if code not in ("", "0", "00"):
        raise ApiError(f"API 오류 {code} {msg}")
    return root


def parse_list(body):
    """(전체 건수, [목록 항목 dict])"""
    root = parse_root(body)
    total = int(_txt(root.find("totalCount")) or 0)
    items = [{c.tag: _txt(c) for c in el} for el in root.findall("servList")]
    return total, items


def parse_detail(body):
    """맨 위 칸은 문자열, 반복 묶음(applmetList 등)은 dict 목록"""
    root = parse_root(body)
    out = {}
    for el in root:
        if len(el):
            out.setdefault(el.tag, []).append({c.tag: _txt(c) for c in el})
        else:
            out[el.tag] = _txt(el)
    return out


def split_list(s):
    return [x.strip() for x in re.split(r"[,，]", s or "") if x.strip()]


# ------------------------------------------------------------------
# 나이 범위 — 대상 문장에서 확실할 때만 뽑는다. 애매하면 (None, None) → 화면에 '나이 조건 확인'
# ------------------------------------------------------------------
_N = r"(?:만\s*)?(\d{1,2})\s*세?"
RANGE = re.compile(_N + r"\s*(?:이상)?\s*[~∼〜～\-–]\s*" + r"(?:만\s*)?(\d{1,2})\s*세\s*(이하|미만)?")
RANGE_WORDS = re.compile(r"(?:만\s*)?(\d{1,2})\s*세\s*이상\s*(?:만\s*)?(\d{1,2})\s*세\s*(이하|미만)")
MIN_ONLY = re.compile(r"(?:만\s*)?(\d{1,2})\s*세\s*이상(?!이더라도|인\s*경우에도)")    # "18세 이상이더라도 재학 중이면"은 조건이 아님
MAX_ONLY = re.compile(r"(?:만\s*)?(\d{1,2})\s*세\s*(미만|이하)(\s*(?:의|인)?\s*청소년)?")


def _ranges(text):
    found = []
    for rx in (RANGE, RANGE_WORDS):
        for m in rx.finditer(text):
            lo, hi = int(m.group(1)), int(m.group(2))
            if m.group(3) == "미만":
                hi -= 1
            if 0 <= lo <= hi <= 100:
                found.append((m.start(), lo, hi))
    return found


def extract_age(*texts):
    t = html.unescape(" ".join(x for x in texts if x))          # 복지로 문장에 &sim; &lsquo; 같은 HTML 표기가 섞여 온다
    if not t:
        return None, None
    found = _ranges(t)
    # ① '청년' 바로 뒤(괄호 등 12자 안)의 범위 — "어르신(65세 이상), 청년(19~24세)" 같은 문장
    for m in re.finditer(r"청년", t):
        near = [(lo, hi) for pos, lo, hi in found if 0 <= pos - m.end() <= 12]
        if near:
            return near[0]
    uniq = {(lo, hi) for _, lo, hi in found}
    if len(uniq) == 1:
        return uniq.pop()
    if uniq:                                         # 서로 다른 범위가 여러 개 — 누구 것인지 모름
        return None, None
    mins = {int(x) for x in MIN_ONLY.findall(t)}
    if len(mins) == 1 and min(mins) >= 14:
        return min(mins), None
    if mins:
        return None, None
    # 상한만 — "만 40세 미만", "만 19세 미만의 청소년". 25세 아래 상한은 자녀 나이("만 18세 이하 자녀")가 많아서 '청소년'이 바로 붙을 때만
    tops = {int(n) - (m == "미만") for n, m, youth in MAX_ONLY.findall(t) if int(n) >= 25 or youth}
    if len(tops) == 1:
        return None, tops.pop()
    return None, None


# ------------------------------------------------------------------
# 정리 — 중앙·지자체를 같은 모양의 행으로
# ------------------------------------------------------------------
def menus_of(themes, name=""):
    """관심주제로 정한 메뉴가 하나라도 있을 때만 이름 낱말로 메뉴를 더한다(보육·출산만 있는 사업은 그대로 제외)
    고등학생·기관용 사업(EXCLUDE_NAME)은 메뉴를 비운다"""
    if EXCLUDE_NAME.search(name or ""):
        return []
    base = {MENU_FROM_THEME[t] for t in themes if t in MENU_FROM_THEME}
    if base:
        base |= {menu for rx, menu in MENU_FROM_NAME if rx.search(name or "")}
    return sorted(base)


def groups_of(groups, name=""):
    """복지로 가구상황(장애인·저소득 …) + 이름으로 알아낸 특정 대상. 순서는 복지로 것 먼저, 중복 없이"""
    out = list(dict.fromkeys(groups or []))
    for rx, g in GROUP_FROM_NAME:
        if rx.search(name or "") and g not in out:
            out.append(g)
    return out


def wanted(item):
    """하루가 쓸 사업인가 — 메뉴로 이어지는 주제가 있고, 생애주기가 비었거나 청년·중장년을 포함"""
    themes = split_list(item.get("intrsThemaArray") or item.get("intrsThemaNmArray"))
    stages = split_list(item.get("lifeArray") or item.get("lifeNmArray"))
    return bool(menus_of(themes, item.get("servNm"))) and (not stages or bool(KEEP_STAGES & set(stages)))


def _ymd(s):
    try:
        return datetime.strptime(s, "%Y%m%d").date().isoformat() if s and s != "99991231" else None
    except ValueError:
        return None


def _pairs(rows, name_key, value_key):
    return [{"name": r.get(name_key, ""), "value": r.get(value_key, "")} for r in rows or []
            if r.get(value_key) or r.get(name_key)]


def base_row(item, detail, now):
    themes = split_list(item.get("intrsThemaArray") or item.get("intrsThemaNmArray") or detail.get("intrsThemaArray"))
    stages = split_list(item.get("lifeArray") or item.get("lifeNmArray") or detail.get("lifeArray"))
    groups = split_list(item.get("trgterIndvdlArray") or item.get("trgterIndvdlNmArray") or detail.get("trgterIndvdlArray"))
    sid = item["servId"]
    return {
        "serv_id": sid,
        "name": detail.get("servNm") or item.get("servNm"),
        "summary": item.get("servDgst") or detail.get("wlfareInfoOutlCn") or detail.get("servDgst"),
        "life_stages": stages,
        "themes": themes,
        "menus": menus_of(themes, detail.get("servNm") or item.get("servNm")),
        "target_groups": groups_of(groups, detail.get("servNm") or item.get("servNm")),
        "online_apply": {"Y": True, "N": False}.get(item.get("onapPsbltYn")),
        "support_cycle": item.get("sprtCycNm") or detail.get("sprtCycNm") or None,
        "provision_type": item.get("srvPvsnNm") or detail.get("srvPvsnNm") or None,
        "detail_url": item.get("servDtlLink")
                      or f"https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId={sid}",
        "popularity": int(item["inqNum"]) if (item.get("inqNum") or "").isdigit() else None,
        "fetched_at": now.isoformat(),
        "is_active": True,
    }


def normalize_central(item, detail, now):
    row = base_row(item, detail, now)
    steps = [{"stage": r.get("servSeDetailNm", ""), "text": r.get("servSeDetailLink", "")} for r in detail.get("applmetList", [])]
    apply_text = next((s["text"] for s in steps if "신청" in s["stage"]), None)
    target, crit = detail.get("tgtrDtlCn"), detail.get("slctCritCn")
    lo, hi = extract_age(target, crit)
    row.update({
        "source": "central",
        "org": " ".join(x for x in [item.get("jurMnofNm"), item.get("jurOrgNm")] if x) or detail.get("jurMnofNm"),
        "sgg_code": None, "region_label": "전국",
        "target_text": target or None, "criteria_text": crit or None,
        "benefit_text": detail.get("alwServCn") or None, "apply_text": apply_text,
        "apply_steps": steps,
        "contacts": _pairs(detail.get("inqplCtadrList"), "servSeDetailNm", "servSeDetailLink")
                    or ([{"name": "대표 문의", "value": item["rprsCtadr"]}] if item.get("rprsCtadr") else []),
        "homepage": next((r.get("servSeDetailLink") for r in detail.get("inqplHmpgReldList", []) if r.get("servSeDetailLink")), None),
        "laws": [r.get("servSeDetailNm") for r in detail.get("baslawList", []) if r.get("servSeDetailNm")],
        "age_min": lo, "age_max": hi,
        "period_end": None, "source_modified": None,
    })
    return row


def normalize_local(item, detail, now, sgg_code):
    row = base_row(item, detail, now)
    target, crit = detail.get("sprtTrgtCn"), detail.get("slctCritCn")
    lo, hi = extract_age(target, crit)
    end = _ymd(detail.get("enfcEndYmd"))
    row.update({
        "source": "local",
        "org": item.get("bizChrDeptNm") or detail.get("bizChrDeptNm"),
        "sgg_code": sgg_code,
        "region_label": " ".join(x for x in [item.get("ctpvNm"), item.get("sggNm")] if x),
        "target_text": target or None, "criteria_text": crit or None,
        "benefit_text": detail.get("alwServCn") or None,
        "apply_text": detail.get("aplyMtdCn") or item.get("aplyMtdNm") or None,
        "apply_steps": [],
        "contacts": _pairs(detail.get("inqplCtadrList"), "wlfareInfoReldNm", "wlfareInfoReldCn"),
        "homepage": next((r.get("wlfareInfoReldCn") for r in detail.get("inqplHmpgReldList", []) if r.get("wlfareInfoReldCn")), None),
        "laws": [r.get("wlfareInfoReldNm") for r in detail.get("baslawList", []) if r.get("wlfareInfoReldNm")],
        "age_min": lo, "age_max": hi,
        "period_end": end,
        "source_modified": _ymd(item.get("lastModYmd") or detail.get("lastModYmd")),
    })
    if end and end < now.date().isoformat():
        row["is_active"] = False                       # 시행이 끝난 사업
    return row


# ------------------------------------------------------------------
# 호출 — 상한을 세고, 한도 초과면 멈춘다
# ------------------------------------------------------------------
class Caller:
    def __init__(self, key, fetcher, max_calls):
        self.key, self.fetcher, self.max, self.used = key, fetcher, max_calls, 0

    def left(self):
        return self.max - self.used

    def get(self, path, params):
        if self.used >= self.max:
            raise CallCap(f"이번 실행 호출 상한({self.max}회)에 닿았습니다")
        self.used += 1
        status, body = self.fetcher(HP.build_url(path, params, self.key))
        if status == 0:
            raise ApiError(HP.redact(body, self.key))
        if status >= 400 and not body.lstrip().startswith("<"):
            raise ApiError(f"HTTP {status}: {HP.redact(body, self.key)[:120]}")
        return body


def fetch_all(caller, path, params):
    """목록을 끝까지 받는다. (항목들, 끝까지 받았는지)"""
    items, seen, page, total = [], set(), 1, None
    while True:
        total_now, got = parse_list(caller.get(path, {**params, "pageNo": str(page), "numOfRows": str(PAGE)}))
        total = total_now if total is None else total
        new = [g for g in got if g.get("servId") and g["servId"] not in seen]
        for g in new:
            seen.add(g["servId"]); items.append(g)
        if not new or len(items) >= total or page * PAGE >= total:
            return items, len(items) >= total or not got
        page += 1


# ------------------------------------------------------------------
# 동기화
# ------------------------------------------------------------------
def needs_detail(item, old, now):
    if old is None or not old.get("is_active", True):
        return True
    if item.get("lastModYmd"):                       # 지자체: 수정일 비교
        return _ymd(item["lastModYmd"]) != old.get("source_modified")
    fetched = old.get("fetched_at")
    if not fetched:
        return True
    when = datetime.fromisoformat(str(fetched).replace("Z", "+00:00"))
    return now - when > timedelta(days=REFRESH_DAYS)


def sync(sb, key, fetcher=HP.fetch, only=None, max_calls=MAX_CALLS, dry_run=False, now=None, log=print):
    now = now or datetime.now(KST)
    caller = Caller(key, fetcher, max_calls)
    existing = {}
    if sb is not None:
        for r in sb.select("welfare_programs", "select=serv_id,source,sgg_code,source_modified,fetched_at,is_active") or []:
            existing[r["serv_id"]] = r
    stats = {"list_items": 0, "skipped_theme": 0, "new": 0, "changed": 0, "unchanged": 0,
             "deferred": 0, "deactivated": 0, "calls": 0, "stopped": None, "blocked": {}}
    rows, complete_scopes, listed = [], [], set()
    blocked = stats["blocked"]                        # {"central": 사유} — 한도에 걸린 API는 오늘 더 부르지 않는다

    def stop(src, e):
        if isinstance(e, CallCap):
            stats["stopped"] = str(e)
        else:
            blocked[src] = str(e)

    def can_call(src):
        return not stats["stopped"] and src not in blocked

    # ① 목록 — 목록을 끝까지 받은 범위만 complete_scopes (그 범위에서만 '사라짐' 처리)
    jobs = []                                         # (scope, item, sgg_code)
    if only in (None, "central"):
        seen, done_all = set(), True
        try:
            for code in LIFE_CODES:
                items, done = fetch_all(caller, f"{CENTRAL}/NationalWelfarelistV001",
                                        {"callTp": "L", "srchKeyCode": "003", "lifeArray": code})
                done_all = done_all and done
                for it in items:
                    if it["servId"] not in seen:
                        seen.add(it["servId"]); jobs.append((("central", None), it, None))
            if done_all:
                complete_scopes.append(("central", None))
        except QuotaExceeded as e:
            stop("central", e)
    if only in (None, "local"):
        for ctpv, sgg, code in REGIONS:
            if not can_call("local"):
                break
            try:
                items, done = fetch_all(caller, f"{LOCAL}/LcgvWelfarelist", {"ctpvNm": ctpv, "sggNm": sgg})
            except QuotaExceeded as e:
                stop("local", e); break
            jobs += [(("local", code), it, code) for it in items]
            if done:
                complete_scopes.append(("local", code))

    stats["list_items"] = len(jobs)
    # ② 바뀐 것만 — 새 사업 먼저
    todo = []
    for scope, it, code in jobs:
        listed.add(it["servId"])
        if not wanted(it):
            stats["skipped_theme"] += 1
            continue
        old = existing.get(it["servId"])
        if needs_detail(it, old, now):
            todo.append((old is None, scope, it, code))
        else:
            stats["unchanged"] += 1
    todo.sort(key=lambda x: not x[0])

    # ③ 상세 → ④ 정리
    if dry_run:
        stats["new"] = sum(1 for t in todo if t[0]); stats["changed"] = len(todo) - stats["new"]
        stats["calls"] = caller.used
        log(report(stats, dry_run=True))
        return stats, []
    for is_new, scope, it, code in todo:
        if not can_call(scope[0]):
            stats["deferred"] += 1
            continue
        try:
            if scope[0] == "central":
                d = parse_detail(caller.get(f"{CENTRAL}/NationalWelfaredetailedV001", {"callTp": "D", "servId": it["servId"]}))
                rows.append(normalize_central(it, d, now))
            else:
                d = parse_detail(caller.get(f"{LOCAL}/LcgvWelfaredetailed", {"servId": it["servId"]}))
                rows.append(normalize_local(it, d, now, code))
            stats["new" if is_new else "changed"] += 1
        except QuotaExceeded as e:
            stop(scope[0], e); stats["deferred"] += 1
        except ApiError as e:
            log(f"  [건너뜀] {it['servId']} {it.get('servNm', '')}: {e}")
            stats["deferred"] += 1

    # ⑤ 저장 — 목록을 끝까지 받은 범위에서만 '사라진 사업'을 끈다
    gone = [sid for sid, r in existing.items() if r.get("is_active", True) and sid not in listed
            and (r.get("source"), r.get("sgg_code")) in complete_scopes]
    stats["deactivated"] = len(gone)
    stats["calls"] = caller.used
    if sb is not None:
        for i in range(0, len(rows), 50):
            sb.upsert("welfare_programs", rows[i:i + 50], "serv_id")
        for i in range(0, len(gone), 50):
            ids = ",".join(gone[i:i + 50])
            sb.update("welfare_programs", f"serv_id=in.({ids})", {"is_active": False})
    log(report(stats))
    return stats, rows


def refreshed(r):
    """저장된 한 줄에 지금 규칙을 다시 적용한 값 — 메뉴·특정 대상·나이(대상 문장에서 다시 뽑음)"""
    new = {"menus": menus_of(r.get("themes") or [], r.get("name") or ""),
           "target_groups": groups_of(r.get("target_groups") or [], r.get("name") or "")}
    if r.get("target_text") or r.get("criteria_text"):            # 문장이 없으면 나이는 그대로 둔다
        new["age_min"], new["age_max"] = extract_age(r.get("target_text"), r.get("criteria_text"))
    return {k: v for k, v in new.items()
            if (sorted(v) != sorted(r.get(k) or []) if isinstance(v, list) else v != r.get(k))}


def refresh_menus(sb, log=print):
    """저장된 정책에 메뉴·특정 대상·나이 규칙을 다시 적용한다 — 복지로 API를 부르지 않는다(규칙을 바꾼 뒤 한 번)
    특정 대상은 더하기만 한다(복지로에서 받은 가구상황은 지우지 않음)"""
    groups = {}
    for r in sb.select("welfare_programs", "select=serv_id,name,themes,menus,target_groups,target_text,criteria_text,age_min,age_max") or []:
        ch = refreshed(r)
        if ch:
            key = tuple(sorted((k, tuple(v) if isinstance(v, list) else v) for k, v in ch.items()))
            groups.setdefault(key, []).append(r["serv_id"])
    n = 0
    for key, ids in groups.items():
        patch = {k: list(v) if isinstance(v, tuple) else v for k, v in key}
        for i in range(0, len(ids), 50):
            sb.update("welfare_programs", f"serv_id=in.({','.join(ids[i:i + 50])})", patch)
        n += len(ids)
    log(f"[하루 규칙 다시 적용] {n}건 바꿈 (메뉴·특정 대상·나이, API 호출 0회)")
    return n


def report(s, dry_run=False):
    head = "[미리보기 — DB에 쓰지 않음]" if dry_run else "[하루 정책 동기화]"
    lines = [f"{head} 목록 {s['list_items']}건 (메뉴와 무관·청년·중장년 아님 {s['skipped_theme']}건 제외)",
             f"  새로 받음 {s['new']} · 바뀜 {s['changed']} · 그대로 {s['unchanged']} · 종료 처리 {s['deactivated']}"
             + (f" · 다음에 이어서 {s['deferred']}" if s["deferred"] else ""),
             f"  API 호출 {s['calls']}회"]
    for src, why in s.get("blocked", {}).items():
        lines.append(f"  ※ {API_NAME[src]} API 한도 초과: {why} — 이 API만 멈췄습니다. 내일 다시 실행하면 이어서 받습니다")
    if s["stopped"]:
        lines.append(f"  ※ 중간에 멈춤: {s['stopped']} — 다시 실행하면 이어서 받습니다")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="하루 — 복지로 정책을 받아 Supabase에 저장")
    ap.add_argument("--only", choices=["central", "local"])
    ap.add_argument("--dry-run", action="store_true", help="목록만 받아 몇 건을 받을지 보여 줌(DB에 쓰지 않음)")
    ap.add_argument("--max-calls", type=int, default=MAX_CALLS)
    ap.add_argument("--refresh-menus", action="store_true", help="API 없이 저장된 정책에 메뉴·특정 대상·나이 규칙을 다시 적용")
    args = ap.parse_args(argv)
    import supabase_sync as S
    sb = S.client()
    if args.refresh_menus:
        refresh_menus(sb)
        return
    key = HP.load_key()
    if not S.has_column(sb, "welfare_programs", "menus"):
        if not args.dry_run:
            raise SystemExit("welfare_programs 표가 없습니다 — database/06_haru.sql을 SQL Editor에서 먼저 실행하세요.")
        print("[안내] welfare_programs 표가 아직 없어서 전부 '새로 받음'으로 셉니다.")
        sb = None
    sync(sb, key, only=args.only, max_calls=args.max_calls, dry_run=args.dry_run)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
