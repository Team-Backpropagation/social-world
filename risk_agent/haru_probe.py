# -*- coding: utf-8 -*-
"""
하루 v1 준비 — 복지로(한국사회보장정보원) API 3종 응답 모양 확인

세 API를 각각 1~2번씩만 불러서(전체 최대 8회) 받은 응답을 haru_samples/ 에 저장한다.
이 샘플을 보고 06_haru.sql 의 칸 이름과 haru_sync.py 의 파싱을 맞춘다.

  python haru_probe.py                   # 세 API 모두
  python haru_probe.py --only central    # 중앙부처복지서비스만 (central | local | facility)

필요: risk_agent/.env 에 DATA_GO_KR_KEY=<공공데이터포털 일반 인증키(Decoding)>
      Encoding 키를 넣어도 된다(자동으로 풀어서 쓴다).
저장: haru_samples/<이름>.xml (받은 그대로) + haru_samples/요약.txt
      인증키는 어떤 파일에도 남기지 않는다(주소·본문에 있으면 *** 로 가림).
일일 한도: 복지서비스 2종 1,000회 · 장애인편의시설 100회 — 이 스크립트는 한 번에 최대 8회만 부른다.
"""
import argparse
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "haru_samples")
BASE = "https://apis.data.go.kr/B554287"
MAX_CALLS = 8
YOUTH = "004"   # 생애주기 코드: 청년 (활용가이드로 확인 필요)

# 이름: (경로, 기본 파라미터). 상세 조회는 목록에서 얻은 id로 채운다.
CALLS = {
    "central": [
        ("central_list", "NationalWelfareInformationsV001/NationalWelfarelistV001",
         {"callTp": "L", "pageNo": "1", "numOfRows": "5", "srchKeyCode": "003", "lifeArray": YOUTH}),
        ("central_detail", "NationalWelfareInformationsV001/NationalWelfaredetailedV001",
         {"callTp": "D", "servId": "{servId}"}),
    ],
    "local": [
        ("local_list_gangnam", "LocalGovernmentWelfareInformations/LcgvWelfarelist",
         {"pageNo": "1", "numOfRows": "5", "ctpvNm": "서울특별시", "sggNm": "강남구"}),
        ("local_list_chuncheon", "LocalGovernmentWelfareInformations/LcgvWelfarelist",
         {"pageNo": "1", "numOfRows": "5", "ctpvNm": "강원특별자치도", "sggNm": "춘천시"}),
        ("local_detail", "LocalGovernmentWelfareInformations/LcgvWelfaredetailed",
         {"servId": "{servId}"}),
    ],
    "facility": [
        ("facility_list", "DisabledPersonConvenientFacility/getDisConvFaclList",
         {"pageNo": "1", "numOfRows": "5", "faclNm": "강남구청"}),
        ("facility_detail", "DisabledPersonConvenientFacility/getFacInfoOpenApiJpEvalInfoList",
         {"wfcltId": "{wfcltId}"}),
    ],
}
ID_TAGS = ("servId", "wfcltId")


# ------------------------------------------------------------------
# 인증키
# ------------------------------------------------------------------
def load_key(path=None):
    key = os.environ.get("DATA_GO_KR_KEY")
    path = path or os.path.join(HERE, ".env")
    if not key and os.path.exists(path):
        with open(path, encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if line.startswith("DATA_GO_KR_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        raise SystemExit("DATA_GO_KR_KEY가 없습니다. risk_agent/.env 에 한 줄 추가하세요:\n"
                         "  DATA_GO_KR_KEY=<공공데이터포털 마이페이지 → 일반 인증키(Decoding)>")
    # Encoding 키(%2B 등)를 넣었으면 한 번 풀어서, 요청할 때 다시 한 번만 인코딩되게 한다
    return urllib.parse.unquote(key) if "%" in key else key


def redact(text, key):
    if not text:
        return text
    for k in {key, urllib.parse.quote(key, safe=""), urllib.parse.quote_plus(key)}:
        text = text.replace(k, "***")
    return re.sub(r"(serviceKey=)[^&\s\"'<]+", r"\1***", text)


def build_url(path, params, key):
    q = urllib.parse.urlencode({"serviceKey": key, **params}, quote_via=urllib.parse.quote)
    return f"{BASE}/{path}?{q}"


# ------------------------------------------------------------------
# 요청
# ------------------------------------------------------------------
def fetch(url, timeout=20):
    """(HTTP 상태, 본문 문자열). 연결 자체가 안 되면 상태 0과 오류 메시지"""
    req = urllib.request.Request(url, headers={"Accept": "application/xml, application/json, */*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
            return r.status, r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, ssl.SSLError, TimeoutError) as e:
        if url.startswith("https://"):             # 일부 환경은 http만 열려 있다
            return fetch("http://" + url[len("https://"):], timeout)
        return 0, f"연결 실패: {e}"


# ------------------------------------------------------------------
# 응답 요약
# ------------------------------------------------------------------
def summarize(body):
    """결과 코드, 전체 건수, 첫 항목의 칸 이름·예시값, 다음 상세 조회에 쓸 id"""
    s = {"ok_xml": False, "codes": {}, "total": None, "item_tag": None, "fields": [], "ids": {}}
    try:
        root = ET.fromstring(body.strip())
    except ET.ParseError:
        s["raw_head"] = body.strip()[:300]
        return s
    s["ok_xml"] = True
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        txt = (el.text or "").strip()
        if re.search(r"(resultCode|resultMessage|returnAuthMsg|returnReasonCode|errMsg)$", tag, re.I) and txt:
            s["codes"][tag] = txt
        if tag.lower() == "totalcount" and txt:
            s["total"] = txt
        if tag in ID_TAGS and txt and tag not in s["ids"]:
            s["ids"][tag] = txt
    # 첫 항목: id 칸을 자식으로 가진 첫 요소. 없으면(상세 조회) 루트 아래 전체
    item = next((el for el in root.iter() if any(c.tag in ID_TAGS for c in el)), None)
    target = item if item is not None else root
    s["item_tag"] = target.tag
    seen = set()
    for el in target.iter():                       # 안쪽(신청방법 목록 등)까지 끝 칸을 모두
        tag = el.tag.split("}")[-1]
        if tag in seen or len(el):
            continue
        seen.add(tag)
        s["fields"].append((tag, re.sub(r"\s+", " ", (el.text or "").strip())[:70]))
    return s


def report_lines(name, url, status, s):
    lines = [f"■ {name}", f"  요청: {url}", f"  HTTP {status}"]
    if s["codes"]:
        lines.append("  결과 코드: " + ", ".join(f"{k}={v}" for k, v in s["codes"].items()))
    if s["total"] is not None:
        lines.append(f"  전체 건수: {s['total']}")
    if not s["ok_xml"]:
        lines.append(f"  XML이 아님 — 앞부분: {s.get('raw_head', '')}")
    if s["fields"]:
        lines.append(f"  칸 {len(s['fields'])}개 (<{s['item_tag']}> 기준, 이름 = 예시값):")
        lines += [f"    {k} = {v}" for k, v in s["fields"]]
    return lines


# ------------------------------------------------------------------
def run(only=None, fetcher=fetch, key=None, out=OUT):
    key = key or load_key()
    os.makedirs(out, exist_ok=True)
    report, calls = [], 0
    for group, steps in CALLS.items():
        if only and group != only:
            continue
        ids = {}
        for name, path, params in steps:
            need = [v[1:-1] for v in params.values() if v.startswith("{")]
            if any(n not in ids for n in need):
                report.append(f"■ {name}\n  건너뜀 — 앞 목록 조회에서 {', '.join(need)}를 못 받음\n")
                continue
            if calls >= MAX_CALLS:
                report.append(f"■ {name}\n  건너뜀 — 한 번 실행에 {MAX_CALLS}회까지만 부름\n")
                continue
            filled = {k: (ids[v[1:-1]] if v.startswith("{") else v) for k, v in params.items()}
            url = build_url(path, filled, key)
            status, body = fetcher(url)
            calls += 1
            with open(os.path.join(out, name + ".xml"), "w", encoding="utf-8") as f:
                f.write(redact(body, key))
            s = summarize(redact(body, key))
            for k, v in s["ids"].items():
                ids.setdefault(k, v)
            report += report_lines(name, redact(url, key), status, s) + [""]
    text = "\n".join(report)
    with open(os.path.join(out, "요약.txt"), "w", encoding="utf-8") as f:
        f.write(f"복지로 API 응답 확인 — 호출 {calls}회\n\n{text}")
    return calls, text


def main(argv=None):
    ap = argparse.ArgumentParser(description="하루 — 복지로 API 응답 모양 확인(최대 8회 호출)")
    ap.add_argument("--only", choices=list(CALLS), help="한 API만 확인")
    args = ap.parse_args(argv)
    calls, text = run(args.only)
    print(text)
    print(f"호출 {calls}회. 받은 응답은 {OUT} 에 저장했습니다(인증키는 가림).")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
