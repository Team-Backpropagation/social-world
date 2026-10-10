# -*- coding: utf-8 -*-
"""
위험 탐지 에이전트(6-6) — ②~⑩ 단계 구현

① 수집은 synth_macro.py / synth_micro.py 가 담당한다(합성 데이터 생성 = 실서비스의
"대회 제공 데이터 적재"를 대신하는 자리). 이 파일은 그 이후 단계만 구현한다.

각 함수의 docstring에 대응하는 통합기획서 6-6절 단계 번호와, 방법론의 출처 문서를 명시한다.
"""
from __future__ import annotations

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
# ③ 탐지 — 요일 보정 + (참고용) 급변 robust z-score
#    출처: 데이터_분석근거_정리.md 12-1절. 판정(④)은 여기서 만든 요일 보정값(dow_corrected)만 쓴다.
# ------------------------------------------------------------------
def detect_card_anomalies(card_df: pd.DataFrame, mode: str = "prospective") -> pd.DataFrame:
    """요일 보정값과 급변 z를 붙인다.

    mode="prospective"(기본, 운영): 추세선을 **그날까지의** 29일로만 만든다(뒤쪽 창). 미래 날짜를 보지 않는다.
    mode="retrospective"(보고서): 앞뒤 14일씩 보는 중심 창. 기간이 끝난 뒤 되돌아보는 사후 분석에만 쓴다.
    급변 z(robust_z)는 로그·대시보드 참고용이며 ④ 판정에는 들어가지 않는다.
    """
    if mode not in ("prospective", "retrospective"):
        raise ValueError(f"mode는 prospective 또는 retrospective: {mode}")
    df = card_df.sort_values(["cohort_id", "ta_ymd"]).copy()
    df["ta_ymd"] = pd.to_datetime(df["ta_ymd"]).dt.date
    df["dow"] = pd.to_datetime(df["ta_ymd"]).dt.weekday

    out_frames = []
    for cohort_id, g in df.groupby("cohort_id"):
        g = g.sort_values("ta_ymd").reset_index(drop=True)
        base = g[g["split"] == "baseline"]

        # 1) 요일 효과 제거 — baseline 구간의 요일별 중앙값 배율(명절이 섞여도 안 끌려감, 12-1절)
        overall_median = base["use_cnt"].median() if len(base) else np.nan
        dow_median = base.groupby("dow")["use_cnt"].median() if len(base) else pd.Series(dtype=float)
        dow_mult = (dow_median / overall_median).reindex(range(7)).fillna(1.0) if overall_median else \
            pd.Series(1.0, index=range(7))
        g["dow_mult"] = g["dow"].map(dow_mult)
        g["dow_corrected"] = g["use_cnt"] / g["dow_mult"].replace(0, np.nan)

        # 2) 추세 — 29일 이동 중앙값. prospective는 뒤쪽 창이라 첫 며칠은 비워 둔다(앞 날짜로 채우지 않음)
        centered = mode == "retrospective"
        g["trend"] = g["dow_corrected"].rolling(window=C.TREND_WINDOW_DAYS, center=centered, min_periods=10).median()
        g["trend"] = g["trend"].bfill().ffill() if centered else g["trend"].ffill()
        g["resid_ratio"] = g["dow_corrected"] / g["trend"] - 1.0

        # 3) robust z — baseline 구간 잔차의 중앙값·MAD로 표준화
        base_resid = g.loc[g["split"] == "baseline", "resid_ratio"].dropna()
        med_b = base_resid.median()
        mad_b = (base_resid - med_b).abs().median()
        g["robust_z"] = (g["resid_ratio"] - med_b) / (C.MAD_SCALE * mad_b) if mad_b and mad_b > 0 else np.nan
        out_frames.append(g)

    return pd.concat(out_frames, ignore_index=True)


def _loo_median(values: pd.Series, groups: pd.Series) -> pd.Series:
    """같은 그룹(지역) 안에서 **나를 뺀** 나머지의 중앙값 = 지역 공통 변화. 나머지가 2개 미만이면 0."""
    out = pd.Series(0.0, index=values.index)
    for _, idx in values.groupby(groups).groups.items():
        for i in idx:
            others = values.loc[[j for j in idx if j != i]].dropna()
            out.loc[i] = others.median() if len(others) >= 2 else 0.0
    return out


def _until(df, col, as_of):
    return df if as_of is None else df[df[col] <= as_of]


REST = "#rest"   # '나를 뺀 지역 나머지' 시계열에 붙이는 cohort_id 꼬리표


def _rest_of_region(card: pd.DataFrame, region_ref: pd.DataFrame | None = None) -> pd.DataFrame:
    """집단마다 '나를 뺀 같은 지역 나머지 전체'의 하루 결제 건수를 만든다 = 지역 공통 변화의 기준.

    region_ref(지역×날짜의 **전 연령** 합계, 컬럼 sgg_code·ta_ymd·region_cnt)가 있으면 거기서 나를 빼고,
    없으면 입력 카드 자료의 같은 지역 다른 집단 합계를 쓴다.
    2026-10-09 실데이터 점검: 청년 모드에서 '같은 지역 청년 3개 집단'을 기준으로 삼았더니 춘천 20대(학기·귀성)와
    30대가 반대로 움직여 기준이 무너졌다 → 지역 전 연령 합계를 기준으로 바꿈(docs/판단검증_결과.md 9절).
    """
    c = card[["cohort_id", "sgg_code", "ta_ymd", "use_cnt"]].copy()
    c["ta_ymd"] = c["ta_ymd"].astype(str).str[:10]
    if region_ref is not None and len(region_ref):
        r = region_ref.assign(ta_ymd=region_ref["ta_ymd"].astype(str).str[:10])
        tot = r.groupby(["sgg_code", "ta_ymd"])["region_cnt"].sum()
    else:
        tot = c.groupby(["sgg_code", "ta_ymd"])["use_cnt"].sum()
    key = pd.MultiIndex.from_frame(c[["sgg_code", "ta_ymd"]])
    rest = c.assign(cohort_id=c["cohort_id"] + REST,
                    use_cnt=tot.reindex(key).to_numpy(dtype=float) - c["use_cnt"].to_numpy(dtype=float))
    return rest[rest["use_cnt"] > 0]      # 지역에 나 혼자면 비교 기준이 없다(공통 변화 0으로 처리)


def _level_profile(g: pd.DataFrame) -> dict:
    """한 시계열의 baseline 평균·평소 하루 흔들림·eval 평균 변화율·주별 변화율."""
    J = C.JUDGMENT
    base = g.loc[g["split"] == "baseline", "dow_corrected"].dropna()
    ev = g[g["split"] == "eval"].dropna(subset=["dow_corrected"])
    # 평소 하루 흔들림 = baseline 안에서 '그 무렵 수준(29일 중앙값)'에서 하루하루 벗어난 정도.
    # baseline 전체 평균에서 벗어난 정도로 재면 baseline 안의 완만한 추세까지 흔들림으로 잡혀 기준이 부풀려진다.
    # baseline은 eval보다 모두 과거이므로 baseline 안에서는 중심 창을 써도 미래 정보가 eval 판정에 섞이지 않는다.
    local = base.rolling(C.TREND_WINDOW_DAYS, center=True, min_periods=10).median()
    mean_b = base.mean()
    std_b = (base / local - 1).std(ddof=0) * mean_b
    ok = len(base) >= J["min_baseline_days"] and len(ev) >= J["min_eval_days"] and std_b > 0
    week = ((pd.to_datetime(ev["ta_ymd"]) - pd.Timestamp(C.EVAL_START)).dt.days // 7)
    wk = ev.groupby(week.values)["dow_corrected"].agg(["mean", "size"])
    wk = wk[wk["size"] >= 4]
    return {"ok": bool(ok), "mean_b": mean_b, "std_b": std_b,
            "pct": (ev["dow_corrected"].mean() / mean_b - 1) if ok else np.nan,
            "weeks": {int(k): v / mean_b - 1 for k, v in wk["mean"].items()} if ok else {}}


def compute_card_signal(detected: pd.DataFrame, as_of: date | None = None,
                        rest_detected: pd.DataFrame | None = None, cfg: str = "card") -> pd.DataFrame:
    """카드 결제 수준 신호 — 평소(baseline) 대비 최근(eval) 수준이 **평소 하루 흔들림의 몇 배** 낮아졌나.

    - 혼자 기준선: 기준은 그 집단의 baseline 평균·흔들림뿐이다(다른 집단과 줄 세우지 않음)
    - 지역 공통 변화 차감: '나를 뺀 지역 나머지'(rest_detected)의 같은 기간 변화율을 빼서
      계절·날씨처럼 다 같이 겪은 감소를 걸러낸다
    - 지속: eval을 1주 단위로 나눠, 기준(observe)을 넘은 주가 몇 주인지 센다
    부호: 낮아질수록 +(위험 방향).
    cfg: 지속 주 수를 셀 기준 묶음(config.JUDGMENT의 "card" 또는 "social").
    """
    J = C.JUDGMENT
    d = _until(detected, "ta_ymd", as_of)
    rest = {} if rest_detected is None else {
        cid[:-len(REST)]: _level_profile(g) for cid, g in _until(rest_detected, "ta_ymd", as_of).groupby("cohort_id")}
    rows, wk_rows = [], []
    for cid, g in d.groupby("cohort_id"):
        p = _level_profile(g)
        r = rest.get(cid, {"ok": False})
        common = r["pct"] if r["ok"] else 0.0
        scale = p["mean_b"] / p["std_b"] if p["ok"] else np.nan
        rows.append({"cohort_id": cid, "card_ok": p["ok"], "mean_b": p["mean_b"], "std_b": p["std_b"],
                     "card_pct": p["pct"], "card_region_pct": common if p["ok"] else np.nan,
                     "trigger_z": -(p["pct"] - common) * scale if p["ok"] else np.nan})
        for w, pct in p["weeks"].items():
            wc = r["weeks"].get(w, 0.0) if r["ok"] else 0.0
            wk_rows.append({"cohort_id": cid, "z": -(pct - wc) * scale})
    s = pd.DataFrame(rows)
    s["card_adj_drop"] = -(s["card_pct"] - s["card_region_pct"])
    if wk_rows:
        w = pd.DataFrame(wk_rows)
        s["card_persist_weeks"] = s["cohort_id"].map((w["z"] >= J[cfg]["observe"]).groupby(w["cohort_id"]).sum()).fillna(0).astype(int)
        s["card_weeks"] = s["cohort_id"].map(w.groupby("cohort_id").size()).fillna(0).astype(int)
    else:
        s["card_persist_weeks"], s["card_weeks"] = 0, 0
    return s[["cohort_id", "card_ok", "trigger_z", "card_pct", "card_region_pct", "card_adj_drop",
              "card_persist_weeks", "card_weeks", "std_b", "mean_b"]]


SOCIAL_COLS = ["social_ok", "social_z", "social_pct", "social_region_pct", "social_adj_drop",
               "social_persist_weeks", "social_weeks"]


def compute_social_signal(card: pd.DataFrame, region_ref: pd.DataFrame | None, as_of: date | None = None,
                          mode: str = "prospective") -> pd.DataFrame:
    """사회활동 소비(외식·문화·운동 건수, 컬럼 social_cnt) 신호 — 카드 결제 신호와 같은 계산을 이 건수에 한 번 더 한다.

    전체 결제는 그대로인데 사람을 만나는 소비만 줄고 편의점·배달 같은 생존 소비로 옮겨 가면 카드 신호는 못 잡는다.
    이 신호는 그 경우를 잡는다(2026-10-10, J5). 지역 공통 변화는 카드와 똑같이 '나를 뺀 지역 나머지'의
    사회활동 건수로 뺀다. region_ref를 쓰는 청년 모드에서 그 안에 사회활동 합계(region_social_cnt)가 없으면
    청년끼리만 비교하게 되어 기준이 무너지므로(판단검증_결과.md 9절) 계산하지 않고 빈칸으로 둔다.
    """
    empty = pd.DataFrame(columns=["cohort_id"] + SOCIAL_COLS)
    if "social_cnt" not in card.columns or card["social_cnt"].isna().all():
        return empty
    ref = None
    if region_ref is not None and len(region_ref):
        if "region_social_cnt" not in region_ref.columns:
            return empty
        ref = region_ref[["sgg_code", "ta_ymd", "region_social_cnt"]].rename(columns={"region_social_cnt": "region_cnt"})
    soc = card[["cohort_id", "sgg_code", "ta_ymd", "social_cnt"]].rename(columns={"social_cnt": "use_cnt"})
    both = add_date_split_label(pd.concat([soc, _rest_of_region(soc, ref)], ignore_index=True))
    det = detect_card_anomalies(both, mode=mode)
    is_rest = det["cohort_id"].str.endswith(REST)
    s = compute_card_signal(det[~is_rest], as_of, det[is_rest], cfg="social")
    s = s.rename(columns={"card_ok": "social_ok", "trigger_z": "social_z", "card_pct": "social_pct",
                          "card_region_pct": "social_region_pct", "card_adj_drop": "social_adj_drop",
                          "card_persist_weeks": "social_persist_weeks", "card_weeks": "social_weeks"})
    return s[["cohort_id"] + SOCIAL_COLS]


def compute_flow_signal(flow_df: pd.DataFrame, as_of: date | None = None) -> pd.DataFrame:
    """통신 유동인구 신호(월별) — baseline 달(7~10월) 평균 대비 이후 달 평균이 **평소 월 흔들림의 몇 배** 낮아졌나.

    월별 6개 점뿐이라 집단 하나의 4개 달로는 흔들림을 믿을 만하게 잴 수 없다. 그래서 흔들림(변동계수)만
    같은 지역 집단들의 중앙값으로 잡는다(줄 세우기가 아니라 '보통 흔들리는 폭'을 안정적으로 재기 위한 것).
    평가 기간 달은 흔들림 계산에 넣지 않는다(미래 정보가 기준에 섞이지 않게).
    """
    J = C.JUDGMENT["flow"]
    f = flow_df.copy()
    f["month_end"] = (pd.to_datetime(f["std_ym"] + "-01") + pd.offsets.MonthEnd(0)).dt.date
    f = _until(f, "month_end", as_of)
    base_m = f["month_end"] <= C.BASELINE_END
    rows = []
    for cid, g in f.groupby("cohort_id"):
        b = g.loc[base_m.loc[g.index], "flow_pop"].astype(float)
        late = g.loc[~base_m.loc[g.index]].sort_values("std_ym")
        mb = b.mean()
        rows.append({"cohort_id": cid, "sgg_code": g["sgg_code"].iloc[0],
                     "cv": (b.std(ddof=1) / mb) if len(b) >= 3 and mb > 0 else np.nan,
                     "flow_pct": (late["flow_pop"].mean() / mb - 1) if len(late) and mb > 0 else np.nan,
                     "months_d": {r.std_ym: r.flow_pop / mb - 1 for r in late.itertuples()} if mb > 0 else {}})
    s = pd.DataFrame(rows)
    pooled_cv = s.groupby("sgg_code")["cv"].median()
    s["flow_cv"] = s["sgg_code"].map(pooled_cv)
    s["flow_region_pct"] = _loo_median(s["flow_pct"], s["sgg_code"])
    s["baseline_z"] = -(s["flow_pct"] - s["flow_region_pct"]) / s["flow_cv"]
    # 지속: 이후 달이 하나하나 모두 기준(observe)을 넘었나
    m_rows = [{"cohort_id": r.cohort_id, "sgg_code": r.sgg_code, "ym": ym, "pct": p, "cv": r.flow_cv}
              for r in s.itertuples() for ym, p in r.months_d.items()]
    if m_rows:
        m = pd.DataFrame(m_rows)
        m["common"] = 0.0
        for _, idx in m.groupby("ym").groups.items():
            sub = m.loc[idx]
            m.loc[idx, "common"] = _loo_median(sub["pct"], sub["sgg_code"]).values
        m["z"] = -(m["pct"] - m["common"]) / m["cv"]
        all_over = (m["z"] >= J["observe"]).groupby(m["cohort_id"]).all()
        s["flow_persist"] = s["cohort_id"].map(all_over).fillna(False).astype(bool)
        s["flow_months"] = s["cohort_id"].map(m.groupby("cohort_id").size()).fillna(0).astype(int)
    else:
        s["flow_persist"], s["flow_months"] = False, 0
    return s[["cohort_id", "baseline_z", "flow_pct", "flow_region_pct", "flow_cv", "flow_persist", "flow_months"]]


def compute_event_signal(detected: pd.DataFrame, card_sig: pd.DataFrame, as_of: date | None = None,
                         rest_detected: pd.DataFrame | None = None) -> pd.DataFrame:
    """명절 동조도 β — 달력 공휴일 구간에 **지역(나를 뺀 지역 나머지 전체)이 움직인 만큼 이 집단도 움직였나**.

    날마다 '직전 4주 평소값 대비 변화율'을 구하고, 지역 변화율에 대한 기울기 β = Σ(나×지역)/Σ(지역²)를 잰다.
    β≈1 이면 지역과 같이 움직임, β≈0 이면 무반응(H-A 가설의 시그니처). 다른 집단과 순위를 매기지 않는다.
    - 사후에 데이터로 찾은 구간(calendar=False, 예: 7/16~17)은 쓰지 않는다
    - 지역 움직임이 작아 β가 불확실한 구간(표준오차 > max_se)은 판정에 쓰지 않는다(예: 하루짜리 광복절)
    """
    J = C.JUDGMENT["event"]
    d = _until(detected if rest_detected is None else pd.concat([detected, rest_detected]), "ta_ymd", as_of).copy()
    d["ta_ymd"] = pd.to_datetime(d["ta_ymd"]).dt.date
    noise = (card_sig.set_index("cohort_id")["std_b"] / card_sig.set_index("cohort_id")["mean_b"])
    blocks = [e for e in C.EVENT_PERIODS if e.get("calendar", True) and (as_of is None or e["end"] <= as_of)]
    dev_rows = []
    for e in blocks:
        for cid, g in d.groupby("cohort_id"):
            pre = g[(g["ta_ymd"] < e["start"]) & (g["ta_ymd"] >= e["start"] - pd.Timedelta(days=J["ref_days"]))
                    & (g["split"] != "event")]["dow_corrected"].dropna()
            if len(pre) < J["ref_days"] // 2:
                continue
            ref = pre.median()
            on = g[(g["ta_ymd"] >= e["start"]) & (g["ta_ymd"] <= e["end"])]
            for r in on.itertuples():
                dev_rows.append({"block": e["name"], "cohort_id": cid, "sgg_code": r.sgg_code,
                                 "ta_ymd": r.ta_ymd, "dev": r.dow_corrected / ref - 1})
    cols = ["cohort_id", "event_beta", "event_se", "event_blocks_used", "event_blocks_low", "event_region_move", "event_own_move"]
    if not dev_rows:
        return pd.DataFrame(columns=cols)
    dv = pd.DataFrame(dev_rows)
    is_rest = dv["cohort_id"].str.endswith(REST)
    if is_rest.any():
        # 지역 움직임 = 나를 뺀 지역 나머지 전체가 같은 날 직전 4주 대비 얼마나 움직였나
        rd = dv[is_rest].assign(cohort_id=lambda x: x["cohort_id"].str[:-len(REST)])
        dv = dv[~is_rest].merge(rd[["block", "cohort_id", "ta_ymd", "dev"]].rename(columns={"dev": "region"}),
                                on=["block", "cohort_id", "ta_ymd"], how="inner")
    else:
        dv["region"] = 0.0
        for _, idx in dv.groupby("ta_ymd").groups.items():
            sub = dv.loc[idx]
            dv.loc[idx, "region"] = _loo_median(sub["dev"], sub["sgg_code"]).values
    if dv.empty:
        return pd.DataFrame(columns=cols)
    dv["xy"], dv["xx"], dv["dd"] = dv["dev"] * dv["region"], dv["region"] ** 2, dv["dev"] ** 2

    per_block = dv.groupby(["cohort_id", "block"])[["xy", "xx", "dd"]].sum().reset_index()
    per_block["n"] = dv.groupby(["cohort_id", "block"]).size().to_numpy()
    per_block["beta"] = per_block["xy"] / per_block["xx"]
    per_block["se"] = per_block["cohort_id"].map(noise) / np.sqrt(per_block["xx"])
    per_block["usable"] = per_block["se"] <= J["max_se"]
    rows = []
    for cid, b in per_block.groupby("cohort_id"):
        u = b[b["usable"]]
        if u.empty:
            rows.append({"cohort_id": cid, "event_beta": np.nan, "event_se": np.nan, "event_blocks_used": 0,
                         "event_blocks_low": 0, "event_region_move": np.nan, "event_own_move": np.nan})
            continue
        xx, n = u["xx"].sum(), u["n"].sum()
        rows.append({"cohort_id": cid, "event_beta": u["xy"].sum() / xx, "event_se": noise.get(cid, np.nan) / np.sqrt(xx),
                     "event_blocks_used": int(len(u)), "event_blocks_low": int((u["beta"] <= J["observe"]).sum()),
                     "event_region_move": float(np.sqrt(xx / n)),
                     # 이 집단 자신이 명절에 움직인 크기 ÷ 평소 하루 흔들림. 1 근처면 '평소처럼' = 무반응
                     "event_own_move": float(np.sqrt(u["dd"].sum() / n) / noise.get(cid, np.nan))})
    return pd.DataFrame(rows, columns=cols)


def compute_micro_signal(psych_df: pd.DataFrame, as_of: date | None = None) -> pd.DataFrame:
    """대화 신호 — 심리상담 NPC 대화의 평균 심각도(0~1)를 **절대 기준**으로 본다(루미 판정 구간과 같은 값).

    다른 집단과 비교하지 않는다. 최근 window_months개월 중 표본 기준(세션 K건)을 넘긴 달만 쓴다.
    주의: 현재 표본 기준은 세션 수다. 실제 고유 사용자 수 기준으로 바꾸는 일은 별도 작업(실행계획 작업 2).
    """
    J = C.JUDGMENT["micro"]
    cols = ["cohort_id", "micro_severity", "micro_high_months", "micro_months", "avg_session_count"]
    if psych_df is None or psych_df.empty:
        return pd.DataFrame(columns=cols)
    p = psych_df.copy()
    p["measured_month"] = p["measured_month"].astype(str).str[:7]
    if as_of is not None:
        p = p[(pd.to_datetime(p["measured_month"] + "-01") + pd.offsets.MonthEnd(0)).dt.date <= as_of]
    months = sorted(p["measured_month"].unique())[-J["window_months"]:]
    p = p[p["measured_month"].isin(months)]
    rows = []
    for cid, g in p.groupby("cohort_id"):
        ok = g[g["session_count"] >= C.K_ANONYMITY_MIN].sort_values("measured_month")
        rows.append({"cohort_id": cid,
                     "micro_severity": float(ok["severity_score"].iloc[-1]) if len(ok) else np.nan,
                     "micro_high_months": int((ok["severity_score"] >= J["observe"]).sum()),
                     "micro_months": int(len(ok)),
                     "avg_session_count": float(g["session_count"].mean())})
    return pd.DataFrame(rows, columns=cols)


# ------------------------------------------------------------------
# ④ 판단 — 4단계 상태(판단보류·평소범위·변화관찰·확인권장) + 확인 순서
#    분위수 5단계(집단끼리 줄 세우기)를 대체한다(2026-10-09). 근거: 실행계획 v2 J2, docs/판단검증_결과.md
# ------------------------------------------------------------------
SIGNAL_KEYS = ["trigger_z", "social_z", "baseline_z", "event_beta", "micro_severity"]


def _signal_states(r) -> dict:
    """신호별 (값, 관찰 기준 넘음, 확인 기준 넘음, 세기)를 만든다. 세기 1.0 = 확인 기준선."""
    J = C.JUDGMENT
    st = {}
    z = r.get("trigger_z")
    if pd.notna(z):
        drop = r["card_adj_drop"]    # 지역 공통 변화를 뺀 실제 감소율 — 통계적으로 뚜렷해도 너무 작으면 세지 않는다
        st["trigger_z"] = (z, z >= J["card"]["observe"] and drop >= J["card"]["min_drop_observe"],
                           z >= J["card"]["alert"] and drop >= J["card"]["min_drop_alert"]
                           and r["card_persist_weeks"] >= J["card"]["persist_weeks"],
                           z / J["card"]["alert"])
    z = r.get("social_z")
    if pd.notna(z) and bool(r.get("social_ok")):
        S, drop = J["social"], r["social_adj_drop"]
        st["social_z"] = (z, z >= S["observe"] and drop >= S["min_drop_observe"],
                          z >= S["alert"] and drop >= S["min_drop_alert"] and r["social_persist_weeks"] >= S["persist_weeks"],
                          z / S["alert"])
    z = r.get("baseline_z")
    if pd.notna(z):
        st["baseline_z"] = (z, z >= J["flow"]["observe"] and bool(r["flow_persist"]),
                            z >= J["flow"]["alert"] and bool(r["flow_persist"]) and r["flow_months"] >= 2,
                            z / J["flow"]["alert"])
    b = r.get("event_beta")
    if pd.notna(b):
        E = J["event"]
        # 무반응 = 지역을 따라 움직이지 않았고(β 낮음) **자기 자신도 평소 흔들림 이상으로 움직이지 않음**.
        # β가 낮아도 반대 방향으로 크게 움직였다면(예: 춘천 20대 귀성) 반응한 것이지 무반응이 아니다.
        still = r["event_own_move"] <= E["max_own_move"]
        st["event_beta"] = (b, b <= E["observe"] and still,
                            b <= E["alert"] and still and r["event_blocks_used"] >= E["min_blocks"]
                            and r["event_blocks_low"] == r["event_blocks_used"],
                            (1 - b) / (1 - E["alert"]))
    v = r.get("micro_severity")
    if pd.notna(v):
        M = J["micro"]
        st["micro_severity"] = (v, v >= M["observe"],
                                v >= M["strong"] or r["micro_high_months"] >= M["persist_months"],
                                v / M["observe"])
    return st


def judge(persona_table, flow_df, card_df, psych_df, as_of: date | None = None, mode: str = "prospective",
          region_ref: pd.DataFrame | None = None) -> pd.DataFrame:
    """②~④를 한 번에 — 코호트별 4단계 상태와 신호값을 돌려준다.

    as_of를 주면 그날까지의 자료만 쓴다(그 이후 행은 잘라냄). 판정 신호는 모두 그날까지의 자료로만 계산되므로
    as_of 이후 데이터를 바꿔도 결과가 같다(tests/test_judgment.py가 확인).
    region_ref: 지역×날짜 전 연령 결제 합계(sgg_code·ta_ymd·region_cnt). 청년 모드처럼 일부 연령만 넣을 때
    지역 공통 변화를 '나를 뺀 지역 전체'로 재기 위해 쓴다. 없으면 입력 자료의 같은 지역 다른 집단 합계.
    사회활동 신호를 쓰려면 card_df에 social_cnt, region_ref에 region_social_cnt가 있어야 한다(없으면 빈칸).
    """
    card = card_df.drop(columns=["split"], errors="ignore")
    both = add_date_split_label(pd.concat([card.drop(columns=["social_cnt"], errors="ignore"),
                                           _rest_of_region(card, region_ref)], ignore_index=True))
    det_all = detect_card_anomalies(both, mode=mode)
    is_rest = det_all["cohort_id"].str.endswith(REST)
    detected, rest_det = det_all[~is_rest], det_all[is_rest]
    card_sig = compute_card_signal(detected, as_of, rest_det)
    out = pd.DataFrame(persona_table)
    out = (out.merge(card_sig, on="cohort_id", how="left")
              .merge(compute_social_signal(card, region_ref, as_of, mode), on="cohort_id", how="left")
              .merge(compute_flow_signal(flow_df, as_of), on="cohort_id", how="left")
              .merge(compute_event_signal(detected, card_sig, as_of, rest_det), on="cohort_id", how="left")
              .merge(compute_micro_signal(psych_df, as_of), on="cohort_id", how="left"))
    statuses, strengths, alerts, observes, scores = [], [], [], [], []
    for _, r in out.iterrows():
        st = _signal_states(r)
        strength = {k: round(float(v[3]), 3) for k, v in st.items()}
        a = [k for k, v in st.items() if v[2]]
        o = [k for k, v in st.items() if v[1]]
        # 통신(월 6점)은 배경 신호다(데이터_분석근거_정리.md 6절: 통신=배경, 카드=변화 신호).
        # 통신만 확인 기준을 넘고 다른 신호가 하나도 관찰 기준을 안 넘으면 확인권장이 아니라 변화관찰로 둔다.
        if a == ["baseline_z"] and not [k for k in o if k != "baseline_z"]:
            a = []
        if not r.get("card_ok", False) or pd.isna(r.get("trigger_z")):
            status = "hold"       # 카드(일별 핵심 신호)를 계산할 수 없으면 판단하지 않는다
        elif a:
            status = "check"
        elif o:
            status = "watch"
        else:
            status = "normal"
        statuses.append(status); strengths.append(strength); alerts.append(a); observes.append(o)
        scores.append(round(float(np.clip(50 * max(strength.values()), 0, 100)), 1) if strength else np.nan)
    out["status"] = statuses
    out["status_label"] = out["status"].map(C.STATUS_LABELS)
    out["strength"] = strengths
    out["alert_signals"] = alerts
    out["observe_signals"] = observes
    # score: 가장 강한 신호가 확인 기준선의 몇 배인지(기준선 = 50점). 확인 순서를 정할 때만 쓴다
    out["score"] = scores
    out["risk_level"] = out["status"].map(C.STATUS_LEVEL).astype("Int64")
    out["risk_level_label"] = out["status_label"]
    out["scored_on"] = (as_of or C.PERIOD_END).isoformat()
    out["model_version"] = C.MODEL_VERSION
    return out


# ------------------------------------------------------------------
# ⑤ 원인 분석 — 어떤 신호가 기준을 넘었는지(세기 순)와 그 숫자를 문장으로
# ------------------------------------------------------------------
CAUSE_LABELS = {
    "event_beta": "이벤트 무반응형(H-A) 의심 — 명절에 지역 전체가 움직일 때 이 집단은 거의 따라 움직이지 않음",
    "trigger_z": "선택적 소비 위축형(H-B) 의심 — 최근 카드 결제가 자기 평소보다 낮은 상태가 여러 주 이어짐",
    "social_z": "사회활동 소비 위축형(H-B) 의심 — 외식·문화·운동 결제가 자기 평소보다 낮은 상태가 여러 주 이어짐",
    "baseline_z": "구조적 저활동형(H-C) 의심 — 통신 유동인구가 자기 평소보다 낮아짐",
    "micro_signal": "미시신호 우세형 — 소셜 월드 심리상담 대화의 심각도가 기준(0.45)을 넘음",
}
CAUSE_LABELS["micro_severity"] = CAUSE_LABELS.pop("micro_signal")

FACTOR_SHORT = {
    "event_beta": "명절 무반응", "trigger_z": "카드 소비 위축", "social_z": "사회활동 소비 위축",
    "baseline_z": "유동인구 하락", "micro_severity": "심리상담 위험신호",
}


def _reason_text(r) -> str:
    J = C.JUDGMENT
    parts = []
    if pd.notna(r.get("trigger_z")):
        parts.append(f"카드 결제 {r['card_pct']*100:+.1f}%(지역 나머지 {r['card_region_pct']*100:+.1f}% 제외 후 "
                     f"평소 흔들림의 {r['trigger_z']:.1f}배, 기준 넘은 주 {int(r['card_persist_weeks'])}/{int(r['card_weeks'])}주)")
    if pd.notna(r.get("social_z")) and bool(r.get("social_ok")):
        parts.append(f"외식·문화·운동 결제 {r['social_pct']*100:+.1f}%(지역 나머지 {r['social_region_pct']*100:+.1f}% 제외 후 "
                     f"{r['social_z']:.1f}배, 기준 넘은 주 {int(r['social_persist_weeks'])}/{int(r['social_weeks'])}주)")
    if pd.notna(r.get("baseline_z")):
        parts.append(f"유동인구 {r['flow_pct']*100:+.1f}%(지역 공통 {r['flow_region_pct']*100:+.1f}% 제외 후 {r['baseline_z']:.1f}배)")
    if pd.notna(r.get("event_beta")):
        parts.append(f"명절 동조도 {r['event_beta']:.2f}(1=지역과 같이 움직임, 판정 구간 {int(r['event_blocks_used'])}개, "
                     f"자기 움직임 평소 흔들림의 {r['event_own_move']:.1f}배)")
    if pd.notna(r.get("micro_severity")):
        parts.append(f"대화 심각도 {r['micro_severity']:.2f}(기준 {J['micro']['observe']}, 넘은 달 {int(r['micro_high_months'])}개)")
    return " · ".join(parts)


def explain_scores(judged: pd.DataFrame) -> pd.DataFrame:
    """주된 요인 = 기준을 넘은 신호 중 세기가 가장 큰 것. 판정의 '이유'이지 고립의 원인을 확정한 것은 아니다."""
    rows = []
    for _, r in judged.iterrows():
        base = {"cohort_id": r["cohort_id"], "factor_breakdown": r["strength"], "reason": _reason_text(r)}
        if r["status"] == "hold":
            rows.append({**base, "dominant_factor": None, "archetype_guess": "판단보류 — 자료가 부족해 판단하지 않음"})
            continue
        if r["status"] == "normal":
            rows.append({**base, "dominant_factor": None, "archetype_guess": "특이 신호 없음"})
            continue
        pool = r["alert_signals"] if r["status"] == "check" else r["observe_signals"]
        ranked = sorted(pool, key=lambda k: r["strength"].get(k, 0), reverse=True)
        f1 = ranked[0]
        if r["status"] == "check" and len(ranked) >= 2:
            label = f"복합형 — {FACTOR_SHORT[ranked[0]]} + {FACTOR_SHORT[ranked[1]]}"
        elif r["status"] == "watch":
            label = f"변화관찰 — {FACTOR_SHORT[f1]} 신호가 관찰 기준을 넘음(확인 기준·지속 조건은 아직 아님)"
        else:
            label = CAUSE_LABELS[f1]
        rows.append({**base, "dominant_factor": f1, "archetype_guess": label})
    return pd.DataFrame(rows)


# ------------------------------------------------------------------
# ⑥ 추천 — 확인권장 집단에만 복지자원 매칭
# ------------------------------------------------------------------
ARCHETYPE_FROM_FACTOR = {
    "event_beta": "event_unresponsive",
    "trigger_z": "essential_only",
    "social_z": "essential_only",
    "baseline_z": "structurally_low",
    "micro_severity": "micro_flagged",
}


def recommend_resources(scored_df: pd.DataFrame, explained_df: pd.DataFrame) -> pd.DataFrame:
    merged = scored_df.merge(explained_df, on="cohort_id")
    rows = []
    for _, r in merged.iterrows():
        if r["status"] != "check":
            continue
        if pd.isna(r["dominant_factor"]) or r["dominant_factor"] is None:
            continue  # 이유가 불분명한 코호트에 자원을 억지로 매칭하지 않는다 — 담당자 검토로 넘김
        archetype = ARCHETYPE_FROM_FACTOR[r["dominant_factor"]]
        resources = match_resources(archetype, r["sgg_code"], r["age_group"])
        for rank, res in enumerate(resources, start=1):
            rows.append({
                "cohort_id": r["cohort_id"], "status": r["status"],
                "rank": rank, "resource_id": res["resource_id"], "resource_name": res["name"],
                "category": res["category"], "provider": res["provider"],
            })
    return pd.DataFrame(rows, columns=["cohort_id", "status", "rank", "resource_id", "resource_name", "category", "provider"])


# ------------------------------------------------------------------
# ⑦ 확인 순서 — 확인권장 먼저, 그다음 변화관찰. 각 묶음 안에서만 세기(score) 순
#    줄 세우기는 "누가 위험한가"를 정하는 데 쓰지 않고, 이미 기준을 넘은 집단을 어떤 순서로 볼지에만 쓴다
# ------------------------------------------------------------------
def build_priority_targets(scored_df: pd.DataFrame, explained_df: pd.DataFrame) -> pd.DataFrame:
    merged = scored_df.merge(explained_df, on="cohort_id")
    pri = merged[merged["status"].isin(["check", "watch"])].copy()
    pri["_o"] = pri["status"].map({s: i for i, s in enumerate(C.STATUS_ORDER)})
    pri = pri.sort_values(["_o", "score", "cohort_id"], ascending=[True, False, True])
    pri["priority_rank"] = range(1, len(pri) + 1)
    cols = ["priority_rank", "cohort_id", "region_name", "gender", "age_group", "status", "status_label",
            "score", "archetype_guess", "reason"] + SIGNAL_KEYS
    return pri[cols].reset_index(drop=True)


# ------------------------------------------------------------------
# ⑧ 행동 제안 — 공무원에게 구체적 행동 제안 (대회 운영흐름 대비 확장 단계)
# ------------------------------------------------------------------
URGENCY = {"check": "이번 달 안에 확인해 주세요.", "watch": "지금은 지켜보고, 다음 달 결과로 다시 확인해 주세요."}


def build_action_suggestions(priority_df: pd.DataFrame, recommend_df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for _, r in priority_df.iterrows():
        res = recommend_df[recommend_df["cohort_id"] == r["cohort_id"]]
        urgency = URGENCY[r["status"]]
        if r["status"] == "watch":
            action = (f"{urgency} 아직 확인 기준(지속 조건 포함)을 넘지 않았어요. "
                      f"다음 달에도 같은 신호가 이어지면 '확인권장'으로 올라가요.")
        elif res.empty:
            # 이유가 뚜렷하지 않음 → 자원 연계보다 "진짜 신호인지"부터 확인
            action = (f"{urgency} 복지자원을 바로 연결하기보다 먼저 사실인지 확인하는 게 좋아요. "
                      f"① 이 집단이 많이 사는 동 주민센터에 최근 상담·민원 분위기 물어보기 "
                      f"② 다음 달에도 '확인권장'이면 사례로 등록하기")
        else:
            names = ", ".join(res["resource_name"].tolist())
            if r["age_group"] in C.MICRO_ELIGIBLE_AGE_GROUPS:
                channel = "소셜 월드에서 이 집단 사용자에게 맞는 NPC·미션을 먼저 보여주기(자동으로 반영돼요)"
            else:
                channel = "이 집단이 많이 사는 동 주민센터에 안부 확인·방문 상담이 필요한 분을 찾아 달라고 요청하기"
            action = (f"{urgency} ① {channel} ② 이 자원 안내하기: {names} "
                      f"③ 한 달 뒤 같은 기준으로 다시 확인하기")
        rows.append({
            "cohort_id": r["cohort_id"], "priority_rank": r["priority_rank"],
            "status": r["status"], "urgency": urgency, "action_text": action,
        })
    return pd.DataFrame(rows, columns=["cohort_id", "priority_rank", "status", "urgency", "action_text"])


# ------------------------------------------------------------------
# ⑩ 환류 — 소셜 월드 NPC 개인화로 되돌리는 피드백 페이로드(확인권장 집단만)
# ------------------------------------------------------------------
NPC_EMPHASIS_FROM_FACTOR = {
    "event_beta": "psych",          # 관계망 신호가 약하므로 심리상담 NPC로 먼저 유도
    "trigger_z": "job",             # 선택적 소비 위축 → 하루 일·취업 안내(경제적 트리거 가능성). 월드에선 하루가 받음
    "social_z": "psych",            # 사람을 만나는 소비만 줄어듦 → 관계망 신호이므로 심리상담 NPC로 먼저 유도
    "baseline_z": "policy",         # 구조적 저활동 → 하루 정책 안내(복지 자원 우선). 월드에선 하루가 받음
    "micro_severity": "psych",
}
# 마을이장이 받는 환류 — 이벤트 "주제"만 넘긴다(상태·점수 없음). 코드 → 뜻은 chief.THEMES
EVENT_THEME_FROM_FACTOR = {
    "event_beta": "outdoor_walk",       # 명절 등 이벤트 무반응 → 부담 없는 야외 활동(오프라인 접촉)
    "trigger_z": "free_activity",       # 선택적 소비 위축 → 돈 안 드는 활동
    "social_z": "small_talk",           # 외식·문화·운동만 줄어듦 → 사람을 만나는 가벼운 모임
    "baseline_z": "info_support",       # 구조적 저활동 → 생활 정보·지원센터 안내
    "micro_severity": "small_talk",     # 대화 신호 → 가벼운 대화 모임
}
MISSION_SUGGESTIONS = {
    "psych": ["심리상담 NPC와 대화하기", "일주일 연속 출석하기"],
    "job": ["지원센터 하루 만나기", "첫 동아리 가입하기"],        # 정책추천·취업상담 창구는 하루로 합침(07_feedback_chat.sql G)
    "policy": ["지원센터 하루 만나기", "광장 한 바퀴 돌아보기"],
}


def build_feedback_payload(scored_df: pd.DataFrame, explained_df: pd.DataFrame) -> dict:
    merged = scored_df.merge(explained_df, on="cohort_id")
    targets = merged[(merged["status"] == "check") & merged["age_group"].isin(C.MICRO_ELIGIBLE_AGE_GROUPS)]
    payload = {}
    for _, r in targets.iterrows():
        if pd.isna(r["dominant_factor"]):
            continue  # 이유가 불분명하면 개인화를 바꾸지 않는다(오탐일 때 사용자 경험을 흔들지 않기 위함)
        npc = NPC_EMPHASIS_FROM_FACTOR[r["dominant_factor"]]
        payload[r["cohort_id"]] = {
            "sgg_code": r["sgg_code"], "gender": r["gender"], "age_group": r["age_group"],
            "status": r["status"], "status_label": r["status_label"],
            "archetype_guess": r["archetype_guess"],
            "npc_emphasis": npc,
            "priority_missions": MISSION_SUGGESTIONS[npc],
            "event_theme": EVENT_THEME_FROM_FACTOR[r["dominant_factor"]],
        }
    return payload
