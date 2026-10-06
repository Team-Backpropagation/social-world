# -*- coding: utf-8 -*-
"""마을이장 v1 단위 테스트 — Supabase 없이 돈다.
실행: cd risk_agent && python -m unittest tests.test_chief -v
"""
import os
import sys
import unittest
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import chief as CH          # noqa: E402
import config as C          # noqa: E402
import pipeline as P        # noqa: E402

NOW = datetime(2026, 10, 1, 10, 0, tzinfo=CH.KST)   # 목요일 오전


def fb(sgg, age, g, theme):
    return {"sgg_code": sgg, "age_group": age, "gender": g, "event_theme": theme}


class TemplateRules(unittest.TestCase):
    def test_templates_have_no_forbidden_words(self):
        for t in CH.TEMPLATES:
            self.assertEqual(CH.forbidden_hits(t["title"] + " " + t["description"]), [], t["key"])

    def test_templates_are_valid(self):
        places = {"plaza", "park", "game_room", "cafe", "club_center", "support_center", "mission_room"}
        for t in CH.TEMPLATES:
            self.assertIn(t["place"], places)                      # world_events.place 제약과 같음
            self.assertTrue(set(t["themes"]) <= set(CH.THEMES))
            self.assertTrue(set(t["interests"]) <= set(CH.INTERESTS))
            self.assertIn(t["burden"], (1, 2, 3))
        self.assertEqual(len({t["key"] for t in CH.TEMPLATES}), len(CH.TEMPLATES))

    def test_every_theme_has_a_template(self):
        for th in CH.THEMES:
            self.assertTrue(any(th in t["themes"] for t in CH.TEMPLATES), th)

    def test_pipeline_factors_map_to_known_themes(self):
        self.assertEqual(set(P.EVENT_THEME_FROM_FACTOR), set(P.NPC_EMPHASIS_FROM_FACTOR))
        self.assertTrue(set(P.EVENT_THEME_FROM_FACTOR.values()) <= set(CH.THEMES))

    def test_forbidden_detects(self):
        self.assertEqual(CH.forbidden_hits("외로운 20대를 위한 산책"), ["외로", "20대"])


class Helpers(unittest.TestCase):
    def test_next_start_is_future_and_right_weekday(self):
        for t in CH.TEMPLATES:
            s = CH.next_start(t, NOW)
            self.assertEqual(s.weekday(), t["weekday"])
            self.assertGreater(s, NOW + timedelta(hours=1))
            self.assertLessEqual(s, NOW + timedelta(days=8))

    def test_next_start_skips_today_if_too_soon(self):
        t = {"weekday": 3, "hour": 10, "minute": 30}          # 목요일 10:30, 지금 10:00
        self.assertEqual(CH.next_start(t, NOW).date().isoformat(), "2026-10-08")

    def test_burden(self):
        self.assertEqual(CH.burden_from_activity(None), 1)
        self.assertEqual(CH.burden_from_activity({"1": 10, "2": 2}), 1)
        self.assertEqual(CH.burden_from_activity({"1": 2, "2": 6, "3": 2}), 2)
        self.assertEqual(CH.burden_from_activity({"3": 5, "4": 2}), 3)

    def test_interest_shares(self):
        self.assertEqual(CH.interest_shares(None), {})
        self.assertEqual(CH.interest_shares({"user_count": 4, "interests": {"운동": 2}}), {"운동": 0.5})


class Planning(unittest.TestCase):
    def test_youth_feedback_example(self):
        """실제 청년 결과(강남 남 20·30, 춘천 남 20 → outdoor_walk / 춘천 여 30·남 30 → free_activity)"""
        feedback = [fb("11680", "20대", "M", "outdoor_walk"), fb("11680", "30대", "M", "outdoor_walk"),
                    fb("51110", "30대", "F", "free_activity"), fb("51110", "20대", "M", "outdoor_walk"),
                    fb("51110", "30대", "M", "free_activity")]
        ev, skipped = CH.plan_events(feedback, [], [], [], NOW)
        self.assertEqual(len(ev), 3)                           # 주제 2개 + 월드 전체 1개 = 최대 3
        self.assertEqual(ev[0]["template_key"], "park_walk")   # 부담 1 + 주제 일치
        self.assertEqual((ev[0]["target_sgg_code"], ev[0]["target_age_group"], ev[0]["target_gender"]),
                         ("11680", "20대", "M"))
        self.assertEqual(ev[1]["theme"], "free_activity")
        self.assertEqual(ev[2]["theme"], "world")
        self.assertIsNone(ev[2]["target_sgg_code"])
        self.assertEqual(len({e["template_key"] for e in ev}), 3)
        self.assertEqual(sum("같은 주제" in s for s in skipped), 3)

    def test_interests_change_choice(self):
        feedback = [fb("51110", "30대", "F", "free_activity")]
        cook = [{"sgg_code": "51110", "age_group": "30대", "gender": "F", "user_count": 6, "interests": {"요리": 5}}]
        game = [{"sgg_code": "51110", "age_group": "30대", "gender": "F", "user_count": 6, "interests": {"게임": 6}}]
        self.assertEqual(CH.plan_events(feedback, cook, [], [], NOW, 1)[0][0]["template_key"], "recipe_share")
        self.assertEqual(CH.plan_events(feedback, game, [], [], NOW, 1)[0][0]["template_key"], "board_game")

    def test_burden_change_choice(self):
        feedback = [fb("11680", "20대", "M", "outdoor_walk")]
        runners = [{"sgg_code": "11680", "age_group": "20대", "gender": "M", "user_count": 6, "interests": {"운동": 6}}]
        light = CH.plan_events(feedback, runners, [], [], NOW, 1)[0][0]["template_key"]
        heavy = CH.plan_events(feedback, runners,
                               [{"sgg_code": "11680", "age_group": "20대", "gender": "M", "quest_done": {"2": 8, "3": 4}}],
                               [], NOW, 1)[0][0]["template_key"]
        self.assertEqual(light, "park_walk")    # 처음 온 사람이 많으면 가벼운 산책
        self.assertEqual(heavy, "slow_run")     # 2·3단계까지 온 코호트 + 운동 관심 → 달리기

    def test_respects_active_events(self):
        feedback = [fb("11680", "20대", "M", "outdoor_walk")]
        ev, _ = CH.plan_events(feedback, [], [], [{"template_key": "park_walk"}], NOW)
        self.assertEqual(len(ev), 2)
        self.assertNotIn("park_walk", [e["template_key"] for e in ev])
        full, sk = CH.plan_events(feedback, [], [], [{"template_key": k} for k in ("a", "b", "c")], NOW)
        self.assertEqual(full, [])
        self.assertIn("최대", sk[0])

    def test_unknown_or_empty_theme_ignored(self):
        ev, _ = CH.plan_events([fb("11680", "20대", "M", None), fb("11680", "30대", "M", "nope")], [], [], [], NOW, 3)
        self.assertEqual([e["theme"] for e in ev], ["world"])

    def test_public_fields_have_no_target_words_and_admin_fields_do(self):
        ev, _ = CH.plan_events([fb("11680", "20대", "M", "outdoor_walk")], [], [], [], NOW, 1)
        e = ev[0]
        self.assertEqual(CH.forbidden_hits(e["title"] + e["description"]), [])
        self.assertIn("강남구 20대 남성", e["reason_note"])            # 근거는 관리자 전용 칸에만
        self.assertNotIn("Lv", e["reason_note"])                       # 이장은 등급을 받지 않는다
        self.assertEqual(e["model_version"], C.CHIEF_MODEL_VERSION)

    def test_forbidden_template_is_dropped(self):
        bad = dict(CH.TEMPLATES[0], key="bad", title="외로운 사람들의 산책")
        CH.TEMPLATES.insert(0, bad)
        try:
            ev, sk = CH.plan_events([fb("11680", "20대", "M", "outdoor_walk")], [], [], [], NOW, 1)
            self.assertEqual(ev, [])
            self.assertTrue(any("금칙어" in s for s in sk))
        finally:
            CH.TEMPLATES.pop(0)


class FakeSb:
    """supabase_sync.SupabaseRest 흉내 — 호출을 기록하고 정해진 값을 돌려준다."""
    def __init__(self, cols=True):
        self.calls, self.cols = [], cols

    def select(self, table, query):
        self.calls.append(("select", table, query))
        if "limit=1" in query and not self.cols:
            raise SystemExit("PGRST204 column")
        if table == "cohort_feedback" and "limit=1" not in query:
            return [fb("11680", "20대", "M", "outdoor_walk")]
        return []

    def rpc(self, fn, args=None):
        self.calls.append(("rpc", fn, args))
        return []

    def insert(self, table, rows):
        self.calls.append(("insert", table, rows))

    def update(self, table, query, values):
        self.calls.append(("update", table, query, values))
        return [{"title": "x"}] if "id=eq.1&" in query else []


class Cli(unittest.TestCase):
    def setUp(self):
        import supabase_sync as S
        self.S, self.orig = S, S.client

    def tearDown(self):
        self.S.client = self.orig

    def test_plan_writes_drafts(self):
        sb = FakeSb(); self.S.client = lambda: sb
        CH.main(["plan"])
        ins = [c for c in sb.calls if c[0] == "insert"]
        self.assertEqual(len(ins), 1)
        rows = ins[0][2]
        self.assertTrue(all(r["status"] == "draft" and "approved_at" not in r for r in rows))
        q = [c[2] for c in sb.calls if c[0] == "select" and c[1] == "world_events" and "limit" not in c[2]][0]
        self.assertNotIn("+", q)                                   # URL에 '+' 없음
        self.assertIn(("rpc", "chief_interest_counts", {"p_k": C.K_ANONYMITY_MIN}), sb.calls)

    def test_plan_dry_run_writes_nothing(self):
        sb = FakeSb(); self.S.client = lambda: sb
        CH.main(["plan", "--dry-run"])
        self.assertFalse([c for c in sb.calls if c[0] == "insert"])

    def test_plan_stops_before_migration(self):
        sb = FakeSb(cols=False); self.S.client = lambda: sb
        with self.assertRaises(SystemExit) as cm:
            CH.main(["plan"])
        self.assertIn("05_chief.sql", str(cm.exception))

    def test_auto_publish(self):
        sb = FakeSb(); self.S.client = lambda: sb
        C.CHIEF_AUTO_PUBLISH = True
        try:
            CH.main(["plan"])
        finally:
            C.CHIEF_AUTO_PUBLISH = False
        rows = [c for c in sb.calls if c[0] == "insert"][0][2]
        self.assertTrue(all(r["status"] == "published" and r["approved_at"] for r in rows))

    def test_approve_only_from_draft(self):
        sb = FakeSb(); self.S.client = lambda: sb
        CH.main(["approve", "1", "2"])
        ups = [c for c in sb.calls if c[0] == "update"]
        self.assertEqual(ups[0][2], "id=eq.1&status=in.(draft)")
        self.assertEqual(ups[0][3]["status"], "published")
        self.assertIn("approved_at", ups[0][3])
        CH.main(["close", "1"])
        self.assertEqual([c for c in sb.calls if c[0] == "update"][-1][2], "id=eq.1&status=in.(published)")

    def test_approve_ignores_pasted_comment(self):
        # Windows cmd에는 # 주석이 없어 "approve 12 # list에서 본 id" 가 그대로 인자로 들어온다(10/2 실제 오류)
        sb = FakeSb(); self.S.client = lambda: sb
        CH.main(["approve", "#12", "13", "#", "list에서", "본", "id"])
        ups = [c for c in sb.calls if c[0] == "update"]
        self.assertEqual([u[2] for u in ups], ["id=eq.12&status=in.(draft)", "id=eq.13&status=in.(draft)"])
        CH.main(["approve", "#"])
        self.assertEqual(len([c for c in sb.calls if c[0] == "update"]), 2)

    def test_list_shows_kst_and_ended(self):
        import io, contextlib
        rows = [{"id": 1, "status": "published", "title": "카페", "place": "cafe",
                 "starts_at": "2020-10-01T11:00:00+00:00", "ends_at": "2020-10-01T12:00:00+00:00",
                 "target_sgg_code": None, "target_age_group": None, "target_gender": None, "reason_note": None},
                {"id": 2, "status": "draft", "title": "공원", "place": "park",
                 "starts_at": "2099-10-02T10:30:00+00:00", "ends_at": None,
                 "target_sgg_code": None, "target_age_group": None, "target_gender": None, "reason_note": None}]
        sb = FakeSb(); self.S.client = lambda: sb
        sb.select = lambda t, q: [{"event_id": 1}, {"event_id": 1}] if t == "event_participation" else rows
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            CH.main(["list"])
        text = out.getvalue()
        self.assertIn("10/01(목) 20:00 KST", text)          # DB의 UTC 11:00 → 한국 20:00
        self.assertIn("끝남", text.splitlines()[0])
        self.assertIn("참여 2명", text.splitlines()[0])
        self.assertIn("참여 0명", text.splitlines()[2])
        self.assertNotIn("끝남", text.splitlines()[2])

    def test_plan_refreshes_activity_first(self):
        sb = FakeSb(); self.S.client = lambda: sb
        CH.main(["plan", "--dry-run"])
        names = [c[1] for c in sb.calls if c[0] in ("rpc", "select")]
        self.assertIn("aggregate_world_activity", names)
        self.assertLess(names.index("aggregate_world_activity"), names.index("world_activity_metrics"))

    def test_offline_preview(self):
        import json, tempfile
        d = {"11680-M-20대": {"sgg_code": "11680", "age_group": "20대", "gender": "M", "event_theme": "outdoor_walk"}}
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False)
        ev = CH.cmd_plan(type("A", (), {"offline": f.name, "dry_run": False})())
        os.unlink(f.name)
        self.assertEqual(ev[0]["template_key"], "park_walk")


class WorldBackground(unittest.TestCase):
    def test_background_shape(self):
        personas = [{"cohort_id": "11680-M-20대", "sgg_code": "11680", "gender": "M", "age_group": "20대"},
                    {"cohort_id": "11680-M-60대이상", "sgg_code": "11680", "gender": "M", "age_group": "60대이상"}]
        rows = CH.build_world_background(personas, 4, today=NOW.date())
        self.assertEqual(len(rows), 4)                                  # 청년만 × 4주
        self.assertTrue(all(r["source"] == "synthetic" for r in rows))
        self.assertTrue(all(r["user_count"] > C.K_ANONYMITY_MIN for r in rows))
        self.assertTrue(all(datetime.fromisoformat(r["week_start"]).weekday() == 0 for r in rows))
        self.assertEqual(rows, CH.build_world_background(personas, 4, today=NOW.date()))   # 재현성


if __name__ == "__main__":
    unittest.main()
