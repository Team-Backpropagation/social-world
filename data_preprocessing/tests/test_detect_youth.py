# -*- coding: utf-8 -*-
"""청년 이탈 탐지(detect_youth) 성질 테스트 — 합성 마스터로 돈다. 원본 DATA 없이 실행된다.
실행: cd data_preprocessing && python -m unittest discover -s tests -v
"""
import os
import sys
import unittest

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src import config, detect_youth as D, merge_youth  # noqa: E402

SHARES = {"food": 0.30, "culture": 0.08, "care": 0.10, "mobility": 0.07,
          "convenience": 0.10, "remote": 0.15, "medical": 0.05}
COHORTS = [("서울 강남구", "남성", "20대"), ("강원 춘천시", "여성", "30대")]
A = COHORTS[0]


def fake_master(seed=0):
    """요일 주기와 3% 안팎의 흔들림만 있는 평범한 청년 마스터."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2025-07-01", "2025-12-31", freq="D")
    rows = []
    for region, sex, age in COHORTS:
        dow_f = np.array([1.0, 1.0, 1.02, 1.05, 1.15, 1.1, 0.85])[dates.dayofweek]
        cnt_all = 10000 * dow_f * (1 + rng.normal(0, 0.03, len(dates)))
        df = pd.DataFrame({"region": region, "sex": sex, "age_group": age, "date": dates,
                           "cnt_all": cnt_all, "cnt_ex_fixed": 0.9 * cnt_all,
                           "n_eff_offline": 25 * (1 + rng.normal(0, 0.02, len(dates))),
                           "chuncheon_term_flag": 0})
        for k, v in SHARES.items():
            df[f"share_{k}"] = v * (1 + rng.normal(0, 0.03, len(dates)))
        rows.append(df)
    df = pd.concat(rows, ignore_index=True)
    df = merge_youth.add_calendar(df)
    df["chuncheon_term_flag"] = 0
    return df


def reshape(df, cohort, start, days, total=1.0, groups=None):
    """cohort의 start부터 days일 동안 업종군별 건수를 groups 배수로 바꾸고(나머지는 total 배수) 비중을 다시 계산한다."""
    groups = groups or {}
    m = (df["region"] == cohort[0]) & (df["sex"] == cohort[1]) & (df["age_group"] == cohort[2])
    m &= df["date"].between(pd.Timestamp(start), pd.Timestamp(start) + pd.Timedelta(days=days - 1))
    rest = 1 - sum(SHARES.values())
    counts = {k: df.loc[m, f"share_{k}"] * df.loc[m, "cnt_all"] * groups.get(k, total) for k in SHARES}
    new_all = sum(counts.values()) + rest * df.loc[m, "cnt_all"] * total
    for k in SHARES:
        df.loc[m, f"share_{k}"] = counts[k] / new_all
    df.loc[m, "cnt_ex_fixed"] = df.loc[m, "cnt_ex_fixed"] * new_all / df.loc[m, "cnt_all"]
    df.loc[m, "cnt_all"] = new_all
    return df


WITHDRAW = dict(total=0.7, groups={"food": 0.5, "culture": 0.5, "care": 0.5, "mobility": 0.5, "convenience": 1.0})


def judge(df, mode="prospective"):
    sig = D.build_signals(df, mode=mode)
    return D.classify(D.classify(sig, "sustain"), "acute")


def on(sig, cohort, day):
    r = sig[(sig["region"] == cohort[0]) & (sig["sex"] == cohort[1]) & (sig["age_group"] == cohort[2])
            & (sig["date"] == pd.Timestamp(day))]
    return r.iloc[0]


class Baseline(unittest.TestCase):
    def test_plain_data_has_no_candidates(self):
        for seed in (0, 1, 2):
            c = judge(fake_master(seed))["class_sustain"]
            self.assertEqual(int(c.eq("위축후보").sum()), 0, f"seed {seed}")
            self.assertEqual(int(c.eq(D.HOLD).sum()), 0, f"seed {seed}")


    def test_row_order_does_not_matter(self):
        df = reshape(fake_master(), A, "2025-11-17", 10, **WITHDRAW)
        a = judge(df)
        b = judge(df.sample(frac=1, random_state=3)).loc[a.index]
        pd.testing.assert_frame_equal(a, b)


class Persistence(unittest.TestCase):
    """하루짜리 위축 모양은 위축후보가 아니다(지난 7일 중 5일 이상이어야 한다)."""

    def test_one_day_is_short_not_candidate(self):
        sig = judge(reshape(fake_master(), A, "2025-11-19", 1, **WITHDRAW))
        self.assertEqual(on(sig, A, "2025-11-19")["class_sustain"], "단기위축")

    def test_lasting_withdrawal_becomes_candidate_from_day_five(self):
        sig = judge(reshape(fake_master(), A, "2025-11-17", 10, **WITHDRAW))
        self.assertEqual(on(sig, A, "2025-11-20")["class_sustain"], "단기위축")   # 4일째
        self.assertEqual(on(sig, A, "2025-11-21")["class_sustain"], "위축후보")   # 5일째
        self.assertEqual(on(sig, A, "2025-11-26")["class_sustain"], "위축후보")

    def test_persistence_can_be_turned_off(self):
        sig = D.classify(D.build_signals(reshape(fake_master(), A, "2025-11-19", 1, **WITHDRAW)), persist=None)
        self.assertEqual(on(sig, A, "2025-11-19")["class_sustain"], "위축후보")


class SubstitutionNeedsRealCounts(unittest.TestCase):
    def test_share_rise_without_count_rise_is_composition_change(self):
        """전체가 30% 줄고 외식 건수는 그대로 → 외식 비중만 오른다. 대체가 아니다."""
        sig = judge(reshape(fake_master(), A, "2025-11-19", 1, total=0.7, groups={"food": 1.0}))
        r = on(sig, A, "2025-11-19")
        self.assertGreater(r["z_sustain_share_food"], D.SUB_THRESHOLD)
        self.assertLess(r["z_sustain_cnt_grp_food"], D.SUB_THRESHOLD)
        self.assertEqual(r["class_sustain"], "구성변화감소")

    def test_real_count_rise_is_substitution(self):
        """전체는 줄었지만 문화 건수가 실제로 2배 → 휴일·폐점형 감소."""
        sig = judge(reshape(fake_master(), A, "2025-11-19", 1, total=0.6, groups={"culture": 2.0}))
        self.assertEqual(on(sig, A, "2025-11-19")["class_sustain"], "대체동반감소")


class HoldAndRounding(unittest.TestCase):
    def test_zero_spread_is_hold_not_normal(self):
        df = fake_master()
        m = df["region"] == A[0]
        df.loc[m, "cnt_ex_fixed"] = 9000.0
        df.loc[m, "cnt_all"] = 10000.0
        df.loc[m, "n_eff_offline"] = 25.0
        c = judge(df)
        self.assertTrue(c.loc[m, "class_sustain"].eq(D.HOLD).all())
        self.assertFalse(c.loc[~m, "class_sustain"].eq(D.HOLD).any())

    def test_signals_are_not_rounded_before_classify(self):
        sig = D.build_signals(fake_master())
        z = sig["z_sustain_cnt_ex_fixed"].dropna()
        self.assertFalse(np.allclose(z, z.round(2)))


class NoFutureInformation(unittest.TestCase):
    """prospective(기본)는 그날까지의 자료만 쓴다. 미래를 바꿔도 과거 값은 그대로여야 한다."""

    def _change_future(self, df, cut):
        df = df.copy()
        late = df["date"] > pd.Timestamp(cut)
        df.loc[late, ["cnt_all", "cnt_ex_fixed"]] *= 0.3
        return df

    def test_prospective_past_unchanged(self):
        cut = "2025-11-20"
        a, b = judge(fake_master()), judge(self._change_future(fake_master(), cut))
        past = a["date"] <= pd.Timestamp(cut)
        cols = [c for c in a.columns if c.startswith("z_") or c.startswith("class_")]
        pd.testing.assert_frame_equal(a.loc[past, cols], b.loc[past, cols])

    def test_retrospective_does_look_ahead(self):
        """대조군: 사후 분석(앞뒤 29일)은 미래가 바뀌면 직전 날짜의 급성 이상도가 바뀐다."""
        cut = "2025-11-20"
        a = judge(fake_master(), mode="retrospective")
        b = judge(self._change_future(fake_master(), cut), mode="retrospective")
        past = a["date"] <= pd.Timestamp(cut)
        self.assertFalse(np.allclose(a.loc[past, "z_acute_cnt_ex_fixed"], b.loc[past, "z_acute_cnt_ex_fixed"],
                                     equal_nan=True))

    def test_bad_mode_rejected(self):
        with self.assertRaises(ValueError):
            D.build_signals(fake_master(), mode="centered")


class BaselineEndIsPassedThrough(unittest.TestCase):
    def test_youth_split_follows_baseline_end(self):
        df = fake_master()[["region", "sex", "age_group", "date"]]
        default = merge_youth.add_calendar(df.copy())
        moved = merge_youth.add_calendar(df.copy(), baseline_end="2025-09-30")
        d = pd.Timestamp("2025-10-15")
        self.assertEqual(default.loc[default["date"] == d, "split"].iloc[0], "baseline")
        self.assertEqual(moved.loc[moved["date"] == d, "split"].iloc[0], "eval")
        self.assertEqual(config.BASELINE_END, "2025-10-31")


if __name__ == "__main__":
    unittest.main()
