/*
 * 코코 v1 — 활동 추천 NPC 화면 모듈
 *
 * 쓰는 법 (socialworld-demo.html 등):
 *   <script src="coco/coco.js"></script>
 *   Coco.open({
 *     sb,                              // 이미 로그인된 supabase 클라이언트
 *     onOpenClub: (clubId) => { ... }, // "동아리 보러 가기"를 눌렀을 때 (동아리센터 화면 열기)
 *     onClose: () => { ... },          // 창을 닫았을 때 (선택)
 *     logDemand: async (row) => {...}  // 수요 기록 방식을 바꾸고 싶을 때 (선택, 아래 참고)
 *   })
 *
 * - 추천 계산은 DB 함수 recommend_activities()가 한다. 여기서는 모드와 개수만 보낸다.
 * - LLM을 쓰지 않는다. 자유 입력창이 없다(위기 발화가 들어올 통로가 없음).
 * - 월드 밖 활동은 게임이 대신 신청하지 않는다. 링크를 새 탭으로 열고, 유저가 "신청했어요"로 알린다.
 *
 * 수요 기록은 03_world_update.sql의 npc_demand_logs(npc_type, category, item_id, action)에 남긴다.
 * 기록이 실패해도 화면은 멈추지 않는다(콘솔 경고만).
 */
(function (global) {
  'use strict';

  var MODES = [
    { key: 'interest', label: '내 관심사로 찾아줘' },
    { key: 'today',    label: '오늘 해볼 만한 거 있어?' },
    { key: 'nearby',   label: '우리 동네 모임 알려줘' }
  ];

  var LINES = {
    hello:     '안녕! 나는 코코야. 같이 해볼 만한 모임이나 활동을 찾아줄게.',
    loading:   '잠깐만, 찾아보는 중이야…',
    result: {
      interest: '네 관심사에 맞춰 골라봤어.',
      today:    '오늘 해볼 만한 걸 골라봤어.',
      nearby:   '우리 동네에서 열리는 모임이야.'
    },
    empty:     '지금 딱 맞는 게 없네. 다른 방법으로 찾아볼까?',
    needProfile: '처음 설문을 마치면 네 관심사에 맞춰 추천해 줄 수 있어.',
    needLogin: '먼저 마을에 들어와야 추천해 줄 수 있어.',
    failed:    '지금은 목록을 못 불러왔어. 조금 뒤에 다시 물어봐 줘.',
    applied:   '멋지다! 퀘스트에 기록해 둘게.',
    opened:    '신청은 새 창에서 직접 해줘. 마치면 "신청했어요"를 눌러 줘.'
  };

  var STYLE_ID = 'coco-style';
  var CSS = [
    '.coco-backdrop{position:fixed;inset:0;background:rgba(20,32,26,.38);display:flex;align-items:flex-end;justify-content:center;z-index:9000}',
    '@media (min-width:600px){.coco-backdrop{align-items:center}}',
    '.coco-panel{--coco-leaf:#2E6B4F;--coco-leaf-soft:#E3F0E8;--coco-sun:#F4B942;--coco-sun-soft:#FDF1D6;--coco-sky:#3E7CB1;--coco-sky-soft:#E4EEF7;--coco-ink:#1F2A24;--coco-muted:#5C6B63;--coco-line:#D6E1DA;',
    '  width:100%;max-width:440px;max-height:88vh;overflow:auto;background:#FBFCFB;color:var(--coco-ink);border-radius:18px 18px 0 0;padding:20px 18px 22px;font:inherit;line-height:1.55;box-sizing:border-box}',
    '@media (min-width:600px){.coco-panel{border-radius:18px}}',
    '.coco-head{display:flex;gap:12px;align-items:flex-start}',
    '.coco-face{flex:0 0 48px;height:48px;border-radius:50%;background:var(--coco-leaf);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:15px}',
    '.coco-bubble{position:relative;background:var(--coco-leaf-soft);border-radius:14px;padding:10px 14px;font-size:15px;flex:1}',
    '.coco-bubble:before{content:"";position:absolute;left:-7px;top:16px;border:7px solid transparent;border-right-color:var(--coco-leaf-soft);border-left:0}',
    '.coco-name{font-size:13px;color:var(--coco-muted);margin:0 0 2px}',
    '.coco-close{margin-left:auto;background:none;border:0;font-size:22px;line-height:1;color:var(--coco-muted);cursor:pointer;padding:4px 6px;border-radius:8px}',
    '.coco-choices{display:flex;flex-direction:column;gap:8px;margin-top:16px}',
    '.coco-btn{font:inherit;font-size:15px;text-align:left;padding:12px 14px;border-radius:12px;border:1.5px solid var(--coco-line);background:#fff;color:var(--coco-ink);cursor:pointer}',
    '.coco-btn:hover{border-color:var(--coco-leaf)}',
    '.coco-btn:focus-visible,.coco-close:focus-visible,.coco-act:focus-visible{outline:3px solid var(--coco-sun);outline-offset:2px}',
    '.coco-list{list-style:none;margin:16px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}',
    '.coco-item{border:1px solid var(--coco-line);border-left:6px solid var(--coco-leaf);border-radius:4px 12px 12px 4px;background:#fff;padding:12px 14px}',
    '.coco-item[data-where="town"]{border-left-color:var(--coco-sun)}',
    '.coco-item[data-where="online"]{border-left-color:var(--coco-sky)}',
    '.coco-where{font-size:12px;color:var(--coco-muted);margin:0}',
    '.coco-title{font-size:16px;font-weight:600;margin:2px 0 4px}',
    '.coco-summary{font-size:14px;margin:0;color:var(--coco-ink)}',
    '.coco-when{font-size:13px;color:var(--coco-muted);margin:6px 0 0}',
    '.coco-reason{font-size:13px;margin:8px 0 0;padding:6px 10px;background:var(--coco-sun-soft);border-radius:8px}',
    '.coco-demo{font-size:12px;color:var(--coco-muted);margin:6px 0 0}',
    '.coco-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}',
    '.coco-act{font:inherit;font-size:14px;padding:8px 12px;border-radius:10px;border:0;background:var(--coco-leaf);color:#fff;cursor:pointer}',
    '.coco-act.secondary{background:#fff;color:var(--coco-leaf);border:1.5px solid var(--coco-leaf)}',
    '.coco-act[disabled]{background:var(--coco-line);color:var(--coco-muted);cursor:default;border-color:transparent}',
    '.coco-foot{display:flex;gap:8px;margin-top:16px}',
    '.coco-foot .coco-btn{flex:1;text-align:center;font-size:14px;padding:10px}',
    '.coco-status{min-height:1px}',
    '@media (prefers-reduced-motion:no-preference){.coco-panel{animation:coco-up .18s ease-out}@keyframes coco-up{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}}'
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
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  // 수요 기록 기본값 — 03_world_update.sql의 npc_demand_logs 칸 이름 기준
  async function defaultLogDemand(sb, row) {
    try {
      var res = await sb.from('npc_demand_logs').insert({
        npc_type: 'coco',
        action: row.action,        // recommend | apply_click | self_reported
        category: row.category,    // 관심사 태그 또는 'club'/'activity'
        item_id: row.itemKey       // 'club:12' / 'activity:5'
      });
      if (res && res.error) console.warn('[coco] 수요 기록 실패', res.error.message);
    } catch (e) {
      console.warn('[coco] 수요 기록 실패', e);
    }
  }

  function errorLine(err) {
    var msg = (err && (err.message || err.details)) || '';
    if (msg.indexOf('profile_required') >= 0) return LINES.needProfile;
    if (msg.indexOf('login_required') >= 0) return LINES.needLogin;
    return LINES.failed;
  }

  function whereOf(item) {
    if (item.kind === 'club') return { key: 'club', label: '월드 동아리' };
    if (item.is_online) return { key: 'online', label: '온라인' };
    return { key: 'town', label: '우리 동네' };
  }

  function open(opts) {
    opts = opts || {};
    var sb = opts.sb;
    if (!sb) throw new Error('Coco.open: sb(supabase 클라이언트)가 필요합니다');
    var log = opts.logDemand || function (row) { return defaultLogDemand(sb, row); };
    injectStyle();

    var lastFocus = document.activeElement;
    var bubbleText = el('p', { style: 'margin:0', 'aria-live': 'polite' });
    var body = el('div', { class: 'coco-status' });
    var closeBtn = el('button', { class: 'coco-close', type: 'button', 'aria-label': '코코와 대화 닫기', text: '×', onclick: close });
    var panel = el('div', { class: 'coco-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'coco-dialog-name' }, [
      el('div', { class: 'coco-head' }, [
        el('div', { class: 'coco-face', 'aria-hidden': 'true', text: '코코' }),
        el('div', { class: 'coco-bubble' }, [
          el('p', { class: 'coco-name', id: 'coco-dialog-name', text: '코코 · 활동 추천' }),
          bubbleText
        ]),
        closeBtn
      ]),
      body
    ]);
    var backdrop = el('div', { class: 'coco-backdrop', onclick: function (e) { if (e.target === backdrop) close(); } }, [panel]);

    function onKey(e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      var f = panel.querySelectorAll('button:not([disabled])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    function close() {
      document.removeEventListener('keydown', onKey, true);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      if (opts.onClose) opts.onClose();
    }

    function say(text) { bubbleText.textContent = text; }
    function setBody(nodes) {
      body.innerHTML = '';
      nodes.forEach(function (n) { body.appendChild(n); });
      var first = body.querySelector('button:not([disabled])');
      if (first) first.focus();
    }

    function showChoices() {
      say(LINES.hello);
      setBody([el('div', { class: 'coco-choices' }, MODES.map(function (m) {
        return el('button', { class: 'coco-btn', type: 'button', text: m.label, onclick: function () { load(m.key); } });
      }))]);
    }

    function footer(mode) {
      var nodes = [el('button', { class: 'coco-btn', type: 'button', text: '다른 방법으로 찾기', onclick: showChoices })];
      if (mode) nodes.push(el('button', { class: 'coco-btn', type: 'button', text: '다시 찾아보기', onclick: function () { load(mode); } }));
      return el('div', { class: 'coco-foot' }, nodes);
    }

    async function load(mode) {
      say(LINES.loading);
      setBody([]);
      var res;
      try {
        res = await sb.rpc('recommend_activities', { p_mode: mode, p_limit: 3 });
      } catch (e) {
        res = { error: e };
      }
      if (res.error) {
        say(errorLine(res.error));
        setBody([footer(mode)]);
        return;
      }
      var items = res.data || [];
      if (!items.length) {
        say(LINES.empty);
        setBody([footer(null)]);
        return;
      }
      say(LINES.result[mode]);
      setBody([el('ul', { class: 'coco-list' }, items.map(card)), footer(null)]);
      items.forEach(function (it) { log({ action: 'recommend', itemKey: it.item_key, category: it.kind }); });
    }

    function card(item) {
      var w = whereOf(item);
      var actions = el('div', { class: 'coco-actions' });

      if (item.kind === 'club') {
        var clubId = Number(String(item.item_key).split(':')[1]);
        actions.appendChild(el('button', {
          class: 'coco-act', type: 'button', text: '동아리 보러 가기',
          onclick: function () {
            log({ action: 'apply_click', itemKey: item.item_key, category: 'club' });
            close();
            if (opts.onOpenClub) opts.onOpenClub(clubId);
          }
        }));
      } else if (item.apply_url) {
        var doneBtn = el('button', {
          class: 'coco-act secondary', type: 'button', text: '신청했어요', disabled: true,
          onclick: function () {
            log({ action: 'self_reported', itemKey: item.item_key, category: 'activity' });
            doneBtn.textContent = '신청 완료로 기록했어요';
            doneBtn.disabled = true;
            say(LINES.applied);
          }
        });
        actions.appendChild(el('button', {
          class: 'coco-act', type: 'button', text: '신청 페이지 열기',
          onclick: function () {
            log({ action: 'apply_click', itemKey: item.item_key, category: 'activity' });
            window.open(item.apply_url, '_blank', 'noopener,noreferrer');
            doneBtn.disabled = false;
            say(LINES.opened);
          }
        }));
        actions.appendChild(doneBtn);
      }

      var place = item.place_label === w.label ? null : item.place_label; // '온라인, 온라인' 중복 방지
      var when = [place, item.time_label].filter(Boolean).join(', ');
      return el('li', { class: 'coco-item', 'data-where': w.key }, [
        el('p', { class: 'coco-where', text: w.label }),
        el('p', { class: 'coco-title', text: item.title }),
        item.summary ? el('p', { class: 'coco-summary', text: item.summary }) : null,
        when ? el('p', { class: 'coco-when', text: when }) : null,
        el('p', { class: 'coco-reason', text: '코코: ' + item.reason }),
        item.is_demo ? el('p', { class: 'coco-demo', text: '시연용 예시 활동이라 신청 링크가 없어요.' }) : null,
        actions.childNodes.length ? actions : null
      ]);
    }

    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    showChoices();
    return { close: close };
  }

  global.Coco = { open: open, _lines: LINES };
})(window);
