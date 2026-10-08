# 데모(socialworld-demo.html)에 붙인 하루·마을 의견함 연결 테스트
#  - supabase 스크립트를 가짜로 바꿔 끼워 팀 DB 없이 돈다(로그인된 온보딩 완료 유저로 시작)
#  - 확인: 정책추천·취업상담 NPC가 빠지고 지원센터 문 앞에 하루 → E로 창 → 정책 카드·수요 로그(policy)
#          → [정보가 달라요]는 하루 창구로 → 걷기 막힘 → 휴대폰 연락처·내 의견함(새 답 배지)
#          → 이장 [마을에 건의하기] → 환류 강조(job)는 하루 머리 위 말풍선 → 루미에 취업 지침 갈래
# 실행: python social_world/app/bundle.py && python social_world/haru/tests/demo_test.py
#   three.js CDN에 접속할 수 없는 환경이면 SW_THREE_PATH=로컬/three.min.js 를 주면 그 파일로 대신한다
import functools, re, http.server, os, pathlib, sys, threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]          # social_world/
DEMO = ROOT / 'socialworld-demo.html'
HERE = pathlib.Path(__file__).resolve().parent

FAKE_SUPABASE = r"""
(function(){
  var PROGRAMS = [
    { serv_id:'WLF00005414', name:'강남구 신혼부부 청년 전월세 대출이자 지원사업', summary:'강남구 거주 신혼부부 및 청년 주거비 부담 완화', org:'서울특별시 강남구 도시환경국 주택과',
      region_label:'서울특별시 강남구', is_local:true, benefit_text:'대출이자 일부 지원', target_text:'강남구 거주 청년', criteria_text:null, apply_text:'구청 방문',
      detail_url:'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00005414', homepage:null, contact:'주택과 02-3423-0000',
      online_apply:null, last_checked:'2026-10-01', age_note:false, target_groups:[], reason:'서울특별시 강남구에서 하는 사업이에요' }
  ];
  var TABLES = {
    profiles: { id:'u1', nickname:'테스트', onboarded_at:'2026-09-30T00:00:00Z', sgg_code:'11680', age_group:'20대', gender:'F', avatar:null, interests:['게임'], join_goal:null },
    cohort_feedback: { npc_emphasis:'job', priority_missions:['지원센터 하루 만나기'], updated_at:'2026-10-06T00:00:00Z' },
    clubs: [], club_members: [], missions: [], mission_progress: [], world_events_public: []
  };
  window.__inserts = []; window.__rpcs = [];
  function q(table){
    var single = false, op = 'select', row = null;
    var b = {
      select: function(){ return b; }, eq: function(){ return b; }, order: function(){ return b; }, gte: function(){ return b; }, in: function(){ return b; }, limit: function(){ return b; },
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
  var RPC = {
    recommend_programs: function(a){ return a.p_special ? [] : PROGRAMS; },
    program_counts: function(){ return [{ eligible: 1, special: 0, ineligible: 2 }]; },
    submit_feedback: function(){ return 'saved'; },
    my_feedback_unread: function(){ return 1; },
    my_feedback: function(){ return [{ id: 7, channel:'chief', kind:'bug', place:'광장', serv_id:null, program_name:null, body:'분수 앞에서 멈춰요', status:'seen',
      created_at:'2026-10-06T01:00:00Z', updated_at:'2026-10-06T05:00:00Z', unread:true,
      messages:[{ who:'staff', body:'어느 기기였나요?', at:'2026-10-06T05:00:00Z' }] }]; },
    read_my_feedback: function(){ return true; }
  };
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
      return Promise.resolve({ data: RPC[name] ? RPC[name](args || {}) : null, error: null });
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

three_path = os.environ.get('SW_THREE_PATH')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/socialworld-demo.html'

def go_near(pg, spot, who):
    pg.evaluate('p => window.__ENGINE.enter("village", { spawn: { x: p.x + 1.0, z: p.z + 1.0 } })', spot)
    pg.wait_for_function('n => !document.getElementById("hud-act").hidden && document.getElementById("hud-act").textContent.includes(n)', arg=who, timeout=10000)

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
        pg.goto(URL, wait_until='commit')
        pg.wait_for_function('window.__ENGINE && window.__ENGINE.isRunning()', timeout=90000)
        check(pg.evaluate('typeof window.Haru') == 'object' and pg.evaluate('typeof window.Feedback') == 'object', f'[{tag}] haru.js·feedback.js 들어 있음(번들)')

        ids = pg.evaluate('window.__ENGINE.npcPositions().map(n => n.id)')
        check('haru' in ids and 'policy' not in ids and 'job' not in ids, f'[{tag}] 정책추천·취업상담 NPC 대신 하루 ({ids})')
        haru = pg.evaluate('window.__ENGINE.places().haru')
        sup = pg.evaluate('window.__ENGINE.places().support')
        gap = ((haru['x'] - sup['x'])**2 + (haru['z'] - sup['z'])**2) ** 0.5
        check(gap > 3.0, f'[{tag}] 하루와 지원센터 문이 E키 대상으로 겹치지 않음 (거리 {gap:.1f})')
        check(pg.evaluate('window.__ENGINE.bubbleNpc') == 'haru', f'[{tag}] 환류 강조 job → 하루 머리 위 말풍선')

        go_near(pg, haru, '하루')
        label = pg.locator('#hud-act').inner_text()
        check('하루 — 대화하기' in label, f'[{tag}] 가까이 가면 "{label}"')
        pg.screenshot(path=str(HERE / f'demo_{tag}_near.png'))
        pg.keyboard.press('e')
        pg.wait_for_selector('.haru-panel')
        check(pg.locator('.haru-menu').count() == 5, f'[{tag}] 하루 창 열림, 메뉴 5개')
        check(pg.locator('#npc-modal-backdrop').count() == 0, f'[{tag}] 기존 대본형 NPC 창은 안 뜸')
        before = pg.evaluate('window.__ENGINE.playerPos()')
        pg.keyboard.down('w'); pg.wait_for_timeout(400); pg.keyboard.up('w')
        after = pg.evaluate('window.__ENGINE.playerPos()')
        check(abs(before['x'] - after['x']) + abs(before['z'] - after['z']) < 0.01, f'[{tag}] 하루 창이 떠 있으면 캐릭터가 안 움직임')
        pg.keyboard.press('e')
        check(pg.locator('.haru-panel').count() == 1, f'[{tag}] E를 또 눌러도 창이 겹쳐 열리지 않음')

        pg.locator('[data-menu="housing"]').click()
        pg.wait_for_selector('.haru-item')
        rpcs = pg.evaluate('window.__rpcs')
        check({'name': 'recommend_programs', 'args': {'p_menu': 'housing', 'p_limit': 6, 'p_special': False}} in rpcs, f'[{tag}] 브라우저는 메뉴·개수만 보냄')
        logs = [i['row'] for i in pg.evaluate('window.__inserts') if i['table'] == 'npc_demand_logs']
        check(any(r == {'npc_type': 'policy', 'action': 'recommend', 'category': '주거비', 'item_id': 'WLF00005414'} for r in logs), f'[{tag}] 추천 수요 로그(policy·주거비)')
        check(any(r['action'] == 'ineligible' and r['item_id'] == 'count:2' for r in logs), f'[{tag}] 자격 미달 수 로그')
        check(not any(i['table'] == 'npc_sessions' for i in pg.evaluate('window.__inserts')), f'[{tag}] 하루 대화는 위험 신호(npc_sessions)로 남지 않음')
        pg.screenshot(path=str(HERE / f'demo_{tag}_cards.png'))
        pg.get_by_role('button', name='정보가 달라요').click()
        pg.locator('.haru-report textarea').fill('대출이자 지원은 끝났대요')
        pg.locator('.haru-report').get_by_role('button', name='보내기').click()
        pg.wait_for_function('document.querySelector(".haru-item").innerText.includes("내 의견함")')
        sub = [r['args'] for r in pg.evaluate('window.__rpcs') if r['name'] == 'submit_feedback']
        check(sub and sub[-1]['p_channel'] == 'haru' and sub[-1]['p_serv_id'] == 'WLF00005414', f'[{tag}] [정보가 달라요] → 하루 창구')
        pg.keyboard.press('Escape')
        check(pg.locator('.haru-panel').count() == 0, f'[{tag}] Esc로 닫힘')

        # 휴대폰: 새 답 배지 · 내 의견함 · 연락처
        pg.wait_for_function('window.WorldUI.state.fbUnread === 1', timeout=10000)
        check(not pg.locator('#unread-badge').is_hidden() and int(pg.locator('#unread-badge').inner_text()) >= 1, f'[{tag}] 운영팀 새 답 → 휴대폰 배지')
        pg.locator('#phone-launch').click()
        pg.wait_for_selector('.phone-dialog')
        app = pg.locator('[data-nav="feedback"]').first
        check(app.count() == 1 and pg.locator('#fb-app-badge').inner_text() == '1', f'[{tag}] 홈에 내 의견함 앱 + 배지')
        app.click()
        pg.wait_for_selector('.fb-item')
        check(pg.locator('#phone-title').inner_text() == '내 의견함', f'[{tag}] 내 의견함 화면')
        pg.locator('.fb-head').first.click()
        check('운영팀 · 사람이 직접 쓴 답' in pg.locator('.fb-thread').inner_text(), f'[{tag}] 운영팀 답(사람)이 보임')
        pg.wait_for_function('window.WorldUI.state.fbUnread === 0')
        check(any(r['name'] == 'read_my_feedback' for r in pg.evaluate('window.__rpcs')), f'[{tag}] 열면 읽음 처리, 새 답 수 0')
        pg.locator('.phone-nav [data-nav="contacts"]').click()
        contacts = pg.locator('#phone-content').inner_text()
        check('하루' in contacts and '정책추천' not in contacts and '취업상담' not in contacts, f'[{tag}] 연락처: 하루 있음, 옛 창구 없음')
        check('지원센터 앞' in contacts, f'[{tag}] 하루 역할 설명')
        pg.locator('.phone-nav [data-nav="home"]').click()
        pg.locator('[data-fb-compose]').click()
        check(pg.locator('#phone-title').inner_text() == '마을에 건의하기' and pg.locator('.fb-kind').count() == 3, f'[{tag}] 휴대폰 홈 → 마을에 건의하기 폼')
        pg.locator('[data-close]').click()

        # 이장 → 마을에 건의하기
        chief = pg.evaluate('window.__ENGINE.npcPositions().find(n => n.id === "chief")')
        go_near(pg, chief, '이장')
        pg.keyboard.press('e')
        pg.wait_for_selector('.chief-panel')
        pg.get_by_role('button', name='마을에 건의하기').click()
        check('운영팀 사람들이 직접' in pg.locator('.chief-bubble').inner_text(), f'[{tag}] 이장이 운영팀(사람)에게 전한다고 안내')
        pg.get_by_role('button', name='불편해요').click()
        pg.locator('.chief-panel textarea').fill('지도 글씨가 작아요')
        pg.locator('.chief-panel').get_by_role('button', name='보내기').click()
        pg.wait_for_function('document.querySelector(".chief-panel").innerText.includes("운영팀에 전할게요")')
        sub = [r['args'] for r in pg.evaluate('window.__rpcs') if r['name'] == 'submit_feedback']
        check(sub[-1] == {'p_channel': 'chief', 'p_kind': 'inconvenience', 'p_place': '광장', 'p_body': '지도 글씨가 작아요', 'p_serv_id': None}, f'[{tag}] 이장 창구로 저장')
        pg.get_by_role('button', name='이번 주 모임 보기').click()
        pg.wait_for_function('document.querySelector(".chief-panel") && !document.querySelector(".chief-panel textarea")')
        check(True, f'[{tag}] 이번 주 모임으로 돌아감')
        pg.keyboard.press('Escape')

        # 루미 — 취업 지침 갈래
        lumi = pg.evaluate('window.__ENGINE.npcPositions().find(n => n.id === "psych")')
        go_near(pg, lumi, '루미')
        pg.keyboard.press('e')
        pg.get_by_role('button', name='요즘 좀 지치고 힘들어').click()
        check(pg.get_by_role('button', name='취업 준비가 길어져서 지쳤어').count() == 1, f'[{tag}] 루미에 취업 지침 선택지')
        pg.get_by_role('button', name='취업 준비가 길어져서 지쳤어').click()
        pg.get_by_role('button', name='받을 수 있는 지원이 있을까?').click()
        check('지원센터에 있는 하루' in pg.locator('.npc-modal-text').inner_text(), f'[{tag}] 루미가 하루를 안내')
        check(not errors, f'[{tag}] 페이지 오류 없음' + (f' — {errors[:2]}' if errors else ''))
        ctx.close()
    b.close()

print('모두 통과' if not fails else f'실패 {len(fails)}건')
sys.exit(1 if fails else 0)
