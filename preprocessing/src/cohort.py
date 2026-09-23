"""
코호트 집계
====================================
분석 단위(코호트)는 "지역 × 연령대 × 성별"이다. 개인 단위 추적은 데이터 구조상
불가능하고 대회 요구사항도 아니다.

시간 해상도가 다르다는 점을 기억할 것.
- 카드: 일별 (184일)  → 일별 이탈 감지(trigger) 역할
- 통신: 월별 (6개월)  → 평상시 프로파일(baseline) 역할

연령대 구간도 다르다.
- 카드: 10대~90대 (9구간)
- 통신: 10대~60대이상 (6구간)
두 데이터를 비교할 때는 카드 쪽을 6구간으로 묶어야 한다(unify_age_group).
원본 9구간 컬럼(AGE_CCD)은 지우지 않고 함께 남긴다.
"""
from __future__ import annotations

import pandas as pd

from . import config
from .validate import Report


def build_flow_cohort(wide: pd.DataFrame, report: Report | None = None) -> pd.DataFrame:
    """
    통신 성연령 집계표(지역×월, 12행)를 코호트 세로표(144행)로 변환한다.

    입력은 clean_flow.aggregate_region_month() 의 결과여야 한다.
    격자 단위 원본을 바로 melt하면 715만 행이 되어 메모리가 터진다.
    """
    value_cols = [c for c in wide.columns if "FLOW_POP_CNT" in c]

    out = wide.melt(
        id_vars=["region", "STD_YM"],
        value_vars=value_cols,
        var_name="col",
        value_name="flow_pop",
    )
    # 컬럼명 규칙: MAN_FLOW_POP_CNT_10G / WMAN_FLOW_POP_CNT_60GU
    out["sex"] = out["col"].str.startswith("WMAN").map({True: "여성", False: "남성"})
    out["age_group"] = out["col"].str.split("_").str[-1].map(config.AGE_CODE_MAP)

    n_unmapped = int(out[["sex", "age_group"]].isna().sum().sum())
    if n_unmapped:
        raise ValueError(
            f"성별/연령대 매핑에 실패한 칸이 {n_unmapped}개 있습니다. "
            f"컬럼명 규칙이 바뀌었는지 확인하세요: {sorted(out['col'].unique())[:5]}"
        )

    out = out[["region", "STD_YM", "sex", "age_group", "flow_pop"]]

    if report is not None:
        report.expect("[cohort] 통신 코호트 행 수", len(out), config.EXPECTED["flow_cohort_rows"])
        report.expect(
            "[cohort] 통신 합계 보존",
            float(out["flow_pop"].sum()),
            float(wide[value_cols].sum().sum()),
            tol=0.05,
        )
    return out


def unify_age_group(age_ccd: str) -> str:
    """카드 연령대('10 대'~'90 대')를 통신 기준 6구간으로 묶는다."""
    n = int(str(age_ccd).replace("대", "").strip())
    return "60대이상" if n >= 60 else f"{n}대"


def build_card_cohort(card: pd.DataFrame, report: Report | None = None) -> pd.DataFrame:
    """
    카드 데이터를 "지역 × 날짜 × 성별 × 연령대 × 거주여부" 단위로 집계한다.

    집계 전후 금액 합계가 같은지 반드시 검증한다(데이터 누락 감지).
    """
    before_sum = int(card["TS_AT"].sum())

    out = (
        card.groupby(
            ["MCT_SGG_CD", "date", "SEX_CCD", "AGE_CCD", "resident"],
            as_index=False,
        )
        .agg(amount=("TS_AT", "sum"), cnt=("USE_CNT", "sum"))
    )
    out["age_group"] = out["AGE_CCD"].map(unify_age_group)

    if report is not None:
        exp = config.EXPECTED["card"]
        report.expect("[cohort] 카드 코호트 행 수", len(out), exp["cohort_rows"])
        report.expect("[cohort] 카드 금액 합계 보존", int(out["amount"].sum()), before_sum)
        report.expect("[cohort] 카드 연령대 구간 수", out["age_group"].nunique(), 6)
    return out

def build_card_industry_cohort(
    card: pd.DataFrame,
    report: Report | None = None,
) -> pd.DataFrame:
    """
    업종 축을 유지한 카드 집계표를 만든다.
    단위: "지역 × 날짜 × 업종 × 성별 × 연령대(9구간)"

    왜 별도 테이블인가
    ------------------
    메인 코호트표(build_card_cohort)는 업종을 합쳐버리기 때문에
    "소비처가 편의점 위주로 좁아지는지(업종 다양성)", "병의원·약국 결제 비중 급감" 같은
    업종 기반 지표를 만들 수 없다. 그런 지표를 쓰려면 이 표가 필요하다.

    설계 판단
    ---------
    - 연령대는 **원본 9구간(10~90대)을 유지**한다. 고령 고립 분석에서 70/80/90대를
      '60대이상'으로 묶으면 약국·병의원 패턴의 차이가 사라진다.
      통신 데이터와 비교할 때 쓸 6구간(age_group)은 파생 컬럼으로 함께 넣는다.
    - 거주여부(resident)는 **넣지 않는다**. 업종과 교차하면 셀이 과도하게 희소해지고
      (행 수가 약 65만으로 증가), 거주자/외지인 분석은 메인 코호트표로 충분하다.
    """
    before_sum = int(card["TS_AT"].sum())

    out = (
        card.groupby(
            ["MCT_SGG_CD", "date", "MCT_RY_CD", "SEX_CCD", "AGE_CCD"],
            as_index=False,
        )
        .agg(amount=("TS_AT", "sum"), cnt=("USE_CNT", "sum"))
    )
    out["age_group"] = out["AGE_CCD"].map(unify_age_group)
    out = _attach_industry_group(out)

    if report is not None:
        exp = config.EXPECTED["card"]
        report.expect("[industry] 업종 수", out["MCT_RY_CD"].nunique(), exp["n_industries"])
        report.expect("[industry] 일별 행 수", len(out), exp["industry_daily_rows"])
        report.expect("[industry] 금액 합계 보존", int(out["amount"].sum()), before_sum)
    return out


def aggregate_industry_monthly(
    daily: pd.DataFrame,
    report: Report | None = None,
) -> pd.DataFrame:
    """
    업종 집계표를 월 단위로 접는다.

    업종 다양성 지표를 일별로 계산하면 셀이 희소해 노이즈가 크다(건수 10 미만 셀이 약 9%).
    월 단위는 안정적이고, 통신 데이터(월별)와 시간 해상도가 맞는다는 장점도 있다.
    일별 표에서 파생되므로 정보 손실은 없다.
    """
    out = daily.copy()
    out["STD_YM"] = out["date"].dt.strftime("%Y%m")
    keys = ["MCT_SGG_CD", "STD_YM", "MCT_RY_CD", "SEX_CCD", "AGE_CCD", "age_group"]
    if "industry_group" in out.columns:
        keys.append("industry_group")
    out = out.groupby(keys, as_index=False).agg(
        amount=("amount", "sum"), cnt=("cnt", "sum")
    )

    if report is not None:
        exp = config.EXPECTED["card"]
        report.expect("[industry] 월별 행 수", len(out), exp["industry_monthly_rows"])
        report.expect(
            "[industry] 월별 금액 합계 보존",
            int(out["amount"].sum()),
            int(daily["amount"].sum()),
        )
    return out


def _attach_industry_group(df: pd.DataFrame) -> pd.DataFrame:
    """
    업종 상위 카테고리(industry_group) 컬럼을 붙인다.

    config.INDUSTRY_GROUP_MAP 이 비어 있으면 아무것도 하지 않는다(현재 기본값).
    90종을 어떤 카테고리로 묶을지는 팀 미확정 사항이므로, 확정되면 config 에만
    채워 넣으면 이 컬럼이 자동으로 생긴다. 매핑에 없는 업종은 '미분류'로 들어간다.
    """
    if not config.INDUSTRY_GROUP_MAP:
        return df
    df = df.copy()
    df["industry_group"] = df["MCT_RY_CD"].map(config.INDUSTRY_GROUP_MAP).fillna("미분류")
    return df
