# -*- coding: utf-8 -*-
"""
하루 정책 데이터 검수 — 팀 Supabase의 welfare_programs를 읽어서 시연 전에 이상한 카드가 없는지 본다(읽기만 함)

  python haru_check.py

결과 (git에 안 올라가는 risk_agent/haru_samples/ 폴더에 저장)
  check_programs.csv   정책 한 줄씩 + 살펴볼 점(flags)
  check_cards.csv      강남·춘천 × 20대·30대 × 메뉴 5개 — 시민에게 실제로 보일 카드 순서(특정 대상은 S1, S2…)
  화면 출력            전체 수, 메뉴별 수, 살펴볼 점 요약, 프로필·메뉴별 맞음/특정 대상/자격 미달 수

카드 순서는 haru_recommend.py(06_haru.sql + 09_haru_rules.sql과 같은 규칙)로 계산한다. 복지로 API는 부르지 않는다.
"""
import csv
import os
import re
import sys
from collections import Counter

import haru_recommend as HR
from haru_sync import menus_of, groups_of, extract_age

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "haru_samples")
COLUMNS = ("serv_id,source,name,summary,org,sgg_code,region_label,life_stages,themes,menus,target_groups,online_apply,"
           "target_text,criteria_text,benefit_text,apply_text,contacts,homepage,age_min,age_max,detail_url,popularity,"
           "is_active,period_end,source_modified,fetched_at")
PROFILES = [("강남 20대", {"sgg_code": "11680", "age_group": "20대"}), ("강남 30대", {"sgg_code": "11680", "age_group": "30대"}),
            ("춘천 20대", {"sgg_code": "51110", "age_group": "20대"}), ("춘천 30대", {"sgg_code": "51110", "age_group": "30대"})]
AGE_IN_TEXT = re.compile(r"\d{1,2}\s*세")


def flags_of(r):
    """살펴볼 점 — 틀렸다는 뜻이 아니라 사람이 한 번 볼 곳"""
    f = []
    by_theme = set(menus_of(r.get("themes") or [], ""))
    by_name = set(r.get("menus") or []) - by_theme
    if by_name:
        f.append("이름 낱말로 메뉴 추가: " + ",".join(HR.MENU_LABEL.get(m, m) for m in sorted(by_name)))
    if set(menus_of(r.get("themes") or [], r.get("name") or "")) != set(r.get("menus") or []):
        f.append("메뉴가 지금 규칙과 다름(--refresh-menus 필요)")
    if set(groups_of(r.get("target_groups") or [], r.get("name") or "")) != set(r.get("target_groups") or []):
        f.append("특정 대상이 지금 규칙과 다름(--refresh-menus 필요)")
    text = " ".join(x for x in [r.get("target_text"), r.get("criteria_text")] if x)
    if r.get("age_min") is None and r.get("age_max") is None and AGE_IN_TEXT.search(text):
        f.append("대상 문장에 나이가 있는데 못 뽑음")
    lo, hi = extract_age(r.get("target_text"), r.get("criteria_text"))
    if text and (lo, hi) != (r.get("age_min"), r.get("age_max")):
        f.append(f"나이 규칙이 바뀌어 다시 받으면 {lo}~{hi}")
    if r.get("age_min") is not None or r.get("age_max") is not None:
        a, b = r.get("age_min") or 0, r.get("age_max") if r.get("age_max") is not None else 200
        if b < 20 or a > 39:
            f.append(f"나이 {r.get('age_min')}~{r.get('age_max')} — 20·30대 모두 제외")
    if HR.is_special(r):
        f.append("특정 대상: " + "·".join(r["target_groups"]))
    elif r.get("target_groups"):
        f.append("소득 기준(기본 카드에 나옴)")
    if not r.get("apply_text"):
        f.append("신청 방법 없음")
    if not r.get("contacts"):
        f.append("문의처 없음")
    if not (r.get("detail_url") or r.get("homepage")):
        f.append("링크 없음")
    if not r.get("summary"):
        f.append("요약 없음")
    return f


def short(s, n=60):
    s = re.sub(r"\s+", " ", s or "").strip()
    return s if len(s) <= n else s[:n - 1] + "…"


def build(rows):
    """(정책 표, 카드 표, 요약 줄) — 화면·CSV에 쓰는 것을 한곳에서 만든다(테스트용)"""
    names = Counter(r.get("name") for r in rows)
    prog = []
    for r in sorted(rows, key=lambda x: (x.get("source") or "", x.get("region_label") or "", x.get("name") or "")):
        fl = flags_of(r)
        if names[r.get("name")] > 1:
            fl.append(f"같은 이름 {names[r.get('name')]}개")
        prog.append({"serv_id": r["serv_id"], "구분": "지자체" if r.get("source") == "local" else "중앙부처",
                     "지역": r.get("region_label"), "이름": r.get("name"), "사업중": "예" if r.get("is_active", True) else "아니오",
                     "메뉴": ",".join(HR.MENU_LABEL.get(m, m) for m in (r.get("menus") or [])),
                     "관심주제": ",".join(r.get("themes") or []), "생애주기": ",".join(r.get("life_stages") or []),
                     "나이": "" if r.get("age_min") is None and r.get("age_max") is None else f"{r.get('age_min') or ''}~{r.get('age_max') or ''}",
                     "대상 문장": short(r.get("target_text"), 120), "살펴볼 점": " / ".join(fl)})
    cards = []
    lines = []
    for label, prof in PROFILES:
        for menu in HR.MENUS:
            c = HR.counts(rows, prof, menu)
            top = HR.recommend(rows, prof, menu, limit=6)
            sp = HR.recommend(rows, prof, menu, limit=10, special=True)
            for i, card in enumerate(top, 1):
                cards.append({"프로필": label, "메뉴": HR.MENU_LABEL[menu], "순서": i, "serv_id": card["serv_id"], "이름": card["name"],
                              "지역": card["region_label"], "나이 확인": "예" if card["age_note"] else "", "추천 이유": card["reason"]})
            for i, card in enumerate(sp, 1):
                cards.append({"프로필": label, "메뉴": HR.MENU_LABEL[menu], "순서": f"S{i}", "serv_id": card["serv_id"], "이름": card["name"],
                              "지역": card["region_label"], "나이 확인": "예" if card["age_note"] else "", "추천 이유": "특정 대상: " + "·".join(card["target_groups"])})
            lines.append(f"  {label} {HR.MENU_LABEL[menu]:<6} 맞음 {c['eligible']:>3} · 특정 대상 {c['special']:>2} · 자격 미달 {c['ineligible']:>3}"
                         f" | 1~3번: {' / '.join(short(t['name'], 22) for t in top[:3]) or '(없음 → 129 안내)'}")
    return prog, cards, lines


def write_csv(path, rows):
    if not rows:
        return
    with open(path, "w", encoding="utf-8-sig", newline="") as f:     # utf-8-sig: 엑셀에서 한글이 안 깨지게
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def main():
    import supabase_sync as S
    rows = S.client().select("welfare_programs", "select=" + COLUMNS + "&limit=5000") or []
    if not rows:
        raise SystemExit("welfare_programs가 비어 있습니다 — python haru_sync.py 를 먼저 실행하세요.")
    prog, cards, lines = build(rows)
    os.makedirs(OUT, exist_ok=True)
    write_csv(os.path.join(OUT, "check_programs.csv"), prog)
    write_csv(os.path.join(OUT, "check_cards.csv"), cards)

    active = [r for r in rows if r.get("is_active", True)]
    print(f"[하루 정책 검수] 전체 {len(rows)}건 (사업 중 {len(active)}) · 중앙부처 {sum(r.get('source') == 'central' for r in rows)}"
          f" · 지자체 {sum(r.get('source') == 'local' for r in rows)} · 마지막 동기화 {max((r.get('fetched_at') or '') for r in rows)[:16]}")
    menu_n = Counter(m for r in active for m in (r.get("menus") or []))
    print("  메뉴별(사업 중): " + " · ".join(f"{HR.MENU_LABEL[m]} {menu_n.get(m, 0)}" for m in HR.MENUS))
    fc = Counter(f.split(":")[0].split(" — ")[0] for p in prog for f in p["살펴볼 점"].split(" / ") if f)
    print("  살펴볼 점: " + (" · ".join(f"{k} {v}" for k, v in fc.most_common()) or "없음"))
    print("\n[시민에게 보일 카드]")
    print("\n".join(lines))
    print(f"\n저장: {os.path.join(OUT, 'check_programs.csv')}\n      {os.path.join(OUT, 'check_cards.csv')}")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
