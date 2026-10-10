# -*- coding: utf-8 -*-
"""판정기(4단계 상태) 성질 테스트 — 합성 시나리오로 돈다. DB·원자료 없이 실행된다.
실행: cd risk_agent && python -m unittest tests.test_judgment -v
"""
import os
import sys
import unittest
from datetime import date

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import config as C          # noqa: E402
import pipeline as P        # noqa: E402
import scenarios as S       # noqa: E402

COLS = ["cohort_id", "status", "trigger_z", "baseline_z", "event_beta", "micro_severity"]


def judge(s, **kw):
    kw.setdefault("region_ref", s.get("region_ref"))
    return P.judge(s["persona_table"], s["flow"], s["card"], s["psych"], **kw).set_index("cohort_id")


class NoForcedAlerts(unittest.TestCase):
    """분위수 방식은 정상만 있어도 상위 20%를 '위험'으로 만들었다. 새 방식은 그러면 안 된다."""

    def test_all_normal_gives_no_check(self):
        for seed in (101, 102, 103):
            j = judge(S.scenario("S0_all_normal", seed))
            self.assertEqual((j["status"] == "check").sum(), 0, f"seed {seed}")

    def test_constant_data_is_hold_not_alert(self):
        s = S.scenario("S0_all_normal", 101)
        s["card"]["use_cnt"] = 1000
        s["flow"]["flow_pop"] = 100000
        s["psych"] = s["psych"].iloc[0:0]
        j = judge(s)
        self.assertTrue((j["status"] == "hold").all())      # 흔들림이 0이면 판단할 수 없다 → 판단보류

    def test_too_little_data_is_hold(self):
        s = S.scenario("S1_default", 101)
        cid = "11680-M-20대"
        s["card"] = s["card"][~((s["card"]["cohort_id"] == cid) & (s["card"]["ta_ymd"] < "2025-10-10"))]
        self.assertEqual(judge(s).loc[cid, "status"], "hold")

    def test_planted_patterns_found(self):
        j = judge(S.scenario("S1_default", 101))
        self.assertEqual(j.loc["11680-M-20대", "status"], "check")   # 카드 소비 위축
        self.assertEqual(j.loc["51110-M-40대", "status"], "check")   # 명절 무반응
        self.assertEqual(j.loc["11680-F-20대", "status"], "check")   # 대화 심각도


class Invariance(unittest.TestCase):
    def test_row_order_does_not_matter(self):
        s = S.scenario("S1_default", 101)
        a = judge(s)[COLS[1:]]
        rng = np.random.default_rng(0)
        for k in ("card", "flow", "psych"):
            s[k] = s[k].sample(frac=1, random_state=rng.integers(1 << 31)).reset_index(drop=True)
        s["persona_table"] = list(reversed(s["persona_table"]))
        b = judge(s)[COLS[1:]].loc[a.index]
        self.assertTrue((a["status"] == b["status"]).all())
        np.testing.assert_allclose(a[COLS[2:]].to_numpy(float), b[COLS[2:]].to_numpy(float), equal_nan=True)

    def test_future_data_does_not_change_past_judgment(self):
        """as_of 이후 자료를 아무리 바꿔도 as_of 시점 판정은 같아야 한다(미래 정보 미사용)."""
        as_of = date(2025, 12, 5)
        s = S.scenario("S1_default", 102)
        a = judge(s, as_of=as_of)
        fut = s["card"]["ta_ymd"] > as_of.isoformat()
        s["card"].loc[fut, "use_cnt"] = (s["card"].loc[fut, "use_cnt"] * 0.3).round().astype("int64")
        dec = s["flow"]["std_ym"] == "2025-12"
        s["flow"].loc[dec, "flow_pop"] = (s["flow"].loc[dec, "flow_pop"] * 0.5).round().astype("int64")
        s["psych"].loc[s["psych"]["measured_month"] == "2025-12", "severity_score"] = 0.99
        b = judge(s, as_of=as_of)
        self.assertTrue((a["status"] == b["status"]).all())
        np.testing.assert_allclose(a[COLS[2:]].to_numpy(float), b[COLS[2:]].to_numpy(float), equal_nan=True)

    def test_prospective_trend_ignores_future(self):
        s = S.scenario("S1_default", 101)
        card = P.add_date_split_label(s["card"])
        a = P.detect_card_anomalies(card, mode="prospective")
        cut = date(2025, 11, 20)
        card2 = card.copy()
        late = card2["ta_ymd"] > cut
        card2.loc[late, "use_cnt"] = (card2.loc[late, "use_cnt"] * 0.2).round().astype("int64")
        b = P.detect_card_anomalies(card2, mode="prospective")
        past = a["ta_ymd"] <= cut
        np.testing.assert_allclose(a.loc[past, "robust_z"].to_numpy(float), b.loc[past, "robust_z"].to_numpy(float),
                                   equal_nan=True)


class CommonShockAndShortDips(unittest.TestCase):
    def test_region_wide_drop_is_not_an_alert(self):
        j = judge(S.scenario("S3_region_common", 101))
        self.assertEqual((j["status"] == "check").sum(), 0)

    def test_one_week_dip_is_not_an_alert(self):
        j = judge(S.scenario("S3_short_dip", 101))
        self.assertEqual((j["status"] == "check").sum(), 0)


class RegionReference(unittest.TestCase):
    """2026-10-09 실데이터에서 춘천 청년 4개가 전부 확인권장이 된 문제의 재발 방지."""

    def test_youth_groups_moving_opposite_are_not_alerts(self):
        for seed in (101, 102):
            j = judge(S.scenario("S6_youth_mixed", seed))
            self.assertEqual((j["status"] == "check").sum(), 0, f"seed {seed}")

    def test_region_reference_removes_peer_distortion(self):
        """지역 기준 없이 청년끼리만 비교하면 춘천 30대의 '지역 공통 변화'가 20대 학기 효과에 끌려 올라간다(대조군).
        이 왜곡이 그대로면 30대의 평범한 수준이 '지역보다 낮음'으로 읽힌다 — 10/9 실데이터에서 생긴 문제."""
        cids = ["51110-M-30대", "51110-F-30대"]
        for seed in (101, 102):
            ref = judge(S.scenario("S6_youth_mixed", seed)).loc[cids, "card_region_pct"]
            noref = judge(S.scenario("S6_youth_mixed_noref", seed)).loc[cids, "card_region_pct"]
            self.assertTrue((noref - ref > 0.03).all(), f"seed {seed}: ref={ref.tolist()} noref={noref.tolist()}")

    def test_opposite_big_move_is_not_unresponsive(self):
        """명절에 반대로 크게 움직인 집단(춘천 20대 귀성)은 β가 낮아도 '무반응'이 아니다."""
        j = judge(S.scenario("S6_youth_mixed", 102))
        for cid in ("51110-M-20대", "51110-F-20대"):
            self.assertGreater(j.loc[cid, "event_own_move"], C.JUDGMENT["event"]["max_own_move"])
            self.assertNotIn("event_beta", j.loc[cid, "alert_signals"])


class FlowIsBackgroundOnly(unittest.TestCase):
    def test_flow_alone_never_checks(self):
        s = S.scenario("S0_all_normal", 101)
        cid = "51110-F-60대이상"
        m = (s["flow"]["cohort_id"] == cid) & s["flow"]["std_ym"].isin(["2025-11", "2025-12"])
        s["flow"].loc[m, "flow_pop"] = (s["flow"].loc[m, "flow_pop"] * 0.6).round().astype("int64")  # 유동인구만 40% 급감
        j = judge(s)
        self.assertGreater(j.loc[cid, "baseline_z"], C.JUDGMENT["flow"]["alert"])
        self.assertEqual(j.loc[cid, "status"], "watch")


if __name__ == "__main__":
    unittest.main()
