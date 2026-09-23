"""
청년 코호트 이탈 탐지
====================================
`youth_master_daily.csv`를 받아 코호트별 일별 이탈 신호를 만든다.

세 단계다.

1. **요일인자 제거** — baseline 구간에서 코호트×요일 중위수 / 코호트 중위수 비율을
   구해 나눈다. 소비는 달력에 묶여 있어서 이걸 빼지 않으면 매주 일요일이 이상치가 된다.

2. **두 갈래 robust-z** — 기준선을 두 가지로 잡는다. 목적이 다르다.
   - `z_acute`  : 29일 중심 이동중위수 기준. 하루~사흘짜리 급성 이탈(휴일, 충격)을 잡는다.
   - `z_sustain`: baseline 전체 중위수 기준. **수준의 지속적 하락**을 잡는다.
   고립은 급성 사건이 아니라 지속적 위축이므로 `z_sustain` 쪽이 우리 목표에 가깝다.
   이동중위수로 detrend하면 지속 하락이 기준선에 흡수되어 사라진다.

   산포는 **baseline 구간의 MAD만** 사용한다. eval 구간의 변동이 산포에 섞이면
   이상치가 스스로 기준을 넓혀 탐지를 무디게 만든다(마스킹).

3. **대체 동반 여부 분류** — 감소가 감지됐을 때 그것이 어떤 종류의 감소인지 가른다.
   추석 당일을 보면 미용실 0.04배·병원 0.06배로 무너지는 동시에 오락실 1.74배·
   놀이동산 3.35배로 늘었다. 공급이 닫혀서 생긴 감소에는 **대체 증가가 동반**된다.
   위축은 그 대체가 없어야 한다. 이 비대칭이 판별자다.

   `share_remote`(원격·본사귀속)는 판별에 **쓰지 않는다**. 첫 시행에서 위축후보 13건 중
   11건이 원격 비중 상승으로 잡혔는데, 확인해 보니 추석 연휴와 연말에 강남에서
   오프라인이 닫히고 온라인으로 옮겨간 날이었다. 고립한 사람도 온라인을 쓰지만
   휴일에 가게가 닫혀도 온라인을 쓴다. 둘을 구분하지 못하므로 판별자가 될 수 없다.
   게다가 이 값은 강남 0.14~0.31 / 춘천 0.000으로 지역 비대칭이 극단적이다.
   진단용 컬럼으로만 남긴다.

주의: 이 모듈은 라벨이 없는 상태에서 "평소와 다름"을 계산할 뿐이다.
`위축후보`는 고립 판정이 아니라 사람이 확인할 후보 목록이다.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config

COHORT = ["region", "sex", "age_group"]

# 지표별 역할. social = 사회적 활동, survival = 생존·원격 소비
INDICATORS = {
    "cnt_ex_fixed":      "scale",
    "n_eff_offline":     "diversity",
    "share_food":        "social",
    "share_culture":     "social",
    "share_care":        "social",
    "share_mobility":    "social",
    "share_convenience": "survival",
    "share_remote":      "diagnostic",   # 분류에 쓰지 않는다 — 아래 주석 참조
    "share_medical":     "diagnostic",
}

ROLL_WINDOW = 29
ROLL_MIN = 15
Z_THRESHOLD = 3.0        # 이탈 판정 임계값. 팀 미확정 — 민감도는 sensitivity()로 확인
SUB_THRESHOLD = 1.0      # 대체로 인정할 상승 폭


def load_master() -> pd.DataFrame:
    p = config.CLEAN_DIR / "youth_master_daily.csv"
    df = pd.read_csv(p, encoding=config.OUT_ENCODING)
    df["date"] = pd.to_datetime(df["date"])
    return df.sort_values(COHORT + ["date"]).reset_index(drop=True)


def weekday_factors(df: pd.DataFrame, col: str) -> pd.DataFrame:
    """baseline 구간에서 코호트×요일 배수를 구한다. 1.0보다 크면 그 요일이 원래 높다."""
    b = df[df["split"] == "baseline"]
    dow_med = b.groupby(COHORT + ["dow"])[col].median().rename("dow_med").reset_index()
    coh_med = b.groupby(COHORT)[col].median().rename("coh_med").reset_index()
    f = dow_med.merge(coh_med, on=COHORT)
    f["factor"] = (f["dow_med"] / f["coh_med"]).replace([np.inf, -np.inf], np.nan).fillna(1.0)
    return f[COHORT + ["dow", "factor"]]


def deseasonalize(df: pd.DataFrame, col: str) -> pd.Series:
    """요일인자로 나눈 값. 요일 주기가 제거된 시계열."""
    f = weekday_factors(df, col)
    m = df.merge(f, on=COHORT + ["dow"], how="left")
    return (m[col] / m["factor"].where(m["factor"] > 0, 1.0)).to_numpy()


def _robust_z(df: pd.Series, groups: pd.DataFrame, baseline_mask: pd.Series,
              center: pd.Series) -> pd.Series:
    """중심값 대비 편차를 baseline MAD로 표준화한다."""
    resid = df - center
    g = resid.groupby([groups[c] for c in COHORT])
    # 산포는 baseline만 사용
    bl = resid.where(baseline_mask)
    mad = bl.groupby([groups[c] for c in COHORT]).transform(
        lambda s: (s - s.median()).abs().median()
    )
    scale = 1.4826 * mad
    return (resid / scale.where(scale > 0, np.nan))


def build_signals(df: pd.DataFrame | None = None) -> pd.DataFrame:
    df = load_master() if df is None else df.copy()
    base = df["split"].eq("baseline")
    out = df[COHORT + ["date", "split", "dow", "is_weekend", "chuncheon_term_flag"]].copy()

    for col in INDICATORS:
        adj = pd.Series(deseasonalize(df, col), index=df.index)
        out[f"{col}_adj"] = adj.round(4)

        # 급성: 29일 중심 이동중위수 기준
        roll = adj.groupby([df[c] for c in COHORT]).transform(
            lambda s: s.rolling(ROLL_WINDOW, center=True, min_periods=ROLL_MIN).median()
        )
        out[f"z_acute_{col}"] = _robust_z(adj, df, base, roll).round(2)

        # 지속: baseline 전체 중위수 기준
        bmed = adj.where(base).groupby([df[c] for c in COHORT]).transform("median")
        out[f"z_sustain_{col}"] = _robust_z(adj, df, base, bmed).round(2)

    return out


def classify(sig: pd.DataFrame, kind: str = "sustain",
             z_th: float = Z_THRESHOLD, sub_th: float = SUB_THRESHOLD) -> pd.DataFrame:
    """
    감소 신호를 네 갈래로 나눈다.

    - `대체동반감소` : 활동이 줄었지만 사회적 활동군 어딘가가 올랐다 → 공급 폐쇄·휴일 등 외부 요인
    - `위축후보`     : 사회적 활동군이 내리고 생존·원격군만 올랐다 → 사람이 확인할 후보
    - `전반감소`     : 줄었으나 구성 변화가 뚜렷하지 않다
    - `정상`         : 임계값 미달
    """
    p = f"z_{kind}_"
    social = [f"{p}{c}" for c, r in INDICATORS.items() if r == "social"]
    survival = [f"{p}{c}" for c, r in INDICATORS.items() if r == "survival"]

    out = sig.copy()
    # 규모가 급증한 날은 감소로 보지 않는다. 다양성만 좁아진 날은 규모가 늘지 않았을 때만 센다
    # (편의점·배달로 대체되면 건수는 유지되고 업종만 좁아지므로 규모 하락을 필수로 걸지 않는다).
    dropped = out[f"{p}cnt_ex_fixed"].le(-z_th) | (
        out[f"{p}n_eff_offline"].le(-z_th) & out[f"{p}cnt_ex_fixed"].le(1.0)
    )
    social_up = out[social].max(axis=1).ge(sub_th)
    social_dn = out[social].min(axis=1).le(-sub_th)
    survival_up = out[survival].max(axis=1).ge(sub_th)

    out[f"class_{kind}"] = np.select(
        [
            dropped & social_up,
            dropped & social_dn & survival_up,
            dropped,
        ],
        ["대체동반감소", "위축후보", "전반감소"],
        default="정상",
    )
    return out


def sensitivity(sig: pd.DataFrame, kind: str = "sustain") -> pd.DataFrame:
    """임계값을 바꿔가며 탐지 건수가 어떻게 변하는지 본다. 3.5 확정 전 근거용."""
    rows = []
    for th in (2.5, 3.0, 3.5, 4.0):
        c = classify(sig, kind=kind, z_th=th)
        v = c[f"class_{kind}"].value_counts()
        rows.append({
            "임계값": th,
            "위축후보": int(v.get("위축후보", 0)),
            "대체동반감소": int(v.get("대체동반감소", 0)),
            "전반감소": int(v.get("전반감소", 0)),
            "정상": int(v.get("정상", 0)),
        })
    return pd.DataFrame(rows)


def save(sig: pd.DataFrame) -> "object":
    config.CLEAN_DIR.mkdir(parents=True, exist_ok=True)
    path = config.CLEAN_DIR / "youth_signals_daily.csv"
    sig.to_csv(path, index=False, encoding=config.OUT_ENCODING)
    return path
