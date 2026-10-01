/*
 * 루미 심각도 계산 — 설계 문서 8-3절
 *
 *   severity = min(1, w_k·K + w_t·T + 지속성 가산)      위기 → 1.0 (계산 생략)
 *   band     = normal (< 0.5) / suggest (0.5 ~ 0.8) / crisis (≥ 0.8 또는 위기)
 *
 * K(키워드 점수)는 태그 목록에서 계산한다. 태그는 위험 키워드 사전(담당 B)이 원문에서 뽑고,
 * 사전이 나오기 전에는 LLM이 판정한 tags로 대신한다(source 값으로 구분해 남긴다).
 * T(톤 점수)는 LLM 판정. 페르소나와 무관하게 사용자 발화만 보고 정한다(common.md 5절).
 *
 * 순수 함수만 있다 — 원문을 받지도 저장하지도 않는다. 브라우저·Deno(Edge Function)·Node 어디서나 쓴다.
 * 설정값은 severity_config.json (킥오프에서 확정하는 잠정값).
 */

export const DEFAULT_CONFIG = {
  weights: { keyword: 0.5, tone: 0.5 },
  bands: { suggest: 0.5, crisis: 0.8 },
  persistence: { repeat_count: 3, bonus: 0.1 },
  keyword: { extra_tag_bonus: 0.05, mitigation_penalty: 0.1, idiom_factor: 0.5 },
  base_severity: {
    '무기력': 0.4, '소외감': 0.4, '대화상대없음': 0.5, '장기구직': 0.4, '구직단념': 0.6,
    '사회적회피': 0.5, '생계부담': 0.3, '고립지속': 0.6, '장기고립': 0.8
  }
};

export const TAGS = Object.keys(DEFAULT_CONFIG.base_severity);

const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const round2 = (x) => Math.round(x * 100) / 100;

/**
 * 태그 → 키워드 점수 K (위험사전_근거_매핑표.md 3절)
 * - 걸린 태그의 기본 심각도 중 최댓값
 * - 서로 다른 태그가 더 있으면 하나당 +extra_tag_bonus
 * - 일시적 표현만 있으면(mitigated) −mitigation_penalty
 * - 관용·과장 표현이면(idiom) ×idiom_factor
 * 모르는 태그는 무시한다.
 */
export function keywordScore(tags, { mitigated = false, idiom = false } = {}, config = DEFAULT_CONFIG) {
  const base = config.base_severity;
  const known = [...new Set((tags || []).filter((t) => Object.prototype.hasOwnProperty.call(base, t)))];
  if (!known.length) return 0;
  let k = Math.max(...known.map((t) => base[t]));
  k += config.keyword.extra_tag_bonus * (known.length - 1);
  if (mitigated) k -= config.keyword.mitigation_penalty;
  if (idiom) k *= config.keyword.idiom_factor;
  return round2(clamp01(k));
}

/**
 * 같은 세션에서 같은 태그가 repeat_count번 이상 나오면 지속성 가산.
 * history: 이번 발화까지 포함한 세션 내 태그 등장 횟수 {태그: 횟수}
 */
export function persistenceBonus(history, config = DEFAULT_CONFIG) {
  const n = config.persistence.repeat_count;
  return Object.values(history || {}).some((c) => c >= n) ? config.persistence.bonus : 0;
}

/** 세션 태그 횟수에 이번 발화 태그를 더한 새 객체(원본 불변) */
export function addToHistory(history, tags) {
  const out = { ...(history || {}) };
  for (const t of new Set(tags || [])) if (TAGS.includes(t)) out[t] = (out[t] || 0) + 1;
  return out;
}

export function bandOf(severity, config = DEFAULT_CONFIG) {
  if (severity >= config.bands.crisis) return 'crisis';
  if (severity >= config.bands.suggest) return 'suggest';
  return 'normal';
}

/**
 * 발화 하나의 심각도.
 * input = {
 *   tags: [...],              사전(또는 LLM) 태그
 *   tone: 0~1,                LLM tone_score
 *   idiom: bool,              LLM idiom_flag
 *   mitigated: bool,          사전이 찾은 일시적 표현만 있는 경우
 *   crisis: bool,             위기 사전 hit 또는 LLM crisis_suspect
 *   history: {태그: 횟수},    이번 발화 전까지의 세션 기록
 *   source: 'lexicon' | 'llm' 태그 출처(기록용)
 * }
 * 반환: { severity, band, K, T, bonus, history, source }
 */
export function computeSeverity(input, config = DEFAULT_CONFIG) {
  const tags = input.tags || [];
  const history = addToHistory(input.history, tags);
  const source = input.source || 'llm';
  if (input.crisis) {
    return { severity: 1, band: 'crisis', K: null, T: null, bonus: 0, history, source };
  }
  const K = keywordScore(tags, { mitigated: !!input.mitigated, idiom: !!input.idiom }, config);
  const T = round2(clamp01(input.tone));
  const bonus = tags.length ? persistenceBonus(history, config) : 0;
  const severity = round2(clamp01(config.weights.keyword * K + config.weights.tone * T + bonus));
  return { severity, band: bandOf(severity, config), K, T, bonus, history, source };
}

/** 세션 전체 요약 → npc_sessions에 남길 값(원문 없음). 세션 심각도 = 발화 심각도의 최댓값 */
export function sessionSummary(results) {
  const tags = new Set();
  let max = 0;
  for (const r of results || []) {
    Object.keys(r.history || {}).forEach((t) => tags.add(t));
    max = Math.max(max, r.severity || 0);
  }
  return { keyword_tags: [...tags], risk_keyword_count: tags.size, severity_score: round2(max) };
}
