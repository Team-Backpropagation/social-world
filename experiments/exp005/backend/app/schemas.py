"""입출력 약속을 한곳에 둡니다. 클라이언트는 동의·분류·기억을 임의로 주입할 수 없습니다."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

Role = Literal["companion", "activity", "resource", "safety"]
Npc = Literal["lumi", "coco", "haru"]
Action = Literal["chat", "begin_intake", "skip", "decline", "choose_activity", "choose_resource", "edit_preference"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SessionRequest(StrictModel):
    # 체크박스의 값을 서버도 확인합니다. 모델 출력으로 동의를 바꿀 수 없습니다.
    processing_consent: bool
    external_model_consent: bool = False


class ChatRequest(StrictModel):
    request_id: UUID
    expected_revision: int = Field(ge=0)
    content: str = Field(min_length=1, max_length=1200)
    npc: Npc = "lumi"
    action: Action = "chat"

    @field_validator("content")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("빈 메시지는 보낼 수 없습니다.")
        return value.strip()


class Topic(StrictModel):
    status: Literal["unknown", "answered", "skipped", "declined"] = "unknown"
    value: str | None = None
    # 현재 턴의 마스킹된 사용자 진술만 근거로 사용합니다. 모델 추정은 기록하지 않습니다.
    evidence_ref: str | None = None


class PublicState(StrictModel):
    revision: int = 0
    preference: Topic = Field(default_factory=Topic)
    conditions: Topic = Field(default_factory=Topic)
    pending_question: Literal["preference", "conditions"] | None = None
    intake_enabled: bool = False


class Card(StrictModel):
    title: str
    description: str
    kind: Literal["informal_activity", "unavailable_resource"]


class ChatResponse(StrictModel):
    request_id: UUID
    mode: Literal["demo", "live"]
    npc: Npc
    role: Role
    status: Literal["ok", "clarify", "urgent_support", "unavailable"]
    reply: str
    question: str | None = None
    cards: list[Card] = Field(default_factory=list)
    state: PublicState
    # Safety 결과는 진단이 아니므로 수치 점수나 개인 위험등급을 반환하지 않습니다.


class SessionResponse(StrictModel):
    session_token: str
    mode: Literal["demo", "live"]
    expires_in_seconds: int
    state: PublicState


class SafetyAssessment(StrictModel):
    action: Literal["continue", "clarify", "urgent_support"]
    speaker: Literal["self", "third_party", "fictional", "unclear", "none"]
    temporal: Literal["current", "past", "hypothetical", "unclear", "none"]
    harm_target: Literal["self", "other", "unclear", "none"] = "unclear"


class ReplyProposal(StrictModel):
    # 모델은 초안만 제안합니다. 상태·동의·도구 실행 필드는 의도적으로 없습니다.
    intent: Literal["companion", "activity", "resource"]
    reflection: str
    evidence_quote: str
    safety_concern: bool
