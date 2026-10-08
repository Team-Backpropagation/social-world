# -*- coding: utf-8 -*-
"""EXP-001 전용 합성 패턴 시험. 실행: python3 risk_agent/experiment_eval.py

기존 24코호트 검증 코드는 수정하지 않는다. 이 파일은 청년 8코호트에 같은
2025-07~12 날짜를 배정해, 별도 출력 폴더에서 심은 변화의 탐지·오탐을 기록한다.
"""
import argparse
import json
from pathlib import Path

import pandas as pd

import config as C
import pipeline as P
from synth_macro import generate_card_cohort_daily, generate_flow_cohort_monthly
from synth_micro import generate_npc_chat_metrics

HERE = Path(__file__).resolve().parent
SCENARIOS = ("normal", "macro", "micro")
SEEDS = (20260923, 20260928)
EXPECTED = {
    "essential_only": "trigger_z",
    "acute_card_drop": "trigger_z",
    "structurally_low": "baseline_z",
    "event_unresponsive": "event_response",
    "micro_flagged": "micro_signal",
}


def make_cases(scenario):
    """정답 라벨은 평가용으로만 보관한다. 채점 함수에는 라벨 컬럼을 전달하지 않는다."""
    people = [
        {**c, "archetype": "normal", "micro_eligible": True}
        for c in C.all_cohorts() if c["age_group"] in C.MICRO_ELIGIBLE_AGE_GROUPS
    ]
    if scenario == "macro":
        patterns = ("essential_only", "structurally_low", "event_unresponsive", "acute_card_drop")
        for person, pattern in zip(people[:4], patterns):
            person["planted_pattern"] = pattern
            # 급성 카드 하락만 생성 후 별도로 넣는다. 생성 함수는 이 원형을 모르기 때문이다.
            person["archetype"] = "normal" if pattern == "acute_card_drop" else pattern
    elif scenario == "micro":
        people[0]["archetype"] = "micro_flagged"
        people[0]["planted_pattern"] = "micro_flagged"
        # 음성 대조: 심각한 표현이 있어도 표본이 5회 미만이면 미시 지표가 가려져야 한다.
        people[1]["control_note"] = "small_sample_keywords"
    for person in people:
        person.setdefault("planted_pattern", "none")
        person.setdefault("control_note", "ordinary_variation")
    return people


def run_case(scenario, seed, root):
    # config.stable_seed가 이 값을 읽는다. 별도 프로세스나 스레드 없이 순서대로 실행한다.
    C.RNG_SEED = seed
    people = make_cases(scenario)
    flow = generate_flow_cohort_monthly(people)
    card = generate_card_cohort_daily(people)
    psych = generate_npc_chat_metrics(people)
    psych = psych[psych["measured_month"] == C.MONTHS[-1]].copy()

    if scenario == "macro":
        target = people[3]["cohort_id"]
        mask = (card["cohort_id"] == target) & (card["ta_ymd"].between("2025-11-01", "2025-12-23"))
        card.loc[mask, "use_cnt"] = (card.loc[mask, "use_cnt"] * 0.65).round().astype(int)
    if scenario == "micro":
        target = people[1]["cohort_id"]
        mask = psych["cohort_id"] == target
        psych.loc[mask, ["session_count", "risk_keyword_count", "severity_score"]] = [3, 12, 0.95]

    assert len(people) == 8 and len(card) == 1472 and len(flow) == 48 and len(psych) == 8
    # 기존 파이프라인 함수만 호출한다. 집계 자료/운영 DB 읽기·쓰기는 하지 않는다.
    split = P.add_date_split_label(card)
    detected = P.detect_card_anomalies(split)
    event = P.compute_event_response(detected, people)
    trigger = P.compute_trigger_z(detected)
    baseline = P.compute_baseline_z(flow)
    micro = P.compute_micro_signal(psych)
    scored = P.compute_scores(pd.DataFrame(people).drop(columns=["archetype", "planted_pattern", "control_note"]).merge(baseline, on="cohort_id"), trigger, event, micro)
    explained = P.explain_scores(scored)
    # 추천·우선순위·행동제안·환류도 수행해 분석 흐름이 중간에 끊기지 않는지 확인한다.
    recommendations = P.recommend_resources(scored, explained)
    priorities = P.build_priority_targets(scored, explained)
    P.build_action_suggestions(priorities, recommendations)
    feedback = P.build_feedback_payload(scored, explained)

    labels = pd.DataFrame(people)[["cohort_id", "planted_pattern", "control_note"]]
    results = labels.merge(scored[["cohort_id", "score", "risk_level", "baseline_z", "trigger_z", "event_response", "micro_signal"]], on="cohort_id")
    results = results.merge(explained[["cohort_id", "dominant_factor"]], on="cohort_id")
    results["detected"] = results["risk_level"] >= 3
    results["factor_match"] = results.apply(
        lambda r: r["dominant_factor"] == EXPECTED.get(r["planted_pattern"]), axis=1
    )
    results.insert(0, "seed", seed)
    results.insert(0, "scenario", scenario)

    case_dir = root / f"{scenario}_{seed}"
    case_dir.mkdir(parents=True, exist_ok=True)
    # 데이터 행의 수와 심은 패턴을 다시 확인할 수 있게 입력과 판정 결과를 분리 저장한다.
    flow.to_csv(case_dir / "flow_input.csv", index=False)
    card.to_csv(case_dir / "card_input.csv", index=False)
    psych.to_csv(case_dir / "psych_input.csv", index=False)
    results.to_csv(case_dir / "evaluation.csv", index=False)
    (case_dir / "feedback_preview.json").write_text(json.dumps(feedback, ensure_ascii=False, indent=2), encoding="utf-8")
    return results


def main():
    parser = argparse.ArgumentParser(description="EXP-001 청년 8코호트 합성 패턴 시험")
    parser.add_argument("--out", type=Path, default=HERE / "experiment_outputs")
    parser.add_argument("--smoke", action="store_true", help="정상 시나리오 1회만 실행해 연결 확인")
    args = parser.parse_args()
    runs = (("normal", SEEDS[0]),) if args.smoke else ((s, seed) for s in SCENARIOS for seed in SEEDS)
    results = pd.concat([run_case(s, seed, args.out) for s, seed in runs], ignore_index=True)
    positives = results[results["planted_pattern"] != "none"]
    controls = results[results["planted_pattern"] == "none"]
    summary = {
        "runs": int(results[["scenario", "seed"]].drop_duplicates().shape[0]),
        "cohort_cases": len(results),
        "input_rows": int(len(results) // 8 * 1528),
        "planted_detected": int(positives["detected"].sum()),
        "planted_total": len(positives),
        "factor_matched": int(positives["factor_match"].sum()),
        "controls_level_3_plus": int(controls["detected"].sum()),
        "controls_total": len(controls),
        "note": "합성 데이터에 심은 패턴 회수 시험. 실제 이용자의 고립 예측 성능이 아님.",
    }
    args.out.mkdir(parents=True, exist_ok=True)
    results.to_csv(args.out / "all_cases.csv", index=False)
    (args.out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"개별 입력·판정 기록: {args.out}")


if __name__ == "__main__":
    main()
