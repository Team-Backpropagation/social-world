/* Deterministic vehicle collisions, route frames and delayed Korean font load. */
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const path = require('node:path');
const THREE = require(process.env.SW_THREE_PATH || 'three');
const code = fs.readFileSync(path.resolve(__dirname, '../market-world.js'), 'utf8');
let checks = 0;
function check(value, title) { assert(value, title); checks++; console.log('PASS ' + title); }
function setup(area) {
  let time = 0, mode = area;
  const pending = [], contexts = [], scene = new THREE.Scene(), cols = [];
  const document = { fonts: {
    load(font, text) { return new Promise(resolve => pending.push({ font, text, resolve })); },
    check() { return true; }
  } };
  const root = {};
  vm.runInNewContext(code, { window: root, document, performance: { now: () => time } });
  const player = new THREE.Group(); player.userData.blob = { visible: true };
  const engine = { mode: () => mode, pauseInput() {} };
  function canvasTex(w, h, draw) {
    const writes = [], ctx = new Proxy({ writes }, {
      get: (o, k) => k in o ? o[k] : k === 'fillText' ? (text) => writes.push({ text, font: o.font }) : () => {},
      set: (o, k, v) => (o[k] = v, true)
    });
    const image = { width: w, height: h, getContext: () => ctx };
    draw(ctx, w, h); contexts.push(ctx); return new THREE.CanvasTexture(image);
  }
  function resolveCollisions(p, radius) {
    for (const c of cols) {
      if (c.off || (c.area && c.area !== mode)) continue;
      let x = c.x, z = c.z;
      if (c.seg) {
        const [ax, az, bx, bz] = c.seg, dx = bx - ax, dz = bz - az;
        const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / (dx * dx + dz * dz)));
        x = ax + dx * t; z = az + dz * t;
      }
      const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz), min = c.r + radius;
      if (d < min && d > .0001) { p.x = x + dx / d * min; p.z = z + dz / d * min; }
    }
    world?.collide(p, radius);
  }
  const world = root.createMarketWorld({ THREE, scene,
    mesh(geo, mat, x, y, z, parent) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); (parent || scene).add(m); return m; },
    M(color, opt = {}) { return new THREE.MeshBasicMaterial({ color, map: opt.map || null }); },
    rbox: (w, h, d) => new THREE.BoxGeometry(w, h, d), shade: p => p,
    textSprite: () => new THREE.Sprite(), canvasTex, colliders: cols, doors: [], places: {}, engine,
    player: () => player, animatePerson() {}, reduceMotion: false, resolveCollisions
  });
  world.enter(mode);
  const origin = mode === 'village' ? root.MarketWorldData.villageStop : root.MarketWorldData.marketStop;
  player.position.set(origin.x, 0, origin.z);
  return { world, player, root, pending, contexts, advance(t) { time += t; world.tick(.02, time / 1000); }, transfer(next, p) { mode = next; world.enter(mode); player.position.set(p.x, 0, p.z); } };
}
function outside(p, b, radius = .399) {
  const dx = p.x - b.x, dz = p.z - b.z, c = Math.cos(b.angle), s = Math.sin(b.angle);
  return Math.abs(dx * c - dz * s) >= b.halfLength + radius || Math.abs(dx * s + dz * c) >= b.halfWidth + radius;
}
(async () => {
  for (const source of ['village', 'market']) {
    const s = setup(source), destination = source === 'village' ? 'market' : 'village';
    check(s.world.start(destination, { onTransfer: (area, p) => s.transfer(area, p) }), source + ' starts travel');
    s.advance(1700);
    const b = s.world.debug().bus;
    const center = { x: b.x, z: b.z }; s.world.collide(center, .4);
    check(outside(center, b), source + ' collision ejects actor from exact vehicle centre');
    for (const [dx, dz] of [[3.7, 0], [-3.7, 0], [0, 1.5], [0, -1.5]]) {
      const point = { x: b.x + dx * Math.cos(b.angle) + dz * Math.sin(b.angle), z: b.z - dx * Math.sin(b.angle) + dz * Math.cos(b.angle) };
      s.world.collide(point, .4);
      check(outside(point, b), source + ' collision blocks body face ' + dx + ',' + dz);
    }
    const exterior = { x: b.x + 12, z: b.z + 12 }, saved = { ...exterior }; s.world.collide(exterior, .4);
    check(exterior.x === saved.x && exterior.z === saved.z, source + ' collision leaves exterior unchanged');
    let violations = 0, samples = 0, turns = false;
    for (let i = 0; i < 1500 && s.world.info(); i++) {
      s.advance(20); const state = s.world.debug();
      if (state.walkingPath?.length > 2) turns = true;
      if (state.playerVisible && state.busVisible) { samples++; if (!outside(s.player.position, state.bus)) violations++; }
    }
    check(!s.world.info() && samples > 100 && violations === 0 && turns, source + ' full ride routes around body with zero visible-frame penetration');
    check(!s.world.debug().bus.colliderActive, source + ' completed travel releases vehicle collision');
    const invisible = { x: b.x, z: b.z }; s.world.collide(invisible, .4);
    check(invisible.x === b.x && invisible.z === b.z, source + ' hidden bus does not leave ghost collision');
    const pending = s.pending.find(r => r.text === '오늘의 옷장');
    check(!!pending && pending.font === '400 92px "Gowun Dodum"', source + ' font request includes full Korean title');
    const ctx = s.contexts.find(c => c.writes.some(w => w.text === '오늘의 옷장'));
    check(ctx.writes.length === 1 && ctx.writes[0].font.includes('Malgun Gothic') && !ctx.writes[0].font.includes('Gowun Dodum'), source + ' loading sign uses one complete fallback font');
    pending.resolve([{}]); await Promise.resolve(); await Promise.resolve();
    check(ctx.writes.length === 2 && ctx.writes[1].text === '오늘의 옷장' && ctx.writes[1].font === '700 92px "Gowun Dodum"', source + ' font completion repaints entire title once');
  }
  console.log('ALL ' + checks + ' TRANSIT GEOMETRY AND FONT CHECKS PASSED');
})().catch(e => { console.error(e); process.exitCode = 1; });
