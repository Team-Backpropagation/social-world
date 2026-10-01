# NPC 공통 — 시스템 프롬프트 3층 + 심각도 계산

자유 입력(LLM)을 쓰는 NPC가 공통으로 쓰는 부품이다. 지금은 루미(psych)용으로 만들었고, 페르소나가 정해지면 ③층만 갈아 끼운다.
설계: `docs/planning/소셜월드_게임흐름_NPC_설계.md` 8-2·8-3·9절, `docs/planning/위험사전_근거_매핑표.md` 2·3절.

> **아직 사용자에게 열지 않는다.** 위기 표현 사전(담당 A)과 서버(Edge Function `npc-chat`)가 붙기 전까지는 부품만 있다.

## 1. 파일

| 파일 | 하는 일 |
|---|---|
| `prompts/common.md` | **① 공통 규칙** — 모든 NPC. AI 고지, 진단·약 금지, 개인정보, 의존 방지, 위기 처리, **판정 기준**, 출력 JSON |
| `prompts/roles/psych.md` | **② 역할 규칙** — 루미. 하는 일·안 하는 일·판정 예시 |
| `prompts/personas/_template.md` | **③ 페르소나 템플릿** — 팀원이 NPC 페르소나를 쓸 때 채우는 양식 |
| `prompts/personas/lumi.md` | ③ 루미 페르소나 **임시본**(지금 데모 말투) |
| `prompt.js` | 조립 `assemblePrompt()`, LLM 출력 검사 `parseNpcOutput()`, 고정 문구 붙이기 `finalReply()` |
| `severity.js` | 심각도 계산 `computeSeverity()`, 키워드 점수 `keywordScore()`, 세션 요약 `sessionSummary()` |
| `severity_config.json` | 가중치·구간·태그별 기본 심각도 (**draft** — 킥오프 확정 전) |
| `tests/npc_common.test.mjs` | 20항목 (`node --test tests/npc_common.test.mjs` 또는 `npm test`) |

`severity.js`·`prompt.js`는 순수 ES 모듈이라 브라우저·Deno(Edge Function)·Node 어디서나 쓴다. 원문을 저장하지 않는다.

## 2. 프롬프트 3층

```
① common.md          모든 NPC 공통      → 페르소나가 바뀌어도 그대로
② roles/<코드>.md    NPC 역할           → 그대로
③ personas/<이름>.md 말투·성격          → 이 층만 교체
[우선순위] 페르소나(③)가 ①과 부딪히면 ①을 따른다. 판정은 페르소나와 상관없이 한다.
```

- **위기·연결 제안 문구는 LLM이 쓰지 않는다.** 서버가 `finalReply()`로 고정 문구를 붙인다. 페르소나가 바꿀 수 있는 건 말높이(반말/존댓말)뿐이다.
- 판정 칸(`tags`, `tone_score`, `idiom_flag`, `crisis_suspect`)의 기준은 ①에 있다 — 페르소나가 판정을 흔들지 않게.

## 3. 심각도 (설계 문서 8-3)

```
K  = 태그 기본 심각도 최댓값 + 추가 태그당 0.05 (일시적 표현만 있으면 −0.1, 관용 표현이면 ×0.5)
T  = LLM tone_score (0~1)
severity = min(1, 0.5·K + 0.5·T + 지속성)      같은 태그 3회째부터 +0.1
위기(사전 hit 또는 LLM crisis_suspect) → 1.0
band: < 0.5 normal(일반 대화) / 0.5~0.8 suggest(연결 제안) / ≥ 0.8 crisis(109 안내 + report_crisis)
```

태그는 위험 키워드 사전이 나오면 사전에서, 그 전에는 LLM `tags`에서 받는다(`source`로 구분).
세션이 끝나면 `sessionSummary()` 결과(`keyword_tags`, `risk_keyword_count`, `severity_score`)만 `npc_sessions`에 저장한다 — 위험 탐지 에이전트는 수정할 필요 없다.

## 4. 페르소나를 바꿀 때 (판정 일관성 테스트)

페르소나가 판정에 영향을 주면 안 된다. 모델이 정해지면 아래를 만든다(지금은 LLM이 없어 설계만).

1. 검증 발화 50개 이상(태그별 양성·관용 음성·평범한 대화) — `validation/` 예문과 같이 씀
2. 같은 발화를 **임시 페르소나 / 새 페르소나** 두 프롬프트로 판정
3. 기준: `tags` 일치율 95% 이상, `tone_score` 차이 평균 0.1 이하, `crisis_suspect` **100% 일치**
4. 통과 못 하면 페르소나 문구를 고친다(① 판정 기준은 고치지 않는다)

## 5. 남은 일

- [ ] 위험 키워드 사전·위기 표현 사전 연결(K를 사전에서, crisis를 사전 선검사에서)
- [ ] Edge Function `npc-chat` — 모델·API 키 관리 주체 결정 후
- [ ] 하루·코코·이장 역할 파일(`roles/policy.md` 등) — 자유 입력을 열 NPC만
- [ ] 판정 일관성 테스트 스크립트(4절)
- [ ] `severity_config.json` 확정(킥오프)
