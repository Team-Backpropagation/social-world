# -*- coding: utf-8 -*-
"""
① 수집 — 거시 신호 합성 데이터 생성 (통신 월별 배경지표 + 카드 일별 트리거)

모든 파라미터의 출처를 코드 주석에 남긴다. 실제 대회 원자료의 컬럼·값이 아니라
"페르소나 기반 가상데이터"이며, 대회 규칙(주제설명자료 p.10)에 따라 생성 방식을
가상데이터_생성방식_설명자료.md 에 별도로 정리해 제출한다.
"""
from datetime import timedelta
import numpy as np
import pandas as pd

import config as C
from personas import build_persona_table

# 데이터_분석근거_정리.md 1-1절 실측치 그대로 — 2025년 7월 기준 코호트별 유동인구(단위: 만 명)
# 페르소나 코호트의 "출발점이 대회 데이터"여야 한다는 통합기획서 4-4의 원칙을 따른 것.
BASE_FLOW_MANMYEONG_JULY = {
    ("11680", "M", "10대"): 32.7, ("11680", "M", "20대"): 50.5, ("11680", "M", "30대"): 73.9,
    ("11680", "M", "40대"): 83.7, ("11680", "M", "50대"): 74.2, ("11680", "M", "60대이상"): 73.2,
    ("11680", "F", "10대"): 33.9, ("11680", "F", "20대"): 67.1, ("11680", "F", "30대"): 72.2,
    ("11680", "F", "40대"): 71.5, ("11680", "F", "50대"): 54.8, ("11680", "F", "60대이상"): 66.4,
    ("51110", "M", "10대"): 12.9, ("51110", "M", "20대"): 12.0, ("51110", "M", "30대"): 11.7,
    ("51110", "M", "40대"): 15.7, ("51110", "M", "50대"): 17.1, ("51110", "M", "60대이상"): 22.2,
    ("51110", "F", "10대"): 12.1, ("51110", "F", "20대"): 11.1, ("51110", "F", "30대"): 11.0,
    ("51110", "F", "40대"): 15.2, ("51110", "F", "50대"): 15.5, ("51110", "F", "60대이상"): 23.3,
}
# 데이터_분석근거_정리.md 2절 실측치 — 강남구 여성 20대 일평균 결제건수(카드 기준 스케일 앵커)
ANCHOR_CARD_DAILY = 227_830
ANCHOR_FLOW = BASE_FLOW_MANMYEONG_JULY[("11680", "F", "20대")]
# 6절 실측 변동계수 — 통신 4.3% / 카드 9.7% (코호트 CV, 정상 잡음 크기로 그대로 사용)
FLOW_CV = 0.043
CARD_CV = 0.097


def _date_range():
    days = (C.PERIOD_END - C.PERIOD_START).days + 1
    return [C.PERIOD_START + timedelta(days=i) for i in range(days)]


def _event_intensity_for_date(d):
    """해당 날짜가 이동성 이벤트 구간이면 (이벤트명, intensity 0~1)을, 아니면 None을 반환."""
    for ev in C.EVENT_PERIODS:
        if ev["start"] <= d <= ev["end"]:
            if d == C.CHUSEOK_PEAK_DATE:
                return ev["name"], 1.0
            return ev["name"], C.EVENT_INTENSITY_BY_NAME[ev["name"]]
    return None, None


def _region_event_multiplier(sgg_code, intensity):
    eff = C.EVENT_REGION_EFFECT[sgg_code]
    # intensity=0 -> 배율 1.0(무변화), intensity=1 -> min/max 배율(가장 강한 이탈)
    if eff["min_multiplier"] < 1.0:
        return 1.0 + (eff["min_multiplier"] - 1.0) * intensity
    return 1.0 + (eff["max_multiplier"] - 1.0) * intensity


def generate_flow_cohort_monthly(persona_table):
    """통신 유동인구 월별 — flow_cohort_monthly. 시간 해상도: 월(6포인트)."""
    rows = []
    for p in persona_table:
        key = (p["sgg_code"], p["gender"], p["age_group"])
        base = BASE_FLOW_MANMYEONG_JULY[key] * 10_000  # 명 단위로 환산
        rng = np.random.default_rng(C.stable_seed("flow", p["cohort_id"]))
        for i, ym in enumerate(C.MONTHS):
            level = base
            if p["archetype"] == "structurally_low":
                # 6개월간 완만히 더 낮아짐 — "급격한 단절이 아니라 구조적 저활동" 시그니처
                level *= (1 - 0.028) ** i
            # 그 외 원형은 통신 데이터에 뚜렷한 트렌드를 남기지 않음(발견 5: 통신=배경지표, 거의 평탄)
            noise = rng.normal(0, FLOW_CV)
            value = max(0.0, level * (1 + noise))
            rows.append({
                "sgg_code": p["sgg_code"], "region_name": p["region_name"],
                "gender": p["gender"], "age_group": p["age_group"],
                "cohort_id": p["cohort_id"], "std_ym": ym,
                "flow_pop": round(value),
            })
    return pd.DataFrame(rows)


def generate_card_cohort_daily(persona_table):
    """카드 결제 일별 — card_cohort_daily. 시간 해상도: 일(184포인트). 지표는 건수(USE_CNT) 기준
    (데이터_분석근거_정리.md 8절: 금액 기준은 세금공과금에 지배되어 폐기, 건수 채택)."""
    dates = _date_range()
    rows = []
    for p in persona_table:
        key = (p["sgg_code"], p["gender"], p["age_group"])
        flow_manmyeong = BASE_FLOW_MANMYEONG_JULY[key]
        base_daily = ANCHOR_CARD_DAILY * (flow_manmyeong / ANCHOR_FLOW) ** 0.6  # 인구 규모에 준해 스케일링
        rng = np.random.default_rng(C.stable_seed("card", p["cohort_id"]))
        dow_mult = C.DOW_MULTIPLIER[p["sgg_code"]]

        essential_decline_end = 0.65 if p["archetype"] == "essential_only" else 1.0
        n_days = len(dates)

        for i, d in enumerate(dates):
            level = base_daily
            level *= dow_mult[d.weekday()]

            if p["archetype"] == "essential_only":
                # 하반기로 갈수록 선택적 소비가 서서히 빠짐(전체 결제건수 완만한 우하향)
                frac = i / (n_days - 1)
                level *= (1 - frac) * 1.0 + frac * essential_decline_end

            if p["archetype"] == "structurally_low":
                level *= 0.85  # 원래부터 낮은 평탄선

            ev_name, intensity = _event_intensity_for_date(d)
            if ev_name is not None:
                region_mult = _region_event_multiplier(p["sgg_code"], intensity)
                if p["archetype"] == "event_unresponsive":
                    # H-A 핵심 시그니처: 지역 전체는 크게 흔들리지만 이 코호트는 거의 반응하지 않음
                    dampened = 1.0 + (region_mult - 1.0) * 0.12
                    level *= dampened
                else:
                    level *= region_mult

            noise = rng.normal(0, CARD_CV)
            value = max(0.0, level * (1 + noise))
            rows.append({
                "sgg_code": p["sgg_code"], "region_name": p["region_name"],
                "gender": p["gender"], "age_group": p["age_group"],
                "cohort_id": p["cohort_id"], "ta_ymd": d.isoformat(),
                "use_cnt": round(value),
            })
    return pd.DataFrame(rows)


if __name__ == "__main__":
    pt = build_persona_table()
    flow = generate_flow_cohort_monthly(pt)
    card = generate_card_cohort_daily(pt)
    print(flow.shape, card.shape)
    print(flow.head())
    print(card.head())
