/*
 * NPC 시스템 프롬프트 조립 — ① 공통 규칙 → ② 역할 규칙 → ③ 페르소나 순서
 *
 * 페르소나가 바뀌어도 ①②는 그대로다. 페르소나는 말투·성격만 바꾸고,
 * 위기 문구·AI 고지·개인정보 규칙·판정 기준은 ①이 정한다(①이 항상 우선).
 *
 * 파일 읽기는 호출하는 쪽이 한다(Edge Function은 Deno.readTextFile, 테스트는 node:fs).
 */

export const NPC_CODES = ['psych', 'policy', 'job', 'civil', 'coco', 'chief'];

// 서버가 붙이는 고정 문구 — 페르소나로 바꾸지 않는다(common.md 4절).
// 말높이(반말/존댓말)만 NPC 페르소나의 '반말 / 존댓말' 칸을 따른다. 내용·전화번호는 같다.
export const FIXED_LINES = {
  banmal: {
    crisis: '지금 많이 힘든 것 같아. 혼자 견디지 않아도 돼.\n'
      + '지금 바로 이야기할 수 있는 곳이 있어: 📞 109 (자살예방상담, 24시간) · 📞 1577-0199 (정신건강 위기상담)\n'
      + '위급하면 112나 119에 바로 연락해.',
    suggest: '요즘 많이 지쳤구나. 이런 얘기를 더 잘 들어줄 수 있는 곳이 있는데, 궁금하면 알려줄까?',
    fallback: '조금 더 얘기해 줄래?'
  },
  jondaet: {
    crisis: '지금 많이 힘드신 것 같아요. 혼자 견디지 않으셔도 돼요.\n'
      + '지금 바로 이야기할 수 있는 곳이 있어요: 📞 109 (자살예방상담, 24시간) · 📞 1577-0199 (정신건강 위기상담)\n'
      + '위급하면 112나 119에 바로 연락하세요.',
    suggest: '요즘 많이 지치셨군요. 이런 이야기를 더 잘 들어줄 수 있는 곳이 있는데, 알려 드릴까요?',
    fallback: '조금 더 이야기해 주시겠어요?'
  }
};

const SEP = '\n\n---\n\n';

export function assemblePrompt({ common, role, persona }) {
  if (!common || !role) throw new Error('assemblePrompt: common과 role은 꼭 있어야 합니다');
  const parts = [common.trim(), role.trim()];
  if (persona && persona.trim()) parts.push(persona.trim());
  parts.push('[우선순위] 페르소나(③)가 공통 규칙(①)과 부딪히면 공통 규칙(①)을 따른다. 판정 칸은 페르소나와 상관없이 정한다.');
  return parts.join(SEP);
}

/**
 * LLM 응답(JSON 문자열)을 검사해 안전한 값만 돌려준다. 형식이 틀리면 null → 호출하는 쪽이 fallback 문구 사용.
 */
export function parseNpcOutput(text, allowedTags) {
  let o;
  try { o = JSON.parse(text); } catch (e) { return null; }
  if (!o || typeof o.reply !== 'string' || !o.reply.trim()) return null;
  const tags = Array.isArray(o.tags) ? o.tags.filter((t) => allowedTags.includes(t)) : [];
  const tone = Number(o.tone_score);
  return {
    reply: o.reply.trim().slice(0, 600),
    tags: [...new Set(tags)],
    tone_score: Number.isFinite(tone) ? Math.max(0, Math.min(1, tone)) : 0,
    idiom_flag: o.idiom_flag === true,
    crisis_suspect: o.crisis_suspect === true
  };
}

/**
 * 서버가 최종 답장을 만든다 — 위기·제안 문구는 고정 문구를 붙인다(LLM이 쓰지 않음)
 * register: 'banmal'(루미·코코) | 'jondaet'(하루·이장 등) — 페르소나 말높이
 */
export function finalReply(reply, band, register = 'banmal') {
  const L = FIXED_LINES[register] || FIXED_LINES.banmal;
  if (band === 'crisis') return (reply ? reply + '\n\n' : '') + L.crisis;
  if (band === 'suggest') return (reply ? reply + '\n\n' : '') + L.suggest;
  return reply || L.fallback;
}
