# -*- coding: utf-8 -*-
"""
검증 — 기본 합성 데이터 1벌(outputs/)에서 판정기가 심어둔 원형을 찾고, 정상 집단에 경고하지 않는지 확인한다.

대회 최소 요구 성과물 "예측·분류 모델링 결과 — 성능 평가"에 대응하는 자리다.
단, 이 검증은 "우리가 심은 패턴을 우리 로직이 읽어내는가"만 보여준다(내적 타당성).
여러 seed·시나리오(전부 정상, 효과 크기, 교란, 독립 생성)로 본 결과는 evaluate.py와 docs/판단검증_결과.md.

성공 조건(둘 다 만족해야 exit 0):
  - 재현율: 원형 중 확인권장 ≥ MIN_RECALL
  - 오탐: 정상 집단 중 확인권장 ≤ MAX_FALSE_ALERT_RATE  ← 2026-10-09 추가(전에는 재현율만 봤다)

실행: python3 run_pipeline.py && python3 validate.py
"""
import os
import sys
import pandas as pd

from personas import ARCHETYPE_ASSIGNMENT

OUT = os.path.join(os.path.dirname(__file__), "outputs")
EXPECTED_FACTOR = {
    "event_unresponsive": "event_beta",
    "essential_only": "trigger_z",
    "structurally_low": "baseline_z",
    "micro_flagged": "micro_severity",
}
MIN_RECALL = 4 / 6             # structurally_low(원래부터 낮은 집단)는 자기 기준선 방식으로 못 찾는 것이 알려진 한계
MAX_FALSE_ALERT_RATE = 1 / 18  # 정상 18개 중 1개까지


def main():
    s = pd.read_csv(os.path.join(OUT, "risk_scores.csv"))
    f = pd.read_csv(os.path.join(OUT, "risk_factors.csv"))
    m = s.merge(f, on="cohort_id")
    m["planted"] = m["cohort_id"].map(ARCHETYPE_ASSIGNMENT).fillna("normal")

    planted = m[m["planted"] != "normal"]
    normal = m[m["planted"] == "normal"]
    tp = planted[planted["status"] == "check"]
    fp = normal[normal["status"] == "check"]
    tn = len(normal) - len(fp)
    cause_ok = tp[tp["dominant_factor"] == tp["planted"].map(EXPECTED_FACTOR)]

    recall = len(tp) / len(planted)
    false_rate = len(fp) / len(normal)
    print("=== 위험 탐지 에이전트 검증 (기본 합성 데이터 1벌) ===")
    print(f"심어둔 원형 {len(planted)}개 / 정상 {len(normal)}개 — '경고' = 확인권장")
    print(f"[혼동행렬]  원형: 확인권장 {len(tp)} · 아님 {len(planted) - len(tp)}   |   정상: 확인권장 {len(fp)} · 아님 {tn}")
    print(f"[재현율]   {len(tp)}/{len(planted)} = {recall:.1%}  (기준 ≥ {MIN_RECALL:.1%})")
    print(f"[특이도]   {tn}/{len(normal)} = {tn / len(normal):.1%}")
    print(f"[정밀도]   {len(tp)}/{len(tp) + len(fp)}" if len(tp) + len(fp) else "[정밀도]   경고 없음")
    print(f"[오탐률]   {len(fp)}/{len(normal)} = {false_rate:.1%}  (기준 ≤ {MAX_FALSE_ALERT_RATE:.1%})")
    print(f"[이유 일치] 확인권장 원형 중 주된 신호가 원형과 같음: {len(cause_ok)}/{len(tp)}")
    print()
    print(planted[["cohort_id", "planted", "status_label", "dominant_factor"]].to_string(index=False))
    print()
    print("참고: structurally_low는 '원래부터 낮은 평탄선'이라 자기 평소와 비교하면 변화가 작다. 변화관찰까지는 갈 수 있으나")
    print("      확인권장이 안 되는 것이 정상이며, 보고서에 '변화 없음 ≠ 고립 없음' 한계로 적는다.")

    ok = recall >= MIN_RECALL and false_rate <= MAX_FALSE_ALERT_RATE and len(cause_ok) == len(tp)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
