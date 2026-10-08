# -*- coding: utf-8 -*-
"""
루미 심각도 — risk_check 결과(K·위기) + LLM 판정(T·관용·위기 의심) → 발화 심각도·구간·할 일

  severity = min(1, 0.5·K + 0.5·T + 지속성)       위기 판정이면 1.0
  지속성   = 그 세션에서 위험 발화(태그·위기)의 순번 — 1~2번째 0 / 3~4번째 +0.1 / 5번째부터 +0.2
  band     = normal (< 0.45) / suggest (0.45~0.8) / strong (≥ 0.8) / crisis (위기 판정)

위기 판정(작업계획 6-1 ①·④): 사전 strong → 위기 / 사전 ambiguous → LLM crisis_suspect로 확인, LLM 결과가 없으면(실패·시간 초과) 위기
/ 사전에 없어도 LLM crisis_suspect면 위기. 109 안내는 위기 판정일 때만이고, 위기 표현 없이 ≥ 0.8이면 강한 연결 제안(strong)이다.

할 일(actions):
  crisis_notice  위기 안내 배너(109·1577-0199) — 위기 판정 때마다
  report_crisis  report_crisis() 호출 — 세션당 1번
  offer          'suggest' | 'strong' | None — 연결 제안. 같은 종류는 세션당 1번, 강한 제안 뒤에는 일반 제안을 하지 않는다

원문은 받지 않는다. 세션 결과는 summary()의 값(태그·최고 심각도)만 npc_sessions에 저장한다.
규칙 근거: docs/planning/위험사전_근거_매핑표.md 3-3절. 옛 JS 판(../npc/severity.js)은 10/7 이전 규칙이라 쓰지 않는다.
"""
import json
import os

from risk_check import LEXICON_DIR

CRISIS_TAG = "위기발화"


def load_scoring(lexicon_dir=LEXICON_DIR):
    with open(os.path.join(lexicon_dir, "scoring.json"), encoding="utf-8") as f:
        return json.load(f)


def _clamp01(x):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, x))


def persistence_bonus(nth, scoring):
    """세션의 nth번째 위험 발화에 붙는 지속성 가산"""
    bonus = 0.0
    for step in sorted(scoring["persistence"], key=lambda s: s["from_nth"]):
        if nth >= step["from_nth"]:
            bonus = step["bonus"]
    return bonus


def band_of(severity, scoring):
    if severity >= scoring["bands"]["strong"]:
        return "strong"
    if severity >= scoring["bands"]["suggest"]:
        return "suggest"
    return "normal"


def is_crisis(check, llm_crisis, scoring):
    """(위기 여부, 이유). llm_crisis: LLM crisis_suspect — None이면 LLM 결과 없음"""
    level = (check or {}).get("crisis")
    if level == "strong":
        return True, "lexicon_strong"
    if llm_crisis is True:
        return True, "lexicon_ambiguous+llm" if level == "ambiguous" else "llm"
    if level == "ambiguous" and llm_crisis is None:
        return scoring["ambiguous_when_llm_unavailable"] == "crisis", "lexicon_ambiguous+llm_unavailable"
    return False, None


class Session:
    """대화 세션 하나의 상태. 발화마다 score()를 부르고, 끝나면 summary()를 저장한다"""

    def __init__(self, scoring=None):
        self.scoring = scoring or load_scoring()
        self.risk_turns = 0
        self.max_severity = 0.0
        self.tags = []
        self.offered = set()
        self.crisis_reported = False

    def score(self, check, tone=None, idiom_flag=False, llm_crisis=None):
        """check: risk_check.check() 결과. tone: LLM tone_score(0~1, 없으면 0으로 계산).
        idiom_flag: LLM 관용·과장 판정 → K × 0.5. llm_crisis: LLM crisis_suspect(True/False/None)"""
        cfg = self.scoring
        check = check or {}
        tags = list(check.get("tags") or [])
        crisis, reason = is_crisis(check, llm_crisis, cfg)

        if tags or crisis:
            self.risk_turns += 1
        for t in tags + ([CRISIS_TAG] if crisis else []):
            if t not in self.tags:
                self.tags.append(t)

        K = _clamp01(check.get("K", 0.0))
        if idiom_flag:
            K = round(K * cfg["idiom_factor"], 2)
        T = None if tone is None else round(_clamp01(tone), 2)
        actions = {"crisis_notice": False, "report_crisis": False, "offer": None}

        if crisis:
            severity, band, bonus = 1.0, "crisis", 0.0
            actions["crisis_notice"] = True
            if not self.crisis_reported:
                self.crisis_reported = True
                actions["report_crisis"] = True
        else:
            bonus = persistence_bonus(self.risk_turns, cfg) if tags else 0.0
            w = cfg["weights"]
            severity = round(_clamp01(w["keyword"] * K + w["tone"] * (T or 0.0) + bonus), 2)
            band = band_of(severity, cfg)
            if band in ("suggest", "strong") and band not in self.offered and "strong" not in self.offered:
                if cfg.get("suggest_once_per_session", True):
                    self.offered.add(band)
                actions["offer"] = band

        self.max_severity = max(self.max_severity, severity)
        return {"severity": severity, "band": band, "K": K, "T": T, "persistence": bonus,
                "crisis": crisis, "crisis_reason": reason, "actions": actions}

    def summary(self):
        """npc_sessions에 남길 값 — 원문 없음. 세션 심각도 = 발화 심각도의 최댓값"""
        return {"keyword_tags": list(self.tags), "risk_keyword_count": len(self.tags),
                "severity_score": round(self.max_severity, 2)}
