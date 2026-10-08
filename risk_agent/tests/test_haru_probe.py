# -*- coding: utf-8 -*-
"""haru_probe.py — 네트워크 없이 가짜 응답으로 검사 (python -m unittest risk_agent.tests.test_haru_probe)"""
import html
import os
import sys
import tempfile
import unittest
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import haru_probe as HP  # noqa: E402

KEY = "abc+def/ghi=="
LIST = """<?xml version="1.0" encoding="UTF-8"?><wantedList><totalCount>42</totalCount><pageNo>1</pageNo>
<resultCode>0</resultCode><resultMessage>SUCCESS</resultMessage>
<servList><servId>WLF00001</servId><servNm>청년 마음건강 지원</servNm><jurMnofNm>보건복지부</jurMnofNm></servList>
<servList><servId>WLF00002</servId><servNm>두번째</servNm></servList></wantedList>"""
DETAIL = """<wantedDtl><resultCode>0</resultCode><servId>WLF00001</servId><servNm>청년 마음건강 지원</servNm>
<tgtrDtlCn>만 19~34세 청년</tgtrDtlCn><applmetList><servSeDetailNm>방문</servSeDetailNm></applmetList></wantedDtl>"""
FAC = """<facInfoList><totalCount>1</totalCount><servList><wfcltId>F001</wfcltId><faclNm>강남구청</faclNm></servList></facInfoList>"""
AUTH_ERR = """<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg>
<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>"""


class Probe(unittest.TestCase):
    def setUp(self):
        self.out = tempfile.mkdtemp()
        self.urls = []

    def fake(self, url):
        self.urls.append(url)
        if "detailed" in url:
            return 200, DETAIL.replace("</wantedDtl>", f"<echo>{html.escape(url)}</echo></wantedDtl>")   # 주소가 본문에 되돌아와도 키가 가려지는지
        if "DisabledPerson" in url:
            return 200, FAC
        return 200, LIST

    def test_runs_all_and_chains_ids(self):
        calls, text = HP.run(fetcher=self.fake, key=KEY, out=self.out)
        self.assertEqual(calls, 7)
        self.assertLessEqual(calls, HP.MAX_CALLS)
        self.assertIn("servId=WLF00001", [u for u in self.urls if "NationalWelfaredetailed" in u][0])
        self.assertIn("wfcltId=F001", [u for u in self.urls if "EvalInfo" in u][0])
        self.assertIn("전체 건수: 42", text)
        self.assertIn("servNm = 청년 마음건강 지원", text)
        self.assertIn("tgtrDtlCn = 만 19~34세 청년", text)
        self.assertIn("servSeDetailNm = 방문", text)                   # 안쪽 목록 칸도 보임
        self.assertNotIn(KEY, text)

    def test_key_never_saved(self):
        HP.run(fetcher=self.fake, key=KEY, out=self.out)
        enc = urllib.parse.quote(KEY, safe="")
        for name in os.listdir(self.out):
            body = open(os.path.join(self.out, name), encoding="utf-8").read()
            self.assertNotIn(KEY, body, name)
            self.assertNotIn(enc, body, name)
        self.assertIn(f"serviceKey={enc}", self.urls[0])           # 요청에는 한 번만 인코딩돼서 들어감

    def test_korean_params_encoded(self):
        HP.run(only="local", fetcher=self.fake, key=KEY, out=self.out)
        self.assertIn("sggNm=" + urllib.parse.quote("강남구"), self.urls[0])
        self.assertEqual(len(self.urls), 3)

    def test_auth_error_reported_and_detail_skipped(self):
        calls, text = HP.run(only="central", fetcher=lambda u: (200, AUTH_ERR), key=KEY, out=self.out)
        self.assertEqual(calls, 1)
        self.assertIn("SERVICE_KEY_IS_NOT_REGISTERED_ERROR", text)
        self.assertIn("건너뜀", text)

    def test_non_xml(self):
        calls, text = HP.run(only="facility", fetcher=lambda u: (401, "Unauthorized"), key=KEY, out=self.out)
        self.assertIn("XML이 아님", text)
        self.assertIn("HTTP 401", text)

    def test_encoded_key_is_unquoted(self):
        with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False, encoding="utf-8") as f:
            f.write("SUPABASE_URL=x\nDATA_GO_KR_KEY=" + urllib.parse.quote(KEY, safe="") + "\n")
        old = os.environ.pop("DATA_GO_KR_KEY", None)
        try:
            self.assertEqual(HP.load_key(f.name), KEY)
        finally:
            os.unlink(f.name)
            if old: os.environ["DATA_GO_KR_KEY"] = old

    def test_missing_key(self):
        old = os.environ.pop("DATA_GO_KR_KEY", None)
        try:
            with self.assertRaises(SystemExit):
                HP.load_key(os.path.join(self.out, "없음.env"))
        finally:
            if old: os.environ["DATA_GO_KR_KEY"] = old


if __name__ == "__main__":
    unittest.main()
