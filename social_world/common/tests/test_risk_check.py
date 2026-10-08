# -*- coding: utf-8 -*-
"""risk_check.py·severity.py — 매핑표 3절(10/8 확정)의 예시를 정답으로 쓴다
실행: python -m unittest discover -s social_world/common/tests   (저장소 루트에서)"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import risk_check as RC  # noqa: E402
import severity as SV  # noqa: E402

LEX = RC.Lexicon()


def chk(text):
    return LEX.check(text)


class NormalizeTest(unittest.TestCase):
    def test_spaces_punct_emoji_repeat(self):
        self.assertEqual(RC.normalize("죽고 싶어어어!! ㅠㅠㅠ 🥲"), "죽고싶어ㅠ")

    def test_digits_kept(self):
        self.assertEqual(RC.normalize("2000년 111"), "2000년111")


class CrisisTest(unittest.TestCase):
    def test_strong(self):
        for t in ["그냥 죽고 싶어", "요즘 살기 싫어", "사실 다 그만두고 싶을 때가 있어", "죽고싶어어어 ㅠㅠ"]:
            self.assertEqual(chk(t)["crisis"], "strong", t)

    def test_ambiguous(self):
        for t in ["그냥 사라지고 싶다", "우울해 죽겠다"]:
            self.assertEqual(chk(t)["crisis"], "ambiguous", t)

    def test_idiom_is_not_crisis(self):
        for t in ["배고파 죽겠다", "웃겨 죽겠네", "더워서 죽겠어"]:
            r = chk(t)
            self.assertIsNone(r["crisis"], t)
            self.assertTrue(r["idiom"], t)

    def test_strong_wins_over_idiom(self):
        r = chk("배고파 죽겠고 그냥 죽고 싶어")
        self.assertEqual(r["crisis"], "strong")
        self.assertTrue(r["idiom"])

    def test_plain(self):
        self.assertIsNone(chk("오늘 날씨 좋다")["crisis"])


class KeywordTest(unittest.TestCase):
    """매핑표 3-1 예시 표"""
    CASES = [
        ("1년 넘게 집에만 있고, 얘기할 사람도 없고, 일자리도 포기했어", {"장기고립", "사회적회피", "대화상대없음", "구직단념"}, 1.0),
        ("1년 넘게 집에만 있어", {"장기고립", "사회적회피"}, 0.9),
        ("돈도 없고 얘기할 사람도 없고 다 하기 싫어", {"생계부담", "대화상대없음", "무기력"}, 0.6),
        ("얘기할 사람도 없고 다 하기 싫어", {"대화상대없음", "무기력"}, 0.5),
        ("요즘 좀 지치고 힘들어", {"무기력"}, 0.3),
    ]

    def test_mapping_examples(self):
        for text, tags, k in self.CASES:
            r = chk(text)
            self.assertEqual(set(r["tags"]), tags, text)
            self.assertAlmostEqual(r["K"], k, places=2, msg=text)

    def test_dimension_bonus_cap(self):
        self.assertEqual(LEX.keyword_score(["무기력", "소외감", "사회적회피", "생계부담"]), 0.7)  # 0.5 + 0.2(상한)

    def test_same_dimension_no_bonus(self):
        self.assertEqual(LEX.keyword_score(["장기구직", "구직단념", "생계부담"]), 0.6)

    def test_idiom_factor(self):
        self.assertEqual(LEX.keyword_score(["사회적회피"], idiom=True), 0.25)

    def test_unknown_tag_ignored(self):
        self.assertEqual(LEX.keyword_score(["없는태그"]), 0.0)


class DurationTest(unittest.TestCase):
    """매핑표 3-2 기간 표현표 + 10/8 결정 (가)"""

    def test_weeks_no_tag(self):
        self.assertEqual(chk("몇 주 됐어")["tags"], [])

    def test_months(self):
        self.assertEqual(chk("몇 달째야")["tags"], ["고립지속"])

    def test_years_only_one_period_tag(self):
        r = chk("몇 달째 아니 1년 넘었어")
        self.assertIn("장기고립", r["tags"])
        self.assertNotIn("고립지속", r["tags"])

    def test_keep_going_needs_other_risk_tag(self):
        self.assertEqual(chk("계속 비가 와")["tags"], [])
        self.assertEqual(set(chk("계속 집에만 있어")["tags"]), {"사회적회피", "고립지속"})
        self.assertEqual(set(chk("맨날 혼자 있는 게 편해")["tags"]), {"사회적회피", "고립지속"})

    def test_keep_going_used_by_risk_pattern(self):
        r = chk("오래 준비했는데 계속 떨어져서 지쳤어요")
        self.assertEqual(set(r["tags"]), {"장기구직", "무기력"})
        self.assertEqual(r["K"], 0.5)

    def test_transient_mitigation(self):
        r = chk("요즘 좀 지치고 힘들어")
        self.assertTrue(r["mitigated"])
        r = chk("요즘 좀 지치는데 몇 달째야")
        self.assertFalse(r["mitigated"])  # 기간 태그가 있으면 완화 없음

    def test_transient_without_tags(self):
        self.assertFalse(chk("가끔 친구들 만나")["mitigated"])


class PrivacyTest(unittest.TestCase):
    def test_no_raw_text_in_result(self):
        text = "1년 넘게 집에만 있고 얘기할 사람도 없어"
        r = chk(text)
        self.assertEqual(set(r), {"crisis", "tags", "K", "mitigated", "idiom", "hits"})
        flat = repr(r)
        self.assertNotIn(text, flat)
        self.assertNotIn(RC.normalize(text), flat)


class LexiconFileTest(unittest.TestCase):
    def test_every_item_has_source_or_draft(self):
        import json
        for name in ("crisis.json", "risk_tags.json"):
            with open(os.path.join(RC.LEXICON_DIR, name), encoding="utf-8") as f:
                for item in json.load(f)["items"]:
                    self.assertTrue(item.get("source") or item.get("status") == "draft", item["id"])

    def test_bad_pattern_reports_item_id(self):
        with self.assertRaisesRegex(ValueError, "X-1"):
            RC._compile({"id": "X-1", "patterns": ["(열림"]}, "patterns")


class SeverityTest(unittest.TestCase):
    def setUp(self):
        self.s = SV.Session()

    def test_formula_and_bands(self):
        r = self.s.score(chk("얘기할 사람도 없고 다 하기 싫어"), tone=0.4)   # 0.5·0.5 + 0.5·0.4
        self.assertEqual((r["severity"], r["band"]), (0.45, "suggest"))
        self.assertEqual(SV.band_of(0.44, self.s.scoring), "normal")
        self.assertEqual(SV.band_of(0.8, self.s.scoring), "strong")

    def test_no_tone_counts_as_zero(self):
        r = self.s.score(chk("1년 넘게 집에만 있어"))
        self.assertEqual((r["severity"], r["T"]), (0.45, None))

    def test_idiom_flag_halves_k(self):
        r = self.s.score(chk("다 귀찮고 혼자 있는 게 편해"), tone=0.2, idiom_flag=True)
        self.assertEqual((r["K"], r["severity"]), (0.25, 0.23))

    def test_persistence_by_risk_turn_order(self):
        texts = ["기운이 없어", "얘기할 사람도 없고", "밖에도 안 나가", "기운이 없어", "기운이 없어"]
        bonuses = [self.s.score(chk(t), tone=0.3)["persistence"] for t in texts]
        self.assertEqual(bonuses, [0, 0, 0.1, 0.1, 0.2])

    def test_non_risk_turn_not_counted(self):
        for t in ["안녕", "기운이 없어", "그냥 그래", "기운이 없어"]:
            r = self.s.score(chk(t), tone=0.3)
        self.assertEqual((self.s.risk_turns, r["persistence"]), (2, 0))

    def test_strong_lexicon_is_crisis_without_llm(self):
        r = self.s.score(chk("죽고 싶어"))
        self.assertEqual((r["severity"], r["band"], r["crisis_reason"]), (1.0, "crisis", "lexicon_strong"))
        self.assertTrue(r["actions"]["crisis_notice"] and r["actions"]["report_crisis"])

    def test_ambiguous_needs_llm(self):
        c = chk("우울해 죽겠다")
        self.assertEqual(SV.Session().score(c, tone=0.5, llm_crisis=True)["band"], "crisis")
        self.assertNotEqual(SV.Session().score(c, tone=0.5, llm_crisis=False)["band"], "crisis")
        r = SV.Session().score(c, llm_crisis=None)  # LLM 실패·시간 초과 → 위기
        self.assertEqual((r["band"], r["crisis_reason"]), ("crisis", "lexicon_ambiguous+llm_unavailable"))

    def test_llm_crisis_suspect_alone(self):
        r = self.s.score(chk("오늘 좀 그래"), tone=0.6, llm_crisis=True)
        self.assertEqual((r["band"], r["crisis_reason"]), ("crisis", "llm"))

    def test_high_score_without_crisis_is_strong_offer_not_crisis(self):
        r = self.s.score(chk("1년 넘게 집에만 있고, 얘기할 사람도 없고, 일자리도 포기했어"), tone=0.7)
        self.assertEqual((r["band"], r["crisis"], r["actions"]["offer"]), ("strong", False, "strong"))
        self.assertFalse(r["actions"]["crisis_notice"])

    def test_report_crisis_once_notice_every_time(self):
        a = self.s.score(chk("죽고 싶어"))
        b = self.s.score(chk("진짜 죽고 싶어"))
        self.assertEqual((a["actions"]["report_crisis"], b["actions"]["report_crisis"]), (True, False))
        self.assertTrue(b["actions"]["crisis_notice"])

    def test_suggest_once_per_session(self):
        t = "얘기할 사람도 없고 다 하기 싫어"
        offers = [self.s.score(chk(t), tone=0.5)["actions"]["offer"] for _ in range(2)]
        self.assertEqual(offers, ["suggest", None])

    def test_no_plain_suggest_after_strong(self):
        self.s.score(chk("1년 넘게 집에만 있고, 얘기할 사람도 없고, 일자리도 포기했어"), tone=0.7)
        self.assertIsNone(self.s.score(chk("얘기할 사람도 없고 다 하기 싫어"), tone=0.5)["actions"]["offer"])

    def test_summary(self):
        self.s.score(chk("요즘 좀 지치고 힘들어"), tone=0.4)
        self.s.score(chk("죽고 싶어"))
        self.assertEqual(self.s.summary(), {"keyword_tags": ["무기력", "위기발화"], "risk_keyword_count": 2,
                                            "severity_score": 1.0})


if __name__ == "__main__":
    unittest.main()
