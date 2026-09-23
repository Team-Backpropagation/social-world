# 소셜 월드 (Social World) — React 프로토타입

> **현재 상태(2026-09-23)**: 위험 탐지 에이전트와의 순환 연결(대화 신호 저장·위기 안내·개인화 환류)은 아직 이 React 앱에 반영되지 않았다.
> 순환이 동작하는 버전은 옆 폴더의 `../socialworld-demo.html`이다. 옮겨야 할 항목은 `../README.md`의 "React 앱으로 옮길 것" 참고.

사회적 고립 대응 AI 에이전트 프로젝트의 시민 참여형 예방 게임 서비스 프로토타입입니다.
"동물의 숲" 스타일 2D 탑다운 마을 웹앱으로, 이번 버전은 **광장 · 미션방 · 동아리방** 세 공간을
구현했습니다. (기획 원본: `사회적고립_AI에이전트_통합기획서.md` 7장, DB 구조: `DB_테이블_정의서.md`)

## 이번 프로토타입 범위

| 항목 | 상태 |
|---|---|
| 광장 (2D 탑다운 맵, 방향키/WASD 이동, 클릭 상호작용) | ✅ |
| NPC 3종 — 정책추천 · 취업상담 · 심리상담 | ✅ (스크립트 목업 대화, 백엔드 불필요) |
| 미션방 (미션 목록 · 참여 · 완료) | ✅ Supabase 연동 |
| 동아리방 (목록 · 개설 · 가입) | ✅ Supabase 연동 |
| 카카오 로그인 / 온보딩(닉네임·거주지·연령대·성별) | ✅ Supabase Auth 연동 |
| 주민센터, 미니게임, 게시판 | ⛔ 다음 스프린트 범위 |
| NPC 실제 LLM 연동, `npc_chat_metrics` 적재 | ⛔ 다음 스프린트 범위 (지금은 스크립트 목업이라 서버가 필요 없습니다) |

## 빠르게 실행해보기

```bash
npm install
cp .env.example .env   # 아래 "Supabase 연결" 순서대로 값 채우기
npm run dev
```

`.env`를 아직 채우지 않아도 실행은 됩니다 — 실행하면 설정 안내 화면이 뜹니다.

## Supabase 연결 (실제 데이터로 동작시키기)

자세한 배경 설명은 프로젝트 문서 `DB_연결_단계별_실행가이드.md`에 있고, 여기서는 이 프로토타입에
필요한 부분만 요약합니다.

1. [supabase.com](https://supabase.com) 에서 새 프로젝트 생성 (Region: Northeast Asia, Seoul)
2. 대시보드 **SQL Editor**에 저장소 루트의 `database/01_socialworld_base.sql` 전체를 붙여넣고 **Run**
   (위험 탐지 에이전트와 연결하려면 이어서 `database/02_loop_schema.sql`도 Run — `database/README.md` 참고)
   - `profiles`, `missions`, `mission_progress`, `clubs`, `club_members` 5개 테이블과 RLS 정책,
     시연용 미션 4개가 한 번에 생성됩니다.
   - 이 스키마는 `DB_테이블_정의서.md`의 모듈 1·6·7(총 31개 테이블) 중 이번 프로토타입 범위
     (모듈 6 일부)만 담고 있습니다. 대시보드·위험 탐지 기능을 붙일 때는 나머지 테이블을
     같은 문서 기준으로 추가하면 됩니다.
3. **Project Settings → API**에서 Project URL과 anon key를 복사해 `.env`에 채우기
4. (선택) 카카오 로그인을 붙이려면 `DB_연결_단계별_실행가이드.md` 5장을 따라 진행
5. (선택, 빠른 테스트용) 카카오 앱 등록 없이 바로 확인하고 싶다면 Supabase 대시보드
   **Authentication → Sign In / Providers → Anonymous Sign-Ins**를 켜세요. 로그인 화면의
   "게스트로 둘러보기" 버튼이 바로 동작합니다.
6. `npm run dev` 재시작

## 구조

```
src/
  lib/
    supabase.js        # Supabase 클라이언트, 시군구/연령대 상수
    useSession.js       # 로그인 세션 훅
    useProfile.js        # 프로필(profiles) 조회 훅
    npcScripts.js        # NPC 3종 분기형 대화 스크립트 (목업)
  components/
    SetupNotice.jsx       # .env 미설정 시 안내
    ProtectedRoute.jsx    # 로그인 가드
    TopBar.jsx             # 상단바 (닉네임/로그아웃)
    NpcDialogModal.jsx     # NPC 대화창
  pages/
    Login.jsx              # SW-01
    AuthCallback.jsx        # 로그인 후 온보딩/광장 분기
    Onboarding.jsx           # SW-02
    Plaza.jsx                 # SW-03 광장 (2D 맵)
    MissionRoom.jsx            # SW-06 미션방
    ClubRoom.jsx                 # SW-07 동아리방
(DB 스키마는 저장소 루트 database/01_socialworld_base.sql 로 옮김)
```

## 조작 방법 (광장)

- 이동: 방향키 또는 WASD
- 상호작용: Enter / Space, 또는 캐릭터·건물을 마우스로 클릭
- 모바일: 화면 하단 방향키 패드 사용

## 다음으로 이어붙일 것 (Open Items)

- 주민센터(민원챗봇 NPC), 미니게임, 게시판 — 통합기획서 7-1 표 기준
- NPC 대화 실제 LLM 연동 시 `DB_연결_단계별_실행가이드.md` 8장의 백엔드(서버) 구조를 그대로 따르고,
  `npc_chat_metrics`에는 **user_id를 절대 넣지 않는다**는 설계 원칙(개인정보 방침)을 유지할 것
- 네이버 로그인 여부 — `DB_연결_단계별_실행가이드.md` 6장 A/B/C안 중 팀 결정 필요
- 배포: 프론트는 Vercel 권장 (배포 후 Redirect URI를 배포 주소로 추가 등록해야 카카오 로그인이 동작함)
