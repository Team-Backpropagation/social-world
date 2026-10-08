# -*- coding: utf-8 -*-
"""
위험 탐지 에이전트(6-6) — ②~⑩ 단계 구현

① 수집은 synth_macro.py / synth_micro.py 가 담당한다(합성 데이터 생성 = 실서비스의
"대회 제공 데이터 적재"를 대신하는 자리). 이 파일은 그 이후 단계만 구현한다.

각 함수의 docstring에 대응하는 통합기획서 6-6절 단계 번호와, 방법론의 출처 문서를 명시한다.
"""
from datetime import date
import numpy as np
import pandas as pd

import config as C
from welfare_catalog import match_resources


# ------------------------------------------------------------------
# ② 정합 — 코호트 축 정렬 + 시간 해상도 정렬
# ------------------------------------------------------------------
def add_date_split_label(card_df: pd.DataFrame) -> pd.DataFrame:
    """일별 카드 데이터에 baseline/event/eval 라벨을 붙인다.
    출처: 데이터_분석근거_정리.md 12-7절 3분할 확정안, 데이터_전처리_가이드맵.md 2-2절.
    """
    df = card_df.copy()
    df["ta_ymd"] = pd.to_datetime(df["ta_ymd"]).dt.date

    def label(d):
        for ev in C.EVENT_PERIODS:
            if ev["start"] <= d <= ev["end"]:
                return "event"
        if C.PERIOD_START <= d <= C.BASELINE_END:
            return "baseline"
        if C.EVAL_START <= d <= C.EVAL_END:
            return "eval"
        return "event"  # 12/24~12/31처럼 eval 이후 event 블록에 걸리는 나머지 날짜

    df["split"] = df["ta_ymd"].apply(label)
    return df


# ------------------------------------------------------------------
# ③ 탐지 — 평상시 대비 이탈·급변 (요일보정 → 추세제거 → robust z-score)
#    출처: 데이터_분석근거_정리.md 12-1절 방법을 코호트 단위로 그대로 적용
# ------------------------------------------------------------------
def detect_card_anomalies(card_df: pd.DataFrame) -> pd.DataFrame:
    df = card_df.sort_values(["cohort_id", "ta_ymd"]).copy()
    df["dow"] = pd.to_datetime(df["ta_ymd"]).dt.weekday

    out_frames = []
    for cohort_id, g in df.groupby("cohort_id"):
        g = g.sort_values("ta_ymd").reset_index(drop=True)
        base = g[g["split"] == "baseline"]

        # 1) 요일 효과 제거 — 요일별 중앙값 배율(중앙값 사용 이유: 명절이 섞여도 안 끌려감, 12-1절)
        overall_median = base["use_cnt"].median() if len(base) else g["use_cnt"].median()
        dow_median = base.groupby("dow")["use_cnt"].median() if len(base) else g.groupby("dow")["use_cnt"].median()
        dow_mult = (dow_median / overall_median).reindex(range(7)).fillna(1.0)
        g["dow_mult"] = g["dow"].map(dow_mult)
        g["dow_corrected"] = g["use_cnt"] / g["dow_mult"].replace(0, np.nan)

        # 2) 추세 제거 — 29일 이동 중앙값(평균이 아니라 중앙값: 창 안 명절이 기준선을 안 휘게 함)
        g["trend"] = g["dow_corrected"].rolling(
            window=C.TREND_WINDOW_DAYS, center=True, min_periods=10
        ).median()
        g["trend"] = g["trend"].bfill().ffill()
        g["resid_ratio"] = g["dow_corrected"] / g["trend"] - 1.0

        # 3) MAD 기반 robust z-score — baseline 구간의 분포만으로 기준(median, MAD) 산정
        base_resid = g.loc[g["split"] == "baseline", "resid_ratio"]
        med_b = base_resid.median()
        mad_b = (base_resid - med_b).abs().median()
        mad_b_safe = mad_b if mad_b > 1e-9 else 1e-9
        g["robust_z"] = (g["resid_ratio"] - med_b) / (C.MAD_SCALE * mad_b_safe)

        out_frames.append(g)

    return pd.concat(out_frames, ignore_index=True)


def compute_event_response(detected_df: pd.DataFrame, persona_table) -> pd.DataFrame:
    """이벤트 구간 반응도 — 12-4·12-5절의 "지역 간 격차" 아이디어를 코호트 단위로 확장.
    같은 지역 내 동료 코호트 평균 반응 크기 대비 얼마나 "무반응"했는지를 계산한다(H-A 시그니처).
    부호 규약: 값이 클수록(=동료보다 덜 반응할수록) 위험 방향(+).
    """
    ev = detected_df[detected_df["split"] == "event"].copy()
    magnitude = ev.groupby("cohort_id")["robust_z"].apply(lambda s: s.abs().mean()).rename("event_magnitude")
    magnitude = magnitude.reset_index()
    magnitude = magnitude.merge(
        pd.DataFrame(persona_table)[["cohort_id", "sgg_code"]], on="cohort_id", how="left"
    )

    rows = []
    for sgg, g in magnitude.groupby("sgg_code"):
        region_mean = g["event_magnitude"].mean()
        region_std = g["event_magnitude"].std(ddof=0)
        region_std_safe = region_std if region_std > 1e-9 else 1e-9
        for _, r in g.iterrows():
            event_response = (region_mean - r["event_magnitude"]) / region_std_safe
            rows.append({"cohort_id": r["cohort_id"], "event_response": event_response,
                          "event_magnitude": r["event_magnitude"]})
    return pd.DataFrame(rows)


def compute_trigger_z(detected_df: pd.DataFrame) -> pd.DataFrame:
    """카드 트리거 신호 — baseline 구간 대비 eval 구간의 **평균 수준(level) 변화**를 표준화한다.

    주의: 29일 이동중앙값 추세제거는 "하루 이틀의 급변"은 잘 잡아내지만, 몇 달에 걸친 완만한
    우하향(선택적 소비 위축형·H-B의 시그니처)은 추세 자체에 흡수되어 잔차(resid_ratio)에는
    거의 남지 않는다. 그래서 트리거 신호는 잔차의 평균이 아니라, 요일보정된 값의 baseline 평균과
    eval 평균을 직접 비교하는 수준비교(level comparison) 방식으로 계산한다 — 급변은 ③의 robust_z로,
    완만한 추세 하락은 여기서 함께 잡아내는 이중 구조다.
    부호 규약: eval 평균이 baseline 평균보다 낮을수록 양(+)의 값(위험 방향).
    """
    rows = []
    for cohort_id, g in detected_df.groupby("cohort_id"):
        base_vals = g.loc[g["split"] == "baseline", "dow_corrected"]
        eval_vals = g.loc[g["split"] == "eval", "dow_corrected"]
        mean_b, std_b = base_vals.mean(), base_vals.std(ddof=0)
        std_b_safe = std_b if std_b > 1e-9 else 1e-9
        mean_e = eval_vals.mean()
        trigger_z = (mean_b - mean_e) / std_b_safe
        rows.append({"cohort_id": cohort_id, "trigger_z": trigger_z})
    return pd.DataFrame(rows)


def compute_baseline_z(flow_df: pd.DataFrame) -> pd.DataFrame:
    """통신 배경지표 — 6개월 추세(첫 2개월 평균 → 마지막 2개월 평균 변화량)를
    코호트 자체의 6개월 표준편차로 표준화. 부호 규약: 하락할수록 양(+)의 값(위험 방향).
    출처: 데이터_분석근거_정리.md 5절 — 통신은 변동성이 작아(CV 4.3%) 절대수준보다
    "자기 자신 대비 추세"로 봐야 함을 근거로, 코호트 간 비교가 아니라 코호트 내 시간
    변화를 쓴다(같은 문서 9절 원칙 10).
    """
    rows = []
    for cohort_id, g in flow_df.sort_values("std_ym").groupby("cohort_id"):
        vals = g["flow_pop"].to_numpy(dtype=float)
        early = vals[:2].mean()
        late = vals[-2:].mean()
        std = vals.std(ddof=0)
        std_safe = std if std > 1e-9 else 1e-9
        baseline_z = -(late - early) / std_safe
        rows.append({"cohort_id": cohort_id, "baseline_z": baseline_z})
    return pd.DataFrame(rows)


def compute_micro_signal(psych_df: pd.DataFrame) -> pd.DataFrame:
    """미시 신호 — 심리상담 NPC 위험 키워드 빈출도·심각도(6-4절 핵심 미시 신호).
    표본 부족(k-익명성 미달) 코호트는 micro_signal = NaN으로 남긴다(risk_scores.micro_signal
    이 null을 허용하는 설계, DB_테이블_정의서.md 4-2절과 동일한 원칙).
    """
    if psych_df.empty:
        return pd.DataFrame(columns=["cohort_id", "micro_signal", "avg_session_count"])

    # 데이터에 있는 가장 최근 N개월 — 합성 모드는 2025년, Supabase 모드는 서비스 운영 중인 현재 달
    months = sorted(psych_df["measured_month"].astype(str).unique())[-C.MICRO_RECENT_MONTHS:]
    recent = psych_df[psych_df["measured_month"].astype(str).isin(months)].copy()
    recent["keyword_rate"] = recent["risk_keyword_count"] / recent["session_count"].replace(0, np.nan)
    agg = recent.groupby("cohort_id").agg(
        severity_score=("severity_score", "mean"),
        keyword_rate=("keyword_rate", "mean"),
        avg_session_count=("session_count", "mean"),
    ).reset_index()

    # 코호트 간(cross-sectional) z-score — 동료 코호트 대비 상대적 심각도
    for col in ["severity_score", "keyword_rate"]:
        mu, sd = agg[col].mean(), agg[col].std(ddof=0)
        sd_safe = sd if sd > 1e-9 else 1e-9
        agg[f"{col}_z"] = (agg[col] - mu) / sd_safe

    agg["micro_signal"] = (agg["severity_score_z"] + agg["keyword_rate_z"]) / 2
    agg.loc[agg["avg_session_count"] < C.K_ANONYMITY_MIN, "micro_signal"] = np.nan
    return agg[["cohort_id", "micro_signal", "avg_session_count"]]


# ------------------------------------------------------------------
# ④ 판단 — 통합 스코어 산출 → 5단계 등급화
# ------------------------------------------------------------------
def _z_to_subscore(z, clip=3.0):
    z = np.clip(z, -clip, clip)
    return (z + clip) / (2 * clip) * 100.0


def compute_scores(baseline_df, trigger_df, event_df, micro_df) -> pd.DataFrame:
    df = baseline_df.merge(trigger_df, on="cohort_id", how="left") \
                     .merge(event_df[["cohort_id", "event_response"]], on="cohort_id", how="left") \
                     .merge(micro_df[["cohort_id", "micro_signal", "avg_session_count"]], on="cohort_id", how="left")

    def row_score(r):
        sub = {
            "baseline_z": _z_to_subscore(r["baseline_z"]),
            "trigger_z": _z_to_subscore(r["trigger_z"]),
            "event_response": _z_to_subscore(r["event_response"]),
        }
        has_micro = pd.notna(r.get("micro_signal"))
        if has_micro:
            sub["micro_signal"] = _z_to_subscore(r["micro_signal"])
            weights = C.WEIGHTS_WITH_MICRO
        else:
            weights = C.WEIGHTS_MACRO_ONLY
        score = sum(weights[k] * sub[k] for k in weights)
        contrib = {k: weights[k] * sub[k] for k in weights}
        return pd.Series({"score": score, "_contrib": contrib, "_weights_used": "with_micro" if has_micro else "macro_only"})

    scored = df.apply(row_score, axis=1)
    out = pd.concat([df, scored], axis=1)

    # 5단계 등급화 — 분위수(quintile) 기준 (통합기획서 5장)
    ranks = out["score"].rank(method="first")
    out["risk_level"] = pd.qcut(ranks, 5, labels=[1, 2, 3, 4, 5]).astype(int)

    # 안전 하한(safety floor) — 거시가 "정상"으로 보여도 미시 신호(심리상담 위험 키워드·심각도)
    # 자체가 뚜렷하면(z>=2.0, 동료 코호트 상위 약 2.3% 수준) 최소 Lv.3(주의)까지는 끌어올린다.
    # 근거: 6-4절은 심리상담 NPC 신호를 미시 층의 "핵심 신호"라고 명시한다 — 거시가 주(主)라는
    # 5-1절의 가중치 설계를 유지하되, 명확한 단일 신호가 가중합에 희석되어 사라지는 것은 막는다.
    # 임계값 2.0은 잠정값이며 실 데이터 검증 후 threshold_settings로 이전할 Open Item이다.
    micro_floor_mask = out["micro_signal"].notna() & (out["micro_signal"] >= 2.0)
    out.loc[micro_floor_mask, "risk_level"] = out.loc[micro_floor_mask, "risk_level"].clip(lower=3)

    out["risk_level_label"] = out["risk_level"].map(C.RISK_LEVEL_LABELS)
    out["scored_on"] = C.PERIOD_END.isoformat()
    out["model_version"] = C.MODEL_VERSION
    return out


# ------------------------------------------------------------------
# ⑤ 원인 분석 — 규칙 기반 기여도 분해 (risk_factors)
#    Open Item(통합기획서 6-6: "규칙 기반 vs SHAP") 중 규칙 기반을 채택 — 프로토타입 단계의
#    해석 용이성·설명 가능성을 우선한다는 5-1절의 논리를 그대로 따른 선택.
# ------------------------------------------------------------------
CAUSE_LABELS = {
    "event_response": "이벤트 무반응형(H-A) 의심 — 명절 등 이벤트 시기에도 소비 패턴이 거의 변하지 않음",
    "trigger_z": "선택적 소비 위축형(H-B) 의심 — 최근 카드 결제 활동이 평소 추세보다 낮게 유지됨",
    "baseline_z": "구조적 저활동형(H-C) 의심 — 통신 유동인구가 6개월간 완만히 낮아지는 추세",
    "micro_signal": "미시신호 우세형 — 소셜 월드 심리상담 대화에서 위험 키워드·심각도가 동료 코호트 대비 높음",
}


FACTOR_SHORT = {
    "event_response": "이벤트 무반응", "trigger_z": "카드 소비 위축",
    "baseline_z": "유동인구 하락", "micro_signal": "심리상담 위험신호",
}
# 중립(z=0, subscore=50) 대비 초과 기여가 이 값(점) 미만이면 "뚜렷한 원인 없음"으로 본다
MIN_EXCESS_POINTS = 3.0


def explain_scores(scored_df: pd.DataFrame) -> pd.DataFrame:
    """기여도 = 가중치 × (subscore − 50). 즉 "중립 대비 점수를 얼마나 끌어올렸는가"로 분해한다.
    가중치 × subscore를 그대로 비교하면 z=0(아무 신호 없음)이어도 가중치가 큰 요인이 항상 1위가
    되는 왜곡이 생기므로, 중립점(50)을 빼고 비교한다.
    """
    rows = []
    for _, r in scored_df.iterrows():
        weights = C.WEIGHTS_WITH_MICRO if r["_weights_used"] == "with_micro" else C.WEIGHTS_MACRO_ONLY
        excess = {k: r["_contrib"][k] - weights[k] * 50.0 for k in weights}
        breakdown = {k: round(v, 2) for k, v in excess.items()}
        if r["risk_level"] <= 2:
            rows.append({"cohort_id": r["cohort_id"], "dominant_factor": None,
                         "archetype_guess": "특이 신호 없음", "factor_breakdown": breakdown})
            continue
        items = sorted(excess.items(), key=lambda kv: kv[1], reverse=True)
        (f1, v1), (f2, v2) = items[0], items[1]
        if v1 < MIN_EXCESS_POINTS:
            label = "뚜렷한 단일 원인 없음 — 여러 지표가 약하게 겹쳐 상위 분위에 진입(오탐 가능성 검토 필요)"
        elif v2 >= MIN_EXCESS_POINTS and (v1 - v2) < 0.35 * v1:
            label = f"복합형 — {FACTOR_SHORT[f1]} + {FACTOR_SHORT[f2]}"
        else:
            label = CAUSE_LABELS[f1]
        rows.append({"cohort_id": r["cohort_id"], "dominant_factor": f1 if v1 >= MIN_EXCESS_POINTS else None,
                     "archetype_guess": label, "factor_breakdown": breakdown})
    return pd.DataFrame(rows)


# ------------------------------------------------------------------
# ⑥ 추천 — 등급별 개입 방안 + 복지자원 매칭
# ------------------------------------------------------------------
ARCHETYPE_FROM_FACTOR = {
    "event_response": "event_unresponsive",
    "trigger_z": "essential_only",
    "baseline_z": "structurally_low",
    "micro_signal": "micro_flagged",
}


def recommend_resources(scored_df: pd.DataFrame, explained_df: pd.DataFrame) -> pd.DataFrame:
    merged = scored_df.merge(explained_df, on="cohort_id")
    rows = []
    for _, r in merged.iterrows():
        if r["risk_level"] < 3:
            continue
        if pd.isna(r["dominant_factor"]) or r["dominant_factor"] is None:
            continue  # 원인이 불분명한 코호트에 자원을 억지로 매칭하지 않는다 — 담당자 검토로 넘김
        archetype = ARCHETYPE_FROM_FACTOR[r["dominant_factor"]]
        resources = match_resources(archetype, r["sgg_code"], r["age_group"])
        for rank, res in enumerate(resources, start=1):
            rows.append({
                "cohort_id": r["cohort_id"], "risk_level": r["risk_level"],
                "rank": rank, "resource_id": res["resource_id"], "resource_name": res["name"],
                "category": res["category"], "provider": res["provider"],
            })
    return pd.DataFrame(rows)


# ------------------------------------------------------------------
# ⑦ 우선순위 — v_priority_targets 상당 (Lv.3 이상, 점수 내림차순)
# ------------------------------------------------------------------
def build_priority_targets(scored_df: pd.DataFrame, explained_df: pd.DataFrame) -> pd.DataFrame:
    merged = scored_df.merge(explained_df, on="cohort_id")
    pri = merged[merged["risk_level"] >= 3].sort_values("score", ascending=False).copy()
    pri["priority_rank"] = range(1, len(pri) + 1)
    cols = ["priority_rank", "cohort_id", "region_name", "gender", "age_group",
            "score", "risk_level", "risk_level_label", "archetype_guess",
            "baseline_z", "trigger_z", "event_response", "micro_signal"]
    return pri[cols].reset_index(drop=True)


# ------------------------------------------------------------------
# ⑧ 행동 제안 — 공무원에게 구체적 행동 제안 (대회 운영흐름 대비 확장 단계)
# ------------------------------------------------------------------
def build_action_suggestions(priority_df: pd.DataFrame, recommend_df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    urgency_map = {5: "2주 안에 조치해 주세요.", 4: "한 달 안에 조치해 주세요.", 3: "지켜보면서 다음 달에 다시 확인해 주세요."}
    for _, r in priority_df.iterrows():
        res = recommend_df[recommend_df["cohort_id"] == r["cohort_id"]]
        urgency = urgency_map[int(r["risk_level"])]
        who = f"{r['region_name']} {r['age_group']} {C.GENDER_LABEL[r['gender']]}"

        if res.empty:
            # 원인 불명확 → 자원 연계보다 "진짜 신호인지"부터 확인하는 것이 올바른 행동
            action = (f"{urgency} 뚜렷한 이유가 없어서 복지자원을 바로 연결하기보다 먼저 사실인지 확인하는 게 좋아요. "
                      f"① 다음 달 결과에서도 '주의' 이상인지 보기 "
                      f"② 이 집단이 많이 사는 동 주민센터에 최근 상담·민원 분위기 물어보기 "
                      f"③ 두 달 연속 '주의' 이상이면 사례로 등록하기")
        else:
            names = ", ".join(res["resource_name"].tolist())
            if r["age_group"] in C.MICRO_ELIGIBLE_AGE_GROUPS:
                # 청년 → 소셜 월드가 개입 채널(7-1절)
                channel = "소셜 월드에서 이 집단 사용자에게 맞는 NPC·미션을 먼저 보여주기(자동으로 반영돼요)"
            else:
                # 중장년·고령 → 기존 오프라인 돌봄으로 분기(5-2절)
                channel = "이 집단이 많이 사는 동 주민센터에 안부 확인·방문 상담이 필요한 분을 찾아 달라고 요청하기"
            action = (f"{urgency} ① {channel} ② 이 자원 안내하기: {names} "
                      f"③ 한 달 뒤 같은 기준으로 다시 확인하기")
        rows.append({
            "cohort_id": r["cohort_id"], "priority_rank": r["priority_rank"],
            "risk_level": r["risk_level"], "urgency": urgency, "action_text": action,
        })
    return pd.DataFrame(rows)


# ------------------------------------------------------------------
# ⑩ 환류 — 소셜 월드 NPC 개인화로 되돌리는 피드백 페이로드
# ------------------------------------------------------------------
NPC_EMPHASIS_FROM_FACTOR = {
    "event_response": "psych",      # 관계망 신호가 약하므로 심리상담 NPC로 먼저 유도
    "trigger_z": "job",             # 선택적 소비 위축 → 하루 일·취업 안내(경제적 트리거 가능성). 월드에선 하루가 받음
    "baseline_z": "policy",         # 구조적 저활동 → 하루 정책 안내(복지 자원 우선). 월드에선 하루가 받음
    "micro_signal": "psych",
}
# 마을이장이 받는 환류 — 이벤트 "주제"만 넘긴다(등급·점수 없음). 코드 → 뜻은 chief.THEMES
EVENT_THEME_FROM_FACTOR = {
    "event_response": "outdoor_walk",   # 명절 등 이벤트 무반응 → 부담 없는 야외 활동(오프라인 접촉)
    "trigger_z": "free_activity",       # 선택적 소비 위축 → 돈 안 드는 활동
    "baseline_z": "info_support",       # 구조적 저활동 → 생활 정보·지원센터 안내
    "micro_signal": "small_talk",       # 대화 신호 → 가벼운 대화 모임
}
MISSION_SUGGESTIONS = {
    "psych": ["심리상담 NPC와 대화하기", "일주일 연속 출석하기"],
    "job": ["지원센터 하루 만나기", "첫 동아리 가입하기"],        # 정책추천·취업상담 창구는 하루로 합침(07_feedback_chat.sql G)
    "policy": ["지원센터 하루 만나기", "광장 한 바퀴 돌아보기"],
}


def build_feedback_payload(scored_df: pd.DataFrame, explained_df: pd.DataFrame) -> dict:
    merged = scored_df.merge(explained_df, on="cohort_id")
    micro_targets = merged[(merged["risk_level"] >= 3) &
                            merged["age_group"].isin(C.MICRO_ELIGIBLE_AGE_GROUPS)]
    payload = {}
    for _, r in micro_targets.iterrows():
        if pd.isna(r["dominant_factor"]):
            continue  # 원인이 불분명하면 개인화를 바꾸지 않는다(오탐일 때 사용자 경험을 흔들지 않기 위함)
        npc = NPC_EMPHASIS_FROM_FACTOR[r["dominant_factor"]]
        payload[r["cohort_id"]] = {
            "sgg_code": r["sgg_code"], "gender": r["gender"], "age_group": r["age_group"],
            "risk_level": int(r["risk_level"]), "risk_level_label": r["risk_level_label"],
            "archetype_guess": r["archetype_guess"],
            "npc_emphasis": npc,
            "priority_missions": MISSION_SUGGESTIONS[npc],
            "event_theme": EVENT_THEME_FROM_FACTOR[r["dominant_factor"]],
        }
    return payload
