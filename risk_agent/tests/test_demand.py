# -*- coding: utf-8 -*-
"""하루·코코 수요 요약(supabase_sync.fetch_demand·demand_summary·합성 배경) — DB 없이
실행: python -m unittest risk_agent.tests.test_demand"""
import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import supabase_sync as S  # noqa: E402
import config as C  # noqa: E402

PT = [{"cohort_id": "11680-F-20대", "sgg_code": "11680", "gender": "F", "age_group": "20대"},
      {"cohort_id": "51110-M-30대", "sgg_code": "51110", "gender": "M", "age_group": "30대"},
      {"cohort_id": "11680-F-50대", "sgg_code": "11680", "gender": "F", "age_group": "50대"}]


def row(cid, cat, week="2026-10-05", source="synthetic", users=6, rec=10, npc=None, **kw):
    sgg, g, age = cid.split("-", 2)
    r = {"week_start": week, "sgg_code": sgg, "gender": g, "age_group": age, "category": cat, "source": source,
         "npc_type": npc or ("job" if cat == "일·취업" else "policy"), "user_count": users, "recommends": rec,
         "views": 0, "apply_clicks": 0, "self_reported": 0, "ineligible": 0}
    r.update(kw)
    return r


class Background(unittest.TestCase):
    def test_shape(self):
        rows = S.build_demand_background(PT, ["2026-09-28", "2026-10-05"])
        self.assertTrue(rows)
        self.assertFalse(any(r["age_group"] == "50대" for r in rows))                 # 소셜 월드는 20·30대만
        self.assertTrue(all(r["source"] == "synthetic" for r in rows))
        self.assertTrue(all((r["npc_type"] == "job") == (r["category"] == "일·취업") for r in rows))
        self.assertTrue(set(r["category"] for r in rows) <= set(S.HARU_CATEGORIES))
        self.assertTrue(all(r["apply_clicks"] <= r["recommends"] and r["self_reported"] <= r["apply_clicks"] for r in rows))
        self.assertEqual(rows, S.build_demand_background(PT, ["2026-09-28", "2026-10-05"]))   # 매번 같은 값

    def test_recent_weeks_are_mondays(self):
        wk = S.recent_weeks(4, today=date(2026, 10, 8))
        self.assertEqual(wk, ["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"])


class Summary(unittest.TestCase):
    def test_overall_and_live(self):
        rows = [row("11680-F-20대", "주거비", rec=10, ineligible=4),
                row("11680-F-20대", "주거비", source="live", users=1, rec=3, apply_clicks=1),
                row("51110-M-30대", "일·취업", rec=7),
                row("11680-F-20대", "activity", npc="coco", rec=5, apply_clicks=2)]
        d = S.demand_summary(rows, PT)
        house = d["haru"][0]
        self.assertEqual((house["category"], house["recommends"], house["ineligible"], house["apply_clicks"]), ("주거비", 13, 4, 1))
        self.assertEqual([x["category"] for x in d["haru"]], S.HARU_CATEGORIES)          # 메뉴 순서 고정, 없으면 0
        self.assertEqual(d["haru"][4]["recommends"], 7)
        self.assertEqual(d["coco"]["recommends"], 5)
        self.assertEqual(d["live_total"], 3)

    def test_k_anonymity_by_cohort(self):
        k = C.K_ANONYMITY_MIN
        rows = [row("11680-F-20대", "주거비", users=k), row("51110-M-30대", "생활비", users=k - 1)]
        by = S.demand_summary(rows, PT)["by_cohort"]
        self.assertFalse(by["11680-F-20대"]["k_hidden"])
        self.assertEqual(by["11680-F-20대"]["cats"][0]["category"], "주거비")
        self.assertTrue(by["51110-M-30대"]["k_hidden"])
        self.assertIsNone(by["51110-M-30대"]["cats"])                               # 가리면 메뉴별 숫자도 안 나감

    def test_users_is_weekly_max_not_sum(self):
        k = C.K_ANONYMITY_MIN
        rows = [row("11680-F-20대", "주거비", week="2026-09-28", users=k - 1),
                row("11680-F-20대", "주거비", week="2026-10-05", users=k - 1)]
        by = S.demand_summary(rows, PT)["by_cohort"]
        self.assertEqual(by["11680-F-20대"]["users"], k - 1)                          # 주를 더해서 k를 넘기지 않음
        self.assertTrue(by["11680-F-20대"]["k_hidden"])

    def test_unknown_cohort_and_category_ignored_for_cohorts(self):
        rows = [row("99999-F-20대", "주거비"), row("11680-F-20대", "엉뚱한 분야")]
        d = S.demand_summary(rows, PT)
        self.assertEqual(d["by_cohort"], {})
        self.assertEqual(d["haru"][0]["recommends"], 10)                            # 전체 합계에는 들어감


class Fetch(unittest.TestCase):
    def test_fetch_calls_aggregate_then_reads_recent_weeks(self):
        calls = []

        class FakeSb:
            def rpc(self, fn, args=None):
                calls.append(("rpc", fn)); return 3

            def select(self, table, q):
                calls.append(("select", table, q)); return [row("11680-F-20대", "주거비")]
        d, n = S.fetch_demand(FakeSb(), PT, weeks=4)
        self.assertEqual(calls[0], ("rpc", "aggregate_npc_demand"))
        self.assertEqual(calls[1][1], "npc_demand_metrics")
        self.assertIn("week_start=gte." + S.recent_weeks(4)[0], calls[1][2])
        self.assertEqual((n, d["weeks"], d["since"]), (3, 4, S.recent_weeks(4)[0]))


if __name__ == "__main__":
    unittest.main()
