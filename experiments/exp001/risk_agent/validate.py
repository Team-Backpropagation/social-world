# -*- coding: utf-8 -*-
"""
검증 — 합성 데이터에 심어둔 원형(ground truth)을 파이프라인이 되찾는지 확인한다.

대회 최소 요구 성과물 "예측·분류 모델링 결과 — 성능 평가"에 대응하는 자리다.
단, 이 검증은 "우리가 심은 패턴을 우리 로직이 읽어내는가"만 보여준다(내적 타당성).
실제 고립 위험을 맞히는지(외적 타당성)는 실 데이터 + KOSIS 고독사 통계 대조로만 확인할 수 있다.

실행: python3 run_pipeline.py && python3 validate.py
"""
import os
import sys
import pandas as pd

from personas import ARCHETYPE_ASSIGNMENT

OUT = os.path.join(os.path.dirname(__file__), "outputs")
EXPECTED_FACTOR = {
    "event_unresponsive": "event_response",
    "essential_only": "trigger_z",
    "structurally_low": "baseline_z",
    "micro_flagged": "micro_signal",
}


def main():
    s = pd.read_csv(os.path.join(OUT, "risk_scores.csv"))
    f = pd.read_csv(os.path.join(OUT, "risk_factors.csv"))
    m = s.merge(f, on="cohort_id")
    m["planted"] = m["cohort_id"].map(ARCHETYPE_ASSIGNMENT).fillna("normal")

    planted = m[m["planted"] != "normal"]
    normal = m[m["planted"] == "normal"]

    detected = planted[planted["risk_level"] >= 3]
    cause_ok = planted[planted["dominant_factor"] == planted["planted"].map(EXPECTED_FACTOR)]
    lv5 = m[m["risk_level"] == 5]
    lv5_planted = lv5[lv5["planted"] != "normal"]

    print("=== 위험 탐지 에이전트 검증 (합성 데이터 원형 회수) ===")
    print(f"심어둔 원형 코호트: {len(planted)}개 / 정상 코호트: {len(normal)}개")
    print(f"[탐지 재현율] Lv.3 이상으로 잡힌 원형: {len(detected)}/{len(planted)}")
    print(f"[원인 일치율] 주요 기여 요인이 원형과 일치: {len(cause_ok)}/{len(planted)}")
    print(f"[Lv.5 정밀도] Lv.5 중 원형 코호트 비율: {len(lv5_planted)}/{len(lv5)}")
    print(f"[오탐] Lv.3 이상으로 올라간 정상 코호트: {(normal['risk_level'] >= 3).sum()}/{len(normal)}")
    print()
    print(planted[["cohort_id", "planted", "risk_level", "dominant_factor"]].to_string(index=False))
    print()
    print("참고: 5단계를 분위수로 나누므로 Lv.3 이상은 구조적으로 항상 약 14개(24개 중 60%)다.")
    print("      정상 코호트의 Lv.3+ 진입은 분위수 방식의 한계이며, 절대 임계값 방식 검토가 Open Item이다.")

    ok = len(detected) == len(planted) and len(cause_ok) == len(planted)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
