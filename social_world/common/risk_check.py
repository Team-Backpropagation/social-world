# -*- coding: utf-8 -*-
"""
위험사전 매처 — 문장 하나를 사전(lexicon/)에 맞춰 보고 {crisis, tags, K, mitigated, idiom, hits}만 돌려준다

  위기 표현 사전  lexicon/crisis.json     (담당 A) strong 즉시 위기 / ambiguous LLM 확인 / idiom 위기 아님
  위험 키워드 사전 lexicon/risk_tags.json  (담당 B) 태그 9종 + 기간 표현표
  점수 규칙       lexicon/scoring.json    (10/8 확정)

판단 코드는 Python 하나다(작업계획 6-1 ⑨). 판단 서버 npc-chat이 이 파일을 쓰고, 심각도는 severity.py가 이어서 계산한다.
원문은 돌려주지도 저장하지도 않는다 — hits에는 걸린 사전 항목 id만 담는다.
표준 라이브러리만 쓴다(Colab에 파일만 올리면 돈다).

  from risk_check import check
  check("요즘 좀 지치고 힘들어")
  → {'crisis': None, 'tags': ['무기력'], 'K': 0.3, 'mitigated': True, 'idiom': False, 'hits': ['R-무기력-01']}

규칙 근거: docs/planning/위험사전_근거_매핑표.md 3절, docs/planning/위험사전_v1_작업계획.md 4·6절. 작성 규칙: lexicon/README.md
"""
import json
import os
import re
import unicodedata

LEXICON_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lexicon")
GRADES = ("strong", "ambiguous", "idiom")

_DROP = re.compile(r"[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]")   # 띄어쓰기·문장부호·이모지
_REPEAT = re.compile(r"([^0-9])\1{2,}")          # 같은 글자 3번 이상 → 1번 (숫자는 그대로)
_MASK = " "                                      # 정규화된 문장에는 공백이 없으므로, 지운 자리를 공백으로 막으면 앞뒤가 붙어 새로 걸리지 않는다


def normalize(text):
    """띄어쓰기·문장부호·이모지를 지우고, 반복 글자를 줄인다. 패턴도 이 형태(띄어쓰기 없음)로 쓴다"""
    s = unicodedata.normalize("NFC", text or "").lower()
    s = _DROP.sub("", s)
    return _REPEAT.sub(r"\1", s)


def _load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _compile(item, key):
    out = []
    for p in item.get(key) or []:
        try:
            out.append(re.compile(p))
        except re.error as e:
            raise ValueError(f"{item.get('id')}: {key} 패턴 오류 {p!r} — {e}") from None
    return out


def _overlaps(span, spans):
    return any(span[0] < b and a < span[1] for a, b in spans)


class Lexicon:
    """사전 3종을 읽어 컴파일해 둔다. 사전을 고친 뒤에는 새로 만든다"""

    def __init__(self, lexicon_dir=LEXICON_DIR):
        crisis = _load(os.path.join(lexicon_dir, "crisis.json"))
        risk = _load(os.path.join(lexicon_dir, "risk_tags.json"))
        self.scoring = _load(os.path.join(lexicon_dir, "scoring.json"))
        self.tags = risk["tags"]

        self.crisis_items = {g: [] for g in GRADES}
        for item in crisis["items"]:
            if item.get("grade") not in GRADES:
                raise ValueError(f"{item.get('id')}: grade는 {GRADES} 중 하나")
            self.crisis_items[item["grade"]].append((item["id"], _compile(item, "patterns"), _compile(item, "exclude")))

        self.risk_items = []
        for item in risk["items"]:
            if item.get("tag") not in self.tags:
                raise ValueError(f"{item.get('id')}: 모르는 태그 {item.get('tag')!r}")
            self.risk_items.append((item["id"], item["tag"], _compile(item, "patterns"), _compile(item, "exclude")))

        d = risk["duration"]
        self.transient = _compile(d["transient"], "patterns")
        self.months_tag, self.years_tag = d["months"]["tag"], d["years"]["tag"]
        self.months = _compile(d["months"], "patterns")
        self.months_with_risk = _compile(d["months"], "patterns_with_risk")
        self.years = _compile(d["years"], "patterns")
        self.period_tags = {self.months_tag, self.years_tag}

    # ---- 위기 -------------------------------------------------------------
    def _crisis(self, s):
        """idiom 부분을 먼저 지운 뒤 strong → ambiguous 순으로 본다. strong이 하나라도 있으면 strong"""
        hits, idiom = [], False
        for item_id, pats, _ in self.crisis_items["idiom"]:
            for p in pats:
                if p.search(s):
                    idiom = True
                    hits.append(item_id)
                    s = p.sub(_MASK, s)
        level = None
        for grade in ("strong", "ambiguous"):
            for item_id, pats, excl in self.crisis_items[grade]:
                if any(p.search(s) for p in pats) and not any(e.search(s) for e in excl):
                    hits.append(item_id)
                    level = level or grade
        return level, idiom, hits

    # ---- 위험 태그 ---------------------------------------------------------
    def _risk(self, s):
        found, spans, hits = set(), [], []
        for item_id, tag, pats, excl in self.risk_items:
            if any(e.search(s) for e in excl):
                continue
            matched = [m.span() for p in pats for m in p.finditer(s)]
            if matched:
                found.add(tag)
                spans.extend(matched)
                hits.append(item_id)

        # 기간 태그는 하나만(긴 쪽). '계속·맨날'은 다른 위험 태그가 있을 때만, 위험 패턴이 쓴 부분은 빼고 센다(10/8 결정 (가))
        period = None
        if any(p.search(s) for p in self.years):
            period = self.years_tag
        elif any(p.search(s) for p in self.months):
            period = self.months_tag
        elif found - self.period_tags and any(
                not _overlaps(m.span(), spans) for p in self.months_with_risk for m in p.finditer(s)):
            period = self.months_tag
        if period:
            found -= self.period_tags
            found.add(period)
            hits.append("D-" + period)

        has_period = bool(found & self.period_tags)
        mitigated = bool(found) and not has_period and any(p.search(s) for p in self.transient)
        if mitigated:
            hits.append("D-완화")
        order = list(self.tags)
        return sorted(found, key=order.index), mitigated, hits

    def keyword_score(self, tags, mitigated=False, idiom=False):
        """K = 기본 심각도 최댓값 + 다른 차원 하나당 +0.1(최대 +0.2) − 완화 0.1, 관용이면 ×0.5 (매핑표 3-1)"""
        known = [t for t in set(tags or []) if t in self.tags]
        if not known:
            return 0.0
        cfg = self.scoring
        k = max(self.tags[t]["base_severity"] for t in known)
        dims = {self.tags[t]["dimension"] for t in known}
        k += min(cfg["dimension_bonus"]["max"], cfg["dimension_bonus"]["per_dimension"] * (len(dims) - 1))
        if mitigated:
            k -= cfg["mitigation_penalty"]
        if idiom:
            k *= cfg["idiom_factor"]
        return round(max(0.0, min(1.0, k)), 2)

    def check(self, text):
        """문장 하나 → {crisis, tags, K, mitigated, idiom, hits}. 원문은 반환하지 않는다.
        K에는 관용 배율을 넣지 않는다 — 관용·과장 판정(idiom_flag)은 LLM 몫이라 severity.py에서 곱한다.
        idiom은 위기 사전의 idiom 항목에 걸렸다는 뜻(기록용)"""
        s = normalize(text)
        crisis, idiom, crisis_hits = self._crisis(s)
        tags, mitigated, risk_hits = self._risk(s)
        return {
            "crisis": crisis,
            "tags": tags,
            "K": self.keyword_score(tags, mitigated=mitigated),
            "mitigated": mitigated,
            "idiom": idiom,
            "hits": crisis_hits + risk_hits,
        }


_default = None


def default_lexicon():
    global _default
    if _default is None:
        _default = Lexicon()
    return _default


def check(text):
    return default_lexicon().check(text)


if __name__ == "__main__":
    import sys
    for line in sys.argv[1:] or sys.stdin:
        print(json.dumps(check(line), ensure_ascii=False))
