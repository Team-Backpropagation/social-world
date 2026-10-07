/*
 * 하루 v1 — 지원센터 정책 안내 NPC 화면 모듈
 *
 * 쓰는 법 (socialworld-demo.html 등):
 *   <script src="haru/haru.js"></script>
 *   Haru.open({
 *     sb,                               // 이미 로그인된 supabase 클라이언트
 *     profile: { sgg_code },            // 선택 — 지원 지역(강남구·춘천시) 밖이면 "전국 정책만" 안내
 *     onClose: () => { ... },           // 창을 닫았을 때 (선택)
 *     logDemand: async (row) => {...}   // 수요 기록 방식을 바꾸고 싶을 때 (선택)
 *   })
 *
 * - 정책 고르기는 DB 함수가 한다: recommend_programs(메뉴, 개수, 특정대상) · program_counts(메뉴) — 06_haru.sql
 * - LLM을 쓰지 않는다. 자유 입력은 [정보가 달라요] 신고 한 곳뿐이고, 저장 전에 DB가 위기 검사를 한다(07).
 * - 신청은 시민이 직접 한다. 하루는 어디서 어떻게 하는지 알려 주고 복지로 링크를 새 탭으로 연다.
 *
 * 수요 기록(03 npc_demand_logs): npc_type = 일·취업 메뉴는 'job', 나머지는 'policy'. category = 메뉴 이름
 *   recommend  화면에 보인 카드마다          view          [자세히]를 열었을 때
 *   apply_click 복지로·홈페이지 링크를 열 때   self_reported [신청했어요]
 *   ineligible 나이·지역이 안 맞아 빠진 정책이 있을 때 메뉴마다 1줄(item_id = 'count:N')
 *   특정 대상 정책(장애인·저소득 등)은 펼쳤는지, 무엇을 눌렀는지 기록하지 않는다.
 * 기록이 실패해도 화면은 멈추지 않는다(콘솔 경고만).
 */
(function (global) {
  'use strict';

  var MENUS = [
    { key: 'housing', label: '주거비',      hint: '월세·전세·주거 지원' },
    { key: 'living',  label: '생활비',      hint: '생활 지원·교통비·금융' },
    { key: 'mind',    label: '마음건강',    hint: '심리 상담·마음 돌봄' },
    { key: 'social',  label: '사람 만나기', hint: '문화·여가 프로그램' },
    { key: 'job',     label: '일·취업',     hint: '취업 준비·일자리' }
  ];
  var SHOW = 3;          // 처음 보이는 카드 수
  var MAX = 6;           // 더 보기까지 합친 최대 수
  var REGIONS = { '11680': '강남구', '51110': '춘천시' };

  var LINES = {
    hello:      '안녕하세요, 지원센터 하루예요. 어떤 지원이 궁금하세요? 사는 곳과 나이대에 맞는 정책을 찾아 드릴게요.',
    otherRegion:'지금은 강남구·춘천시 사업만 모아 두어서, 그 밖의 지역은 전국 정책만 보여 드릴 수 있어요.',
    loading:    '잠깐만요, 찾아보는 중이에요…',
    result:     function (label) { return label + ' 관련해서 받을 수 있을 만한 정책이에요. 신청은 직접 하셔야 하고, 어디서 어떻게 하는지 알려 드릴게요.'; },
    empty:      '지금은 딱 맞는 정책을 못 찾았어요. 보건복지상담센터(129)에 물어보시면 더 자세히 알려 줄 거예요.',
    special:    '특정 대상 정책이에요. 해당되는지는 각 정책의 대상·선정 기준을 확인해 주세요.',
    needProfile:'처음 설문을 마치면 사는 곳과 나이대에 맞춰 찾아 드릴 수 있어요.',
    needLogin:  '먼저 마을에 들어오셔야 찾아 드릴 수 있어요.',
    failed:     '지금은 목록을 못 불러왔어요. 조금 뒤에 다시 물어봐 주세요.',
    opened:     '신청은 새 창에서 직접 해 주세요. 마치면 "신청했어요"를 눌러 주세요.',
    applied:    '잘하셨어요! 결과가 나오기까지 시간이 걸릴 수 있어요.',
    reportAsk:  '어떤 점이 다른지 알려 주시면 운영팀이 확인할게요.',
    reportSaved:'고마워요, 운영팀에 전했어요. 답이 오면 휴대폰 "내 의견함"에서 볼 수 있어요.',
    reportMany: '오늘은 의견을 많이 보내 주셨어요. 내일 다시 보내 주세요.',
    reportCrisis:'많이 힘드신 것 같아요. 지금 바로 이야기할 수 있는 곳을 알려 드릴게요.',
    reportFail: '지금은 의견을 받을 수 없어요. 조금 뒤에 다시 보내 주세요.'
  };

  var STYLE_ID = 'haru-style';
  var CSS = [
    '.haru-backdrop{position:fixed;inset:0;background:rgba(18,34,36,.40);display:flex;align-items:flex-end;justify-content:center;z-index:9000}',
    '@media (min-width:600px){.haru-backdrop{align-items:center}}',
    '.haru-panel{--h-teal:#22706B;--h-teal-soft:#E1F1EF;--h-sun:#F2B544;--h-sun-soft:#FDF2DA;--h-warn:#9A5B12;--h-warn-soft:#FBEBD3;--h-ink:#1D2A2A;--h-muted:#56676A;--h-line:#D3E2E0;--h-red:#C0392B;',
    '  width:100%;max-width:460px;max-height:90vh;overflow:auto;background:#FAFCFC;color:var(--h-ink);border-radius:18px 18px 0 0;padding:20px 18px 22px;font:inherit;line-height:1.55;box-sizing:border-box}',
    '@media (min-width:600px){.haru-panel{border-radius:18px}}',
    '.haru-head{display:flex;gap:12px;align-items:flex-start}',
    '.haru-face{flex:0 0 48px;height:48px;border-radius:50%;background:var(--h-teal);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:15px}',
    '.haru-bubble{position:relative;background:var(--h-teal-soft);border-radius:14px;padding:10px 14px;font-size:15px;flex:1;min-width:0}',
    '.haru-bubble:before{content:"";position:absolute;left:-7px;top:16px;border:7px solid transparent;border-right-color:var(--h-teal-soft);border-left:0}',
    '.haru-name{font-size:13px;color:var(--h-muted);margin:0 0 2px}',
    '.haru-close{margin-left:auto;background:none;border:0;font-size:22px;line-height:1;color:var(--h-muted);cursor:pointer;padding:4px 6px;border-radius:8px}',
    '.haru-note{font-size:13px;color:var(--h-muted);margin:10px 0 0;padding:8px 10px;background:#fff;border:1px dashed var(--h-line);border-radius:10px}',
    '.haru-menus{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px}',
    '.haru-menu{font:inherit;text-align:left;padding:11px 12px;border-radius:12px;border:1.5px solid var(--h-line);background:#fff;color:var(--h-ink);cursor:pointer;min-width:0}',
    '.haru-menu strong{display:block;font-size:15px}',
    '.haru-menu small{display:block;font-size:12px;color:var(--h-muted)}',
    '.haru-menu:hover,.haru-btn:hover{border-color:var(--h-teal)}',
    '.haru-menu:last-child:nth-child(odd){grid-column:1 / -1}',
    '.haru-btn{font:inherit;font-size:14px;text-align:center;padding:10px 12px;border-radius:12px;border:1.5px solid var(--h-line);background:#fff;color:var(--h-ink);cursor:pointer}',
    '.haru-panel button:focus-visible,.haru-panel a:focus-visible,.haru-panel textarea:focus-visible{outline:3px solid var(--h-sun);outline-offset:2px}',
    '.haru-list{list-style:none;margin:16px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}',
    '.haru-item{border:1px solid var(--h-line);border-left:6px solid var(--h-teal);border-radius:4px 12px 12px 4px;background:#fff;padding:12px 14px;min-width:0}',
    '.haru-item[data-scope="local"]{border-left-color:var(--h-sun)}',
    '.haru-item[data-special="1"]{border-left-color:#8A7BB8}',
    '.haru-tags{display:flex;flex-wrap:wrap;gap:6px;margin:0}',
    '.haru-tag{font-size:12px;padding:1px 8px;border-radius:999px;background:var(--h-teal-soft);color:var(--h-teal)}',
    '.haru-tag.local{background:var(--h-sun-soft);color:#7A5410}',
    '.haru-tag.special{background:#EEEAF7;color:#4F4380}',
    '.haru-title{font-size:16px;font-weight:600;margin:6px 0 2px;overflow-wrap:anywhere}',
    '.haru-org{font-size:12px;color:var(--h-muted);margin:0}',
    '.haru-summary{font-size:14px;margin:6px 0 0;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
    '.haru-reason{font-size:13px;margin:8px 0 0;padding:6px 10px;background:var(--h-teal-soft);border-radius:8px}',
    '.haru-age{font-size:13px;margin:6px 0 0;padding:6px 10px;background:var(--h-warn-soft);color:var(--h-warn);border-radius:8px}',
    '.haru-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}',
    '.haru-act{font:inherit;font-size:14px;padding:8px 12px;border-radius:10px;border:0;background:var(--h-teal);color:#fff;cursor:pointer}',
    '.haru-act.secondary{background:#fff;color:var(--h-teal);border:1.5px solid var(--h-teal)}',
    '.haru-act[disabled]{background:var(--h-line);color:var(--h-muted);cursor:default;border-color:transparent}',
    '.haru-link{font:inherit;font-size:13px;background:none;border:0;padding:4px 2px;color:var(--h-muted);text-decoration:underline;cursor:pointer;margin-left:auto}',
    '.haru-detail{margin:10px 0 0;padding:10px 12px;background:#F4F8F8;border-radius:10px;font-size:14px}',
    '.haru-detail dt{font-weight:600;font-size:13px;color:var(--h-teal);margin-top:8px}',
    '.haru-detail dt:first-child{margin-top:0}',
    '.haru-detail dd{margin:2px 0 0;white-space:pre-line;overflow-wrap:anywhere}',
    '.haru-detail a{color:var(--h-teal)}',
    '.haru-checked{font-size:12px;color:var(--h-muted);margin:10px 0 0}',
    '.haru-more{width:100%;margin-top:10px}',
    '.haru-extra{margin-top:14px;display:flex;flex-direction:column;gap:6px}',
    '.haru-special-btn{text-align:left}',
    '.haru-muted{font-size:13px;color:var(--h-muted);margin:0}',
    '.haru-report{margin-top:10px;padding:10px 12px;border:1.5px solid var(--h-line);border-radius:10px;background:#fff}',
    '.haru-report label{display:block;font-size:13px;color:var(--h-muted);margin-bottom:6px}',
    '.haru-report textarea{width:100%;box-sizing:border-box;font:inherit;font-size:14px;padding:8px 10px;border:1px solid var(--h-line);border-radius:8px;resize:vertical;min-height:72px}',
    '.haru-count{font-size:12px;color:var(--h-muted);text-align:right;margin:2px 0 6px}',
    '.haru-report-msg{font-size:13px;margin:8px 0 0}',
    '.haru-crisis{margin:10px 0 0;padding:12px 14px;border:3px solid #d64545;border-radius:12px;background:#fff5f5;color:#3a1515}',
    '.haru-crisis b{display:block;margin-bottom:4px}',
    '.haru-crisis p{margin:4px 0}',
    '.haru-crisis .num{font-size:20px;font-weight:800;color:var(--h-red);user-select:all;margin-left:6px}',
    '.haru-foot{display:flex;gap:8px;margin-top:16px}',
    '.haru-foot .haru-btn{flex:1}',
    '@media (prefers-reduced-motion:no-preference){.haru-panel{animation:haru-up .18s ease-out}@keyframes haru-up{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}}'
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

  function menuOf(key) { return MENUS.filter(function (m) { return m.key === key; })[0]; }

  // 수요 기록 기본값 — 03_world_update.sql의 npc_demand_logs 칸 이름 기준
  async function defaultLogDemand(sb, row) {
    try {
      var res = await sb.from('npc_demand_logs').insert({
        npc_type: row.menu === 'job' ? 'job' : 'policy',
        action: row.action,
        category: menuOf(row.menu).label,
        item_id: row.itemId || null
      });
      if (res && res.error) console.warn('[haru] 수요 기록 실패', res.error.message);
    } catch (e) {
      console.warn('[haru] 수요 기록 실패', e);
    }
  }

  function errorLine(err) {
    var msg = (err && (err.message || err.details)) || '';
    if (msg.indexOf('profile_required') >= 0) return LINES.needProfile;
    if (msg.indexOf('login_required') >= 0) return LINES.needLogin;
    return LINES.failed;
  }

  // 문의처 글에서 전화번호를 찾아 바로 걸기 링크로 만든다
  var PHONE = /(0\d{1,2}-\d{3,4}-\d{4}|1\d{3}-\d{4}|\b1\d{2}\b)/;
  function contactNode(text) {
    var m = text && text.match(PHONE);
    if (!m) return document.createTextNode(text || '');
    var i = text.indexOf(m[0]);
    return el('span', null, [text.slice(0, i), el('a', { href: 'tel:' + m[0].replace(/-/g, ''), text: m[0] }), text.slice(i + m[0].length)]);
  }

  function safeUrl(u) {
    return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null;
  }

  function crisisBox() {
    return el('div', { class: 'haru-crisis', role: 'alert' }, [
      el('b', { text: '지금 바로 이야기할 수 있는 곳' }),
      el('p', null, ['자살예방 상담전화', el('span', { class: 'num', text: '109' }), ' 24시간 · 무료']),
      el('p', null, ['정신건강 상담전화', el('span', { class: 'num', text: '1577-0199' })]),
      el('p', { text: '위급하면 112 또는 119에 바로 연락하세요. 카페 앞 루미에게 이야기해도 괜찮아요.' })
    ]);
  }

  function open(opts) {
    opts = opts || {};
    var sb = opts.sb;
    if (!sb) throw new Error('Haru.open: sb(supabase 클라이언트)가 필요합니다');
    var log = opts.logDemand || function (row) { return defaultLogDemand(sb, row); };
    var sgg = opts.profile && opts.profile.sgg_code;
    injectStyle();

    var lastFocus = document.activeElement;
    var bubbleText = el('p', { style: 'margin:0', 'aria-live': 'polite' });
    var body = el('div');
    var closeBtn = el('button', { class: 'haru-close', type: 'button', 'aria-label': '하루와 대화 닫기', text: '×', onclick: close });
    var panel = el('div', { class: 'haru-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'haru-dialog-name' }, [
      el('div', { class: 'haru-head' }, [
        el('div', { class: 'haru-face', 'aria-hidden': 'true', text: '하루' }),
        el('div', { class: 'haru-bubble' }, [
          el('p', { class: 'haru-name', id: 'haru-dialog-name', text: '하루 · 지원센터 정책 안내' }),
          bubbleText
        ]),
        closeBtn
      ]),
      body
    ]);
    var backdrop = el('div', { class: 'haru-backdrop', onclick: function (e) { if (e.target === backdrop) close(); } }, [panel]);
    var closed = false;

    function focusables() { return panel.querySelectorAll('button:not([disabled]), a[href], textarea'); }
    function onKey(e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables();
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      if (opts.onClose) opts.onClose();
    }

    function say(text) { bubbleText.textContent = text; }
    function setBody(nodes, focusSel) {
      body.innerHTML = '';
      nodes.forEach(function (n) { if (n) body.appendChild(n); });
      var first = body.querySelector(focusSel || 'button:not([disabled])');
      if (first) first.focus();
      panel.scrollTop = 0;
    }

    function showMenus() {
      say(LINES.hello);
      var nodes = [el('div', { class: 'haru-menus', role: 'group', 'aria-label': '궁금한 지원 고르기' }, MENUS.map(function (m) {
        return el('button', { class: 'haru-menu', type: 'button', 'data-menu': m.key, onclick: function () { load(m.key); } },
          [el('strong', { text: m.label }), el('small', { text: m.hint })]);
      }))];
      if (sgg && !REGIONS[sgg]) nodes.push(el('p', { class: 'haru-note', text: LINES.otherRegion }));
      setBody(nodes);
    }

    function footer() {
      return el('div', { class: 'haru-foot' }, [
        el('button', { class: 'haru-btn', type: 'button', text: '다른 지원 보기', onclick: showMenus }),
        el('button', { class: 'haru-btn', type: 'button', text: '대화 마치기', onclick: close })
      ]);
    }

    async function rpc(name, args) {
      try { return await sb.rpc(name, args); } catch (e) { return { error: e }; }
    }

    async function load(menu) {
      var m = menuOf(menu);
      say(LINES.loading);
      setBody([]);
      var both = await Promise.all([
        rpc('recommend_programs', { p_menu: menu, p_limit: MAX, p_special: false }),
        rpc('program_counts', { p_menu: menu })
      ]);
      if (closed) return;
      var res = both[0], cnt = both[1];
      if (res.error) { say(errorLine(res.error)); setBody([footer()]); return; }
      var items = res.data || [];
      var counts = (!cnt.error && cnt.data && cnt.data[0]) || { eligible: items.length, special: 0, ineligible: 0 };

      if (counts.ineligible > 0) log({ menu: menu, action: 'ineligible', itemId: 'count:' + counts.ineligible });

      var nodes = [];
      var list = el('ul', { class: 'haru-list', 'aria-label': m.label + ' 정책' });
      if (items.length) {
        say(LINES.result(m.label));
        items.slice(0, SHOW).forEach(function (it) { list.appendChild(card(it, menu, false)); log({ menu: menu, action: 'recommend', itemId: it.serv_id }); });
        nodes.push(list);
        if (items.length > SHOW) {
          var rest = items.slice(SHOW);
          var more = el('button', { class: 'haru-btn haru-more', type: 'button', text: '더 보기 (' + rest.length + '개)', onclick: function () {
            rest.forEach(function (it) { list.appendChild(card(it, menu, false)); log({ menu: menu, action: 'recommend', itemId: it.serv_id }); });
            more.remove();
            var next = list.children[SHOW] && list.children[SHOW].querySelector('button');
            if (next) next.focus();
          } });
          nodes.push(more);
        }
      } else {
        say(LINES.empty);
      }
      nodes.push(extras(menu, counts));
      nodes.push(footer());
      setBody(nodes);
    }

    // 특정 대상 정책(접힘)과 '조건이 안 맞아 뺀 수'
    function extras(menu, counts) {
      var box = el('div', { class: 'haru-extra' });
      if (counts.special > 0) {
        var holder = el('div');
        var btn = el('button', { class: 'haru-btn haru-special-btn', type: 'button', 'aria-expanded': 'false',
          text: '▸ 특정 대상 정책 ' + counts.special + '개 보기 (장애인·저소득 등)',
          onclick: async function () {
            if (btn.getAttribute('aria-expanded') === 'true') {
              holder.innerHTML = ''; btn.setAttribute('aria-expanded', 'false');
              btn.textContent = '▸ 특정 대상 정책 ' + counts.special + '개 보기 (장애인·저소득 등)';
              return;
            }
            btn.disabled = true;
            var r = await rpc('recommend_programs', { p_menu: menu, p_limit: 10, p_special: true });   // 기록하지 않는다
            btn.disabled = false;
            if (closed) return;
            holder.innerHTML = '';
            if (r.error) { holder.appendChild(el('p', { class: 'haru-muted', text: LINES.failed })); return; }
            holder.appendChild(el('p', { class: 'haru-muted', text: LINES.special }));
            var ul = el('ul', { class: 'haru-list' });
            (r.data || []).forEach(function (it) { ul.appendChild(card(it, menu, true)); });
            holder.appendChild(ul);
            btn.setAttribute('aria-expanded', 'true');
            btn.textContent = '▾ 특정 대상 정책 접기';
          } });
        box.appendChild(btn);
        box.appendChild(holder);
      }
      if (counts.ineligible > 0) {
        box.appendChild(el('p', { class: 'haru-muted', text: '나이·지역 조건이 맞지 않아 뺀 정책이 ' + counts.ineligible + '개 있어요.' }));
      }
      return box.childNodes.length ? box : null;
    }

    // special=true면 기록하지 않고, 신고 버튼도 두지 않는다(무엇을 펼쳤는지 남지 않게)
    function card(it, menu, special) {
      var track = special ? function () {} : function (action) { log({ menu: menu, action: action, itemId: it.serv_id }); };
      var tags = el('p', { class: 'haru-tags' }, [
        el('span', { class: 'haru-tag' + (it.is_local ? ' local' : ''), text: it.is_local ? ((it.region_label || '').split(' ').pop() || '우리 동네') : '전국' }),
        it.online_apply ? el('span', { class: 'haru-tag', text: '온라인 신청' }) : null,
        special && it.target_groups && it.target_groups.length ? el('span', { class: 'haru-tag special', text: '대상: ' + it.target_groups.join(' · ') }) : null
      ]);
      var detail = null;
      var actions = el('div', { class: 'haru-actions' });
      var detailBtn = el('button', { class: 'haru-act secondary', type: 'button', text: '자세히', 'aria-expanded': 'false', onclick: function () {
        if (detail) { detail.remove(); detail = null; detailBtn.setAttribute('aria-expanded', 'false'); detailBtn.textContent = '자세히'; return; }
        detail = detailBox(it);
        li.insertBefore(detail, actions);
        detailBtn.setAttribute('aria-expanded', 'true');
        detailBtn.textContent = '접기';
        track('view');
      } });
      actions.appendChild(detailBtn);

      var url = safeUrl(it.detail_url) || safeUrl(it.homepage);
      var doneBtn = null;
      if (url) {
        actions.appendChild(el('button', { class: 'haru-act', type: 'button', text: '복지로에서 보기', onclick: function () {
          track('apply_click');
          window.open(url, '_blank', 'noopener,noreferrer');
          if (doneBtn) doneBtn.disabled = false;
          say(LINES.opened);
        } }));
        if (!special) {
          doneBtn = el('button', { class: 'haru-act secondary', type: 'button', text: '신청했어요', disabled: true, onclick: function () {
            track('self_reported');
            doneBtn.textContent = '신청했다고 기록했어요';
            doneBtn.disabled = true;
            say(LINES.applied);
          } });
          actions.appendChild(doneBtn);
        }
      }
      if (!special) {
        actions.appendChild(el('button', { class: 'haru-link', type: 'button', text: '정보가 달라요', onclick: function () { reportForm(it, li, actions); } }));
      }

      var li = el('li', { class: 'haru-item', 'data-scope': it.is_local ? 'local' : 'central', 'data-special': special ? '1' : null, 'data-id': it.serv_id }, [
        tags,
        el('p', { class: 'haru-title', text: it.name }),
        it.org ? el('p', { class: 'haru-org', text: it.org }) : null,
        it.summary ? el('p', { class: 'haru-summary', text: it.summary }) : null,
        it.reason ? el('p', { class: 'haru-reason', text: '하루: ' + it.reason }) : null,
        it.age_note ? el('p', { class: 'haru-age', text: '⚠ 나이 조건 확인 — 대상 나이를 복지로에서 꼭 확인해 주세요.' }) : null,
        actions
      ]);
      return li;
    }

    function detailBox(it) {
      var rows = [['지원 대상', it.target_text], ['선정 기준', it.criteria_text], ['지원 내용', it.benefit_text], ['신청 방법', it.apply_text]];
      var dl = el('dl', { style: 'margin:0' });
      rows.forEach(function (r) {
        if (!r[1]) return;
        dl.appendChild(el('dt', { text: r[0] }));
        dl.appendChild(el('dd', { text: r[1] }));
      });
      if (it.contact) { dl.appendChild(el('dt', { text: '문의' })); dl.appendChild(el('dd', null, [contactNode(it.contact)])); }
      var hp = safeUrl(it.homepage);
      if (hp) { dl.appendChild(el('dt', { text: '홈페이지' })); dl.appendChild(el('dd', null, [el('a', { href: hp, target: '_blank', rel: 'noopener noreferrer', text: hp })])); }
      if (!dl.childNodes.length) dl.appendChild(el('dd', { text: '자세한 내용은 복지로에서 확인해 주세요.' }));
      return el('div', { class: 'haru-detail' }, [
        dl,
        el('p', { class: 'haru-checked', text: (it.last_checked ? '복지로 기준 ' + it.last_checked + ' 확인 · ' : '') + '최종 자격은 복지로나 담당 기관에서 확인해 주세요.' })
      ]);
    }

    // [정보가 달라요] — 07의 submit_feedback(channel 'haru', kind 'info', 정책 id)
    function reportForm(it, li, actions) {
      var old = li.querySelector('.haru-report');
      if (old) { old.remove(); return; }
      var id = 'haru-report-' + it.serv_id;
      var ta = el('textarea', { id: id, maxlength: '300', rows: '3', placeholder: '예: 신청 기간이 끝났어요 / 링크가 안 열려요' });
      var count = el('p', { class: 'haru-count', text: '0 / 300' });
      var msg = el('div', { class: 'haru-report-msg', 'aria-live': 'polite' });
      var send = el('button', { class: 'haru-act', type: 'button', text: '보내기' });
      var cancel = el('button', { class: 'haru-act secondary', type: 'button', text: '취소', onclick: function () { box.remove(); } });
      ta.addEventListener('input', function () { count.textContent = ta.value.length + ' / 300'; });
      send.addEventListener('click', async function () {
        var text = ta.value.trim();
        if (!text) { msg.textContent = '어떤 점이 다른지 한 줄만 적어 주세요.'; ta.focus(); return; }
        send.disabled = true;
        var r = await rpc('submit_feedback', { p_channel: 'haru', p_kind: 'info', p_place: '지원센터', p_body: text, p_serv_id: it.serv_id });
        if (closed) return;
        var out = r.error ? 'error' : r.data;
        msg.innerHTML = '';
        if (out === 'saved') {
          box.replaceChildren(el('p', { class: 'haru-report-msg', text: LINES.reportSaved }));
          say(LINES.reportSaved);
        } else if (out === 'crisis') {
          box.replaceChildren(el('p', { class: 'haru-report-msg', text: LINES.reportCrisis }), crisisBox());
          say(LINES.reportCrisis);
        } else {
          msg.textContent = out === 'too_many' ? LINES.reportMany : LINES.reportFail;
          send.disabled = out === 'too_many';
        }
      });
      var box = el('div', { class: 'haru-report' }, [
        el('label', { for: id, text: LINES.reportAsk }),
        ta, count,
        el('div', { class: 'haru-actions' }, [send, cancel]),
        msg
      ]);
      li.appendChild(box);
      ta.focus();
    }

    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    showMenus();
    return { close: close };
  }

  global.Haru = { open: open, _lines: LINES, _menus: MENUS };
})(window);
