/* Real UI/3D navigation against a fake Supabase client; no production writes. */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.SW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '../..');
const fixture = fs.readFileSync(path.join(__dirname, 'ui_test.py'), 'utf8').match(/FAKE_SUPABASE = r"""([\s\S]*?)"""/)[1];
const three = process.env.SW_THREE_PATH ? fs.readFileSync(process.env.SW_THREE_PATH, 'utf8') : null;
const shotDir = process.env.SW_MARKET_SHOTS || path.join(__dirname, 'market-shots');
fs.mkdirSync(shotDir, { recursive: true });
const checks = [];
function check(ok, name) { assert(ok, name); checks.push(name); console.log('PASS ' + name); }
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]); if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(root, '.' + rel);
  if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
  try {
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.mp3') ? 'audio/mpeg' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(file));
  } catch { res.statusCode = 404; res.end(); }
});
async function near(page, id) { await page.waitForFunction(id => __sw().state.near?.id === id, id, { timeout: 12000 }); }
async function goMap(page, id) { await page.keyboard.press('m'); await page.locator('[data-place="' + id + '"]').click(); await near(page, id); }
async function walkTo(page, id, key) {
  await page.keyboard.down(key);
  try { await near(page, id); } finally { await page.keyboard.up(key); }
}
async function fits(page, selector, width, height) {
  const box = await page.locator(selector).boundingBox();
  return box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1;
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.SW_CHROME_PATH, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    for (const [width, height, entry, reduced] of [[1280, 900, '/app/', false], [390, 800, '/app/', false], [1280, 900, '/socialworld-demo.html', false], [390, 800, '/socialworld-demo.html', true]]) {
      const tag = width + 'px ' + entry + (reduced ? ' reduced-motion' : '');
      const ctx = await browser.newContext({ viewport: { width, height }, locale: 'ko-KR', reducedMotion: reduced ? 'reduce' : 'no-preference' });
      await ctx.route('**/*supabase-js@2/**', r => r.fulfill({ contentType: 'text/javascript', body: fixture }));
      if (three) await ctx.route('**/*three@*/**', r => r.fulfill({ contentType: 'text/javascript', body: three }));
      await ctx.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, r => r.fulfill({ contentType: 'text/css', body: '' }));
      await ctx.addInitScript(() => { window.__SW_LITE = true; });
      const page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://127.0.0.1:' + server.address().port + entry, { waitUntil: 'commit' });
      await page.waitForFunction(() => window.MarketUI && window.__sw?.().engine?.isRunning(), null, { timeout: 90000 });
      check(await page.evaluate(() => !!__sw().engine.places().bus && !!__sw().engine.places()['market-bank']), tag + ' bus stop and market destinations built');
      await page.evaluate(() => {
        window.__phases = []; window.__phaseViews = {};
        window.addEventListener('socialworld:bus-phase', e => {
          __phases.push(e.detail.phase);
          __phaseViews[e.detail.phase] = { ...__sw().engine.marketInfo(), black: document.querySelector('#transit-fade').classList.contains('is-black') };
        });
      });
      await page.keyboard.press('m');
      check(await page.locator('[data-place]').count() === 13, tag + ' village map includes bus stop');
      await page.locator('[data-place="bus"]').click(); await near(page, 'bus');
      check((await page.locator('#hud-act').innerText()).includes('시장행 버스'), tag + ' stop interaction uses bus wording');
      const inventory = await page.evaluate(() => JSON.stringify(WorldUI.fishing.store.getState()));
      const avatar = await page.evaluate(() => JSON.stringify(__sw().state.profile.avatar));
      await page.screenshot({ path: path.join(shotDir, 'stop-' + width + (entry.includes('demo') ? '-bundle' : '') + '.png') });
      await page.keyboard.press('e'); await page.locator('#transit-card').waitFor();
      check(await fits(page, '#transit-card', width, height), tag + ' bus status fits viewport');
      const startPos = await page.evaluate(() => __sw().engine.playerPos());
      await page.keyboard.down('w'); await page.keyboard.press('m'); await page.keyboard.press('i'); await page.keyboard.press('e');
      await page.waitForTimeout(100); await page.keyboard.up('w');
      check(await page.evaluate(p => !WorldUI.isOpen() && Math.hypot(__sw().engine.playerPos().x - p.x, __sw().engine.playerPos().z - p.z) < .03, startPos), tag + ' travelling blocks movement, map, inventory and repeated interaction');
      check(await page.locator('#transit-card').count() === 1 && await page.locator('#phone-launch').isHidden(), tag + ' one bus presentation and no phone during travel');
      await page.waitForFunction(() => __phaseViews.blackout, null, { timeout: 15000 });
      check(await page.evaluate(() => __phaseViews.blackout.black && !__phaseViews.blackout.playerVisible), tag + ' boarding hides avatar and transition fades to black');
      await page.waitForFunction(() => !MarketUI.isTravelling() && __sw().engine.mode() === 'market', null, { timeout: 15000 });
      check(await page.evaluate(() => JSON.stringify(__phases) === JSON.stringify(['approach', 'boarding', 'departure', 'blackout', 'arriving', 'alighting', 'farewell'])), tag + ' all seven bus phases execute in order');
      check(await page.evaluate(() => { const i = __sw().engine.marketInfo(); return i.marketVisible && !i.villageVisible && i.playerVisible && !i.busVisible; }), tag + ' market is separate and avatar alights');
      check(await page.evaluate(() => { const p = __sw().engine.playerPos(), s = MarketWorldData.marketStop; return Math.hypot(p.x - s.x, p.z - s.z) < .03; }), tag + ' arrival lands beside market stop');
      check(await page.evaluate(saved => JSON.stringify(WorldUI.fishing.store.getState()) === saved, inventory), tag + ' inventory survives travel unchanged');
      await page.screenshot({ path: path.join(shotDir, 'market-' + width + (entry.includes('demo') ? '-bundle' : '') + '.png') });
      await page.keyboard.press('m');
      check(await page.locator('#map-title').innerText() === '이음 시장 지도' && await page.locator('[data-place]').count() === 4 && await page.locator('[data-place="support"]').count() === 0, tag + ' market map shows its four destinations');
      await page.locator('[data-place="market-bank"]').click(); await near(page, 'market-bank'); await page.keyboard.press('e');
      await page.waitForFunction(() => __sw().engine.mode() === 'bank');
      check(await page.locator('#hud-minimap').isHidden() && await page.evaluate(() => __sw().engine.marketInfo().interiors.bank), tag + ' bank entrance opens a walkable interior');
      await walkTo(page, 'bank-service', 'w'); await page.keyboard.press('e'); await page.locator('#market-service').waitFor();
      check(await fits(page, '.market-service', width, height), tag + ' bank service screen fits viewport');
      check(await page.locator('.market-bank-services article').count() === 2 && (await page.locator('#market-service').innerText()).includes('준비 중'), tag + ' bank displays preparation screens without fake balances');
      await page.keyboard.press('m'); await page.keyboard.press('i');
      check(await page.evaluate(() => !WorldUI.isOpen()), tag + ' bank service blocks other panels');
      await page.keyboard.press('Shift+Tab');
      check(await page.evaluate(() => document.activeElement.id === 'market-service-done'), tag + ' service keyboard focus stays inside dialog');
      await page.screenshot({ path: path.join(shotDir, 'bank-' + width + (entry.includes('demo') ? '-bundle' : '') + '.png') });
      await page.keyboard.press('Escape');
      check(await page.locator('#market-service').count() === 0, tag + ' bank service closes with Escape');
      await walkTo(page, 'bank-exit', 's'); await page.keyboard.press('e'); await page.waitForFunction(() => __sw().engine.mode() === 'market');
      check(await page.evaluate(() => __sw().state.view === 'market' && !__sw().engine.marketInfo().interiors.bank), tag + ' bank exit returns to market square');
      await goMap(page, 'market-clothing'); await page.keyboard.press('e'); await page.waitForFunction(() => __sw().engine.mode() === 'clothing');
      await walkTo(page, 'clothing-service', 'w'); await page.keyboard.press('e'); await page.locator('#market-service').waitFor();
      check(await page.locator('.market-look').count() === 6 && await fits(page, '.market-service', width, height), tag + ' clothing interior opens six-look collection screen');
      check(await page.evaluate(() => __writes.length === 0), tag + ' market and store visits produce no DB writes');
      await page.screenshot({ path: path.join(shotDir, 'clothing-' + width + (entry.includes('demo') ? '-bundle' : '') + '.png') });
      await page.locator('#market-service-done').click();
      await walkTo(page, 'clothing-exit', 's'); await page.keyboard.press('e'); await page.waitForFunction(() => __sw().engine.mode() === 'market');
      for (const [room, tab] of [['mission', 'missions'], ['club', 'clubs']]) {
        await page.locator('#phone-launch').click();
        await page.locator('.phone-nav [data-nav="' + tab + '"]').click();
        await page.locator('[data-room="' + room + '"]').click(); await page.locator('#btn-back').waitFor();
        check((await page.locator('#btn-back').innerText()).includes('시장'), tag + ' ' + room + ' screen keeps market return destination');
        await page.locator('#btn-back').click();
        await page.waitForFunction(() => __sw().engine.isRunning() && __sw().engine.mode() === 'market');
        check(await page.evaluate(() => __sw().state.view === 'market' && __sw().engine.marketInfo().marketVisible), tag + ' ' + room + ' screen returns to the market');
      }
      await goMap(page, 'market-bus'); await page.keyboard.press('e'); await page.locator('#transit-card').waitFor();
      await page.locator('#transit-skip').click(); await page.waitForFunction(() => !MarketUI.isTravelling() && __sw().engine.mode() === 'village');
      check(await page.evaluate(() => __sw().engine.marketInfo().villageVisible && !__sw().engine.marketInfo().marketVisible), tag + ' return bus restores original village');
      check(await page.evaluate(saved => JSON.stringify(__sw().state.profile.avatar) === saved, avatar), tag + ' return preserves avatar');
      check(await page.locator('#transit-card').count() === 0 && await page.locator('#transit-fade').count() === 0 && await page.locator('#phone-launch').isVisible(), tag + ' skip cleans blackout and restores controls');
      await near(page, 'bus'); await page.keyboard.press('e'); await page.locator('#transit-card').waitFor();
      await page.evaluate(() => __sw().engine.leave());
      check(await page.evaluate(() => !MarketUI.isTravelling() && !__sw().engine.busRideInfo()) && await page.locator('#transit-fade').count() === 0, tag + ' leaving world cancels travel without stranded blackout');
      await page.evaluate(() => __sw().engine.enter('village', { spawn: MarketWorldData.villageStop })); await near(page, 'bus');
      check(await page.evaluate(() => { const s = __sw().state, old = s.tour; s.tour = {}; const result = MarketUI.ride(); s.tour = old; return result === false; }), tag + ' tutorial blocks bus travel');
      check(errors.length === 0, tag + ' no browser errors: ' + errors.join('; '));
      await ctx.close();
    }
    fs.writeFileSync(path.join(__dirname, 'MARKET-VALIDATION.txt'), checks.map(c => 'PASS ' + c).join('\n') + '\n');
    console.log('ALL ' + checks.length + ' MARKET BROWSER CHECKS PASSED');
  } finally { if (browser) await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
