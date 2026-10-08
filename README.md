# 사회적 고립 대응·예방 AI 에이전트 — 이음(IEUM)

제14회 2026 빅콘테스트 AI데이터활용 분야 「사회적 고립 예방 및 대응을 위한 AI 에이전트 개발」 출품작 저장소.
통신(SKT 유동인구)·카드(신한카드) 데이터로 강남구·춘천시의 **지역×성별×연령대 코호트** 고립 위험을 탐지하고,
에이전트가 위험 수준을 판단해 복지 자원을 연계한다. 청년(20~30대)에게는 예방형 게임 웹서비스 **소셜 월드**로 다가가고,
거기서 나온 대화 신호가 다시 위험 탐지에 들어가는 순환 구조다.

> 제출 마감 **2026-10-21** · 기획의 기준 문서는 `docs/planning/사회적고립_AI에이전트_통합기획서.md`
> 지금 무엇이 되고 무엇이 남았는지는 `docs/project_management/구현_현황표.md`

---

## 전체 흐름

```
 대회 원자료(DATA/)
      │  data_preprocessing/run_pipeline.py
      ▼
 코호트 정제 데이터(clean/) ───────────────┐
                                          ▼
 ┌────────────── risk_agent/run_pipeline.py  (위험 탐지 에이전트 ①~⑩) ───────────────┐
 │ ① 수집 → ③ 이상 탐지 → ④ 5단계 판단 → ⑤ 원인 분석 → ⑥ 자원 추천 → ⑦ 우선순위       │
 │ → ⑧ 담당자 행동 제안 → ⑨ 보고서 초안 → ⑩ 소셜 월드로 개인화 환류                   │
 └───────▲──────────────────────────────────────────────────────────────┬────────────┘
         │ 코호트 집계 대화 신호(user_id 없음)                          │ cohort_feedback
         │                     Supabase (database/)                     ▼
 social_world/socialworld-demo.html  ◄──────────────────────── 추천 NPC·미션 순서 변경
   NPC 대화 선택지 → npc_sessions        위기 선택지 → 109 안내 + escalations
         
 risk_agent/build_dashboard.py → 관리자 대시보드(dashboard.html)
```

## 폴더 지도

| 폴더 | 하는 일 | 먼저 볼 문서 |
|---|---|---|
| `data_preprocessing/` | 대회 원자료 → 코호트 단위 정제 데이터(`clean/`). 청년 마스터·청년 이탈 탐지 포함 | `README.md`, `docs/데이터_전처리_단계별_실행가이드.md` |
| `data_preprocessing/notebooks/` | EDA 스크립트와 그림, 분석 근거 | `데이터_분석근거_정리.md`, `차트_읽는법.md` |
| `risk_agent/` | 위험 탐지 에이전트(통합기획서 6-6) + 관리자 대시보드 생성 + Supabase 순환 연결 | `README.md`, `docs/가상데이터_생성방식_설명자료.md` |
| `social_world/` | 시민용 소셜 월드. 순환이 연결된 단일 HTML 데모와 React 프로토타입 | `README.md` |
| `database/` | Supabase 스키마(실행 순서대로 번호), DB 정의서·연결 가이드 | `README.md` |
| `docs/planning/` | 기획서(통합기획서·서비스·기능·화면), 지표 설계 노트 | `사회적고립_AI에이전트_통합기획서.md` |
| `docs/project_management/` | WBS 전체안·축소안, 구현 현황표, 로드맵(9/17), 현황판(9/23 스냅숏) | `구현_현황표.md` |
| `docs/competition/` | 대회 주제설명자료, 테이블 정의서(별첨1·2) | — |

저장소에 올리지 않는 것: 대회 원자료(`DATA/`), 정제 산출물(`clean/`), 실행 결과(`outputs*/`), 비밀값(`.env`).
각자 PC에서 만들거나 받아서 같은 위치에 둔다.

## 빠른 실행

모든 명령은 저장소 루트(`SSTeamProject/`)에서 시작한다.

```bash
# 1) 전처리 — DATA/ 준비 후 (약 2분, 검증 50개 항목 OK 확인)
cd data_preprocessing
pip install -r requirements.txt
python run_pipeline.py
cd ..

# 2) 위험 탐지 에이전트 — 합성 데이터 시연 / 실제 청년 데이터
cd risk_agent
python run_pipeline.py                 # 합성 24개 코호트 → outputs/
python validate.py                     # 심어둔 정답을 되찾는지 채점
python run_pipeline.py --youth         # 실제 청년 8개 코호트 → outputs_youth/
python build_dashboard.py outputs_youth   # outputs_youth/dashboard.html 을 브라우저로 연다

# 3) 소셜 월드와 순환까지 (Supabase 필요 — database/README.md 먼저)
python supabase_sync.py check
python run_pipeline.py --youth --supabase
python build_dashboard.py outputs_youth
```

소셜 월드 데모는 `social_world/socialworld-demo.html`을 브라우저로 열면 바로 팀 Supabase에 붙는다.

## 문서는 어느 것이 최신인가

- **Markdown(.md)이 원본**이다. 같은 이름의 `.docx`·`.pdf`는 공유용으로 내보낸 사본이며 만든 날짜 기준으로 멈춰 있다
  (예: 통합기획서의 공유용 사본은 `_1006` docx/pdf이고, 그보다 오래된 사본은 지웠다).
- 같은 문서가 claude.ai 프로젝트(「사회적 고립 대응 및 예방 agent 구현」)에도 올라가 있다. 저장소 쪽을 고치면 프로젝트 쪽도 맞춘다.
- 대체된 옛 문서(9/17 기획서, 소셜월드 기획 docx, 옛 WBS, 중복 사본)는 저장소에서 지웠다. 필요하면 첫 커밋 `67eb41f`에서 꺼낼 수 있다.

## 협업 규칙 (요약)

- `main`은 항상 돌아가는 상태로 둔다. 작업은 짧은 브랜치에서 하고 PR로 합친다.
- 브랜치 이름: `data/…` 전처리·분석, `agent/…` 위험 탐지, `world/…` 소셜 월드, `db/…` 스키마, `docs/…` 문서, `fix/…` 버그, `chore/…` 정리.
  영어 소문자와 하이픈만 쓴다 (예: `world/react-loop`, `agent/llm-explain`).
- 시작하자마자 **Draft PR**을 열어 두면 다른 팀원이 진행 상황을 볼 수 있다.
- 커밋 전 확인: `.env`·원자료·`clean/`이 올라가지 않는지(`git status`), 실행 결과 폴더가 섞이지 않았는지.

## 물고기 판매점 (2026-10-08)

시장 서쪽 **이음 수산 매입소**에서 물고기를 선택해 팔면 기존 온라인 소지금이 증가합니다. 받은 돈은 은행과 옷가게에서 사용할 수 있습니다. DB 관리자는 기존 경제·업적 이후 `database/11_fish_sales.sql`을 적용하세요.

변경점, 팀 DB 적용 순서, 가격 조정, 로컬 시험 방법: [수산 매입소·DB 연계 안내](docs/FISH-SHOP-DB-GUIDE.md).


## 최신 main + 시장 기능 통합 (2026-10-08)

main의 하루·마을 의견함·운영팀 화면·하루 규칙·위험 에이전트 변경을 현재 시장 작업과 통합했다. 업적과 물고기 판매 SQL은 각각 10·11로 정리했다. 파일 구조, 호환성 문제와 해결, DB 적용·로컬 시험 안내는 [main 통합 정리](docs/MAIN-INTEGRATION-2026-10-08.md)를 참고한다.
