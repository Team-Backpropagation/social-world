"""네트워크·DB·시계를 사용하지 않는 규칙입니다.

주의: 아래 Safety 패턴은 합성 사례용 시연 규칙입니다. 위험사전 v1 전체나
임상 검증된 분류기가 아닙니다. 미검출은 안전 보증이 아닙니다.
"""

import re
from typing import Literal

from app.schemas import Card, ChatRequest, PublicState, ReplyProposal, SafetyAssessment, Topic

QUESTIONS = {
    "preference": "지금은 이야기 듣기, 작은 활동, 정보 찾기 중 어떤 도움이 편하신가요?",
    "conditions": "활동을 고를 때 혼자·함께, 실내·실외, 시간 중 어떤 조건을 먼저 맞출까요?",
}


def redact(text: str) -> str:
    """대표적인 연락처만 마스킹합니다. 이름·주소 전체를 탐지한다고 주장하지 않습니다."""
    text = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[이메일]", text)
    text = re.sub(r"(?<!\d)(?:01[016789]|0\d{1,2})[- .]?\d{3,4}[- .]?\d{4}(?!\d)", "[전화번호]", text)
    return re.sub(r"(?<!\d)\d{6}[- ]?[1-4]\d{6}(?!\d)", "[식별번호]", text)


def local_safety(text: str) -> SafetyAssessment:
    """강한 신호는 일반 모델보다 먼저 처리합니다. 부정·인용은 자동 통과시키지 않습니다.

    맥락은 응답 주체를 고르는 보조 정보일 뿐, 위험등급이 아닙니다.
    실제 응급 상황인지 확정하지 않고 지원 또는 확인 경로를 선택합니다.
    """
    compact = re.sub(r"\s+", "", text.lower())
    signal = bool(re.search(
        r"자살|죽고싶|죽을|죽겠|죽으려|죽고싶지|목숨|자해|살기싫|사라지고싶|끝내고싶|"
        r"살고싶지|살기힘들|스스로해치|손목.*(?:그었|긋|베었)|약.*(?:많이먹|한꺼번에먹)|"
        r"해치고싶|죽이겠|죽이고싶|suicid|killmyself|endmylife|hurtmyself|self.?harm|wanttodie", compact))
    if not signal:
        return SafetyAssessment(action="continue", speaker="none", temporal="none", harm_target="none")
    target = "other" if re.search(r"해치고싶|죽이겠|죽이고싶", compact) else "self"
    speaker = "third_party" if re.search(r"친구|가족|동생|형이|언니|동료|friend", compact) else "self"
    if re.search(r"소설|영화|대사|가상|fiction", compact):
        speaker = "fictional"
    contextual = bool(re.search(r"않|아니|없|예전|과거|작년|소설|영화|대사|don't|donot|usedto", compact))
    temporal = "past" if re.search(r"예전|과거|작년|usedto", compact) else "unclear"
    imminent = bool(re.search(r"지금|오늘|당장|이미|준비|실행|먹었|그었|베었|tonight|rightnow|already", compact))
    # 맥락 표현이 있어도 이미 발생한 신체 손상·복용 표현은 지원 경로를 유지합니다.
    occurred = bool(re.search(r"(?:약|수면제).*(?:많이|한꺼번에).*먹었|손목.*(?:그었|베었)", compact))
    preparation = bool(re.search(r"(?:자살(?:하려고|을)?|죽으려고|목숨을끊으려고).*준비", compact))
    idiom = bool(re.search(r"죽겠(?:네|다|어요).*(?:일|업무|피곤)|(?:피곤|바빠|바빠서).*죽겠", compact))
    # '돈이 없어서' 같은 다른 부정 표현이 준비 신호를 자동 약화시키지 않게 합니다.
    action = "urgent_support" if occurred or (imminent and not idiom and (preparation or not contextual)) else "clarify"
    return SafetyAssessment(action=action, speaker=speaker, temporal="current" if imminent else temporal, harm_target=target)


def resolve_safety(text: str, previous: SafetyAssessment | None, current: SafetyAssessment) -> SafetyAssessment:
    """확인 대기 중에는 '응'이나 활동 요청만으로 일반 흐름에 복귀하지 않습니다."""
    if current.action != "continue" or previous is None:
        return current
    compact = re.sub(r"\s+", "", text)
    if re.search(r"지금(?:은)?위험하지않|현재(?:는)?위험하지않|지금(?:은)?안전해|실제상황이아니", compact):
        return current
    if compact in {"응", "네", "예", "맞아요", "위험해요", "지금위험해요", "도움이필요해요"}:
        return previous.model_copy(update={"action": "urgent_support"})
    return previous.model_copy(update={"action": "clarify"})


def safety_reply(result: SafetyAssessment) -> tuple[str, str | None]:
    other = result.speaker == "third_party"
    if result.harm_target == "other":
        reply = "다른 사람에게 위해가 생길 수 있는 상황을 먼저 확인하고 싶어요. 가능한 경우 상대와 거리를 두고 대면을 피하며, 위험한 물건에서 떨어져 주세요. 즉시 도움이 필요하면 가까운 사람이나 현지 응급서비스에 연락해 주세요. 이 시제품은 직접 연락하지 못해요."
        return reply, None if result.action == "urgent_support" else "지금 다른 사람을 해칠 위험이 가까운 상황인가요?"
    if result.action == "urgent_support":
        subject = "그분이" if other else "지금"
        return (
            f"{subject} 다쳤거나 위험이 가까운 상황일 수 있어요. 가능한 경우 위험한 물건에서 거리를 두고, "
            "가까운 사람에게 곁에 있어 달라고 요청해 주세요. 즉시 도움이 필요하면 현지 응급서비스에 연락해 주세요. "
            "이 시제품은 직접 연락하거나 구조를 요청하지 못해요.", None,
        )
    question = "그분이 지금 스스로를 해칠 위험이 있거나 이미 다친 상태인가요?" if other else "지금 실제로 스스로를 해칠 위험이 있거나 이미 다친 상태인가요?"
    return "말씀의 맥락을 먼저 확인하고 싶어요. 당장 위험하다면 가까운 사람이나 현지 응급서비스의 도움을 받아 주세요.", question


def requested_roles(text: str) -> set[str]:
    """분기와 복합 요청 확인이 같은 탐지 규칙을 쓰도록 합니다. 범용 NLP 분석기가 아닙니다."""
    found = set()
    if re.search(r"정책|복지|지원금|취업|교육|신청|정보.*찾|자원", text):
        found.add("resource")
    if re.search(r"활동|산책|미션|모임|봉사|할.*(?:일|것)", text) or ("추천" in text and "resource" not in found):
        found.add("activity")
    if re.search(r"활동.*(?:말고|싫|원치|안 할)|추천.*(?:말고|싫|원치)|쉬고\s*싶", text):
        # 추천/활동 단어의 존재보다 명시적인 거절·쉬기 요청을 우선합니다.
        found.discard("activity")
    return found


def route(request: ChatRequest, text: str, model_intent: str) -> Literal["companion", "activity", "resource"]:
    """화면 NPC는 기능 권한이 아닙니다. 루미 화면에서도 활동·정보 역할을 사용할 수 있습니다."""
    if request.action == "choose_activity":
        return "activity"
    if request.action == "choose_resource":
        return "resource"
    requested = requested_roles(text)
    if len(requested) > 1:
        return "companion"
    if "resource" in requested:
        return "resource"
    if "activity" in requested:
        return "activity"
    if re.search(r"활동.*(?:말고|싫|원치|안 할)|추천.*(?:말고|싫|원치)|쉬고\s*싶", text):
        return "companion"
    # NPC 선택만으로 현재 요구를 바꾸지 않습니다. 모델 의도는 보조 후보입니다.
    return model_intent if model_intent in {"activity", "resource"} else "companion"


def update_intake(state: PublicState, request: ChatRequest, text: str, role: str) -> PublicState:
    """복사본을 바꾼 뒤 최종 응답 검증이 성공할 때만 서버가 확정합니다.

    answered/skipped/declined/unknown을 구분하고, 필요한 질문 하나만 남깁니다.
    자유 입력에서 임의로 나이·병력·사회성 점수 등을 추정해 기억하지 않습니다.
    """
    next_state = state.model_copy(deep=True)
    action = request.action
    if action == "decline" or text in {"그만", "그만할래요", "묻지 마세요", "답하고 싶지 않아요"}:
        if next_state.pending_question:
            setattr(next_state, next_state.pending_question, Topic(status="declined"))
        next_state.pending_question = None
        next_state.intake_enabled = False
        return next_state
    if action == "skip" or text in {"건너뛰기", "모르겠어요"}:
        if next_state.pending_question:
            setattr(next_state, next_state.pending_question, Topic(status="skipped"))
        next_state.pending_question = None
        return next_state
    if action == "begin_intake":
        next_state.intake_enabled = True
        next_state.pending_question = "preference"
        return next_state
    if action == "edit_preference":
        next_state.intake_enabled = True
        next_state.preference = Topic()
        next_state.pending_question = "preference"
        return next_state
    # 다른 명시적 요청이 들어오면 대기 질문의 답으로 잘못 저장하지 않습니다.
    explicit_request = bool(re.search(r"추천해|찾아|알려|해줘|해주세요|신청|지원금|정책|복지", text))
    answering = action == "chat" and not explicit_request and next_state.pending_question
    if answering:
        topic = next_state.pending_question
        setattr(next_state, topic, Topic(status="answered", value=text[:240], evidence_ref=str(request.request_id)))
        next_state.pending_question = None
    if role == "activity" and next_state.intake_enabled and next_state.conditions.status == "unknown":
        next_state.pending_question = "conditions"
    return next_state


def activity_cards(state: PublicState) -> list[Card]:
    """비공식 작은 행동 후보만 제공합니다. 등록·미션 배정·보상은 실행하지 않습니다."""
    value = state.conditions.value or ""
    if "실내" in value:
        title, detail = "집 안에서 3분 움직이기", "원하는 만큼만 가볍게 몸을 움직여 보세요."
    elif "함께" in value and not re.search(r"혼자|함께.*(?:싫|원치|부담|말고|안 )", value):
        title, detail = "아는 사람에게 짧은 안부", "편한 사람이 있다면 짧은 메시지를 보낼지 선택해 보세요. 직접 전송하지 않아요."
    else:
        title, detail = "잠깐 주변 둘러보기", "여건이 괜찮다면 창가나 가까운 곳에서 잠깐 쉬어 보세요."
    return [Card(title=title, description=detail + " 참여는 선택이고, 수행 기록이나 보상은 없어요.", kind="informal_activity")]


def validate_proposal(proposal: ReplyProposal, text: str) -> bool:
    """형식만 맞는 답변도 거를 수 있도록 근거·길이·권한 관련 제한을 추가합니다.

    이것은 의미 전체를 보증하는 필터가 아닙니다. 전문가·실제 모델 평가가 별도로 필요합니다.
    질문은 서버가 하나만 붙이므로 reflection에는 질문형 문장을 허용하지 않습니다.
    """
    reply = proposal.reflection.strip()
    if not reply or len(reply) > 280 or not proposal.evidence_quote or proposal.evidence_quote not in text:
        return False
    forbidden = r"[?？]|https?://|\d|진단|우울증|약물|처방|치료|위험등급|고립위험|정책|지원금|자격|접수|신청|지급|연락했|나만|저만|언제나곁|영원히|어떤가요|인가요|할까요|해줄래|알려주세요"
    return not re.search(forbidden, reply) and local_safety(reply).action == "continue"
