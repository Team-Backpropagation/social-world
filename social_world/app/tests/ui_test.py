# 휴대폰·지도·설정·코코 알림(ui.js)을 앱(app.js)에 붙인 결과 테스트 — 배포용 socialworld-demo.html 로 돈다
#  - supabase 스크립트를 가짜(상태를 기억하는 작은 DB)로 바꿔 끼워 팀 DB 없이 돈다
#  - 확인: 휴대폰 열기·닫기(걷기 막힘) → 미션 시작·완료(DB, 효과음) → 동아리 가입(DB)
#          → 연락처로 루미 찾아가기 → 위기 선택지 → report_crisis·109 안내 → 지도(M)로 공원 이동
#          → 설정: 키 바꾸기(E→Q)·화질·북쪽 고정·효과음 → 코코 알림 → 코코 창 → 투어 중엔 휴대폰 숨김 → 로그아웃
# 실행: python social_world/app/bundle.py && python social_world/app/tests/ui_test.py
#   three.js CDN에 접속할 수 없는 환경이면 SW_THREE_PATH=로컬/three.min.js 를 준다
import functools, http.server, math, os, pathlib, re, sys, threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]          # social_world/
DEMO = ROOT / 'socialworld-demo.html'
SHOTS = pathlib.Path(__file__).resolve().parent

FAKE_SUPABASE = r"""
(function(){
  var DB = {
    profiles: [{ id:'u1', nickname:'테스트', onboarded_at:'2026-09-30T00:00:00Z', sgg_code:'11680', age_group:'20대', gender:'M', avatar:null, interests:['운동'], join_goal:null }],
    cohort_feedback: [{ npc_emphasis:'psych', priority_missions:['공원 산책하기'], updated_at:'2026-10-01' }],
    clubs: [{ id:2, name:'보드게임 동아리', category:'게임', description:'주말마다 한 판', member_count:[{count:3}], created_at:'2026-09-01' },
            { id:3, name:'아침 러닝', category:'체육', description:'7시 공원', member_count:[{count:5}], created_at:'2026-09-02' }],
    club_members: [],
    missions: [{ id:1, title:'광장 방문하기', description:'이장님께 인사', reward_point:10, is_active:true },
               { id:2, title:'NPC와 대화하기', description:'주민 한 명과 이야기', reward_point:20, is_active:true },
               { id:3, title:'공원 산책하기', description:'공원 한 바퀴', reward_point:30, is_active:true }],
    mission_progress: [{ user_id:'u1', mission_id:2, status:'in_progress' }],
    world_events_public: []
  };
  window.__writes = []; window.__rpcs = [];
  function q(table){
    var op = 'select', row = null, filters = [], single = false;
    var b = {
      select: function(){ return b; }, order: function(){ return b; }, limit: function(){ return b; },
      eq: function(c, v){ filters.push([c, v]); return b; },
      maybeSingle: function(){ single = true; return b; }, single: function(){ single = true; return b; },
      insert: function(r){ op = 'insert'; row = r; return b; }, update: function(r){ op = 'update'; row = r; return b; },
      upsert: function(r){ op = 'upsert'; row = r; return b; },
      then: function(ok, bad){
        var rows = DB[table] || [], res;
        var match = function(r){ return filters.every(function(f){ return r[f[0]] === f[1]; }); };
        if(op === 'insert' || op === 'upsert'){ window.__writes.push({ table: table, op: op, row: row }); rows.push(Object.assign({}, row)); res = { data: row, error: null }; }
        else if(op === 'update'){ window.__writes.push({ table: table, op: op, row: row, filters: filters }); rows.filter(match).forEach(function(r){ Object.assign(r, row); }); res = { data: null, error: null }; }
        else { var d = rows.filter(match).map(function(r){ return Object.assign({}, r); }); res = { data: single ? d[0] || null : d, error: null }; }
        return Promise.resolve(res).then(ok, bad);
      }
    };
    return b;
  }
  var session = { user: { id: 'u1' } };
  window.supabase = { createClient: function(){ return {
    auth: {
      getSession: function(){ return Promise.resolve({ data: { session: session } }); },
      onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; },
      signInAnonymously: function(){ return Promise.resolve({ data: { session: session } }); },
      signOut: function(){ window.__signedOut = true; return Promise.resolve({}); }
    },
    from: q,
    rpc: function(name, args){
      window.__rpcs.push({ name: name, args: args });
      if(name === 'recommend_activities') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    }
  }; } };
})();
"""

def instrument(html):
    a = 'try { ENGINE = makeEngine(); }'
    assert html.count(a) == 1
    html = html.replace(a, 'try { ENGINE = makeEngine(); window.__ENGINE = ENGINE; }')
    # 효과음은 기록만 (헤드리스에서 소리 재생 대신)
    s = 'window.WorldUI = {'
    assert html.count(s) == 1
    return html.replace(s, 'window.__sounds = []; if (window.Sound) window.Sound.play = function (n) { window.__sounds.push(n); return Promise.resolve(false); };\n  ' + s)

fails = []
def check(cond, name):
    print(('PASS  ' if cond else 'FAIL  ') + name)
    if not cond: fails.append(name)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/socialworld-demo.html'
three_path = os.environ.get('SW_THREE_PATH')

def new_page(b, w, h):
    ctx = b.new_context(viewport={'width': w, 'height': h}, timezone_id='Asia/Seoul', locale='ko-KR')
    ctx.route(re.compile(r'.*/supabase-js@2/.*'), lambda r: r.fulfill(status=200, content_type='text/javascript', body=FAKE_SUPABASE))
    if three_path:
        ctx.route(re.compile(r'.*/three@[^/]+/.*'), lambda r: r.fulfill(status=200, content_type='text/javascript', body=pathlib.Path(three_path).read_text()))
    ctx.route('**/socialworld-demo.html*', lambda r: r.fulfill(status=200, content_type='text/html; charset=utf-8', body=instrument(DEMO.read_text(encoding='utf-8'))))
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, content_type='text/css', body=''))
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(URL, wait_until='commit')
    pg.wait_for_function('window.__ENGINE && window.__ENGINE.isRunning()', timeout=90000)
    return ctx, pg, errors

def pos(pg): return pg.evaluate('window.__ENGINE.playerPos()')
def moved(a, c): return abs(a['x'] - c['x']) + abs(a['z'] - c['z'])
def writes(pg, table): return [w for w in pg.evaluate('window.__writes') if w['table'] == table]

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--proxy-bypass-list=<-loopback>'])
    for w, h, tag in [(1280, 820, 'desktop'), (390, 800, 'mobile')]:
        ctx, pg, errors = new_page(b, w, h)
        T = lambda s: f'[{tag}] {s}'

        # ---- 기본 화면
        check(pg.evaluate('typeof window.WorldUI') == 'object' and pg.locator('#phone-launch').is_visible(), T('마을에 휴대폰 버튼이 보임'))
        check(pg.locator('#hud-gfx').count() == 0 and pg.locator('#hud-logout').count() == 0, T('화질·로그아웃 버튼은 HUD에서 빠짐(휴대폰 설정으로)'))
        check('M</b> 지도' in pg.locator('#hud-help').inner_html(), T('도움말에 지도 키 안내'))

        # ---- 코코 알림 (마을에 들어오고 잠시 뒤 1번)
        pg.wait_for_selector('#notification:not([hidden])', timeout=20000)
        check('코코' in pg.locator('#notification').inner_text() and pg.locator('#unread-badge').is_visible(), T('코코 알림 + 휴대폰 배지'))
        check('cocoNotification' in pg.evaluate('window.__sounds'), T('알림 효과음'))
        pg.click('#notify-open')
        pg.wait_for_selector('.coco-backdrop')
        check(pg.locator('#unread-badge').is_hidden(), T('알림 누르면 코코 창 열리고 배지 사라짐'))
        pg.keyboard.press('Escape')

        # ---- 휴대폰 열기 → 걷기 막힘 → Esc
        pg.click('#phone-launch')
        pg.wait_for_selector('.phone-dialog')
        check('테스트님' in pg.locator('.phone-home-welcome').inner_text(), T('휴대폰 홈 — 닉네임 인사'))
        before = pos(pg)
        pg.keyboard.down('w'); pg.wait_for_timeout(400); pg.keyboard.up('w')
        check(moved(before, pos(pg)) < 0.01, T('휴대폰이 열려 있으면 캐릭터가 안 움직임'))
        box = pg.locator('.phone-dialog').bounding_box()
        check(box['x'] >= 0 and box['x'] + box['width'] <= w + 1 and box['height'] <= h + 1, T('휴대폰 화면이 창 안에 들어감'))
        pg.screenshot(path=str(SHOTS / f'ui_{tag}_phone.png'))
        pg.keyboard.press('Escape')
        check(pg.locator('#overlay').is_hidden(), T('Esc로 닫힘'))

        # ---- 미션: 추천 순서·시작·완료(DB)·효과음
        pg.click('#phone-launch'); pg.click('.phone-nav [data-nav="missions"]')
        pg.wait_for_selector('#mission-3')
        titles = pg.locator('.content-card h3').all_inner_texts()
        check(titles[0] == '공원 산책하기' and '추천' in pg.locator('#mission-3 .type-tag').inner_text(), T('미션 — 환류 추천 미션이 맨 위·추천 표시'))
        pg.click('#mission-1 [data-start]')
        pg.wait_for_selector('#mission-1 [data-complete]')
        check(any(x['op'] == 'insert' and x['row']['mission_id'] == 1 and x['row']['status'] == 'in_progress' for x in writes(pg, 'mission_progress')), T('미션 시작 → mission_progress insert'))
        pg.click('#mission-2 [data-complete]')
        pg.wait_for_function('document.querySelector("#mission-2 .type-tag").textContent.includes("완료")')
        up = [x for x in writes(pg, 'mission_progress') if x['op'] == 'update']
        check(len(up) == 1 and up[0]['row']['status'] == 'done' and ['mission_id', 2] in up[0]['filters'] and ['user_id', 'u1'] in up[0]['filters'], T('미션 완료 → 내 행만 done으로 update'))
        check('missionComplete' in pg.evaluate('window.__sounds'), T('미션 완료 효과음'))
        check('1개 완료' in pg.locator('.phone-list-intro .pill').inner_text(), T('완료 개수 표시'))

        # ---- 동아리 가입
        pg.click('.phone-nav [data-nav="clubs"]')
        pg.wait_for_selector('#club-3')
        pg.click('#club-3 [data-join-club]')
        pg.wait_for_function('document.querySelector("#club-3 [data-join-club]").disabled')
        cm = writes(pg, 'club_members')
        check(len(cm) == 1 and cm[0]['row'] == {'club_id': 3, 'user_id': 'u1'}, T('동아리 가입 → club_members insert'))

        # ---- 연락처 → 루미 찾아가기 → 위기 선택지
        pg.click('.phone-nav [data-nav="contacts"]')
        names = pg.locator('.record-row b').all_inner_texts()
        check(names[:3] == ['루미', '코코', '마을이장'], T('연락처 — 루미·코코·이장 순'))
        check('저장하지 않아요' in pg.locator('.info-note').inner_text(), T('대화 미저장 안내'))
        pg.click('.record-row[data-contact="psych"]')
        pg.wait_for_selector('#npc-modal-backdrop', timeout=10000)
        lumi = pg.evaluate('window.__ENGINE.npcPositions().find(n => n.id === "psych")')
        here = pos(pg)
        check(math.hypot(lumi['x'] - here['x'], lumi['z'] - here['z']) < 2.2, T('루미 바로 앞으로 순간이동'))
        check('루미' in pg.locator('.npc-modal-name').inner_text(), T('루미 대화창 열림'))
        for label in ['요즘 좀 지치고 힘들어', '속얘기할 사람이 별로 없어', '사실 다 그만두고 싶을 때가 있어']:
            pg.get_by_role('button', name=label).click()
        pg.wait_for_selector('.crisis-box')
        check('109' in pg.locator('.crisis-box').inner_text() and '1577-0199' in pg.locator('.crisis-box').inner_text(), T('위기 선택지 → 109·1577-0199 안내'))
        check(pg.evaluate('window.__rpcs.filter(r => r.name === "report_crisis").length') == 1, T('report_crisis 1회'))
        pg.get_by_role('button', name='알겠어').click()
        pg.get_by_role('button', name='대화 마치기').click()
        ns = writes(pg, 'npc_sessions')
        check(len(ns) == 1 and ns[0]['row']['severity_score'] == 1 and set(ns[0]['row']) == {'npc_type', 'started_at', 'ended_at', 'risk_keyword_count', 'severity_score', 'keyword_tags'},
              T('npc_sessions — 원문 없이 신호 수치만'))

        # ---- 지도(M) → 공원
        pg.keyboard.press('m')
        pg.wait_for_selector('.map-dialog')
        check(pg.locator('.map-point').count() == 13, T('지도 — 장소 13곳(버스 정류장 포함)'))
        pg.screenshot(path=str(SHOTS / f'ui_{tag}_map.png'))
        pg.click('.map-point[data-place="park"]')
        park = pg.evaluate('window.__ENGINE.places().park')
        pg.wait_for_timeout(300)
        check(pg.locator('#overlay').is_hidden() and moved(park, pos(pg)) < 0.5, T('지도에서 공원 → 공원 앞으로 이동'))
        pg.keyboard.press('m'); pg.wait_for_selector('.map-dialog'); pg.keyboard.press('m')
        check(pg.locator('#overlay').is_hidden(), T('M으로 지도 열고 닫기'))

        # ---- 설정: 상호작용 키 E → Q
        pg.click('#phone-launch'); pg.click('.phone-nav [data-nav="settings"]')
        pg.click('[data-bind="interact"]')
        pg.keyboard.press('w')
        check('쓰고 있어요' in pg.locator('#binding-status').inner_text(), T('다른 동작에 쓰는 키는 거절'))
        pg.keyboard.press('q')
        check(pg.locator('[data-bind="interact"]').inner_text() == 'Q', T('상호작용 키가 Q로 바뀜'))
        saved = pg.evaluate('JSON.parse(localStorage.getItem("sw_ui_settings_v1"))')
        check(saved['bindings']['interact'] == 'KeyQ' and set(saved) == {'north', 'quality', 'bindings', 'muted'}, T('설정만 브라우저에 저장(대화·알림 없음)'))
        pg.select_option('#setting-quality', 'low')
        check(pg.evaluate('window.__ENGINE.gfxHigh()') is False, T('화질 가벼움 적용'))
        pg.select_option('#setting-north', 'rotate')
        check(pg.evaluate('window.__SW_NORTH_FIXED') is False, T('미니맵 시점 회전 적용'))
        pg.select_option('#setting-north', 'fixed')
        pg.keyboard.press('Escape')
        chief = pg.evaluate('window.__ENGINE.places().chief')
        pg.evaluate('p => window.__ENGINE.enter("village", { spawn: { x: p.x, z: p.z } })', chief)
        pg.wait_for_function('!document.getElementById("hud-act").hidden && document.getElementById("hud-act").textContent.includes("마을이장")', timeout=10000)
        check('(Q)' in pg.locator('#hud-act').inner_text(), T('대화 버튼에 바뀐 키 표시'))
        pg.keyboard.press('e')
        pg.wait_for_timeout(300)
        check(pg.locator('.chief-panel').count() == 0, T('E는 더 이상 대화를 열지 않음'))
        pg.keyboard.press('q')
        pg.wait_for_selector('.chief-panel')
        check(True, T('Q로 이장 대화 열림'))
        pg.keyboard.press('m')
        check(pg.locator('#overlay').is_hidden(), T('대화창이 떠 있으면 지도 키 무시'))
        pg.keyboard.press('Escape')

        check(pg.locator('#notification').is_hidden() and pg.evaluate('window.__sounds.filter(n => n === "cocoNotification").length') == 1, T('코코 알림은 로그인당 한 번'))

        # ---- 투어 중엔 휴대폰 숨김·지도 키 무시
        pg.evaluate('window.WorldUI.sync({ inVillage: true, tour: true, roomBusy: false })')
        check(pg.locator('#phone-launch').is_hidden(), T('투어 중 휴대폰 버튼 숨김'))
        pg.keyboard.press('m')
        check(pg.locator('#overlay').is_hidden(), T('투어 중 지도 키 무시'))
        pg.evaluate('window.WorldUI.sync({ inVillage: true, tour: false, roomBusy: false })')

        # ---- 로그아웃
        pg.click('#phone-launch'); pg.click('.phone-nav [data-nav="settings"]')
        pg.click('#setting-logout')
        pg.wait_for_selector('#btn-guest', timeout=10000)
        check(pg.evaluate('window.__signedOut') is True and pg.locator('#phone-launch').is_hidden(), T('설정 → 로그아웃 → 로그인 화면, 휴대폰 숨김'))
        check(not errors, T('페이지 오류 없음') + (f' — {errors[:2]}' if errors else ''))
        ctx.close()
    b.close()

print('모두 통과' if not fails else f'실패 {len(fails)}건')
sys.exit(1 if fails else 0)
