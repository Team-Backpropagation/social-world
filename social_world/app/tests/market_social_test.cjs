/* Market-only local chat, local-time clock and furniture navigation. No production DB. */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.SW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '../..');
const fixture = fs.readFileSync(path.join(__dirname, 'ui_test.py'), 'utf8').match(/FAKE_SUPABASE = r"""([\s\S]*?)"""/)[1];
const three = process.env.SW_THREE_PATH ? fs.readFileSync(process.env.SW_THREE_PATH, 'utf8') : null;
const shotDir = process.env.SW_MARKET_SHOTS || path.join(__dirname, 'social-shots');
fs.mkdirSync(shotDir, { recursive: true });
const checks = [];
function check(ok, name) { assert(ok, name); checks.push(name); console.log('PASS ' + name); }
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]); if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(root, '.' + rel);
  if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
  try {
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(file));
  } catch { res.statusCode = 404; res.end(); }
});
async function near(page, id) { await page.waitForFunction(id => __sw().state.near?.id === id, id, { timeout: 15000 }); }
async function goMap(page, id) { await page.keyboard.press('m'); await page.locator('[data-place="' + id + '"]').click(); await near(page, id); }
async function fits(page, selector, w, h) {
  const b = await page.locator(selector).boundingBox();
  return b && b.x >= 0 && b.y >= 0 && b.x + b.width <= w + 1 && b.y + b.height <= h + 1;
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.SW_CHROME_PATH, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    for (const [width, height, entry, zone] of [[1280, 900, '/app/', 'Asia/Seoul'], [390, 800, '/app/', 'America/Los_Angeles'], [1280, 900, '/socialworld-demo.html', 'Asia/Seoul'], [390, 800, '/socialworld-demo.html', 'America/Los_Angeles']]) {
      const tag = width + 'px ' + entry + ' ' + zone;
      const ctx = await browser.newContext({ viewport: { width, height }, locale: 'ko-KR', timezoneId: zone });
      await ctx.route('**/*supabase-js@2/**', r => r.fulfill({ contentType: 'text/javascript', body: fixture }));
      if (three) await ctx.route('**/*three@*/**', r => r.fulfill({ contentType: 'text/javascript', body: three }));
      await ctx.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, r => r.fulfill({ contentType: 'text/css', body: '' }));
      await ctx.addInitScript(() => {
        window.__SW_LITE = true;
        const NativeDate = Date; window.__computerTime = null;
        window.Date = class extends NativeDate {
          constructor(...args) { super(...(args.length ? args : [window.__computerTime ?? NativeDate.now()])); }
          static now() { return window.__computerTime ?? NativeDate.now(); }
        };
      });
      const page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://127.0.0.1:' + server.address().port + entry, { waitUntil: 'commit' });
      await page.waitForFunction(() => window.MarketUI && __sw().engine?.isRunning(), null, { timeout: 90000 });
      check(await page.locator('#market-chat').count() === 0, tag + ' chat not created in village');
      await goMap(page, 'bus'); await page.keyboard.press('e'); await page.locator('#transit-card').waitFor();
      check(await page.locator('#market-chat').count() === 0, tag + ' chat absent during outbound bus ride');
      await page.locator('#transit-skip').click();
      await page.waitForFunction(() => __sw().engine.mode() === 'market' && MarketUI.state().chatVisible);
      check(await page.locator('#market-chat').isVisible() && await fits(page, '#market-chat', width, height), tag + ' market chat appears and fits viewport');
      const info = await page.evaluate(() => __sw().engine.marketInfo());
      check(info.clock.hands3D, tag + ' clock hour and minute hands use 3D extruded geometry');
      check(info.benches.filter(b => b.area === 'market' && b.id.includes('square')).every(b => b.seats === 2), tag + ' both square benches have two opposing seats');
      check(Math.abs(info.benches.find(b => b.id === 'bank-counter-bench').angle - Math.PI) < .001, tag + ' bank bench faces counter');
      check(Math.abs(info.benches.find(b => b.id === 'village-stop-bench').angle - Math.PI / 2) < .001, tag + ' village stop bench faces road');
      const busBench = info.benches.find(b => b.id === 'market-stop-bench'), sign = info.signs.find(s => s.x > 100);
      check(Math.hypot(busBench.x - sign.x, busBench.z - sign.z) < 3.2 && busBench.seats === 1, tag + ' market stop bench moves beside sign and stays single-sided');
      for (const [h, m, s] of [[3, 15, 30], [23, 59, 0], [0, 0, 0], [14, 30, 0]]) {
        await page.evaluate(([h, m, s]) => { window.__computerTime = new Date(2030, 0, 2, h, m, s).getTime(); }, [h, m, s]);
        await page.waitForFunction(([h, m, s]) => { const c = __sw().engine.marketInfo().clock; return c.hours === h && c.minutes === m && c.seconds === s; }, [h, m, s]);
        check(await page.evaluate(([h, m, s]) => {
          const c = __sw().engine.marketInfo().clock;
          return Math.abs(c.hourAngle + ((h % 12) + (m + s / 60) / 60) * Math.PI / 6) < 1e-6 && Math.abs(c.minuteAngle + (m + s / 60) * Math.PI / 30) < 1e-6;
        }, [h, m, s]), tag + ' local clock handles ' + h + ':' + m + ':' + s + ' including midnight and computer-time changes');
      }
      if (await page.locator('#market-chat').evaluate(el => el.classList.contains('is-collapsed'))) await page.locator('#market-chat-toggle').click();
      check(await fits(page, '#market-chat', width, height), tag + ' expanded chat fits viewport');
      const input = page.locator('#market-chat-input'); await input.focus();
      if (width < 600) {
        await page.evaluate(() => { Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => innerHeight - 280 }); visualViewport.dispatchEvent(new Event('resize')); });
        check((await input.boundingBox()).y + (await input.boundingBox()).height < height - 280 - 8, tag + ' mobile input moves above virtual keyboard');
        await page.evaluate(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize')); });
      }
      const p = await page.evaluate(() => __sw().engine.playerPos());
      await page.keyboard.down('w'); await page.keyboard.press('m'); await page.keyboard.press('i'); await page.keyboard.press('e');
      await page.waitForTimeout(150); await page.keyboard.up('w');
      check(await page.evaluate(p => MarketUI.isTyping() && !WorldUI.isOpen() && Math.hypot(__sw().engine.playerPos().x - p.x, __sw().engine.playerPos().z - p.z) < .02, p), tag + ' typing blocks movement, map, inventory and interaction');
      await input.fill('안녕하세요! 시장에서 만나요.'); await page.keyboard.press('Enter');
      check(await page.locator('.market-chat-message').count() === 1 && await page.locator('#market-chat-bubble').innerText() === '안녕하세요! 시장에서 만나요.', tag + ' send adds message and speech bubble');
      check(await page.locator('.market-chat-message strong').innerText() === '테스트' && await fits(page, '#market-chat-bubble', width, height), tag + ' chat uses current nickname and bubble fits viewport');
      check(await page.evaluate(() => {
        const a = document.getElementById('market-chat').getBoundingClientRect();
        return [...document.querySelectorAll('.sw-toast')].every(t => { const b = t.getBoundingClientRect(); return b.bottom <= a.top || b.top >= a.bottom || b.right <= a.left || b.left >= a.right; });
      }), tag + ' chat panel stays clear of arrival toast');
      await page.waitForFunction(() => {
        const b = document.getElementById('market-chat-bubble')?.getBoundingClientRect(), p = __sw().engine.playerHeadScreen();
        return b && Math.abs(b.bottom - (p.y - 12)) < 3;
      });
      check(true, tag + ' speech bubble anchors above actual player head');
      await page.keyboard.press('Escape');
      check(await page.evaluate(() => !MarketUI.isTyping()), tag + ' Escape releases chat input');
      await page.keyboard.down('a'); await page.waitForTimeout(320); await page.keyboard.up('a');
      check(await page.evaluate(p => Math.hypot(__sw().engine.playerPos().x - p.x, __sw().engine.playerPos().z - p.z) > .1, p), tag + ' movement resumes after leaving input');
      await page.waitForFunction(() => {
        const b = document.getElementById('market-chat-bubble')?.getBoundingClientRect(), p = __sw().engine.playerHeadScreen();
        return b && Math.abs(b.bottom - (p.y - 12)) < 3;
      });
      check(true, tag + ' speech bubble follows moving avatar');
      const suffix = width + (entry.includes('demo') ? '-bundle' : '');
      await page.screenshot({ path: path.join(shotDir, 'chat-' + suffix + '.png') });
      await input.focus(); await input.fill('한글 입력');
      await input.evaluate(el => {
        el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }));
        el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      check(await page.locator('.market-chat-message').count() === 1, tag + ' Korean IME Enter does not send unfinished composition');
      await input.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
      await input.fill('   '); await page.keyboard.press('Enter');
      check(await page.locator('.market-chat-message').count() === 1, tag + ' whitespace does not send empty message');
      const hostile = '<img src=x onerror="window.__chatInjected=1">';
      await input.fill(hostile); await page.keyboard.press('Enter');
      check(await page.locator('#market-chat-log img, #market-chat-bubble img').count() === 0 && await page.evaluate(() => !window.__chatInjected) && await page.locator('#market-chat-bubble').innerText() === hostile, tag + ' user text is rendered safely as literal text');
      await input.evaluate(el => { el.value = '가'.repeat(100); el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
      check(Array.from(await page.locator('#market-chat-bubble').innerText()).length === 80, tag + ' message length capped at 80 characters');
      await input.evaluate(el => { for (let i = 0; i < 35; i++) { el.value = '메시지 ' + i; el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); } });
      check(await page.locator('.market-chat-message').count() === 30 && await page.evaluate(() => MarketUI.state().messages === 30), tag + ' local chat history bounded to 30 messages');
      check(await page.evaluate(() => __writes.length === 0), tag + ' chat makes no production or fake database writes');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('market-chat-bubble'), null, { timeout: 7000 });
      check(await page.evaluate(() => !MarketUI.state().speech), tag + ' speech expires without retaining stale balloon');
      await page.locator('#market-chat-toggle').click();
      await page.locator('#stage canvas').click({ position: { x: width - 30, y: 100 } });
      await page.keyboard.press('Enter');
      check(await page.evaluate(() => MarketUI.isTyping() && !document.getElementById('market-chat').classList.contains('is-collapsed')), tag + ' Enter opens collapsed chat and focuses input');
      await input.fill('시장 둘러보기'); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
      await goMap(page, 'market-bank'); await page.keyboard.press('e'); await page.waitForFunction(() => __sw().engine.mode() === 'bank');
      check(await page.locator('#market-chat').isHidden() && await page.locator('#market-chat-bubble').count() === 0, tag + ' bank interior hides chat and clears speech');
      await page.screenshot({ path: path.join(shotDir, 'bank-bench-' + suffix + '.png') });
      await goMap(page, 'market-clothing'); await page.keyboard.press('e'); await page.waitForFunction(() => __sw().engine.mode() === 'clothing');
      check(await page.locator('#market-chat').isHidden(), tag + ' clothing interior hides chat');
      await goMap(page, 'market-bank');
      await page.waitForFunction(() => __sw().engine.mode() === 'market' && MarketUI.state().chatVisible);
      check(await page.locator('.market-chat-message').count() === 30, tag + ' market return keeps current-session chat history');
      await page.evaluate(() => __sw().engine.enter('market', { spawn: { x: 170, z: 0 } }));
      await page.locator('#market-chat-toggle').click();
      await page.screenshot({ path: path.join(shotDir, 'bank-clock-' + suffix + '.png') });
      await goMap(page, 'market-bus'); await page.keyboard.press('e'); await page.locator('#transit-card').waitFor();
      check(await page.locator('#market-chat').isHidden(), tag + ' return travel hides chat');
      await page.locator('#transit-skip').click(); await page.waitForFunction(() => __sw().engine.mode() === 'village');
      check(await page.locator('#market-chat').isHidden() && await page.locator('#market-chat-bubble').count() === 0, tag + ' village keeps market chat hidden');
      await page.evaluate(() => { MarketUI.reset(); MarketUI.reset(); });
      check(await page.locator('#market-chat').count() === 0 && await page.evaluate(() => MarketUI.state().messages === 0), tag + ' reset clears account chat and is repeatable');
      check(errors.length === 0, tag + ' no browser errors: ' + errors.join('; '));
      await ctx.close();
    }
    fs.writeFileSync(path.join(__dirname, 'MARKET-SOCIAL-VALIDATION.txt'), checks.map(c => 'PASS ' + c).join('\n') + '\n');
    console.log('ALL ' + checks.length + ' MARKET SOCIAL BROWSER CHECKS PASSED');
  } finally { if (browser) await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
