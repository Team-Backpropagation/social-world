"""
청년(20~30대) 통합 마스터 생성
====================================
카드(일별) + 통신(월별) + 업종 파생지표를 하나의 분석 키로 병합한다.

키:  region × date × sex × age_group   →  2 × 184 × 2 × 2 = 1,472행

세 데이터의 해상도가 다르므로 컬럼명에 해상도를 박아둔다.
    *_monthly  : 월 단위 값을 그 달의 모든 날짜에 복제한 것 (일별 변동 없음)
    region_*   : 연령·성별 구분이 없는 지역 단위 값 (코호트별로 다르지 않음)
이 규칙을 무시하고 일별 변동을 분석하면 조용히 틀린 결과가 나온다.

지표별로 사용하는 업종 집합이 다르다.
    cnt_all        90종 전체
    cnt_ex_fixed   고정지출 4종 제외          ← 규모 지표
    H_offline      고정+원격+ZZ 제외 (76종)   ← 다양성 지표
근거는 `Claude outputs/업종분류_고정지출_제외안_초안.md` 참조.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config
from .split import add_split_label
from .validate import Report

KEY = ["region", "date", "sex", "age_group"]


def _load_card_cohort() -> pd.DataFrame:
    p = config.CLEAN_DIR / "card_cohort_daily.csv"
    df = pd.read_csv(p, encoding=config.OUT_ENCODING)
    df = df[df["age_group"].isin(config.YOUTH_AGE_GROUPS)].copy()
    return df.rename(columns={"MCT_SGG_CD": "region", "SEX_CCD": "sex"})


def _load_card_industry() -> pd.DataFrame:
    p = config.CLEAN_DIR / "card_industry_daily.csv"
    df = pd.read_csv(p, encoding=config.OUT_ENCODING)
    df = df[df["age_group"].isin(config.YOUTH_AGE_GROUPS)].copy()
    return df.rename(columns={"MCT_SGG_CD": "region", "SEX_CCD": "sex"})


def build_scale(card: pd.DataFrame) -> pd.DataFrame:
    """규모 + 거주자 비율. card_cohort_daily 기반(업종 축 없음, 거주 축 있음)."""
    base = card.groupby(KEY, as_index=False).agg(
        cnt_all=("cnt", "sum"), amount_all=("amount", "sum")
    )
    res = (
        card[card["resident"] == "거주자"]
        .groupby(KEY, as_index=False)
        .agg(cnt_resident=("cnt", "sum"))
    )
    out = base.merge(res, on=KEY, how="left")
    out["cnt_resident"] = out["cnt_resident"].fillna(0).astype("int64")
    out["resident_share"] = (out["cnt_resident"] / out["cnt_all"]).round(4)
    return out


def _entropy(df: pd.DataFrame) -> pd.DataFrame:
    g = df.groupby(KEY + ["MCT_RY_CD"], as_index=False)["cnt"].sum()
    tot = g.groupby(KEY)["cnt"].transform("sum")
    g["p"] = g["cnt"] / tot
    g["term"] = -g["p"] * np.log(g["p"].where(g["p"] > 0))
    out = g.groupby(KEY, as_index=False).agg(
        H_offline=("term", "sum"), n_industry_offline=("MCT_RY_CD", "nunique")
    )
    out["n_eff_offline"] = np.exp(out["H_offline"]).round(3)
    out["H_offline"] = out["H_offline"].round(4)
    return out


def build_industry(ind: pd.DataFrame) -> pd.DataFrame:
    """업종 파생: 규모(집합별) + 엔트로피 + 기능군 비중."""
    tot = ind.groupby(KEY, as_index=False)["cnt"].sum().rename(columns={"cnt": "_tot"})

    ex_fixed = ind[~ind["MCT_RY_CD"].isin(config.FIXED_EXPENSE_CODES)]
    scale = ex_fixed.groupby(KEY, as_index=False).agg(
        cnt_ex_fixed=("cnt", "sum"), amount_ex_fixed=("amount", "sum")
    )

    offline = ind[~ind["MCT_RY_CD"].isin(config.ENTROPY_EXCLUDE)]
    ent = _entropy(offline)
    off_cnt = offline.groupby(KEY, as_index=False).agg(cnt_offline=("cnt", "sum"))

    out = tot.merge(scale, on=KEY, how="left").merge(ent, on=KEY, how="left").merge(
        off_cnt, on=KEY, how="left"
    )

    for name, codes in config.INDUSTRY_SHARE_GROUPS.items():
        s = (
            ind[ind["MCT_RY_CD"].isin(codes)]
            .groupby(KEY, as_index=False)["cnt"]
            .sum()
            .rename(columns={"cnt": f"share_{name}"})
        )
        out = out.merge(s, on=KEY, how="left")
        out[f"share_{name}"] = (out[f"share_{name}"].fillna(0) / out["_tot"]).round(4)

    return out.drop(columns=["_tot"])


def build_flow(report: Report | None = None) -> pd.DataFrame:
    """통신 코호트(월별) + 지역 단위 시간대·요일 파생값."""
    coh = pd.read_csv(config.CLEAN_DIR / "flow_cohort_monthly.csv", encoding=config.OUT_ENCODING)
    coh = coh[coh["age_group"].isin(config.YOUTH_AGE_GROUPS)].copy()
    coh["region"] = coh["region"].map(config.REGION_ALIAS)
    coh = coh.rename(columns={"flow_pop": "flow_pop_monthly"})
    if report is not None:
        report.expect("[youth] 통신 청년 행 수", len(coh), config.EXPECTED_YOUTH["flow_rows"])

    tm = pd.read_csv(config.CLEAN_DIR / "flow_time_region_month.csv", encoding=config.OUT_ENCODING)
    tm["region"] = tm["region"].map(config.REGION_ALIAS)
    night = [f"TMST_{h:02d}" for h in (22, 23, 0, 1, 2, 3, 4)]
    hours = [c for c in tm.columns if c.startswith("TMST_")]
    tm["region_night_share_monthly"] = (tm[night].sum(axis=1) / tm[hours].sum(axis=1)).round(4)

    wk = pd.read_csv(config.CLEAN_DIR / "flow_wkdy_region_month.csv", encoding=config.OUT_ENCODING)
    wk["region"] = wk["region"].map(config.REGION_ALIAS)
    wknd = ["FLOW_POP_CNT_SAT", "FLOW_POP_CNT_SUN"]
    days = [c for c in wk.columns if c.startswith("FLOW_POP_CNT_")]
    wk["region_weekend_share_monthly"] = (wk[wknd].sum(axis=1) / wk[days].sum(axis=1)).round(4)

    reg = tm[["region", "STD_YM", "region_night_share_monthly"]].merge(
        wk[["region", "STD_YM", "region_weekend_share_monthly"]], on=["region", "STD_YM"]
    )
    return coh.merge(reg, on=["region", "STD_YM"], how="left")


def add_calendar(df: pd.DataFrame) -> pd.DataFrame:
    """요일, 주말, split 라벨, 춘천 학기 플래그."""
    df = add_split_label(df, date_col="date")
    d = pd.to_datetime(df["date"])
    df["dow"] = d.dt.dayofweek                      # 0=월
    df["is_weekend"] = df["dow"].ge(5).astype(int)

    term = pd.Series(False, index=df.index)
    for start, end in config.CHUNCHEON_TERM_PERIODS:
        term |= d.between(start, end)
    # 미검증 가설. 춘천 20대에만 부착하고 보정에는 쓰지 않는다.
    df["chuncheon_term_flag"] = (
        term & df["region"].eq("강원 춘천시") & df["age_group"].eq("20대")
    ).astype(int)
    return df


def build_youth_master(report: Report | None = None) -> pd.DataFrame:
    card = _load_card_cohort()
    ind = _load_card_industry()

    scale = build_scale(card)
    deriv = build_industry(ind)
    out = scale.merge(deriv, on=KEY, how="left")

    out["STD_YM"] = pd.to_datetime(out["date"]).dt.strftime("%Y%m").astype(int)
    out = out.merge(build_flow(report), on=["region", "STD_YM", "sex", "age_group"], how="left")
    out = add_calendar(out)

    cols = (
        KEY + ["split", "dow", "is_weekend", "chuncheon_term_flag", "STD_YM"]
        + ["cnt_all", "amount_all", "cnt_ex_fixed", "amount_ex_fixed", "cnt_offline"]
        + ["cnt_resident", "resident_share"]
        + ["H_offline", "n_eff_offline", "n_industry_offline"]
        + [f"share_{k}" for k in config.INDUSTRY_SHARE_GROUPS]
        + ["flow_pop_monthly", "region_night_share_monthly", "region_weekend_share_monthly"]
    )
    out = out[cols].sort_values(KEY).reset_index(drop=True)

    if report is not None:
        exp = config.EXPECTED_YOUTH
        report.expect("[youth] 마스터 행 수", len(out), exp["rows"])
        report.expect("[youth] 코호트 수", out.groupby(KEY[:1] + KEY[2:]).ngroups, exp["cohorts"])
        report.expect("[youth] 날짜 수", out["date"].nunique(), exp["n_dates"])
        report.expect("[youth] 결측 칸 수", int(out.isna().sum().sum()), 0)
        for k, v in exp["split_days"].items():
            report.expect(f"[youth] split={k} 일수", out.loc[out["split"] == k, "date"].nunique(), v)
        report.expect(
            "[youth] 카드 건수 보존",
            int(out["cnt_all"].sum()),
            int(card["cnt"].sum()),
        )
    return out


def save(df: pd.DataFrame) -> "object":
    config.CLEAN_DIR.mkdir(parents=True, exist_ok=True)
    path = config.CLEAN_DIR / "youth_master_daily.csv"
    df.to_csv(path, index=False, encoding=config.OUT_ENCODING)
    return path
