# -*- coding: utf-8 -*-
"""haru_recommend.py — database/tests/30_haru_test.sql 과 같은 정책 10개(+09 항목)로, run_haru.sh 가 SQL에서 확인한 결과와 같은지 본다
실행: python -m unittest risk_agent.tests.test_haru_recommend"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import haru_recommend as HR  # noqa: E402


def P(serv_id, source, name, sgg, region, stages, themes, menus, groups, online, amin, amax, pop, active=True):
    return {"serv_id": serv_id, "source": source, "name": name, "sgg_code": sgg, "region_label": region,
            "life_stages": stages, "themes": themes, "menus": menus, "target_groups": groups,
            "online_apply": online, "age_min": amin, "age_max": amax, "popularity": pop, "is_active": active}


ROWS = [
    P("C_HOUSE", "central", "청년 월세 지원", None, "전국", ["청년"], ["주거"], ["housing"], [], True, 19, 34, 900),
    P("C_HOUSE2", "central", "전세 대출 이자 지원", None, "전국", ["청년", "중장년"], ["주거"], ["housing"], [], False, None, None, 50),
    P("L_GN_HOUSE", "local", "강남 청년 주거 지원", "11680", "서울특별시 강남구", ["청년"], ["주거"], ["housing"], [], True, 19, 39, 10),
    P("L_CC_HOUSE", "local", "춘천 청년 주거 지원", "51110", "강원특별자치도 춘천시", ["청년"], ["주거"], ["housing"], [], True, 19, 39, 10),
    P("L_GN_BUS", "local", "강남구 교통비 지원", "11680", "서울특별시 강남구", ["아동", "청소년", "청년", "노년"], ["서민금융"], ["living"], [], True, 19, 24, 300),
    P("C_DISAB", "central", "장애인 자립 자금", None, "전국", ["청년", "중장년", "노년"], ["생활지원"], ["living"], ["장애인", "저소득"], True, None, None, 800),
    P("C_SENIOR", "central", "어르신 일자리", None, "전국", ["노년"], ["일자리"], ["job"], [], True, 65, None, 999),
    P("C_JOB", "central", "청년 취업 지원", None, "전국", ["청년"], ["일자리"], ["job"], [], True, 18, 34, 500),
    P("C_OLD", "central", "끝난 사업", None, "전국", ["청년"], ["주거"], ["housing"], [], True, None, None, 1, active=False),
    P("C_MIND", "central", "청년 마음건강", None, "전국", [], ["정신건강"], ["mind"], [], False, None, None, 70),
]
GN = {"sgg_code": "11680", "age_group": "20대"}
CC = {"sgg_code": "51110", "age_group": "30대"}
OT = {"sgg_code": "OTHER", "age_group": "기타"}


def ids(cards):
    return [c["serv_id"] for c in cards]


class SameAsSql(unittest.TestCase):
    """run_haru.sh 의 '정책 고르기'·'개수' 확인 항목과 1:1"""

    def test_order(self):
        self.assertEqual(ids(HR.recommend(ROWS, GN, "housing", 5)), ["L_GN_HOUSE", "C_HOUSE", "C_HOUSE2"])
        self.assertEqual(ids(HR.recommend(ROWS, CC, "housing", 5)), ["L_CC_HOUSE", "C_HOUSE", "C_HOUSE2"])

    def test_age_note(self):
        cards = {c["serv_id"]: c for c in HR.recommend(ROWS, GN, "housing", 5)}
        self.assertTrue(cards["C_HOUSE2"]["age_note"])          # 나이 범위 없음 → 확인
        self.assertFalse(cards["L_GN_HOUSE"]["age_note"])       # 19~39가 20~29를 다 덮음
        bus = HR.recommend(ROWS, GN, "living", 5)[0]
        self.assertTrue(bus["age_note"])
        self.assertIn("나이 조건이 일부만", bus["reason"])

    def test_filters(self):
        self.assertNotIn("L_GN_BUS", ids(HR.recommend(ROWS, CC, "living", 5)))     # 다른 시군구
        self.assertNotIn("C_DISAB", ids(HR.recommend(ROWS, GN, "living", 5)))      # 특정 대상은 기본 카드에 없음
        self.assertEqual(ids(HR.recommend(ROWS, GN, "living", 5, special=True)), ["C_DISAB"])
        self.assertEqual(ids(HR.recommend(ROWS, GN, "job", 5)), ["C_JOB"])         # 65세 이상 빠짐
        self.assertEqual(len(HR.recommend(ROWS, GN, "mind", 5)), 1)                # 생애주기 비어 있으면 거르지 않음
        self.assertEqual(sorted(ids(HR.recommend(ROWS, OT, "job", 5))), ["C_JOB", "C_SENIOR"])

    def test_reason(self):
        self.assertIn("강남구에서 하는 사업이에요 · 청년만을 위한 사업이에요 · 온라인으로", HR.recommend(ROWS, GN, "housing", 1)[0]["reason"])

    def test_counts(self):
        self.assertEqual(HR.counts(ROWS, GN, "job"), {"eligible": 1, "special": 0, "ineligible": 1})
        self.assertEqual(HR.counts(ROWS, GN, "living"), {"eligible": 1, "special": 1, "ineligible": 0})
        self.assertEqual(HR.counts(ROWS, CC, "living")["ineligible"], 0)

    def test_low_income_only_is_not_special(self):                              # run_haru.sh '09:' 항목과 1:1
        rows = ROWS + [P("C_LOWINC", "central", "청년 월세 한시 지원", None, "전국", ["청년"], ["주거"], ["housing"], ["저소득"], True, 19, 34, 5)]
        self.assertEqual(ids(HR.recommend(rows, GN, "housing", 5)), ["L_GN_HOUSE", "C_HOUSE", "C_LOWINC", "C_HOUSE2"])
        low = next(c for c in HR.recommend(rows, GN, "housing", 5) if c["serv_id"] == "C_LOWINC")
        self.assertIn("소득 기준이 있어요", low["reason"])
        self.assertNotIn("C_LOWINC", ids(HR.recommend(rows, GN, "housing", 10, special=True)))
        self.assertEqual(HR.counts(rows, GN, "housing")["eligible"], 4)
        self.assertEqual(HR.counts(rows, GN, "living")["special"], 1)                 # 장애인·저소득은 그대로 특정 대상

    def test_limit(self):
        self.assertEqual(len(HR.recommend(ROWS, GN, "housing", 1)), 1)
        self.assertEqual(len(HR.recommend(ROWS, GN, "housing", 0)), 1)            # SQL: greatest(1, …)


if __name__ == "__main__":
    unittest.main()
