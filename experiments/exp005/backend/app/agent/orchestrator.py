"""사용자 턴 하나의 실행 순서를 책임집니다. 서비스 계층을 추가로 만들지 않았습니다.

SessionStore와 모델 대역을 주입해 네트워크 없이 실패·중복·취소를 검증할 수 있습니다.
한 턴은 Safety 1회 + 초안 1회로 끝납니다. 역할 간 재귀 호출이나 무한 루프가 없습니다.
"""

import asyncio
import hashlib

from app.agent.rules import (
    QUESTIONS, activity_cards, local_safety, redact, requested_roles, resolve_safety, route,
    safety_reply, update_intake, validate_proposal,
)
from app.schemas import Card, ChatRequest, ChatResponse, ReplyProposal, SafetyAssessment
from app.sessions import SessionError


class Orchestrator:
    def __init__(self, store, provider, timeout: float = 15):
        self.store, self.provider, self.timeout = store, provider, timeout

    async def handle(self, token: str, request: ChatRequest) -> ChatResponse:
        session = self.store.get(token)
        request_key = str(request.request_id)
        # 모델에 보내기 전 마스킹합니다. 로컬 급박 신호 검사는 원문으로 먼저 수행합니다.
        text = redact(request.content)
        fingerprint = hashlib.sha256(request.model_dump_json().encode()).hexdigest()
        async with session.lock:
            self.store.ensure_active(token, session)
            cached = session.cache.get(request_key)
            if cached:
                if cached[0] != fingerprint:
                    raise SessionError("request_id_reused", 409)
                return cached[1].model_copy(deep=True)
            if request.expected_revision != session.state.revision:
                raise SessionError("revision_conflict", 409)
            if session.state.revision >= 200:
                raise SessionError("turn_limit", 429)

            context = {
                "recent_user_messages": session.history[-4:],
                "safety_messages": session.safety_history[-2:],
                "pending_safety": session.safety_pending.model_dump() if session.safety_pending else None,
            }
            local = local_safety(request.content)
            # 명백한 급박 후보는 모델 지연을 기다리지 않고 지원 안내로 종료합니다.
            result = local
            failure = False
            if local.action != "urgent_support":
                try:
                    result = await asyncio.wait_for(self.provider.assess(text, context), self.timeout)
                    result = SafetyAssessment.model_validate(result)
                    # 모델이 로컬 확인 신호를 무시해 continue로 덮어쓰지 못합니다.
                    if local.action == "clarify" and result.action == "continue":
                        result = local
                except Exception:
                    # 원문·키·예외 문자열을 응답이나 로그로 내보내지 않습니다.
                    failure = True
            result = resolve_safety(text, session.safety_pending, result)
            next_state = session.state.model_copy(deep=True)
            if request.action in {"decline", "skip"} or text in {"그만", "그만할래요", "묻지 마세요", "답하고 싶지 않아요", "건너뛰기", "모르겠어요"}:
                # 사전조사 거절은 모델 성공에 의존하지 않습니다. Safety 확인은 별도로 유지합니다.
                next_state = update_intake(next_state, request, text, "companion")
            next_safety = session.safety_pending
            cards = []
            question = None
            role = "safety"
            status = "unavailable" if failure else result.action

            if failure:
                reply = "지금은 안전 맥락 확인 기능을 사용할 수 없어 활동·정보 추천을 잠시 멈췄어요. 당장 위험하다면 가까운 사람이나 현지 응급서비스에 도움을 요청해 주세요. 잠시 후 다시 시도할 수 있어요."
            elif result.action != "continue":
                reply, question = safety_reply(result)
                next_safety = result
            else:
                next_safety = None
                try:
                    # 최소 상태: 역할 초안에는 Safety 세부사항·전체 프로필을 전달하지 않습니다.
                    if request.action in {"begin_intake", "skip", "decline", "edit_preference"}:
                        # 버튼 명령은 자유 생성이 필요 없습니다. 상태 조작은 여전히 서버 규칙입니다.
                        proposal = ReplyProposal(intent="companion", reflection="편한 범위에서 선택하셔도 돼요.", evidence_quote=text[:40], safety_concern=False)
                    else:
                        proposal = await asyncio.wait_for(self.provider.propose(
                            text, {"recent_user_messages": session.history[-4:]}, request.npc), self.timeout)
                    proposal = ReplyProposal.model_validate(proposal)
                    if proposal.safety_concern:
                        result = SafetyAssessment(action="clarify", speaker="unclear", temporal="unclear")
                        next_safety = result
                        reply, question = safety_reply(result)
                        status = "clarify"
                    elif not validate_proposal(proposal, text):
                        raise ValueError("invalid_proposal")
                    else:
                        role = route(request, text, proposal.intent)
                        next_state = update_intake(next_state, request, text, role)
                        status = "ok"
                        reply = proposal.reflection
                        if request.action in {"decline", "skip"} or text in {"그만", "그만할래요", "묻지 마세요", "답하고 싶지 않아요", "건너뛰기", "모르겠어요"}:
                            reply = "알겠어요. 이 질문은 여기서 멈출게요. 원하실 때 다른 이야기를 하셔도 돼요."
                        elif role == "activity":
                            reply = "부담이 적은 활동 후보예요. 여건에 맞는 것만 선택하고, 원하지 않으면 하지 않으셔도 돼요."
                            cards = activity_cards(next_state)
                        elif role == "resource":
                            reply = "이 시제품에는 검증된 정책·기관 자료가 아직 연결되지 않았어요. 지원 대상·금액·신청 여부를 확정해서 안내할 수 없어요."
                            cards = [Card(title="자료 연결 대기", description="실제 기관 조회·신청·연락은 수행하지 않았어요.", kind="unavailable_resource")]
                        question = QUESTIONS.get(next_state.pending_question)
                        if request.action == "chat" and len(requested_roles(text)) > 1:
                            # Resource > Activity라는 보편 순위를 만들지 않고 사용자가 순서를 고릅니다.
                            next_state = session.state.model_copy(deep=True)
                            reply = "활동과 정보 도움을 함께 요청하셨네요. 먼저 원하는 것부터 살펴볼 수 있어요."
                            question = "작은 활동과 도움 정보 중 무엇을 먼저 살펴볼까요?"
                except Exception:
                    role, status = "companion", "unavailable"
                    reply = "답변을 확인하는 중 문제가 생겼어요. 방금 내용은 사전조사 항목에 반영하지 않았어요. 잠시 후 다시 시도하거나 대화를 종료할 수 있어요."
                    # 모델 실패로 사전조사 답을 저장하지 않지만, 사용자의 건너뛰기·거절은 유지합니다.

            next_state.revision += 1
            response = ChatResponse(
                request_id=request.request_id, mode=session.mode, npc=request.npc,
                role=role, status=status, reply=redact(reply), question=question,
                cards=cards, state=next_state,
            )
            # 삭제·만료 이후 뒤늦게 도착한 모델 결과를 저장하지 않습니다.
            self.store.ensure_active(token, session)
            session.state, session.safety_pending = next_state, next_safety
            if role == "safety":
                session.safety_history = (session.safety_history + [text])[-2:]
            else:
                session.history = (session.history + [text])[-4:]
                if next_safety is None:
                    session.safety_history.clear()
            session.cache[request_key] = (fingerprint, response.model_copy(deep=True))
            if len(session.cache) > 20:
                session.cache.pop(next(iter(session.cache)))
            return response
