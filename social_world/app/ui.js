/*
 * 소셜 월드 UI — 나의 휴대폰 · 전체 지도 · 설정 · 코코 알림  (window.WorldUI)
 *
 * 원작: PR #13 social-world-ui-v2 (UI 담당 팀원). 시연용 예시 데이터로 돌던 화면을
 * 앱(app.js)에 붙도록 다시 정리했다(2026-10-02).
 *   - 동아리·미션 목록은 예시 대신 실제 DB(clubs, club_members, missions, mission_progress)
 *   - NPC 대화는 앱의 대화창(대본 트리·코코·이장)을 그대로 연다 — 이 파일은 대화 내용을 갖지 않는다
 *   - 순간이동은 앱에 맡긴다(host.teleport) — 캐릭터 모양·집 이름·투어 상태가 유지되게
 *
 * 앱이 넘겨주는 host (WorldUI.init(host)):
 *   sb                    Supabase 클라이언트
 *   userId()              로그인한 사용자 id
 *   nickname()            닉네임
 *   feedback()            cohort_feedback (추천 미션 순서) 또는 null
 *   npcs()                [{id, name, emoji, color}] 마을 NPC 목록
 *   busy()                앱 대화창(NPC·튜토리얼·코코·이장)이 열려 있으면 true
 *   openNpc(id)           NPC 대화 열기
 *   teleport(spawn, facing) 마을의 그 자리로 이동 (투어 중이면 false)
 *   openMissionRoom()     미션방 화면
 *   openClubRoom()        동아리센터 화면(동아리 개설 포함)
 *   logout()
 *   toast(msg)
 *
 * 앱이 부르는 것:
 *   attach(engine)        3D 엔진이 생기면 한 번 — 키 설정·화질·미니맵 방향 적용
 *   sync({inVillage, tour, roomBusy})  HUD가 바뀔 때마다 — 휴대폰 버튼 표시, 코코 알림 시점
 *   isOpen()              휴대폰·지도가 열려 있으면 true (엔진 입력 멈춤에 씀)
 *   keyLabel(action)      'interact' → 'E' 같은 현재 키 이름
 *   close() / reset()     화면 닫기 / 로그아웃 때 알림 상태 초기화
 *
 * 저장: 설정(미니맵 방향·화질·키·효과음)과 사용자 ID별 인벤토리를
 *       별도 localStorage 키에 남긴다. 인벤토리 저장은 inventory.js가 맡는다.
 *       대화 내용·알림 내용은 어디에도 저장하지 않는다.
 */
(function () {
  'use strict';

  // 코코 알림 배너 — 마을에 들어오고 잠시 뒤 한 번(로그인 1회당). 내용은 고정 문구, 위험 정보와 무관
  var COCO_NOTICE = { enabled: true, delayMs: 6500, retryMs: 3000, showMs: 9000 };
  var STORE = 'sw_ui_settings_v1';

  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  // ---------------------------------------------------------------- 아이콘
  var PATHS = {
    inventory: 'M4 7h16v14H4zM8 7V4h8v3M4 12h16M10 12v3h4v-3',
    settings: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
    phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM10 5h4M11 18h2',
    map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5ZM9 3v16M15 5v16',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M10 20h4',
    chat: 'M21 11a9 8 0 0 1-9 8H6l-4 3 1-7a8 8 0 0 1 9-12 9 8 0 0 1 9 8ZM8 10h8M8 14h5',
    club: 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    mission: 'M9 4h6v4H9zM9 6H5v15h14V6h-4M8 14l3 3 5-6',
    home: 'm3 10 9-7 9 7M5 9v12h14V9M10 21v-7h4v7',
    close: 'm6 6 12 12M6 18 18 6',
    back: 'm15 5-7 7 7 7',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    reset: 'M3 11a9 9 0 1 1 2.4 7M3 4v7h7',
    signal: 'M4 19v-4M9 19v-8M14 19V7M19 19V3',
    battery: 'M3 7h17v10H3zM22 10v4'
  };
  function icon(name) {
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="' + (PATHS[name] || PATHS.chat) + '"/></svg>';
  }
  function cocoFace() {
    return '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M10 18a10 10 0 0 1 20 0v7a10 10 0 0 1-20 0" fill="#f3c994"/>' +
      '<path d="M7 15c2-9 23-9 26 1H7" fill="#2e6b4f"/><rect x="5" y="14" width="31" height="5" rx="2" fill="#3b7b58"/>' +
      '<circle cx="16" cy="24" r="1.3" fill="#3b352a"/><circle cx="25" cy="24" r="1.3" fill="#3b352a"/>' +
      '<path d="M17 29q4 3 7 0" fill="none" stroke="#985e45" stroke-width="1.4"/></svg>';
  }
  function avatar(npc) {
    if (npc.id === 'coco') return '<div class="avatar coco">' + cocoFace() + '</div>';
    return '<div class="avatar" style="background:' + esc(npc.color) + '22">' + esc(npc.emoji) + '</div>';
  }

  // 연락처에 보이는 역할 설명 (이름·이모지·색은 앱의 NPC 목록을 따른다)
  var NPC_ROLE = {
    psych: '이야기 친구 · 카페 앞',
    policy: '정책·생활 정보 · 분수 옆',
    job: '취업·진로 상담 · 분수 옆',
    chief: '마을 소식·모임 · 광장',
    coco: '활동·모임 추천 · 동아리센터 앞'
  };
  // 이 NPC들은 대화창이 어디서든 열린다(마을을 걷지 않아도 됨)
  var CALL_ANYWHERE = { coco: true, chief: true };

  // ---------------------------------------------------------------- 키 설정
  var DEFAULT_BINDINGS = { map: 'KeyM', inventory: 'KeyI', forward: 'KeyW', left: 'KeyA', back: 'KeyS', right: 'KeyD', interact: 'KeyE' };
  var KEY_NAMES = {
    inventory: '인벤토리', map: '전체 지도', forward: '앞으로 이동', left: '왼쪽으로 이동',
    back: '뒤로 이동', right: '오른쪽으로 이동', interact: '대화 / 상호작용'
  };
  var validCode = function (code) { return /^(Key[A-Z]|Digit[0-9])$/.test(code); };
  var keyCode = function (e) {
    return e.code || (/^[a-z0-9]$/i.test(e.key) ? (/^[0-9]$/.test(e.key) ? 'Digit' : 'Key') + e.key.toUpperCase() : e.key);
  };
  var codeLabel = function (code) { return String(code).replace(/^(Key|Digit)/, ''); };

  function loadSettings() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { saved = {}; }
    var b = Object.assign({}, DEFAULT_BINDINGS, saved.bindings || {});
    if (!saved.bindings || !saved.bindings.inventory) {
      var used = Object.keys(b).filter(function(k){ return k !== 'inventory'; }).map(function(k){ return b[k]; });
      b.inventory = ['KeyI','KeyB','KeyV','KeyN'].concat('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(function(c){return 'Key'+c;})).filter(function(c){return used.indexOf(c)<0;})[0];
    }
    var codes = Object.keys(DEFAULT_BINDINGS).map(function (k) { return b[k]; });
    var ok = codes.every(validCode) && new Set(codes).size === codes.length && Object.keys(b).length === codes.length;
    return {
      north: saved.north !== false,
      quality: saved.quality === 'high' || saved.quality === 'low' ? saved.quality : null,
      bindings: ok ? b : Object.assign({}, DEFAULT_BINDINGS),
      muted: saved.muted === true
    };
  }

  // ---------------------------------------------------------------- 상태
  var host = null, engine = null, fishingFeature = null, fishingUser = null;
  var settings = loadSettings();
  var ui = {
    panel: null,          // null | 'phone' | 'map'
    page: 'home',         // home | clubs | missions | contacts | settings
    bindingTarget: null,  // 키를 바꾸는 중인 동작
    modalFocus: null,
    ctx: { inVillage: false, tour: false, roomBusy: false },
    notice: null,         // {line, read, shown} — 이번 로그인에서 코코가 보낸 알림
    noticeUser: null,
    noticeTimer: null,
    hideTimer: null,
    data: { clubs: null, myClubs: {}, missions: null, progress: {}, error: null }
  };

  Object.defineProperty(ui, 'bindings', { get: function(){ return settings.bindings; } });

  function persist() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        north: settings.north, quality: settings.quality, bindings: settings.bindings, muted: settings.muted
      }));
    } catch (e) { /* 저장이 막혀도 이번 접속에서는 그대로 동작 */ }
  }
  function applySettings() {
    window.__SW_NORTH_FIXED = settings.north;               // 미니맵 북쪽 고정(엔진이 읽음)
    if (window.Sound) window.Sound.setMuted(settings.muted);
    if (engine) {
      engine.setBindings(settings.bindings);
      if (settings.quality) engine.setQuality(settings.quality === 'high');
    }
  }
  function toast(msg) { if (host && host.toast) host.toast(msg); }
  function play(name) { if (window.Sound) window.Sound.play(name); }
  function allowed() { return document.body.classList.contains('in-world') && !ui.ctx.tour && !ui.ctx.roomBusy; }

  // ---------------------------------------------------------------- 패널 열고 닫기
  function openPanel(kind) {
    if (fishingFeature) fishingFeature.cancel();
    ui.bindingTarget = null;
    if (!ui.panel) ui.modalFocus = document.activeElement;
    hideNotice();
    if (engine) engine.pauseInput();
    ui.panel = kind;
    var o = $('#overlay');
    o.hidden = false;
    o.dataset.panel = kind;
  }
  function closePanel() {
    if (!ui.panel) return;
    ui.bindingTarget = null;
    ui.panel = null;
    var o = $('#overlay');
    o.hidden = true;
    o.innerHTML = '';
    if (engine) engine.pauseInput();
    if (ui.modalFocus && ui.modalFocus.focus && document.contains(ui.modalFocus)) ui.modalFocus.focus();
    ui.modalFocus = null;
  }
  function focusFirst() {
    requestAnimationFrame(function () {
      var x = $('#overlay [autofocus]') || $('#overlay button');
      if (x) x.focus();
    });
  }

  // ---------------------------------------------------------------- 이동
  // 전체 지도의 장소 — 이름표 위치(x,z)는 지도 그림 위치. 실제로 서는 자리는 엔진의 places()
  var MAP_POINTS = [
    { id: 'support', name: '지원센터', x: 0, z: -17 },
    { id: 'mission', name: '미션방', x: -17, z: -1 },
    { id: 'club', name: '동아리센터', x: 15, z: -11 },
    { id: 'game', name: '게임방', x: 17.5, z: -1.5 },
    { id: 'cafe', name: '카페', x: -11.8, z: -10.6 },
    { id: 'home', name: '내 집', x: 22, z: 12 },
    { id: 'plaza', name: '광장', x: 0, z: 5.5 },
    { id: 'park', name: '공원', x: -14, z: 16.5 },
    { id: 'lake', name: '호수', x: 10, z: 36.8 },
    { id: 'forest', name: '숲길', x: -38, z: 22 },
    { id: 'flowers', name: '꽃 언덕', x: 36, z: 38 },
    { id: 'field', name: '들판', x: 42, z: 6 }
  ];
  // 엔진 places()에 없는 산책로 장소
  var EXTRA_SPOTS = { lake: { x: 10, z: 36.8 }, forest: { x: -38, z: 22 }, flowers: { x: 36, z: 38 }, field: { x: 42, z: 6 } };
  // 지도 그림 범위 — world-engine.js MAP_B 와 같아야 한다
  var mapPct = function (p) { return { left: (p.x + 58) / 116 * 100, top: (p.z + 34) / 92 * 100 }; };

  function goPlace(id) {
    var P = engine ? engine.places() : {};
    var spot = P[id] || EXTRA_SPOTS[id];
    if (!spot) { toast('이 장소는 아직 준비 중이에요.'); return; }
    closePanel();
    if (!host.teleport({ x: spot.x, z: spot.z })) return;
    var name = (MAP_POINTS.filter(function (m) { return m.id === id; })[0] || {}).name || '목적지';
    toast(name + ' 앞으로 이동했어요');
  }

  // NPC 앞(마을 가운데 쪽으로 1.8칸)으로 이동해 NPC를 바라본다
  function goNpc(id) {
    if (!engine) return false;
    var n = engine.npcPositions().filter(function (x) { return x.id === id; })[0];
    if (!n) return false;
    var l = Math.hypot(n.x, n.z) || 1;
    var spawn = { x: n.x - n.x / l * 1.8, z: n.z - n.z / l * 1.8 };
    return host.teleport(spawn, Math.atan2(n.x - spawn.x, n.z - spawn.z));
  }

  function contactNpc(id) {
    closePanel();
    if (CALL_ANYWHERE[id]) { host.openNpc(id); return; }
    if (!goNpc(id)) { toast('지금은 찾아갈 수 없어요.'); return; }
    setTimeout(function () { host.openNpc(id); }, 350);
  }

  // ---------------------------------------------------------------- 전체 지도
  function openMap() {
    if (!allowed()) return;
    openPanel('map');
    var inRoom = engine && engine.mode && engine.mode() === 'room';
    var here = engine ? (inRoom ? engine.places().home : engine.playerPos()) : { x: 0.6, z: 7.4 };
    var pos = mapPct(here);
    $('#overlay').innerHTML =
      '<section class="ui-dialog map-dialog" role="dialog" aria-modal="true" aria-labelledby="map-title">' +
        '<header class="dialog-top"><div class="avatar">' + icon('map') + '</div>' +
          '<div><div class="eyebrow">IEUM VILLAGE</div><h2 id="map-title">이음 마을 지도</h2>' +
          '<p>장소 이름을 누르면 입구 앞으로 이동해요.</p></div>' +
          '<button class="icon-btn" data-close aria-label="지도 닫기">' + icon('close') + '</button></header>' +
        '<div class="map-main">' +
          '<div class="map-caption"><span>' + (inRoom ? '지금은 내 방에 있어요. 장소를 누르면 밖으로 나가요.' : '궁금한 곳부터 천천히 둘러보세요.') +
            '</span><span><strong>N ↑</strong> 북쪽 고정</span></div>' +
          '<div class="map-frame"><canvas id="full-map" aria-label="이음 마을 전체 지도"></canvas>' +
            MAP_POINTS.map(function (p) {
              var q = mapPct(p);
              return '<button class="map-point" style="left:' + q.left + '%;top:' + q.top + '%" data-place="' + p.id +
                '" aria-label="' + p.name + ' 앞으로 이동">' + p.name + '</button>';
            }).join('') +
            '<span class="map-player" style="left:' + pos.left + '%;top:' + pos.top + '%" aria-label="현재 내 위치"></span>' +
          '</div>' +
          '<div class="map-footer"><span style="color:#ce5849">● 내 위치</span>' +
            '<span style="margin-left:auto">' + codeLabel(settings.bindings.map) + ' / Esc 닫기</span></div>' +
        '</div>' +
      '</section>';
    var c = $('#full-map'), g = c.getContext('2d');
    c.width = 928; c.height = 736;
    if (engine && engine.mapBase) g.drawImage(engine.mapBase(), 0, 0, c.width, c.height);
    $('#overlay [data-close]').onclick = closePanel;
    Array.prototype.forEach.call($('#overlay').querySelectorAll('[data-place]'), function (b) {
      b.onclick = function () { goPlace(b.dataset.place); };
    });
    focusFirst();
  }

  // ---------------------------------------------------------------- 코코 알림
  function unread() { return ui.notice && !ui.notice.read ? 1 : 0; }
  function updateBadge() {
    var b = $('#unread-badge'), n = unread();
    b.hidden = !n;
    b.textContent = n;
    $('#phone-launch').setAttribute('aria-label', '휴대폰 열기' + (n ? ', 새 메시지 ' + n + '개' : ''));
  }
  function hideNotice() {
    clearTimeout(ui.hideTimer);
    $('#notification').hidden = true;
  }
  function readNotice() {
    if (ui.notice) ui.notice.read = true;
    hideNotice();
    updateBadge();
  }
  function openCocoFromNotice() {
    readNotice();
    closePanel();
    host.openNpc('coco');
  }
  function scheduleNotice() {
    if (!COCO_NOTICE.enabled || !host) return;
    var uid = host.userId();
    if (ui.noticeUser !== uid) { ui.noticeUser = uid; ui.notice = null; }
    if (ui.notice || ui.noticeTimer || !ui.ctx.inVillage || ui.ctx.tour) return;
    ui.noticeTimer = setTimeout(tryNotice, COCO_NOTICE.delayMs);
  }
  function tryNotice() {
    ui.noticeTimer = null;
    if (ui.notice || !ui.ctx.inVillage || ui.ctx.tour || !document.body.classList.contains('in-world')) return;   // 다음 sync 때 다시
    if (ui.panel || host.busy() || (fishingFeature && fishingFeature.state)) { ui.noticeTimer = setTimeout(tryNotice, COCO_NOTICE.retryMs); return; }
    ui.notice = { line: '같이 해볼 만한 모임이랑 활동을 찾아놨어. 한번 볼래?', read: false };
    var box = $('#notification');
    box.innerHTML =
      '<div class="avatar coco">' + cocoFace() + '</div>' +
      '<button class="notify-content" id="notify-open"><b>코코 · 새 메시지</b><span>' + esc(ui.notice.line) +
        '</span><small>눌러서 코코와 이야기하기</small></button>' +
      '<button class="dismiss" id="notify-dismiss" aria-label="알림 닫기">' + icon('close') + '</button>' +
      '<div class="notify-progress"></div>';
    box.hidden = false;
    $('#notify-open').onclick = openCocoFromNotice;
    $('#notify-dismiss').onclick = hideNotice;
    ui.hideTimer = setTimeout(hideNotice, COCO_NOTICE.showMs);
    updateBadge();
    play('cocoNotification');
  }

  // ---------------------------------------------------------------- DB (동아리·미션)
  function loadClubs() {
    var uid = host.userId();
    return Promise.all([
      host.sb.from('clubs').select('*, member_count:club_members(count)').order('created_at', { ascending: false }),
      uid ? host.sb.from('club_members').select('club_id').eq('user_id', uid) : Promise.resolve({ data: [] })
    ]).then(function (r) {
      if (r[0].error) throw r[0].error;
      ui.data.clubs = r[0].data || [];
      var mine = {};
      (r[1].data || []).forEach(function (x) { mine[x.club_id] = true; });
      ui.data.myClubs = mine;
    });
  }
  function loadMissions() {
    var uid = host.userId();
    return Promise.all([
      host.sb.from('missions').select('*').eq('is_active', true).order('id'),
      uid ? host.sb.from('mission_progress').select('*').eq('user_id', uid) : Promise.resolve({ data: [] })
    ]).then(function (r) {
      if (r[0].error) throw r[0].error;
      ui.data.missions = r[0].data || [];
      var map = {};
      (r[1].data || []).forEach(function (x) { map[x.mission_id] = x; });
      ui.data.progress = map;
    });
  }
  // 페이지에 들어갈 때마다 새로 읽는다(미션방·동아리센터 화면에서 바뀐 것도 반영)
  function refresh(page) {
    var loader = page === 'clubs' ? loadClubs : page === 'missions' ? loadMissions : null;
    if (!loader) return;
    ui.data.error = null;
    loader().catch(function (e) {
      ui.data.error = '목록을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.';
      console.warn('휴대폰 목록 불러오기 실패:', e && e.message);
    }).then(function () {
      if (ui.panel === 'phone' && ui.page === page) renderPhone();
    });
  }

  function joinClub(id, btn) {
    btn.disabled = true;
    host.sb.from('club_members').insert({ club_id: id, user_id: host.userId() }).then(function (res) {
      if (res.error) { toast('가입하지 못했어요. 잠시 뒤 다시 해 주세요.'); btn.disabled = false; return; }
      toast('동아리에 가입했어요');
      refresh('clubs');
    });
  }
  function startMission(id, btn) {
    btn.disabled = true;
    host.sb.from('mission_progress').insert({ user_id: host.userId(), mission_id: id, status: 'in_progress' }).then(function (res) {
      if (res.error) { toast('미션을 시작하지 못했어요.'); btn.disabled = false; return; }
      toast('미션을 시작했어요');
      refresh('missions');
    });
  }
  function completeMission(id, btn) {
    btn.disabled = true;
    host.sb.from('mission_progress').update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('user_id', host.userId()).eq('mission_id', id)
      .then(function (res) {
        if (res.error) { toast('완료 처리를 하지 못했어요.'); btn.disabled = false; return; }
        toast('미션을 완료했어요');
        play('missionComplete');
        refresh('missions');
      });
  }

  // ---------------------------------------------------------------- 휴대폰
  function openPhone(page) {
    if (!allowed()) return;
    openPanel('phone');
    phoneNavigate(page || 'home');
    focusFirst();
  }
  function phoneNavigate(page) {
    ui.bindingTarget = null;
    ui.page = page;
    if (page === 'clubs' || page === 'missions') {
      if (page === 'clubs') ui.data.clubs = null; else ui.data.missions = null;
      refresh(page);
    }
    renderPhone();
    var pc = $('#phone-content');
    if (pc) pc.scrollTop = 0;
  }

  var TITLES = { home: '나의 휴대폰', clubs: '동아리', missions: '미션', contacts: '주민 연락처', settings: '설정' };
  var NAV = [['home', 'home', '홈'], ['clubs', 'club', '동아리'], ['missions', 'mission', '미션'], ['contacts', 'chat', '연락처'], ['settings', 'settings', '설정']];

  function homeHTML() {
    var n = ui.notice;
    var cocoLine = n ? n.line : '관심 있는 활동이 궁금하면 코코에게 물어봐. 네 관심사에 맞는 모임을 찾아줄 거야.';
    return '<div class="phone-home-welcome"><div class="eyebrow">MY LITTLE WORLD</div>' +
        '<h3>' + esc(host.nickname() || '주민') + '님, 오늘은 어디로 갈까요?</h3><p>내 속도로 만나는 이음 마을</p></div>' +
      '<section class="phone-feature"><div class="feature-title"><div class="avatar coco">' + cocoFace() + '</div>' +
        '<div><strong>코코의 활동 편지</strong><small>' + (unread() ? '새 메시지 1개' : '함께 해볼 만한 활동을 찾아요') + '</small></div></div>' +
        '<p>' + esc(cocoLine) + '</p>' +
        '<button class="action primary" data-coco>코코와 이야기하기 ' + icon('arrow') + '</button></section>' +
      '<div class="stack"><button class="action secondary" data-contact="chief">🎩 마을이장 · 이번 주 모임 보기</button></div>' +
      '<div class="home-apps">' +
        '<button data-nav="clubs"><span class="app-icon">' + icon('club') + '</span>동아리</button>' +
        '<button data-nav="missions"><span class="app-icon">' + icon('mission') + '</span>미션</button>' +
        '<button data-nav="contacts"><span class="app-icon">' + icon('chat') + '</span>주민 연락처</button></div>' +
      '<button class="action secondary home-map" data-open-map>' + icon('map') + ' 전체 지도 열기 <span>' + codeLabel(settings.bindings.map) + '</span></button>' +
      '<p class="info-note">휴대폰에서 한 동아리 가입·미션 참여도 마을에서 한 것과 똑같이 저장돼요. 대화 내용은 저장하지 않아요.</p>';
  }

  function listState(list) {
    if (ui.data.error) return '<p class="record-empty">' + esc(ui.data.error) + '</p>';
    if (list === null) return '<p class="record-empty">불러오는 중…</p>';
    return '';
  }

  function clubsHTML() {
    var list = ui.data.clubs;
    var head = '<div class="phone-list-intro"><p>취향이 닮은 사람들과 만나요.</p>' +
      (list ? '<span class="pill">' + list.length + '개 모임</span>' : '') + '</div>';
    var body = listState(list);
    if (!body) {
      body = list.length ? list.map(function (c) {
        var joined = !!ui.data.myClubs[c.id];
        var count = (c.member_count && c.member_count[0] && c.member_count[0].count) || 0;
        return '<article class="content-card" id="club-' + c.id + '"><span class="type-tag">' + esc(c.category || '모임') + '</span>' +
          '<h3>' + esc(c.name) + '</h3>' + (c.description ? '<p>' + esc(c.description) + '</p>' : '') +
          '<div class="card-bottom"><small>멤버 ' + count + '명</small>' +
          '<button class="action ' + (joined ? 'secondary' : 'primary') + '" data-join-club="' + c.id + '"' + (joined ? ' disabled' : '') + '>' +
          (joined ? '가입됨' : '가입하기') + '</button></div></article>';
      }).join('') : '<p class="record-empty">아직 개설된 동아리가 없어요.</p>';
    }
    return head + body + '<div class="stack"><button class="action secondary" data-room="club">동아리센터로 가기 · 동아리 만들기</button></div>';
  }

  function missionsHTML() {
    var list = ui.data.missions;
    var done = list ? list.filter(function (m) { var p = ui.data.progress[m.id]; return p && p.status === 'done'; }).length : 0;
    var head = '<div class="phone-list-intro"><p>작은 일부터 시작해 보세요.</p>' +
      (list ? '<span class="pill">' + done + '개 완료</span>' : '') + '</div>';
    var body = listState(list);
    if (!body) {
      // 위험 탐지 에이전트의 환류(cohort_feedback.priority_missions) 순서대로 위에 올리고 '추천' 표시
      var fb = host.feedback();
      var prio = (fb && fb.priority_missions) || [];
      var ordered = list.slice().sort(function (a, b) {
        var ia = prio.indexOf(a.title), ib = prio.indexOf(b.title);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.id - b.id;
      });
      body = ordered.length ? ordered.map(function (m) {
        var p = ui.data.progress[m.id], s = p ? p.status : 'new';
        var tag = (s === 'done' ? '완료' : s === 'in_progress' ? '진행 중' : '작은 미션') + ' · +' + (m.reward_point || 0) + 'P' +
          (prio.indexOf(m.title) >= 0 ? ' · 추천' : '');
        var btn = s === 'done' ? '<button class="action secondary" disabled>완료됨</button>'
          : s === 'in_progress' ? '<button class="action primary" data-complete="' + m.id + '">완료하기</button>'
          : '<button class="action primary" data-start="' + m.id + '">시작하기</button>';
        return '<article class="content-card" id="mission-' + m.id + '"><span class="type-tag">' + tag + '</span>' +
          '<h3>' + esc(m.title) + '</h3>' + (m.description ? '<p>' + esc(m.description) + '</p>' : '') +
          '<div class="card-bottom"><small>' + (s === 'new' ? '천천히 해도 괜찮아요' : s === 'done' ? '작은 한 걸음 완료!' : '시작한 미션이에요') + '</small>' +
          btn + '</div></article>';
      }).join('') : '<p class="record-empty">등록된 미션이 없어요.</p>';
    }
    return head + body + '<div class="stack"><button class="action secondary" data-room="mission">미션방으로 가기</button></div>';
  }

  function contactsHTML() {
    return '<div class="phone-list-intro"><p>주민에게 연락하기</p><span class="pill">NPC 연락처</span></div>' +
      host.npcs().map(function (n) {
        return '<button class="record-row" data-contact="' + n.id + '">' + avatar(n) +
          '<div class="record-text"><b>' + esc(n.name) + '</b><p>' + esc(NPC_ROLE[n.id] || '마을 주민') + '</p></div>' +
          (n.id === 'coco' && unread() ? '<span class="unread-dot" aria-label="새 메시지"></span>' : '') +
          '<small>' + (CALL_ANYWHERE[n.id] ? '바로 대화' : '찾아가기') + '</small></button>';
      }).join('') +
      '<p class="info-note">누르면 그 주민 앞으로 이동해서 대화가 열려요. 대화 내용은 저장하지 않아요.</p>';
  }

  function settingsHTML() {
    var hasEngine = !!engine;
    var listening = function (a) { return ui.bindingTarget === a; };
    return '<p class="settings-intro">화면과 조작을 내게 편한 방식으로 바꿔요.</p>' +
      '<section class="settings-section" aria-labelledby="display-settings-title"><h3 id="display-settings-title">화면</h3>' +
        '<label class="setting-row" for="setting-north"><span>미니맵 방향<small>빨간 N은 북쪽을 가리켜요.</small></span>' +
          '<select id="setting-north"><option value="fixed"' + (settings.north ? ' selected' : '') + '>북쪽 고정</option>' +
          '<option value="rotate"' + (!settings.north ? ' selected' : '') + '>시점 따라 회전</option></select></label>' +
        '<label class="setting-row" for="setting-quality"><span>화질<small>해상도와 그림자 품질</small></span>' +
          '<select id="setting-quality"' + (hasEngine ? '' : ' disabled') + '>' +
          '<option value="high"' + (engine && engine.gfxHigh() ? ' selected' : '') + '>높음</option>' +
          '<option value="low"' + (!(engine && engine.gfxHigh()) ? ' selected' : '') + '>가벼움</option></select></label>' +
        '<button class="action secondary setting-reset" id="setting-view"' + (hasEngine ? '' : ' disabled') + '>' + icon('reset') + ' 시점 초기화</button>' +
        '<p class="setting-note">시점의 방향·높이·줌을 처음 상태로 되돌려요.</p></section>' +
      '<section class="settings-section" aria-labelledby="sound-settings-title"><h3 id="sound-settings-title">소리</h3>' +
        '<label class="setting-row" for="setting-sound"><span>효과음<small>코코 알림·미션 완료·낚시 입질 소리</small></span>' +
          '<select id="setting-sound"><option value="on"' + (!settings.muted ? ' selected' : '') + '>켜기</option>' +
          '<option value="off"' + (settings.muted ? ' selected' : '') + '>끄기</option></select></label></section>' +
      '<section class="settings-section" aria-labelledby="key-settings-title"><h3 id="key-settings-title">키보드 조작</h3>' +
        '<p class="setting-note">키 버튼을 누른 뒤 영문자 또는 숫자 키를 눌러 바꿔요.</p>' +
        Object.keys(KEY_NAMES).map(function (a) {
          return '<div class="setting-row"><span>' + KEY_NAMES[a] + '</span>' +
            '<button class="key-binding' + (listening(a) ? ' listening' : '') + '" data-bind="' + a + '" aria-label="' + KEY_NAMES[a] +
            ' 키 바꾸기, 지금 ' + codeLabel(settings.bindings[a]) + '" aria-pressed="' + listening(a) + '">' +
            (listening(a) ? '키 입력 대기' : codeLabel(settings.bindings[a])) + '</button></div>';
        }).join('') +
        '<p id="binding-status" class="setting-note binding-status" role="status">' +
          (ui.bindingTarget ? '바꿀 키를 누르세요. Esc로 취소할 수 있어요.' : '방향키로도 움직일 수 있어요. Enter / Space도 상호작용에 쓸 수 있어요.') + '</p>' +
        '<button class="action secondary setting-reset" id="setting-keys-reset">기본 키로 되돌리기</button></section>' +
      '<section class="settings-section"><h3>마우스 / 터치</h3>' +
        '<p class="setting-note">땅 클릭·탭: 그곳으로 걷기<br>화면 끌기: 시점 돌리기 · 휠: 확대 / 축소<br>Esc: 열린 화면 닫기</p></section>' +
      '<section class="settings-section"><h3>계정</h3>' +
        '<button class="action secondary setting-reset" id="setting-logout">로그아웃</button></section>' +
      '<p class="info-note">설정은 이 브라우저에만 저장돼요.</p>';
  }

  function bindingFeedback(msg) { var s = $('#binding-status'); if (s) s.textContent = msg; }

  function bindSettings() {
    var on = function (sel, ev, fn) { var x = $(sel); if (x) x.addEventListener(ev, fn); };
    on('#setting-north', 'change', function (e) { settings.north = e.target.value === 'fixed'; applySettings(); persist(); });
    on('#setting-quality', 'change', function (e) {
      var want = e.target.value === 'high';
      var high = engine.setQuality(want);
      settings.quality = high ? 'high' : 'low';
      e.target.value = settings.quality;
      persist();
      if (want && !high) toast('이 기기에서는 가벼움 화질로 보여요.');
    });
    on('#setting-sound', 'change', function (e) { settings.muted = e.target.value === 'off'; applySettings(); persist(); });
    on('#setting-view', 'click', function () { if (engine) engine.resetView(); toast('시점을 처음 상태로 되돌렸어요'); });
    on('#setting-keys-reset', 'click', function () {
      settings.bindings = Object.assign({}, DEFAULT_BINDINGS);
      ui.bindingTarget = null;
      applySettings(); persist(); renderPhone();
      if (host.onKeysChanged) host.onKeysChanged();
      var b = $('#setting-keys-reset'); if (b) b.focus();
      toast('기본 키로 되돌렸어요');
    });
    on('#setting-logout', 'click', function () { closePanel(); host.logout(); });
    Array.prototype.forEach.call($('#overlay').querySelectorAll('[data-bind]'), function (b) {
      b.onclick = function () {
        ui.bindingTarget = ui.bindingTarget === b.dataset.bind ? null : b.dataset.bind;
        renderPhone();
        var again = $('#overlay [data-bind="' + b.dataset.bind + '"]'); if (again) again.focus();
      };
    });
  }

  function renderPhone() {
    var keepScroll = ui.page === 'settings' ? (($('#phone-content') || {}).scrollTop || 0) : 0;
    var body = ui.page === 'clubs' ? clubsHTML() : ui.page === 'missions' ? missionsHTML()
      : ui.page === 'contacts' ? contactsHTML() : ui.page === 'settings' ? settingsHTML() : homeHTML();
    var now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
    $('#overlay').innerHTML =
      '<section class="phone-dialog" role="dialog" aria-modal="true" aria-labelledby="phone-title">' +
        '<div class="phone-status"><span>' + now + '</span><span class="phone-island"></span>' +
          '<span class="status-right">' + icon('signal') + icon('battery') + '</span></div>' +
        '<header class="phone-header">' +
          (ui.page !== 'home' ? '<button class="icon-btn" data-nav="home" aria-label="홈으로">' + icon('back') + '</button>' : '') +
          '<h2 id="phone-title">' + TITLES[ui.page] + '</h2>' +
          '<button class="icon-btn" data-close aria-label="휴대폰 닫기">' + icon('close') + '</button></header>' +
        '<div class="phone-content" id="phone-content">' + body + '</div>' +
        '<nav class="phone-nav" aria-label="휴대폰 메뉴">' + NAV.map(function (n) {
          var on = ui.page === n[0];
          return '<button data-nav="' + n[0] + '"' + (on ? ' class="active" aria-current="page"' : '') + '>' + icon(n[1]) + n[2] + '</button>';
        }).join('') + '</nav>' +
      '</section>';

    var o = $('#overlay');
    o.querySelector('[data-close]').onclick = closePanel;
    var each = function (sel, fn) { Array.prototype.forEach.call(o.querySelectorAll(sel), fn); };
    each('[data-nav]', function (b) { b.onclick = function () { phoneNavigate(b.dataset.nav); }; });
    each('[data-open-map]', function (b) { b.onclick = function () { closePanel(); openMap(); }; });
    each('[data-coco]', function (b) { b.onclick = openCocoFromNotice; });
    each('[data-contact]', function (b) {
      b.onclick = function () { if (b.dataset.contact === 'coco') readNotice(); contactNpc(b.dataset.contact); };
    });
    each('[data-room]', function (b) {
      b.onclick = function () {
        closePanel();
        if (b.dataset.room === 'mission') host.openMissionRoom(); else host.openClubRoom();
      };
    });
    each('[data-join-club]', function (b) { b.onclick = function () { joinClub(Number(b.dataset.joinClub), b); }; });
    each('[data-start]', function (b) { b.onclick = function () { startMission(Number(b.dataset.start), b); }; });
    each('[data-complete]', function (b) { b.onclick = function () { completeMission(Number(b.dataset.complete), b); }; });
    if (ui.page === 'settings') { bindSettings(); $('#phone-content').scrollTop = keepScroll; }
  }

  // ---------------------------------------------------------------- 키보드
  function onKeyDown(e) {
    // 1) 키 바꾸기 대기 중 — 누른 키를 그 동작에 붙인다. 엔진으로 넘기지 않는다
    if (ui.bindingTarget) {
      if (e.key === 'Tab') return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { ui.bindingTarget = null; renderPhone(); return; }
      if (e.repeat || e.isComposing) return;
      var code = keyCode(e), action = ui.bindingTarget;
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || !validCode(code)) { bindingFeedback('영문자 또는 숫자 키 하나를 눌러 주세요.'); return; }
      var dup = Object.keys(settings.bindings).filter(function (o) { return o !== action && settings.bindings[o] === code; })[0];
      if (dup) { bindingFeedback(codeLabel(code) + ' 키는 ' + KEY_NAMES[dup] + '에 쓰고 있어요.'); return; }
      settings.bindings[action] = code;
      ui.bindingTarget = null;
      applySettings(); persist(); renderPhone();
      if (host.onKeysChanged) host.onKeysChanged();
      var b = $('#overlay [data-bind="' + action + '"]'); if (b) b.focus();
      return;
    }
    if (e.isComposing) return;
    // 2) Esc — 열린 휴대폰·지도 닫기
    if (e.key === 'Escape' && ui.panel) { e.preventDefault(); closePanel(); return; }
    // 3) 지도 키
    var typing = e.target && e.target.matches && e.target.matches('input,textarea,select,[contenteditable="true"]');
    if (!typing && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat && keyCode(e) === settings.bindings.map) {
      if (ui.panel === 'map') { e.preventDefault(); closePanel(); return; }
      if (!ui.panel && allowed() && host && !host.busy()) { e.preventDefault(); openMap(); return; }
    }
    // 인벤토리 키 — 앱 대화·튜토리얼 중에는 열지 않는다.
    if (!typing && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat && keyCode(e) === settings.bindings.inventory && fishingFeature && allowed() && !host.busy()) {
      e.preventDefault(); fishingFeature.toggleInventory(); return;
    }
    // 4) 열린 화면 안에서 Tab 순환
    if (e.key === 'Tab' && ui.panel) {
      var a = Array.prototype.filter.call($('#overlay').querySelectorAll('button:not(:disabled),textarea,a[href],input,select'),
        function (x) { return x.offsetParent !== null; });
      if (!a.length) return;
      var first = a[0], last = a[a.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  // ---------------------------------------------------------------- 공개 API
  function init(h) {
    host = h;
    document.querySelectorAll('[data-icon]').forEach(function (e) { e.innerHTML = icon(e.dataset.icon); });
    $('#phone-launch').onclick = function () { openPhone('home'); };
    $('#overlay').addEventListener('click', function (e) { if (e.target === $('#overlay')) closePanel(); });
    document.addEventListener('keydown', onKeyDown);
    applySettings();
    updateBadge();
  }
  function attach(e) {
    var uid = host && host.userId();
    if (fishingFeature && (engine !== e || fishingUser !== uid)) { fishingFeature.destroy(); fishingFeature = null; }
    engine = e;
    applySettings();
    if (!fishingFeature && uid && window.createFishingFeature) {
      fishingUser = uid;
      fishingFeature = window.createFishingFeature({
        engine: engine, ui: ui, openPanel: openPanel, closePanel: closePanel, setupFocus: focusFirst,
        toast: toast, icon: icon, keyLabel: codeLabel, allowed: allowed, isBusy: host.busy,
        storageKey: 'social-world-inventory-v1:' + encodeURIComponent(uid)
      });
    }
  }
  function sync(ctx) {
    ui.ctx = { inVillage: !!ctx.inVillage, tour: !!ctx.tour, roomBusy: !!ctx.roomBusy };
    $('#phone-launch').hidden = ui.ctx.tour || ui.ctx.roomBusy;
    if (ui.panel && !allowed()) closePanel();
    if (ui.ctx.tour) hideNotice();
    if (fishingFeature) { if (!allowed()) fishingFeature.cancel(); fishingFeature.updateHud(); }
    scheduleNotice();
  }
  function reset() {
    closePanel();
    if (fishingFeature) fishingFeature.destroy();
    fishingFeature = null; fishingUser = null;
    hideNotice();
    clearTimeout(ui.noticeTimer); ui.noticeTimer = null;
    ui.notice = null; ui.noticeUser = null;
    updateBadge();
  }

  window.WorldUI = {
    init: init,
    attach: attach,
    sync: sync,
    reset: reset,
    close: closePanel,
    isOpen: function () { return !!ui.panel; },
    keyLabel: function (action) { return codeLabel(settings.bindings[action] || DEFAULT_BINDINGS[action] || ''); },
    openPhone: openPhone,
    openMap: openMap,
    target: function(t){ return fishingFeature ? fishingFeature.target(t) : t; },
    interactFishing: function(options){ return fishingFeature ? fishingFeature.interact(options) : false; },
    tick: function(){ if (fishingFeature) fishingFeature.tick(); },
    cancelFishing: function(){ if (fishingFeature) fishingFeature.cancel(); },
    isFishing: function(){ return !!(fishingFeature && fishingFeature.state); },
    openInventory: function(){ if (fishingFeature) fishingFeature.toggleInventory(); },
    get fishing(){ return fishingFeature; },
    state: ui            // 테스트·디버그용
  };
})();
