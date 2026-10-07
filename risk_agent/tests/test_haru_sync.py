# -*- coding: utf-8 -*-
"""haru_sync.py — 실제 복지로 응답 샘플(tests/fixtures/haru)로 인터넷·DB 없이 검사
실행: python -m unittest risk_agent.tests.test_haru_sync"""
import os
import re
import sys
import unittest
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import haru_sync as HS  # noqa: E402

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "haru")
NOW = datetime(2026, 10, 6, 9, 0, tzinfo=HS.KST)
KEY = "testkey+/="


def fx(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as f:
        return f.read()


class FakeApi:
    """주소를 보고 샘플을 돌려준다. 샘플 목록은 5건만 잘라 둔 것이라 full=True면 전체 건수를 5로 맞춘다"""
    LIMIT = "<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>"

    def __init__(self, quota_after=None, full=True, limits=None):
        """quota_after: 전체 n번 뒤 한도 · limits: {"주소에 든 말": n} 그 API만 n번 뒤 한도"""
        self.urls, self.quota_after, self.full, self.limits = [], quota_after, full, limits or {}

    def _list(self, name):
        body = fx(name)
        if self.full:
            body = re.sub(r"<totalCount>\d+</totalCount>", f"<totalCount>{body.count('<servList>')}</totalCount>", body)
        return body

    def __call__(self, url):
        self.urls.append(url)
        if self.quota_after is not None and len(self.urls) > self.quota_after:
            return 200, self.LIMIT
        for word, n in self.limits.items():
            if word in url and sum(word in u for u in self.urls) > n:
                return 200, self.LIMIT
        if "NationalWelfarelist" in url:
            return 200, self._list("central_list.xml")
        if "NationalWelfaredetailed" in url:
            return 200, fx("central_detail.xml")
        if "LcgvWelfarelist" in url:
            return 200, self._list("local_list_gangnam.xml" if "%EA%B0%95%EB%82%A8" in url else "local_list_chuncheon.xml")
        if "LcgvWelfaredetailed" in url:
            return 200, fx("local_detail.xml")
        return 404, "not found"


class FakeSb:
    def __init__(self, rows=None):
        self.rows, self.calls = rows or [], []

    def select(self, table, query):
        self.calls.append(("select", table, query)); return self.rows

    def upsert(self, table, rows, on_conflict):
        self.calls.append(("upsert", table, rows, on_conflict))

    def update(self, table, query, values):
        self.calls.append(("update", table, query, values)); return []

    def upserted(self):
        return [r for c in self.calls if c[0] == "upsert" for r in c[2]]


class Parse(unittest.TestCase):
    def test_lists(self):
        total, items = HS.parse_list(fx("central_list.xml"))
        self.assertEqual(total, 165)
        self.assertEqual(items[0]["servId"], "WLF00000026")
        self.assertIn("wlfareInfoId=WLF00000026&wlfareInfoReldBztpCd=01", items[0]["servDtlLink"])   # &amp; 풀림
        total, items = HS.parse_list(fx("local_list_gangnam.xml"))
        self.assertEqual(total, 14)

    def test_detail_groups(self):
        d = HS.parse_detail(fx("central_detail.xml"))
        self.assertEqual(len(d["applmetList"]), 6)
        self.assertEqual(d["inqplCtadrList"][1]["servSeDetailLink"], "129")

    def test_errors(self):
        with self.assertRaises(HS.QuotaExceeded):
            HS.parse_root("<r><cmmMsgHeader><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg><returnReasonCode>22</returnReasonCode></cmmMsgHeader></r>")
        with self.assertRaises(HS.ApiError):
            HS.parse_root("<r><resultCode>30</resultCode><resultMessage>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</resultMessage></r>")
        with self.assertRaises(HS.ApiError):
            HS.parse_root("Unauthorized")


class Age(unittest.TestCase):
    def test_cases(self):
        cases = [
            ("- 지원대상 : 강남구 거주 어르신(65세 이상), 청년(19~24세), 청소년(13~18세), 어린이(6~12세)", (19, 24)),
            ("만 19세 이상 34세 이하 무주택 청년", (19, 34)),
            ("만19~39세 청년", (19, 39)),
            ("만 19세~34세", (19, 34)),
            ("18세 이상 35세 미만", (18, 34)),
            ("18세 이상 미취업 장애인", (18, None)),
            ("19세 이상의 등록장애인", (19, None)),
            ("6세 이상 아동", (None, None)),                      # 14세 미만 하한은 청년 판단에 의미 없음
            ("가구 소득이 기준 중위소득 50% 이하", (None, None)),
            ("영유아(0~5세), 아동(6~12세)", (None, None)),        # 서로 다른 범위 — 누구 것인지 모름
            ("", (None, None)),
        ]
        for text, want in cases:
            self.assertEqual(HS.extract_age(text), want, text)

    def test_real_samples(self):
        d = HS.parse_detail(fx("local_detail.xml"))
        self.assertEqual(HS.extract_age(d["sprtTrgtCn"], d["slctCritCn"]), (19, 24))   # 강남구 교통비 — 청년 19~24세
        d = HS.parse_detail(fx("central_detail.xml"))
        self.assertEqual(HS.extract_age(d["tgtrDtlCn"], d["slctCritCn"]), (19, None))


class Normalize(unittest.TestCase):
    def test_central(self):
        _, items = HS.parse_list(fx("central_list.xml"))
        row = HS.normalize_central(items[0], HS.parse_detail(fx("central_detail.xml")), NOW)
        self.assertEqual(row["source"], "central")
        self.assertIsNone(row["sgg_code"])
        self.assertEqual(row["region_label"], "전국")
        self.assertEqual(row["menus"], ["job", "living"])                     # 생활지원·일자리·서민금융
        self.assertEqual(row["target_groups"], ["장애인", "저소득"])           # 특정 대상 정책
        self.assertTrue(row["online_apply"])
        self.assertIn("주민센터", row["apply_text"])
        self.assertEqual(row["apply_steps"][0]["stage"], "신청기관연락처목록")
        self.assertIn({"name": "보건복지상담센터", "value": "129"}, row["contacts"])
        self.assertIn("장애인복지법", row["laws"])
        self.assertEqual((row["age_min"], row["age_max"]), (19, None))
        self.assertTrue(row["detail_url"].startswith("https://www.bokjiro.go.kr/") and "WLF00000026" in row["detail_url"])

    def test_local(self):
        _, items = HS.parse_list(fx("local_list_gangnam.xml"))
        it = next(i for i in items if i["servId"] == "WLF00006014")
        row = HS.normalize_local(it, HS.parse_detail(fx("local_detail.xml")), NOW, "11680")
        self.assertEqual((row["source"], row["sgg_code"], row["region_label"]), ("local", "11680", "서울특별시 강남구"))
        self.assertEqual(row["menus"], ["living"])
        self.assertEqual(row["target_groups"], [])
        self.assertIn("greenbus", row["apply_text"])
        self.assertEqual(row["contacts"][0]["value"], "1644-9160")
        self.assertEqual(row["homepage"], "https://greenbus.gangnam.go.kr/")
        self.assertEqual(row["source_modified"], "2026-08-04")
        self.assertIsNone(row["period_end"])                                  # 99991231 = 끝 없음
        self.assertTrue(row["is_active"])

    def test_ended_local_inactive(self):
        _, items = HS.parse_list(fx("local_list_gangnam.xml"))
        d = HS.parse_detail(fx("local_detail.xml")); d["enfcEndYmd"] = "20260930"
        self.assertFalse(HS.normalize_local(items[0], d, NOW, "11680")["is_active"])

    def test_rows_have_same_keys(self):                                        # PostgREST 묶음 upsert 조건
        _, c = HS.parse_list(fx("central_list.xml")); _, l = HS.parse_list(fx("local_list_gangnam.xml"))
        a = HS.normalize_central(c[0], HS.parse_detail(fx("central_detail.xml")), NOW)
        b = HS.normalize_local(l[0], HS.parse_detail(fx("local_detail.xml")), NOW, "11680")
        self.assertEqual(sorted(a), sorted(b))

    def test_menus_from_name(self):
        self.assertEqual(HS.menus_of(["서민금융"], "강남구 신혼부부 청년 전월세 대출이자 지원사업"), ["housing", "living"])
        self.assertEqual(HS.menus_of(["서민금융", "일자리"], "강남구 미취업 청년 어학·자격증 응시료 지원 사업"), ["job", "living"])
        self.assertEqual(HS.menus_of(["보육"], "어린이집 월세 지원"), [])                  # 메뉴 주제가 없으면 이름만으로 넣지 않음
        _, items = HS.parse_list(fx("local_list_gangnam.xml"))
        it = next(i for i in items if i["servId"] == "WLF00005414")
        row = HS.normalize_local(it, HS.parse_detail(fx("local_detail.xml")) | {"servNm": ""}, NOW, "11680")
        self.assertEqual(row["menus"], ["housing", "living"])

    def test_refresh_menus(self):
        sb = FakeSb([{"serv_id": "A", "name": "청년 전월세 이자 지원", "themes": ["서민금융"], "menus": ["living"]},
                     {"serv_id": "B", "name": "청년 교통비", "themes": ["서민금융"], "menus": ["living"]},
                     {"serv_id": "C", "name": "청년 월세 지원", "themes": ["주거"], "menus": ["housing"]}])
        self.assertEqual(HS.refresh_menus(sb, log=lambda *_: None), 1)
        upd = [c for c in sb.calls if c[0] == "update"]
        self.assertEqual(upd, [("update", "welfare_programs", "serv_id=in.(A)", {"menus": ["housing", "living"]})])

    def test_wanted(self):
        _, items = HS.parse_list(fx("local_list_chuncheon.xml"))
        keep = {i["servId"]: HS.wanted(i) for i in items}
        self.assertTrue(keep["WLF00005666"])                                   # 일자리 · 청년 포함
        self.assertFalse(keep["WLF00006143"])                                  # 영유아·아동만
        self.assertFalse(keep["WLF00006097"])                                  # 관심주제 없음 → 메뉴 없음


class Sync(unittest.TestCase):
    def test_first_run(self):
        api, sb = FakeApi(), FakeSb()
        stats, rows = HS.sync(sb, KEY, fetcher=api, now=NOW, log=lambda *_: None)
        lists = [u for u in api.urls if "list" in u]
        self.assertEqual(len(lists), 4)                                        # 중앙 청년·중장년 + 강남 + 춘천 (같은 5건이라 한 쪽씩)
        self.assertTrue(any("lifeArray=005" in u for u in lists))
        self.assertEqual(stats["new"], len(rows))
        self.assertGreater(stats["skipped_theme"], 0)
        ids = {r["serv_id"] for r in sb.upserted()}
        self.assertNotIn("WLF00006143", ids)                                   # 영유아 사업은 상세도 안 받음
        self.assertTrue(all(r["menus"] for r in sb.upserted()))
        self.assertEqual(stats["calls"], len(api.urls))
        self.assertTrue(all(KEY not in line for line in HS.report(stats).splitlines()))

    def test_second_run_only_changed(self):
        api, sb = FakeApi(), FakeSb()
        _, rows = HS.sync(sb, KEY, fetcher=api, now=NOW, log=lambda *_: None)
        existing = [{"serv_id": r["serv_id"], "source": r["source"], "sgg_code": r["sgg_code"],
                     "source_modified": r["source_modified"], "fetched_at": r["fetched_at"], "is_active": True} for r in rows]
        existing[0]["source_modified"] = "2020-01-01" if existing[0]["source"] == "local" else existing[0]["source_modified"]
        old_central = next(e for e in existing if e["source"] == "central")
        old_central["fetched_at"] = (NOW - timedelta(days=40)).isoformat()     # 30일 지남 → 다시 받음
        existing.append({"serv_id": "WLF_GONE", "source": "local", "sgg_code": "11680", "source_modified": None,
                         "fetched_at": NOW.isoformat(), "is_active": True})
        api2, sb2 = FakeApi(), FakeSb(existing)
        stats, rows2 = HS.sync(sb2, KEY, fetcher=api2, now=NOW, log=lambda *_: None)
        self.assertEqual(stats["new"], 0)
        self.assertLess(len(rows2), len(rows))
        self.assertIn(old_central["serv_id"], {r["serv_id"] for r in rows2})
        self.assertEqual(stats["deactivated"], 1)
        upd = [c for c in sb2.calls if c[0] == "update"]
        self.assertEqual(upd[0][2], "serv_id=in.(WLF_GONE)")
        self.assertEqual(upd[0][3], {"is_active": False})

    def test_quota_stops_and_defers(self):
        api, sb = FakeApi(quota_after=6), FakeSb()
        stats, rows = HS.sync(sb, KEY, fetcher=api, now=NOW, log=lambda *_: None)
        self.assertIn("central", stats["blocked"])
        self.assertIn("local", stats["blocked"])
        self.assertIsNone(stats["stopped"])
        self.assertEqual(len(rows), 2)                                         # 목록 4번 + 상세 2번까지
        self.assertGreater(stats["deferred"], 0)
        self.assertEqual(stats["deactivated"], 0)

    def test_one_api_limit_does_not_stop_the_other(self):                       # 실제로 겪은 경우: 중앙부처 상세만 100번에서 막힘
        api, sb = FakeApi(limits={"NationalWelfaredetailed": 2}), FakeSb()
        stats, rows = HS.sync(sb, KEY, fetcher=api, now=NOW, log=lambda *_: None)
        self.assertEqual(sum(r["source"] == "central" for r in rows), 2)
        self.assertGreater(sum(r["source"] == "local" for r in rows), 0)        # 지자체는 계속 받음
        self.assertEqual(list(stats["blocked"]), ["central"])
        self.assertEqual(sum("NationalWelfaredetailed" in u for u in api.urls), 3)   # 막힌 뒤엔 다시 안 부름
        text = HS.report(stats)
        self.assertIn("중앙부처 복지서비스 API 한도 초과", text)
        self.assertNotIn("지자체 복지서비스 API 한도", text)

    def test_central_list_limit_still_lists_local(self):
        existing = [{"serv_id": "WLF_C", "source": "central", "sgg_code": None, "source_modified": None,
                     "fetched_at": NOW.isoformat(), "is_active": True},
                    {"serv_id": "WLF_L", "source": "local", "sgg_code": "11680", "source_modified": None,
                     "fetched_at": NOW.isoformat(), "is_active": True}]
        sb = FakeSb(existing)
        stats, rows = HS.sync(sb, KEY, fetcher=FakeApi(limits={"NationalWelfarelist": 0}), now=NOW, log=lambda *_: None)
        self.assertTrue(rows)
        self.assertTrue(all(r["source"] == "local" for r in rows))
        upd = [c for c in sb.calls if c[0] == "update"]
        self.assertEqual(upd[0][2], "serv_id=in.(WLF_L)")                      # 지자체 목록은 끝까지 받음 → 사라진 것 처리
        self.assertEqual(stats["deactivated"], 1)                              # 중앙부처 사업은 그대로 둠

    def test_pager_stops_when_nothing_new(self):
        api = FakeApi(full=False)                                              # 전체 165건이라는데 같은 5건만 돌아옴
        caller = HS.Caller(KEY, api, 50)
        items, done = HS.fetch_all(caller, f"{HS.CENTRAL}/NationalWelfarelistV001", {"callTp": "L"})
        self.assertEqual((len(items), done, len(api.urls)), (5, False, 2))      # 2쪽에서 새 것이 없으면 멈춤, '끝까지'는 아님
        self.assertIn("pageNo=2", api.urls[1])

    def test_incomplete_list_never_deactivates(self):
        existing = [{"serv_id": "WLF_GONE", "source": "local", "sgg_code": "11680", "source_modified": None,
                     "fetched_at": NOW.isoformat(), "is_active": True}]
        stats, _ = HS.sync(FakeSb(existing), KEY, fetcher=FakeApi(full=False), now=NOW, log=lambda *_: None)
        self.assertEqual(stats["deactivated"], 0)

    def test_max_calls_cap(self):
        api = FakeApi()
        stats, _ = HS.sync(FakeSb(), KEY, fetcher=api, max_calls=5, now=NOW, log=lambda *_: None)
        self.assertEqual(len(api.urls), 5)
        self.assertIn("상한", stats["stopped"])

    def test_list_failure_does_not_deactivate(self):
        existing = [{"serv_id": "WLF_X", "source": "central", "sgg_code": None, "source_modified": None,
                     "fetched_at": NOW.isoformat(), "is_active": True}]
        stats, _ = HS.sync(FakeSb(existing), KEY, fetcher=FakeApi(quota_after=1), now=NOW, log=lambda *_: None)
        self.assertEqual(stats["deactivated"], 0)

    def test_dry_run_writes_nothing(self):
        api, sb = FakeApi(), FakeSb()
        stats, rows = HS.sync(sb, KEY, fetcher=api, dry_run=True, now=NOW, log=lambda *_: None)
        self.assertEqual(rows, [])
        self.assertFalse([c for c in sb.calls if c[0] != "select"])
        self.assertFalse([u for u in api.urls if "detailed" in u])
        self.assertGreater(stats["new"], 0)


if __name__ == "__main__":
    unittest.main()
