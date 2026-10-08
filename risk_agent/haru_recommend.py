# -*- coding: utf-8 -*-
"""
하루 정책 고르기 — DB 함수 recommend_programs()·program_counts()(06_haru.sql, 10/8 보정 09_haru_rules.sql)를 Python으로 똑같이 옮긴 것

지금 시민 화면은 DB 함수를 부른다. 이 파일은
  ① haru_check.py 가 "지역·나이대별로 어떤 카드가 보일지" 미리 뽑아 검수할 때
  ② 나중에 판단을 Python 서버로 옮길 때 (그때는 이 함수가 DB 함수를 대신한다)
쓴다. 규칙을 바꾸면 09_haru_rules.sql 과 이 파일을 같이 고치고, tests/test_haru_recommend.py 를 돌린다.

행(row)은 welfare_programs 한 줄(dict). 프로필은 {"sgg_code": "11680", "age_group": "20대"}.
"""

MENUS = ("housing", "living", "mind", "social", "job")
MENU_LABEL = {"housing": "주거비", "living": "생활비", "mind": "마음건강", "social": "사람 만나기", "job": "일·취업"}


def scope(profile):
    """06 _haru_scope(): 내 시군구, 나이 범위, 생애주기. 20·30대 외에는 나이로 거르지 않는다"""
    age = (profile or {}).get("age_group")
    sgg = (profile or {}).get("sgg_code")
    if age == "20대":
        return sgg, 20, 29, {"청년"}
    if age == "30대":
        return sgg, 30, 39, {"청년", "중장년"}
    return sgg, None, None, None


def _num(v, default):
    return default if v is None else v


def is_special(row):
    """09 _haru_is_special(): 저소득을 뺀 대상 특성이 남으면 특정 대상. 저소득만 있으면 기본 카드('소득 기준이 있어요')"""
    return bool(set(row.get("target_groups") or []) - {"저소득"})


def fits_person(row, lo, hi, stages):
    """생애주기·나이 범위가 내 나이대와 맞는가(모르면 맞는 것으로 둔다)"""
    life = set(row.get("life_stages") or [])
    if stages is not None and life and not (life & stages):
        return False
    if lo is not None and not (_num(row.get("age_min"), 0) <= hi and _num(row.get("age_max"), 200) >= lo):
        return False
    return True


def in_region(row, menu, my_sgg):
    return (row.get("is_active", True) and menu in (row.get("menus") or [])
            and (row.get("source") == "central" or row.get("sgg_code") == my_sgg))


def _reason(row, is_local, age_partial, special=False):
    parts = []
    if is_local:
        parts.append(f"{row.get('region_label')}에서 하는 사업이에요")
    if list(row.get("life_stages") or []) == ["청년"]:
        parts.append("청년만을 위한 사업이에요")
    if row.get("online_apply"):
        parts.append("온라인으로 신청할 수 있어요")
    if not special and "저소득" in (row.get("target_groups") or []):
        parts.append("소득 기준이 있어요")
    if age_partial:
        parts.append("나이 조건이 일부만 맞을 수 있어요")
    return " · ".join(parts)


def recommend(rows, profile, menu, limit=3, special=False):
    """06 recommend_programs()와 같은 순서·같은 칸(주요 칸만)"""
    my_sgg, lo, hi, stages = scope(profile)
    out = []
    for r in rows:
        if not in_region(r, menu, my_sgg) or not fits_person(r, lo, hi, stages):
            continue
        if is_special(r) != special:
            continue
        is_local = r.get("source") == "local"
        age_unknown = lo is not None and r.get("age_min") is None and r.get("age_max") is None
        age_partial = lo is not None and (_num(r.get("age_min"), 0) > lo or _num(r.get("age_max"), 200) < hi)
        score = int(bool(r.get("online_apply"))) + int(list(r.get("life_stages") or []) == ["청년"])
        out.append(((-score, -int(is_local), -(r.get("popularity") if r.get("popularity") is not None else -1), r.get("name") or ""),
                    {"serv_id": r["serv_id"], "name": r.get("name"), "region_label": r.get("region_label"),
                     "is_local": is_local, "online_apply": r.get("online_apply"),
                     "age_note": age_unknown or age_partial, "target_groups": list(r.get("target_groups") or []),
                     "reason": _reason(r, is_local, age_partial, special)}))
    out.sort(key=lambda x: x[0])
    n = 3 if limit is None else limit                          # SQL: greatest(1, least(coalesce(p_limit, 3), 10))
    return [card for _, card in out[:max(1, min(n, 10))]]


def counts(rows, profile, menu):
    """06 program_counts(): 맞음 · 특정 대상 · 자격 미달(내 지역·전국 사업 중 나이·생애주기가 안 맞음)"""
    my_sgg, lo, hi, stages = scope(profile)
    eligible = special = ineligible = 0
    for r in rows:
        if not in_region(r, menu, my_sgg):
            continue
        if not fits_person(r, lo, hi, stages):
            ineligible += 1
        elif is_special(r):
            special += 1
        else:
            eligible += 1
    return {"eligible": eligible, "special": special, "ineligible": ineligible}
