# -*- coding: utf-8 -*-
"""
판단 검증용 시나리오 묶음 — "시험지"

각 시나리오는 합성 데이터 한 벌과 정답표(코호트 → 'normal' 또는 원형 이름)를 만든다.
evaluate.py가 이 데이터를 판정기에 넣고 정답표와 비교해 혼동행렬을 낸다.

| 이름                | 내용                                         | 정답                    |
|---------------------|----------------------------------------------|-------------------------|
| S0_all_normal       | 원형 0개                                     | 전부 normal             |
| S1_default          | 기존 원형 6개(personas.ARCHETYPE_ASSIGNMENT) | 원형 6 / normal 18      |
| S2_strong/medium/weak | 원형 6개, 효과 크기만 강·중·약             | 원형 6 / normal 18      |
| S3_one_day_dip      | 정상 6개에 eval 중 하루짜리 급감             | 전부 normal(경고 X)     |
| S3_short_dip        | 정상 6개에 eval 중 1주짜리 급감              | 전부 normal(경고 X)     |
| S3_region_common    | 강남 전체가 eval에 같이 감소(계절·날씨)      | 전부 normal(경고 X)     |
| S5_independent      | 탐지기 가정과 다른 모양으로 심은 위험 6개    | 위험 6 / normal 18      |
| S6_youth_mixed      | 청년 8개만 판정. 춘천 20대는 학기 중 +25%, 명절엔 귀성으로 −40%(반대로 움직임). 지역 기준 = 전 연령 합계 | 전부 normal(경고 X) |
| S6_youth_mixed_noref| 같은 데이터, 지역 기준 없이 청년끼리만 비교(10/9 실데이터에서 생긴 문제 재현용, ALL_SCENARIOS에 없음) | 전부 normal |

S5는 생성 규칙이 판정 규칙과 같은 모양이면 "심은 걸 다시 찾는" 순환 검증이 되는 문제를 줄이려고 둔다
(계단형 감소, eval 중반에 시작하는 감소, 명절에 자기 평소값으로 머무는 무반응).

seed는 config.RNG_SEED를 바꿔서 돌린다. 원래 값은 끝나면 되돌린다.
"""
from contextlib import contextmanager
from datetime import date, timedelta

import numpy as np
import pandas as pd

import config as C
from personas import ARCHETYPE_ASSIGNMENT
from synth_macro import generate_flow_cohort_monthly, generate_card_cohort_daily
from synth_micro import generate_npc_chat_metrics

EFFECT_LEVELS = {
    "strong": dict(C.SYNTH_EFFECTS),
    "medium": {**C.SYNTH_EFFECTS, "essential_decline_end": 0.80, "event_dampening": 0.35,
               "structural_monthly_decline": 0.018, "structural_card_level": 0.90,
               "micro_severity_rise": 0.30, "micro_keyword_rise": 1.4},
    "weak": {**C.SYNTH_EFFECTS, "essential_decline_end": 0.90, "event_dampening": 0.60,
             "structural_monthly_decline": 0.010, "structural_card_level": 0.95,
             "micro_severity_rise": 0.18, "micro_keyword_rise": 0.8},
}

# 교란·독립 생성에 쓰는 코호트(원형이 없는 정상 코호트 중에서 고정)
PERTURB_COHORTS = ["11680-M-30대", "11680-F-40대", "11680-F-50대", "51110-M-20대", "51110-F-40대", "51110-M-50대"]


@contextmanager
def _seed_and_effects(seed, effects=None):
    old_seed, old_eff = C.RNG_SEED, dict(C.SYNTH_EFFECTS)
    C.RNG_SEED = seed
    if effects:
        C.SYNTH_EFFECTS.clear()
        C.SYNTH_EFFECTS.update(effects)
    try:
        yield
    finally:
        C.RNG_SEED = old_seed
        C.SYNTH_EFFECTS.clear()
        C.SYNTH_EFFECTS.update(old_eff)


def _persona_table(assignment):
    table = []
    for c in C.all_cohorts():
        table.append({**c, "archetype": assignment.get(c["cohort_id"], "normal"),
                      "micro_eligible": c["age_group"] in C.MICRO_ELIGIBLE_AGE_GROUPS})
    return table


def _generate(seed, assignment, effects=None):
    with _seed_and_effects(seed, effects):
        pt = _persona_table(assignment)
        flow = generate_flow_cohort_monthly(pt)
        card = generate_card_cohort_daily(pt)
        psych = generate_npc_chat_metrics(pt)
    labels = {p["cohort_id"]: p["archetype"] for p in pt}
    return {"persona_table": pt, "flow": flow, "card": card, "psych": psych, "labels": labels}


def _eval_dates():
    d, out = C.EVAL_START, []
    while d <= C.EVAL_END:
        out.append(d)
        d += timedelta(days=1)
    return out


def _scale(card, cohort_id, dates, factor):
    iso = {d.isoformat() for d in dates}
    m = (card["cohort_id"] == cohort_id) & card["ta_ymd"].isin(iso)
    card.loc[m, "use_cnt"] = (card.loc[m, "use_cnt"] * factor).round().astype("int64")


def scenario(name, seed):
    """시나리오 이름과 seed로 데이터 한 벌과 정답표를 만든다."""
    if name == "S0_all_normal":
        return _generate(seed, {})
    if name == "S1_default":
        return _generate(seed, ARCHETYPE_ASSIGNMENT)
    if name.startswith("S2_"):
        return _generate(seed, ARCHETYPE_ASSIGNMENT, EFFECT_LEVELS[name[3:]])

    rng = np.random.default_rng(seed)
    evd = _eval_dates()
    if name == "S3_one_day_dip":
        s = _generate(seed, {})
        for cid in PERTURB_COHORTS:
            _scale(s["card"], cid, [evd[int(rng.integers(len(evd)))]], 0.5)
        return s
    if name == "S3_short_dip":
        s = _generate(seed, {})
        for cid in PERTURB_COHORTS:
            start = int(rng.integers(0, len(evd) - 7))
            _scale(s["card"], cid, evd[start:start + 7], 0.6)
        return s
    if name == "S3_region_common":
        s = _generate(seed, {})
        for p in s["persona_table"]:
            if p["sgg_code"] == "11680":
                _scale(s["card"], p["cohort_id"], evd, 0.85)
                m = (s["flow"]["cohort_id"] == p["cohort_id"]) & s["flow"]["std_ym"].isin(["2025-11", "2025-12"])
                s["flow"].loc[m, "flow_pop"] = (s["flow"].loc[m, "flow_pop"] * 0.95).round().astype("int64")
        return s
    if name == "S5_independent":
        s = _generate(seed, {})
        a, b, c, d, e, f = PERTURB_COHORTS
        # 계단형: 11/15부터 25% 낮은 수준으로 뚝 떨어져 유지
        step = [x for x in evd if x >= date(2025, 11, 15)]
        for cid in (a, d):
            _scale(s["card"], cid, step, 0.75)
            s["labels"][cid] = "indep_step"
        # 늦게 시작하는 감소: eval 동안 0% → 35% 선형 하락
        for cid in (b, e):
            for i, x in enumerate(evd):
                _scale(s["card"], cid, [x], 1 - 0.35 * i / (len(evd) - 1))
            s["labels"][cid] = "indep_late_decline"
        # 명절 무반응: 달력 공휴일 구간 값을 그 코호트의 직전 4주 중앙값(요일 무시)으로 바꿈
        for cid in (c, f):
            g = s["card"][s["card"]["cohort_id"] == cid]
            for ev in C.EVENT_PERIODS:
                if not ev.get("calendar", True):
                    continue
                pre = g[(g["ta_ymd"] < ev["start"].isoformat()) &
                        (g["ta_ymd"] >= (ev["start"] - timedelta(days=28)).isoformat())]["use_cnt"].median()
                days = [ev["start"] + timedelta(days=k) for k in range((ev["end"] - ev["start"]).days + 1)]
                iso = {x.isoformat() for x in days}
                m = (s["card"]["cohort_id"] == cid) & s["card"]["ta_ymd"].isin(iso)
                s["card"].loc[m, "use_cnt"] = (pre * rng.normal(1, C_CARD_NOISE, m.sum())).round().astype("int64")
            s["labels"][cid] = "indep_event_flat"
        return s
    if name.startswith("S6_youth_mixed"):
        # 2026-10-09 실데이터 점검에서 드러난 상황: 같은 지역 청년 집단이 서로 반대로 움직인다
        s = _generate(seed, {})
        term = [x for x in _all_dates() if date(2025, 9, 1) <= x <= date(2025, 12, 20)]
        leave = [x for e in C.EVENT_PERIODS if e["name"] != "광복절"
                 for x in _all_dates() if e["start"] <= x <= e["end"]]
        for cid in ("51110-M-20대", "51110-F-20대"):
            _scale(s["card"], cid, [x for x in term if x not in leave], 1.25)   # 학기 중 학생 복귀
            _scale(s["card"], cid, leave, 0.6)                                 # 명절·연말 귀성
        region_ref = (s["card"].groupby(["sgg_code", "ta_ymd"], as_index=False)["use_cnt"].sum()
                        .rename(columns={"use_cnt": "region_cnt"}))            # 전 연령 24개 합계
        keep = {p["cohort_id"] for p in s["persona_table"] if p["age_group"] in C.MICRO_ELIGIBLE_AGE_GROUPS}
        s["persona_table"] = [p for p in s["persona_table"] if p["cohort_id"] in keep]
        for k in ("card", "flow", "psych"):
            s[k] = s[k][s[k]["cohort_id"].isin(keep)].reset_index(drop=True)
        s["labels"] = {cid: "normal" for cid in keep}
        s["region_ref"] = None if name.endswith("noref") else region_ref
        return s
    raise ValueError(f"알 수 없는 시나리오: {name}")


def _all_dates():
    d, out = C.PERIOD_START, []
    while d <= C.PERIOD_END:
        out.append(d)
        d += timedelta(days=1)
    return out


C_CARD_NOISE = 0.097   # synth_macro.CARD_CV와 같은 잡음 크기

ALL_SCENARIOS = ["S0_all_normal", "S1_default", "S2_strong", "S2_medium", "S2_weak",
                 "S3_one_day_dip", "S3_short_dip", "S3_region_common", "S5_independent", "S6_youth_mixed"]
TUNE_SEEDS = list(range(1, 11))          # 임계값을 고를 때만 쓴다
EVAL_SEEDS = list(range(101, 121))       # 성적은 이 seed로만 보고한다
