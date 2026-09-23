# -*- coding: utf-8 -*-
"""
위험 탐지 에이전트(6-6) 전체 파이프라인 실행 — ①~⑩ 단계를 순서대로 실행하고
outputs/ 에 DB 스키마(DB_테이블_정의서.md)와 최대한 맞춘 CSV + 보고서 + 환류 페이로드를 남긴다.

실행:
  python3 run_pipeline.py                                  # 합성 데이터(24개 코호트) → outputs/
  python3 run_pipeline.py --youth                          # 실제 청년 데이터(8개 코호트) → outputs_youth/
  python3 run_pipeline.py --youth --supabase               # + 소셜 월드 대화 신호 읽기 · 환류 쓰기(전체 순환)
                                                           # (경로 생략 시 youth_master_daily.csv 자동 탐색)
"""
import argparse
import json
import os

import pandas as pd

import config as C
from personas import build_persona_table
from synth_macro import generate_flow_cohort_monthly, generate_card_cohort_daily
from synth_micro import generate_npc_chat_metrics, generate_engagement_metrics
import pipeline as P
from report import build_report_markdown

HERE = os.path.dirname(os.path.abspath(__file__))


def parse_args():
    ap = argparse.ArgumentParser(description="위험 탐지 에이전트 파이프라인")
    ap.add_argument("--youth", metavar="CSV", nargs="?", const="auto",
                    help="실제 청년 데이터로 실행. 경로를 생략하면 youth_master_daily.csv를 주변 폴더에서 자동으로 찾음")
    ap.add_argument("--synthetic-micro", action="store_true",
                    help="실제 데이터 모드에서 소셜월드 미시신호를 합성값으로 붙임(기본: 미시신호 없이 거시만)")
    ap.add_argument("--supabase", action="store_true",
                    help="소셜 월드 실제 대화 신호를 Supabase에서 읽고, ⑩ 환류 결과를 Supabase에 씀(전체 순환). "
                         "--youth와 함께 사용. .env에 SUPABASE_URL·SUPABASE_SECRET_KEY 필요")
    ap.add_argument("--out", help="출력 폴더(기본: 합성=outputs, 청년=outputs_youth)")
    return ap.parse_args()


def find_youth_csv():
    """risk_agent를 SSTeamProject 바로 아래에 두든 preprocessing 안에 두든 찾을 수 있게 후보 경로를 차례로 본다."""
    name = "youth_master_daily.csv"
    candidates = [
        os.path.join(HERE, "..", "clean", name),                   # preprocessing/risk_agent/
        os.path.join(HERE, "..", "preprocessing", "clean", name),  # SSTeamProject/risk_agent/
        os.path.join(HERE, name),
        os.path.join(os.getcwd(), name),
    ]
    for c in candidates:
        if os.path.exists(c):
            return os.path.normpath(c)
    tried = "\n  ".join(os.path.normpath(c) for c in candidates)
    raise SystemExit(f"{name} 파일을 찾지 못했습니다. 아래 위치를 확인했습니다:\n  {tried}\n"
                     f"경로를 직접 주세요: python run_pipeline.py --youth <경로>")


def main():
    args = parse_args()
    if args.youth == "auto":
        args.youth = find_youth_csv()
        print(f"[입력] 청년 데이터 자동 탐색: {args.youth}")
    real = bool(args.youth)
    OUT = args.out or os.path.join(HERE, "outputs_youth" if real else "outputs")
    os.makedirs(OUT, exist_ok=True)

    # ① 수집
    if real:
        from real_youth import load_youth_master
        persona_table, flow_df, card_df = load_youth_master(args.youth)
        if args.supabase:
            import supabase_sync as S
            sb = S.client()
            psych_df, n_live = S.fetch_psych_metrics(sb, persona_table)
            engagement_df = pd.DataFrame()
            source = "실제 청년 데이터(통신·카드) + 소셜 월드 대화 신호(Supabase: 실제 대화 + 합성 배경)"
            if psych_df.empty:
                print("[경고] Supabase에 심리상담 대화 집계가 없습니다. 'python supabase_sync.py seed'로 배경을 먼저 적재하세요.")
            else:
                cur = sorted(psych_df["measured_month"].unique())[-1]
                live = psych_df[psych_df["measured_month"] == cur][["cohort_id", "session_count", "live_sessions"]]
                print(f"[1/10 수집] Supabase 대화 집계 {cur} — 코호트별 세션(실제 대화 수):")
                for _, r in live.iterrows():
                    print(f"            {r['cohort_id']:<14} {int(r['session_count']):>3}건 (실제 {int(r['live_sessions'])}건)")
        elif args.synthetic_micro:
            psych_df = generate_npc_chat_metrics(persona_table)
            engagement_df = generate_engagement_metrics(persona_table)
            source = "실제 청년 데이터(통신·카드) + 합성 미시신호"
        else:
            psych_df = pd.DataFrame(columns=["cohort_id", "measured_month", "session_count",
                                             "risk_keyword_count", "severity_score"])
            engagement_df = pd.DataFrame()
            source = "실제 청년 데이터(통신·카드), 미시신호 없음"
    else:
        persona_table = build_persona_table()
        flow_df = generate_flow_cohort_monthly(persona_table)
        card_df = generate_card_cohort_daily(persona_table)
        psych_df = generate_npc_chat_metrics(persona_table)
        engagement_df = generate_engagement_metrics(persona_table)
        source = "페르소나 기반 합성 데이터"
    print(f"[입력] {source} · 코호트 {len(persona_table)}개")
    print(f"[1/10 수집] flow={flow_df.shape} card={card_df.shape} psych={psych_df.shape} engagement={engagement_df.shape}")

    # ② 정합
    card_split = P.add_date_split_label(card_df)
    if "split_source" in card_split.columns:
        mism = (card_split["split"] != card_split["split_source"]).sum()
        if mism:
            raise ValueError(f"전처리 split과 파이프라인 split이 {mism}행 다릅니다 — config.EVENT_PERIODS 확인 필요")
        card_split = card_split.drop(columns="split_source")
        print("[2/10 정합] 전처리 산출물의 split 라벨과 1,472행 전부 일치 확인" if len(card_split) == 1472
              else "[2/10 정합] 전처리 산출물의 split 라벨과 전부 일치 확인")
    print(f"[2/10 정합] split 분포: {card_split['split'].value_counts().to_dict()}")

    # ③ 탐지
    detected = P.detect_card_anomalies(card_split)
    n_anom = (detected["robust_z"].abs() >= C.ROBUST_Z_THRESHOLD).sum()
    print(f"[3/10 탐지] robust_z 계산 완료. |z|>={C.ROBUST_Z_THRESHOLD} 인 코호트-일 조합: {n_anom}건")

    event_df = P.compute_event_response(detected, persona_table)
    trigger_df = P.compute_trigger_z(detected)
    baseline_df = P.compute_baseline_z(flow_df)
    micro_df = P.compute_micro_signal(psych_df)

    # 코호트 메타(지역명 등) 붙이기 위한 베이스 프레임
    persona_df = pd.DataFrame(persona_table)
    base_meta = persona_df.merge(baseline_df, on="cohort_id", how="left")

    # ④ 판단
    scored = P.compute_scores(base_meta, trigger_df, event_df, micro_df)
    print(f"[4/10 판단] 등급 분포: {scored['risk_level'].value_counts().sort_index().to_dict()}")

    # ⑤ 원인 분석
    explained = P.explain_scores(scored)
    print(f"[5/10 원인분석] 완료 — 예: {explained[explained['dominant_factor'].notna()].head(3)[['cohort_id','archetype_guess']].to_dict('records')}")

    # ⑥ 추천
    recommend = P.recommend_resources(scored, explained)
    print(f"[6/10 추천] 추천 레코드 {len(recommend)}건")

    # ⑦ 우선순위
    priority = P.build_priority_targets(scored, explained)
    print(f"[7/10 우선순위] Lv.3 이상 {len(priority)}개 코호트")

    # ⑧ 행동 제안
    actions = P.build_action_suggestions(priority, recommend)
    print(f"[8/10 행동제안] {len(actions)}건 생성")

    # ⑨ 문서 초안
    report_md = build_report_markdown(scored, explained, priority, recommend, actions, source=source)
    with open(os.path.join(OUT, "report_draft.md"), "w", encoding="utf-8") as f:
        f.write(report_md)
    print("[9/10 문서초안] report_draft.md 작성 완료")

    # ⑩ 환류
    feedback = P.build_feedback_payload(scored, explained)
    with open(os.path.join(OUT, "npc_feedback.json"), "w", encoding="utf-8") as f:
        json.dump(feedback, f, ensure_ascii=False, indent=2)
    print(f"[10/10 환류] 소셜월드 NPC 개인화 대상 {len(feedback)}개 코호트 → npc_feedback.json")
    # 대시보드용 대화 현황·위기 발화 (Supabase 모드에서만 실제 값)
    if real and args.supabase:
        micro = S.micro_detail(psych_df)
        escal = S.fetch_escalations(sb)
    else:
        micro, escal = {}, []
    with open(os.path.join(OUT, "micro_detail.json"), "w", encoding="utf-8") as f:
        json.dump(micro, f, ensure_ascii=False, indent=2)
    with open(os.path.join(OUT, "escalations.json"), "w", encoding="utf-8") as f:
        json.dump(escal, f, ensure_ascii=False, indent=2)
    if real and args.supabase:
        print(f"[대시보드] 위기 발화 최근 30일 {len(escal)}건 · 대화 현황 {len(micro)}개 코호트 저장")

    if real and args.supabase:
        S.push_feedback(sb, persona_table, feedback)
        print(f"[10/10 환류] Supabase cohort_feedback 갱신 완료 — 소셜 월드를 새로고침하면 반영됩니다")
        for cid, fb in feedback.items():
            print(f"            {cid:<14} → {fb['npc_emphasis']} NPC 강조, 미션: {', '.join(fb['priority_missions'])}")

    # ---- CSV 산출물 저장 (DB_테이블_정의서.md 스키마명에 최대한 맞춤) ----
    flow_df.to_csv(os.path.join(OUT, "flow_cohort_monthly.csv"), index=False)
    card_split.to_csv(os.path.join(OUT, "card_cohort_daily.csv"), index=False)
    psych_df.to_csv(os.path.join(OUT, "npc_chat_metrics.csv"), index=False)
    if len(engagement_df):
        engagement_df.to_csv(os.path.join(OUT, "engagement_metrics.csv"), index=False)

    risk_scores_cols = ["cohort_id", "sgg_code", "region_name", "gender", "age_group",
                         "scored_on", "score", "risk_level", "risk_level_label",
                         "baseline_z", "trigger_z", "event_response", "micro_signal",
                         "avg_session_count", "model_version"]
    scored[risk_scores_cols].to_csv(os.path.join(OUT, "risk_scores.csv"), index=False)

    risk_factors = scored[["cohort_id"]].merge(explained, on="cohort_id")
    risk_factors["factor_breakdown"] = risk_factors["factor_breakdown"].apply(json.dumps, ensure_ascii=False)
    risk_factors.to_csv(os.path.join(OUT, "risk_factors.csv"), index=False)

    recommend.to_csv(os.path.join(OUT, "resource_recommendations.csv"), index=False)
    priority.to_csv(os.path.join(OUT, "priority_targets.csv"), index=False)
    actions.to_csv(os.path.join(OUT, "action_suggestions.csv"), index=False)

    # 대시보드(브리핑용 Artifact)용 번들 JSON — 점수·우선순위·설명을 한 번에
    dashboard_payload = {
        "generated_at": C.PERIOD_END.isoformat(),
        "source": source,
        "model_version": C.MODEL_VERSION,
        "cohorts": json.loads(scored.drop(columns=["_contrib", "_weights_used"]).to_json(orient="records")),
        "priority": json.loads(priority.to_json(orient="records")),
        "actions": json.loads(actions.to_json(orient="records")),
        "recommend": json.loads(recommend.to_json(orient="records")),
        "explained": json.loads(explained.drop(columns=["factor_breakdown"]).to_json(orient="records")),
        "level_labels": C.RISK_LEVEL_LABELS,
    }
    with open(os.path.join(OUT, "dashboard_data.json"), "w", encoding="utf-8") as f:
        json.dump(dashboard_payload, f, ensure_ascii=False, indent=2)

    print(f"\n모든 산출물이 {OUT} 에 저장되었습니다.")


if __name__ == "__main__":
    main()
