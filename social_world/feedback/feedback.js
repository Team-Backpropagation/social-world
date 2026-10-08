/*
 * 마을 의견함 — 시민 쪽 화면 부품 (07_feedback_chat.sql)
 *
 *   <script src="feedback/feedback.js"></script>
 *   Feedback.compose({ sb, channel: 'chief', place: '광장', onDone })  → 의견 쓰기 폼(DOM). 이장 대화창·휴대폰에서 쓴다
 *   Feedback.inbox({ sb, onChange, onCompose })                       → '내 의견함' 목록·대화(DOM). 휴대폰 화면에 붙인다
 *                                                                        onChange(안 읽은 수) — 불러올 때·읽을 때
 *   Feedback.unread(sb)                                                → 안 읽은 운영팀 답이 달린 의견 수(Promise<number>)
 *
 * - 저장·위기 검사·가리기·횟수 제한은 DB 함수가 한다(submit_feedback · reply_my_feedback). 화면은 결과만 보여 준다.
 * - 운영팀 답장은 사람이 쓴 것으로 표시한다("운영팀 · 사람이 직접 쓴 답"). 이장·하루는 전해 주는 역할만.
 * - 07 적용 전이면 "지금은 의견을 받을 수 없어요"로 안내하고 멈추지 않는다.
 */
(function (global) {
  'use strict';

  var KINDS = [
    { key: 'feature',       label: '이런 게 있으면 좋겠어요' },
    { key: 'inconvenience', label: '불편해요' },
    { key: 'bug',           label: '오류가 있어요' }
  ];
  var KIND_LABEL = { feature: '기능 요청', inconvenience: '불편', bug: '오류', info: '정책 정보' };
  var STATUS = { 'new': '접수됨', seen: '확인했어요', done: '반영했어요' };
  var CHANNEL = { chief: '이장에게', haru: '하루에게' };
  var COURIER = { chief: '🎩 이장이 운영팀 답을 전해 왔어요', haru: '하루가 운영팀 답을 전해 왔어요' };

  var LINES = {
    ask:      '마을에 바라는 점, 불편한 점, 오류를 알려 주세요. 운영팀(사람)이 읽고 답해요.',
    saved:    '운영팀에 전할게요. 답이 오면 휴대폰 "내 의견함"에서 볼 수 있어요.',
    many:     '오늘은 의견을 많이 보내 주셨어요. 내일 다시 보내 주세요.',
    crisis:   '많이 힘드신 것 같아요. 지금 바로 이야기할 수 있는 곳을 알려 드릴게요.',
    failed:   '지금은 의견을 받을 수 없어요. 조금 뒤에 다시 보내 주세요.',
    empty:    '아직 보낸 의견이 없어요.',
    loadFail: '의견함을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.',
    keep:     '보낸 의견은 90일 뒤 자동으로 지워져요. 운영팀에게는 이름 대신 번호로만 보여요.',
    noBody:   '한 줄만 적어 주세요.'
  };

  var STYLE_ID = 'feedback-style';
  var CSS = [
    '.fb{--fb-ink:#1F2A2A;--fb-muted:#5A6667;--fb-line:#D8E1E0;--fb-accent:#2F6F8F;--fb-soft:#E7F0F4;--fb-staff:#FFF6E3;--fb-staff-line:#E9CF95;--fb-red:#C0392B;font:inherit;color:var(--fb-ink);line-height:1.55}',
    '.fb *{box-sizing:border-box}',
    '.fb p{margin:0}',
    '.fb-form{display:flex;flex-direction:column;gap:10px}',
    '.fb-kinds{display:flex;flex-wrap:wrap;gap:6px;border:0;margin:0;padding:0}',
    '.fb-kinds legend{font-size:13px;color:var(--fb-muted);margin-bottom:6px;padding:0}',
    '.fb-kind{font:inherit;font-size:13px;padding:6px 10px;border-radius:999px;border:1.5px solid var(--fb-line);background:#fff;color:var(--fb-ink);cursor:pointer}',
    '.fb-kind[aria-pressed="true"]{border-color:var(--fb-accent);background:var(--fb-soft);color:var(--fb-accent);font-weight:600}',
    '.fb label{font-size:13px;color:var(--fb-muted)}',
    '.fb textarea{width:100%;font:inherit;font-size:14px;padding:8px 10px;border:1px solid var(--fb-line);border-radius:10px;resize:vertical;min-height:80px;background:#fff;color:var(--fb-ink)}',
    '.fb-count{font-size:12px;color:var(--fb-muted);text-align:right}',
    '.fb-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '.fb-btn{font:inherit;font-size:14px;padding:8px 14px;border-radius:10px;border:0;background:var(--fb-accent);color:#fff;cursor:pointer}',
    '.fb-btn.secondary{background:#fff;color:var(--fb-accent);border:1.5px solid var(--fb-accent)}',
    '.fb-btn.danger{background:#fff;color:var(--fb-red);border:1.5px solid var(--fb-red)}',
    '.fb-btn[disabled]{background:var(--fb-line);color:var(--fb-muted);border-color:transparent;cursor:default}',
    '.fb button:focus-visible,.fb textarea:focus-visible{outline:3px solid #F4B942;outline-offset:2px}',
    '.fb-msg{font-size:13px;min-height:1px}',
    '.fb-note{font-size:12px;color:var(--fb-muted)}',
    '.fb-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}',
    '.fb-item{border:1px solid var(--fb-line);border-radius:12px;background:#fff}',
    '.fb-head{width:100%;text-align:left;font:inherit;background:none;border:0;padding:10px 12px;cursor:pointer;color:var(--fb-ink);display:flex;flex-direction:column;gap:2px}',
    '.fb-meta{font-size:12px;color:var(--fb-muted);display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center}',
    '.fb-status{font-size:11px;padding:1px 8px;border-radius:999px;background:var(--fb-soft);color:var(--fb-accent)}',
    '.fb-status[data-s="done"]{background:#E6F2E9;color:#2E6B4F}',
    '.fb-new{font-size:11px;padding:1px 8px;border-radius:999px;background:var(--fb-red);color:#fff;font-weight:600}',
    '.fb-preview{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}',
    '.fb-thread{padding:0 12px 12px;display:flex;flex-direction:column;gap:8px}',
    '.fb-bubble{padding:8px 10px;border-radius:12px;font-size:14px;white-space:pre-line;overflow-wrap:anywhere;max-width:92%}',
    '.fb-bubble.me{align-self:flex-end;background:var(--fb-soft)}',
    '.fb-bubble.staff{align-self:flex-start;background:var(--fb-staff);border:1px solid var(--fb-staff-line)}',
    '.fb-who{display:block;font-size:11px;color:var(--fb-muted);margin-bottom:2px}',
    '.fb-courier{font-size:12px;color:#7A5410;margin-top:2px}',
    '.fb-crisis{padding:12px 14px;border:3px solid #d64545;border-radius:12px;background:#fff5f5;color:#3a1515}',
    '.fb-crisis b{display:block;margin-bottom:4px}',
    '.fb-crisis .num{font-size:20px;font-weight:800;color:var(--fb-red);user-select:all;margin-left:6px}'
  ].join('\n');

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
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

  async function rpc(sb, name, args) {
    try { return await sb.rpc(name, args); } catch (e) { return { error: e }; }
  }

  function when(iso) {
    try {
      return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch (e) { return ''; }
  }

  function crisisBox() {
    return el('div', { class: 'fb-crisis', role: 'alert' }, [
      el('b', { text: '지금 바로 이야기할 수 있는 곳' }),
      el('p', null, ['자살예방 상담전화', el('span', { class: 'num', text: '109' }), ' 24시간 · 무료']),
      el('p', null, ['정신건강 상담전화', el('span', { class: 'num', text: '1577-0199' })]),
      el('p', { text: '위급하면 112 또는 119에 바로 연락하세요. 카페 앞 루미에게 이야기해도 괜찮아요.' })
    ]);
  }

  var uid = 0;
  function textArea(label, max, placeholder) {
    var id = 'fb-ta-' + (++uid);
    var ta = el('textarea', { id: id, maxlength: String(max), rows: '3', placeholder: placeholder || '' });
    var count = el('p', { class: 'fb-count', text: '0 / ' + max });
    ta.addEventListener('input', function () { count.textContent = ta.value.length + ' / ' + max; });
    return { ta: ta, nodes: [el('label', { for: id, text: label }), ta, count] };
  }

  // ---------------------------------------------------------------- 의견 쓰기
  function compose(opts) {
    injectStyle();
    var sb = opts.sb;
    var kind = null;
    var msg = el('p', { class: 'fb-msg', 'aria-live': 'polite' });
    var kindBtns = KINDS.map(function (k) {
      return el('button', { class: 'fb-kind', type: 'button', 'aria-pressed': 'false', 'data-kind': k.key, text: k.label, onclick: function () {
        kind = k.key;
        kindBtns.forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.kind === kind ? 'true' : 'false'); });
      } });
    });
    var area = textArea('어떤 내용인가요?', 300, '예: 지도에서 공원 가는 길이 헷갈려요');
    var send = el('button', { class: 'fb-btn', type: 'button', text: '보내기' });
    var cancel = opts.onCancel ? el('button', { class: 'fb-btn secondary', type: 'button', text: '취소', onclick: opts.onCancel }) : null;
    var root = el('div', { class: 'fb fb-form' }, [
      el('p', { class: 'fb-note', text: LINES.ask }),
      el('fieldset', { class: 'fb-kinds' }, [el('legend', { text: '종류' })].concat(kindBtns)),
    ].concat(area.nodes, [el('div', { class: 'fb-row' }, [send, cancel]), msg]));

    send.addEventListener('click', async function () {
      var text = area.ta.value.trim();
      if (!kind) { msg.textContent = '종류를 하나 골라 주세요.'; kindBtns[0].focus(); return; }
      if (!text) { msg.textContent = LINES.noBody; area.ta.focus(); return; }
      send.disabled = true;
      var r = await rpc(sb, 'submit_feedback', { p_channel: opts.channel || 'chief', p_kind: kind, p_place: opts.place || null, p_body: text, p_serv_id: null });
      var out = r.error ? 'error' : r.data;
      if (out === 'saved') {
        root.replaceChildren(el('p', { class: 'fb-msg', role: 'status', text: LINES.saved }));
      } else if (out === 'crisis') {
        root.replaceChildren(el('p', { class: 'fb-msg', text: LINES.crisis }), crisisBox());
      } else {
        msg.textContent = out === 'too_many' ? LINES.many : LINES.failed;
        send.disabled = out === 'too_many';
        if (r.error) console.warn('[feedback] 보내기 실패', r.error.message || r.error);
      }
      if (opts.onDone) opts.onDone(out);
    });
    return root;
  }

  // ---------------------------------------------------------------- 내 의견함
  function inbox(opts) {
    injectStyle();
    var sb = opts.sb;
    var root = el('div', { class: 'fb' });
    var openId = null;
    var current = [];
    function changed() { if (opts.onChange) opts.onChange(current.filter(function (x) { return x.unread; }).length); }

    async function load() {
      root.replaceChildren(el('p', { class: 'fb-note', text: '불러오는 중…' }));
      var r = await rpc(sb, 'my_feedback', {});
      if (r.error) { root.replaceChildren(el('p', { class: 'fb-msg', text: LINES.loadFail })); return; }
      render(r.data || []);
    }

    function render(rows) {
      current = rows;
      var top = el('div', { class: 'fb-row', style: 'justify-content:space-between;margin-bottom:10px' }, [
        el('p', { class: 'fb-note', text: rows.length ? '보낸 의견 ' + rows.length + '개' : LINES.empty }),
        opts.onCompose ? el('button', { class: 'fb-btn secondary', type: 'button', text: '새 의견 보내기', onclick: opts.onCompose }) : null
      ]);
      var list = el('ul', { class: 'fb-list' }, rows.map(item));
      root.replaceChildren(top, list, el('p', { class: 'fb-note', style: 'margin-top:10px', text: LINES.keep }));
      changed();
    }

    function item(f) {
      var li = el('li', { class: 'fb-item', 'data-id': String(f.id) });
      var thread = null;
      var head = el('button', { class: 'fb-head', type: 'button', 'aria-expanded': 'false', onclick: toggle }, [
        el('span', { class: 'fb-meta' }, [
          f.unread ? el('span', { class: 'fb-new', text: '새 답' }) : null,
          el('span', { class: 'fb-status', 'data-s': f.status, text: STATUS[f.status] || f.status }),
          el('span', { text: (CHANNEL[f.channel] || '') + ' · ' + (KIND_LABEL[f.kind] || f.kind) + (f.program_name ? ' · ' + f.program_name : '') }),
          el('span', { text: when(f.created_at) })
        ]),
        el('span', { class: 'fb-preview', text: f.body })
      ]);
      li.appendChild(head);

      function toggle() {
        if (thread) { thread.remove(); thread = null; head.setAttribute('aria-expanded', 'false'); openId = null; return; }
        thread = threadView(f);
        li.appendChild(thread);
        head.setAttribute('aria-expanded', 'true');
        openId = f.id;
        if (f.unread) {
          f.unread = false;
          var badge = head.querySelector('.fb-new'); if (badge) badge.remove();
          rpc(sb, 'read_my_feedback', { p_id: f.id });
          changed();
        }
      }
      if (openId === f.id) setTimeout(toggle, 0);
      return li;
    }

    function threadView(f) {
      var nodes = [el('p', { class: 'fb-bubble me' }, [el('span', { class: 'fb-who', text: '나 · ' + when(f.created_at) + (f.place ? ' · ' + f.place : '') }), f.body])];
      var courierShown = false;
      (f.messages || []).forEach(function (m) {
        if (m.who === 'staff') {
          if (!courierShown) { nodes.push(el('p', { class: 'fb-courier', text: COURIER[f.channel] || COURIER.chief })); courierShown = true; }
          nodes.push(el('p', { class: 'fb-bubble staff' }, [el('span', { class: 'fb-who', text: '운영팀 · 사람이 직접 쓴 답 · ' + when(m.at) }), m.body]));
        } else {
          nodes.push(el('p', { class: 'fb-bubble me' }, [el('span', { class: 'fb-who', text: '나 · ' + when(m.at) }), m.body]));
        }
      });
      var area = textArea('운영팀에 더 전할 말', 300, '');
      var msg = el('p', { class: 'fb-msg', 'aria-live': 'polite' });
      var send = el('button', { class: 'fb-btn', type: 'button', text: '답장 보내기' });
      var del = el('button', { class: 'fb-btn danger', type: 'button', text: '이 의견 지우기' });
      send.addEventListener('click', async function () {
        var text = area.ta.value.trim();
        if (!text) { msg.textContent = LINES.noBody; area.ta.focus(); return; }
        send.disabled = true;
        var r = await rpc(sb, 'reply_my_feedback', { p_id: f.id, p_body: text });
        var out = r.error ? 'error' : r.data;
        if (out === 'saved') { openId = f.id; load(); return; }
        if (out === 'crisis') { box.replaceChildren(el('p', { class: 'fb-msg', text: LINES.crisis }), crisisBox()); return; }
        msg.textContent = out === 'too_many' ? LINES.many : LINES.failed;
        send.disabled = out === 'too_many';
      });
      var confirmStep = false;
      del.addEventListener('click', async function () {
        if (!confirmStep) { confirmStep = true; del.textContent = '정말 지울까요? 한 번 더 누르면 지워져요'; return; }
        del.disabled = true;
        var r = await rpc(sb, 'delete_my_feedback', { p_id: f.id });
        if (r.error || r.data === false) { msg.textContent = '지우지 못했어요. 잠시 뒤 다시 해 주세요.'; del.disabled = false; return; }
        openId = null;
        load();
      });
      var box = el('div', { class: 'fb-form' }, area.nodes.concat([el('div', { class: 'fb-row' }, [send, del]), msg]));
      nodes.push(box);
      return el('div', { class: 'fb-thread' }, nodes);
    }

    load();
    root.reload = load;
    return root;
  }

  async function unread(sb) {
    var r = await rpc(sb, 'my_feedback_unread', {});
    return r.error ? 0 : (Number(r.data) || 0);
  }

  global.Feedback = { compose: compose, inbox: inbox, unread: unread, _lines: LINES };
})(window);
