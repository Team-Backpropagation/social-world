# -*- coding: utf-8 -*-
"""haru_check.py — 살펴볼 점 표시와 카드 표 (DB 없이)
실행: python -m unittest risk_agent.tests.test_haru_check"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))
import haru_check as HC  # noqa: E402
import haru_sync as HS  # noqa: E402
from test_haru_sync import fx, NOW  # noqa: E402
from test_haru_recommend import ROWS  # noqa: E402


def real_rows():
    _, c = HS.parse_list(fx("central_list.xml"))
    _, g = HS.parse_list(fx("local_list_gangnam.xml"))
    rows = [HS.normalize_central(c[0], HS.parse_detail(fx("central_detail.xml")), NOW)]
    it = next(i for i in g if i["servId"] == "WLF00006014")
    rows.append(HS.normalize_local(it, HS.parse_detail(fx("local_detail.xml")), NOW, "11680"))
    it = next(i for i in g if i["servId"] == "WLF00005414")
    old = HS.normalize_local(it, {}, NOW, "11680")
    old["menus"] = ["living"]                       # 예전 규칙(관심주제만)으로 저장된 행
    rows.append(old)
    return rows


class Flags(unittest.TestCase):
    def setUp(self):
        prog, self.cards, self.lines = HC.build(real_rows() + ROWS)
        self.by = {p["serv_id"]: p["살펴볼 점"] for p in prog}

    def test_complete_real_program_has_no_flags(self):
        self.assertEqual(self.by["WLF00006014"], "")                 # 강남구 교통비: 대상·신청·문의·링크 다 있음

    def test_old_menu_rule(self):
        self.assertIn("--refresh-menus", self.by["WLF00005414"])

    def test_special_and_excluded_age(self):
        self.assertIn("특정 대상: 장애인·저소득", self.by["WLF00000026"])
        self.assertIn("20·30대 모두 제외", self.by["C_SENIOR"])

    def test_missing_parts(self):
        self.assertIn("신청 방법 없음", self.by["C_HOUSE"])
        self.assertNotIn("나이 규칙", self.by["C_HOUSE"])            # 대상 문장이 없으면 나이 재계산 표시 안 함

    def test_name_rule_flag(self):
        r = dict(ROWS[1], serv_id="X", name="청년 전월세 이자", themes=["서민금융"], menus=["housing", "living"])
        self.assertIn("이름 낱말로 메뉴 추가: 주거비", " / ".join(HC.flags_of(r)))

    def test_age_text_not_extracted(self):
        r = dict(ROWS[1], serv_id="Y", target_text="영유아(0~5세), 아동(6~12세)", age_min=None, age_max=None)
        self.assertIn("대상 문장에 나이가 있는데 못 뽑음", HC.flags_of(r))

    def test_cards_table(self):
        gn_house = [c for c in self.cards if c["프로필"] == "강남 20대" and c["메뉴"] == "주거비"]
        self.assertEqual([c["serv_id"] for c in gn_house], ["L_GN_HOUSE", "C_HOUSE", "C_HOUSE2"])
        sp = [c["serv_id"] for c in self.cards if str(c["순서"]).startswith("S") and c["프로필"] == "강남 20대" and c["메뉴"] == "생활비"]
        self.assertEqual(sorted(sp), ["C_DISAB", "WLF00000026"])               # 특정 대상은 S번호로 따로
        self.assertTrue(any("(없음 → 129 안내)" in l for l in self.lines))   # 사람 만나기는 정책이 없음

    def test_low_income_and_group_rule_flags(self):
        r = dict(ROWS[1], serv_id="Z", name="청년월세 지원사업", target_groups=["저소득"])
        self.assertIn("소득 기준(기본 카드에 나옴)", HC.flags_of(r))
        r = dict(ROWS[1], serv_id="W", name="의사상자지원", target_groups=[])
        self.assertIn("특정 대상이 지금 규칙과 다름(--refresh-menus 필요)", HC.flags_of(r))

    def test_csv(self):
        import csv, tempfile
        path = os.path.join(tempfile.mkdtemp(), "x.csv")
        HC.write_csv(path, [{"이름": "강남구 교통비", "살펴볼 점": ""}])
        with open(path, encoding="utf-8-sig") as f:
            self.assertEqual(next(csv.DictReader(f))["이름"], "강남구 교통비")


if __name__ == "__main__":
    unittest.main()
