# -*- coding: utf-8 -*-
"""
페르소나 기반 가상데이터 — 코호트별 원형(archetype) 배정

대회 규칙(주제설명자료 260907, p.10)이 페르소나 기반 가상데이터를 명시적으로 허용하되
"생성 방식에 대한 설명자료 제출 필수"라고 규정한다. 이 파일이 그 설명자료(가상데이터_생성방식
_설명자료.md)가 가리키는 실제 생성 규칙의 원본이다 — 문서와 코드가 어긋나지 않도록 이 파일을
단일 진실 소스(SSOT)로 둔다.

원칙(통합기획서 4-4): "대회 데이터로 도출한 코호트에서 페르소나를 파생한다." 즉 페르소나는
실제 코호트 구조(24개: 지역×성별×연령대) 위에서만 정의되고, 없는 코호트를 새로 만들지 않는다.

각 코호트에 배정하는 원형은 데이터 생성 시점의 "숨은 정답(ground truth)"이며, 파이프라인은
이 라벨을 직접 보지 않고 시계열 패턴만으로 위험도를 판단한다 — 탐지 로직이 실제로 패턴을
읽어내는지 검증하기 위한 장치다(일종의 회수율 점검).

원형은 통합기획서 10-1 "고립 재정의 축"과 데이터_분석근거_정리.md 4·9절의 가설(H-A/H-B/H-C)에서
그대로 가져왔다:
  - normal              : 뚜렷한 위험 신호 없음
  - event_unresponsive   (H-A) : 명절 등 이벤트 시기에도 소비 구성/총량이 평소와 거의 안 변함
                                  → "관계망이 약해 이벤트에 반응할 관계가 없다"는 가설의 시그니처
  - essential_only       (H-B) : 하반기로 갈수록 선택적 소비(카드 결제 총량)가 서서히 줄어듦
                                  → "필수 소비만 남고 사회적 소비가 빠진다"는 가설의 시그니처
  - structurally_low     (H-C) : 애초에 통신 유동인구가 낮은 평탄선이며 6개월간 완만히 더 낮아짐
                                  → "급격한 단절이 아니라 구조적으로 낮은 활동 수준"
  - micro_flagged        : 소셜 월드 NPC 대화(심리상담)에서 위험 키워드·심각도가 높게 관측됨
                            (20~30대 코호트에서만 발생 가능 — micro 데이터가 존재하는 유일한 연령대)

시연 목적상 24개 코호트 중 소수(6개)에만 뚜렷한 원형을 배정하고 나머지는 normal(약한 랜덤
잡음만 포함)로 둔다 — 실제 서비스에서 "이상 코호트가 드문드문 섞여 있는" 현실적인 분포를 흉내
내기 위함이며, 전부 이상치로 만들면 우선순위 도출(⑦) 자체가 무의미해진다.
"""
import random
from config import all_cohorts, MICRO_ELIGIBLE_AGE_GROUPS, RNG_SEED, stable_seed

# cohort_id -> archetype  (시연용으로 손으로 고른 6개 — 근거는 위 docstring)
ARCHETYPE_ASSIGNMENT = {
    "51110-F-60대이상": "structurally_low",   # 데이터_분석근거_정리.md 1-1절:
                                               # "춘천시 유동인구 최다 집단은 60대 이상"이라는
                                               # 실제 발견의 대구(對句)로, 같은 연령대 내에서도
                                               # 유독 활동이 낮은 하위 코호트가 있을 수 있음을 시연
    "11680-M-50대": "essential_only",         # H-B: 강남 중장년 남성, 은퇴 전환기 가설(10-1 발생계기축)
    "51110-M-40대": "event_unresponsive",     # H-A: 춘천 중년 남성, 명절에도 무반응
    "11680-F-20대": "micro_flagged",          # 서비스 핵심 대상 코호트에서 미시 신호로 탐지되는 사례
    "51110-F-30대": "event_unresponsive",     # H-A: 청년 코호트에도 나타나는 사례(고령 전용이 아님을 보여줌)
    "11680-M-20대": "essential_only",         # H-B: 청년 남성, 취업실패형 가설(10-1)
}


def build_persona_table():
    """24개 코호트 전체에 원형을 배정한 표(list[dict])를 반환. 지정 안 된 코호트는 normal."""
    cohorts = all_cohorts()
    table = []
    for c in cohorts:
        archetype = ARCHETYPE_ASSIGNMENT.get(c["cohort_id"], "normal")
        has_micro = c["age_group"] in MICRO_ELIGIBLE_AGE_GROUPS
        table.append({
            **c,
            "archetype": archetype,
            "micro_eligible": has_micro,
        })
    return table


def rng_for_cohort(cohort_id: str) -> random.Random:
    """코호트별로 독립적이되 재현 가능한 난수 스트림. 시드는 config.RNG_SEED + 코호트 해시."""
    seed = stable_seed("persona", cohort_id)
    return random.Random(seed)
