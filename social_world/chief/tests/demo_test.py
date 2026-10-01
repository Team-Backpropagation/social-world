# 데모(socialworld-demo.html)에 붙인 마을이장 연결 테스트
#  - supabase 스크립트를 가짜로 바꿔 끼워 팀 DB 없이 돈다(로그인된 온보딩 완료 유저로 시작)
#  - 확인: 광장 이장에게 E → 이번 주 이벤트 카드(내 코호트 대상이 위, 근거는 안 보임) → "참여할래요" → join_world_event
#          → 창이 떠 있는 동안 걷기 막힘 → 닫으면 첫 퀘스트 완료(튜토리얼 흐름 유지)
#          → 05 적용 전(뷰 오류)·이벤트 없음일 때 안내만 하고 멈추지 않음
# 실행: python social_world/chief/tests/demo_test.py
#   three.js CDN에 접속할 수 없는 환경이면 SW_THREE_PATH=로컬/three.min.js 를 준다
import functools, http.server, os, pathlib, re, sys, threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]          # social_world/
DEMO = ROOT / 'socialworld-demo.html'
SHOTS = pathlib.Path(__file__).resolve().parent

FAKE_SUPABASE = r"""
(function(){
  var MODE = (location.hash.match(/mode=(\w+)/) || [])[1] || 'ok';
  var EVENTS = [
    { id: 11, title: '🌙 금요일 저녁 공원 산책', description: '금요일 저녁, 공원 한 바퀴를 같이 걸어요. 말 안 해도 괜찮아요.', place: 'park',
      starts_at: '2026-10-02T19:30:00+09:00', ends_at: '2026-10-02T20:30:00+09:00', featured: true, joined: false },
    { id: 12, title: '☕ 카페에서 차 한 잔', description: '목요일 저녁, 카페에 들러 차 한 잔 해요.', place: 'cafe',
      starts_at: '2026-10-01T20:00:00+09:00', ends_at: '2026-10-01T21:00:00+09:00', featured: false, joined: true }
  ];
  var TABLES = {
    profiles: { id:'u1', nickname:'테스트', onboarded_at:'2026-09-30T00:00:00Z', sgg_code:'11680', age_group:'20대', gender:'M', avatar:null, interests:['운동'], join_goal:null },
    cohort_feedback: null, clubs: [], club_members: [], missions: [], mission_progress: [],
    world_events_public: MODE === 'empty' ? [] : EVENTS
  };
  window.__inserts = []; window.__rpcs = []; window.__queries = [];
  function q(table){
    var single = false, op = 'select', row = null, mods = [];
    var b = {
      select: function(c){ mods.push('select=' + c); return b; }, eq: function(){ return b; },
      order: function(c, o){ mods.push('order=' + c + (o && o.ascending === false ? '.desc' : '')); return b; },
      limit: function(n){ mods.push('limit=' + n); return b; },
      maybeSingle: function(){ single = true; return b; }, single: function(){ single = true; return b; },
      insert: function(r){ op = 'insert'; row = r; return b; }, update: function(r){ op = 'update'; row = r; return b; },
      upsert: function(r){ op = 'upsert'; row = r; return b; },
      then: function(ok, bad){
        var res;
        window.__queries.push({ table: table, op: op, mods: mods });
        if(op !== 'select'){ window.__inserts.push({ table: table, op: op, row: row }); res = { data: row, error: null }; }
        else if(table === 'world_events_public' && MODE === 'premigration'){
          res = { data: null, error: { message: 'column world_events_public.joined does not exist' } };
        }
        else { var d = TABLES[table]; if(d === undefined) d = []; res = { data: single && Array.isArray(d) ? d[0] || null : d, error: null }; }
        return Promise.resolve(res).then(ok, bad);
      }
    };
    return b;
  }
  var session = { user: { id: 'u1' } };
  var joinedOnce = {};
  window.supabase = { createClient: function(){ return {
    auth: {
      getSession: function(){ return Promise.resolve({ data: { session: session } }); },
      onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; },
      signInAnonymously: function(){ return Promise.resolve({ data: { session: session } }); },
      signOut: function(){ return Promise.resolve({}); }
    },
    from: q,
    rpc: function(name, args){
      window.__rpcs.push({ name: name, args: args });
      if(name === 'join_world_event'){
        var first = !joinedOnce[args.p_event_id]; joinedOnce[args.p_event_id] = true;
        return Promise.resolve({ data: first, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }
  }; } };
})();
"""

def instrument(html):
    a = 'try { ENGINE = makeEngine(); }'
    assert html.count(a) == 1
    return html.replace(a, 'try { ENGINE = makeEngine(); window.__ENGINE = ENGINE; }')

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

def new_page(b, w, h, mode):
    ctx = b.new_context(viewport={'width': w, 'height': h}, timezone_id='Asia/Seoul', locale='ko-KR')
    ctx.route(re.compile(r'.*/supabase-js@2/.*'), lambda r: r.fulfill(status=200, content_type='text/javascript', body=FAKE_SUPABASE))
    if three_path:
        ctx.route(re.compile(r'.*/three@[^/]+/.*'), lambda r: r.fulfill(status=200, content_type='text/javascript', body=pathlib.Path(three_path).read_text()))
    ctx.route('**/socialworld-demo.html*', lambda r: r.fulfill(status=200, content_type='text/html; charset=utf-8', body=instrument(DEMO.read_text(encoding='utf-8'))))
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, content_type='text/css', body=''))
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(URL + '#mode=' + mode, wait_until='commit')
    pg.wait_for_function('window.__ENGINE && window.__ENGINE.isRunning()', timeout=90000)
    return ctx, pg, errors

def go_to_chief(pg):
    chief = pg.evaluate('(() => { const n = window.__ENGINE.places(); return n.chief; })()')
    pg.evaluate('p => window.__ENGINE.enter("village", { spawn: { x: p.x, z: p.z } })', chief)
    pg.wait_for_function('!document.getElementById("hud-act").hidden && document.getElementById("hud-act").textContent.includes("마을이장")', timeout=10000)

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--proxy-bypass-list=<-loopback>'])
    for w, h, tag in [(1280, 820, 'desktop'), (390, 800, 'mobile')]:
        ctx, pg, errors = new_page(b, w, h, 'ok')
        check(pg.evaluate('typeof window.Chief') == 'object', f'[{tag}] chief/chief.js 불러옴')
        go_to_chief(pg)
        check('마을이장' in pg.locator('#hud-act').inner_text(), f'[{tag}] 이장 옆에서 "마을이장 — 대화하기 (E)"')
        pg.keyboard.press('e')
        pg.wait_for_selector('.chief-item')
        check(pg.locator('.chief-panel').count() == 1 and pg.locator('#npc-modal-backdrop').count() == 0, f'[{tag}] 이장 창(모듈)이 열리고 대본 창은 안 뜸')
        check('테스트님' in pg.locator('.chief-bubble').inner_text(), f'[{tag}] 닉네임으로 인사')
        titles = pg.locator('.chief-title').all_inner_texts()
        check(titles == ['🌙 금요일 저녁 공원 산책', '☕ 카페에서 차 한 잔'], f'[{tag}] 이벤트 카드 2장, 내 코호트 대상(featured)이 위')
        q = [x for x in pg.evaluate('window.__queries') if x['table'] == 'world_events_public'][-1]
        check(q['mods'][0] == 'select=id,title,description,place,starts_at,ends_at,featured,joined' and 'order=featured.desc' in q['mods'],
              f'[{tag}] 공개 뷰만 읽고 featured는 정렬에만 씀')
        text = pg.locator('.chief-panel').inner_text()
        check(not any(wd in text for wd in ['추천', '대상', '강남', '20대', '남성', '위험', '고립', 'Lv']), f'[{tag}] 화면에 대상·근거·낙인 표현 없음')
        check('공원 · 10월 2일(금) 19:30' in text, f'[{tag}] 장소·시각 표시')
        check(pg.locator('.chief-act').nth(1).is_disabled() and '참여 신청했어요' in pg.locator('.chief-act').nth(1).inner_text(), f'[{tag}] 이미 참여한 이벤트는 신청 완료 표시')
        pg.screenshot(path=str(SHOTS / f'demo_{tag}_events.png'))

        before = pg.evaluate('window.__ENGINE.playerPos()')
        pg.keyboard.down('w'); pg.wait_for_timeout(400); pg.keyboard.up('w')
        after = pg.evaluate('window.__ENGINE.playerPos()')
        check(abs(before['x'] - after['x']) + abs(before['z'] - after['z']) < 0.01, f'[{tag}] 이장 창이 떠 있으면 캐릭터가 안 움직임')
        pg.keyboard.press('e')
        check(pg.locator('.chief-panel').count() == 1, f'[{tag}] E를 또 눌러도 창이 겹쳐 열리지 않음')

        pg.get_by_role('button', name='🌙 금요일 저녁 공원 산책 참여하기').click()
        pg.wait_for_function('document.querySelector(".chief-act").textContent.includes("참여 신청했어요")')
        check(pg.evaluate('window.__rpcs').count({'name': 'join_world_event', 'args': {'p_event_id': 11}}) == 1, f'[{tag}] 참여는 join_world_event(id)로만')
        check('공원에서 봐요' in pg.locator('.chief-bubble').inner_text(), f'[{tag}] 참여 후 이장 대사')
        check(not any(i['table'] == 'event_participation' for i in pg.evaluate('window.__inserts')), f'[{tag}] 참여 표에 직접 쓰지 않음')
        check(not any(i['table'] == 'npc_sessions' for i in pg.evaluate('window.__inserts')), f'[{tag}] 이장 대화는 위험 신호로 남지 않음')

        pg.get_by_role('button', name='대화 마치기').click()
        check(pg.locator('.chief-panel').count() == 0, f'[{tag}] 대화 마치기로 닫힘')
        pg.wait_for_selector('.sw-toast', timeout=3000)
        check('첫 퀘스트 완료' in pg.locator('.sw-toast').first.inner_text(), f'[{tag}] 닫으면 첫 퀘스트 완료(튜토리얼 흐름 유지)')
        pg.keyboard.press('e')
        pg.wait_for_selector('.chief-panel')
        pg.keyboard.press('Escape')
        check(pg.locator('.chief-panel').count() == 0, f'[{tag}] 다시 열고 Esc로 닫힘')
        check(not errors, f'[{tag}] 페이지 오류 없음' + (f' — {errors[:2]}' if errors else ''))
        ctx.close()

    for mode, expect, name in [('premigration', '준비 중', '05 적용 전(뷰 오류)'), ('empty', '준비 중', '공개 이벤트 없음')]:
        ctx, pg, errors = new_page(b, 1280, 820, mode)
        go_to_chief(pg)
        pg.keyboard.press('e')
        pg.wait_for_function('document.querySelector(".chief-bubble") && document.querySelector(".chief-bubble").textContent.includes("준비 중")', timeout=10000)
        check(pg.locator('.chief-item').count() == 0 and expect in pg.locator('.chief-bubble').inner_text(), f'[{mode}] {name}: 카드 없이 안내만')
        pg.get_by_role('button', name='대화 마치기').click()
        check(pg.locator('.chief-panel').count() == 0 and not errors, f'[{mode}] 닫기 정상, 페이지 오류 없음')
        ctx.close()
    b.close()

print('모두 통과' if not fails else f'실패 {len(fails)}건')
sys.exit(1 if fails else 0)
