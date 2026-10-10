# -*- coding: utf-8 -*-
"""청년 마스터의 사회활동 건수(cnt_social, region_cnt_social_all) 테스트 — 작은 가짜 업종 표로 돈다.
실행: cd data_preprocessing && python -m unittest discover -s tests -v
"""
import os
import sys
import unittest

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src import config, merge_youth  # noqa: E402

FOOD, CULTURE = config.INDUSTRY_SHARE_GROUPS["food"][0], config.INDUSTRY_SHARE_GROUPS["culture"][0]
CONV, FIXED = config.INDUSTRY_SHARE_GROUPS["convenience"][0], config.FIXED_EXPENSE_CODES[0]


def fake_industry():
    rows = []
    for age, k in (("20대", 1), ("30대", 2), ("60대이상", 10)):
        for code, cnt in ((FOOD, 100), (CULTURE, 20), (CONV, 50), (FIXED, 30)):
            rows.append({"region": "강원 춘천시", "date": "2025-11-03", "sex": "여성", "age_group": age,
                         "MCT_RY_CD": code, "cnt": cnt * k, "amount": cnt * k * 1000})
    return pd.DataFrame(rows)


class SocialCounts(unittest.TestCase):
    def test_cohort_social_is_food_plus_culture(self):
        ind = fake_industry()
        out = merge_youth.build_industry(ind[ind["age_group"].isin(config.YOUTH_AGE_GROUPS)]).set_index("age_group")
        self.assertEqual(out.loc["20대", "cnt_social"], 120)
        self.assertEqual(out.loc["30대", "cnt_social"], 240)

    def test_region_social_covers_all_ages(self):
        r = merge_youth.build_region_total(fake_industry()).iloc[0]
        self.assertEqual(r["region_cnt_social_all"], 120 * (1 + 2 + 10))
        self.assertEqual(r["region_cnt_ex_fixed_all"], 170 * (1 + 2 + 10))      # 고정지출만 빠진다

    def test_social_groups_are_food_and_culture(self):
        self.assertEqual(config.SOCIAL_ACTIVITY_GROUPS, ["food", "culture"])


if __name__ == "__main__":
    unittest.main()
