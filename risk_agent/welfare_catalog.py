# -*- coding: utf-8 -*-
"""
⑥ 추천 — 복지자원 목업 카탈로그 (welfare_resources 테이블 자리)

실제 서비스에서는 복지로/온통청년/지자체 API 등에서 채워야 할 표(6-2절 지식베이스 후보).
프로토타입 단계에서는 대응방안·복지자원 "매칭 로직"을 시연하는 것이 목적이므로,
실존하는 공공 지원사업 명칭을 예시로 쓰되 신청 자격·마감 등 세부는 시연용 요약이며
실제 신청 가능 여부는 각 사업 공고를 반드시 재확인해야 한다는 점을 보고서에 명시한다.
"""

WELFARE_RESOURCES = [
    {
        "resource_id": "W01", "age_scope": ["20대", "30대"], "name": "청년 마음건강 바우처(전문 심리상담 연계)",
        "category": "심리지원", "region_scope": "전국", "cause_tags": ["micro_flagged", "event_unresponsive"],
        "provider": "보건복지부",
    },
    {
        "resource_id": "W02", "age_scope": ["20대", "30대"], "name": "고립·은둔 청년 발굴·지원 사업",
        "category": "사회활동", "region_scope": "전국", "cause_tags": ["micro_flagged", "event_unresponsive", "structurally_low"],
        "provider": "보건복지부·지자체",
    },
    {
        "resource_id": "W03", "age_scope": ["20대", "30대", "40대", "50대", "60대이상"], "name": "강남구 1인가구 사회관계망 지원(품애 프로그램)",
        "category": "사회활동", "region_scope": "11680", "cause_tags": ["event_unresponsive", "structurally_low"],
        "provider": "강남구청",
    },
    {
        "resource_id": "W04", "age_scope": ["60대이상"], "name": "춘천시 노인맞춤돌봄서비스",
        "category": "돌봄", "region_scope": "51110", "cause_tags": ["structurally_low"],
        "provider": "춘천시청",
    },
    {
        "resource_id": "W05", "age_scope": ["10대", "20대", "30대", "40대", "50대", "60대이상"], "name": "국민취업지원제도(1유형)",
        "category": "일자리", "region_scope": "전국", "cause_tags": ["essential_only"],
        "provider": "고용노동부",
    },
    {
        "resource_id": "W06", "age_scope": ["20대", "30대"], "name": "청년도전지원사업(구직단념청년)",
        "category": "일자리", "region_scope": "전국", "cause_tags": ["essential_only", "event_unresponsive"],
        "provider": "고용노동부",
    },
    {
        "resource_id": "W07", "age_scope": ["10대", "20대", "30대", "40대", "50대", "60대이상"], "name": "긴급복지지원제도(생계·의료비 일시 지원)",
        "category": "복지급여", "region_scope": "전국", "cause_tags": ["essential_only", "structurally_low"],
        "provider": "보건복지부",
    },
    {
        "resource_id": "W08", "age_scope": ["20대", "30대"], "name": "동행촌 청년밥상(고립청년 커뮤니티 식사모임)",
        "category": "사회활동", "region_scope": "전국", "cause_tags": ["micro_flagged", "essential_only"],
        "provider": "민간·지자체 협력",
    },
]


def match_resources(archetype: str, sgg_code: str, age_group: str, top_k: int = 3):
    """④ 자격 필터(지역·연령) → ⑤ 원인 태그 일치도로 정렬. 자격 미달 자원은 아예 후보에서 뺀다."""
    scored = []
    for r in WELFARE_RESOURCES:
        if r["region_scope"] not in ("전국", sgg_code):
            continue
        if age_group not in r["age_scope"]:
            continue
        tag_match = 1 if archetype in r["cause_tags"] else 0
        local_bonus = 0.5 if r["region_scope"] == sgg_code else 0  # 지자체 자체 사업 우선
        scored.append((tag_match + local_bonus, r))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [r for score, r in scored[:top_k] if score > 0]

# 중장년·고령 코호트용 자원 — 청년 전용 사업만 있으면 50·60대가 "자격 미달" 추천을 받게 된다(6-2절 ④ 자격 필터링)
WELFARE_RESOURCES += [
    {"resource_id": "W09", "age_scope": ["40대", "50대", "60대이상"], "name": "신중년 인생3모작 지원(재취업·사회공헌)",
     "category": "일자리", "region_scope": "전국", "cause_tags": ["essential_only", "event_unresponsive"], "provider": "고용노동부"},
    {"resource_id": "W10", "age_scope": ["60대이상"], "name": "노인 사회활동 지원사업(노인일자리)",
     "category": "사회활동", "region_scope": "전국", "cause_tags": ["event_unresponsive", "structurally_low", "essential_only"], "provider": "보건복지부"},
    {"resource_id": "W11", "age_scope": ["40대", "50대", "60대이상"], "name": "정신건강복지센터 마음건강 상담",
     "category": "심리지원", "region_scope": "전국", "cause_tags": ["event_unresponsive", "micro_flagged"], "provider": "지자체 정신건강복지센터"},
    {"resource_id": "W12", "age_scope": ["10대"], "name": "청소년상담복지센터(1388)",
     "category": "심리지원", "region_scope": "전국", "cause_tags": ["event_unresponsive", "micro_flagged", "structurally_low"], "provider": "여성가족부"},
]
