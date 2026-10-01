/*
 * 마을이장 v1 — 광장 이벤트 안내 화면 모듈
 *
 * 쓰는 법 (socialworld-demo.html 등):
 *   <script src="chief/chief.js"></script>
 *   Chief.open({
 *     sb,                         // 이미 로그인된 supabase 클라이언트
 *     nickname: "지수",           // 인사에 쓸 이름 (선택)
 *     onClose: () => { ... }      // 창을 닫았을 때 (선택) — 데모는 여기서 튜토리얼 첫 퀘스트를 완료한다
 *   })
 *
 * - 이벤트는 risk_agent/chief.py가 규칙으로 정하고, 담당자가 승인한 것(published)만 world_events_public 뷰로 보인다.
 * - 뷰에는 "왜 이 이벤트가 열렸는지"(대상 코호트·근거)가 없다. 내 코호트 대상(featured)은 위로 정렬만 한다.
 * - 참여는 join_world_event(id) 함수로만 한다(초안·종료 이벤트 참여 차단은 DB가 한다).
 * - LLM·자유 입력 없음. 대사는 템플릿(v2에서 LLM 대사로 바꿀 자리: LINES).
 * - 03·05 적용 전이거나 이벤트가 없으면 인사와 안내만 하고 멈추지 않는다.
 */
(function (global) {
  'use strict';

  var PLACE = {
    plaza: '광장', park: '공원', game_room: '게임방', cafe: '카페',
    club_center: '동아리센터', support_center: '지원센터', mission_room: '미션방'
  };
  var DAYS = ['일', '월', '화', '수', '목', '금', '토'];

  var LINES = {
    hello: function (nick) { return '어서 와요, ' + (nick || '주민') + '님! 이 마을 이장이에요. 우리 마을에 온 걸 환영해요.'; },
    loading: '이번 주 마을 소식을 꺼내 볼게요…',
    list: '이번 주에 이런 모임이 열려요. 부담 없이 와요. 말 안 하고 있다 가도 괜찮아요.',
    empty: '이번 주 모임은 아직 준비 중이에요. 정해지면 광장에 바로 붙여 둘게요. 궁금한 건 루미한테 물어봐도 되고요.',
    failed: '지금은 게시판을 못 열었어요. 조금 뒤에 다시 들러 줘요.',
    joined: function (place) { return '좋아요! 그날 ' + place + '에서 봐요.'; },
    already: '벌써 신청해 뒀네요. 그날 봐요!',
    closed: '아, 그 모임은 지금 신청을 받지 않아요.',
    bye: '언제든 광장에 들러요. 🎩'
  };

  var STYLE_ID = 'chief-style';
  var CSS = [
    '.chief-backdrop{position:fixed;inset:0;background:rgba(32,26,16,.38);display:flex;align-items:flex-end;justify-content:center;z-index:9000}',
    '@media (min-width:600px){.chief-backdrop{align-items:center}}',
    '.chief-panel{--ch-gold:#8A6A2C;--ch-gold-soft:#F6EEDC;--ch-ink:#2A241A;--ch-muted:#6B6253;--ch-line:#E3D9C4;--ch-leaf:#2E6B4F;',
    '  width:100%;max-width:440px;max-height:88vh;overflow:auto;background:#FFFDF8;color:var(--ch-ink);border-radius:18px 18px 0 0;padding:20px 18px 22px;font:inherit;line-height:1.55;box-sizing:border-box}',
    '@media (min-width:600px){.chief-panel{border-radius:18px}}',
    '.chief-head{display:flex;gap:12px;align-items:flex-start}',
    '.chief-face{flex:0 0 48px;height:48px;border-radius:50%;background:var(--ch-gold);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px}',
    '.chief-bubble{position:relative;background:var(--ch-gold-soft);border-radius:14px;padding:10px 14px;font-size:15px;flex:1}',
    '.chief-bubble:before{content:"";position:absolute;left:-7px;top:16px;border:7px solid transparent;border-right-color:var(--ch-gold-soft);border-left:0}',
    '.chief-name{font-size:13px;color:var(--ch-muted);margin:0 0 2px}',
    '.chief-close{margin-left:auto;background:none;border:0;font-size:22px;line-height:1;color:var(--ch-muted);cursor:pointer;padding:4px 6px;border-radius:8px}',
    '.chief-list{list-style:none;margin:16px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}',
    '.chief-item{border:1px solid var(--ch-line);border-left:6px solid var(--ch-gold);border-radius:4px 12px 12px 4px;background:#fff;padding:12px 14px}',
    '.chief-when{font-size:12px;color:var(--ch-muted);margin:0}',
    '.chief-title{font-size:16px;font-weight:600;margin:2px 0 4px}',
    '.chief-desc{font-size:14px;margin:0}',
    '.chief-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}',
    '.chief-act{font:inherit;font-size:14px;padding:8px 12px;border-radius:10px;border:0;background:var(--ch-gold);color:#fff;cursor:pointer}',
    '.chief-act[disabled]{background:var(--ch-gold-soft);color:var(--ch-gold);cursor:default}',
    '.chief-foot{display:flex;margin-top:16px}',
    '.chief-btn{flex:1;font:inherit;font-size:14px;padding:10px;border-radius:12px;border:1.5px solid var(--ch-line);background:#fff;color:var(--ch-ink);cursor:pointer}',
    '.chief-btn:hover{border-color:var(--ch-gold)}',
    '.chief-btn:focus-visible,.chief-close:focus-visible,.chief-act:focus-visible{outline:3px solid #F4B942;outline-offset:2px}'
    // 등장 애니메이션은 넣지 않는다 — 3D 화면이 무거울 때 첫 프레임이 늦으면 창이 투명한 채로 남을 수 있음
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

  function whenLabel(ev) {
    var d = new Date(ev.starts_at);
    if (isNaN(d)) return '';
    var hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일(' + DAYS[d.getDay()] + ') ' + hh + ':' + mm;
  }

  async function fetchEvents(sb) {
    // featured(내 코호트에 먼저 보여줄 이벤트)는 정렬에만 쓴다. 화면에 "추천" 표시를 하지 않는다(대상 노출 방지)
    var res = await sb.from('world_events_public')
      .select('id,title,description,place,starts_at,ends_at,featured,joined')
      .order('featured', { ascending: false })
      .order('starts_at', { ascending: true })
      .limit(3);
    if (res && res.error) throw res.error;
    return (res && res.data) || [];
  }

  function open(opts) {
    opts = opts || {};
    var sb = opts.sb;
    if (!sb) throw new Error('Chief.open: sb(supabase 클라이언트)가 필요합니다');
    injectStyle();

    var lastFocus = document.activeElement;
    var bubbleText = el('p', { style: 'margin:0', 'aria-live': 'polite' });
    var body = el('div');
    var closeBtn = el('button', { class: 'chief-close', type: 'button', 'aria-label': '마을이장과 대화 닫기', text: '×', onclick: close });
    var panel = el('div', { class: 'chief-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'chief-dialog-name' }, [
      el('div', { class: 'chief-head' }, [
        el('div', { class: 'chief-face', 'aria-hidden': 'true', text: '🎩' }),
        el('div', { class: 'chief-bubble' }, [
          el('p', { class: 'chief-name', id: 'chief-dialog-name', text: '마을이장 · 광장' }),
          bubbleText
        ]),
        closeBtn
      ]),
      body
    ]);
    var backdrop = el('div', { class: 'chief-backdrop', onclick: function (e) { if (e.target === backdrop) close(); } }, [panel]);
    var closed = false;

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
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      if (opts.onClose) opts.onClose();
    }

    function say(text) { bubbleText.textContent = text; }
    function footer() {
      return el('div', { class: 'chief-foot' }, [
        el('button', { class: 'chief-btn', type: 'button', text: '대화 마치기', onclick: close })
      ]);
    }
    function setBody(nodes) {
      body.innerHTML = '';
      nodes.forEach(function (n) { if (n) body.appendChild(n); });
      var first = body.querySelector('button:not([disabled])');
      if (first) first.focus();
    }

    function card(ev) {
      var place = PLACE[ev.place] || ev.place;
      var btn = el('button', {
        class: 'chief-act', type: 'button',
        text: ev.joined ? '참여 신청했어요 ✓' : '참여할래요',
        disabled: ev.joined ? 'disabled' : null,
        'aria-label': ev.joined ? null : ev.title + ' 참여하기',
        onclick: async function () {
          btn.disabled = true;
          var res;
          try { res = await sb.rpc('join_world_event', { p_event_id: ev.id }); } catch (e) { res = { error: e }; }
          if (res && res.error) {
            var msg = (res.error.message || '') + (res.error.details || '');
            if (msg.indexOf('event_not_open') >= 0) { say(LINES.closed); btn.textContent = '신청 마감'; return; }
            say(LINES.failed); btn.disabled = false; return;
          }
          btn.textContent = '참여 신청했어요 ✓';
          say(res && res.data === false ? LINES.already : LINES.joined(place));
          if (opts.onJoined) opts.onJoined(ev);
        }
      });
      return el('li', { class: 'chief-item' }, [
        el('p', { class: 'chief-when', text: place + ' · ' + whenLabel(ev) }),
        el('p', { class: 'chief-title', text: ev.title }),
        ev.description ? el('p', { class: 'chief-desc', text: ev.description }) : null,
        el('div', { class: 'chief-actions' }, [btn])
      ]);
    }

    async function load() {
      say(LINES.hello(opts.nickname) + ' ' + LINES.loading);
      var events;
      try {
        events = await fetchEvents(sb);
      } catch (e) {
        console.warn('[chief] 이벤트를 불러오지 못함(03·05 적용 전일 수 있음)', e && (e.message || e));
        say(LINES.hello(opts.nickname) + ' ' + LINES.empty);
        setBody([footer()]);
        return;
      }
      if (closed) return;
      if (!events.length) {
        say(LINES.hello(opts.nickname) + ' ' + LINES.empty);
        setBody([footer()]);
        return;
      }
      say(LINES.hello(opts.nickname) + ' ' + LINES.list);
      setBody([el('ul', { class: 'chief-list' }, events.map(card)), footer()]);
    }

    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    setBody([footer()]);
    load();
    return { close: close };
  }

  global.Chief = { open: open, _lines: LINES };
})(window);
