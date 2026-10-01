# database — Supabase 스키마와 DB 문서

## 파일

| 파일 | 내용 | 팀 Supabase 적용 |
|---|---|---|
| `01_socialworld_base.sql` | 소셜 월드 기본 5개 테이블(profiles·missions·mission_progress·clubs·club_members) + RLS + 시연용 미션 4개 | ✅ 적용됨 |
| `02_loop_schema.sql` | 위험 탐지 에이전트와의 순환: npc_sessions(신호 컬럼), npc_chat_metrics(live/synthetic), escalations, cohort_feedback, 함수 2개, 환류용 미션 2개 | ✅ 적용됨 |
| `03_world_update.sql` | 새 맵·NPC 캐릭터·월드 리포트(2026-09-29): NPC 코드에 coco·chief 추가, cohort_feedback.event_theme, missions.stage(퀘스트 1~4단계)+시드 11개, profiles.avatar·interests·join_goal(튜토리얼), 새 테이블 8개(club_cheers·world_events·event_participation·npc_demand_logs·world_activity_metrics·npc_demand_metrics·world_reports) + 뷰 2개 + 집계 함수 2개 | ❌ 아직 적용 안 함 — 팀 확인 후 실행 |
| `04_coco.sql` | 코코(활동 추천) v1: `activity_catalog` + 시연용 활동 10개, 동아리 관심사 태그(`clubs.interest_tags`), `my_quest_stage()`, `recommend_activities()`. **03이 먼저 있어야 한다**(`profiles.interests`·`missions.stage`). 검증 `tests/run_coco.sh`(20항목) | ❌ 03 적용 후 실행 |
| `tests/` | 로컬 PostgreSQL용 Supabase 스텁(`00_supabase_stub.sql`)과 에이전트별 테스트 | — |
| `full_schema_reference.sql` | 목표 설계 전체(테이블 31·뷰 3·RLS 44). 관제 대시보드의 케이스·보고서·권한까지 포함 | ❌ 참고용 — 아직 적용 안 함 |
| `DB_테이블_정의서.md` | 전체 설계의 원칙·ERD·테이블 정의 + **11장 순환 연결로 실제 구현된 것** | |
| `DB_연결_단계별_실행가이드.md` | Supabase 프로젝트 생성, 카카오 로그인, React 연결 + **13장 순환 연결 절차** | |
| `04_DB테이블정의서.docx` | 정의서의 2026-09-22 공유용 사본(11장 없음) | |

01·02는 **여러 번 실행해도 안전**하다(`if not exists`, `drop policy if exists`, 시드 중복 방지). 로컬 PostgreSQL 16에서 01→02→01→02 순서로 두 번 돌려 오류 없이 테이블 9개·미션 6개가 되는 것을 확인했다.
03도 같다. 01→02→03→03→02→03 순서로 돌려 오류가 없고, 시민 역할에서 집계·이벤트 원본 테이블이 막히는 것, 응원 스티커 하루 1회 제한, 집계 함수 3개 결과를 확인했다(Supabase `auth` 스키마는 스텁으로 대체).

## 새 Supabase 프로젝트에 처음부터 세팅하기

1. Supabase 대시보드 → **SQL Editor** → New query → `01_socialworld_base.sql` 전체 붙여넣기 → Run
2. 같은 방법으로 `02_loop_schema.sql` → Run, 이어서 `03_world_update.sql` → `04_coco.sql` 순서로 Run
   (04부터는 파일명이 `적용 순서 번호_에이전트 이름.sql`. 번호 순서대로 실행한다)
3. **Authentication → Sign In / Providers → Anonymous Sign-Ins** 켜기
   (소셜 월드 데모의 "게스트로 들어가기"가 익명 로그인을 쓴다. 카카오 로그인은 `DB_연결_단계별_실행가이드.md` 5장)
4. 키 두 종류를 구분한다
   - **publishable key**(`sb_publishable_…`): 브라우저용. `social_world/socialworld-demo.html`과 React 앱 `.env`에 넣는다. 공개돼도 RLS가 막는다
   - **secret key**(`sb_secret_…`): 위험 탐지 에이전트 전용. `risk_agent/.env`에만 넣고 **절대 커밋하지 않는다**
5. `cd risk_agent && python supabase_sync.py check` 로 연결 확인

팀 공용 Supabase는 이미 1~3이 끝나 있다. 팀원은 4의 secret key만 받아 `risk_agent/.env`에 넣으면 된다.

## 왜 전체 스키마(full_schema_reference.sql)를 아직 안 쓰나

프로토타입 단계에서 필요한 건 소셜 월드 + 순환 테이블뿐이고, 관제 대시보드는 지금 정적 HTML(`risk_agent/build_dashboard.py`)로 만든다.
전체 스키마로 옮길 때 할 일:

- `02_loop_schema.sql`이 뺀 외래키(`regions`·`cohorts` 참조)를 다시 붙인다
- `npc_sessions`의 신호 컬럼 3개(`risk_keyword_count`·`severity_score`·`keyword_tags`), `npc_chat_metrics`의 `source`·`user_count`·`keyword_tags`, `cohort_feedback` 테이블이 전체 스키마에는 없으므로 추가한다 (정의서 11장)
- 위험 탐지 결과(`risk_agent/outputs*/*.csv`)를 `risk_scores`·`risk_factors`·`resource_recommendations`·`action_suggestions`에 적재하고, 대시보드가 이 테이블을 관리자 로그인으로 직접 읽게 바꾼다
