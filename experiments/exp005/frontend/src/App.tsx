import { useEffect, useRef, useState } from 'react';
import { chat, end, health, start, type Action, type Npc, type Reply, type Session, type Turn } from './api';

const people = {
  lumi: { name: '루미', mark: '◒', title: '차분하게, 당신의 속도로', intro: '오늘 나누고 싶은 이야기부터 시작해요.' },
  coco: { name: '코코', mark: '✳', title: '가벼운 선택 하나부터', intro: '부담이 적은 작은 활동을 같이 살펴봐요.' },
  haru: { name: '하루', mark: '◇', title: '필요한 도움을 알아가요', intro: '궁금한 정보와 확인할 내용을 정리해요.' },
};
type Message = { id: string; side: 'user' | 'assistant'; text: string; npc: Npc; response?: Reply };
const statusNames = { unknown: '아직 묻지 않음', answered: '직접 답한 내용', skipped: '건너뛰었어요', declined: '답하지 않기로 했어요' };

export default function App() {
  const [npc, setNpc] = useState<Npc>('lumi');
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [consent, setConsent] = useState(false);
  const [external, setExternal] = useState(false);
  const [mode, setMode] = useState<'demo' | 'live'>('demo');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState<Turn | null>(null);
  const [ending, setEnding] = useState(false);
  const controller = useRef<AbortController | null>(null);
  // 대화 종료 뒤 도착한 응답을 버리는 세대 번호입니다. 서버의 삭제 검사와 함께 사용합니다.
  const epoch = useRef(0);
  const listEnd = useRef<HTMLDivElement | null>(null);
  const person = people[npc];

  useEffect(() => {
    let active = true;
    health().then(data => { if (active) { setMode(data.mode); setReady(true); } })
      .catch(() => { if (active) setError('서버에 연결되지 않았어요. 실행 안내의 백엔드를 먼저 시작해 주세요.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    // 대화 영역 안에서만 스크롤합니다. 페이지 전체가 움직여 제목·동의 안내가 잘리지 않게 합니다.
    const list = listEnd.current?.parentElement;
    list?.scrollTo({ top: list.scrollHeight });
  }, [messages, busy]);

  async function begin() {
    if (!consent || !ready || busy) return;
    setBusy(true); setError('');
    try {
      const next = await start(external);
      epoch.current += 1;
      setSession(next); setMessages([{ id: 'welcome', side: 'assistant', npc,
        text: `${person.intro} 질문에 답하지 않아도 괜찮아요. 원하면 ‘편한 도움 고르기’를 눌러주세요.` }]);
    } catch (e) { setError(e instanceof Error ? e.message : '대화를 시작하지 못했어요.'); }
    finally { setBusy(false); }
  }

  async function send(text: string, action: Action = 'chat', previous?: Turn) {
    if (!session || busy || ending || (!previous && retry) || !text.trim()) return;
    const turn = previous || { request_id: crypto.randomUUID(), expected_revision: session.state.revision, content: text.trim(), npc, action };
    const generation = epoch.current;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setRetry(turn);
    if (!previous) {
      setInput('');
      setMessages(items => [...items, { id: turn.request_id, side: 'user', npc: turn.npc, text: turn.content }]);
    }
    try {
      const response = await chat(session.session_token, turn, abort.signal);
      if (generation !== epoch.current || abort.signal.aborted) return;
      setSession(current => current ? { ...current, state: response.state } : null);
      setMessages(items => [...items, { id: `${turn.request_id}-reply`, side: 'assistant', npc: response.npc,
        text: response.reply, response }]);
      setRetry(null);
    } catch (e) {
      if (generation !== epoch.current) return;
      setError(abort.signal.aborted ? '화면에서 기다리기를 멈췄어요. 서버는 이미 처리했을 수 있어요. 같은 메시지를 재시도하면 중복 없이 결과를 확인해요.' : e instanceof Error ? e.message : '연결을 확인해 주세요.');
    } finally {
      // 이전 요청의 finally가 새 대화의 전송 상태를 해제하지 않게 합니다.
      if (generation === epoch.current) { setBusy(false); controller.current = null; }
    }
  }

  async function finish() {
    if (!session || ending) return;
    setEnding(true); setError('');
    controller.current?.abort();
    epoch.current += 1; setBusy(false);
    try {
      await end(session.session_token);
      setSession(null); setMessages([]); setRetry(null); setInput(''); setConsent(false); setExternal(false);
    } catch {
      // 삭제 요청 실패 시 삭제됐다고 표시하지 않습니다. 재시도하거나 만료를 기다릴 수 있습니다.
      setError(`서버 삭제를 확인하지 못했어요. ‘대화 종료·삭제’를 다시 눌러주세요. 세션은 생성 후 ${Math.ceil(session.expires_in_seconds / 60)}분에 만료돼요.`);
    } finally { setEnding(false); }
  }

  const disabled = busy || ending || !!retry;
  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="#"><span className="brand-icon">이</span><span>이음<small>작은 연결의 시작</small></span></a>
      <div className="section-label">함께 이야기할 친구</div>
      <nav aria-label="대화 캐릭터">
        {(Object.keys(people) as Npc[]).map(id => <button key={id} aria-label={`${people[id].name}와 대화`} aria-pressed={npc === id} className={`person-tab ${npc === id ? 'selected' : ''}`} disabled={busy || ending} onClick={() => setNpc(id)}>
          <span className={`avatar ${id}`}>{people[id].mark}</span><span>{people[id].name}<small>{id === 'lumi' ? '이야기와 필요 확인' : id === 'coco' ? '작은 활동' : '정보와 도움'}</small></span>
          {npc === id && <span className="selected-dot" />}
        </button>)}
      </nav>
      <div className="sidebar-note"><span>✧</span><p>말하지 않아도 괜찮아요.<br />대화의 속도는 당신이 정해요.</p></div>
      <footer>EXP-005 · 개인 시제품<br />팀 공식 구현으로 채택되지 않았어요.</footer>
    </aside>

    <main>
      <header className="topbar"><span>오늘의 작은 대화</span><span className="mode-badge">{mode === 'demo' ? '고정 응답 시연' : '실제 모델 모드'}</span></header>
      <div className="content-grid">
        <section className="conversation" aria-label="대화">
          <div className="conversation-heading"><span className={`avatar large ${npc}`}>{person.mark}</span><div><div className="eyebrow">{person.name}와 함께</div><h1>{person.title}</h1><p>{person.intro}</p></div></div>
          {!session ? <div className="welcome-panel">
            <div className="welcome-symbol">✧</div><h2>편한 만큼만 나눠주세요.</h2>
            <p>진단이나 치료를 제공하는 서비스가 아닌, 대화와 도움 찾기 흐름을 확인하는 개인 시제품이에요.</p>
            <div className="privacy-note">입력은 즉시 처리하며, 대표 연락처를 가린 최근 발화와 선택 항목을 서버 메모리에 잠시 보관해요. 기본 세션은 30분 후 만료돼요. 새로고침하면 화면 대화는 복구되지 않아요. 이름·상세 주소·실제 민감정보 대신 가상 사례로 이용해 주세요.</div>
            {mode === 'demo' && <div className="demo-note">현재는 외부 모델 호출 없이 정해진 응답과 초안 Safety 규칙으로 작동해요.</div>}
            <label className="check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />이 범위의 즉시 처리와 임시 세션 보관에 동의해요.</label>
            {mode === 'live' && <label className="check"><input type="checkbox" checked={external} onChange={e => setExternal(e.target.checked)} />마스킹된 현재·최근 발화를 OpenAI API로 전송하는 데 동의해요. 마스킹이 모든 개인정보를 제거하지는 못해요.</label>}
            <button className="primary" disabled={!consent || !ready || busy || (mode === 'live' && !external)} onClick={begin}>{busy ? '준비 중…' : '대화 시작하기 →'}</button>
          </div> : <>
            <div className="messages" aria-live="polite" aria-relevant="additions">
              {messages.map(message => <article key={message.id} className={`message ${message.side}`}>
                {message.side === 'assistant' && <span className={`avatar small ${message.npc}`}>{people[message.npc].mark}</span>}
                <div className="message-body">
                  <span className="message-author">{message.side === 'user' ? '나' : people[message.npc].name}</span>
                  <div className={`bubble ${message.response?.status === 'urgent_support' ? 'support' : ''}`}><p>{message.text}</p>
                    {message.response?.question && <p className="question">{message.response.question}</p>}
                    {message.response?.cards.map((card, i) => <div className="suggestion" key={i}><span>{card.kind === 'informal_activity' ? '선택 가능한 작은 행동' : '정보 연결 상태'}</span><strong>{card.title}</strong><p>{card.description}</p></div>)}
                  </div>
                </div>
              </article>)}
              {busy && <div className="thinking"><span />내용과 응답을 확인하고 있어요…</div>}
              <div ref={listEnd} />
            </div>
            <div className="composer-area">
              <div className="quick-actions"><button disabled={disabled} onClick={() => send('편한 도움을 고르고 싶어요', 'begin_intake')}>편한 도움 고르기</button><button disabled={disabled} onClick={() => send('작은 활동을 보고 싶어요', 'choose_activity')}>작은 활동</button><button disabled={disabled} onClick={() => send('도움 정보를 찾고 싶어요', 'choose_resource')}>도움 정보</button></div>
              {session.state.pending_question && <div className="question-actions"><span>답변은 선택이에요</span><button disabled={disabled} onClick={() => send('이 질문은 건너뛸게요', 'skip')}>건너뛰기</button><button disabled={disabled} onClick={() => send('사전조사를 그만할게요', 'decline')}>질문 그만하기</button></div>}
              <form className="composer" onSubmit={e => { e.preventDefault(); void send(input); }}><textarea aria-label="메시지" placeholder="지금 나누고 싶은 이야기를 적어주세요…" maxLength={1200} value={input} disabled={disabled} onChange={e => setInput(e.target.value)} onKeyDown={e => {
                // 한글 조합 중 Enter가 전송으로 처리되는 문제를 막습니다. Shift+Enter는 줄바꿈입니다.
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); }
              }} /><button type="submit" className="send" aria-label="메시지 보내기" disabled={disabled || !input.trim()}>↑</button></form>
              <div className="composer-caption"><span>{input.length}/1200 · 질문에 답하지 않아도 괜찮아요</span>{busy && <button onClick={() => controller.current?.abort()}>기다리기 중지</button>}</div>
            </div>
          </>}
          {error && <div role="alert" className="error">{error}{retry && !busy && <button onClick={() => send(retry.content, retry.action, retry)}>같은 메시지 재시도</button>}</div>}
        </section>

        <aside className="detail-panel" aria-label="대화 선택 내용">
          <div className="detail-card"><span className="section-label">이 대화에서 선택한 내용</span><h2>당신이 말한 것만</h2><p>마음이나 위험도를 점수로 판단하지 않아요.</p>
            {(['preference', 'conditions'] as const).map(topic => <div className="topic" key={topic}><span>{topic === 'preference' ? '편한 도움' : '활동 조건'}</span><strong>{session?.state[topic].value || (session ? session.state.pending_question === topic ? '답변은 선택이에요' : statusNames[session.state[topic].status] : '대화 후 선택할 수 있어요')}</strong></div>)}
            {session && <button className="text-button" disabled={disabled} onClick={() => send('편한 도움을 다시 고를게요', 'edit_preference')}>편한 도움 정정하기</button>}
          </div>
          <div className="detail-card gentle"><span className="leaf">❋</span><h2>부담을 낮춘 작은 연결</h2><p>활동은 선택이고, 정보는 확인된 범위에서 안내해요. 실제 등록·신청·연락·보상은 수행하지 않아요.</p></div>
          <div className="safety-note"><strong>즉시 도움이 필요한 상황이라면</strong><p>가까운 사람이나 현지 응급서비스의 도움을 받아 주세요. 이 시제품은 긴급 연락을 대신하지 못해요.</p></div>
          {session && <button className="end-button" disabled={ending} onClick={finish}>{ending ? '삭제 확인 중…' : '대화 종료·삭제'}</button>}
        </aside>
      </div>
    </main>
  </div>;
}
