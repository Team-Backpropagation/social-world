"""
원본 파일 읽기 전용 모듈
====================================
인코딩·구분자 실수가 전처리 사고의 대부분이라, 파일을 읽는 코드는 여기에만 둔다.
다른 모듈은 반드시 이 모듈을 통해서 원본을 읽는다.

핵심 규칙
- 모든 컬럼을 문자(dtype=str)로 읽는다. 숫자로 읽으면 BLOCK_CD(20자리 코드)가
  지수표기(1.123e+19)로 깨지고 앞자리 0이 날아간다. 숫자 변환은 정제 단계에서 한다.
- 통신 파일은 불러올 때 **모든 파일에 일괄로 중복 제거를 적용**한다.
  12월 2개 파일만 특별 취급하면 코드를 다시 돌릴 때 빼먹는다.
"""
from __future__ import annotations

import glob
from pathlib import Path

import pandas as pd

from . import config


# 대회 제공 데이터의 기간: 2025년 7월 ~ 12월
EXPECTED_MONTHS = ("202507", "202508", "202509", "202510", "202511", "202512")


def required_files() -> list[str]:
    """
    파이프라인 실행에 반드시 필요한 원본 파일 목록(19개).

    통신 3종 × 6개월 = 18개 + 카드 데이터2 1개.
    ('데이터1'과 테이블 정의서 xlsx 는 실행에 필요하지 않다)
    """
    names: list[str] = []
    for pattern in config.FLOW_TABLES.values():
        prefix = pattern.replace("*.csv", "")
        names += [f"{prefix}{m}.csv" for m in EXPECTED_MONTHS]
    names.append(config.CARD_FILE)
    return names


def check_data_files() -> tuple[list[str], list[str]]:
    """
    DATA 폴더에 필요한 파일이 다 있는지 점검한다.

    Returns
    -------
    (found, missing) : 각각 파일명 리스트
    """
    found, missing = [], []
    for name in required_files():
        if (config.DATA_DIR / name).exists():
            found.append(name)
        else:
            missing.append(name)
    return found, missing


def load_flow_month(path: str | Path) -> pd.DataFrame:
    """통신(유동인구) 월별 파일 1개를 읽는다."""
    return pd.read_csv(
        path,
        sep=config.FLOW_SEP,
        encoding=config.FLOW_ENCODING,
        dtype=str,
    )


def load_flow_table(pattern: str, verbose: bool = True) -> tuple[pd.DataFrame, list[dict]]:
    """
    통신 테이블 1종(6개월치)을 읽어 중복 제거 후 하나로 합친다.

    Parameters
    ----------
    pattern : 파일 glob 패턴 (예: "flow_age_pop_*.csv")

    Returns
    -------
    (df, dedup_log)
        df        : 6개월 병합 결과
        dedup_log : 중복이 실제로 제거된 파일 목록
                    [{"file":..., "before":..., "after":...}, ...]
    """
    paths = sorted(glob.glob(str(config.DATA_DIR / pattern)))
    if not paths:
        raise FileNotFoundError(
            f"패턴에 맞는 파일이 없습니다: {config.DATA_DIR / pattern}\n"
            f"DATA 폴더 위치를 확인하세요 (환경변수 SS_DATA_DIR 로 지정 가능)."
        )

    frames: list[pd.DataFrame] = []
    dedup_log: list[dict] = []

    for path in paths:
        one = load_flow_month(path)
        before = len(one)
        one = one.drop_duplicates()
        after = len(one)
        if before != after:
            name = Path(path).name
            dedup_log.append({"file": name, "before": before, "after": after})
            if verbose:
                print(f"    [중복제거] {name}: {before:,} → {after:,}")
        frames.append(one)

    df = pd.concat(frames, ignore_index=True)
    del frames  # 메모리 즉시 반환 (통신 데이터는 3종을 동시에 올리면 터진다)
    return df, dedup_log


def load_card(verbose: bool = True) -> pd.DataFrame:
    """
    카드 결제 데이터(주제2 = 우리 트랙)를 읽는다.

    CP949 + 탭 구분자로 읽어야 한다. UTF-8로 열면 '서울 강남구'가 깨지고,
    구분자를 지정하지 않으면 8개 컬럼이 1개로 합쳐져 보인다.
    """
    path = config.DATA_DIR / config.CARD_FILE
    if not path.exists():
        raise FileNotFoundError(
            f"카드 파일이 없습니다: {path}\n"
            f"'데이터1'이 아니라 '{config.CARD_FILE}'(주제2)이 필요합니다."
        )

    df = pd.read_csv(
        path,
        sep=config.CARD_SEP,
        encoding=config.CARD_ENCODING,
        dtype=str,
    )
    if verbose:
        print(f"    불러온 행 수: {len(df):,} / 지역: {sorted(df['MCT_SGG_CD'].unique())}")
    return df
