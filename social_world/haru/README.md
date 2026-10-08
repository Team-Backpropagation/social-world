# 하루 v1 — 지원센터 정책 안내 NPC + 마을 의견함

지원센터 문 앞에서 사는 곳·나이대에 맞는 복지 정책을 메뉴 5개(주거비·생활비·마음건강·사람 만나기·일·취업)로 찾아 준다.
LLM 없이 규칙으로만 동작하고, 정책은 복지로 공공 API를 주 1회 받아 둔 DB에서 고른다. 2026-10-07부터 분수 옆 정책추천·취업상담 창구를 대신한다.
설계: `docs/planning/사회적고립_AI에이전트_통합기획서.md` 6-3, `docs/planning/소셜월드_게임흐름_NPC_설계.md` 3-4·6절.

## 1. 전체 흐름

```
[주 1회] risk_agent/haru_sync.py ──복지로 API(중앙부처·지자체 복지서비스)──► welfare_programs   ← API 호출은 여기서만
[시민]   하루 대화창 ── recommend_programs(메뉴) · program_counts(메뉴) ──► 정책 카드 3장(+더 보기 3)
                     └─ npc_demand_logs (수요 신호: 추천·열람·링크·신청했어요·자격 미달 수)
         카드 [정보가 달라요] ──┐
         이장 [마을에 건의하기] ┴─► submit_feedback ─► 마을 의견함 ◄─► 운영팀 화면(social_world/admin)
         휴대폰 '내 의견함' ◄─────────────── 운영팀 답(사람이 직접 씀)
```

## 2. 파일

| 파일 | 하는 일 |
|---|---|
| `risk_agent/haru_probe.py` | 복지로 API 3종 연결 확인(인증키·응답 모양). 샘플은 `risk_agent/haru_samples/`(git 제외) |
| `risk_agent/haru_sync.py` | 복지로 → `welfare_programs`. 바뀐 것만 상세 조회, API별 한도 초과 시 그 API만 멈추고 다음 실행에 이어 받음 |
| `risk_agent/haru_recommend.py` | `recommend_programs()`·`program_counts()`의 Python 판(같은 규칙). 검수 도구와 v2 Python 판단 서버가 쓴다. 09 규칙을 바꾸면 같이 고친다 |
| `risk_agent/haru_check.py` | 정책 데이터 검수(읽기만) — 정책별 살펴볼 점, 강남·춘천 × 20·30대 × 메뉴별로 실제 보일 카드 → `risk_agent/haru_samples/check_*.csv` |
| `database/06_haru.sql` | 정책 표, `recommend_programs()`·`program_counts()`, 의견함 1차(`world_feedback`) |
| `database/09_haru_rules.sql` | 10/8 검수 후 규칙 보정: 저소득만 붙은 사업은 기본 카드('소득 기준이 있어요') — `recommend_programs()`·`program_counts()`만 바꿈 |
| `database/07_feedback_chat.sql` | 의견함을 대화로: 창구(이장/하루)·메시지·운영팀 명단·시민/운영팀 함수·90일 삭제, 정책·취업 창구 미션 교체 |
| `social_world/haru/haru.js` | 하루 대화창. `Haru.open({ sb, profile, onClose })` |
| `social_world/haru/haru-preview.html` | DB 없이 화면 확인(실제 복지로 응답 샘플로 만든 카드) |
| `social_world/feedback/feedback.js` | 시민 쪽 의견함 부품: `Feedback.compose()`(쓰기) · `Feedback.inbox()`(내 의견함) · `Feedback.unread()` |
| `social_world/feedback/feedback-preview.html`, `fake-db.js` | 내 의견함 미리보기와 가짜 DB(미리보기·테스트 전용, 데모에 안 들어감) |
| `social_world/admin/index.html`, `feedback-admin.js` | 운영팀 의견함 화면(로그인) · `admin-preview.html` 미리보기 |
| 테스트 | `risk_agent/tests/test_haru_sync.py`(24) · `test_haru_recommend.py`(7, SQL과 같은 결과) · `test_haru_check.py`(9) · `test_demand.py`(9, 대시보드 수요) · `database/tests/run_haru.sh`(44) · `run_feedback.sh`(59) · `haru/tests/ui_test.py`(94) · `feedback/tests/ui_test.py`(78) · `haru/tests/demo_test.py`(3D 데모) |

## 3. 적용 순서

1. SQL Editor에서 `06_haru.sql` → `07_feedback_chat.sql` → `09_haru_rules.sql` 실행(여러 번 실행해도 안전, 08은 하루와 무관)
2. `risk_agent`에서 정책 받기: `python haru_sync.py` (처음엔 하루로 다 못 받을 수 있음 — 다음 날 다시 실행하면 이어서 받음)
   - 규칙(메뉴·특정 대상·나이)을 바꾼 뒤: `python haru_sync.py --refresh-menus` (API 호출 없음)
3. 운영팀 계정 만들기: Supabase → Authentication → Add user(이메일·비밀번호, Auto Confirm) → SQL Editor에서
   ```sql
   insert into public.staff_members (user_id, label)
   select id, '운영팀' from auth.users where email = '팀원@메일' on conflict do nothing;
   ```
4. 운영팀 화면: `social_world/admin/index.html`을 브라우저로 열고 그 계정으로 로그인
5. 데모: `python social_world/app/bundle.py`로 `socialworld-demo.html` 다시 만들기(직접 고치지 않음)
6. 검수: `python haru_check.py` — 시연 전에 이상한 카드가 없는지 본다(복지로 API 호출 없음)
7. 대시보드: `python supabase_sync.py seed-demand`(시연용 수요 배경, 한 번) → `python run_pipeline.py --youth --supabase` → `python build_dashboard.py outputs_youth` — "소셜 월드에서 찾은 지원"에 하루 메뉴별 조회·신청·자격 미달이 나온다

## 4. 정책 고르기 규칙 (06 + 09)

| 단계 | 내용 |
|---|---|
| 거르기 | 사업 중 · 메뉴 일치 · 전국 또는 내 시군구 · 생애주기(20대→청년, 30대→청년·중장년) · 나이 범위가 내 나이대와 겹침 |
| 나이 | 대상 문장에서 확실할 때만 뽑음. 모르거나 일부만 겹치면 카드에 "⚠ 나이 조건 확인" |
| 특정 대상 | 장애인·보훈·한부모 등 대상 특성이 있는 사업은 접어 두고 "특정 대상 정책 N개 보기"로만 보임. **저소득만** 있는 사업은 기본 카드에 "소득 기준이 있어요"로 나온다(09 — 청년월세·행복주택 등 청년 주요 사업이 모두 저소득 표시라서) |
| 이름으로 보정 | 고교·고등학교·고졸·모델 개발 사업은 메뉴에서 뺌. 의사상자·자립준비청년·경계선지능·입양/가정위탁은 특정 대상으로 더함(`haru_sync.EXCLUDE_NAME`·`GROUP_FROM_NAME`) |
| 순서 | 온라인 신청 + 청년 전용 점수 → 같으면 **지자체 먼저** → 복지로 조회수 |
| 메뉴 | 복지로 관심주제(주거·생활지원·서민금융·정신건강·문화·여가·일자리) + 사업 이름 낱말(전월세·자격증 등) |

## 5. 기록 원칙

| 무엇 | 어디에 | 비고 |
|---|---|---|
| 카드를 본 것·자세히·링크·신청했어요 | `npc_demand_logs` (npc_type: 일·취업 `job`, 나머지 `policy`, category: 메뉴 이름) | 수요 신호. 위험 점수에 안 씀 |
| 자격 미달 수 | 같은 표, action `ineligible`, item_id `count:N` | 메뉴마다 1줄 |
| 특정 대상 정책을 펼친 것·누른 것 | **남기지 않음** | 장애·소득 같은 민감 정보 추정 방지 |
| 소득 기준 사업(기본 카드) | 메뉴 단위로만(item_id 없음) | 어느 사업을 봤는지 남기지 않음 |
| 하루 대화 | `npc_sessions`에 남기지 않음 | 위험 탐지는 루미(psych)만 읽음 |
| 의견 글 | `world_feedback`·`feedback_messages` 90일 | 위기 표현은 저장 안 함(→ `report_crisis('civil')`), 전화번호·이메일 가림, 하루 새 의견 5·답장 20 |
| 운영팀 화면 | 가명 번호(주민 #7F3A)만 | 계정·닉네임·위험 정보 없음. 운영팀 답장은 시민에게 "운영팀 · 사람이 직접 쓴 답"으로 보임 |

## 6. 데모에 붙인 방식

| 위치 | 내용 |
|---|---|
| `app/index.html` | `../haru/haru.js`, `../feedback/feedback.js` (bundle.py가 안에 넣음) |
| `NPCS` | `policy`·`job` 대본 삭제, `{ id:"haru", noSignal:true, external:true }` 추가. 취업 지침 선택지(장기구직·무기력·구직단념)는 루미 대본 `tired → jobtired`로 옮김 |
| 3D `places.haru` | 지원센터 문 오른쪽(문 판정점과 4.2 떨어짐). 서류판을 든 청록 옷 |
| `openNpc("haru")` | `Haru.open({ sb, profile })`. 창이 떠 있는 동안 걷기·E키 막음 |
| 환류 강조 | `npc_emphasis`가 `policy`·`job`이면 하루 머리 위 말풍선 |
| 휴대폰 | 홈에 '내 의견함' 앱(새 답 배지)·'마을에 건의하기', 연락처에 하루 |
| 이장 | 대화창 아래 [마을에 건의하기] → 의견 폼(창구 `chief`, 장소 광장) |
| 미션 | '정책추천/취업상담 NPC와 대화하기' 끄고 '지원센터 하루 만나기' 추가(07 G). `risk_agent/pipeline.py` 우선 미션도 바꿈 |

## 7. 남은 것

- 장애인 편의시설 API(`--facility`) — 이름 검색이 부정확해 검색 방법 확인 뒤 붙인다
- 하루 LLM 응답(RAG) — 정책 문서 근거로 답하는 자리. 지금은 규칙·템플릿 대사
- 위기 표현 목록(`_haru_crisis`)은 임시 — 위험 키워드 사전이 나오면 바꾼다
- 지원 지역은 강남구·춘천시만. 그 밖은 전국 정책만 보인다

## 7. 실제 데이터 검수 기록 (2026-10-08, `haru_check.py`)

팀 DB 정책 157건(중앙 141 · 강남 8 · 춘천 8)을 강남·춘천 × 20·30대 × 메뉴 5개로 펼쳐 본 결과와 고친 것.

| 본 것 | 고친 것 |
|---|---|
| 청년월세 지원·행복주택·버팀목전세·청년내일저축계좌·국민취업지원제도가 모두 '특정 대상' 안에 숨음(복지로가 소득 기준 사업에 '저소득'을 붙임) | 09: 저소득만 있으면 기본 카드 + "소득 기준이 있어요" |
| "만 19세 미만의 청소년" 사업이 20·30대 마음건강에 나옴 | 나이: '…세 미만/이하' 상한(25세 이상이거나 바로 뒤가 '청소년'일 때만), `&sim;`·전각 물결, "18세 이상이더라도"는 조건 아님 |
| 고교 취업연계 장려금·고졸자 후속관리 지원모델 개발사업이 일·취업 앞자리 | 이름으로 메뉴에서 뺌 |
| 의사상자지원·자립준비청년 자립수당이 모두에게 보임 | 이름으로 특정 대상(의사상자·자립준비청년 …) |
| '취업 후 상환 학자금대출'이 일·취업으로 들어감 | 이름 낱말 '취업 후 상환'은 일·취업 아님 |
| 사람 만나기 메뉴가 거의 빔(20대 1건 · 30대 '큰글자책 보급') | v1은 그대로 — 129 안내. v2에서 청년센터·문화 프로그램 자료 추가 검토 |
