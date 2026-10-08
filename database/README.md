# database — Supabase 스키마와 DB 문서

## 파일

| 파일 | 내용 | 팀 Supabase 적용 |
|---|---|---|
| `01_socialworld_base.sql` | 소셜 월드 기본 5개 테이블(profiles·missions·mission_progress·clubs·club_members) + RLS + 시연용 미션 4개 | ✅ 적용됨 |
| `02_loop_schema.sql` | 위험 탐지 에이전트와의 순환: npc_sessions(신호 컬럼), npc_chat_metrics(live/synthetic), escalations, cohort_feedback, 함수 2개, 환류용 미션 2개 | ✅ 적용됨 |
| `03_world_update.sql` | 새 맵·NPC 캐릭터·월드 리포트(2026-09-29): NPC 코드에 coco·chief 추가, cohort_feedback.event_theme, missions.stage(퀘스트 1~4단계)+시드 11개, profiles.avatar·interests·join_goal(튜토리얼), 새 테이블 8개(club_cheers·world_events·event_participation·npc_demand_logs·world_activity_metrics·npc_demand_metrics·world_reports) + 뷰 2개 + 집계 함수 2개 | ❌ 아직 적용 안 함 — 팀 확인 후 실행 |
| `04_coco.sql` | 코코(활동 추천) v1: `activity_catalog` + 시연용 활동 10개, 동아리 관심사 태그(`clubs.interest_tags`), `my_quest_stage()`, `recommend_activities()`. **03이 먼저 있어야 한다**(`profiles.interests`·`missions.stage`). 검증 `tests/run_coco.sh`(20항목) | ❌ 03 적용 후 실행 |
| `05_chief.sql` | 마을이장 v1: `world_events.status`(draft→published 승인제)·`template_key`·`theme`, 시민 뷰 `world_events_public`은 공개 이벤트만 + `joined`, 참여는 `join_world_event()`로만(03의 직접 insert 정책 제거), 관심사 분포 `chief_interest_counts()`(k=5, service_role). 검증 `tests/run_chief.sh`(27항목) | ❌ 03 적용 후 실행 |
| `06_haru.sql` | 하루 v1: 복지 정책 표 `welfare_programs`(risk_agent/haru_sync.py가 채움), `recommend_programs()`·`program_counts()`, 의견함 1차 `world_feedback` | 적용됨(10/7) |
| `07_feedback_chat.sql` | 마을 의견함 대화: 창구(이장·하루)·`feedback_messages`·운영팀 명단 `staff_members`·시민/운영팀 함수·90일 삭제, 정책추천·취업상담 미션 → '지원센터 하루 만나기' | 확인 필요 |
| `08_economy.sql` | 게임 화폐 지갑·예금·아이템 소유권·옷 구매·온라인 낚시·유저 거래 기반 + RLS·거래 함수 | ❌ 이번 작업에서는 실제 팀 DB에 적용하지 않음 |
| `tests/` | `00_supabase_stub.sql`(코코용 축약 스텁), `01_auth_stub.sql`(auth만 흉내 → 실제 01~05를 그대로 올림)과 에이전트별 테스트 | — |
| `full_schema_reference.sql` | 목표 설계 전체(테이블 31·뷰 3·RLS 44). 관제 대시보드의 케이스·보고서·권한까지 포함 | ❌ 참고용 — 아직 적용 안 함 |
| `DB_테이블_정의서.md` | 전체 설계의 원칙·ERD·테이블 정의 + **11장 순환 연결로 실제 구현된 것** | |
| `DB_연결_단계별_실행가이드.md` | Supabase 프로젝트 생성, 카카오 로그인, React 연결 + **13장 순환 연결 절차** | |
| `04_DB테이블정의서.docx` | 정의서의 2026-09-22 공유용 사본(11장 없음) | |

01·02는 **여러 번 실행해도 안전**하다(`if not exists`, `drop policy if exists`, 시드 중복 방지). 로컬 PostgreSQL 16에서 01→02→01→02 순서로 두 번 돌려 오류 없이 테이블 9개·미션 6개가 되는 것을 확인했다.
03도 같다. 01→02→03→03→02→03 순서로 돌려 오류가 없고, 시민 역할에서 집계·이벤트 원본 테이블이 막히는 것, 응원 스티커 하루 1회 제한, 집계 함수 3개 결과를 확인했다(Supabase `auth` 스키마는 스텁으로 대체).

## 새 Supabase 프로젝트에 처음부터 세팅하기

1. Supabase 대시보드 → **SQL Editor** → New query → `01_socialworld_base.sql` 전체 붙여넣기 → Run
2. 같은 방법으로 `02_loop_schema.sql` → Run, 이어서 `03_world_update.sql` → `04_coco.sql` → `05_chief.sql` → `06_haru.sql` → `07_feedback_chat.sql` → `08_economy.sql` 순서로 Run
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


## 돈 시스템·온라인 인벤토리 추가 (2026-10-07)

`08_economy.sql`은 기존 Supabase Auth를 사용하고, 01~07의 테이블을 변경하지 않는다. (처음 이름은 `06_economy.sql`이었으나 하루 06·의견함 07과 번호가 겹쳐 10/8 병합 때 08로 바꿨다.) 관리자가 SQL Editor에서 전체 파일을 실행하면 현재 데모의 온라인 지갑·인벤토리가 활성화된다. 같은 파일을 재실행해도 기존 잔액·아이템과 관리자가 수정한 가격·지원금을 초기화하지 않는다.

새 지갑의 기본 지원금 10,000원은 게임 시스템 시험용이다. 지원금은 `sw_economy_settings`, 옷 가격은 `sw_item_catalog`에서 관리한다. 브라우저는 잔액·아이템을 직접 쓰지 않고 `sw_economy` 함수를 호출한다.

코드·독립된 PostgreSQL 검증은 준비되었고, 실제 팀 DB의 관리 접속·SQL 적용·실제 사용자 계정 확인은 아직 수행하지 않았다. 파일의 이전 적용 표만으로 현재 서버의 상태를 확정하지 않는다.

팀 공유용 안내: [돈 시스템·온라인 인벤토리 변경 정리](../docs/ONLINE-ECONOMY-CHANGES.md).
