/* Separate market scenery and bus travel. Existing village randomness stays untouched. */
(function (root) {
  'use strict';
  const MX = 180;
  const data = root.MarketWorldData = {
    bounds: { x0: MX - 26, x1: MX + 26, z0: -23, z1: 23 },
    mapBounds: { x0: MX - 30, x1: MX + 30, z0: -27, z1: 27 },
    villageStop: { x: 39, z: 24.2 },
    marketStop: { x: MX - 1.8, z: 14.8 },
    rooms: { bank: { x: MX, z: 100 }, clothing: { x: MX + 30, z: 100 } },
    points: [
      { id: 'market-bank', name: '이음 은행', x: MX - 12, z: -8 },
      { id: 'market-clothing', name: '오늘의 옷장', x: MX + 12, z: -8 },
      { id: 'market-square', name: '시장 광장', x: MX, z: 3 },
      { id: 'market-bus', name: '마을행 버스', x: MX - 1.8, z: 14.8 }
    ],
    durationScale: 1
  };

  root.createMarketWorld = function ({ THREE, scene, mesh, M, rbox, shade, textSprite, canvasTex,
    colliders, doors, places, engine, player: getPlayer, animatePerson, reduceMotion }) {
    const plaza = new THREE.Group(); plaza.name = 'ieum-market'; scene.add(plaza);
    const interiors = {};
    const stop = new THREE.Group(); stop.name = 'village-bus-stop'; scene.add(stop);
    let ride = null;

    function box(parent, w, h, d, color, x, y, z, radius = .12) {
      return mesh(rbox(w, h, d, radius), M(color), x, y, z, parent);
    }
    function ground(parent, w, d, color, x, y, z) {
      const geometry = new THREE.PlaneGeometry(w, d, Math.ceil(w), Math.ceil(d));
      geometry.rotateX(-Math.PI / 2);
      const floor = mesh(geometry, M(color), x, y, z, parent);
      floor.receiveShadow = true;
      return floor;
    }
    function label(parent, value, x, y, z, size = 80) {
      const sign = textSprite(value, { size, color: '#304D45', stroke: '#FFF9EA' });
      sign.position.set(x, y, z); parent.add(sign); return sign;
    }
    function facadeSign(parent, value, width, x, y, z) {
      const tex = canvasTex(1024, 192, (g, w, h) => {
        g.fillStyle = '#FFF3D9'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#365C4C'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = '700 92px "Gowun Dodum", sans-serif'; g.fillText(value, w / 2, h / 2, w - 80);
      });
      box(parent, width + .15, .9, .14, '#456E5B', x, y, z);
      mesh(new THREE.PlaneGeometry(width, .76), M('#FFFFFF', { map: tex }), x, y, z + .08, parent);
    }
    function poleSign(parent, x, z, title, subtitle) {
      box(parent, .15, 2.7, .15, '#456957', x, 1.35, z);
      box(parent, 2.2, .85, .18, '#F8F0DB', x, 2.7, z);
      const tex = canvasTex(512, 192, (g, w, h) => {
        g.fillStyle = '#F8F0DB'; g.fillRect(0, 0, w, h);
        g.textAlign = 'center'; g.fillStyle = '#31584B';
        g.font = '700 62px "Gowun Dodum", sans-serif'; g.fillText(title, w / 2, 83);
        g.font = '36px "Gowun Dodum", sans-serif'; g.fillText(subtitle, w / 2, 146);
      });
      mesh(new THREE.PlaneGeometry(2.05, .77), M('#FFFFFF', { map: tex }), x, 2.7, z + .1, parent);
    }
    function plant(parent, x, z, color = '#6F9A64', scale = 1) {
      const g = new THREE.Group(); parent.add(g); g.position.set(x, 0, z);
      box(g, .65, .55, .65, '#DCC7A3', 0, .27, 0);
      mesh(new THREE.CylinderGeometry(.08, .11, 1.3, 8), M('#A17B55'), 0, 1.15, 0, g);
      for (const [dx, y, dz, r] of [[0, 2.3, 0, .9], [.5, 1.9, .1, .65], [-.4, 2, -.2, .72]]) {
        mesh(new THREE.SphereGeometry(r, 12, 9), M(color), dx, y, dz, g);
      }
      g.scale.setScalar(scale); shade(g);
      const area = parent === plaza ? 'market' : parent.userData.area;
      if (area) colliders.push({ x: x + (parent === plaza ? 0 : parent.position.x), z: z + (parent === plaza ? 0 : parent.position.z), r: .42 * scale, area });
    }
    function bench(parent, x, z) {
      box(parent, 2.8, .15, .7, '#B48960', x, .65, z);
      box(parent, 2.8, .8, .12, '#B48960', x, 1.08, z - .35);
      [-1, 1].forEach(dx => box(parent, .15, .6, .55, '#547362', x + dx, .3, z));
    }
    function road(parent, centerX, z, width) {
      ground(parent, width, 5.4, '#7D8B89', centerX, .065, z);
      [-1, 1].forEach(side => box(parent, width, .15, .22, '#E7DDC7', centerX, .10, z + side * 2.8));
      for (let x = centerX - width / 2 + 2; x < centerX + width / 2; x += 4) {
        box(parent, 1.6, .015, .12, '#F9EDB7', x, .085, z);
      }
    }

    // No calls to the original engine's rnd(): additions do not move its trees or grass.
    road(stop, 45, 20.3, 26);
    box(stop, 5.4, .08, 2.6, '#E4D8BE', 39, .09, 23.5);
    poleSign(stop, 38, 22.7, '버스 정류장', '이음 시장행');
    bench(stop, 41, 24.6);
    colliders.push({ x: 38, z: 22.7, r: .2, area: 'village' });
    colliders.push({ seg: [39.6, 24.6, 42.4, 24.6], r: .4, area: 'village' });
    places.bus = { ...data.villageStop };
    doors.push({ id: 'bus', label: '시장행 버스 부르기', ...places.bus, r: 2.4, area: 'village', type: 'bus' });

    // Market square: two distinct shop fronts around an open, walkable centre.
    ground(plaza, 76, 76, '#A9C98B', MX, -.09, 0);
    ground(plaza, 45, 38, '#E7D6B7', MX, .025, 0);
    for (let x = MX - 21; x <= MX + 21; x += 3) ground(plaza, .035, 34, '#D9C5A5', x, .037, 0);
    for (let z = -17; z <= 15; z += 3) ground(plaza, 43, .035, '#D9C5A5', MX, .037, z);
    road(plaza, MX, 18, 66);
    poleSign(plaza, MX - 4.2, 14.8, '버스 정류장', '이음 마을행');
    colliders.push({ x: MX - 4.2, z: 14.8, r: .2, area: 'market' });
    bench(plaza, MX + 5, 14.3);
    places['market-bus'] = { ...data.marketStop };
    places['market-square'] = { x: MX, z: 3 };
    doors.push({ id: 'market-bus', label: '마을행 버스 부르기', ...data.marketStop, r: 2.3, area: 'market', type: 'bus' });

    function shop(id, x, color, roof, title, bank) {
      const g = new THREE.Group(); g.position.set(x, 0, -8); plaza.add(g);
      box(g, 9.8, .3, 8, '#CCBBA2', 0, .15, 0);
      box(g, 9.3, 4.8, 7.3, color, 0, 2.5, 0);
      box(g, 10.2, .6, 8, roof, 0, 5, 0);
      box(g, 10.7, .15, 8.4, '#FFF3D9', 0, 4.72, 0);
      box(g, 1.5, 2.75, .12, '#476C62', 0, 1.52, 3.70);
      box(g, 1.2, 2.3, .07, '#9AC9C6', 0, 1.62, 3.79);
      mesh(new THREE.SphereGeometry(.07, 8, 6), M('#ECC772'), .48, 1.3, 3.85, g);
      [-2.9, 2.9].forEach(xx => {
        box(g, 2.4, 2.5, .16, '#FFF7E9', xx, 2.0, 3.70);
        box(g, 2.1, 2.2, .08, '#A2CBC6', xx, 2.0, 3.82);
        box(g, .06, 2.2, .08, '#FFF7E9', xx, 2.0, 3.90);
      });
      if (bank) {
        [-4.2, -1.25, 1.25, 4.2].forEach(xx => {
          mesh(new THREE.CylinderGeometry(.17, .22, 3.7, 10), M('#FFF2D5'), xx, 2.0, 4.0, g);
          box(g, .55, .17, .55, '#D2C2A8', xx, .23, 4.0);
        });
        const clock = mesh(new THREE.CircleGeometry(.57, 32), M('#FFF5D8'), 3.4, 4.0, 3.85, g);
        box(g, .04, .32, .035, '#48675B', 3.4, 4.1, 3.9);
        box(g, .3, .04, .035, '#48675B', 3.52, 4, 3.9);
        clock.name = 'bank-clock';
      } else {
        for (let i = 0; i < 12; i++) {
          const awning = box(g, .8, .13, 1.65, i % 2 ? '#FFF4DC' : '#D78676', -4.4 + i * .8, 3.42, 4.1);
          awning.rotation.x = .16;
        }
        [-2.9, 2.9].forEach((xx, i) => {
          box(g, .8, 1.15, .12, i ? '#A8BFA2' : '#D98C7D', xx, 1.95, 3.92);
          mesh(new THREE.SphereGeometry(.22, 10, 8), M('#FFF0D9'), xx, 2.72, 3.92, g);
        });
      }
      facadeSign(g, title, 4.7, 0, 4.15, 3.88);
      places[id] = { x, z: -2.8 };
      doors.push({ id, label: title, ...places[id], r: 2.3, area: 'market' });
      // Rectangular walls keep the whole building footprint inaccessible.
      for (const [ax, az, bx, bz] of [[-4.8, -3.8, 4.8, -3.8], [-4.8, 3.8, 4.8, 3.8], [-4.8, -3.8, -4.8, 3.8], [4.8, -3.8, 4.8, 3.8]]) {
        colliders.push({ seg: [x + ax, -8 + az, x + bx, -8 + bz], r: .15, area: 'market' });
      }
      plant(plaza, x - 5.9, -2.3, bank ? '#719C7A' : '#96B06D', .8);
      plant(plaza, x + 5.9, -2.3, bank ? '#719C7A' : '#96B06D', .8);
      shade(g);
    }
    shop('market-bank', MX - 12, '#EEE7D1', '#648E7F', '이음 은행', true);
    shop('market-clothing', MX + 12, '#F5E6D4', '#CB8273', '오늘의 옷장', false);
    // A central welcome arch and small places to rest give the square its identity.
    [-5, 5].forEach(x => { box(plaza, .38, 4.5, .38, '#887B60', MX + x, 2.25, -17); colliders.push({ x: MX + x, z: -17, r: .22, area: 'market' }); });
    box(plaza, 11.3, .65, .6, '#608A70', MX, 4.4, -17);
    facadeSign(plaza, '이음 시장', 8.4, MX, 4.4, -16.65);
    box(plaza, 5, .15, 3.2, '#D0B78B', MX, .1, 1);
    box(plaza, 4.5, .3, 2.7, '#EEE3C9', MX, .28, 1);
    label(plaza, '시장 광장', MX, 1.05, 1, 64);
    for (const [x, z] of [[MX - 21, -17], [MX + 21, -17], [MX - 21, 10], [MX + 21, 10]]) plant(plaza, x, z, '#799D68', 1.3);
    bench(plaza, MX - 8, 7); bench(plaza, MX + 8, 7);
    for (const x of [MX - 8, MX + 8]) colliders.push({ seg: [x - 1.4, 7, x + 1.4, 7], r: .4, area: 'market' });
    colliders.push({ seg: [MX - 2.5, 1, MX + 2.5, 1], r: 1.6, area: 'market' });
    shade(plaza);

    function shirt(parent, x, y, z, color) {
      box(parent, .7, .9, .22, color, x, y, z, .08);
      const l = box(parent, .35, .48, .22, color, x - .44, y + .23, z, .06); l.rotation.z = -.45;
      const r = box(parent, .35, .48, .22, color, x + .44, y + .23, z, .06); r.rotation.z = .45;
    }
    function room(kind, title) {
      const p = data.rooms[kind], g = new THREE.Group(); g.position.set(p.x, 0, p.z); scene.add(g); interiors[kind] = g;
      g.userData.area = kind;
      box(g, 10, .18, 10, '#E9D9BA', 0, -.08, 0);
      box(g, 10, 4, .2, kind === 'bank' ? '#D7E4D5' : '#F1D9CD', 0, 2, -4.7);
      [-4.8, 4.8].forEach(x => box(g, .2, 4, 9.5, '#F7ECDC', x, 2, 0));
      for (let z = -4; z <= 4; z++) box(g, 9.4, .012, .025, '#D3BE9C', 0, .02, z);
      label(g, title, 0, 3.2, -4.5);
      if (kind === 'bank') {
        box(g, 6, 1.1, 1, '#91AB8D', 0, .55, -1.8);
        box(g, 6.3, .13, 1.15, '#F8EFDA', 0, 1.16, -1.8);
        [-2, 0, 2].forEach(x => {
          box(g, .7, .58, .1, '#536D64', x, 1.53, -2);
          box(g, 1, .05, .6, '#E7D9BD', x, 1.25, -1.5);
        });
        for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
          box(g, .85, .7, .3, '#6F8B7A', -3.6 + col * .95, .7 + row * .8, -4.3);
          box(g, .13, .08, .08, '#ECD091', -3.6 + col * .95, .7 + row * .8, -4.09);
        }
        bench(g, -2.5, 1.8);
        colliders.push({ seg: [p.x - 3.9, p.z + 1.8, p.x - 1.1, p.z + 1.8], r: .4, area: kind });
        colliders.push({ seg: [p.x - 3.2, p.z - 1.8, p.x + 3.2, p.z - 1.8], r: .6, area: kind });
      } else {
        const colors = ['#86A494', '#D89280', '#D8C285', '#9BA9C3'];
        [-3, 3].forEach((x, side) => {
          box(g, .12, 2.3, .12, '#A78661', x, 1.15, -2.4);
          box(g, 2.8, .12, .12, '#A78661', x, 2.3, -2.4);
          for (let i = 0; i < 3; i++) shirt(g, x - .9 + i * .9, 1.55, -2.4, colors[(i + side) % colors.length]);
          colliders.push({ seg: [p.x + x - 1.5, p.z - 2.4, p.x + x + 1.5, p.z - 2.4], r: .4, area: kind });
        });
        box(g, 2.4, .9, 1.2, '#C59D85', 0, .45, -3.6);
        colliders.push({ seg: [p.x - 1.2, p.z - 3.6, p.x + 1.2, p.z - 3.6], r: .6, area: kind });
        for (let i = 0; i < 3; i++) box(g, .65, .12, .55, colors[i], -.75 + i * .75, 1.05, -3.6);
        box(g, 1.5, 2.8, .08, '#94B6AE', -4.55, 1.5, .6);
        box(g, 1.6, .25, .9, '#CBA68A', 2.6, .3, 1.6);
        colliders.push({ seg: [p.x + 1.8, p.z + 1.6, p.x + 3.4, p.z + 1.6], r: .45, area: kind });
      }
      plant(g, 3.8, 3, '#7AA078', .7);
      label(g, '시장 광장으로', 0, 1.2, 4.35, 48);
      places[kind + '-inside'] = { x: p.x, z: p.z + 2.9 };
      doors.push({ id: kind + '-exit', label: '시장 광장으로 나가기', x: p.x, z: p.z + 3.5, r: 1.25, area: kind, type: 'exit' });
      doors.push({ id: kind + '-service', label: kind === 'bank' ? '은행 안내 보기' : '진열된 옷 둘러보기', x: p.x, z: p.z - .35, r: 2, area: kind, type: 'service' });
      shade(g); g.visible = false;
    }
    room('bank', '이음 은행'); room('clothing', '오늘의 옷장');

    // Reusable bus with a sliding door, wheels, lights and its destination board.
    const bus = new THREE.Group(); bus.name = 'market-shuttle-bus'; scene.add(bus);
    box(bus, 7.6, 2.4, 2.9, '#E8BA6D', 0, 1.8, 0, .3);
    box(bus, 7.5, .75, 3, '#547F6E', 0, .85, 0, .2);
    box(bus, 7.3, .2, 2.9, '#FFF1D5', 0, 3.07, 0);
    [-1, 1].forEach(side => {
      for (let i = 0; i < 4; i++) box(bus, 1.2, .95, .04, '#718E90', -1.6 + i * 1.35, 2.25, side * 1.47, .05);
      [-2.5, 2.5].forEach(x => {
        const wheel = mesh(new THREE.CylinderGeometry(.55, .55, .25, 16), M('#3F4C49'), x, .55, side * 1.5, bus); wheel.rotation.x = Math.PI / 2;
        const hub = mesh(new THREE.CylinderGeometry(.26, .26, .28, 16), M('#CEC9B4'), x, .55, side * 1.52, bus); hub.rotation.x = Math.PI / 2;
      });
    });
    box(bus, .08, 1.2, 2.3, '#718E90', -3.81, 2.22, 0);
    [-.93, .93].forEach(z => box(bus, .1, .25, .45, '#FFF1B4', -3.83, 1.04, z));
    box(bus, 1.4, 2.15, .06, '#304C44', -1.8, 1.65, 1.51);
    const busDoor = box(bus, 1.35, 2.08, .07, '#ACC6BB', -1.8, 1.65, 1.56);
    box(busDoor, 1.1, 1.35, .03, '#637F80', 0, .16, .06);
    label(bus, '이음 순환버스', .6, 3.55, 0, 58);
    shade(bus); bus.visible = false;

    function park(mode) { return mode === 'village' ? { x: 41, z: 20.3 } : { x: MX, z: 18 }; }
    function landing(mode) { return mode === 'village' ? data.villageStop : data.marketStop; }
    function doorPoint(mode) { const p = park(mode); return { x: p.x - 1.8, z: p.z + 1.75 }; }
    function positionPlayer(p, visible = true) {
      const player = getPlayer(); if (!player) return;
      player.position.set(p.x, 0, p.z); player.visible = visible;
      if (player.userData.blob) player.userData.blob.visible = visible;
    }
    function phase(name) {
      if (!ride) return;
      ride.phase = name; ride.at = performance.now(); ride.cb.onPhase?.(name);
    }
    function transfer() {
      if (!ride || ride.transferred) return;
      ride.transferred = true; ride.cb.onTransfer(ride.destination, landing(ride.destination));
      const p = park(ride.destination); bus.position.set(p.x + 14, 0, p.z);
    }
    function finish() {
      if (!ride) return;
      transfer();
      const done = ride; ride = null; bus.visible = false; busDoor.position.x = -1.8;
      positionPlayer(landing(done.destination)); engine.pauseInput(); done.cb.onComplete?.();
    }
    function cancel() {
      if (!ride) return;
      const old = ride; ride = null; bus.visible = false;
      positionPlayer(old.transferred ? landing(old.destination) : old.origin);
      engine.pauseInput(); old.cb.onCancel?.();
    }
    const timings = { approach: 1700, boarding: 1300, departure: 850, blackout: 900, arriving: 1100, alighting: 1300, farewell: 700 };
    function tick(dt, t) {
      if (!ride) return;
      const scale = Math.max(.03, Number(data.durationScale) || 1) * (reduceMotion ? .35 : 1);
      const progress = Math.min(1, (performance.now() - ride.at) / (timings[ride.phase] * scale));
      const smooth = progress * progress * (3 - 2 * progress);
      const source = park(ride.source), dest = park(ride.destination), player = getPlayer();
      if (ride.phase === 'approach') bus.position.set(source.x + 25 * (1 - smooth), 0, source.z);
      if (ride.phase === 'boarding') {
        busDoor.position.x = -1.8 + Math.min(1, progress * 3) * 1.25;
        const door = doorPoint(ride.source);
        positionPlayer({ x: ride.origin.x + (door.x - ride.origin.x) * smooth, z: ride.origin.z + (door.z - ride.origin.z) * smooth });
        player.rotation.y = Math.atan2(door.x - ride.origin.x, door.z - ride.origin.z);
        animatePerson(player, progress < 1, t, dt);
      }
      if (ride.phase === 'departure') {
        busDoor.position.x = -1.8; bus.position.set(source.x - smooth * 14, 0, source.z); positionPlayer(doorPoint(ride.source), false);
      }
      if (ride.phase === 'blackout') {
        if (progress >= .55 && !ride.transferred) transfer();
        positionPlayer(doorPoint(ride.transferred ? ride.destination : ride.source), false);
      }
      if (ride.phase === 'arriving') { bus.position.set(dest.x + 14 * (1 - smooth), 0, dest.z); positionPlayer(doorPoint(ride.destination), false); }
      if (ride.phase === 'alighting') {
        busDoor.position.x = -1.8 + Math.min(1, progress * 3) * 1.25;
        const from = doorPoint(ride.destination), to = landing(ride.destination);
        positionPlayer({ x: from.x + (to.x - from.x) * smooth, z: from.z + (to.z - from.z) * smooth });
        player.rotation.y = Math.atan2(to.x - from.x, to.z - from.z); animatePerson(player, progress < 1, t, dt);
      }
      if (ride.phase === 'farewell') { busDoor.position.x = -1.8; bus.position.set(dest.x - smooth * 22, 0, dest.z); }
      if (progress < 1) return;
      const phases = Object.keys(timings), next = phases[phases.indexOf(ride.phase) + 1];
      if (next) phase(next); else finish();
    }

    let marketMap = null;
    function mapBase() {
      if (marketMap) return marketMap;
      const c = document.createElement('canvas'); c.width = 600; c.height = 540;
      const g = c.getContext('2d'), P = (x, z) => [(x - data.mapBounds.x0) * 10, (z - data.mapBounds.z0) * 10];
      g.fillStyle = '#A9C98B'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#E7D6B7'; g.fillRect(75, 75, 450, 380);
      g.fillStyle = '#7D8B89'; g.fillRect(0, 423, c.width, 54);
      g.strokeStyle = '#FFF1B5'; g.lineWidth = 2; g.setLineDash([18, 18]); g.beginPath(); g.moveTo(0, 450); g.lineTo(c.width, 450); g.stroke(); g.setLineDash([]);
      for (const [x, color] of [[MX - 12, '#648E7F'], [MX + 12, '#CB8273']]) {
        const [px, pz] = P(x, -8); g.fillStyle = color; g.fillRect(px - 48, pz - 37, 96, 74);
        g.strokeStyle = '#4D6556'; g.strokeRect(px - 48, pz - 37, 96, 74);
      }
      g.fillStyle = '#628B6D'; for (const [x, z] of [[MX - 21, -17], [MX + 21, -17], [MX - 21, 10], [MX + 21, 10]]) { const p = P(x, z); g.beginPath(); g.arc(...p, 16, 0, Math.PI * 2); g.fill(); }
      marketMap = c;
      return c;
    }
    function drawMinimap(mm, player, viewYaw) {
      const g = mm.ctx, R = mm.size / 2, yaw = root.__SW_NORTH_FIXED ? 0 : viewYaw, k = R / 24;
      g.setTransform(mm.dpr, 0, 0, mm.dpr, 0, 0); g.clearRect(0, 0, mm.size, mm.size);
      g.save(); g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2); g.clip(); g.fillStyle = '#A9C98B'; g.fillRect(0, 0, mm.size, mm.size);
      g.translate(R, R); g.rotate(yaw); g.scale(k / 10, k / 10);
      g.drawImage(mapBase(), -(player.position.x - data.mapBounds.x0) * 10, -(player.position.z - data.mapBounds.z0) * 10); g.restore();
      g.textAlign = 'center'; g.font = '700 10px sans-serif';
      for (const p of data.points) {
        const dx = (p.x - player.position.x) * k, dz = (p.z - player.position.z) * k;
        const x = R + dx * Math.cos(yaw) - dz * Math.sin(yaw), y = R + dx * Math.sin(yaw) + dz * Math.cos(yaw);
        if (Math.hypot(x - R, y - R) < R - 15) { g.strokeStyle = '#FFF8E8'; g.lineWidth = 3; g.strokeText(p.name, x, y); g.fillStyle = '#365B4C'; g.fillText(p.name, x, y); }
      }
      g.save(); g.translate(R, R); g.rotate(yaw - player.rotation.y); g.beginPath(); g.moveTo(0, 8); g.lineTo(-5, -5); g.lineTo(5, -5); g.closePath(); g.fillStyle = '#F26D58'; g.fill(); g.strokeStyle = '#FFFFFF'; g.lineWidth = 1.5; g.stroke(); g.restore();
      g.fillStyle = '#BA574B'; g.fillText('N', R + Math.sin(yaw) * (R - 10), R - Math.cos(yaw) * (R - 10));
      g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2); g.strokeStyle = '#FFF8E8'; g.lineWidth = 3; g.stroke();
    }
    return {
      tick, mapBase, drawMinimap, finish, cancel,
      enter(mode) {
        if (ride && !(ride.transferred && mode === ride.destination)) cancel();
        plaza.visible = mode === 'market'; stop.visible = mode === 'village';
        for (const kind of Object.keys(interiors)) interiors[kind].visible = kind === mode;
      },
      start(destination, cb) {
        if (ride || !['village', 'market'].includes(engine.mode()) || destination === engine.mode()) return false;
        engine.pauseInput(); const p = getPlayer();
        ride = { source: engine.mode(), destination, origin: { x: p.position.x, z: p.position.z }, cb, transferred: false };
        bus.visible = true; phase('approach'); return true;
      },
      info: () => ride ? { phase: ride.phase, source: ride.source, destination: ride.destination, transferred: ride.transferred } : null,
      roomBounds(mode) { const p = data.rooms[mode]; return p ? { x0: p.x - 4.5, x1: p.x + 4.5, z0: p.z - 4.4, z1: p.z + 4.3 } : null; },
      debug: () => ({ marketVisible: plaza.visible, interiors: Object.fromEntries(Object.entries(interiors).map(([k, g]) => [k, g.visible])), busVisible: bus.visible, playerVisible: getPlayer()?.visible })
    };
  };
})(window);
