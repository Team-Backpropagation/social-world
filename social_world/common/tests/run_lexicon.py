# -*- coding: utf-8 -*-
"""
위험사전 예문 채점기 — validation/*.csv 를 사전으로 채점해 완료 기준(작업계획 5절)을 숫자로 낸다

  python social_world/common/tests/run_lexicon.py            보고만 (종료 코드 0)
  python social_world/common/tests/run_lexicon.py --strict   기준 미달이면 종료 코드 1

  ① 위기 놓침      위기 양성(strong·ambiguous 기대) 중 못 잡은 수 — 기준 0
  ② 위기 오탐      관용어 음성 예문의 오탐률(기록만), 그 밖의 음성 오탐 목록
  ③ 태그 정답률    태그별 재현율(기대 태그를 잡은 비율) — 기준 80% 이상
  ④ 근거          source가 없는데 draft도 아닌 항목 — 기준 0
  ⑤ Python·DB 일치 위기 여부가 DB 임시 검사 _haru_crisis(database/06_haru.sql)와 같은가 — Python의 ambiguous는 위기 쪽으로 친다
  ⑥ 개인정보      매처 결과에 원문이 없는가

예문은 팀이 직접 만든 가상 문장만 쓴다. 위기 예문 파일은 비공개(작업계획 6-1 ③).
"""
import csv
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
COMMON = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(COMMON))
sys.path.insert(0, COMMON)
import risk_check as RC  # noqa: E402

VALID = os.path.join(COMMON, "validation")
DB_SQL = os.path.join(ROOT, "database", "06_haru.sql")


def read_csv(name):
    with open(os.path.join(VALID, name), encoding="utf-8", newline="") as f:
        return [r for r in csv.DictReader(f) if (r.get("text") or "").strip()]


def db_crisis_regex(path=DB_SQL):
    """06_haru.sql 의 _haru_crisis() 정규식을 꺼낸다(PostgreSQL 없이 비교하려고)"""
    with open(path, encoding="utf-8") as f:
        sql = f.read()
    m = re.search(r"function public\._haru_crisis.*?~\s*'((?:[^']|'')*)'", sql, re.S)
    if not m:
        raise SystemExit(f"_haru_crisis 정규식을 찾지 못했다: {path}")
    return re.compile(m.group(1).replace("''", "'"))


def pct(a, b):
    return f"{a}/{b} ({a / b:.0%})" if b else "0/0 (예문 없음)"


def main(strict=False):
    lex = RC.Lexicon()
    fails = []
    crisis_rows, risk_rows = read_csv("crisis_cases.csv"), read_csv("risk_cases.csv")

    # ① ② 위기 --------------------------------------------------------------
    print("== ① 위기 놓침 · ② 위기 오탐 ==")
    pos = [r for r in crisis_rows if r["expected"] in ("strong", "ambiguous")]
    missed, grade_ok, idiom_neg, idiom_fp, other_fp = [], 0, 0, [], []
    for r in crisis_rows:
        got = lex.check(r["text"])["crisis"]
        exp = r["expected"] if r["expected"] in ("strong", "ambiguous") else None
        grade_ok += got == exp
        if exp and not got:
            missed.append(r)
        if not exp:
            if r["type"] == "관용어":
                idiom_neg += 1
                if got:
                    idiom_fp.append((r, got))
            elif got:
                other_fp.append((r, got))
    print(f"  위기 양성 탐지   {pct(len(pos) - len(missed), len(pos))}  — 기준 100%")
    for r in missed:
        print(f"    놓침: {r['text']}  (기대 {r['expected']})")
    print(f"  등급 일치        {pct(grade_ok, len(crisis_rows))}")
    print(f"  관용어 오탐률    {pct(len(idiom_fp), idiom_neg)}  — 기록")
    for r, got in idiom_fp + other_fp:
        print(f"    오탐({r['type']}): {r['text']}  → {got}")
    if missed:
        fails.append("① 위기 놓침")

    # ③ 태그 ------------------------------------------------------------------
    print("\n== ③ 태그 정답률 (재현율) ==")
    per_tag = {t: [0, 0, 0] for t in lex.tags}   # [기대, 맞음, 잘못 붙임]
    exact = k_ok = 0
    wrong = []
    for r in risk_rows:
        want = {t for t in (r["expected_tags"] or "").split(";") if t}
        res = lex.check(r["text"])
        got = set(res["tags"])
        for t in want:
            if t in per_tag:
                per_tag[t][0] += 1
                per_tag[t][1] += t in got
        for t in got - want:
            per_tag[t][2] += 1
        exact += got == want
        k_good = abs(res["K"] - float(r["expected_K"] or 0)) < 1e-9
        k_ok += k_good
        if got != want or not k_good:
            wrong.append((r, sorted(got), res["K"]))
    for t, (n, ok, extra) in per_tag.items():
        mark = "" if not n else ("  ✔" if ok / n >= 0.8 else "  ✘ 80% 미만")
        print(f"  {t:<8} {pct(ok, n)}  잘못 붙임 {extra}{mark}")
        if n and ok / n < 0.8:
            fails.append(f"③ {t} 정답률")
    print(f"  태그 묶음 일치   {pct(exact, len(risk_rows))}")
    print(f"  K 일치           {pct(k_ok, len(risk_rows))}")
    for r, got, k in wrong:
        print(f"    다름: {r['text']}  기대 [{r['expected_tags']}] {r['expected_K']} → {got} {k}")
    empty = [t for t, (n, _, _) in per_tag.items() if not n]
    if empty:
        print(f"  예문 없는 태그: {', '.join(empty)}")

    # ④ 근거 ------------------------------------------------------------------
    print("\n== ④ 근거 ==")
    no_src, drafts, total = [], 0, 0
    for name in ("crisis.json", "risk_tags.json"):
        with open(os.path.join(RC.LEXICON_DIR, name), encoding="utf-8") as f:
            for item in json.load(f)["items"]:
                total += 1
                drafts += item.get("status") == "draft"
                if not item.get("source") and item.get("status") != "draft":
                    no_src.append(item["id"])
    print(f"  항목 {total}개 · draft {drafts}개 · 근거 없는 확정 항목 {len(no_src)}개 {no_src or ''}")
    if no_src:
        fails.append("④ 근거")

    # ⑤ Python·DB -------------------------------------------------------------
    print("\n== ⑤ Python·DB 위기 여부 일치 (_haru_crisis) ==")
    db = db_crisis_regex()
    texts = [r["text"] for r in crisis_rows] + [r["text"] for r in risk_rows]
    diff = []
    for t in texts:
        py, dbv = lex.check(t)["crisis"] is not None, bool(db.search(t))
        if py != dbv:
            diff.append((t, py, dbv))
    print(f"  일치 {pct(len(texts) - len(diff), len(texts))}")
    for t, py, dbv in diff:
        print(f"    다름: {t}  Python {'위기' if py else '-'} / DB {'위기' if dbv else '-'}")
    if diff:
        print("  → crisis.json이 정본. DB 쪽은 사전이 채워진 뒤 SQL을 생성해 팀 DB에 다시 적용한다(작업계획 6-2)")
        fails.append("⑤ Python·DB 일치")

    # ⑥ 개인정보 --------------------------------------------------------------
    print("\n== ⑥ 개인정보 ==")
    leaked = [t for t in texts if t in repr(lex.check(t)) or RC.normalize(t) in repr(lex.check(t))]
    print(f"  결과에 원문이 남은 예문 {len(leaked)}개")
    if leaked:
        fails.append("⑥ 개인정보")

    print("\n== 결과 ==")
    print("  완료 기준 모두 충족" if not fails else "  미달: " + ", ".join(fails))
    return 1 if (strict and fails) else 0


if __name__ == "__main__":
    sys.exit(main(strict="--strict" in sys.argv))
