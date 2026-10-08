# 위험사전 v1 — 스키마 · 작성 규칙 · 갱신 절차

자유 입력(루미 LLM, 하루 소통 창구, 마을 의견함)에서 위기 표현과 고립 신호를 잡는 사전이다.
계획·결정: `docs/planning/위험사전_v1_작업계획.md` · 근거·점수 규칙: `docs/planning/위험사전_근거_매핑표.md`

> 판단 코드는 **Python 하나**다(10/7 결정). 브라우저용 매처는 만들지 않는다.
> 옛 JS 부품 `../npc/severity.js`·`severity_config.json`은 10/7 이전 규칙이라 쓰지 않는다(지우지는 않음).

## 1. 파일

| 파일 | 담당 | 하는 일 |
|---|---|---|
| `crisis.json` | A | ① 위기 표현 — `strong` / `ambiguous` / `idiom` |
| `risk_tags.json` | B | ② 위험 키워드 — 태그 9종(정의·차원·기본 심각도·근거) + 표현 패턴 + 기간 표현표 |
| `scoring.json` | 공통 | 점수 규칙(10/8 확정) — 가중치·구간·차원 가산·지속성·관용 배율 |
| `../risk_check.py` | Claude | 매처: 문장 → `{crisis, tags, K, mitigated, idiom, hits}` |
| `../severity.py` | Claude | 심각도: K·T·지속성 → `{severity, band, actions}`, 세션 요약 |
| `../validation/*.csv` | A·B | 예문(가상 문장만). 위기 예문은 비공개 |
| `../tests/test_risk_check.py` | Claude | 단위 테스트 — 매핑표 3절 예시가 정답 |
| `../tests/run_lexicon.py` | Claude | 예문 채점기 — 완료 기준(작업계획 5절) 리포트 |

```bash
# 저장소 루트에서
python -m unittest discover -s social_world/common/tests     # 단위 테스트
python social_world/common/tests/run_lexicon.py              # 예문 채점 (--strict: 미달이면 종료 코드 1)
python social_world/common/risk_check.py "요즘 좀 지치고 힘들어"   # 문장 하나 확인
```

표준 라이브러리만 쓴다. Colab에서는 `social_world/common/` 폴더째 올리고 `import risk_check, severity`.

## 2. 항목 형식

| 칸 | 뜻 |
|---|---|
| `id` | 고유 id. 위기 `C-S01`(strong)·`C-A01`(ambiguous)·`C-I01`(idiom), 위험 `R-<태그>-01` |
| `kind` | `crisis` / `risk` |
| `tag` | 위기는 `위기발화`, 위험은 `risk_tags.json`의 `tags`에 있는 이름 |
| `patterns` | 정규식 목록. **정규화된 문장**(아래 3절)에 맞춘다 — 띄어쓰기 없이 쓴다 |
| `grade` | 위기만. `strong` 즉시 위기 / `ambiguous` LLM 맥락 판정(실패·시간 초과면 위기) / `idiom` 확실한 관용 조합(위기 아님) |
| `exclude` | 이 정규식이 문장에 있으면 이 항목은 걸리지 않는다 |
| `base_severity` | 위기 1.0. 위험 태그의 기본 심각도는 `tags`에 한 번만 적는다 |
| `examples` | 대표 예문(가상 문장) |
| `source` | 근거(매핑표 S1~S10, 문항 번호·문서명). 확인 전이면 `status: draft` |
| `status` | `draft` / `confirmed` |

`risk_tags.json`의 `tags`: `dimension`(정서·사회·행동·경제·지속 — 차원 가산용), `base_severity`, `strength`, `definition`, `source`.

## 3. 매처가 하는 일

1. **정규화** — 띄어쓰기·문장부호·이모지 삭제, 같은 글자 3번 이상은 1번("싶어어어" → "싶어", "ㅠㅠㅠ" → "ㅠ"). 숫자는 그대로.
2. **위기** — `idiom` 부분을 먼저 지우고(그 자리는 막아서 앞뒤가 새로 붙지 않게), `strong` → `ambiguous` 순으로 본다. strong이 하나라도 있으면 strong.
   부정("죽고 싶진 않아")은 v1에서 처리하지 않는다 — 놓치지 않는 쪽을 택하고 오탐으로 기록한다.
3. **위험 태그** — 항목 패턴 매칭 → `exclude` 제외 → 기간 표현(4절) → K.
4. **K** = 걸린 태그 기본 심각도의 최댓값 + 다른 차원 하나당 +0.1(최대 +0.2) − 완화 0.1. 관용·과장(LLM `idiom_flag`)의 ×0.5는 `severity.py`가 곱한다.
5. **반환** — `{crisis, tags, K, mitigated, idiom, hits}`. `hits`는 항목 id(`D-고립지속`·`D-완화`는 기간 규칙)뿐, **원문은 돌려주지도 저장하지도 않는다.**

## 4. 기간 표현 (`risk_tags.json` → `duration`, 매핑표 3-2)

| 묶음 | 처리 |
|---|---|
| `transient` 오늘·어제·며칠·요즘 좀·가끔 | 위험 태그가 있고 기간 태그가 없으면 K −0.1 |
| `weeks` 몇 주·한 달쯤 | 기간 태그 없음 |
| `months` 몇 달째·반년 | 고립지속 |
| `months.patterns_with_risk` 계속·맨날 | **다른 위험 태그가 같은 문장에 있을 때만** 고립지속. 위험 패턴이 이미 쓴 부분("계속 떨어" → 장기구직)은 세지 않는다 (10/8 결정 (가)) |
| `years` 1년 넘게·몇 년째 | 장기고립(고립지속은 같이 붙이지 않음 — 기간 태그는 하나만) |

## 5. 심각도 (`severity.py`, 매핑표 3-3)

```
severity = min(1, 0.5·K + 0.5·T + 지속성)      T = LLM tone_score. 없으면 0으로 계산
지속성   = 세션의 위험 발화(태그·위기) 순번 — 3~4번째 +0.1, 5번째부터 +0.2
band     = normal < 0.45 ≤ suggest < 0.8 ≤ strong   ·   crisis(위기 판정)
```

- 위기 판정: 사전 `strong` / 사전 `ambiguous` + LLM 확인(LLM 결과 없으면 위기) / LLM `crisis_suspect`.
- 할 일: 위기 안내 배너는 판정 때마다, `report_crisis()`는 세션당 1번. 연결 제안은 종류별 세션당 1번, 강한 제안 뒤에는 일반 제안을 하지 않는다.
- 세션이 끝나면 `Session.summary()`(`keyword_tags`, `risk_keyword_count`, `severity_score` = 최고 심각도)만 `npc_sessions`에 저장한다.

## 6. 작성 규칙

- 예문은 **팀이 직접 만든 가상 문장만**. 실제 사용자 발화·커뮤니티 글을 옮기지 않는다.
- 척도·조사표 **문항 원문은 넣지 않는다** — 번호와 주제 요약만(`source`에).
- 패턴은 넓게 잡을수록 오탐이 는다. 위기 사전은 놓치지 않는 쪽, 위험 사전은 정확한 쪽(작업계획 1절).
- 패턴을 추가하면 `examples`에 한 줄 이상, `validation/*.csv`에 양성·음성 예문을 같이 넣는다.

## 7. 갱신 절차

1. 사전 JSON을 고친다(`status: draft`로 시작, 근거 확인 뒤 `confirmed`).
2. `validation/*.csv`에 예문을 더한다.
3. 단위 테스트와 `run_lexicon.py`를 돌려 기준을 확인한다 — 위기 놓침 0, 태그별 정답률 80% 이상, 근거 없는 확정 항목 0.
4. `crisis.json`을 바꿨으면 **DB 임시 위기 검사(`_haru_crisis`, `database/06_haru.sql`)와 어긋난다** — 채점기 ⑤에 나온다. DB용 SQL 생성기는 사전이 채워진 뒤 만든다(10/8). 그때 SQL이 바뀌면 팀 DB에 다시 적용해야 한다.
5. `docs/project_management/구현_현황표.md`를 같이 고친다.

## 8. 한계 (v1)

- 패턴 매칭만 한다. 문맥(앞 질문에 대한 대답인지), 부정, 반어는 LLM 단계(T·`ambiguous` 확인·`idiom_flag`)에서 보완한다.
- 그래서 루미 **대본 선택지의 태그 일부는 매처로 재현되지 않는다** — 예: "요즘은 아예 아무것도 하기 싫어"는 대본에서 문맥상 구직단념+사회적회피(0.7)지만 문장만 보면 무기력(0.4). 대본 점수는 사람이 정한다(매핑표 3-5, 미결).
- T가 없을 때(LLM 실패·대본) 0으로 계산한다 — 대본 점수를 LLM 점수와 같은 척도로 맞추는 방법은 미결(매핑표 3-5).
