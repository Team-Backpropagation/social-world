// NPC 공통(프롬프트 조립·심각도 계산) 테스트 — LLM·DB 없이 돈다
// 실행: node --test social_world/common/npc/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DEFAULT_CONFIG, TAGS, keywordScore, persistenceBonus, addToHistory, bandOf, computeSeverity, sessionSummary } from '../severity.js';
import { assemblePrompt, parseNpcOutput, finalReply, FIXED_LINES } from '../prompt.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const NPC = join(HERE, '..');
const read = (p) => readFileSync(join(NPC, p), 'utf-8');

// ---------------- 설정 ----------------
test('severity_config.json과 코드 기본값이 같다', () => {
  const cfg = JSON.parse(read('severity_config.json'));
  for (const k of ['weights', 'bands', 'persistence', 'keyword', 'base_severity']) {
    assert.deepEqual(cfg[k], DEFAULT_CONFIG[k], k);
  }
});

test('태그 9종 — common.md 판정 목록과 같다(위기발화는 위기 사전 몫)', () => {
  const common = read('prompts/common.md');
  for (const t of TAGS) assert.ok(common.includes('`' + t + '`'), t);
  assert.equal(TAGS.length, 9);
  assert.ok(!TAGS.includes('위기발화'));
});

// ---------------- K ----------------
test('K: 최댓값 + 추가 태그 가산 (매핑표 3절 비교표와 같음)', () => {
  assert.equal(keywordScore([]), 0);
  assert.equal(keywordScore(['무기력']), 0.4);
  assert.equal(keywordScore(['생계부담']), 0.3);
  assert.equal(keywordScore(['대화상대없음', '소외감']), 0.55);
  assert.equal(keywordScore(['장기구직', '무기력']), 0.45);
  assert.equal(keywordScore(['구직단념', '사회적회피']), 0.65);
  assert.equal(keywordScore(['고립지속', '장기고립']), 0.85);
});

test('K: 모르는 태그·중복은 무시, 완화·관용 보정', () => {
  assert.equal(keywordScore(['없는태그']), 0);
  assert.equal(keywordScore(['무기력', '무기력']), 0.4);
  assert.equal(keywordScore(['무기력'], { mitigated: true }), 0.3);
  assert.equal(keywordScore(['장기고립'], { idiom: true }), 0.4);
  assert.ok(keywordScore(TAGS) <= 1);
});

// ---------------- 지속성·구간 ----------------
test('지속성: 같은 태그 3회째부터 +0.1', () => {
  let h = {};
  h = addToHistory(h, ['무기력']); assert.equal(persistenceBonus(h), 0);
  h = addToHistory(h, ['무기력', '무기력']); assert.equal(h['무기력'], 2);   // 한 발화 안 중복은 1회
  h = addToHistory(h, ['무기력']); assert.equal(persistenceBonus(h), 0.1);
});

test('구간: <0.5 normal / 0.5~0.8 suggest / ≥0.8 crisis', () => {
  assert.equal(bandOf(0.49), 'normal');
  assert.equal(bandOf(0.5), 'suggest');
  assert.equal(bandOf(0.79), 'suggest');
  assert.equal(bandOf(0.8), 'crisis');
});

// ---------------- 발화 심각도 ----------------
test('평범한 대화 → normal', () => {
  const r = computeSeverity({ tags: [], tone: 0.1 });
  assert.equal(r.severity, 0.05); assert.equal(r.band, 'normal');
});

test('대화상대없음 + 지친 톤 → suggest', () => {
  const r = computeSeverity({ tags: ['대화상대없음'], tone: 0.6 });   // 0.25 + 0.3
  assert.equal(r.severity, 0.55); assert.equal(r.band, 'suggest');
});

test('장기고립 + 깊은 절망 → crisis(계산으로)', () => {
  const r = computeSeverity({ tags: ['고립지속', '장기고립'], tone: 0.8 });   // 0.425 + 0.4
  assert.equal(r.band, 'crisis');
});

test('위기(사전 hit 또는 LLM crisis_suspect) → 1.0, 계산 생략', () => {
  const r = computeSeverity({ tags: [], tone: 0, crisis: true });
  assert.equal(r.severity, 1); assert.equal(r.band, 'crisis'); assert.equal(r.K, null);
});

test('관용 표현은 K를 반으로 — "배고파 죽겠다"가 suggest로 가지 않음', () => {
  const r = computeSeverity({ tags: ['무기력'], tone: 0.1, idiom: true });
  assert.equal(r.band, 'normal');
});

test('지속성 가산은 태그가 있을 때만, 세션 기록이 쌓임', () => {
  let history = {};
  const out = [];
  for (let i = 0; i < 3; i++) {
    const r = computeSeverity({ tags: ['무기력'], tone: 0.3, history });
    history = r.history; out.push(r);
  }
  assert.deepEqual(out.map((r) => r.bonus), [0, 0, 0.1]);
  assert.equal(computeSeverity({ tags: [], tone: 0.3, history }).bonus, 0);
});

test('톤·태그 이상값은 0~1로 자름', () => {
  const r = computeSeverity({ tags: ['장기고립'], tone: 9 });
  assert.ok(r.severity <= 1 && r.T === 1);
  assert.equal(computeSeverity({ tags: [], tone: NaN }).T, 0);
});

test('세션 요약 → npc_sessions 칸(원문 없음)', () => {
  let history = {};
  const rs = [];
  for (const [tags, tone] of [[['무기력'], 0.3], [['대화상대없음'], 0.6], [[], 0.1]]) {
    const r = computeSeverity({ tags, tone, history }); history = r.history; rs.push(r);
  }
  const s = sessionSummary(rs);
  assert.deepEqual(s.keyword_tags.sort(), ['대화상대없음', '무기력'].sort());
  assert.equal(s.risk_keyword_count, 2);
  assert.equal(s.severity_score, 0.55);
  assert.deepEqual(Object.keys(s).sort(), ['keyword_tags', 'risk_keyword_count', 'severity_score']);
});

// ---------------- 프롬프트 ----------------
const common = read('prompts/common.md');
const role = read('prompts/roles/psych.md');
const lumi = read('prompts/personas/lumi.md');

test('조립 순서: ① 공통 → ② 역할 → ③ 페르소나 → 우선순위 문장', () => {
  const p = assemblePrompt({ common, role, persona: lumi });
  const i1 = p.indexOf('① 공통 규칙'), i2 = p.indexOf('② 역할 규칙'), i3 = p.indexOf('③ 페르소나');
  assert.ok(i1 >= 0 && i1 < i2 && i2 < i3);
  assert.ok(p.trim().endsWith('판정 칸은 페르소나와 상관없이 정한다.'));
});

test('페르소나 없이도 조립됨(①②만), ①② 없으면 오류', () => {
  assert.ok(!assemblePrompt({ common, role }).includes('③ 페르소나'));
  assert.throws(() => assemblePrompt({ common: '', role }));
});

test('페르소나를 바꿔도 ①② 부분은 한 글자도 안 바뀜', () => {
  const other = '# ③ 페르소나 — 테스트용\n존댓말, 아주 밝은 말투';
  const a = assemblePrompt({ common, role, persona: lumi });
  const b = assemblePrompt({ common, role, persona: other });
  const head = (p) => p.slice(0, p.indexOf('③ 페르소나'));
  assert.equal(head(a), head(b));
});

test('페르소나 파일에 위기 전화번호·금칙어가 없다(문구는 서버 고정)', () => {
  const banned = ['109', '1577', '위험', '고립', '외로운', '우울', '20대', '30대', '남성', '여성'];
  const dir = join(NPC, 'prompts/personas');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('_'))) {
    const body = readFileSync(join(dir, f), 'utf-8');
    for (const w of banned) assert.ok(!body.includes(w), `${f}: ${w}`);
  }
});

test('LLM 출력 검사: 형식 오류 → null, 모르는 태그 제거, 범위 자름', () => {
  assert.equal(parseNpcOutput('그냥 글', TAGS), null);
  assert.equal(parseNpcOutput('{"reply": ""}', TAGS), null);
  const o = parseNpcOutput('{"reply":" 안녕 ","tags":["무기력","해킹","무기력"],"tone_score":3,"idiom_flag":"yes","crisis_suspect":true}', TAGS);
  assert.deepEqual(o, { reply: '안녕', tags: ['무기력'], tone_score: 1, idiom_flag: false, crisis_suspect: true });
});

test('최종 답장: 위기·제안 문구는 고정 문구, 말높이만 바뀜', () => {
  const c = finalReply('그랬구나.', 'crisis');
  assert.ok(c.startsWith('그랬구나.') && c.includes('109') && c.includes('1577-0199'));
  assert.ok(finalReply('', 'crisis', 'jondaet').includes('109'));
  assert.equal(finalReply('', 'normal'), FIXED_LINES.banmal.fallback);
  assert.ok(finalReply('응', 'suggest', 'jondaet').endsWith(FIXED_LINES.jondaet.suggest));
  for (const r of ['banmal', 'jondaet']) assert.ok(FIXED_LINES[r].crisis.includes('📞 109') && FIXED_LINES[r].crisis.includes('📞 1577-0199'));
});
