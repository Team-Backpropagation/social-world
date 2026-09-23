"""
통신(유동인구) 데이터 정제
====================================
처리 순서: 불러오기(+중복제거) → 지역코드 부여 → 대상지역 필터 → 숫자 변환 → 저장

메모리 주의
- 통신 3종을 동시에 메모리에 올리면 터진다(RAM 4GB 환경에서 실측 확인).
  이 모듈의 clean_flow_table() 은 테이블 1종만 처리하고 함수를 벗어날 때
  큰 DataFrame을 반환하지 않는다. 반환하는 것은 지역·월 단위로 집계한 작은 표뿐이다.
"""
from __future__ import annotations

import pandas as pd

from . import config, loaders
from .validate import Report


def value_columns(df: pd.DataFrame) -> list[str]:
    """
    수치 컬럼 목록을 돌려준다.

    - 성연령: MAN_FLOW_POP_CNT_10G ... WMAN_FLOW_POP_CNT_60GU (12개)
    - 시간대: TMST_00 ... TMST_23 (24개)
    - 요일  : FLOW_POP_CNT_MON ... FLOW_POP_CNT_SUN (7개)
    """
    return [c for c in df.columns if ("FLOW_POP_CNT" in c) or c.startswith("TMST_")]


def add_region(df: pd.DataFrame) -> pd.DataFrame:
    """BLOCK_CD 앞 5자리로 region 컬럼을 만든다. 대상 외 지역은 NaN."""
    df = df.copy()
    df["region_code"] = df["BLOCK_CD"].str[:5]
    df["region"] = df["region_code"].map(config.REGION_MAP)
    return df


def filter_target_region(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """
    강남구·춘천시 격자만 남긴다.

    제외되는 것은 격자가 인접 시군구 경계에 걸친 셀(전체의 0.1% 미만)이다.
    제외 행 수는 보고서에 명시해야 하므로 stats 로 함께 돌려준다.
    """
    before = len(df)
    ratio = float(df["region"].isna().mean() * 100)
    out = df[df["region"].notna()].copy()
    stats = {
        "merged_rows": before,
        "filtered_rows": len(out),
        "excluded_rows": before - len(out),
        "excluded_pct": ratio,
    }
    return out, stats


def to_numeric(df: pd.DataFrame, cols: list[str]) -> tuple[pd.DataFrame, int]:
    """
    수치 컬럼을 숫자로 변환한다.

    주의: 값이 0인 칸은 결측이 아니다. "그 시간·연령대에 사람이 거의 없었다"는
    실제 관측값이므로 제거하거나 다른 값으로 채우지 않는다.
    """
    df = df.copy()
    for c in cols:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    n_fail = int(df[cols].isna().sum().sum())
    return df, n_fail


def aggregate_region_month(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """
    격자 단위를 지역×월 단위로 합친다(12행).

    코호트 변환(melt) 전에 반드시 이 집계를 먼저 해야 한다.
    먼저 melt하면 행이 715만 개로 불어나 메모리가 터진다(실측 확인).
    """
    return df.groupby(["region", "STD_YM"], as_index=False)[cols].sum()


def clean_flow_table(
    name: str,
    save: bool = True,
    report: Report | None = None,
) -> tuple[dict, pd.DataFrame]:
    """
    통신 테이블 1종을 정제해 저장한다.

    Parameters
    ----------
    name   : "age" | "time" | "wkdy"
    save   : clean/flow_{name}.csv 로 저장할지 여부
    report : 검증 리포트(있으면 기대값 대조 결과를 기록)

    Returns
    -------
    (summary, wide)
        summary : 행 수·제외 수 등 요약 dict
        wide    : 지역×월 집계표(작음). age 의 경우 코호트 변환의 입력이 된다.
    """
    pattern = config.FLOW_TABLES[name]
    print(f"  [{name}] 불러오기: {pattern}")

    df, dedup_log = loaders.load_flow_table(pattern)
    merged_rows = len(df)

    df = add_region(df)
    df, stats = filter_target_region(df)

    cols = value_columns(df)
    df, n_fail = to_numeric(df, cols)

    wide = aggregate_region_month(df, cols)

    summary = {
        "table": name,
        "dedup_files": len(dedup_log),
        "dedup_detail": dedup_log,
        "value_cols": len(cols),
        "numeric_failures": n_fail,
        "value_sum": float(df[cols].sum().sum()),
        **stats,
    }

    if save:
        config.CLEAN_DIR.mkdir(parents=True, exist_ok=True)
        out_path = config.CLEAN_DIR / f"flow_{name}.csv"
        df.to_csv(out_path, index=False, encoding=config.OUT_ENCODING)
        summary["saved"] = str(out_path)
        print(f"    저장: {out_path.name} ({len(df):,}행 × {df.shape[1]}열)")

        # 지역·월 배경지표 (v0 필수 산출물은 아니지만 이후 분석에 바로 쓰인다)
        bg_path = config.CLEAN_DIR / f"flow_{name}_region_month.csv"
        wide.to_csv(bg_path, index=False, encoding=config.OUT_ENCODING)
        print(f"    저장: {bg_path.name} ({len(wide):,}행, 지역×월 배경지표)")

    if report is not None:
        exp = config.EXPECTED["flow"][name]
        report.expect(f"[{name}] 병합 행 수", merged_rows, exp["merged_rows"])
        report.expect(f"[{name}] 필터 후 행 수", stats["filtered_rows"], exp["filtered_rows"])
        report.expect(f"[{name}] 제외 행 수", stats["excluded_rows"], exp["excluded_rows"])
        report.expect(f"[{name}] 수치 컬럼 수", len(cols), exp["value_cols"])
        report.expect(f"[{name}] 중복 파일 수", len(dedup_log), exp["dedup_files"])
        report.expect(f"[{name}] 숫자 변환 실패", n_fail, 0)
        if "value_sum" in exp:
            report.expect(f"[{name}] 유동인구 합계", summary["value_sum"], exp["value_sum"], tol=0.05)

    del df  # 다음 테이블을 처리하기 전에 메모리 반환
    return summary, wide
