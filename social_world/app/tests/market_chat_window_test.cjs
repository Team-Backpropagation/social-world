/* Real pointer gestures and live character portraits; fake Supabase only. */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require(process.env.SW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '../..');
const fixture = fs.readFileSync(path.join(__dirname, 'ui_test.py'), 'utf8').match(/FAKE_SUPABASE = r"""([\s\S]*?)"""/)[1];
const three = process.env.SW_THREE_PATH ? fs.readFileSync(process.env.SW_THREE_PATH, 'utf8') : null;
const shots = process.env.SW_MARKET_SHOTS || path.join(__dirname, 'chat-window-shots'); fs.mkdirSync(shots, { recursive: true });
const checks = []; const check = (ok, text) => { assert(ok, text); checks.push(text); console.log('PASS ' + text); };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]); if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(root, '.' + rel); if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
  try { res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8'); res.end(fs.readFileSync(file)); }
  catch { res.statusCode = 404; res.end(); }
});
async function drag(page, x, y, dx, dy) { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 6 }); await page.mouse.up(); }
async function map(page, id) { await page.keyboard.press('m'); await page.locator('[data-place="' + id + '"]').click(); await page.waitForFunction(id => __sw().state.near?.id === id, id); }
async function fits(page, w, h) { const b = await page.locator('#market-chat').boundingBox(); return b && b.x >= 11 && b.y >= 11 && b.x + b.width <= w - 11 && b.y + b.height <= h - 11; }
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.SW_CHROME_PATH, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    for (const [w, h, entry] of [[1280, 900, '/app/'], [390, 800, '/app/'], [1280, 900, '/socialworld-demo.html'], [390, 800, '/socialworld-demo.html']]) {
      const tag = w + 'px ' + entry, context = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ko-KR' });
      await context.route('**/*supabase-js@2/**', r => r.fulfill({ contentType: 'text/javascript', body: fixture }));
      if (three) await context.route('**/*three@*/**', r => r.fulfill({ contentType: 'text/javascript', body: three }));
      await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, r => r.fulfill({ contentType: 'text/css', body: '' }));
      await context.addInitScript(() => { window.__SW_LITE = true; });
      const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://127.0.0.1:' + server.address().port + entry, { waitUntil: 'commit' });
      await page.waitForFunction(() => window.MarketUI && __sw().engine?.isRunning(), null, { timeout: 90000 });
      await map(page, 'bus'); await page.keyboard.press('e'); await page.locator('#transit-skip').click();
      await page.waitForFunction(() => MarketUI.state().chatVisible);
      if (await page.locator('#market-chat').evaluate(e => e.classList.contains('is-collapsed'))) await page.locator('#market-chat-toggle').click();
      check((await page.locator('.market-chat-hint').innerText()).includes('Esc로 입력 종료'), tag + ' corrected Escape wording applied');
      const input = page.locator('#market-chat-input'); await input.fill('캐릭터 얼굴 프로필 테스트'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.market-chat-avatar')?.naturalWidth > 0);
      const firstPortrait = await page.locator('.market-chat-avatar').getAttribute('src');
      check(firstPortrait.startsWith('data:image/png'), tag + ' default profile is actual 3D character face PNG');
      check(await page.locator('.market-chat-avatar').evaluate(img => {
        const c = document.createElement('canvas'); c.width = c.height = 96; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 96, 96);
        const d = g.getImageData(0, 0, 96, 96).data, colors = new Set();
        for (let i = 0; i < d.length; i += 64) colors.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
        return colors.size > 20 && getComputedStyle(img).borderRadius === '50%' && img.getBoundingClientRect().right <= img.nextElementSibling.querySelector('strong').getBoundingClientRect().left;
      }), tag + ' circular portrait contains face pixels and sits left of username');
      await page.keyboard.press('Escape');
      const suffix = w + (entry.includes('demo') ? '-bundle' : '');
      await page.screenshot({ path: path.join(shots, 'profile-chat-' + suffix + '.png') });
      let b = await page.locator('#market-chat').boundingBox(); const old = { ...b };
      await drag(page, b.x + 75, b.y + 22, 25, -120); b = await page.locator('#market-chat').boundingBox();
      check(b.y < old.y - 90 && b.x >= old.x + 15 && !await page.locator('#market-chat').evaluate(e => e.classList.contains('is-collapsed')), tag + ' grabbing header moves window without collapsing');
      const p = await page.evaluate(() => __sw().engine.playerPos());
      await page.mouse.move(b.x + 75, b.y + 22); await page.mouse.down();
      check(await page.evaluate(() => MarketUI.isManipulating()), tag + ' header drag takes pointer capture');
      await page.keyboard.down('w'); await page.waitForTimeout(100); await page.keyboard.up('w'); await page.mouse.up();
      check(await page.evaluate(p => !MarketUI.isManipulating() && Math.hypot(__sw().engine.playerPos().x - p.x, __sw().engine.playerPos().z - p.z) < .02, p), tag + ' drag blocks game movement and releases cleanly');
      for (const edge of ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']) {
        b = await page.locator('#market-chat').boundingBox();
        const handle = await page.locator('[data-edge="' + edge + '"]').boundingBox();
        const dx = edge.includes('e') ? 9 : edge.includes('w') ? -9 : 0, dy = edge.includes('s') ? 9 : edge.includes('n') ? -9 : 0;
        await drag(page, handle.x + handle.width / 2, handle.y + handle.height / 2, dx, dy);
        const after = await page.locator('#market-chat').boundingBox();
        check((dx ? after.width > b.width + 1 : Math.abs(after.width - b.width) < 2) && (dy ? after.height > b.height + 1 : Math.abs(after.height - b.height) < 2), tag + ' dragging ' + edge + ' edge resizes corresponding dimensions');
      }
      b = await page.locator('#market-chat').boundingBox();
      await drag(page, b.x + 75, b.y + 22, -3000, -3000);
      check(await fits(page, w, h), tag + ' window movement clamps inside viewport');
      const se = await page.locator('[data-edge="se"]').boundingBox();
      await drag(page, se.x + se.width / 2, se.y + se.height / 2, -2000, -2000);
      b = await page.locator('#market-chat').boundingBox();
      check(b.width >= 243 && b.height >= 177, tag + ' resizing respects readable minimum dimensions');
      const expanded = { ...b }; await page.locator('#market-chat-toggle').click();
      check((await page.locator('#market-chat').boundingBox()).height < 50 && await page.evaluate(() => !MarketUI.isManipulating()), tag + ' collapse leaves compact header');
      await page.locator('#market-chat-toggle').click(); b = await page.locator('#market-chat').boundingBox();
      check(Math.abs(b.width - expanded.width) < 2 && Math.abs(b.height - expanded.height) < 2, tag + ' expanding restores chosen dimensions');
      await page.setViewportSize({ width: Math.min(w, 360), height: 620 });
      check(await fits(page, Math.min(w, 360), 620), tag + ' resized viewport keeps custom window accessible');
      await page.setViewportSize({ width: w, height: h });
      await page.evaluate(() => { const s = __sw().state; s.profile.avatar = { ...s.profile.avatar, hair: 'bun', hairColor: '#B8754D', skin: '#DDAA85', acc: 'flower', face: 'grin' }; __sw().engine.setAvatar(s.profile.avatar); });
      await input.fill('바뀐 얼굴'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => [...document.querySelectorAll('.market-chat-avatar')].every(img => img.naturalWidth > 0));
      check(await page.locator('.market-chat-avatar').last().getAttribute('src') !== firstPortrait, tag + ' avatar customization updates next message portrait');
      await page.keyboard.press('Escape');
      for (const [id, mode, text] of [['market-bank', 'bank', '은행 내부 채팅'], ['market-clothing', 'clothing', '옷가게 내부 채팅']]) {
        await map(page, id); await page.keyboard.press('e'); await page.waitForFunction(mode => __sw().engine.mode() === mode, mode);
        check(await page.locator('#market-chat').isVisible(), tag + ' ' + mode + ' interior shows chat');
        await input.fill(text); await page.keyboard.press('Enter');
        await page.waitForFunction(() => { const b = document.querySelector('#market-chat-bubble')?.getBoundingClientRect(), p = __sw().engine.playerHeadScreen(); return b && p && !document.querySelector('#market-chat-bubble').hidden && Math.abs(b.bottom - (p.y - 12)) < 3; });
        check(await page.locator('#market-chat-bubble').innerText() === text, tag + ' ' + mode + ' message appears over indoor player head');
        await page.keyboard.press('Escape');
        await page.screenshot({ path: path.join(shots, mode + '-chat-' + suffix + '.png') });
      }
      check(await page.evaluate(() => __writes.length === 0), tag + ' window controls and local chat produce no database writes');
      await page.evaluate(() => MarketUI.reset());
      check(await page.locator('#market-chat').count() === 0 && await page.evaluate(() => !MarketUI.isManipulating()), tag + ' reset removes window and releases pointer state');
      check(errors.length === 0, tag + ' no browser errors: ' + errors.join('; ')); await context.close();
    }
    fs.writeFileSync(path.join(__dirname, 'CHAT-WINDOW-VALIDATION.txt'), checks.map(c => 'PASS ' + c).join('\n') + '\n');
    console.log('ALL ' + checks.length + ' CHAT WINDOW BROWSER CHECKS PASSED');
  } finally { if (browser) await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
