# -*- coding: utf-8 -*-
"""⑨ 문서 초안 — 보고서·제안서 초안 생성 (reports 테이블 자리)"""
from datetime import date
import config as C


def build_report_markdown(scored_df, explained_df, priority_df, recommend_df, action_df, source="페르소나 기반 합성 데이터") -> str:
    merged = scored_df.merge(explained_df, on="cohort_id")
    n_total = len(merged)
    n_flagged = len(priority_df)
    level_counts = merged["risk_level"].value_counts().sort_index()

    lines = []
    lines.append(f"# 사회적 고립 위험 탐지 결과 보고서 (초안)")
    lines.append("")
    lines.append(f"- 산출일: {C.PERIOD_END.isoformat()} 기준 (관측기간 {C.PERIOD_START}~{C.PERIOD_END})")
    lines.append(f"- 모델 버전: `{C.MODEL_VERSION}`")
    lines.append(f"- 분석 단위: 지역×성별×연령대 코호트 (총 {n_total}개)")
    lines.append(f"- 입력 데이터: **{source}**")
    if "합성" in source and "실제" not in source:
        lines.append(f"- **이 문서는 페르소나 기반 합성 데이터로 만든 프로토타입 산출물이다.** "
                     f"실제 통신·카드 원자료가 아니라 대회 규칙이 허용한 가상데이터(synthetic data)로 "
                     f"파이프라인 동작을 시연한 것이며, 생성 방식은 `가상데이터_생성방식_설명자료.md`에 "
                     f"별도로 설명한다.")
    else:
        lines.append("- 등급은 코호트끼리의 **상대 순위**(분위수)다. 코호트가 적으면 실제 이상이 없어도 "
                     "상위 코호트가 '위험'으로 표시된다. 아래 입력 지표의 절대값을 함께 볼 것.")
    lines.append("")
    lines.append("## 1. 요약")
    lines.append("")
    lines.append(f"5단계 등급 분포: " + ", ".join(
        f"{C.RISK_LEVEL_LABELS[lv]}(Lv.{lv}) {level_counts.get(lv, 0)}개" for lv in [1, 2, 3, 4, 5]
    ))
    lines.append("")
    lines.append(f"주의(Lv.3) 이상으로 분류되어 담당자 개입 검토가 필요한 코호트는 총 **{n_flagged}개**다.")
    lines.append("")
    lines.append("## 2. 우선지원 대상 (Lv.3 이상, 점수 내림차순)")
    lines.append("")
    lines.append("| 순위 | 지역 | 성별 | 연령대 | 점수 | 등급 | 추정 원인 |")
    lines.append("|---|---|---|---|---:|---|---|")
    for _, r in priority_df.iterrows():
        lines.append(f"| {r['priority_rank']} | {r['region_name']} | {C.GENDER_LABEL[r['gender']]} | {r['age_group']} | "
                      f"{r['score']:.1f} | {r['risk_level_label']}(Lv.{r['risk_level']}) | {r['archetype_guess']} |")
    lines.append("")
    lines.append("## 3. 코호트별 상세 — 원인 분석 · 복지자원 추천 · 행동 제안")
    lines.append("")
    for _, r in priority_df.iterrows():
        cid = r["cohort_id"]
        lines.append(f"### {r['region_name']} · {C.GENDER_LABEL[r['gender']]} · {r['age_group']}  (등급: {r['risk_level_label']}, 점수 {r['score']:.1f})")
        lines.append("")
        lines.append(f"- **추정 원인**: {r['archetype_guess']}")
        micro_str = "null(표본부족)" if pd_isna(r["micro_signal"]) else f"{r['micro_signal']:.2f}"
        lines.append(f"- **입력 지표**: baseline_z={r['baseline_z']:.2f}, trigger_z={r['trigger_z']:.2f}, "
                      f"event_response={r['event_response']:.2f}, micro_signal={micro_str}")
        res = recommend_df[recommend_df["cohort_id"] == cid]
        if len(res):
            lines.append("- **추천 복지자원**(지역·연령 자격 필터 적용): " + ", ".join(
                f"{row['resource_name']}({row['provider']})" for _, row in res.iterrows()))
        act = action_df[action_df["cohort_id"] == cid]
        if len(act):
            lines.append(f"- **행동 제안**: {act.iloc[0]['action_text']}")
        lines.append("")

    lines.append("## 4. 방법론 요약")
    lines.append("")
    lines.append("- **분석 단위**: 개인 트래킹 불가 → 지역×성별×연령대 코호트(통합기획서 5장)")
    lines.append("- **시간 분할**: baseline(7/1~10/31 중 이벤트 제외, 113일) / event(4구간 18일) / "
                 "eval(11/1~12/23 중 이벤트 제외, 53일) — 데이터_분석근거_정리.md 12-7절")
    lines.append("- **이상탐지**: 요일별 중앙값 보정 → 29일 이동중앙값 추세제거 → MAD 기반 robust "
                 f"z-score(임계값 {C.ROBUST_Z_THRESHOLD}) — 같은 문서 12-1절")
    lines.append("- **거시·미시 결합**: 거시(통신+카드)를 주(主) 신호로, 미시(NPC 심리상담)를 보정 "
                 "신호로 결합(가중치: 통신 0.20/카드 0.30/이벤트반응 0.30/미시 0.20). 미시 신호가 "
                 "k-익명성 기준(세션 5건) 미달이면 거시 3개 지표로 재정규화해 산출(통합기획서 5-1절)")
    lines.append("- **등급화**: 종합점수(0~100)를 분위수(quintile) 기준 5단계로 구간화")
    lines.append("- **원인 분석**: 규칙 기반 기여도 분해 — 가중치×(subscore−50), 즉 중립 대비 점수를 끌어올린 양으로 비교. "
                 "최대 초과기여가 3점 미만이면 '뚜렷한 원인 없음(오탐 검토)'으로 분류하고 자원을 억지로 매칭하지 않는다. "
                 "SHAP 등 모델 기반 방식은 다음 단계 검토 항목(Open Item)")
    lines.append("- **안전 하한**: 미시 신호 z≥2.0이면 가중합과 무관하게 최소 Lv.3 — 명확한 심리 위험신호가 거시 지표에 희석되지 않게 함")
    lines.append("")
    lines.append("## 5. 한계 (반드시 함께 제출)")
    lines.append("")
    if "실제" not in source:
        lines.append("- 이 결과는 **페르소나 기반 합성 데이터**로 만든 프로토타입이다. 실제 위험도가 아니라 "
                     "파이프라인의 동작 시연이며, 실 데이터 적용 전까지 정책 판단에 사용해서는 안 된다.")
    lines.append("- 모든 지표는 코호트(집단) 수준이며, 개인 단위 해석은 생태학적 오류가 된다.")
    lines.append("- 카드 데이터는 오프라인 결제만 포함하므로 온라인 소비로의 대체는 관측되지 않는다.")
    lines.append("- 통신 데이터는 6개월 6개 시점뿐이라 계절성 판단이 근본적으로 제한적이다.")
    lines.append("- 이벤트 탐지 임계값(3.5), 거시·미시 결합 가중치, 미시 안전하한(z≥2.0)은 팀 확정 전 잠정값이다(Open Item).")
    lines.append("- 5단계를 분위수로 나누므로 실제 위험 코호트가 없어도 항상 상위 20%가 Lv.5가 된다. 합성 데이터 검증에서 "
                 "정상 코호트가 Lv.3 이상에 들어오는 오탐이 확인되었으며(validate.py), 절대 임계값 병행 여부를 결정해야 한다.")
    lines.append("- 복지자원 목록은 매칭 로직 시연용 예시다. 실제 신청 자격·마감은 각 사업 공고로 재확인해야 한다.")
    lines.append("")
    return "\n".join(lines)


def pd_isna(x):
    import pandas as pd
    return pd.isna(x)
