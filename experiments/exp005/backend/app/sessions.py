"""서버 메모리에만 세션을 보관하는 인프라 경계입니다.

DB·파일 로그는 만들지 않습니다. 토큰, 시계, 잠금, 만료는 순수 규칙 밖에 둡니다.
단일 프로세스 로컬 시제품 전용이며 운영용 인증·다중 워커 저장소가 아닙니다.
"""

import asyncio
import secrets
import time
from dataclasses import dataclass, field

from app.schemas import ChatResponse, PublicState, SafetyAssessment


class SessionError(Exception):
    def __init__(self, code: str, status: int):
        self.code, self.status = code, status


@dataclass
class Session:
    mode: str
    expires_at: float
    state: PublicState = field(default_factory=PublicState)
    safety_pending: SafetyAssessment | None = None
    # 외부 모델 문맥에는 최근 마스킹된 발화 4개만 사용합니다. 원문은 보관하지 않습니다.
    history: list[str] = field(default_factory=list)
    # 안전 확인 중 발화는 별도로 두어 일반 대화 초안에 복제하지 않습니다.
    safety_history: list[str] = field(default_factory=list)
    cache: dict[str, tuple[str, ChatResponse]] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    closed: bool = False


class SessionStore:
    def __init__(self, ttl: int = 1800, capacity: int = 200, clock=time.monotonic):
        self.ttl, self.capacity, self.clock = ttl, capacity, clock
        self.items: dict[str, Session] = {}

    def prune(self):
        for token, session in list(self.items.items()):
            if session.expires_at <= self.clock():
                self.remove(token)

    def create(self, mode: str) -> tuple[str, Session]:
        self.prune()
        if len(self.items) >= self.capacity:
            raise SessionError("session_capacity", 503)
        token = secrets.token_urlsafe(32)
        session = Session(mode=mode, expires_at=self.clock() + self.ttl)
        self.items[token] = session
        return token, session

    def get(self, token: str) -> Session:
        self.prune()
        session = self.items.get(token)
        if session is None or session.closed:
            raise SessionError("session_expired", 401)
        return session

    def ensure_active(self, token: str, session: Session):
        if self.get(token) is not session:
            raise SessionError("session_expired", 401)

    def remove(self, token: str):
        session = self.items.pop(token, None)
        if session:
            # 진행 중 모델 호출이 끝나도 ensure_active()가 커밋을 막습니다.
            session.closed = True
            session.history.clear()
            session.safety_history.clear()
            session.cache.clear()
            session.state = PublicState()
            session.safety_pending = None

    def clear(self):
        for token in list(self.items):
            self.remove(token)
