# EXP-005 — 이음 대화·선택적 사전조사 시제품

작성일: 2026-10-07 · **개인 실험 / 팀 미채택 / 기본값은 고정 응답 시연**

사용자가 이 채팅에서 EXP-005 분리 구현과 개인 대화 API·세션 계약 생성을 선택했다. 다른 실험이나 팀 운영 코드에 통합하지 않았다. 실제 모델·기관·DB가 연결된 상담 운영 서비스로 해석하지 않는다.

React–FastAPI 연습 앱의 폴더 구조를 유지하면서 공통 Safety, 서버 세션, 선택적 질문, 활동·정보 역할 분기, 응답 검증을 추가했다. 코드의 주요 책임과 처리 이유를 한국어 주석으로 설명했다.

- [채팅별 적용·수정·보류 내역](../../docs/experiments/EXP-005_출처별_적용내역_2026-10-07.md)
- [파일별 기능과 구현 방식의 쉬운 설명](../../docs/experiments/EXP-005_코드_설명_2026-10-07.md)
- [실행 검증 기록](../../docs/logs/2026-10-07_EXP-005_구현_검증.md)

## 실행

### 팀원에게 공유하기

[EXP-005 공유 링크](https://github.com/hojhub/Sesac_Final_Project-/tree/main/experiments/exp005)를 전달한다. 비공개 저장소이므로 팀원은 저장소 초대를 수락하고 자신의 GitHub 계정으로 로그인해야 한다. 링크가 404이면 저장소 접근 권한과 로그인 계정을 먼저 확인한다. 실행 화면을 공개 서버에 배포한 링크는 아니다.

Git, Python 3.12, Node.js 24를 준비한다. 기본 `demo` 모드는 API 키·DB·외부 기관 없이 작동한다. 팀원은 가상 입력으로 시연하며 실제 개인정보나 상담 내용을 넣지 않는다. 실제 모델 응답 품질과 운영용 Safety는 검증한 결과가 아니다.

처음 받은 팀원은 원하는 작업 폴더에서 저장소를 복제한다.

```powershell
git clone --branch main https://github.com/hojhub/Sesac_Final_Project-.git ieum-experiments
cd ieum-experiments
```

아래 실행 명령은 **저장소 루트**에서 시작한다. 새 복제본은 `ieum-experiments`, 기존 작업환경은 `C:\Users\user\Desktop\Sesac_Final_Project\showcase-mvp-worktree`다. PowerShell 터미널 두 개를 각각 같은 저장소 루트에서 열어 실행한다. 기존 서버가 같은 포트에서 실행 중이면 먼저 종료한다.

터미널 1 — 백엔드:

```powershell
cd experiments/exp005/backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
# 키가 비어 있는 기본 demo 설정. 처음 설치할 때만 복사한다.
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8005 --no-access-log
```

터미널 2 — 화면:

```powershell
cd experiments/exp005/frontend
npm.cmd ci
npm.cmd run dev
```

브라우저에서 `http://127.0.0.1:5175`를 연다. 이후 실행은 가상환경 생성·설치·설정 복사 없이 서버 명령과 `npm.cmd run dev`만 실행한다. 기존 `.env`가 있으면 복사로 덮어쓰지 않는다. 기본 시연은 `IEUM_MODE=demo`인지 확인한다. 각 터미널에서 `Ctrl+C`로 종료한다. `--workers`를 늘리지 않는다. 메모리 세션은 한 프로세스 안에서만 공유된다.

macOS/Linux에서는 백엔드 가상환경 명령을 `python3 -m venv .venv`, `.venv/bin/python -m pip install -r requirements.txt`, `cp .env.example .env`, `.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8005 --no-access-log`로 바꾸고 프런트엔드에서 `npm ci`, `npm run dev`를 사용한다. 이번 작업의 실행 검증 환경은 Windows이며 다른 OS에서 직접 실행한 결과는 아니다.

팀원이 자체 작업을 시작하려면 저장소 루트에서 `git switch -c experiment/exp005-본인이름`으로 개인 브랜치를 만든다. 단순 시연은 공유 브랜치 그대로 가능하다. 피드백은 PR에 화면·가상 입력·기대 결과·실제 결과를 남기고, 실제 키나 세션 토큰은 첨부하지 않는다.

FastAPI의 실제 진입점은 `backend/app/main.py`다. 연습 앱에 있던 미완성 `backend/main.py`는 복사하지 않았다. Vite가 `/api`를 `127.0.0.1:8005`로 전달한다. 빌드 결과도 Vite preview 프록시 또는 별도 합의한 서버가 필요하며, HTML을 직접 열어서는 대화 API가 작동하지 않는다.

### requirements.txt를 찾을 수 없을 때

의존성 파일은 **저장소 루트가 아니라 `experiments/exp005/backend/requirements.txt`**에 있다. `pip install -r requirements.txt`는 터미널의 현재 폴더에서 파일을 찾는다. 먼저 `Get-Location`으로 현재 위치를 확인하고, 저장소 루트에서 다음과 같이 실행한다.

```powershell
Test-Path .\experiments\exp005\backend\requirements.txt
python -m pip install -r .\experiments\exp005\backend\requirements.txt
```

가상환경을 쓰는 경우 위의 기본 실행 순서처럼 `backend`로 이동한 뒤 가상환경의 Python으로 설치한다. 파일을 다른 위치에 복사하거나 별도로 작성할 필요는 없다.

`Test-Path`가 `False`이면 현재 위치가 다른 폴더이거나 복제본이 오래된 상태일 수 있다. Git 저장소 루트에서 `git status --short --branch`로 로컬 변경과 브랜치를 확인한다. 로컬 변경이 없고 `main` 브랜치인 기존 복제본은 `git pull --ff-only origin main`으로 갱신한 뒤 파일을 다시 확인한다. 로컬 변경이 있거나 다른 브랜치라면 일괄 초기화하지 말고 해당 작업을 보존한 채 갱신 범위를 확인한다.

이 작업공간의 확실한 백엔드 위치는 다음과 같다.

```powershell
Set-Location 'C:\Users\user\Desktop\Sesac_Final_Project\showcase-mvp-worktree\experiments\exp005\backend'
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8005 --no-access-log
```

마지막 명령은 이 백엔드 폴더에서 실행한다. 별도 터미널에서는 앞의 프런트엔드 명령을 실행한다. 기존 `.venv`가 준비되어 있으면 생성·설치는 생략할 수 있다.

## 기본 시연에서 해 볼 것

1. 즉시 처리·임시 보관 동의 후 대화를 시작한다. 동의 전 입력은 받지 않는다.
2. 자유 대화만 하거나, **편한 도움 고르기**로 선택적 질문을 시작한다.
3. `작은 활동` → `혼자 실내에서` → **작은 활동**을 선택하면 실내 행동 카드가 나온다.
4. **건너뛰기**, **질문 그만하기**, **편한 도움 정정하기**로 상태 차이를 확인한다.
5. 루미 화면에서 **도움 정보**를 누른다. 캐릭터를 강제로 바꾸지 않고 자료 미연결을 안내한다.
6. 가상 Safety 사례는 검증 문서와 테스트에서 확인한다. 실제 민감정보는 넣지 않는다.
7. **대화 종료·삭제**를 누르면 서버 메모리·화면 기록을 지운다. 새로고침만 하면 서버 삭제가 보장되지는 않으며 세션 만료가 적용된다.

## 실제 모델 연결은 선택 사항

서버를 종료한 뒤 `backend/.env.example`을 `backend/.env`로 복사하고, 로컬 파일에서 다음을 설정한다. 실제 키를 문서·브라우저·Git·대화에 넣지 않는다.

```dotenv
IEUM_MODE=live
IEUM_OPENAI_API_KEY=로컬에서만_설정
IEUM_OPENAI_MODEL=gpt-4o-mini
```

`gpt-4o-mini`는 기존 연습 앱의 기본값을 이어받은 설정이며 상담 성능 추천이나 검증 결과가 아니다. 서버를 다시 시작하고 외부 모델 전송 동의를 추가로 선택한다. live 설정에 키가 없으면 세션 생성이 실패하며 demo로 조용히 전환하지 않는다. 이번 작업에서는 **실제 키 설정·유료 모델 호출을 하지 않았다**.

현재 live 경계는 OpenAI Python SDK의 `responses.parse(text_format=...)`로 Safety 후보와 답변 초안을 각각 받는다. 거부·미완료·시간 초과·형식 오류는 실패로 처리한다. 구조화 출력 사용법과 거부 처리는 [공식 문서](https://developers.openai.com/api/docs/guides/structured-outputs)를 확인했다. SDK가 강제하는 형식은 임상적·의미적 정확성을 보장하지 않는다.

모델 요청에 `store=False`를 사용한다. 이것은 OpenAI 측의 모든 보관·운영 정책이 사라진다는 뜻이 아니다. 외부 서비스 보관·접근 조건은 별도 검토 대상이다. 실제 사용자 시험 전에 운영·분야 전문가 검토가 필요하다.

## 검증 명령

백엔드 폴더:

```powershell
python -m pytest tests -q
python -m compileall -q app
```

프런트엔드 폴더:

```powershell
npm.cmd run check
npm.cmd run build
```

빌드는 타입 검사도 포함한다. 이 실험은 루트 규칙의 EXP-003 명령을 그대로 적용하지 않고 위 명령으로 검증한다. 자세한 실제 결과와 환경 제약은 검증 기록에 적었다.

## 구조와 의존

```text
exp005/
├── README.md
├── backend/
│   ├── requirements.txt
│   ├── .env.example
│   ├── app/
│   │   ├── main.py                웹 진입·의존 연결
│   │   ├── config.py              환경 설정
│   │   ├── schemas.py             요청·응답·상태 타입
│   │   ├── sessions.py            임시 세션·잠금·만료
│   │   ├── agent/
│   │   │   ├── orchestrator.py    한 턴의 실행 순서
│   │   │   ├── rules.py           순수 Safety·분기·질문·검증
│   │   │   └── prompts.py         공통 규칙 + NPC 표현 방식
│   │   └── llm/openai_client.py   DemoClient / OpenAIClient
│   └── tests/test_flow.py         가상 사례와 API 경계 검증
└── frontend/
    ├── package.json / package-lock.json
    ├── tsconfig.json / vite.config.ts / index.html
    └── src/
        ├── main.tsx              React 시작
        ├── App.tsx               입력·대화·선택 UI
        ├── api.ts                HTTP 요청·응답 검증
        └── styles.css            데스크톱·모바일 배치
```

`App → api → FastAPI 진입 → orchestrator → rules`로 처리하며, `main.py`에서 모델과 세션 인프라를 연결한다. 규칙은 파일·환경·DB·네트워크·시계를 읽지 않는다. 실제 두 모델 구현과 실패 시험 대역이 있어 호출 경계를 분리했다. 범용 서비스 계층·기반 클래스·LangGraph는 추가하지 않았다.

## 구현된 범위와 한계

| 항목 | 현재 결과 |
|---|---|
| 자유 입력·NPC 세 가지 표현 방식 | 구현. demo에서는 고정 문구, live에서는 짧은 모델 초안 |
| 선택적 사전조사 | 도움 선호·활동 조건 두 항목. 한 질문·건너뛰기·거절·정정 |
| 공통 Safety | 초안 로컬 패턴 + live 맥락 분류 연결. 확인·지원·실패 구분 |
| 활동 | 비공식 작은 행동 카드. 단순 실내/함께 표현 반영. 시간·비용·접근성 등의 정교한 매칭은 미구현 |
| 정책 | 자료 미연결 경로 구현. 실제 정책 검색·RAG·기관 조회는 미구현 |
| 세션 | 기본 생성 후 30분, 메모리 한정, 요청 잠금·revision·중복 방지·삭제 |
| 실제 AI 응답 품질 | 연결 코드는 있지만 실제 모델 호출·평가는 미실행 |
| 운영 기능 | 실제 상담사 인계·신고·DB 기록·신청·보상·관리자 Risk/Ops는 미구현 |

Safety 패턴은 위험사전 담당 A의 승인된 전체 사전을 대체하지 않는다. 부정·과거·인용·제삼자 표현에 보수적인 확인 경로가 있으며, 패턴 누락과 과잉 대응 가능성이 남는다. 마스킹은 대표 전화번호·이메일·식별번호 형식만 가린다. 완전한 개인정보 제거 기능이 아니다.

로컬 단일 사용자 검증용이다. bearer 세션 토큰은 그 세션의 권한이지만 실제 사용자 로그인·운영 접근제어는 아니다. 공용 네트워크에 공개하거나 운영 서비스로 배포하지 않았다. 팀 통합 전에는 D-06 기준본, Safety 검토, 실제 자료·도구 계약, 인증·보관 정책을 별도로 결정해야 한다.
