/* Market service screens and bus presentation; no wallet, purchases or DB writes. */
(function (root) {
  'use strict';
  let host = null, travelling = false, destination = null, service = null, focusBefore = null;
  let chat = null, speech = null, speechUntil = 0, composing = false;
  let chatFrame = null, manipulation = null;
  const chatHistory = [];
  const marketModes = ['market', 'bank', 'clothing'];
  function chatAvailable() {
    const e = host?.engine();
    return !!e?.isRunning() && marketModes.includes(e.mode()) && !travelling && !service && !host.blocked() && !host.tutorial() && !root.WorldUI?.isOpen();
  }
  function isTyping() { return !!chat && !chat.hidden && document.activeElement === chat.querySelector('input'); }
  function clearSpeech() { speech?.remove(); speech = null; speechUntil = 0; }
  function expandChat(expanded, focus = false) {
    if (!chat) return;
    chat.classList.toggle('is-collapsed', !expanded);
    const button = chat.querySelector('#market-chat-toggle'); button.setAttribute('aria-expanded', String(expanded));
    button.querySelector('.market-chat-chevron').textContent = expanded ? '−' : '+';
    if (!expanded && isTyping()) chat.querySelector('input').blur();
    host?.engine()?.pauseInput();
    placeChatAboveKeyboard();
    if (focus) chat.querySelector('input').focus();
  }
  function createChat() {
    chat = document.createElement('section'); chat.id = 'market-chat'; chat.setAttribute('aria-label', '시장 채팅');
    chat.innerHTML = '<div id="market-chat-header" tabindex="0" aria-label="시장 채팅창 이동"><span class="market-chat-symbol" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24"><path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-6 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h6"/></svg></span>' +
      '<strong>시장 채팅</strong><button type="button" id="market-chat-toggle" aria-expanded="true" aria-controls="market-chat-content" aria-label="채팅창 접기 또는 펼치기"><span class="market-chat-chevron" aria-hidden="true">−</span></button></div>' +
      '<div id="market-chat-content"><div id="market-chat-log" role="log" aria-live="polite" aria-relevant="additions"><p class="market-chat-empty">시장에서 나누고 싶은 말을 남겨 보세요.</p></div>' +
      '<form id="market-chat-form"><label class="market-sr-only" for="market-chat-input">시장 채팅 메시지</label><input id="market-chat-input" name="message" type="text" maxlength="80" autocomplete="off" placeholder="메시지 입력…" enterkeyhint="send"><button type="submit" aria-label="메시지 보내기">보내기</button></form>' +
      '<p class="market-chat-hint">Enter로 입력 · Esc로 입력 종료 · 최대 80자</p></div>' +
      ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].map(edge => '<span class="market-chat-resize resize-' + edge + '" data-edge="' + edge + '" aria-hidden="true"></span>').join('');
    document.body.append(chat);
    chat.querySelector('#market-chat-toggle').onclick = () => expandChat(chat.classList.contains('is-collapsed'));
    chat.querySelector('#market-chat-header').addEventListener('pointerdown', e => {
      if (!e.target.closest('button')) startManipulation(e, 'move');
    });
    for (const handle of chat.querySelectorAll('[data-edge]')) handle.addEventListener('pointerdown', e => startManipulation(e, handle.dataset.edge));
    chat.addEventListener('pointermove', moveChat);
    chat.addEventListener('pointerup', endManipulation);
    chat.addEventListener('pointercancel', endManipulation);
    chat.addEventListener('lostpointercapture', endManipulation);
    chat.querySelector('#market-chat-header').addEventListener('keydown', e => {
      const steps = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] };
      if (e.target.id !== 'market-chat-header' || !steps[e.key]) return;
      e.preventDefault(); e.stopPropagation();
      const b = chat.getBoundingClientRect();
      if (!chatFrame) chatFrame = { x: b.x, y: b.y, w: b.width, h: chat.classList.contains('is-collapsed') ? defaultChatHeight() : b.height };
      chatFrame.x += steps[e.key][0]; chatFrame.y += steps[e.key][1];
      placeChatAboveKeyboard(); host?.engine()?.pauseInput();
    });
    const input = chat.querySelector('input');
    input.onfocus = () => host?.engine()?.pauseInput();
    input.onblur = () => { composing = false; };
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });
    input.onkeydown = e => {
      if (e.key === 'Enter' && (composing || e.isComposing || e.keyCode === 229)) { e.preventDefault(); e.stopPropagation(); }
    };
    chat.querySelector('form').onsubmit = e => {
      e.preventDefault(); if (composing || !chatAvailable()) return;
      const text = Array.from(input.value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim()).slice(0, 80).join('');
      if (!text) return;
      const now = new Date(), nickname = String(host.nickname?.() || '나');
      const message = { nickname, text, portrait: host.portrait?.() || '', time: String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') };
      chatHistory.push(message); if (chatHistory.length > 30) chatHistory.shift();
      appendChatMessage(message); input.value = ''; input.focus();
      clearSpeech(); speech = document.createElement('div'); speech.id = 'market-chat-bubble'; speech.setAttribute('aria-hidden', 'true');
      speech.textContent = text; document.body.append(speech);
      speechUntil = performance.now() + Math.max(5000, Math.min(9000, Array.from(text).length * 70 + 2500));
      drawSpeech();
    };
    renderChatHistory();
    expandChat(!(root.matchMedia && root.matchMedia('(max-width: 600px)').matches));
  }
  function renderChatHistory() {
    const log = chat?.querySelector('#market-chat-log'); if (!log || !chatHistory.length) return;
    log.replaceChildren();
    for (const message of chatHistory) appendChatMessage(message);
  }
  function appendChatMessage(message) {
    const log = chat?.querySelector('#market-chat-log'); if (!log) return;
    log.querySelector('.market-chat-empty')?.remove();
    const row = document.createElement('div'); row.className = 'market-chat-message';
    const photo = document.createElement('img'); photo.className = 'market-chat-avatar'; photo.src = message.portrait; photo.alt = message.nickname + ' 캐릭터 프로필'; photo.width = photo.height = 30;
    const content = document.createElement('div'); content.className = 'market-chat-message-content';
    const name = document.createElement('strong'); name.textContent = message.nickname;
    const time = document.createElement('time'); time.textContent = message.time;
    const body = document.createElement('p'); body.textContent = message.text;
    content.append(name, time, body); row.append(photo, content); log.append(row);
    while (log.children.length > 30) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
  }
  function syncChat() {
    const e = host?.engine(), inMarket = !!e?.isRunning() && marketModes.includes(e.mode()) && !travelling;
    if (inMarket && !chat) createChat();
    if (chat) {
      const available = chatAvailable();
      if (!available && manipulation) endManipulation();
      if (!available && isTyping()) chat.querySelector('input').blur();
      chat.hidden = !available;
      document.body.classList.toggle('has-market-chat', available);
      placeChatAboveKeyboard();
    }
    if (!inMarket) clearSpeech();
    else if (speech) speech.hidden = !chatAvailable();
  }
  function placeChatAboveKeyboard() {
    if (!chat) return;
    if (chatFrame) { applyChatFrame(); return; }
    const viewport = root.visualViewport;
    const covered = viewport && root.innerWidth <= 600 ? Math.max(0, root.innerHeight - viewport.height - viewport.offsetTop) : 0;
    const bottom = covered > 0 ? 'calc(' + Math.max(122, covered + 14) + 'px + env(safe-area-inset-bottom))' : '';
    if (chat.style.bottom !== bottom) chat.style.bottom = bottom;
  }
  function defaultChatHeight() { return root.innerWidth <= 600 ? 198 : 228; }
  function chatSpace() {
    const v = root.visualViewport;
    return { x: 12, y: 12, w: Math.max(120, (v?.width || root.innerWidth) - 24), h: Math.max(44, (v?.height || root.innerHeight) - 24) };
  }
  function applyChatFrame() {
    if (!chat || !chatFrame) return;
    const s = chatSpace(), collapsed = chat.classList.contains('is-collapsed');
    const w = Math.min(s.w, collapsed ? 154 : Math.max(244, chatFrame.w));
    const h = Math.min(s.h, collapsed ? 44 : Math.max(178, chatFrame.h));
    const x = Math.max(s.x, Math.min(chatFrame.x, s.x + s.w - w));
    const y = Math.max(s.y, Math.min(chatFrame.y, s.y + s.h - h));
    for (const [key, value] of Object.entries({ left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', bottom: 'auto' })) {
      if (chat.style[key] !== value) chat.style[key] = value;
    }
  }
  function startManipulation(e, kind) {
    if (e.button !== 0 || !chatAvailable() || (kind !== 'move' && chat.classList.contains('is-collapsed'))) return;
    e.preventDefault(); e.stopPropagation();
    chat.querySelector('input').blur(); host?.engine()?.pauseInput();
    const b = chat.getBoundingClientRect(), collapsed = chat.classList.contains('is-collapsed');
    const expanded = chatFrame || { w: Math.min(310, root.innerWidth - 96), h: defaultChatHeight() };
    chatFrame = { x: b.x, y: b.y, w: collapsed ? expanded.w : b.width, h: collapsed ? expanded.h : b.height };
    manipulation = { kind, pointer: e.pointerId, x: e.clientX, y: e.clientY, rect: { x: b.x, y: b.y, w: b.width, h: b.height }, frame: { ...chatFrame } };
    chat.classList.add('is-manipulating'); applyChatFrame();
    chat.setPointerCapture(e.pointerId);
  }
  function moveChat(e) {
    if (!manipulation || manipulation.pointer !== e.pointerId) return;
    e.preventDefault();
    const a = manipulation, r = a.rect, dx = e.clientX - a.x, dy = e.clientY - a.y, s = chatSpace();
    if (a.kind === 'move') {
      const x = Math.max(s.x, Math.min(r.x + dx, s.x + s.w - r.w)), y = Math.max(s.y, Math.min(r.y + dy, s.y + s.h - r.h));
      chatFrame = { ...a.frame, x, y };
    } else {
      let left = r.x, right = r.x + r.w, top = r.y, bottom = r.y + r.h;
      const minW = Math.min(244, s.w), minH = Math.min(178, s.h);
      if (a.kind.includes('w')) left = Math.max(s.x, Math.min(r.x + dx, right - minW));
      if (a.kind.includes('e')) right = Math.min(s.x + s.w, Math.max(left + minW, right + dx));
      if (a.kind.includes('n')) top = Math.max(s.y, Math.min(r.y + dy, bottom - minH));
      if (a.kind.includes('s')) bottom = Math.min(s.y + s.h, Math.max(top + minH, bottom + dy));
      chatFrame = { x: left, y: top, w: right - left, h: bottom - top };
    }
    applyChatFrame();
  }
  function endManipulation() {
    if (!manipulation) return;
    const pointer = manipulation.pointer; manipulation = null;
    chat?.classList.remove('is-manipulating');
    if (chat?.hasPointerCapture(pointer)) chat.releasePointerCapture(pointer);
    host?.engine()?.pauseInput();
  }
  root.addEventListener('blur', endManipulation);
  root.addEventListener('resize', placeChatAboveKeyboard);
  root.visualViewport?.addEventListener('resize', placeChatAboveKeyboard);
  root.visualViewport?.addEventListener('scroll', placeChatAboveKeyboard);
  function drawSpeech() {
    if (!speech) return;
    if (performance.now() >= speechUntil) { clearSpeech(); return; }
    const p = host?.engine()?.playerHeadScreen?.();
    speech.hidden = !chatAvailable() || !p?.visible;
    if (speech.hidden) return;
    const half = speech.offsetWidth / 2;
    const x = Math.max(half + 12, Math.min(root.innerWidth - half - 12, p.x));
    speech.style.left = x + 'px'; speech.style.top = Math.max(speech.offsetHeight + 20, p.y - 12) + 'px';
    speech.style.setProperty('--chat-tail-x', Math.max(15, Math.min(speech.offsetWidth - 15, p.x - x + half)) + 'px');
  }
  const messages = {
    approach: ['버스가 오고 있어요', '정류장에서 잠시 기다려 주세요.'],
    boarding: ['버스에 올라타요', '문이 열렸어요. 천천히 올라타세요.'],
    departure: ['출발합니다', '정류장을 뒤로 하고 출발해요.'],
    blackout: ['다음 정류장으로 이동 중', '잠시 후 도착해요.'],
    arriving: ['정류장에 도착했어요', '버스가 멈추면 내려요.'],
    alighting: ['천천히 내려요', '도착한 곳을 자유롭게 둘러보세요.'],
    farewell: ['즐거운 시간 보내세요', '돌아갈 때도 정류장에서 버스를 불러요.']
  };
  function cleanup() {
    travelling = false; destination = null;
    document.body.classList.remove('in-transit');
    document.getElementById('transit-fade')?.remove(); document.getElementById('transit-card')?.remove();
    host?.engine()?.pauseInput(); host?.refresh();
  }
  function phase(name) {
    const title = destination === 'market' ? '이음 시장행' : '이음 마을행';
    const card = document.getElementById('transit-card'), line = messages[name];
    card.dataset.phase = name;
    card.querySelector('strong').textContent = line[0]; card.querySelector('p').textContent = line[1];
    card.querySelector('.transit-route').textContent = title;
    document.getElementById('transit-fade').classList.toggle('is-black', name === 'blackout');
    root.dispatchEvent(new CustomEvent('socialworld:bus-phase', { detail: { phase: name, destination } }));
  }
  function ride() {
    const engine = host?.engine();
    if (!engine || travelling || host.blocked() || host.tutorial()) return false;
    closeService(); root.WorldUI?.close(); root.WorldUI?.cancelFishing();
    destination = engine.mode() === 'village' ? 'market' : 'village'; travelling = true;
    const fade = document.createElement('div'); fade.id = 'transit-fade'; fade.setAttribute('aria-hidden', 'true'); document.body.append(fade);
    const card = document.createElement('section'); card.id = 'transit-card'; card.setAttribute('role', 'status'); card.setAttribute('aria-live', 'polite');
    card.innerHTML = '<span class="transit-route"></span><div class="transit-main"><span class="transit-icon" aria-hidden="true">🚌</span><div><strong></strong><p></p></div></div><button type="button" id="transit-skip">연출 건너뛰기</button>';
    document.body.append(card); document.body.classList.add('in-transit');
    document.getElementById('transit-skip').onclick = () => engine.finishBusRide();
    const started = engine.startBusRide(destination, {
      onPhase: phase,
      onTransfer: (mode, spawn) => host.arrive(mode, spawn),
      onComplete: () => { const target = destination; cleanup(); host.toast(target === 'market' ? '이음 시장에 도착했어요. 은행과 옷가게를 둘러보세요.' : '이음 마을에 돌아왔어요.'); },
      onCancel: cleanup
    });
    if (!started) cleanup(); else host.refresh();
    return started;
  }
  const colors = [['세이지 셔츠', '#8FAA9B'], ['살구 셔츠', '#D9917F'], ['크림 니트', '#E2CF9C'], ['하늘 셔츠', '#96B4CC'], ['라벤더 니트', '#B5A4C1'], ['소프트 브라운', '#B9987C']];
  function clothes() {
    return colors.map(([name, color]) => '<article class="market-look"><svg viewBox="0 0 100 110" aria-hidden="true"><path d="M32 18 17 28 5 51l18 9 10-15v52h34V45l10 15 18-9-12-23-15-10c-4 12-32 12-36 0Z" fill="' + color + '" stroke="#7E8272" stroke-width="2"/><path d="M32 18q18 15 36 0" fill="none" stroke="#F9F2E1" stroke-width="4"/></svg><strong>' + name + '</strong><span>오늘의 진열</span></article>').join('');
  }
  function closeService() {
    service = null; document.getElementById('market-service')?.remove();
    host?.engine()?.pauseInput();
    if (focusBefore && document.contains(focusBefore)) focusBefore.focus(); focusBefore = null;
  }
  function openService(kind) {
    if (travelling || service || !host || host.tutorial()) return;
    root.WorldUI?.close(); focusBefore = document.activeElement; service = kind;
    const bank = kind === 'bank', modal = document.createElement('div'); modal.id = 'market-service'; modal.className = 'modal-backdrop market-service-backdrop';
    modal.innerHTML = '<section class="market-service" role="dialog" aria-modal="true" aria-labelledby="market-service-title">' +
      '<header><div><span class="market-eyebrow">' + (bank ? 'IEUM BANK' : 'TODAY’S WARDROBE') + '</span><h2 id="market-service-title">' + (bank ? '이음 은행' : '오늘의 옷장') + '</h2><p>' + (bank ? '잠시 쉬면서 앞으로의 계획을 그려 보세요.' : '지금 마음에 드는 색을 천천히 둘러보세요.') + '</p></div><button type="button" id="market-service-close" aria-label="안내 닫기">×</button></header>' +
      (bank ? '<div class="market-bank-welcome"><span aria-hidden="true">🏦</span><strong>은행에 오신 것을 환영해요</strong><p>소중한 물건을 맡기고, 나만의 목표를 차근차근 준비하는 공간이에요.</p></div><div class="market-bank-services"><article><span aria-hidden="true">🗃️</span><h3>보관 창구</h3><p>가져온 물건을 보관하는 창구예요.</p><span class="market-soon">준비 중</span></article><article><span aria-hidden="true">🌱</span><h3>저축 창구</h3><p>작은 목표부터 함께 준비해요.</p><span class="market-soon">준비 중</span></article></div>' : '<div class="market-collection">' + clothes() + '</div><p class="market-collection-note">마음에 드는 옷을 골라 보는 공간이에요. 구매 창구는 준비 중이에요.</p>') +
      '<footer><button type="button" class="market-primary" id="market-service-done">계속 둘러보기</button><span>Esc로 닫기</span></footer></section>';
    document.body.append(modal);
    modal.querySelector('#market-service-close').onclick = closeService; modal.querySelector('#market-service-done').onclick = closeService;
    host.engine()?.pauseInput(); modal.querySelector('#market-service-close').focus();
  }
  document.addEventListener('keydown', e => {
    if (chatAvailable() && !service) {
      if (isTyping() && e.key === 'Escape' && !e.isComposing && !composing) {
        e.preventDefault(); e.stopImmediatePropagation(); chat.querySelector('input').blur(); host?.engine()?.pauseInput(); return;
      }
      const typing = e.target?.matches?.('input,textarea,select,button,a,[contenteditable="true"]');
      if (e.key === 'Enter' && !typing && !e.isComposing && !composing) { e.preventDefault(); e.stopImmediatePropagation(); expandChat(true, true); return; }
    }
    if (!service) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeService(); return; }
    if (e.key === 'Tab') {
      const buttons = [...document.querySelectorAll('#market-service button')], first = buttons[0], last = buttons.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, true);
  root.MarketUI = {
    init(value) { host = value; }, ride, openService, closeService,
    isTravelling: () => travelling,
    isTyping, isManipulating: () => !!manipulation, sync: syncChat, drawSpeech,
    tick() { syncChat(); if (speech && performance.now() >= speechUntil) clearSpeech(); },
    reset() { endManipulation(); closeService(); host?.engine()?.cancelBusRide(); cleanup(); clearSpeech(); chat?.remove(); chat = null; chatFrame = null; chatHistory.length = 0; composing = false; document.body.classList.remove('has-market-chat'); },
    state: () => ({ travelling, destination, service, typing: isTyping(), manipulating: !!manipulation, chatVisible: !!chat && !chat.hidden, messages: chatHistory.length, speech: speech?.textContent || null })
  };
})(window);
