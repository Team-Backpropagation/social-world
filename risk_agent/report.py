# -*- coding: utf-8 -*-
"""⑨ 문서 초안 — 보고서·제안서 초안 생성 (reports 테이블 자리)"""
import pandas as pd

import config as C


def build_report_markdown(scored_df, explained_df, priority_df, recommend_df, action_df, source="페르소나 기반 합성 데이터") -> str:
    merged = scored_df.merge(explained_df, on="cohort_id")
    n_total = len(merged)
    counts = merged["status"].value_counts()
    n_check = int(counts.get("check", 0))
    n_watch = int(counts.get("watch", 0))
    J = C.JUDGMENT

    lines = []
    lines.append("# 집단 생활 활동 변화 점검 결과 (초안)")
    lines.append("")
    lines.append(f"- 판정에 쓴 자료의 마지막 날: {merged['scored_on'].iloc[0]} (관측기간 {C.PERIOD_START}~{C.PERIOD_END})")
    lines.append(f"- 모델 버전: `{C.MODEL_VERSION}`")
    lines.append(f"- 분석 단위: 지역×성별×연령대 코호트 (총 {n_total}개)")
    lines.append(f"- 입력 데이터: **{source}**")
    if "합성" in source and "실제" not in source:
        lines.append("- **이 문서는 페르소나 기반 합성 데이터로 만든 프로토타입 산출물이다.** "
                     "실제 통신·카드 원자료가 아니라 대회 규칙이 허용한 가상데이터(synthetic data)로 "
                     "파이프라인 동작을 시연한 것이며, 생성 방식은 `가상데이터_생성방식_설명자료.md`에 별도로 설명한다.")
    lines.append("- 이 결과는 **집단의 활동이 자기 평소와 얼마나 달라졌는가**를 본 것이다. 개인의 고립 여부를 판정한 것이 아니다.")
    lines.append("")
    lines.append("## 1. 요약")
    lines.append("")
    lines.append("상태 분포: " + ", ".join(f"{C.STATUS_LABELS[s]} {int(counts.get(s, 0))}개" for s in C.STATUS_ORDER))
    lines.append("")
    if n_check:
        lines.append(f"담당자가 확인할 집단(**확인권장**)은 **{n_check}개**, 지켜볼 집단(변화관찰)은 {n_watch}개다.")
    else:
        lines.append(f"확인 기준을 넘은 집단은 **없다**. 지켜볼 집단(변화관찰)은 {n_watch}개다. "
                     "기준을 넘은 집단이 없으면 경고도 내지 않는 것이 이 판정 방식의 정상 결과다.")
    lines.append("")
    lines.append("## 2. 확인 순서 (확인권장 먼저, 그다음 변화관찰)")
    lines.append("")
    if len(priority_df):
        lines.append("| 순서 | 지역 | 성별 | 연령대 | 상태 | 세기 | 이유 |")
        lines.append("|---|---|---|---|---|---:|---|")
        for _, r in priority_df.iterrows():
            lines.append(f"| {r['priority_rank']} | {r['region_name']} | {C.GENDER_LABEL[r['gender']]} | {r['age_group']} | "
                         f"{r['status_label']} | {r['score']:.0f} | {r['archetype_guess']} |")
    else:
        lines.append("해당 집단 없음.")
    lines.append("")
    lines.append("세기: 가장 강한 신호가 확인 기준선의 몇 배인지(기준선 = 50). 순서를 정할 때만 쓰며 위험 확률이 아니다.")
    lines.append("")
    lines.append("## 3. 집단별 상세 — 판정 이유 · 복지자원 추천 · 행동 제안")
    lines.append("")
    for _, r in priority_df.iterrows():
        cid = r["cohort_id"]
        lines.append(f"### {r['region_name']} · {C.GENDER_LABEL[r['gender']]} · {r['age_group']}  ({r['status_label']})")
        lines.append("")
        lines.append(f"- **판정 이유**: {r['archetype_guess']}")
        lines.append(f"- **신호 값**: {r['reason']}")
        res = recommend_df[recommend_df["cohort_id"] == cid]
        if len(res):
            lines.append("- **추천 복지자원**(지역·연령 자격 필터 적용): " + ", ".join(
                f"{row['resource_name']}({row['provider']})" for _, row in res.iterrows()))
        act = action_df[action_df["cohort_id"] == cid]
        if len(act):
            lines.append(f"- **행동 제안**: {act.iloc[0]['action_text']}")
        lines.append("")

    lines.append("## 4. 판정 방법")
    lines.append("")
    lines.append("- **분석 단위**: 개인 추적 불가 → 지역×성별×연령대 코호트(통합기획서 5장)")
    lines.append("- **시간 분할**: baseline(7/1~10/31 중 이벤트 제외) / event(달력 공휴일 등) / eval(11/1~12/23 중 이벤트 제외)")
    lines.append("- **혼자 기준선**: 각 집단을 다른 집단과 줄 세우지 않고 **자기 평소(baseline)와만** 비교한다. "
                 "'나를 뺀 지역 나머지 전체'(전 연령)의 같은 기간 변화(계절·날씨 등)는 빼고 본다.")
    lines.append(f"- **카드 결제**: 요일 보정 후 eval 수준이 평소 하루 흔들림의 몇 배 낮아졌나. "
                 f"관찰 {J['card']['observe']}배, 확인 {J['card']['alert']}배 + 기준을 넘은 주 {J['card']['persist_weeks']}주 이상 "
                 f"+ 실제 감소 {J['card']['min_drop_alert']:.0%} 이상")
    lines.append(f"- **유동인구(월별)**: 평소 월 흔들림의 몇 배 낮아졌나. 관찰 {J['flow']['observe']}배(이후 달 모두), "
                 f"확인 {J['flow']['alert']}배. 월 6점뿐인 배경 신호라 **혼자서는 확인권장이 되지 않는다**")
    lines.append(f"- **명절 동조도 β**: 달력 공휴일에 지역이 움직인 만큼 이 집단도 움직였나(1=같이, 0=무반응). "
                 f"관찰 {J['event']['observe']} 이하, 확인 {J['event']['alert']} 이하 + 판정 가능한 명절 {J['event']['min_blocks']}개 이상에서 모두 낮음 "
                 f"+ 자기 자신의 명절 움직임이 평소 흔들림의 {J['event']['max_own_move']}배 이하(반대로 크게 움직인 것은 무반응이 아님)")
    lines.append(f"- **대화 심각도**: 루미 판정과 같은 절대 기준. 관찰 {J['micro']['observe']}, "
                 f"확인 {J['micro']['strong']} 또는 최근 {J['micro']['window_months']}개월 중 {J['micro']['persist_months']}개월 이상 관찰 기준 초과")
    lines.append("- **상태**: 확인 기준을 넘은 신호가 있으면 확인권장, 관찰 기준만 넘었으면 변화관찰, 아니면 평소범위, "
                 "카드 자료가 부족하면 판단보류")
    lines.append("- **검증**: `evaluate.py` 시나리오 9종 × 평가용 seed 20개(임계값을 고른 seed와 분리). 결과는 `docs/판단검증_결과.md`")
    lines.append("")
    lines.append("## 5. 한계 (반드시 함께 제출)")
    lines.append("")
    if "실제" not in source:
        lines.append("- 이 결과는 **페르소나 기반 합성 데이터**로 만든 프로토타입이다. 실제 위험도가 아니라 "
                     "파이프라인의 동작 시연이며, 실 데이터 적용 전까지 정책 판단에 사용해서는 안 된다.")
    lines.append("- 모든 지표는 코호트(집단) 수준이며, 개인 단위로 해석하면 생태학적 오류가 된다.")
    lines.append("- **원래부터 활동이 낮고 최근 변화가 없는 집단은 찾지 못한다.** 자기 평소와 비교하는 방식의 구조적 한계다. "
                 "'변화 없음'을 '고립 없음'으로 읽지 말 것.")
    lines.append("- 카드 데이터는 오프라인 결제만 포함하므로 온라인 소비로의 대체는 관측되지 않는다.")
    lines.append("- 통신 데이터는 6개월 6개 시점뿐이라 단독 판정에 쓰지 않는다.")
    lines.append("- 명절 동조도는 판정 가능한 명절이 두 번 지나야 확인권장이 된다(한 번으로는 우연과 구분이 어렵다).")
    lines.append("- 판정 기준값은 합성 시나리오로 고른 잠정값이다. 실제 고립 정답이 없어 실제 판별 정확도는 알 수 없다.")
    lines.append("- 복지자원 목록은 매칭 로직 시연용 예시다. 실제 신청 자격·마감은 각 사업 공고로 재확인해야 한다.")
    lines.append("")
    return "\n".join(lines)


def pd_isna(x):
    return pd.isna(x)
