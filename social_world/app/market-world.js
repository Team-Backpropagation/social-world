/* Separate market scenery and bus travel. Existing village randomness stays untouched. */
(function (root) {
  'use strict';
  const MX = 180;
  const data = root.MarketWorldData = {
    bounds: { x0: MX - 26, x1: MX + 26, z0: -23, z1: 23 },
    mapBounds: { x0: MX - 30, x1: MX + 30, z0: -27, z1: 27 },
    villageStop: { x: 47.3, z: 14.2 },
    villageRoad: { x: 52, width: 6.4, z0: -34, z1: 58 },
    villagePath: { from: { x: 29, z: 6 }, to: { x: 47.3, z: 14.2 }, width: 2.6 },
    villageClearZones: [
      { x0: 48.2, x1: 56, z0: -34, z1: 58 },
      { x0: 44.2, x1: 50, z0: 10, z1: 20 }
    ],
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
    colliders, doors, places, engine, player: getPlayer, animatePerson, reduceMotion, resolveCollisions }) {
    const plaza = new THREE.Group(); plaza.name = 'ieum-market'; scene.add(plaza);
    const interiors = {};
    const stop = new THREE.Group(); stop.name = 'village-bus-stop'; scene.add(stop);
    let ride = null;
    const signFonts = [], stopSigns = [], benches = [];
    let bankClock = null, clockSecond = null;

    function box(parent, w, h, d, color, x, y, z, radius = .12) {
      return mesh(rbox(w, h, d, radius), M(color), x, y, z, parent);
    }
    function ground(parent, w, d, color, x, y, z, heightAt) {
      const geometry = new THREE.PlaneGeometry(w, d, Math.ceil(w), Math.ceil(d));
      geometry.rotateX(-Math.PI / 2);
      if (heightAt) {
        const p = geometry.attributes.position;
        for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getZ(i) + z));
        geometry.computeVertexNormals();
      }
      const floor = mesh(geometry, M(color), x, y, z, parent);
      floor.receiveShadow = true;
      return floor;
    }
    function label(parent, value, x, y, z, size = 80) {
      const sign = textSprite(value, { size, color: '#304D45', stroke: '#FFF9EA' });
      sign.position.set(x, y, z); parent.add(sign); return sign;
    }
    function facadeSign(parent, value, width, x, y, z) {
      // Google Fonts splits Korean into subsets. Paint one complete system font
      // first, then repaint the entire title only after all its glyphs load.
      const entry = { text: value, font: 'system', redraws: 0 }; signFonts.push(entry);
      const paint = (g, w, h, family) => {
        g.fillStyle = '#FFF3D9'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#365C4C'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = '700 92px ' + family; g.fillText(value, w / 2, h / 2, w - 80);
      };
      const tex = canvasTex(1024, 192, (g, w, h) => paint(g, w, h, '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif'));
      document.fonts?.load('400 92px "Gowun Dodum"', value).then(faces => {
        if (!faces.length || !document.fonts.check('400 92px "Gowun Dodum"', value)) return;
        paint(tex.image.getContext('2d'), tex.image.width, tex.image.height, '"Gowun Dodum"');
        tex.needsUpdate = true; entry.font = 'Gowun Dodum'; entry.redraws++;
      }).catch(() => {});
      box(parent, width + .15, .9, .14, '#456E5B', x, y, z);
      mesh(new THREE.PlaneGeometry(width, .76), M('#FFFFFF', { map: tex }), x, y, z + .08, parent);
    }
    function poleSign(parent, x, z) {
      const g = new THREE.Group(); g.name = 'yellow-bus-stop-sign'; parent.add(g); g.position.set(x, 0, z);
      box(g, .14, 2.55, .14, '#626664', 0, 1.275, 0, .04);
      box(g, .46, .12, .38, '#424845', 0, .06, 0, .04);
      box(g, 1.02, 1.53, .16, '#F6C72F', 0, 2.55, 0, .08);
      const tex = canvasTex(384, 576, (c, w, h) => {
        c.fillStyle = '#F6C72F'; c.fillRect(0, 0, w, h);
        c.strokeStyle = '#252B27'; c.lineWidth = 12; c.beginPath(); c.roundRect(22, 22, w - 44, h - 44, 24); c.stroke();
        c.fillStyle = '#252B27'; c.beginPath(); c.roundRect(104, 98, 176, 244, 30); c.fill();
        c.fillRect(83, 150, 17, 54); c.fillRect(284, 150, 17, 54);
        c.fillRect(112, 323, 34, 51); c.fillRect(238, 323, 34, 51);
        c.fillStyle = '#F6C72F'; c.beginPath(); c.roundRect(122, 132, 140, 111, 15); c.fill();
        c.fillRect(162, 112, 60, 8);
        for (const xx of [136, 248]) { c.beginPath(); c.arc(xx, 289, 13, 0, Math.PI * 2); c.fill(); }
        c.strokeStyle = '#252B27'; c.lineWidth = 8; c.beginPath(); c.moveTo(43, 405); c.lineTo(w - 43, 405); c.stroke();
        c.fillStyle = '#252B27'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = '700 90px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif'; c.fillText('버스', w / 2, 480);
      });
      for (const side of [-1, 1]) {
        const face = mesh(new THREE.PlaneGeometry(.94, 1.41), M('#FFFFFF', { map: tex }), 0, 2.55, side * .09, g);
        face.rotation.y = side === -1 ? Math.PI : 0;
      }
      shade(g); stopSigns.push({ x, z, width: 1.02, height: 1.53, color: '#F6C72F', text: '버스', icon: 'bus', twoSided: true });
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
    function bench(parent, x, z, { angle = 0, double = false, id } = {}) {
      const g = new THREE.Group(); g.name = id || 'market-bench'; parent.add(g);
      g.position.set(x, 0, z); g.rotation.y = angle;
      const seats = double ? [-.43, .43] : [0];
      for (const zz of seats) {
        box(g, 2.8, .15, .7, '#B48960', 0, .65, zz);
        for (const xx of [-1, 1]) box(g, .15, .6, .55, '#547362', xx, .3, zz);
      }
      // Shared backrest gives the square benches seats facing both directions.
      box(g, 2.8, .8, .12, '#B48960', 0, 1.08, double ? 0 : -.35);
      const cx = x + parent.position.x, cz = z + parent.position.z;
      const dx = Math.cos(angle) * 1.4, dz = -Math.sin(angle) * 1.4;
      const area = parent === plaza ? 'market' : parent === stop ? 'village' : parent.userData.area;
      colliders.push({ seg: [cx - dx, cz - dz, cx + dx, cz + dz], r: double ? .82 : .4, area });
      benches.push(g); g.userData.seats = seats.length; g.userData.area = area;
      shade(g); return g;
    }
    function wallClock(parent) {
      const g = new THREE.Group(); g.name = 'bank-clock'; parent.add(g); g.position.set(3.35, 4.03, 3.99); g.scale.setScalar(.9);
      const casing = mesh(new THREE.CylinderGeometry(.64, .64, .13, 48), M('#486E60', { r: .4 }), 0, 0, 0, g);
      casing.rotation.x = Math.PI / 2;
      mesh(new THREE.TorusGeometry(.59, .035, 8, 48), M('#D7BE87', { r: .35 }), 0, 0, .085, g);
      const dial = canvasTex(512, 512, (c) => {
        c.fillStyle = '#FFF7E6'; c.fillRect(0, 0, 512, 512);
        c.fillStyle = '#4B6559';
        for (let i = 0; i < 60; i++) {
          c.save(); c.translate(256, 256); c.rotate(i * Math.PI / 30);
          c.fillRect(i % 5 ? -2 : -4, -222, i % 5 ? 4 : 8, i % 5 ? 9 : 22); c.restore();
        }
        c.font = '700 49px "Malgun Gothic", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        for (const [text, x, y] of [['12', 256, 89], ['3', 426, 256], ['6', 256, 427], ['9', 87, 256]]) c.fillText(text, x, y);
      });
      mesh(new THREE.CircleGeometry(.565, 48), M('#FFFFFF', { map: dial }), 0, 0, .09, g);
      function hand(name, length, width, color, z) {
        const p = new THREE.Group(); p.name = name; g.add(p); p.position.z = z;
        const s = new THREE.Shape(); s.moveTo(-width / 2, -.075); s.lineTo(width / 2, -.075);
        s.lineTo(width / 2, length * .68); s.lineTo(0, length); s.lineTo(-width / 2, length * .68); s.closePath();
        mesh(new THREE.ExtrudeGeometry(s, { depth: .035, bevelEnabled: true, bevelSize: .008, bevelThickness: .006, bevelSegments: 2, steps: 1 }), M(color, { r: .45 }), 0, 0, 0, p);
        return p;
      }
      const hour = hand('bank-clock-hour', .31, .065, '#35564A', .115);
      const minute = hand('bank-clock-minute', .43, .04, '#35564A', .16);
      const hub = mesh(new THREE.SphereGeometry(.052, 12, 8), M('#D7BE87', { r: .35 }), 0, 0, .225, g); hub.scale.z = .55;
      bankClock = { group: g, hour, minute, time: null }; shade(g); updateClock();
    }
    function updateClock() {
      if (!bankClock) return;
      const now = new Date(), second = Math.floor(now.getTime() / 1000);
      if (second === clockSecond) return;
      clockSecond = second;
      const minute = now.getMinutes() + now.getSeconds() / 60;
      bankClock.hour.rotation.z = -((now.getHours() % 12) + minute / 60) * Math.PI / 6;
      bankClock.minute.rotation.z = -minute * Math.PI / 30;
      bankClock.time = { hours: now.getHours(), minutes: now.getMinutes(), seconds: now.getSeconds() };
    }
    function road(parent, centerX, z, width) {
      ground(parent, width, 5.4, '#7D8B89', centerX, .065, z);
      [-1, 1].forEach(side => box(parent, width, .15, .22, '#E7DDC7', centerX, .10, z + side * 2.8));
      for (let x = centerX - width / 2 + 2; x < centerX + width / 2; x += 4) {
        box(parent, 1.6, .015, .12, '#F9EDB7', x, .085, z);
      }
    }

    // No calls to the original engine's rnd(): additions do not move its trees or grass.
    const vr = data.villageRoad, roadHeight = z => Math.max(0, Math.min(4.85, (-20 - z) / 8.5 * 4.85));
    ground(stop, vr.width, vr.z1 - vr.z0, '#7D8B89', vr.x, .065, (vr.z0 + vr.z1) / 2, roadHeight);
    for (const side of [-1, 1]) ground(stop, .14, vr.z1 - vr.z0, '#FFF1B5', vr.x + side * (vr.width / 2 - .25), .09, (vr.z0 + vr.z1) / 2, roadHeight);
    for (let z = vr.z0 + 2; z < vr.z1; z += 4) ground(stop, .12, 1.7, '#FFF1B5', vr.x, .095, z, roadHeight);
    // North end joins the existing raised riverbank; the ramp crosses the river.
    for (const x of [vr.x - vr.width / 2 - .12, vr.x + vr.width / 2 + .12]) {
      for (let z = -29; z < -20; z += 1.5) box(stop, .14, .9, .14, '#6D7D76', x, roadHeight(z) + .5, z, .03);
      ground(stop, .2, 9, '#B7C5B9', x, 1.0, -24.5, roadHeight);
    }
    ground(stop, 3.8, 8.8, '#E4D8BE', 47.15, .09, 15.1);
    // Short pedestrian connection from the eastern walking trail to the stop.
    const vp = data.villagePath, connector = new THREE.Group(); stop.add(connector);
    connector.position.set((vp.from.x + vp.to.x) / 2, 0, (vp.from.z + vp.to.z) / 2);
    connector.rotation.y = Math.atan2(vp.to.x - vp.from.x, vp.to.z - vp.from.z);
    ground(connector, vp.width, Math.hypot(vp.to.x - vp.from.x, vp.to.z - vp.from.z), '#EADFC4', 0, .055, 0);
    poleSign(stop, 46.1, 12.3);
    bench(stop, 45.8, 18.2, { angle: Math.PI / 2, id: 'village-stop-bench' });
    colliders.push({ x: 46.1, z: 12.3, r: .25, area: 'village' });
    places.bus = { ...data.villageStop };
    doors.push({ id: 'bus', label: '시장행 버스 부르기', ...places.bus, r: 2.4, area: 'village', type: 'bus' });

    // Market square: two distinct shop fronts around an open, walkable centre.
    ground(plaza, 76, 76, '#A9C98B', MX, -.09, 0);
    ground(plaza, 45, 38, '#E7D6B7', MX, .025, 0);
    for (let x = MX - 21; x <= MX + 21; x += 3) ground(plaza, .035, 34, '#D9C5A5', x, .037, 0);
    for (let z = -17; z <= 15; z += 3) ground(plaza, 43, .035, '#D9C5A5', MX, .037, z);
    road(plaza, MX, 18, 66);
    poleSign(plaza, MX - 4.2, 14.8);
    colliders.push({ x: MX - 4.2, z: 14.8, r: .2, area: 'market' });
    bench(plaza, MX - 7.2, 14.3, { id: 'market-stop-bench' });
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
        wallClock(g);
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
    bench(plaza, MX - 8, 7, { double: true, id: 'market-square-west-bench' });
    bench(plaza, MX + 8, 7, { double: true, id: 'market-square-east-bench' });
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
      if (kind === 'bank') label(g, title, 0, 3.2, -4.5);
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
        bench(g, -2.5, 1.8, { angle: Math.PI, id: 'bank-counter-bench' });
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
    shade(bus); bus.visible = false;

    function park(mode) { return mode === 'village' ? { x: data.villageRoad.x, z: 16 } : { x: MX, z: 18 }; }
    function angle(mode) { return mode === 'village' ? -Math.PI / 2 : 0; }
    function landing(mode) { return mode === 'village' ? data.villageStop : data.marketStop; }
    function busPoint(mode, x, z) {
      const p = park(mode), a = angle(mode), c = Math.cos(a), s = Math.sin(a);
      return { x: p.x + x * c + z * s, z: p.z - x * s + z * c };
    }
    function setBus(mode, offset = 0) {
      const p = busPoint(mode, offset, 0); bus.position.set(p.x, 0, p.z); bus.rotation.y = angle(mode);
      bus.userData.area = mode;
    }
    function doorPoint(mode) { return busPoint(mode, -1.8, 2.3); }
    function localPoint(p) {
      const dx = p.x - bus.position.x, dz = p.z - bus.position.z, a = bus.rotation.y;
      return { x: dx * Math.cos(a) - dz * Math.sin(a), z: dx * Math.sin(a) + dz * Math.cos(a) };
    }
    // An oriented, solid vehicle footprint also protects normal engine movement.
    function collideBus(p, radius) {
      if (!bus.visible || bus.userData.area !== engine.mode()) return;
      const q = localPoint(p), hx = 3.86 + radius, hz = 1.63 + radius;
      if (Math.abs(q.x) >= hx || Math.abs(q.z) >= hz) return;
      if (hx - Math.abs(q.x) < hz - Math.abs(q.z)) q.x = (q.x < 0 ? -1 : 1) * hx;
      else q.z = (q.z < 0 ? -1 : 1) * hz;
      const a = bus.rotation.y;
      p.x = bus.position.x + q.x * Math.cos(a) + q.z * Math.sin(a);
      p.z = bus.position.z - q.x * Math.sin(a) + q.z * Math.cos(a);
    }
    function segmentDistance(p, a, b) {
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
    }
    function walkable(p, area) {
      const radius = .46, q = localPoint(p);
      if (Math.abs(q.x) < 3.86 + radius && Math.abs(q.z) < 1.63 + radius) return false;
      const bounds = area === 'market' ? data.bounds : { x0: -52, x1: 56, z0: -19, z1: 52 };
      if (p.x < bounds.x0 || p.x > bounds.x1 || p.z < bounds.z0 || p.z > bounds.z1) return false;
      return !colliders.some(c => {
        if (c.off || (c.area && c.area !== area)) return false;
        const d = c.seg ? segmentDistance(p, { x: c.seg[0], z: c.seg[1] }, { x: c.seg[2], z: c.seg[3] }) : Math.hypot(p.x - c.x, p.z - c.z);
        return d < c.r + radius;
      });
    }
    function clearLine(a, b, area) {
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .12));
      for (let i = 0; i <= steps; i++) if (!walkable({ x: a.x + (b.x - a.x) * i / steps, z: a.z + (b.z - a.z) * i / steps }, area)) return false;
      return true;
    }
    function walkingRoute(from, to, area) {
      if (clearLine(from, to, area)) return [from, to];
      const cs = .3, x0 = Math.min(from.x, to.x, bus.position.x - 5) - 3, z0 = Math.min(from.z, to.z, bus.position.z - 5) - 3;
      const nx = Math.ceil((Math.max(from.x, to.x, bus.position.x + 5) + 3 - x0) / cs) + 1;
      const nz = Math.ceil((Math.max(from.z, to.z, bus.position.z + 5) + 3 - z0) / cs) + 1;
      const at = i => ({ x: x0 + i % nx * cs, z: z0 + Math.floor(i / nx) * cs });
      const free = new Uint8Array(nx * nz), distance = new Float32Array(nx * nz).fill(Infinity), came = new Int32Array(nx * nz).fill(-1);
      for (let i = 0; i < free.length; i++) free[i] = walkable(at(i), area) ? 1 : 0;
      function nearest(p) {
        let best = -1, d = Infinity;
        for (let i = 0; i < free.length; i++) if (free[i]) {
          const q = at(i), n = Math.hypot(q.x - p.x, q.z - p.z);
          if (n < d && n < 1.3 && clearLine(p, q, area)) { best = i; d = n; }
        }
        return best;
      }
      const start = nearest(from), goal = nearest(to);
      if (start < 0 || goal < 0) return null;
      const open = [start], closed = new Uint8Array(free.length); distance[start] = 0;
      const heuristic = i => Math.hypot(at(i).x - at(goal).x, at(i).z - at(goal).z) / cs;
      while (open.length) {
        let best = 0;
        for (let i = 1; i < open.length; i++) if (distance[open[i]] + heuristic(open[i]) < distance[open[best]] + heuristic(open[best])) best = i;
        const cur = open.splice(best, 1)[0]; if (cur === goal) break;
        if (closed[cur]) continue; closed[cur] = 1;
        const x = cur % nx, z = Math.floor(cur / nx);
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const xx = x + dx, zz = z + dz, next = zz * nx + xx;
          if (xx < 0 || xx >= nx || zz < 0 || zz >= nz || !free[next] || closed[next]) continue;
          if (dx && dz && (!free[z * nx + xx] || !free[zz * nx + x])) continue;
          const d = distance[cur] + Math.hypot(dx, dz);
          if (d < distance[next]) { distance[next] = d; came[next] = cur; open.push(next); }
        }
      }
      if (start !== goal && came[goal] < 0) return null;
      const points = [to]; for (let i = goal; i !== start && i >= 0; i = came[i]) points.push(at(i)); points.push(at(start)); points.reverse();
      const result = [from]; let index = 0;
      while (index < points.length) {
        let next = points.length - 1;
        while (next > index && !clearLine(result.at(-1), points[next], area)) next--;
        result.push(points[next]); index = next + 1;
      }
      return result;
    }
    function routeLength(points) { return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.z - points[i].z), 0); }
    function walk(points, progress, t, dt) {
      let distance = routeLength(points) * progress;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.z - a.z);
        if (distance > length && i < points.length - 1) { distance -= length; continue; }
        const f = length ? Math.min(1, distance / length) : 1;
        positionPlayer({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f });
        const p = getPlayer(); p.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
        collideBus(p.position, .4); animatePerson(p, progress < 1, t, dt); return;
      }
    }
    function positionPlayer(p, visible = true) {
      const player = getPlayer(); if (!player) return;
      player.position.set(p.x, 0, p.z); player.visible = visible;
      if (player.userData.blob) player.userData.blob.visible = visible;
    }
    function phase(name) {
      if (!ride) return;
      if (name === 'boarding' || name === 'alighting') {
        const area = name === 'boarding' ? ride.source : ride.destination;
        const from = name === 'boarding' ? ride.origin : doorPoint(area), to = name === 'boarding' ? doorPoint(area) : landing(area);
        if (name === 'boarding') resolveCollisions(from, .48);
        ride.path = walkingRoute(from, to, area);
        // A blocked route never falls back to walking through the vehicle.
        if (!ride.path) { cancel(); return; }
        ride.walkDuration = Math.max(1300, routeLength(ride.path) / 3.4 * 1000 + 350);
      }
      ride.phase = name; ride.at = performance.now(); ride.cb.onPhase?.(name);
    }
    function transfer() {
      if (!ride || ride.transferred) return;
      ride.transferred = true; ride.cb.onTransfer(ride.destination, landing(ride.destination));
      setBus(ride.destination, 14);
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
      updateClock();
      if (!ride) return;
      const scale = Math.max(.03, Number(data.durationScale) || 1) * (reduceMotion ? .35 : 1);
      const duration = ['boarding', 'alighting'].includes(ride.phase) ? ride.walkDuration : timings[ride.phase];
      const progress = Math.min(1, (performance.now() - ride.at) / (duration * scale));
      const smooth = progress * progress * (3 - 2 * progress);
      const player = getPlayer();
      if (ride.phase === 'approach') setBus(ride.source, 25 * (1 - smooth));
      if (ride.phase === 'boarding') {
        busDoor.position.x = -1.8 + Math.min(1, progress * 3) * 1.25;
        const walking = Math.max(0, Math.min(1, (progress - .12) / .76));
        walk(ride.path, walking, t, dt);
        if (progress > .88) {
          const p = busPoint(ride.source, -1.8, 2.3 - (progress - .88) / .12 * .6);
          // Disappear at the open doorway, before the avatar overlaps the body.
          positionPlayer(p, localPoint(p).z > 2.1);
        }
      }
      if (ride.phase === 'departure') {
        busDoor.position.x = -1.8; setBus(ride.source, -smooth * 14); positionPlayer(doorPoint(ride.source), false);
      }
      if (ride.phase === 'blackout') {
        if (progress >= .55 && !ride.transferred) transfer();
        positionPlayer(doorPoint(ride.transferred ? ride.destination : ride.source), false);
      }
      if (ride.phase === 'arriving') { setBus(ride.destination, 14 * (1 - smooth)); positionPlayer(doorPoint(ride.destination), false); }
      if (ride.phase === 'alighting') {
        busDoor.position.x = -1.8 + Math.min(1, progress * 3) * 1.25;
        if (progress < .12) positionPlayer(doorPoint(ride.destination), false);
        else walk(ride.path, Math.min(1, (progress - .12) / .88), t, dt);
      }
      if (ride.phase === 'farewell') { busDoor.position.x = -1.8; setBus(ride.destination, -smooth * 22); }
      if (player.visible) collideBus(player.position, .4);
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
      tick, mapBase, drawMinimap, finish, cancel, collide: collideBus,
      drawVillageMap(g, P, scale) {
        const r = data.villageRoad, [x, z] = P(r.x - r.width / 2, r.z0);
        g.fillStyle = '#7D8B89'; g.fillRect(x, z, r.width * scale, (r.z1 - r.z0) * scale);
        g.strokeStyle = '#FFF1B5'; g.lineWidth = Math.max(1, .12 * scale); g.setLineDash([1.7 * scale, 2.3 * scale]);
        g.beginPath(); g.moveTo(...P(r.x, r.z0)); g.lineTo(...P(r.x, r.z1)); g.stroke(); g.setLineDash([]);
        g.strokeStyle = '#EADFC4'; g.lineWidth = data.villagePath.width * scale;
        g.beginPath(); g.moveTo(...P(data.villagePath.from.x, data.villagePath.from.z)); g.lineTo(...P(data.villagePath.to.x, data.villagePath.to.z)); g.stroke();
        const platform = P(45.25, 10.7); g.fillStyle = '#E4D8BE'; g.fillRect(...platform, 3.8 * scale, 8.8 * scale);
      },
      enter(mode) {
        if (ride && !(ride.transferred && mode === ride.destination)) cancel();
        plaza.visible = mode === 'market'; stop.visible = mode === 'village';
        for (const kind of Object.keys(interiors)) interiors[kind].visible = kind === mode;
      },
      start(destination, cb) {
        if (ride || !['village', 'market'].includes(engine.mode()) || destination === engine.mode()) return false;
        engine.pauseInput(); const p = getPlayer();
        ride = { source: engine.mode(), destination, origin: { x: p.position.x, z: p.position.z }, cb, transferred: false };
        bus.visible = true; setBus(ride.source, 25); phase('approach'); return true;
      },
      info: () => ride ? { phase: ride.phase, source: ride.source, destination: ride.destination, transferred: ride.transferred } : null,
      roomBounds(mode) { const p = data.rooms[mode]; return p ? { x0: p.x - 4.5, x1: p.x + 4.5, z0: p.z - 4.4, z1: p.z + 4.3 } : null; },
      debug: () => ({ marketVisible: plaza.visible, interiors: Object.fromEntries(Object.entries(interiors).map(([k, g]) => [k, g.visible])), busVisible: bus.visible, playerVisible: getPlayer()?.visible,
        clock: bankClock ? { ...bankClock.time, hourAngle: bankClock.hour.rotation.z, minuteAngle: bankClock.minute.rotation.z, hands3D: bankClock.hour.children[0].geometry.type === 'ExtrudeGeometry' && bankClock.minute.children[0].geometry.type === 'ExtrudeGeometry' } : null,
        benches: benches.map(g => ({ id: g.name, area: g.userData.area, x: g.position.x + g.parent.position.x, z: g.position.z + g.parent.position.z, angle: g.rotation.y, seats: g.userData.seats })),
        bus: { x: bus.position.x, z: bus.position.z, angle: bus.rotation.y, halfLength: 3.86, halfWidth: 1.63, colliderActive: bus.visible && bus.userData.area === engine.mode(), doorOpen: busDoor.position.x > -1.7 },
        walkingPath: ride?.path?.map(p => ({ ...p })) || null, signs: stopSigns.map(p => ({ ...p })), signFonts: signFonts.map(p => ({ ...p })) })
    };
  };
})(window);
