"""
카드 결제 데이터 정제
====================================
처리 순서: 불러오기 → '정보없음' 결측 변환 → 타입 변환 → 무결성 검증 → 거주자 구분

주의
- CLN_SGG_CD(고객 거주지)의 결측은 NULL이 아니라 '정보없음' 문자열이다.
  그대로 두면 지역 목록을 뽑을 때 하나의 지역처럼 끼어든다.
- 거주자/외지인 비중은 **행 수로 계산하면 안 된다.** 한 행은
  (날짜 × 지역 × 업종 × 고객거주지 × 성별 × 연령대) 조합 하나이므로
  행 수는 조합의 가짓수일 뿐 소비 규모가 아니다. 금액·건수 기준으로 봐야 한다.
- 고객 거주지는 시·도 단위라 '강남구 주민'이 아니라 '서울 거주자'까지만 구분된다.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config, loaders
from .validate import Report


def normalize_missing(df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """CLN_SGG_CD 의 '정보없음' 문자열을 결측(NA)으로 바꾼다."""
    df = df.copy()
    n = int((df["CLN_SGG_CD"] == config.MISSING_TOKEN).sum())
    df["CLN_SGG_CD"] = df["CLN_SGG_CD"].replace(config.MISSING_TOKEN, pd.NA)
    return df, n


def cast_types(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """금액·건수를 숫자로, 기준일자를 날짜로 변환한다."""
    df = df.copy()
    df["TS_AT"] = pd.to_numeric(df["TS_AT"], errors="coerce")
    df["USE_CNT"] = pd.to_numeric(df["USE_CNT"], errors="coerce")
    df["date"] = pd.to_datetime(df["TA_YMD"], format="%Y%m%d")

    info = {
        "amount_failures": int(df["TS_AT"].isna().sum()),
        "count_failures": int(df["USE_CNT"].isna().sum()),
        "date_min": df["date"].min().date().isoformat(),
        "date_max": df["date"].max().date().isoformat(),
        "n_dates": int(df["date"].nunique()),
    }
    return df, info


def check_integrity(df: pd.DataFrame) -> dict:
    """
    데이터 무결성 확인 (고치지 않고 확인만 한다).

    - 법인카드: 주제2 스키마는 법인 제외가 정상. 남아있으면 잘못된 파일을 읽은 것.
    - PK 중복: 이미 집계된 테이블이므로 조합이 유일해야 한다.
    """
    has_corporate = "법인" in set(df["SEX_CCD"].unique())
    if has_corporate:
        raise ValueError(
            "법인카드 행이 섞여 있습니다. '데이터1'(주제1 트랙) 파일을 읽고 있는지 확인하세요."
        )
    return {
        "has_corporate": has_corporate,
        "pk_duplicates": int(df.duplicated(subset=config.CARD_PK, keep=False).sum()),
    }


def add_resident(df: pd.DataFrame) -> pd.DataFrame:
    """
    거주자 / 외지인 / 모름 구분 컬럼을 추가한다.

    apply(axis=1) 로 하면 180만 행을 한 줄씩 처리해 매우 느리다.
    np.where 로 컬럼 단위 연산을 하면 순식간에 끝난다.
    """
    df = df.copy()
    expected_sido = df["MCT_SGG_CD"].map(config.SIDO_OF)
    df["resident"] = np.where(
        df["CLN_SGG_CD"].isna(),
        "모름",
        np.where(df["CLN_SGG_CD"] == expected_sido, "거주자", "외지인"),
    )
    return df


def clean_card(report: Report | None = None) -> tuple[pd.DataFrame, dict]:
    """카드 데이터를 정제해 DataFrame과 요약을 돌려준다(저장은 코호트 단계에서)."""
    print("  [card] 불러오기")
    df = loaders.load_card()
    raw_rows = len(df)

    df, n_missing = normalize_missing(df)
    df, type_info = cast_types(df)
    integrity = check_integrity(df)
    df = add_resident(df)

    resident_counts = df["resident"].value_counts().to_dict()
    summary = {
        "raw_rows": raw_rows,
        "missing_token_rows": n_missing,
        "missing_pct": n_missing / raw_rows * 100,
        "resident_counts": resident_counts,
        "amount_sum": int(df["TS_AT"].sum()),
        **type_info,
        **integrity,
    }

    if report is not None:
        exp = config.EXPECTED["card"]
        report.expect("[card] 원본 행 수", raw_rows, exp["raw_rows"])
        report.expect("[card] '정보없음' 행 수", n_missing, exp["missing_token_rows"])
        report.expect("[card] 금액 변환 실패", type_info["amount_failures"], 0)
        report.expect("[card] 건수 변환 실패", type_info["count_failures"], 0)
        report.expect("[card] 날짜 수", type_info["n_dates"], exp["n_dates"])
        report.expect("[card] PK 중복", integrity["pk_duplicates"], exp["pk_duplicates"])
        for key, want in exp["resident_counts"].items():
            report.expect(f"[card] 거주여부 {key}", int(resident_counts.get(key, 0)), want)

    return df, summary
