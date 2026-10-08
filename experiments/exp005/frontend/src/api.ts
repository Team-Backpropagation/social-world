/** 브라우저의 네트워크 경계. 키·전체 대화 이력·추정 상태는 전송하지 않습니다. */
export type Npc = 'lumi' | 'coco' | 'haru';
export type Action = 'chat' | 'begin_intake' | 'skip' | 'decline' | 'choose_activity' | 'choose_resource' | 'edit_preference';
export type Topic = { status: 'unknown' | 'answered' | 'skipped' | 'declined'; value: string | null; evidence_ref: string | null };
export type State = { revision: number; preference: Topic; conditions: Topic; pending_question: 'preference' | 'conditions' | null; intake_enabled: boolean };
export type Session = { session_token: string; mode: 'demo' | 'live'; expires_in_seconds: number; state: State };
export type Turn = { request_id: string; expected_revision: number; content: string; npc: Npc; action: Action };
export type Reply = {
  request_id: string; mode: 'demo' | 'live'; npc: Npc;
  role: 'companion' | 'activity' | 'resource' | 'safety';
  status: 'ok' | 'clarify' | 'urgent_support' | 'unavailable';
  reply: string; question: string | null;
  cards: { title: string; description: string; kind: string }[]; state: State;
};

const errors: Record<string, string> = {
  session_expired: '대화가 만료되었어요. 종료 후 새 대화를 시작해 주세요.',
  external_consent_required: '실제 모델 모드는 외부 전송 동의가 필요해요.',
  live_unavailable: '실제 모델 설정이 준비되지 않았어요.',
  revision_conflict: '대화 순서가 달라졌어요. 새 대화를 시작해 주세요.',
  request_id_reused: '재시도할 메시지 정보가 달라졌어요. 새 대화를 시작해 주세요.',
  turn_limit: '이 대화의 처리 한도에 도달했어요. 새 대화를 시작해 주세요.',
};

async function call(path: string, init: RequestInit = {}, token?: string): Promise<unknown> {
  const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (response.status === 204) return null;
  let data;
  try { data = await response.json(); }
  catch { throw new Error('서버 응답을 읽지 못했어요. 같은 메시지를 재시도하거나 연결을 확인해 주세요.'); }
  if (!response.ok) throw new Error(errors[data?.code] || '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
  return data;
}

export const health = async () => await call('/api/health') as { mode: 'demo' | 'live'; live_available: boolean };
export const start = async (external: boolean) => await call('/api/sessions', { method: 'POST', body: JSON.stringify({ processing_consent: true, external_model_consent: external }) }) as Session;
export const end = async (token: string) => { await call('/api/sessions', { method: 'DELETE' }, token); };

function validTopic(topic: Topic): boolean {
  return !!topic && ['unknown', 'answered', 'skipped', 'declined'].includes(topic.status) &&
    (topic.value === null || typeof topic.value === 'string') &&
    (topic.evidence_ref === null || typeof topic.evidence_ref === 'string');
}

export async function chat(token: string, turn: Turn, signal: AbortSignal): Promise<Reply> {
  const data = await call('/api/chat', { method: 'POST', body: JSON.stringify(turn), signal }, token) as Reply;
  // TypeScript 타입은 런타임 검증이 아닙니다. 화면 출력 전에 최소 계약을 확인합니다.
  if (!data || data.request_id !== turn.request_id || typeof data.reply !== 'string' ||
      !data.state || !Number.isInteger(data.state.revision) || data.state.revision !== turn.expected_revision + 1 ||
      !validTopic(data.state.preference) || !validTopic(data.state.conditions) ||
      ![null, 'preference', 'conditions'].includes(data.state.pending_question) || typeof data.state.intake_enabled !== 'boolean' ||
      !Array.isArray(data.cards) || data.cards.length > 3 || !data.cards.every(card => card && typeof card.title === 'string' && typeof card.description === 'string' && ['informal_activity', 'unavailable_resource'].includes(card.kind)) ||
      !(data.question === null || typeof data.question === 'string') || data.npc !== turn.npc ||
      !['demo', 'live'].includes(data.mode) || !['companion', 'activity', 'resource', 'safety'].includes(data.role) ||
      !['ok', 'clarify', 'urgent_support', 'unavailable'].includes(data.status)) {
    throw new Error('응답 형식을 확인하지 못했어요. 같은 메시지로 다시 시도할 수 있어요.');
  }
  return data;
}
