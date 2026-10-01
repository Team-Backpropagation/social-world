# 데모(socialworld-demo.html)에 붙인 코코 연결 테스트
#  - supabase 스크립트를 가짜로 바꿔 끼워 팀 DB 없이 돈다(로그인된 온보딩 완료 유저로 시작)
#  - 확인: 동아리센터 앞 코코 배치 → 가까이 가면 "코코 — 대화하기 (E)" → E로 창 열림 → 추천 카드
#          → 수요 로그가 npc_demand_logs 칸 이름(item_id)으로 들어감 → 창이 떠 있는 동안 걷기 막힘
#          → "동아리 보러 가기"로 동아리센터 화면 이동
# 실행: python social_world/coco/tests/demo_test.py
#   three.js CDN에 접속할 수 없는 환경이면 SW_THREE_PATH=로컬/three.min.js 를 주면 그 파일로 대신한다
import functools, re, http.server, os, pathlib, sys, threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]          # social_world/
DEMO = ROOT / 'socialworld-demo.html'

FAKE_SUPABASE = r"""
(function(){
  var ITEMS = [
    { item_key:'activity:9', kind:'activity', title:'온라인 협동 퍼즐 게임', summary:'세 명이서 30분 동안 퍼즐 하나를 풀어요.', place_label:'온라인', time_label:'금·토 저녁 9시', is_online:true, apply_url:null, is_demo:true, stage:2, score:6, reason:"관심사 '게임'에 맞춰 골랐어" },
    { item_key:'club:2', kind:'club', title:'보드게임 동아리', summary:'주말마다 한 판', place_label:'동아리센터', time_label:null, is_online:true, apply_url:null, is_demo:false, stage:3, score:5, reason:"관심사 '게임'에 맞춰 골랐어" },
    { item_key:'activity:1', kind:'activity', title:'호숫가 저녁 러닝', summary:'천천히 5km', place_label:'춘천 호숫가 산책로', time_label:'목요일 저녁 7시', is_online:false, apply_url:'https://example.org/apply', is_demo:false, stage:3, score:5, reason:"관심사 '운동'에 맞춰 골랐어" }
  ];
  var TABLES = {
    profiles: { id:'u1', nickname:'테스트', onboarded_at:'2026-09-30T00:00:00Z', sgg_code:'51110', age_group:'20대', gender:'F', avatar:null, interests:['게임'], join_goal:null },
    cohort_feedback: null,
    clubs: [{ id:2, name:'보드게임 동아리', category:'게임', description:'주말마다 한 판', member_count:[{count:3}] }],
    club_members: [], missions: [], mission_progress: []
  };
  window.__inserts = []; window.__rpcs = [];
  function q(table){
    var single = false, op = 'select', row = null;
    var b = {
      select: function(){ return b; }, eq: function(){ return b; }, order: function(){ return b; },
      maybeSingle: function(){ single = true; return b; }, single: function(){ single = true; return b; },
      insert: function(r){ op = 'insert'; row = r; return b; }, update: function(r){ op = 'update'; row = r; return b; },
      then: function(ok, bad){
        var res;
        if(op === 'insert'){ window.__inserts.push({ table: table, row: row }); res = { data: row, error: null }; }
        else if(op === 'update'){ res = { data: null, error: null }; }
        else { var d = TABLES[table]; if(d === undefined) d = []; res = { data: single && Array.isArray(d) ? d[0] || null : d, error: null }; }
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
      signOut: function(){ return Promise.resolve({}); }
    },
    from: q,
    rpc: function(name, args){
      window.__rpcs.push({ name: name, args: args });
      if(name === 'recommend_activities') return Promise.resolve({ data: ITEMS, error: null });
      return Promise.resolve({ data: null, error: null });
    }
  }; } };
})();
"""

# 테스트에서만 데모 안쪽 상태를 들여다볼 수 있게 한 줄을 끼운다(파일은 바꾸지 않음)
def instrument(html):
    a = 'try { ENGINE = makeEngine(); }'
    assert html.count(a) == 1
    return html.replace(a, 'try { ENGINE = makeEngine(); window.__ENGINE = ENGINE; }')

fails = []
def check(cond, name):
    print(('PASS  ' if cond else 'FAIL  ') + name)
    if not cond: fails.append(name)

three_path = os.environ.get('SW_THREE_PATH')
# social_world 폴더를 로컬 http로 띄운다(coco/coco.js 상대 경로 그대로)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/socialworld-demo.html'
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--proxy-bypass-list=<-loopback>'])
    for w, h, tag in [(1280, 820, 'desktop'), (390, 800, 'mobile')]:
        ctx = b.new_context(viewport={'width': w, 'height': h})
        ctx.route(re.compile(r'.*/supabase-js@2/.*'), lambda r: r.fulfill(status=200, content_type='text/javascript', body=FAKE_SUPABASE))
        if three_path:
            ctx.route(re.compile(r'.*/three@[^/]+/.*'), lambda r: r.fulfill(status=200, content_type='text/javascript', body=pathlib.Path(three_path).read_text()))
        ctx.route('**/socialworld-demo.html', lambda r: r.fulfill(status=200, content_type='text/html; charset=utf-8', body=instrument(DEMO.read_text(encoding='utf-8'))))
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, content_type='text/css', body=''))
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        if os.environ.get('SW_DEBUG'):
            pg.on('request', lambda r: print('REQ', r.url[:90]))
            pg.on('requestfinished', lambda r: print('OK ', r.url[:90]))
            pg.on('requestfailed', lambda r: print('FAIL', r.url[:90], r.failure))
        pg.goto(URL, wait_until='commit')
        pg.wait_for_function('window.__ENGINE && window.__ENGINE.isRunning()', timeout=90000)
        check(pg.evaluate('typeof window.Coco') == 'object', f'[{tag}] coco/coco.js 불러옴')

        coco = pg.evaluate('window.__ENGINE.places().coco')
        club = pg.evaluate('window.__ENGINE.places().club')
        check(coco is not None, f'[{tag}] 동아리센터 앞에 코코 자리 있음')
        gap = ((coco['x'] - club['x'])**2 + (coco['z'] - club['z'])**2) ** 0.5
        check(gap > 3.0, f'[{tag}] 코코와 동아리센터 문이 E키 대상으로 겹치지 않음 (거리 {gap:.1f})')

        # 코코 옆으로 옮겨서 E
        pg.evaluate('p => window.__ENGINE.enter("village", { spawn: { x: p.x + 1.2, z: p.z + 1.2 } })', coco)
        pg.wait_for_function('document.getElementById("hud-act") && !document.getElementById("hud-act").hidden', timeout=10000)
        label = pg.locator('#hud-act').inner_text()
        check('코코' in label, f'[{tag}] 가까이 가면 "{label}"')
        pg.screenshot(path=str(pathlib.Path(__file__).resolve().parent / f'demo_{tag}_near.png'))
        pg.locator('#hud-act').click()
        pg.wait_for_selector('.coco-panel')
        check(pg.locator('.coco-choices .coco-btn').count() == 3, f'[{tag}] 코코 창 열림, 선택지 3개')
        check(pg.locator('.npc-modal-backdrop, #npc-modal-backdrop').count() == 0, f'[{tag}] 기존 대본형 NPC 창은 안 뜸')

        # 창이 떠 있는 동안 걷기 막힘
        before = pg.evaluate('window.__ENGINE.playerPos()')
        pg.keyboard.down('w'); pg.wait_for_timeout(400); pg.keyboard.up('w')
        after = pg.evaluate('window.__ENGINE.playerPos()')
        check(abs(before['x'] - after['x']) + abs(before['z'] - after['z']) < 0.01, f'[{tag}] 코코 창이 떠 있으면 캐릭터가 안 움직임')
        pg.keyboard.press('e')
        check(pg.locator('.coco-panel').count() == 1, f'[{tag}] E를 또 눌러도 창이 겹쳐 열리지 않음')

        pg.get_by_role('button', name='내 관심사로 찾아줘').click()
        pg.wait_for_selector('.coco-item')
        check(pg.locator('.coco-item').count() == 3, f'[{tag}] 추천 카드 3장')
        rpc = pg.evaluate('window.__rpcs')
        check(rpc and rpc[-1] == {'name': 'recommend_activities', 'args': {'p_mode': 'interest', 'p_limit': 3}}, f'[{tag}] 브라우저는 모드·개수만 보냄')
        pg.screenshot(path=str(pathlib.Path(__file__).resolve().parent / f'demo_{tag}_cards.png'))
        logs = [i['row'] for i in pg.evaluate('window.__inserts') if i['table'] == 'npc_demand_logs']
        check(len(logs) == 3 and all(set(r) == {'npc_type', 'action', 'category', 'item_id'} for r in logs), f'[{tag}] 수요 로그 3건, 03 칸 이름(item_id)으로 기록')
        check(not any(i['table'] == 'npc_sessions' for i in pg.evaluate('window.__inserts')), f'[{tag}] 코코 대화는 위험 신호(npc_sessions)로 남지 않음')

        pg.get_by_role('button', name='동아리 보러 가기').click()
        pg.wait_for_selector('text=보드게임 동아리', timeout=10000)
        check(pg.locator('.coco-backdrop').count() == 0, f'[{tag}] 동아리 보러 가기 → 창 닫힘')
        check(pg.locator('.club-list').count() == 1, f'[{tag}] 동아리센터 화면으로 이동')
        # 다시 광장으로 돌아와 코코를 또 열 수 있는지
        pg.locator('#btn-back').click()
        pg.wait_for_function('window.__ENGINE.isRunning()')
        pg.evaluate('p => window.__ENGINE.enter("village", { spawn: { x: p.x + 1.2, z: p.z + 1.2 } })', coco)
        pg.wait_for_function('!document.getElementById("hud-act").hidden && document.getElementById("hud-act").textContent.includes("코코")', timeout=10000)
        pg.keyboard.press('e')
        pg.wait_for_selector('.coco-panel')
        check(True, f'[{tag}] 돌아와서 다시 말 걸 수 있음')
        pg.keyboard.press('Escape')
        check(pg.locator('.coco-panel').count() == 0, f'[{tag}] Esc로 닫힘')
        check(not errors, f'[{tag}] 페이지 오류 없음' + (f' — {errors[:2]}' if errors else ''))
        ctx.close()
    b.close()

print('모두 통과' if not fails else f'실패 {len(fails)}건')
sys.exit(1 if fails else 0)
