"""
분할기준 (baseline / event / eval)
====================================
데이터를 파일로 쪼개지 않고 **이름표 컬럼(split)만** 붙인다.
기간 경계를 바꿔 실험할 때 이 단계만 다시 돌리면 되기 때문이다.

설계 근거 (자세한 내용은 '데이터_전처리_가이드맵.md' 2장 참고)
- 개인 단위 정답 라벨이 없으므로 "평상시 대비 이탈"을 보는 접근을 쓴다.
  → 앞 기간에서 평상시 프로파일을 추정(baseline), 뒤 기간에서 이탈을 평가(eval).
- 시간 순서가 있는 데이터이므로 무작위 분할(train_test_split)은 금지.
  미래 정보가 과거 판단에 새어들어가 성능이 실제보다 좋게 나온다.
- 강남구·춘천시는 성격이 다른 지역이므로 하나로 합치지 않는다.
  집계·기준 산정 시 groupby 에 지역을 항상 포함한다.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config
from .validate import Report


def event_mask(dates: pd.Series, periods: list | None = None) -> pd.Series:
    """config.EVENT_PERIODS 구간에 속하는 날짜를 True로 표시한다."""
    periods = periods if periods is not None else config.EVENT_PERIODS
    mask = pd.Series(False, index=dates.index)
    for start, end, _name in periods:
        mask |= dates.between(start, end)
    return mask


def add_split_label(
    df: pd.DataFrame,
    date_col: str = "date",
    baseline_end: str | None = None,
    apply_events: bool = True,
) -> pd.DataFrame:
    """
    날짜를 baseline / event / eval 세 구간으로 라벨링한다.

    - event    : config.EVENT_PERIODS 구간 (명절·연말 등). 반응도 측정 대상.
    - baseline : event를 제외하고 기준일 이전. 평상시 프로파일 산정용.
    - eval     : event를 제외하고 기준일 이후. 이탈 탐지 검증용.

    apply_events=False 로 주면 기존 2분할 방식으로 동작한다(비교 실험용).
    """
    end = baseline_end or config.BASELINE_END
    df = df.copy()
    is_event = (event_mask(df[date_col]) if apply_events
                else pd.Series(False, index=df.index))
    df["split"] = np.where(
        is_event, "event",
        np.where(df[date_col].le(end), "baseline", "eval"),
    )
    return df


def summarize_split(
    df: pd.DataFrame,
    date_col: str = "date",
    report: Report | None = None,
) -> pd.DataFrame:
    """분할 결과 요약(구간별 시작일·종료일·일수)을 돌려준다."""
    order = [s for s in ["baseline", "event", "eval"] if s in set(df["split"])]
    summary = (
        df.groupby("split")[date_col]
        .agg(start="min", end="max", days="nunique", rows="count")
        .reindex(order)
    )

    if report is not None:
        exp = config.EXPECTED["split"]
        for name in order:
            key = f"{name}_days"
            if key in exp:
                report.expect(f"[split] {name} 일수",
                              int(summary.loc[name, "days"]), exp[key])
    return summary


def assert_no_random_split(used_random_split: bool = False) -> None:
    """
    무작위 분할을 쓰지 않았음을 코드로 남겨두는 표식.

    누군가 sklearn.train_test_split 으로 바꾸고 싶어질 때 이 함수를 보고 멈추게 하는 용도다.
    시계열 데이터에서 무작위 분할은 미래 정보 유입(leakage)이며, 심사에서 가장 지적받기 쉽다.
    """
    if used_random_split:
        raise AssertionError(
            "시계열 데이터에 무작위 분할을 적용했습니다. "
            "기간 기준(add_split_label) 또는 walk-forward 방식을 사용하세요."
        )
