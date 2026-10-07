/*
 * 운영팀 의견함 — 시민 의견을 읽고 답하는 화면 (07_feedback_chat.sql의 staff_* 함수)
 *
 *   <script src="feedback-admin.js"></script>
 *   FeedbackAdmin.mount({ sb, root })        sb: supabase 클라이언트(일반 공개 키). 로그인은 이 화면에서 이메일로
 *
 * - 브라우저에는 공개 키만 있다. 운영팀인지는 DB가 staff_members 명단으로 확인한다(아니면 'staff_only').
 * - 시민은 '주민 #7F3A' 같은 가명 번호로만 보인다. 계정·닉네임·위험 정보는 이 화면에 없다.
 * - 답장은 시민 휴대폰 '내 의견함'에 "운영팀 · 사람이 직접 쓴 답"으로 보인다.
 */
(function (global) {
  'use strict';

  var KIND = { feature: '기능 요청', inconvenience: '불편', bug: '오류', info: '정책 정보' };
  var CHANNEL = { chief: '🎩 이장', haru: '🏛️ 하루' };
  var STATUS = { 'new': '접수됨', seen: '확인함', done: '완료' };
  var TABS = [
    { key: 'waiting', label: '답 필요' },
    { key: 'open',    label: '진행 중' },
    { key: 'done',    label: '완료' },
    { key: 'all',     label: '전체' }
  ];
  var REFRESH_MS = 60000;

  var STYLE_ID = 'fa-style';
  var CSS = [
    '.fa{--fa-ink:#1E2629;--fa-muted:#5D6A6E;--fa-line:#D9E1E3;--fa-bg:#F5F7F8;--fa-accent:#2F6F8F;--fa-soft:#E6EFF4;--fa-staff:#FFF6E3;--fa-staff-line:#E9CF95;--fa-red:#C0392B;',
    '  font-family:system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;color:var(--fa-ink);background:var(--fa-bg);min-height:100vh;line-height:1.55}',
    '.fa *{box-sizing:border-box}',
    '.fa p{margin:0}',
    '.fa-top{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:12px 16px;background:#fff;border-bottom:1px solid var(--fa-line)}',
    '.fa-top h1{font-size:17px;margin:0}',
    '.fa-who{margin-left:auto;font-size:13px;color:var(--fa-muted);display:flex;gap:8px;align-items:center}',
    '.fa-btn{font:inherit;font-size:14px;padding:7px 12px;border-radius:9px;border:0;background:var(--fa-accent);color:#fff;cursor:pointer}',
    '.fa-btn.secondary{background:#fff;color:var(--fa-accent);border:1.5px solid var(--fa-accent)}',
    '.fa-btn[disabled]{background:var(--fa-line);color:var(--fa-muted);border-color:transparent;cursor:default}',
    '.fa button:focus-visible,.fa input:focus-visible,.fa textarea:focus-visible,.fa select:focus-visible{outline:3px solid #F4B942;outline-offset:2px}',
    '.fa-login{max-width:360px;margin:12vh auto 0;background:#fff;border:1px solid var(--fa-line);border-radius:14px;padding:22px;display:flex;flex-direction:column;gap:10px}',
    '.fa-login h1{font-size:18px;margin:0}',
    '.fa label{font-size:13px;color:var(--fa-muted)}',
    '.fa input,.fa select,.fa textarea{font:inherit;font-size:14px;padding:8px 10px;border:1px solid var(--fa-line);border-radius:9px;background:#fff;color:var(--fa-ink);width:100%}',
    '.fa-msg{font-size:13px;color:var(--fa-red);min-height:1px}',
    '.fa-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 16px}',
    '.fa-tabs{display:flex;flex-wrap:wrap;gap:6px}',
    '.fa-tab{font:inherit;font-size:13px;padding:6px 12px;border-radius:999px;border:1.5px solid var(--fa-line);background:#fff;color:var(--fa-ink);cursor:pointer}',
    '.fa-tab[aria-pressed="true"]{border-color:var(--fa-accent);background:var(--fa-soft);color:var(--fa-accent);font-weight:600}',
    '.fa-tab b{margin-left:4px}',
    '.fa-bar select{width:auto}',
    '.fa-updated{font-size:12px;color:var(--fa-muted);margin-left:auto}',
    '.fa-main{display:grid;grid-template-columns:minmax(260px,360px) 1fr;gap:12px;padding:0 16px 24px;align-items:start}',
    '@media (max-width:760px){.fa-main{grid-template-columns:1fr}}',
    '.fa-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
    '.fa-item{width:100%;text-align:left;font:inherit;background:#fff;border:1px solid var(--fa-line);border-radius:10px;padding:9px 11px;cursor:pointer;color:var(--fa-ink);display:flex;flex-direction:column;gap:2px}',
    '.fa-item[aria-current="true"]{border-color:var(--fa-accent);box-shadow:0 0 0 2px var(--fa-soft)}',
    '.fa-meta{font-size:12px;color:var(--fa-muted);display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center}',
    '.fa-dot{width:8px;height:8px;border-radius:50%;background:var(--fa-red);display:inline-block}',
    '.fa-chip{font-size:11px;padding:1px 8px;border-radius:999px;background:var(--fa-soft);color:var(--fa-accent)}',
    '.fa-chip[data-s="done"]{background:#E6F2E9;color:#2E6B4F}',
    '.fa-chip[data-s="new"]{background:#FDE8E6;color:var(--fa-red)}',
    '.fa-preview{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.fa-empty{font-size:14px;color:var(--fa-muted);padding:20px;text-align:center;background:#fff;border:1px dashed var(--fa-line);border-radius:12px}',
    '.fa-thread{background:#fff;border:1px solid var(--fa-line);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;min-width:0}',
    '.fa-thread h2{font-size:16px;margin:0}',
    '.fa-bubble{padding:8px 11px;border-radius:12px;font-size:14px;white-space:pre-line;overflow-wrap:anywhere;max-width:85%}',
    '.fa-bubble.citizen{align-self:flex-start;background:var(--fa-soft)}',
    '.fa-bubble.staff{align-self:flex-end;background:var(--fa-staff);border:1px solid var(--fa-staff-line)}',
    '.fa-bwho{display:block;font-size:11px;color:var(--fa-muted);margin-bottom:2px}',
    '.fa-guide{font-size:12px;color:var(--fa-muted);background:var(--fa-bg);border-radius:8px;padding:8px 10px}',
    '.fa-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '.fa-row select{width:auto}',
    '.fa-count{font-size:12px;color:var(--fa-muted);text-align:right}',
    '.fa-link{color:var(--fa-accent)}'
  ].join('\n');

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style'); s.id = STYLE_ID; s.textContent = CSS; document.head.appendChild(s);
  }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function when(iso) {
    try { return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); }
    catch (e) { return ''; }
  }
  function bokjiro(id) {
    return 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=' + encodeURIComponent(id);
  }

  function mount(opts) {
    injectStyle();
    var sb = opts.sb, root = opts.root;
    root.classList.add('fa');
    var st = { rows: [], tab: 'waiting', channel: '', selected: null, timer: null, email: '' };

    async function call(name, args) {
      try { return await sb.rpc(name, args); } catch (e) { return { error: e }; }
    }

    // ------------------------------------------------ 로그인
    function showLogin(message) {
      stopTimer();
      var email = el('input', { id: 'fa-email', type: 'email', autocomplete: 'username', required: 'required' });
      var pw = el('input', { id: 'fa-pw', type: 'password', autocomplete: 'current-password', required: 'required' });
      var msg = el('p', { class: 'fa-msg', 'aria-live': 'polite', text: message || '' });
      var btn = el('button', { class: 'fa-btn', type: 'submit', text: '로그인' });
      var form = el('form', { class: 'fa-login', onsubmit: async function (e) {
        e.preventDefault();
        btn.disabled = true; msg.textContent = '';
        var r;
        try { r = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value }); } catch (err) { r = { error: err }; }
        btn.disabled = false;
        if (r.error) { msg.textContent = '로그인하지 못했어요. 이메일·비밀번호를 확인해 주세요.'; return; }
        start();
      } }, [
        el('h1', { text: '이음 운영팀 · 마을 의견함' }),
        el('p', { class: 'fa-guide', text: '운영팀 명단(staff_members)에 등록된 계정만 들어올 수 있어요. 시민은 이름 대신 번호로만 보여요.' }),
        el('label', { for: 'fa-email', text: '이메일' }), email,
        el('label', { for: 'fa-pw', text: '비밀번호' }), pw,
        btn, msg
      ]);
      root.replaceChildren(form);
      email.focus();
    }

    async function logout() {
      stopTimer();
      try { await sb.auth.signOut(); } catch (e) { /* 무시 */ }
      showLogin('로그아웃했어요.');
    }

    async function start() {
      var s;
      try { s = await sb.auth.getSession(); } catch (e) { s = null; }
      var session = s && s.data && s.data.session;
      if (!session) { showLogin(); return; }
      st.email = (session.user && session.user.email) || '';
      var ok = await call('am_i_staff', {});
      if (ok.error || ok.data !== true) {
        try { await sb.auth.signOut(); } catch (e) { /* 무시 */ }
        showLogin(ok.error ? '의견함 기능이 아직 DB에 없어요(07_feedback_chat.sql 적용 필요).' : '운영팀 명단에 없는 계정이에요. 담당자에게 등록을 요청해 주세요.');
        return;
      }
      await load();
      stopTimer();
      st.timer = setInterval(function () { if (!document.hidden) load(true); }, REFRESH_MS);
    }
    function stopTimer() { if (st.timer) { clearInterval(st.timer); st.timer = null; } }

    // ------------------------------------------------ 목록
    async function load(quiet) {
      var r = await call('staff_feedback_list', { p_status: null, p_channel: st.channel || null, p_limit: 300 });
      if (r.error) {
        if (String(r.error.message || '').indexOf('staff_only') >= 0) { showLogin('운영팀 권한이 없어요.'); return; }
        if (!quiet) renderShell('목록을 불러오지 못했어요. 새로고침해 주세요.');
        return;
      }
      st.rows = r.data || [];
      st.loadedAt = new Date();
      renderShell();
    }

    function inTab(f, tab) {
      if (tab === 'waiting') return f.waiting;
      if (tab === 'open') return f.status !== 'done';
      if (tab === 'done') return f.status === 'done';
      return true;
    }

    function renderShell(error) {
      var activeId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null;
      var draft = root.querySelector('#fa-reply');
      var draftText = draft ? draft.value : '';
      var rows = st.rows.filter(function (f) { return inTab(f, st.tab); });
      if (st.selected && !st.rows.some(function (f) { return f.id === st.selected; })) st.selected = null;

      var top = el('header', { class: 'fa-top' }, [
        el('h1', { text: '마을 의견함 · 운영팀' }),
        el('div', { class: 'fa-who' }, [
          el('span', { text: st.email }),
          el('button', { class: 'fa-btn secondary', type: 'button', text: '로그아웃', onclick: logout })
        ])
      ]);
      var tabs = el('div', { class: 'fa-tabs', role: 'group', 'aria-label': '상태로 거르기' }, TABS.map(function (t) {
        var n = st.rows.filter(function (f) { return inTab(f, t.key); }).length;
        return el('button', { class: 'fa-tab', type: 'button', 'aria-pressed': st.tab === t.key ? 'true' : 'false', 'data-tab': t.key,
          onclick: function () { st.tab = t.key; renderShell(); } }, [t.label, el('b', { text: String(n) })]);
      }));
      var ch = el('select', { 'aria-label': '창구로 거르기', onchange: function (e) { st.channel = e.target.value; load(); } },
        [['', '모든 창구'], ['chief', '이장'], ['haru', '하루(정책 정보)']].map(function (o) {
          return el('option', { value: o[0], selected: st.channel === o[0] ? 'selected' : null, text: o[1] });
        }));
      var bar = el('div', { class: 'fa-bar' }, [
        tabs, ch,
        el('button', { class: 'fa-btn secondary', type: 'button', text: '새로고침', onclick: function () { load(); } }),
        el('span', { class: 'fa-updated', 'aria-live': 'polite', text: error || (st.loadedAt ? '마지막 확인 ' + st.loadedAt.toLocaleTimeString('ko-KR', { hour12: false }) : '') })
      ]);

      var list = rows.length
        ? el('ul', { class: 'fa-list', 'aria-label': '의견 목록' }, rows.map(function (f) {
            return el('li', null, [el('button', { class: 'fa-item', type: 'button', 'data-id': String(f.id), 'aria-current': st.selected === f.id ? 'true' : 'false',
              onclick: function () { st.selected = f.id; renderShell(); var r = root.querySelector('#fa-reply'); if (r) r.focus(); } }, [
              el('span', { class: 'fa-meta' }, [
                f.waiting ? el('span', { class: 'fa-dot', title: '답 필요', 'aria-label': '답 필요' }) : null,
                el('span', { class: 'fa-chip', 'data-s': f.status, text: STATUS[f.status] }),
                el('span', { text: f.alias }),
                el('span', { text: CHANNEL[f.channel] + ' · ' + (KIND[f.kind] || f.kind) }),
                el('span', { text: when(f.updated_at) })
              ]),
              el('span', { class: 'fa-preview', text: f.body })
            ])]);
          }))
        : el('p', { class: 'fa-empty', text: st.tab === 'waiting' ? '답할 의견이 없어요. 👍' : '의견이 없어요.' });

      var sel = st.rows.filter(function (f) { return f.id === st.selected; })[0];
      var side = sel ? thread(sel, draftText) : el('p', { class: 'fa-empty', text: '왼쪽에서 의견을 고르면 대화가 보여요.' });
      root.replaceChildren(top, bar, el('div', { class: 'fa-main' }, [list, side]));
      if (activeId) { var again = root.querySelector('[data-id="' + activeId + '"]'); if (again) again.focus(); }
    }

    // ------------------------------------------------ 대화
    function thread(f, draftText) {
      var head = [
        el('h2', { text: f.alias + ' · ' + CHANNEL[f.channel] + ' · ' + (KIND[f.kind] || f.kind) }),
        el('p', { class: 'fa-meta' }, [
          el('span', { text: '보낸 시각 ' + when(f.created_at) }),
          f.place ? el('span', { text: '장소 ' + f.place }) : null,
          f.serv_id ? el('span', null, ['정책 ', el('a', { class: 'fa-link', href: bokjiro(f.serv_id), target: '_blank', rel: 'noopener noreferrer', text: (f.program_name || f.serv_id) })]) : null
        ])
      ];
      var bubbles = [el('p', { class: 'fa-bubble citizen' }, [el('span', { class: 'fa-bwho', text: f.alias + ' · ' + when(f.created_at) }), f.body])];
      (f.messages || []).forEach(function (m) {
        bubbles.push(el('p', { class: 'fa-bubble ' + (m.who === 'staff' ? 'staff' : 'citizen') }, [
          el('span', { class: 'fa-bwho', text: (m.who === 'staff' ? '운영팀' : f.alias) + ' · ' + when(m.at) }), m.body
        ]));
      });

      var ta = el('textarea', { id: 'fa-reply', maxlength: '500', rows: '4', placeholder: '시민 휴대폰에 "운영팀" 이름으로 보여요' });
      ta.value = draftText || '';
      var count = el('p', { class: 'fa-count', text: ta.value.length + ' / 500' });
      ta.addEventListener('input', function () { count.textContent = ta.value.length + ' / 500'; });
      var msg = el('p', { class: 'fa-msg', 'aria-live': 'polite' });
      var send = el('button', { class: 'fa-btn', type: 'button', text: '답장 보내기', onclick: async function () {
        var text = ta.value.trim();
        if (!text) { msg.textContent = '답장 내용을 적어 주세요.'; ta.focus(); return; }
        send.disabled = true;
        var r = await call('staff_reply', { p_id: f.id, p_body: text });
        send.disabled = false;
        if (r.error || r.data !== 'saved') { msg.textContent = '보내지 못했어요. 다시 시도해 주세요.'; return; }
        ta.value = '';
        await load();
      } });
      var status = el('select', { 'aria-label': '상태 바꾸기' }, Object.keys(STATUS).map(function (k) {
        return el('option', { value: k, selected: f.status === k ? 'selected' : null, text: STATUS[k] });
      }));
      status.addEventListener('change', async function () {
        var r = await call('staff_set_status', { p_id: f.id, p_status: status.value });
        if (r.error) { msg.textContent = '상태를 바꾸지 못했어요.'; return; }
        await load();
      });
      return el('section', { class: 'fa-thread', 'aria-label': '선택한 의견' }, head.concat(bubbles, [
        el('p', { class: 'fa-guide', text: '답장은 시민 휴대폰 "내 의견함"에 "운영팀 · 사람이 직접 쓴 답"으로 보여요. 연락처·실명 같은 개인정보는 묻지 마세요. 위기 신호가 보이면 답장 대신 위기 대응 절차를 따라 주세요.' }),
        el('label', { for: 'fa-reply', text: '답장' }), ta, count,
        el('div', { class: 'fa-row' }, [send, el('label', { text: '상태' }), status]),
        msg
      ]));
    }

    start();
    return { reload: load, stop: stopTimer };
  }

  global.FeedbackAdmin = { mount: mount };
})(window);
