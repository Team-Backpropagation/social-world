"""서버 진입·조립입니다. 웹 입력을 검증하고 조율기를 호출한 뒤 결과만 반환합니다."""

import asyncio
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.agent.orchestrator import Orchestrator
from app.config import Settings
from app.llm.openai_client import DemoClient, OpenAIClient
from app.schemas import ChatRequest, SessionRequest, SessionResponse
from app.sessions import SessionError, SessionStore


def create_app(settings: Settings | None = None, provider=None, store=None) -> FastAPI:
    settings = settings or Settings()
    store = store or SessionStore(ttl=settings.session_ttl_seconds)
    # 실제 키는 로컬 .env에만 둡니다. 화면·문서·테스트에는 값을 전달하지 않습니다.
    if provider is None:
        provider = OpenAIClient(settings.openai_api_key, settings.openai_model, settings.timeout_seconds) if settings.mode == "live" and settings.openai_api_key else DemoClient()
    orchestrator = Orchestrator(store, provider, settings.timeout_seconds)

    @asynccontextmanager
    async def lifespan(app):
        async def cleanup():
            while True:
                await asyncio.sleep(30)
                store.prune()
        task = asyncio.create_task(cleanup())
        yield
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        store.clear()
        if hasattr(provider, "close"):
            await provider.close()

    app = FastAPI(title="이음 EXP-005 개인 시제품", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:5175", "http://localhost:5175"],
                       allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type", "Authorization"])

    @app.exception_handler(SessionError)
    async def session_error(request: Request, exc: SessionError):
        return JSONResponse(status_code=exc.status, content={"code": exc.code})

    # Pydantic의 기본 오류는 잘못된 입력 원문을 포함할 수 있어 필드 위치·코드만 반환합니다.
    from fastapi.exceptions import RequestValidationError
    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        return JSONResponse(status_code=422, content={"code": "invalid_request", "fields": [list(e["loc"]) for e in exc.errors()]})

    def token(authorization: str = Header(default="")) -> str:
        if not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="session_required")
        return authorization[7:]

    @app.get("/api/health")
    def health():
        return {"mode": settings.mode, "live_available": settings.mode == "live" and bool(settings.openai_api_key)}

    @app.post("/api/sessions", response_model=SessionResponse)
    def start_session(request: SessionRequest):
        if not request.processing_consent:
            raise SessionError("processing_consent_required", 403)
        if settings.mode == "live":
            if not settings.openai_api_key:
                raise SessionError("live_unavailable", 503)
            if not request.external_model_consent:
                raise SessionError("external_consent_required", 403)
        session_token, session = store.create(settings.mode)
        return SessionResponse(session_token=session_token, mode=settings.mode, expires_in_seconds=store.ttl, state=session.state)

    @app.post("/api/chat")
    async def chat(request: ChatRequest, session_token: str = Depends(token)):
        # 연습 앱의 원시 token SSE를 그대로 사용하면 검증 전에 문장이 노출됩니다.
        # EXP-005는 검증·상태 확정이 끝난 JSON 한 건만 반환합니다. 변경된 개인 계약입니다.
        return await orchestrator.handle(session_token, request)

    @app.delete("/api/sessions", status_code=204)
    def end_session(session_token: str = Depends(token)):
        store.remove(session_token)

    app.state.store = store
    return app


app = create_app()
