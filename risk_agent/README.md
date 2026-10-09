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
python validate.py              # 심어둔 원형을 찾고 정상에 경고하지 않는지 채점 (실패 시 exit 1)
python evaluate.py              # 시나리오 9종 × 평가용 seed 20개 혼동행렬 (docs/판단검증_결과.md)
python mde.py --youth <경로>     # 탐지 한계: 결제가 몇 % 줄어야 확인권장이 뜨는가(실제 청년 데이터)
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
| 상태 읽는 법 | 4단계(확인권장·변화관찰·평소범위·판단보류) 뜻과 "자기 평소와 비교한 결과, 원래부터 낮은 집단은 못 찾음"이라는 주의 |
| 집단 지도 | 칸마다 상태 이름·신호 세기, 실제 대화가 있으면 💬 건수 |
| 집단 상세 | 한 줄 이유 → 4가지 질문별 판정(평소 수준·조금 다름·관찰 기준 넘음·확인 기준 넘음) → **상담 대화에서 나온 이야기**(주제별 횟수, 대화한 사람 5명 미만이면 가림) → 카드 결제 흐름 → 권장 조치·자원 → 소셜 월드 반영 내용 |

대시보드 기능을 처음 받았다면 한 번만:
1. `../database/02_loop_schema.sql`을 SQL Editor에서 **다시 Run** (대화한 사람 수·주제별 횟수 컬럼 추가, 집계 함수 교체)
2. `python supabase_sync.py seed` 다시 실행 (시연용 배경에 주제 분포 추가)
3. `python run_pipeline.py --youth --supabase` → `python build_dashboard.py outputs_youth`

### 알아둘 점

- 거시(통신·카드)는 2025년 하반기, 미시(대화)는 지금 이 달 데이터다. 시점이 다른 두 층을 한 점수로 합치는 것은
  프로토타입의 한계이며, 실서비스에서는 둘 다 같은 기간으로 맞춰야 한다.
- 환류는 **확인권장** 집단에만 적용된다(2026-10-09부터). 기준을 넘은 집단이 없으면 환류도 비어 있는 것이 정상이다.
- 합성 배경은 `source='synthetic'`로 구분되어 있다. `supabase_sync.py seed`를 다시 돌리면 합성분만 교체되고 실제 대화는 그대로다.
- `--youth --supabase`가 아닌 기존 명령(`--youth`, 합성 모드)은 Supabase를 건드리지 않는다.

### 실제 청년 모드에서 쓰는 값

- 카드: `cnt_ex_fixed` (고정지출 제외 결제건수, 일별) — 금액은 세금에 지배되므로 건수
- 통신: `flow_pop_monthly` (코호트 월별 유동인구) — 일별 행에 복제된 값을 월 1행으로 되돌려 씀
- `split`: 파일의 값과 파이프라인 계산값이 1,472행 전부 같은지 실행 때마다 검사하고, 다르면 멈춤
- 미시신호(소셜 월드): 실제 데이터가 없으므로 기본은 **없음**(거시 3개 지표만으로 산출).
  `--synthetic-micro`를 붙이면 합성 미시신호를 얹지만, 실제+합성이 섞인 결과가 되니 시연용으로만 쓸 것
- `region_night_share_monthly` 등 `region_` 컬럼은 연령·성별 축이 없어 쓰지 않음

### 실제 청년 데이터 결과를 읽을 때

- 2026-09-23 실행(옛 분위수 등급): 8개 코호트의 입력 z값이 전부 ±1.5 안쪽인데도 분위수라 2개가 '위험'으로 표시됐다.
- 2026-10-09 판정 방식 교체(4단계 상태): 집단끼리 줄 세우지 않으므로 기준을 넘은 집단이 없으면 **확인권장 0개**가 정상 결과다.
  **새 방식으로 실제 데이터를 다시 돌린 결과는 아직 없다** — 원자료가 있는 PC에서 `python run_pipeline.py --youth`와
  `python mde.py --youth <경로>`를 실행해 이 절을 갱신할 것.
- 어느 쪽이든 '확인권장'은 "집단 활동이 자기 평소와 달라져 사람이 확인할 필요"이지 고립 발견이 아니다.

또 eval(11~12월)이 baseline(7~10월)보다 계절이 추워서, `trigger_z`의 하락 일부는 날씨일 수 있다.
춘천 30대 남녀의 eval 건수가 baseline 대비 약 7% 낮은 것이 '선택적 소비 위축형'으로 분류됐는데,
같은 춘천 20대는 오히려 늘었다(학기 효과 추정, `chuncheon_term_flag` 미검증).

## 파일 구조

| 파일 | 역할 | 기획서 단계 |
|---|---|---|
| `config.py` | 판정 기준(`JUDGMENT`)·이벤트 구간·요일배율·합성 효과 크기(`SYNTH_EFFECTS`). 모든 값에 출처 문서 주석. 나중에 `threshold_settings` 테이블로 옮길 자리 | — |
| `personas.py` | 24개 코호트에 원형(archetype) 배정 — 합성 데이터의 "숨은 정답" | ① |
| `synth_macro.py` | 통신 월별(`flow_cohort_monthly`) + 카드 일별(`card_cohort_daily`) 합성 | ① |
| `synth_micro.py` | 심리상담 NPC 집계(`npc_chat_metrics`) + 게임 활동(`engagement_metrics`) 합성. **user_id 없음** | ① |
| `real_youth.py` | 실제 청년 마스터(`youth_master_daily.csv`) → 파이프라인 입력 형식 변환 | ① |
| `supabase_sync.py` | Supabase 입출력 — 대화 집계 호출·읽기(①), 환류 쓰기(⑩), 합성 배경 적재 | ①, ⑩ |
| `pipeline.py` | 정합·탐지·판단·원인분석·추천·우선순위·행동제안·환류 | ②~⑧, ⑩ |
| `report.py` | 담당자용 보고서 초안(markdown) | ⑨ |
| `welfare_catalog.py` | 복지자원 목업 + 지역·연령 자격 필터 | ⑥ |
| `validate.py` | 기본 합성 1벌: 재현율·오탐률·이유 일치(오탐률 상한도 성공 조건) | 성능 평가 |
| `scenarios.py` | 판단 검증 시나리오 9종(전부 정상·효과 크기·교란·독립 생성), 조정용/평가용 seed 분리 | 성능 평가 |
| `evaluate.py` | 시나리오 × seed 혼동행렬, `--timeline`은 매주 그날까지의 자료로만 판정 | 성능 평가 |
| `mde.py` | 탐지 한계 — 집단 결제가 몇 % 줄어야(몇 주 이어져야) 확인권장이 뜨는가 | 성능 평가 |
| `docs/판단검증_결과.md` | 판정 방식 교체 전·후 비교, 원형별 결과, 한계 | 성능 평가 |
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
- **탐지**: 요일별 중앙값 보정(baseline 기준). 참고용 급변 z는 기본이 **그날까지의 29일**(prospective), `--mode retrospective`면 앞뒤 14일(사후 분석)
- **판정 = 혼자 기준선**(2026-10-09, 분위수 5단계 대체): 각 집단을 다른 집단과 줄 세우지 않고 **자기 평소(baseline)와만** 비교.
  같은 지역 다른 집단들의 공통 변화(계절·날씨)는 빼고 본다. 기준값은 `config.JUDGMENT`
  - `trigger_z` 카드: eval 수준이 평소 하루 흔들림의 몇 배 낮아졌나. 관찰 1.0 / 확인 1.5 + 기준 넘은 주 3주 이상
  - `baseline_z` 통신(월별): 평소 월 흔들림의 몇 배. 관찰 1.5(이후 달 모두) / 확인 2.0. **배경 신호라 혼자서는 확인권장이 안 됨**
  - `event_beta` 명절 동조도: 달력 공휴일에 지역이 움직인 만큼 따라 움직였나(1=같이, 0=무반응). 관찰 0.6↓ / 확인 0.35↓ + 판정 가능한 명절 2개 모두 낮음
  - `micro_severity` 대화 심각도: 루미와 같은 절대 기준. 관찰 0.45 / 확인 0.8 또는 최근 3개월 중 2개월 0.45 이상
- **상태**: 확인 기준을 넘은 신호 있음 → 확인권장 / 관찰 기준만 → 변화관찰 / 없음 → 평소범위 / 카드 자료 부족 → 판단보류.
  DB `risk_level`은 평소 1·관찰 2·확인권장 3으로 매핑(판단보류는 비움), `status` 칸이 정본
- **이유**: 기준을 넘은 신호 중 세기(확인 기준선=1)가 가장 큰 것. `score`는 그 세기×50(확인 순서용, 확률 아님)

## 검증 결과 (합성 데이터, 평가용 seed 20개 — 상세는 `docs/판단검증_결과.md`)

| 시나리오 | 옛 분위수 등급(Lv.3+) | 새 4단계(확인권장) |
|---|---|---|
| 전부 정상 | 실행마다 경고 14개 | **경고 0개** |
| 기본 원형 6개 | 재현율 95% · 특이도 53% · 정밀도 40% | 재현율 79% · **특이도 100% · 정밀도 100%** |
| 하루 급감·1주 급감·지역 공통 감소 | 경고 14개 | **경고 0개** |
| 독립 생성 위험 6개(계단형·늦은 감소·명절 평탄) | 재현율 86% · 특이도 51% | 재현율 98% · 특이도 100% |

재현율이 낮아진 이유는 대부분 구조적 저활동형(원래부터 낮은 집단)이다 — 자기 기준선 방식으로는 원리적으로 못 찾으며(변화관찰까지),
보고서에 "변화 없음 ≠ 고립 없음"으로 적는다.

"우리가 심은 패턴을 우리 로직이 읽어내는가"(내적 타당성)만 보여줍니다. 실제 위험을 맞히는지는
실 데이터 + KOSIS 고독사 통계 대조로만 확인할 수 있습니다.

## Open Items

- ~~분위수 vs 절대 임계값~~ → 2026-10-09 4단계 상태(혼자 기준선)로 교체
- `JUDGMENT` 기준값은 합성 시나리오로 고른 잠정값 — 실제 데이터로 `mde.py`를 돌려 감지 한계를 확인할 것
- 미시 표본 기준이 아직 **세션 수**(5건)다 — 실제 고유 사용자 수 기준으로 바꾸고 합성 배경을 빼야 함(실행계획 작업 2)
- 원래부터 활동이 낮은 집단(구조적 저활동형)은 자기 기준선 방식으로 못 찾음 — 외부 배경자료(1인가구 비율 등)를 정적 위험층으로 두는 안 검토
- 업종 축(구성 엔트로피) 미반영 — 명절 동조도는 총량 기준. `card_industry_daily` 연동 시 발견 3(구성 변화)을 직접 쓸 수 있음
- ⑨ 보고서·⑧ 행동제안은 템플릿 기반. 기획서의 LLM 활용 지점(문구 생성)은 다음 단계
- NPC는 대본형(선택지 태그). 자유 대화 + LLM 심각도 판정으로 바꾸려면 Edge Function 등 서버 쪽 코드 필요
- React 앱(`../social_world/react_app/`)에는 이번 순환 연결이 아직 반영되지 않았다 — 현재 순환은 `socialworld-demo.html` 기준. 옮길 항목은 `../social_world/README.md`
- Supabase 적재 — `outputs/*.csv`가 `../database/DB_테이블_정의서.md` 모듈 2·3·4 테이블에 대응하지만 테이블 자체는 아직 미생성(`full_schema_reference.sql`)
