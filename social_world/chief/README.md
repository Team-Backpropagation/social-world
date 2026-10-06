# 마을이장 v1 — 광장 이벤트

이장은 "새 이벤트를 만들어 모두에게 연다"(코코는 이미 있는 활동 중에서 고른다). 결정은 규칙이, 공개는 담당자 승인이 한다.
LLM·자유 입력 없음 — 대사와 이벤트 문구는 템플릿이다(v2에서 LLM 대사).
설계: `docs/planning/소셜월드_게임흐름_NPC_설계.md` 3-1·3-2·7절.

## 흐름

```
[위험 탐지] run_pipeline.py --youth --supabase
     └─ cohort_feedback.event_theme   코호트별 이벤트 "주제"만(등급·점수 없음)
[이장]  python chief.py plan
     ├─ 입력: 환류 주제 + 관심사 분포 chief_interest_counts()(k=5) + 최근 4주 퀘스트 단계(world_activity_metrics)
     ├─ 템플릿 8종 중 점수로 고름 → 같은 주제는 한 번 → 남은 자리에 월드 전체 이벤트 1개 → 동시 진행 최대 3개
     ├─ 공개 문구 금칙어 검사(위험·고립·외로·연령·성별·지역 등)
     └─ world_events  status='draft'  (대상 코호트·근거는 관리자 전용 칸)
[담당자] python chief.py list → python chief.py approve <id>     → status='published'
[시민]  광장 이장에게 말 걸기 → 이번 주 이벤트(내 코호트 대상이 위, 이유는 안 보임) → "참여할래요"
     └─ join_world_event(id) → event_participation → aggregate_world_activity()가 코호트×주로 집계(이장의 장부, chief.py plan이 시작할 때 갱신)
```

## 파일

| 파일 | 하는 일 |
|---|---|
| `database/05_chief.sql` | `world_events.status`(draft·published·rejected·closed)·`template_key`·`theme`, 시민 뷰 `world_events_public`(공개만 + `joined`), `join_world_event()`, `chief_interest_counts()`. **03 다음에 실행** |
| `risk_agent/chief.py` | 이벤트 결정 엔진 + 승인 명령 + 시연용 월드 활동 합성 배경 |
| `risk_agent/pipeline.py` | `EVENT_THEME_FROM_FACTOR` — 주요 요인 → 이벤트 주제 |
| `social_world/chief/chief.js` | 광장 대화창. `Chief.open({ sb, nickname, onClose })` |
| `database/tests/run_chief.sh` | 실제 01→05를 로컬 PostgreSQL에 올려 검증(27항목) |
| `risk_agent/tests/test_chief.py` | 결정 규칙·금칙어·명령어 단위 테스트(23항목, Supabase 없이) |
| `social_world/chief/tests/demo_test.py` | 3D 데모에 붙인 이장 검증(데스크톱·모바일·05 적용 전·이벤트 없음 42항목) |

## 처음 한 번 (팀 Supabase)

1. SQL Editor에서 `03_world_update.sql` → `04_coco.sql` → `05_chief.sql` 순서로 Run (여러 번 실행해도 안전)
2. `cd risk_agent && python run_pipeline.py --youth --supabase` — 환류에 이벤트 주제가 함께 들어간다
3. 시연용 배경(선택): `python supabase_sync.py seed`(대화) · `python chief.py seed-world`(월드 활동, `source='synthetic'`)

## 운영 명령

```bash
cd risk_agent
python chief.py plan --offline        # Supabase 없이 outputs_youth/npc_feedback.json으로 미리보기
python chief.py plan --dry-run        # Supabase 입력으로 계산만
python chief.py plan                  # 초안 저장
python chief.py list                  # 초안·공개 중 + 관리자용 근거 · 참여 인원 · 한국 시간
python chief.py approve 12 13         # 공개 → 광장에 보임
python chief.py reject 14             # 반려
python chief.py close 12              # 끝내기(종료 시각이 지나면 자동으로 안 보임)
```

`config.py`의 `CHIEF_AUTO_PUBLISH = True`로 바꾸면 승인 없이 바로 공개한다(문제없이 운영된 뒤 전환).
`CHIEF_MAX_ACTIVE`(기본 3)는 초안+공개 중 이벤트 수 상한이다.

## 결정 규칙

| 항목 | 점수 |
|---|---|
| 환류 주제 일치 | 3 |
| 관심사 | 템플릿 관심사가 코호트에서 차지하는 비율 합 × 3 |
| 참여 부담 | 최근 퀘스트 단계 평균으로 부담 1~3 결정 → 템플릿 부담이 같으면 +1, 가벼우면 +0.5, 무거우면 단계당 −1 |

| 주제 코드 | 뜻 | 나오는 요인 |
|---|---|---|
| `outdoor_walk` | 부담 없는 야외 활동 | 명절 등 이벤트 무반응(H-A) |
| `free_activity` | 돈 안 드는 활동 | 선택적 소비 위축(H-B) |
| `info_support` | 생활 정보·지원 안내 | 통신 6개월 추세 하락 |
| `small_talk` | 가벼운 대화 모임 | 대화 신호(미시) |

템플릿 8종: 금요일 저녁 공원 산책 · 토요일 아침 천천히 달리기 · 게임방 협동 보드게임 밤 · 카페에서 차 한 잔 ·
일요일 오후 조용한 책 시간 · 집에 있는 재료 레시피 나눔 · 지원센터 생활 정보 데이 · 광장 플레이리스트 나눔.
문구는 `chief.py`의 `TEMPLATES`에만 있다. 고칠 때 `test_chief.py`가 금칙어를 검사한다.

실제 청년 결과(2026-09-23)로 미리보기하면: 강남 20대 남성(명절 무반응) → **금요일 저녁 공원 산책**,
춘천 30대 여성(소비 위축) → **일요일 오후 조용한 책 시간**, 월드 전체 → **카페에서 차 한 잔**.
관심사 자료가 쌓이면(k=5) 같은 주제 안에서 고르는 템플릿이 바뀐다(예: 요리 관심 → 레시피 나눔).

## 데모에 붙인 방식 (`socialworld-demo.html`)

| 위치 | 내용 |
|---|---|
| `<script src="chief/chief.js">` | 코코 스크립트 바로 다음. 파일 연결 방식(배포 때 한 파일로 합침) |
| `openNpc("chief")` → `openChief()` | 모듈이 있으면 이 창, 못 불러오면 기존 대본 트리로 대체 |
| `onClose` | 대본 트리 때와 같이 **첫 퀘스트 완료 + 튜토리얼 마지막이면 루미 마무리 인사** |
| `worldBlocked()` | `.chief-backdrop`이 떠 있는 동안 걷기·E키를 막음 |

03·05 적용 전이거나 공개된 이벤트가 없으면 이장은 "이번 주 모임은 아직 준비 중"이라고 안내만 한다.

## v1에서 안 한 것 (다음 순서)

- 월드 리포트(집계 숫자 → 해설 문장 → 관리자 대시보드 "소셜 월드에서 보인 모습")
- LLM 대사(이벤트당 배치 1회 생성·저장, 금칙어·숫자 검사 실패 시 템플릿)
- 관리자 대시보드의 승인 화면 — 지금은 명령어. "월드 운영" 탭 위치는 팀 결정 필요
- 코코 추천 후보에 공개 이벤트 넣기
- 이벤트 참여 → 퀘스트(예: "러닝 챌린지 참여하기") 자동 완료 연결
- 같은 주제를 받은 코호트가 여럿이면 첫 코호트 대상으로 이벤트 하나만 만든다(나머지는 `plan` 출력에 "건너뜀"으로 남음)
