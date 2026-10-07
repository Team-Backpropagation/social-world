// 미리보기·테스트 전용(데모에는 넣지 않음) — 07_feedback_chat.sql의 함수들을 브라우저 메모리로 흉내 낸다(DB 없이 화면 확인)
// 시민 미리보기(feedback-preview.html)와 운영팀 미리보기(admin/admin-preview.html)가 같이 쓴다.
// localStorage를 쓰면 두 미리보기를 나란히 열어 시민 ⇄ 운영팀 대화를 직접 해 볼 수 있다(?shared=1).
(function (global) {
  'use strict';
  var KEY = 'eum-fake-feedback';
  var shared = /[?&]shared=1/.test(location.search);
  var now = Date.now();
  function iso(minAgo) { return new Date(now - minAgo * 60000).toISOString(); }
  var seed = {
    seq: 4,
    rows: [
      { id: 1, user: 'me', channel: 'chief', kind: 'bug', place: '광장', serv_id: null, body: '분수 앞에서 캐릭터가 가끔 멈춰요.',
        status: 'seen', created_at: iso(60 * 26), updated_at: iso(60 * 3), read_at: iso(60 * 20),
        messages: [{ who: 'staff', body: '알려줘서 고마워요! 어느 기기에서 그랬는지 알려 줄 수 있을까요?', at: iso(60 * 3) }] },
      { id: 2, user: 'me', channel: 'haru', kind: 'info', place: '지원센터', serv_id: 'WLF00006014', program_name: '강남구 교통비 지원사업',
        body: '청년 지원은 10월부터라고 돼 있어요.', status: 'new', created_at: iso(90), updated_at: iso(90), read_at: null, messages: [] },
      { id: 3, user: 'other', channel: 'chief', kind: 'feature', place: '공원', serv_id: null, body: '공원에 같이 앉을 벤치가 더 있으면 좋겠어요.',
        status: 'done', created_at: iso(60 * 50), updated_at: iso(60 * 30), read_at: null,
        messages: [{ who: 'staff', body: '다음 업데이트에 벤치 두 개를 더 놓을게요.', at: iso(60 * 30) }] }
    ],
    today: 0
  };
  var db;
  function load() {
    if (shared) { try { db = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { db = null; } }
    if (!db) db = JSON.parse(JSON.stringify(seed));
  }
  function save() { if (shared) try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* 무시 */ } }
  function mask(t) {
    return t.replace(/0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}/g, '[전화번호]').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[이메일]');
  }
  var CRISIS = /(죽고\s*싶|사라지고\s*싶|자살|살기\s*싫)/;
  function unreadOf(f) { return f.messages.some(function (m) { return m.who === 'staff' && (!f.read_at || m.at > f.read_at); }); }
  function alias(u) { return u === 'me' ? '주민 #7F3A' : '주민 #21C0'; }
  function lastWho(f) { return f.messages.length ? f.messages[f.messages.length - 1].who : 'citizen'; }

  var log = [];
  function fns(role) {
    return {
      submit_feedback: function (a) {
        if (CRISIS.test(a.p_body)) return 'crisis';
        if (db.today >= 5) return 'too_many';
        db.today++;
        var id = ++db.seq;
        db.rows.push({ id: id, user: 'me', channel: a.p_channel, kind: a.p_kind, place: a.p_place, serv_id: a.p_serv_id || null,
          body: mask(a.p_body.trim()), status: 'new', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), read_at: null, messages: [] });
        return 'saved';
      },
      my_feedback: function () {
        return db.rows.filter(function (f) { return f.user === 'me'; }).sort(function (x, y) { return y.updated_at < x.updated_at ? -1 : 1; }).map(function (f) {
          return { id: f.id, channel: f.channel, kind: f.kind, place: f.place, serv_id: f.serv_id, program_name: f.program_name || null, body: f.body,
            status: f.status, created_at: f.created_at, updated_at: f.updated_at, unread: unreadOf(f),
            messages: f.messages.map(function (m) { return { who: m.who === 'staff' ? 'staff' : 'me', body: m.body, at: m.at }; }) };
        });
      },
      my_feedback_unread: function () { return db.rows.filter(function (f) { return f.user === 'me' && unreadOf(f); }).length; },
      read_my_feedback: function (a) { var f = byId(a.p_id); if (!f || f.user !== 'me') return false; f.read_at = new Date().toISOString(); return true; },
      reply_my_feedback: function (a) {
        var f = byId(a.p_id); if (!f || f.user !== 'me') return 'not_found';
        if (CRISIS.test(a.p_body)) return 'crisis';
        var t = new Date().toISOString();
        f.messages.push({ who: 'citizen', body: mask(a.p_body.trim()), at: t });
        f.updated_at = t; f.read_at = t; if (f.status === 'done') f.status = 'seen';
        return 'saved';
      },
      delete_my_feedback: function (a) {
        var n = db.rows.length; db.rows = db.rows.filter(function (f) { return !(f.id === a.p_id && f.user === 'me'); }); return db.rows.length < n;
      },
      am_i_staff: function () { return role === 'staff'; },
      staff_feedback_list: function (a) {
        if (role !== 'staff') throw { message: 'staff_only' };
        return db.rows.filter(function (f) { return !a.p_channel || f.channel === a.p_channel; })
          .sort(function (x, y) { return (x.status === 'done') - (y.status === 'done') || (y.updated_at < x.updated_at ? -1 : 1); })
          .map(function (f) {
            return { id: f.id, alias: alias(f.user), channel: f.channel, kind: f.kind, place: f.place, serv_id: f.serv_id, program_name: f.program_name || null,
              body: f.body, status: f.status, created_at: f.created_at, updated_at: f.updated_at,
              waiting: lastWho(f) === 'citizen' && f.status !== 'done', messages: f.messages.slice() };
          });
      },
      staff_reply: function (a) {
        if (role !== 'staff') throw { message: 'staff_only' };
        var f = byId(a.p_id); if (!f) return 'not_found';
        var t = new Date().toISOString();
        f.messages.push({ who: 'staff', body: a.p_body.trim(), at: t }); f.updated_at = t; if (f.status === 'new') f.status = 'seen';
        return 'saved';
      },
      staff_set_status: function (a) {
        if (role !== 'staff') throw { message: 'staff_only' };
        var f = byId(a.p_id); if (!f) return false; f.status = a.p_status; f.updated_at = new Date().toISOString(); return true;
      }
    };
  }
  function byId(id) { return db.rows.filter(function (f) { return f.id === id; })[0]; }

  // role: 'citizen' | 'staff'. mode: 'ok' | 'missing'(07 적용 전) | 'fail'(네트워크)
  function client(role, mode) {
    load();
    var session = role === 'citizen' ? { user: { email: null } } : null;
    var accounts = { 'staff@eum.test': 'staff', 'citizen@eum.test': 'citizen' };
    var who = role;
    return {
      rpc: async function (name, args) {
        await new Promise(function (r) { setTimeout(r, 120); });
        load();
        log.push(name + ' ' + JSON.stringify(args || {}));
        if (mode === 'fail') throw new Error('Failed to fetch');
        if (mode === 'missing') return { data: null, error: { message: 'Could not find the function public.' + name } };
        try {
          var f = fns(who)[name];
          if (!f) return { data: null, error: { message: 'unknown ' + name } };
          var out = f(args || {}); save();
          return { data: out, error: null };
        } catch (e) { return { data: null, error: e }; }
      },
      auth: {
        getSession: async function () { return { data: { session: session } }; },
        signInWithPassword: async function (c) {
          await new Promise(function (r) { setTimeout(r, 120); });
          if (!accounts[c.email] || c.password !== 'test1234') return { data: null, error: { message: 'Invalid login credentials' } };
          who = accounts[c.email]; session = { user: { email: c.email } };
          return { data: { session: session }, error: null };
        },
        signOut: async function () { session = null; return { error: null }; }
      }
    };
  }
  global.FakeFeedbackDB = { client: client, log: log, reset: function () { db = JSON.parse(JSON.stringify(seed)); save(); } };
})(window);
