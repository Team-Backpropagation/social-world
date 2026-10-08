# -*- coding: utf-8 -*-
"""개선본 ZIP의 청년 집계 CSV를 메모리에서 읽고, 원본을 변경하지 않고 분석 입력만 점검한다."""
import argparse
import json
from pathlib import Path
from zipfile import ZipFile

import pandas as pd

import pipeline as P
from real_youth import load_youth_master

MEMBER = "social-world-main-reviewed1036/social-world-main-improved/data_preprocessing/clean/youth_master_daily.csv"
HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description="EXP-001 기존 집계 자료 읽기 전용 점검")
    parser.add_argument("--zip", type=Path, default=Path.home() / "Downloads/social-world-main-reviewed1036.zip")
    parser.add_argument("--out", type=Path, default=HERE / "experiment_outputs/aggregate_readonly_summary.json")
    args = parser.parse_args()
    if not args.zip.is_file():
        raise SystemExit(f"개선본 ZIP을 찾지 못했습니다: {args.zip}")
    with ZipFile(args.zip) as archive:
        # ZipExtFile은 읽기 스트림이다. 집계 원본을 실험 폴더에 복사하지 않는다.
        with archive.open(MEMBER) as source:
            people, flow, card = load_youth_master(source)

    assert len(people) == 8 and len(card) == 1472 and len(flow) == 48
    assert not card.duplicated(["cohort_id", "ta_ymd"]).any()
    split = P.add_date_split_label(card)
    mismatch = int((split["split"] != split["split_source"]).sum())
    if mismatch:
        raise SystemExit(f"기존 입력과 실험 파이프라인의 날짜 구간이 {mismatch}행 다릅니다.")
    detected = P.detect_card_anomalies(split)
    event = P.compute_event_response(detected, people)
    trigger = P.compute_trigger_z(detected)
    baseline = P.compute_baseline_z(flow)
    base = pd.DataFrame(people).merge(baseline, on="cohort_id")
    micro = pd.DataFrame(columns=["cohort_id", "micro_signal", "avg_session_count"])
    scored = P.compute_scores(base, trigger, event, micro)

    # 개인 결과나 원본 행을 쓰지 않고, 비교 검토에 필요한 집계 요약만 저장한다.
    summary = {
        "source": "개선본 ZIP 안의 youth_master_daily.csv (읽기 전용)",
        "cohorts": len(people), "card_daily_rows": len(card), "flow_monthly_rows": len(flow),
        "first_date": str(card["ta_ymd"].min()), "last_date": str(card["ta_ymd"].max()),
        "split_mismatches": mismatch,
        "level_3_plus_cohorts": int((scored["risk_level"] >= 3).sum()),
        "max_abs_macro_z": round(float(scored[["baseline_z", "trigger_z", "event_response"]].abs().max().max()), 3),
        "note": "지역·성별·연령 집계의 상대 등급이며 개인 고립 판정이 아님. 원본 ZIP과 CSV는 수정하지 않음.",
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
