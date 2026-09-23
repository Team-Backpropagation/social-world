# -*- coding: utf-8 -*-
"""
① 수집 — 미시 신호 합성 데이터 생성 (소셜 월드 NPC 대화·행동 로그, 코호트 단위 익명 집계)

DB_테이블_정의서.md 4-5절의 npc_chat_metrics 스키마를 그대로 따른다 — 이 표에는
user_id가 없다는 것이 설계의 핵심이므로, 합성 데이터도 처음부터 코호트 단위로만 생성한다
(개인 단위 로그를 만들었다가 집계하는 방식을 쓰지 않음 — 애초에 존재하지 않는 개인을
만들어내는 것은 이 프로젝트의 개인정보 설계 원칙과 맞지 않다).

미시 신호는 통합기획서 7-1절에 따라 20~30대 코호트에서만 발생한다(소셜 월드 서비스 대상).
"""
import numpy as np
import pandas as pd

import config as C
from personas import build_persona_table

NPC_TYPES = ["psych", "policy", "job", "civil"]


def generate_npc_chat_metrics(persona_table):
    """심리상담 NPC 위험 키워드·심각도 집계 — 미시 층의 핵심 신호(6-4절)."""
    rows = []
    for p in persona_table:
        if not p["micro_eligible"]:
            continue
        rng = np.random.default_rng(C.stable_seed("psych", p["cohort_id"]))
        # 코호트 규모에 비례한 기본 세션 수 — 인구가 많은 코호트일수록 서비스 이용자도 많다는 가정
        base_sessions = {"20대": 9, "30대": 6}[p["age_group"]]
        if p["region_name"] == "춘천시":
            base_sessions = max(2, base_sessions - 3)  # 소도시라 절대 이용자 수가 적음

        for i, ym in enumerate(C.MONTHS):
            session_count = max(0, int(rng.normal(base_sessions, base_sessions * 0.35)))
            severity_base = 0.28  # 0~1 스케일, 평상시 평균 심각도
            keyword_rate_base = 0.9  # 세션당 위험 키워드 평균 언급 횟수(평상시)

            if p["archetype"] == "micro_flagged":
                # 시간이 갈수록 심각도가 서서히 올라가는 패턴(만성화) — 급성 위기가 아니라
                # 관찰 기간 내내 서서히 누적되는 유형으로 설계(위기 에스컬레이션 8-1과는 별개 트랙)
                frac = i / (len(C.MONTHS) - 1)
                severity_base = 0.28 + frac * 0.45
                keyword_rate_base = 0.9 + frac * 2.1
                session_count = max(session_count, C.K_ANONYMITY_MIN + 2)  # 표본 부족으로 묻히지 않게

            severity_score = float(np.clip(rng.normal(severity_base, 0.08), 0, 1))
            risk_keyword_count = max(0, int(rng.normal(keyword_rate_base * max(session_count, 1),
                                                        max(1.0, keyword_rate_base))))

            rows.append({
                "cohort_id": p["cohort_id"], "sgg_code": p["sgg_code"],
                "gender": p["gender"], "age_group": p["age_group"],
                "measured_month": ym, "npc_type": "psych",
                "session_count": session_count,
                "risk_keyword_count": risk_keyword_count,
                "severity_score": round(severity_score, 3),
            })
    return pd.DataFrame(rows)


def generate_engagement_metrics(persona_table):
    """게임 활동성 집계 — 로그인 빈도·미션 참여·동아리 활동(engagement_metrics).
    보조 신호로만 쓰고 점수 산출식에는 직접 포함하지 않는다(psych 신호만 6-4의 "핵심 미시 신호").
    """
    rows = []
    for p in persona_table:
        if not p["micro_eligible"]:
            continue
        rng = np.random.default_rng(C.stable_seed("engage", p["cohort_id"]))
        base_login = {"20대": 14, "30대": 10}[p["age_group"]]
        for i, ym in enumerate(C.MONTHS):
            level = base_login
            if p["archetype"] == "micro_flagged":
                frac = i / (len(C.MONTHS) - 1)
                level *= (1 - frac * 0.4)  # 심리 신호가 나빠질수록 게임 내 활동도 함께 위축
            login_count = max(0, int(rng.normal(level, level * 0.25)))
            mission_count = max(0, int(rng.normal(login_count * 0.3, 1.5)))
            club_activity = max(0, int(rng.normal(login_count * 0.15, 1.0)))
            rows.append({
                "cohort_id": p["cohort_id"], "sgg_code": p["sgg_code"],
                "gender": p["gender"], "age_group": p["age_group"],
                "measured_month": ym,
                "login_count": login_count,
                "mission_count": mission_count,
                "club_activity_count": club_activity,
            })
    return pd.DataFrame(rows)


if __name__ == "__main__":
    pt = build_persona_table()
    psych = generate_npc_chat_metrics(pt)
    eng = generate_engagement_metrics(pt)
    print(psych.shape, eng.shape)
    print(psych[psych.session_count < C.K_ANONYMITY_MIN].shape[0], "행이 k-익명성 미달")
