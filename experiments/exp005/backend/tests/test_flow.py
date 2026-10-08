"""실제 사용자·API 키 없이 상태, Safety 경계와 서버 계약을 검증합니다.

합성 사례 통과는 진단 정확도나 실사용 안전성 검증 결과가 아닙니다.
pytest만으로 실행할 수 있게 비동기 플러그인을 추가하지 않았습니다.
"""

import asyncio
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.agent.orchestrator import Orchestrator
from app.agent.rules import local_safety, redact
from app.config import Settings
from app.llm.openai_client import DemoClient
from app.main import create_app
from app.schemas import ChatRequest, ReplyProposal
from app.sessions import SessionError, SessionStore


def turn(content: str, revision: int = 0, **extra):
    return ChatRequest(request_id=uuid4(), expected_revision=revision, content=content, **extra)


def run(coro):
    return asyncio.run(coro)


def setup(provider=None, clock=None):
    store = SessionStore(**({"clock": clock} if clock else {}))
    token, session = store.create("demo")
    return store, token, session, Orchestrator(store, provider or DemoClient())


@pytest.mark.parametrize("content,expected", [
    ("오늘 피곤해요", "continue"),
    ("죽고 싶어요", "clarify"),
    ("오늘 자살하려고 준비했어요", "urgent_support"),
    ("죽고 싶지 않아요", "clarify"),
    ("예전에 죽고 싶었지만 지금은 괜찮아요", "clarify"),
    ("친구가 지금 죽고 싶다고 해요", "urgent_support"),
    ("소설에 자살 대사가 있어요", "clarify"),
    ("이미 약을 한꺼번에 많이 먹었어요", "urgent_support"),
    ("방금 손목을 그었어요", "urgent_support"),
    ("I want to die tonight", "urgent_support"),
    ("I don't want to kill myself", "clarify"),
    ("돈이 없어서 지금 자살하려고 준비했어요", "urgent_support"),
    ("오늘 죽겠네, 일이 너무 많다", "clarify"),
    ("그 사람을 해치고 싶은 생각이 들고 지금 그 사람 집 앞에 있어요", "urgent_support"),
    ("게임에서 보스를 죽여야 다음 방으로 가요", "continue"),
])
def test_safety_examples(content, expected):
    assert local_safety(content).action == expected


def test_normal_chat_does_not_force_intake():
    _, token, session, agent = setup()
    response = run(agent.handle(token, turn("오늘 쉬고 싶어요")))
    assert response.question is None
    assert session.state.preference.status == "unknown"
    assert not session.state.intake_enabled


def test_opt_in_answer_skip_and_correction():
    _, token, session, agent = setup()
    async def scenario():
        first = await agent.handle(token, turn("도움을 고를게요", action="begin_intake"))
        assert first.state.pending_question == "preference"
        second = await agent.handle(token, turn("작은 활동", 1))
        assert second.state.preference.value == "작은 활동"
        assert second.state.preference.evidence_ref
        assert second.state.pending_question == "conditions"
        third = await agent.handle(token, turn("건너뛸게요", 2, action="skip"))
        assert third.state.conditions.status == "skipped" and third.question is None
        fourth = await agent.handle(token, turn("다시 고를게요", 3, action="edit_preference"))
        assert fourth.state.preference.status == "unknown"
        fifth = await agent.handle(token, turn("이야기 듣기", 4))
        assert fifth.state.preference.value == "이야기 듣기"
    run(scenario())


def test_decline_prevents_more_questions():
    _, token, _, agent = setup()
    async def scenario():
        await agent.handle(token, turn("고를게요", action="begin_intake"))
        response = await agent.handle(token, turn("그만", 1))
        assert response.state.preference.status == "declined"
        assert response.question is None
        response = await agent.handle(token, turn("활동 추천해 주세요", 2))
        assert response.question is None
    run(scenario())


def test_explicit_request_is_not_intake_answer_and_npc_is_not_role():
    _, token, _, agent = setup()
    async def scenario():
        await agent.handle(token, turn("고를게요", action="begin_intake"))
        response = await agent.handle(token, turn("복지 정보를 찾아주세요", 1, npc="lumi"))
        assert response.npc == "lumi" and response.role == "resource"
        assert response.state.preference.status == "unknown"
        assert response.cards[0].kind == "unavailable_resource"
        assert not any("http" in c.description for c in response.cards)
    run(scenario())


def test_activity_specific_conditions_without_score():
    _, token, _, agent = setup()
    async def scenario():
        await agent.handle(token, turn("고를게요", action="begin_intake"))
        await agent.handle(token, turn("작은 활동", 1))
        await agent.handle(token, turn("혼자 실내에서", 2))
        response = await agent.handle(token, turn("추천해주세요", 3, action="choose_activity"))
        assert response.cards[0].title == "집 안에서 3분 움직이기"
        assert "score" not in response.model_dump()
    run(scenario())


def test_mixed_request_has_no_global_resource_priority():
    _, token, _, agent = setup()
    response = run(agent.handle(token, turn("작은 활동과 지원금 정보를 찾고 싶어요")))
    assert response.role == "companion" and response.question and not response.cards
    assert "먼저" in response.question


def test_policy_recommendation_is_not_mistaken_for_two_requests():
    _, token, _, agent = setup()
    response = run(agent.handle(token, turn("복지 지원금 추천해 주세요")))
    assert response.role == "resource" and response.question is None


@pytest.mark.parametrize("content", ["활동은 싫어요. 이야기만 할게요", "추천 말고 쉬고 싶어요"])
def test_declined_activity_does_not_create_mission_pressure(content):
    _, token, _, agent = setup()
    response = run(agent.handle(token, turn(content)))
    assert response.role == "companion" and not response.cards


def test_declined_social_contact_does_not_create_contact_suggestion():
    _, token, _, agent = setup()
    async def scenario():
        await agent.handle(token, turn("고를게요", action="begin_intake"))
        await agent.handle(token, turn("작은 활동", 1))
        await agent.handle(token, turn("함께하는 건 싫어요. 혼자 할래요", 2))
        response = await agent.handle(token, turn("활동 보여주세요", 3, action="choose_activity"))
        assert response.cards[0].title != "아는 사람에게 짧은 안부"
    run(scenario())


def test_safety_blocks_activity_until_explicit_context_answer():
    _, token, _, agent = setup()
    async def scenario():
        response = await agent.handle(token, turn("죽고 싶어요"))
        assert response.status == "clarify" and not response.cards
        response = await agent.handle(token, turn("활동 추천해줘", 1))
        assert response.role == "safety" and not response.cards
        response = await agent.handle(token, turn("지금 위험하지 않아요", 2))
        assert response.status == "ok"
    run(scenario())


def test_affirmation_after_safety_question_escalates():
    _, token, _, agent = setup()
    async def scenario():
        await agent.handle(token, turn("죽고 싶어요"))
        response = await agent.handle(token, turn("네", 1))
        assert response.status == "urgent_support" and response.question is None
    run(scenario())


def test_idempotency_and_revision_conflicts():
    _, token, session, agent = setup()
    request = turn("안녕하세요")
    async def scenario():
        a, b = await asyncio.gather(agent.handle(token, request), agent.handle(token, request))
        assert a == b and session.state.revision == 1
        with pytest.raises(SessionError, match="request_id_reused"):
            await agent.handle(token, request.model_copy(update={"content": "다른 내용"}))
        with pytest.raises(SessionError, match="revision_conflict"):
            await agent.handle(token, turn("안녕하세요", 0))
    run(scenario())


class SafetyFailure(DemoClient):
    async def assess(self, text, context):
        raise RuntimeError("fake-secret-must-not-leak")


class SafetyTimeout(DemoClient):
    async def assess(self, text, context):
        await asyncio.sleep(0.05)


@pytest.mark.parametrize("provider", [SafetyFailure(), SafetyTimeout()])
def test_safety_failure_never_recommends(provider):
    _, token, _, agent = setup(provider)
    agent.timeout = .001
    response = run(agent.handle(token, turn("활동 추천해 주세요")))
    assert response.status == "unavailable" and response.role == "safety"
    assert not response.cards and "fake-secret" not in response.reply


def test_intake_decline_is_honored_even_when_safety_is_unavailable():
    _, token, session, agent = setup()
    run(agent.handle(token, turn("고를게요", action="begin_intake")))
    agent.provider = SafetyFailure()
    response = run(agent.handle(token, turn("그만할게요", 1, action="decline")))
    assert response.status == "unavailable"
    assert session.state.preference.status == "declined"
    assert not session.state.intake_enabled and session.state.pending_question is None


def test_imminent_local_signal_does_not_wait_for_failed_provider():
    _, token, _, agent = setup(SafetyFailure())
    response = run(agent.handle(token, turn("지금 자살하려고 준비했어요")))
    assert response.status == "urgent_support"


def test_other_harm_uses_distance_support_without_self_harm_question():
    _, token, _, agent = setup()
    response = run(agent.handle(token, turn("그 사람을 해치고 싶은 생각이 들고 지금 그 사람 집 앞에 있어요")))
    assert response.status == "urgent_support" and response.question is None
    assert "상대와 거리를" in response.reply and not response.cards


class BadProposal(DemoClient):
    async def propose(self, text, context, npc):
        return ReplyProposal(intent="resource", reflection="지원금 100만원을 신청했어요.", evidence_quote="없는 근거", safety_concern=False)


def test_invalid_output_is_hidden_and_does_not_change_intake():
    _, token, session, agent = setup()
    run(agent.handle(token, turn("고를게요", action="begin_intake")))
    agent.provider = BadProposal()
    response = run(agent.handle(token, turn("이야기를 듣고 싶어요", 1)))
    assert response.status == "unavailable"
    assert "100만원" not in response.reply
    assert session.state.preference.status == "unknown"


class SecondaryConcern(DemoClient):
    async def propose(self, text, context, npc):
        return ReplyProposal(intent="activity", reflection="일반 문장", evidence_quote=text[:10], safety_concern=True)


def test_downstream_safety_concern_blocks_cards():
    _, token, _, agent = setup(SecondaryConcern())
    response = run(agent.handle(token, turn("활동 추천해 주세요")))
    assert response.role == "safety" and response.status == "clarify" and not response.cards


def test_redaction_and_no_full_history_input():
    _, token, session, agent = setup()
    response = run(agent.handle(token, turn("010-1234-5678 test@example.com")))
    assert session.history == ["[전화번호] [이메일]"]
    assert "010-1234" not in response.model_dump_json()
    assert redact("900101-1234567") == "[식별번호]"


def test_expiration_and_delete_clear_temporary_data():
    now = [0.0]
    store, token, session, agent = setup(clock=lambda: now[0])
    run(agent.handle(token, turn("임시 대화")))
    now[0] = 1801
    with pytest.raises(SessionError):
        store.get(token)
    assert not session.history and not session.cache and session.closed


def test_delete_during_model_call_prevents_commit():
    class Delayed(DemoClient):
        async def propose(self, text, context, npc):
            store.remove(token)
            return await super().propose(text, context, npc)
    store, token, session, agent = setup(Delayed())
    with pytest.raises(SessionError):
        run(agent.handle(token, turn("안녕")))
    assert session.closed and not session.cache and not session.history


def test_sensitive_safety_context_is_not_sent_to_companion():
    class Recording(DemoClient):
        def __init__(self):
            self.contexts = []
        async def propose(self, text, context, npc):
            self.contexts.append(context)
            return await super().propose(text, context, npc)
    provider = Recording()
    _, token, session, agent = setup(provider)
    async def scenario():
        await agent.handle(token, turn("죽고 싶어요"))
        assert session.history == [] and session.safety_history
        await agent.handle(token, turn("지금 위험하지 않아요", 1))
        assert provider.contexts == [{"recent_user_messages": []}]
        assert not session.safety_history
    run(scenario())


def test_openai_boundary_requests_structured_nonstored_output():
    from types import SimpleNamespace
    from app.llm.openai_client import OpenAIClient
    captured = []
    class FakeResponses:
        async def parse(self, **kwargs):
            captured.append(kwargs)
            return SimpleNamespace(status="completed", output_parsed=local_safety("평범한 가상 문장"))
    client = object.__new__(OpenAIClient)
    client.client = SimpleNamespace(responses=FakeResponses())
    client.model = "test-only"
    result = run(client.assess("평범한 가상 문장", {}))
    assert result.action == "continue"
    assert captured[0]["store"] is False
    assert captured[0]["text_format"].__name__ == "SafetyAssessment"


def test_openai_refusal_or_incomplete_response_is_failure():
    from types import SimpleNamespace
    from app.llm.openai_client import OpenAIClient
    class FakeResponses:
        async def parse(self, **kwargs):
            return SimpleNamespace(status="completed", output_parsed=None)
    client = object.__new__(OpenAIClient)
    client.client = SimpleNamespace(responses=FakeResponses())
    client.model = "test-only"
    with pytest.raises(ValueError, match="model_output_unavailable"):
        run(client.assess("가상 문장", {}))


def test_api_consent_auth_forgery_and_error_redaction():
    settings = Settings(_env_file=None, mode="demo")
    with TestClient(create_app(settings)) as client:
        assert client.post("/api/sessions", json={"processing_consent": False}).status_code == 403
        session = client.post("/api/sessions", json={"processing_consent": True}).json()
        request = turn("가상 사례").model_dump(mode="json")
        assert client.post("/api/chat", json=request).status_code == 401
        headers = {"Authorization": f"Bearer {session['session_token']}"}
        response = client.post("/api/chat", json={**request, "consent": "forged-private-value"}, headers=headers)
        assert response.status_code == 422 and "forged-private-value" not in response.text
        assert client.post("/api/chat", json=request, headers=headers).status_code == 200
        assert client.delete("/api/sessions", headers=headers).status_code == 204
        assert client.post("/api/chat", json=request, headers=headers).status_code == 401


def test_live_not_silently_replaced_with_demo():
    with TestClient(create_app(Settings(_env_file=None, mode="live", openai_api_key=""))) as client:
        response = client.post("/api/sessions", json={"processing_consent": True, "external_model_consent": True})
        assert response.status_code == 503 and response.json()["code"] == "live_unavailable"


def test_live_requires_separate_external_consent_without_network_call():
    settings = Settings(_env_file=None, mode="live", openai_api_key="fake-test-only")
    with TestClient(create_app(settings, provider=DemoClient())) as client:
        assert client.post("/api/sessions", json={"processing_consent": True}).status_code == 403
        assert client.post("/api/sessions", json={"processing_consent": True, "external_model_consent": True}).status_code == 200
