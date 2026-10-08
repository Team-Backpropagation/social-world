# 위험 탐지 에이전트 (통합기획서 6-6) — 프로토타입

통신·카드(거시) + 소셜 월드 NPC 대화(미시) 신호를 코호트(지역×성별×연령대) 단위로 결합해
①수집 → ②정합 → ③탐지 → ④판단 → ⑤원인분석 → ⑥추천 → ⑦우선순위 → ⑧행동제안 → ⑨문서초안 → ⑩환류
10단계를 끝까지 실행하는 파이프라인입니다.

입력은 두 가지 중 고를 수 있습니다.

| 모드 | 입력 | 코호트 | 결과 폴더 |
|---|---|---|---|
| 합성(기본) | 페르소나 기반 가상데이터 | 24개(전 연령) | `outputs/` |
| 실제 청년 | `data_preprocessing/clean/youth_master_daily.csv` | 8개(강남·춘천 × 남녀 × 20·30대) | `outputs_youth/` |

## 실행

`--youth`만 붙이면 `../data_preprocessing/clean/youth_master_daily.csv`를 알아서 찾습니다(옛 폴더 이름 `preprocessing`도 찾음).

```bash
cd risk_agent
pip install pandas numpy        # 이미 있으면 생략

# 실제 청년 데이터
python run_pipeline.py --youth
python build_dashboard.py outputs_youth
# → outputs_youth/dashboard.html 을 Chrome/Edge로 열기
#   (VS Code 미리보기나 탐색기 미리보기 창은 JavaScript를 안 돌려서 빈 화면이 됨)

# 합성 데이터(시연·검증용)
python run_pipeline.py
python validate.py              # 심어둔 원형을 되찾는지 채점 (실패 시 exit 1)
python build_dashboard.py
```

파일을 못 찾으면 경로를 직접 줍니다: `python run_pipeline.py --youth ../data_preprocessing/clean/youth_master_daily.csv`

`youth_master_daily.csv`가 없거나 오래됐으면 data_preprocessing 폴더에서 먼저 만듭니다.

```bash
cd ../data_preprocessing
python run_pipeline.py --only youth
```

## 전체 순환 — 소셜 월드 ↔ 위험 탐지 에이전트 (Supabase)

```
[소셜 월드] NPC 대화 선택지(신호 태그) ─► npc_sessions      개인 행, 본인만 읽기·쓰기. 원문 없음
                                             │ aggregate_npc_sessions()  ← 에이전트가 호출, DB 안에서 실행
                                             ▼
                                   npc_chat_metrics       코호트×월 집계, user_id 없음, 브라우저 차단
                                             │ 에이전트가 읽음(secret key)
                                             ▼
[에이전트] ①~⑩ (실제 청년 통신·카드 + 대화 신호) ─► cohort_feedback  코호트별 추천 NPC·미션. 등급은 넣지 않음
                                             │ 본인 코호트 행만 읽기(RLS)
                                             ▼
[소셜 월드] 추천 NPC에 말풍선 · 추천 미션을 맨 위로
```

### 처음 한 번

1. Supabase 대시보드 → SQL Editor → New query에 `../database/02_loop_schema.sql` 전체를 붙여넣고 Run
   (새 Supabase 프로젝트라면 `01_socialworld_base.sql`부터 — `database/README.md`. 팀 공용 프로젝트는 이미 적용됨)
   (여러 번 실행해도 안전. 테이블 4개·함수 2개·미션 2개가 추가됨)
2. `.env.example`을 복사해 `.env`로 저장하고 `SUPABASE_SECRET_KEY`에 **secret 키**를 넣기
   (Project Settings → API Keys → Secret keys. 이 키는 절대 공유·커밋 금지)
3. 연결 확인과 시연용 배경 적재
   ```bash
   python supabase_sync.py check    # 테이블 4개에 ✓가 뜨면 정상
   python supabase_sync.py seed     # 청년 8개 코호트 × 최근 6개월 합성 배경(코호트당 월 10건 내외)
   python supabase_sync.py seed-demand   # 하루 수요 합성 배경(최근 4주) — 대시보드 "소셜 월드에서 찾은 지원"
   ```
   `run_pipeline.py --supabase`는 하루·코코 수요를 `outputs_youth/demand.json`으로 받아 대시보드에 넣는다(위험 점수에는 안 씀).

### 시연 순서

1. `../social_world/socialworld-demo.html`을 브라우저로 열고 게스트로 입장 → 온보딩에서 **강남구·20대·여성**처럼
   성별까지 선택(성별을 비우면 집단 분석에 반영되지 않음)
2. 광장의 심리상담 NPC와 대화 — "지치고 힘들어요 → 속얘기할 사람이 별로 없어요 → 몇 달째예요"처럼
   무거운 선택지로 **3번 정도** 대화 (로컬 테스트 기준 3건부터 해당 코호트의 환류가 심리상담 NPC로 바뀜)
3. 에이전트 실행
   ```bash
   python run_pipeline.py --youth --supabase
   python build_dashboard.py outputs_youth
   ```
   출력에 코호트별 세션 수(실제 대화 수)와 Supabase에 쓴 환류 내용이 표시됨
4. 소셜 월드 새로고침 → 심리상담 NPC 머리 위에 "💬 오늘 이야기 나눠요", 미션방에서 추천 미션이 맨 위
5. `outputs_youth/dashboard.html`에서 같은 코호트의 '심리상담 신호' 막대가 올라간 것 확인

"사실 다 그만두고 싶을 때가 있어요"를 고르면 109·1577-0199 안내가 즉시 뜨고 `escalations`에 지역·시각만 기록된다
(user_id 저장 안 함 — DB 정의서 10장 Open Item 확정 전까지).

### 관리자 대시보드에서 보이는 것 (`outputs_youth/dashboard.html`)

| 영역 | 내용 |
|---|---|
| 맨 위 빨간 상자 | 최근 30일 **위기 발화** 건수·지역·시각·처리 여부. 누가 말했는지는 저장하지 않음 |
| 요약 3칸 | 확인이 필요한 집단 수, 가장 먼저 볼 집단, 이번 달 상담 대화 수(실제 / 시연용 배경) |
| 등급 읽는 법 | 5단계 뜻과 "등급은 집단끼리 비교한 순서"라는 주의 |
| 집단 지도 | 칸마다 등급 이름·점수, 실제 대화가 있으면 💬 건수 |
| 집단 상세 | 한 줄 이유 → 4가지 질문별 판정(평소 수준·약간 높음·높음·매우 높음) → **상담 대화에서 나온 이야기**(주제별 횟수, 대화한 사람 5명 미만이면 가림) → 카드 결제 흐름 → 권장 조치·자원 → 소셜 월드 반영 내용 |

대시보드 기능을 처음 받았다면 한 번만:
1. `../database/02_loop_schema.sql`을 SQL Editor에서 **다시 Run** (대화한 사람 수·주제별 횟수 컬럼 추가, 집계 함수 교체)
2. `python supabase_sync.py seed` 다시 실행 (시연용 배경에 주제 분포 추가)
3. `python run_pipeline.py --youth --supabase` → `python build_dashboard.py outputs_youth`

### 알아둘 점

- 거시(통신·카드)는 2025년 하반기, 미시(대화)는 지금 이 달 데이터다. 시점이 다른 두 층을 한 점수로 합치는 것은
  프로토타입의 한계이며, 실서비스에서는 둘 다 같은 기간으로 맞춰야 한다.
- 환류는 대화를 한 코호트만이 아니라 **거시 신호로 상위 등급이 된 다른 코호트에도** 적용된다(8개 중 5개 내외).
  분위수 등급의 한계가 그대로 개인화로 이어지므로 절대 기준 등급 결정과 함께 봐야 한다.
- 합성 배경은 `source='synthetic'`로 구분되어 있다. `supabase_sync.py seed`를 다시 돌리면 합성분만 교체되고 실제 대화는 그대로다.
- `--youth --supabase`가 아닌 기존 명령(`--youth`, 합성 모드)은 Supabase를 건드리지 않는다.

### 실제 청년 모드에서 쓰는 값

- 카드: `cnt_ex_fixed` (고정지출 제외 결제건수, 일별) — 금액은 세금에 지배되므로 건수
- 통신: `flow_pop_monthly` (코호트 월별 유동인구) — 일별 행에 복제된 값을 월 1행으로 되돌려 씀
- `split`: 파일의 값과 파이프라인 계산값이 1,472행 전부 같은지 실행 때마다 검사하고, 다르면 멈춤
- 미시신호(소셜 월드): 실제 데이터가 없으므로 기본은 **없음**(거시 3개 지표만으로 산출).
  `--synthetic-micro`를 붙이면 합성 미시신호를 얹지만, 실제+합성이 섞인 결과가 되니 시연용으로만 쓸 것
- `region_night_share_monthly` 등 `region_` 컬럼은 연령·성별 축이 없어 쓰지 않음

### 실제 청년 데이터 결과를 읽을 때 (2026-09-23 실행 기준)

8개 코호트의 입력 z값이 **전부 ±1.5 안쪽**이다. 뚜렷하게 이상한 코호트는 없다.
그런데 등급은 분위수(상대 순위)라서 8개 중 2개가 '위험'으로 표시된다.
팀원의 `detect_youth.py` 결론("위축후보 0건")과 같은 데이터에서 나온 결과이므로,
**'위험' 표시를 고립 발견으로 발표하면 안 된다.** 절대 기준 등급을 병행할지 팀 결정이 필요하다(Open Items 첫 항목).

또 eval(11~12월)이 baseline(7~10월)보다 계절이 추워서, `trigger_z`의 하락 일부는 날씨일 수 있다.
춘천 30대 남녀의 eval 건수가 baseline 대비 약 7% 낮은 것이 '선택적 소비 위축형'으로 분류됐는데,
같은 춘천 20대는 오히려 늘었다(학기 효과 추정, `chuncheon_term_flag` 미검증).

## 파일 구조

| 파일 | 역할 | 기획서 단계 |
|---|---|---|
| `config.py` | 임계값·가중치·이벤트 구간·요일배율. 모든 값에 출처 문서 주석. 나중에 `threshold_settings` 테이블로 옮길 자리 | — |
| `personas.py` | 24개 코호트에 원형(archetype) 배정 — 합성 데이터의 "숨은 정답" | ① |
| `synth_macro.py` | 통신 월별(`flow_cohort_monthly`) + 카드 일별(`card_cohort_daily`) 합성 | ① |
| `synth_micro.py` | 심리상담 NPC 집계(`npc_chat_metrics`) + 게임 활동(`engagement_metrics`) 합성. **user_id 없음** | ① |
| `real_youth.py` | 실제 청년 마스터(`youth_master_daily.csv`) → 파이프라인 입력 형식 변환 | ① |
| `supabase_sync.py` | Supabase 입출력 — 대화 집계 호출·읽기(①), 환류 쓰기(⑩), 합성 배경 적재 | ①, ⑩ |
| `pipeline.py` | 정합·탐지·판단·원인분석·추천·우선순위·행동제안·환류 | ②~⑧, ⑩ |
| `report.py` | 담당자용 보고서 초안(markdown) | ⑨ |
| `welfare_catalog.py` | 복지자원 목업 + 지역·연령 자격 필터 | ⑥ |
| `validate.py` | 원형 회수율·원인 일치율·오탐 측정 | 성능 평가 |
| `build_dashboard.py` + `dashboard_template.html` | 브리핑용 관리자 대시보드(단일 HTML, 데이터 인라인) | S-02 상당 |
| `chief.py` | 마을이장 v1 — 환류 이벤트 주제 + 관심사·퀘스트 집계로 광장 이벤트 초안을 만들고 승인 명령을 제공. 사용법은 `../social_world/chief/README.md` | ⑩ 이후(월드 운영) |
| `tests/test_chief.py` | 마을이장 단위 테스트(`python -m unittest tests.test_chief`) | — |
| `docs/가상데이터_생성방식_설명자료.md` | 대회 제출 필수 설명자료 | — |

### ⑩ 환류에 들어가는 것 (10/1 갱신)

| 칸 | 받는 쪽 | 값 |
|---|---|---|
| `npc_emphasis` · `priority_missions` | 소셜 월드 화면(말풍선·미션 정렬) | 주요 요인별 NPC·미션 |
| `event_theme` | 마을이장(`chief.py`) | 주요 요인 → 이벤트 주제 코드: 명절 무반응 `outdoor_walk` / 소비 위축 `free_activity` / 통신 추세 하락 `info_support` / 대화 신호 `small_talk` (`pipeline.EVENT_THEME_FROM_FACTOR`) |

등급·점수는 어느 칸에도 넣지 않는다. `event_theme` 칸은 `03_world_update.sql` 적용 뒤에만 쓴다(없으면 건너뛰고 안내만 출력).

## 핵심 설계 (근거 문서)

- **시간 3분할**: baseline 113일 / event 18일 / eval 53일 — `../data_preprocessing/notebooks/데이터_분석근거_정리.md` 12-7
- **탐지**: 요일별 중앙값 보정 → 29일 이동중앙값 추세제거 → MAD robust z (임계값 3.5) — 같은 문서 12-1
- **4개 입력 지표** (`risk_scores` 컬럼 그대로, 모두 "클수록 위험"으로 부호 통일)
  - `baseline_z` 통신 6개월 추세 하락
  - `trigger_z` 카드 eval 평균이 baseline보다 낮은 정도 (완만한 하락은 추세제거에 흡수되므로 수준비교로 따로 잡음)
  - `event_response` 명절 반응 크기가 같은 지역 동료 코호트보다 작은 정도 (H-A 가설)
  - `micro_signal` 심리상담 키워드율·심각도, 세션 5건 미만이면 null (k-익명성)
- **결합**: 거시 주·미시 보정(0.20/0.30/0.30/0.20), 미시 없으면 거시만 재정규화 — 통합기획서 5-1
- **등급**: 분위수 5단계 + 미시 z≥2.0이면 최소 Lv.3 (안전 하한)
- **원인**: 가중치×(subscore−50) 초과기여로 분해. 뚜렷한 원인이 없으면 자원 매칭 대신 "검증 먼저" 행동 제안

## 검증 결과 (합성 데이터)

| 항목 | 결과 |
|---|---|
| 심어둔 원형 6개 중 Lv.3 이상 탐지 | 6/6 |
| 주요 기여 요인이 원형과 일치 | 6/6 |
| Lv.5 중 실제 원형 비율 | 3/5 |
| 정상 18개 중 Lv.3 이상 진입(오탐) | 8/18 — 분위수 방식의 구조적 한계 |

"우리가 심은 패턴을 우리 로직이 읽어내는가"(내적 타당성)만 보여줍니다. 실제 위험을 맞히는지는
실 데이터 + KOSIS 고독사 통계 대조로만 확인할 수 있습니다.

## Open Items

- 분위수 vs 절대 임계값 — 분위수는 위험 코호트가 없어도 상위 20%를 Lv.5로 만든다 (오탐 8/18의 원인)
- 잡음만으로 그럴듯한 원인이 붙는 오탐 2건(강남 남 60대이상, 춘천 남 60대이상) — "두 산출 주기 연속 Lv.3+" 같은 안정성 조건 검토
- 거시·미시 가중치, 미시 안전하한 2.0, 초과기여 3점 기준 — 모두 잠정값
- 업종 축(구성 엔트로피) 미반영 — 현재 H-A는 총량 반응으로만 측정. `card_industry_daily` 연동 시 발견 3(구성 변화)을 직접 쓸 수 있음
- ⑨ 보고서·⑧ 행동제안은 템플릿 기반. 기획서의 LLM 활용 지점(문구 생성)은 다음 단계
- NPC는 대본형(선택지 태그). 자유 대화 + LLM 심각도 판정으로 바꾸려면 Edge Function 등 서버 쪽 코드 필요
- React 앱(`../social_world/react_app/`)에는 이번 순환 연결이 아직 반영되지 않았다 — 현재 순환은 `socialworld-demo.html` 기준. 옮길 항목은 `../social_world/README.md`
- Supabase 적재 — `outputs/*.csv`가 `../database/DB_테이블_정의서.md` 모듈 2·3·4 테이블에 대응하지만 테이블 자체는 아직 미생성(`full_schema_reference.sql`)
