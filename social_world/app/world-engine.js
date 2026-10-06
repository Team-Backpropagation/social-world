/*
 * 3D 마을 엔진 — 이음 마을 3D 컨셉(아티팩트)을 소셜 월드에 옮긴 것
 *   둥근 지평선·바람에 흔들리는 풀·틸트시프트 후처리는 원본 그대로.
 *   새 맵(광장·지원센터·미션방·동아리센터·게임방·카페·공원·내 집)과 내 방 실내.
 *   게임 규칙(튜토리얼·투어·대화)은 app.js, 휴대폰·지도는 ui.js. 엔진은 장면·이동·근처 판정만 맡는다.
 *
 * UI 시연본(PR #13, social-world-ui-v2)에서 가져온 추가 기능: 키 바꾸기(setBindings), 입력 정지(pauseInput),
 * 화질 선택(setQuality), 전체 지도 바탕(mapBase), NPC 위치(npcPositions), 미니맵 북쪽 고정, 순간이동 때 강아지 동행.
 */
  var ENGINE = null, ENGINE_FAILED = false;
  function getEngine(){
    if(ENGINE || ENGINE_FAILED) return ENGINE;
    if(!window.THREE){ ENGINE_FAILED = true; return null; }
    try { ENGINE = makeEngine(); } catch(e){ console.warn("3D 엔진 초기화 실패:", e); ENGINE_FAILED = true; ENGINE = null; }
    return ENGINE;
  }

  function makeEngine(){
    const THREE = window.THREE;
    const LITE = !!window.__SW_LITE;
    const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const isSmall = Math.min(window.innerWidth, window.innerHeight) < 600;
    THREE.ColorManagement.legacyMode = false;
    const stage = document.getElementById('stage');
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    const isGL2 = renderer.capabilities.isWebGL2;
    let DPR = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    stage.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('tabindex', '0');

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(new THREE.Color('#A6D4F2').convertSRGBToLinear(), 110, 300);   // 맑은 날: 먼 곳만 옅은 하늘색
    const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 400);

    // ---------------- 공통: 둥근 지평선 + 바람 (원본 그대로)
    const U = { center: { value: new THREE.Vector3() }, k: { value: 0.0045 }, time: { value: 0 }, yaw: { value: 0 } };
    const BEND_K = 0.0045;
    function bendY(x, z) { const dz = z - U.center.value.z, dx = x - U.center.value.x, c = Math.cos(U.yaw.value), s = Math.sin(U.yaw.value), a = dx * s + dz * c, b = dx * c - dz * s; return U.k.value * (a * a + 0.25 * b * b); }   // 카메라가 보는 방향으로 더 휘어진다
    function patch(mat, wind = 0) {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uBendCenter = U.center; sh.uniforms.uBendK = U.k; sh.uniforms.uTime = U.time; sh.uniforms.uYaw = U.yaw;
        const sway = wind ? `
            float sw = ${wind.toFixed(4)} * max(0.0, transformed.y);
            bw.x += sin(uTime * 1.6 + bw.x * 0.45 + bw.z * 0.3) * sw;
            bw.z += cos(uTime * 1.2 + bw.x * 0.25) * sw * 0.5;` : '';
        sh.vertexShader = 'uniform vec3 uBendCenter;\nuniform float uBendK;\nuniform float uTime;\nuniform float uYaw;\n' + sh.vertexShader
          .replace('#include <project_vertex>', `
            vec4 bw = vec4( transformed, 1.0 );
            #ifdef USE_INSTANCING
              bw = instanceMatrix * bw;
            #endif
            bw = modelMatrix * bw;${sway}
            float bdz = bw.z - uBendCenter.z; float bdx = bw.x - uBendCenter.x;
            float bya = bdx * sin(uYaw) + bdz * cos(uYaw); float byb = bdx * cos(uYaw) - bdz * sin(uYaw);
            bw.y -= uBendK * (bya * bya + 0.25 * byb * byb);
            vec4 mvPosition = viewMatrix * bw;
            gl_Position = projectionMatrix * mvPosition;`)
          .replace('#include <worldpos_vertex>', `
            #include <worldpos_vertex>
            #if defined( USE_SHADOWMAP ) || defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_TRANSMISSION )
              { float wdz = worldPosition.z - uBendCenter.z; float wdx = worldPosition.x - uBendCenter.x;
                float wya = wdx * sin(uYaw) + wdz * cos(uYaw); float wyb = wdx * cos(uYaw) - wdz * sin(uYaw);
                worldPosition.y -= uBendK * (wya * wya + 0.25 * wyb * wyb); }
            #endif`);
      };
      mat.customProgramCacheKey = () => 'bend2_' + wind;
      return mat;
    }
    const depthMat = patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
    const matCache = new Map();
    function M(color, o = {}) {
      const key = color + JSON.stringify(o, (k, v) => (v && v.isTexture ? v.uuid : v));
      if (matCache.has(key)) return matCache.get(key);
      const m = patch(new THREE.MeshStandardMaterial({
        color, roughness: o.r ?? 0.85, metalness: 0, flatShading: !!o.flat,
        emissive: o.em || '#000000', emissiveIntensity: o.ei ?? 0,
        transparent: !!o.transparent, opacity: o.opacity ?? 1, map: o.map || null, vertexColors: !!o.vc,
        alphaTest: o.alphaTest || 0, side: o.double ? THREE.DoubleSide : THREE.FrontSide
      }), o.wind || 0);
      matCache.set(key, m); return m;
    }
    function shade(obj, cast = true, receive = true) {
      obj.traverse(c => { if (c.isMesh) { c.castShadow = cast; c.receiveShadow = receive; if (cast) c.customDepthMaterial = c.userData.depth || depthMat; } });
      return obj;
    }
    function mesh(geo, mat, x = 0, y = 0, z = 0, parent = scene) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; }
    const rnd = (() => { let s = 20260928; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

    function roundedRect(w, h, r) {
      const s = new THREE.Shape(), x = -w / 2, y = -h / 2; r = Math.min(r, w / 2, h / 2);
      s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
      s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
      return s;
    }
    const geoCache = new Map();
    function rbox(w, h, d, b = 0.12) {
      const key = [w, h, d, b].join(','); if (geoCache.has(key)) return geoCache.get(key);
      b = Math.min(b, w / 3, h / 3, d / 3);
      const g = new THREE.ExtrudeGeometry(roundedRect(w - 2 * b, h - 2 * b, b), { depth: Math.max(0.001, d - 2 * b), bevelEnabled: true, bevelSize: b, bevelThickness: b, bevelSegments: 3, curveSegments: 5 });
      g.center(); geoCache.set(key, g); return g;
    }
    function prism(w, h, d, b = 0.08) {
      const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.lineTo(-w / 2, 0);
      const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelSize: b, bevelThickness: b, bevelSegments: 2, curveSegments: 2 });
      g.translate(0, 0, -d / 2); return g;
    }
    // 직사각형 모임지붕 — 네 면이 모두 경사지고 용마루는 긴 변 방향. W·D는 처마까지 포함한 바닥 크기, 아래에 처마 두께판
    function hipRoof(parent, y, W, D, H, mat, T = 0.22) {
      const g = new THREE.Group(); g.position.y = y; parent.add(g);
      mesh(rbox(W, T, D, 0.08), mat, 0, T / 2, 0, g);
      const r = Math.max(0, (W - D) / 2), w = W / 2, d = D / 2, y0 = T * 0.9;
      const A = [-w, y0, -d], B = [w, y0, -d], C = [w, y0, d], E = [-w, y0, d], R1 = [-r, y0 + H, 0], R2 = [r, y0 + H, 0];
      const faces = [[[E, C, R2], [E, R2, R1]], [[B, A, R1], [B, R1, R2]], [[C, B, R2]], [[A, E, R1]]];
      const pos = [], uv = [];
      faces.forEach((f, i) => f.forEach(t => t.forEach(p => { pos.push(p[0], p[1], p[2]); if (i < 2) uv.push(p[0], p[2]); else uv.push(p[2], p[0]); })));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.computeVertexNormals();
      mesh(geo, mat, 0, 0, 0, g);
      return g;
    }
    function canvasTex(w, h, draw, srgb = true) {
      const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
      const t = new THREE.CanvasTexture(c); if (srgb) t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t;
    }
    const FONT = "'Gowun Dodum','Apple SD Gothic Neo','Malgun Gothic',sans-serif";
    const COL = {
      wall: '#F6E9D3', wallWarm: '#F3DFC0', roof: '#D9774F', teal: '#3F8C86', tealDark: '#2F6E69',
      wood: '#B7835A', woodDark: '#86603F', ink: '#2F3642', gold: '#E9B44C', glass: '#9CC7D0', lit: '#F7D48E', water: '#6FB9BF'
    };

    // ---------------- 잎 카드
    const leafTex = canvasTex(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      const grd = g.createLinearGradient(0, h, w, 0); grd.addColorStop(0, '#D9D9D9'); grd.addColorStop(1, '#FFFFFF');
      g.fillStyle = grd; g.beginPath(); g.moveTo(w * 0.5, h * 0.04);
      g.bezierCurveTo(w * 0.98, h * 0.3, w * 0.9, h * 0.8, w * 0.5, h * 0.97);
      g.bezierCurveTo(w * 0.1, h * 0.8, w * 0.02, h * 0.3, w * 0.5, h * 0.04); g.fill();
      g.strokeStyle = 'rgba(140,140,140,.55)'; g.lineWidth = 4; g.beginPath(); g.moveTo(w * 0.5, h * 0.12); g.lineTo(w * 0.5, h * 0.92); g.stroke();
    });
    const foliageDepth = patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTex, alphaTest: 0.5 }), 0.02);
    function foliageMat(wind = 0.02) { return M('#FFFFFF', { map: leafTex, alphaTest: 0.5, vc: true, double: true, wind, r: 0.9 }); }
    function foliage(clusters) {
      const pos = [], nor = [], uv = [], col = [], idx = [];
      const e = new THREE.Euler(), q = new THREE.Quaternion(), ux = new THREE.Vector3(), uy = new THREE.Vector3(), d = new THREE.Vector3(), c = new THREE.Color(), n = new THREE.Vector3(), up = new THREE.Vector3(0, 0.35, 0);
      for (const cl of clusters) {
        const pal = cl.pal.map(hx => new THREE.Color(hx));
        for (let i = 0; i < cl.n; i++) {
          d.set(rnd() * 2 - 1, rnd() * 1.6 - 0.45, rnd() * 2 - 1).normalize();
          const rr = cl.r * (0.62 + rnd() * 0.42);
          const cx = cl.x + d.x * rr, cy = cl.y + d.y * rr * (cl.flat || 0.85), cz = cl.z + d.z * rr;
          e.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28); q.setFromEuler(e);
          const s = cl.size * (0.75 + rnd() * 0.5);
          ux.set(s * 0.5, 0, 0).applyQuaternion(q); uy.set(0, s * 0.62, 0).applyQuaternion(q);
          n.copy(d).add(up).normalize();
          const t = THREE.MathUtils.clamp(d.y * 0.6 + 0.45 + (rnd() - 0.5) * 0.35, 0, 1);
          if (t < 0.5) c.copy(pal[0]).lerp(pal[1], t * 2); else c.copy(pal[1]).lerp(pal[2], (t - 0.5) * 2);
          const b = pos.length / 3;
          for (const [a, bb, u, v] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
            pos.push(cx + ux.x * a + uy.x * bb, cy + ux.y * a + uy.y * bb, cz + ux.z * a + uy.z * bb);
            nor.push(n.x, n.y, n.z); uv.push(u, v); col.push(c.r, c.g, c.b);
          }
          idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx); g.computeBoundingSphere();
      return g;
    }
    function leafy(parent, clusters, wind = 0.02) {
      const m = mesh(foliage(clusters), foliageMat(wind), 0, 0, 0, parent);
      m.userData.depth = foliageDepth;
      return m;
    }
    const PAL = {
      tree: ['#4E7A3A', '#78A64E', '#B5D27A'], bush: ['#557F3D', '#83B055', '#BFD886'], tomato: ['#3F6B32', '#5E9443', '#94C164'],
      carrot: ['#4C8A3C', '#77B04E', '#A9D173'], orange: ['#3F6D34', '#5E8F45', '#8FBC5E'], blossom: ['#D9877A', '#F0AE9A', '#FBD9C8']
    };

    // ---------------- 접지 그림자
    const blobTex = canvasTex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(30,40,20,1)'); gr.addColorStop(0.55, 'rgba(30,40,20,.45)'); gr.addColorStop(1, 'rgba(30,40,20,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false);
    const blobGeo = new THREE.PlaneGeometry(1, 1, 4, 4); blobGeo.rotateX(-Math.PI / 2);
    const blobMats = new Map();
    function blob(x, z, size, alpha = 0.3, parent = scene) {
      const key = alpha.toFixed(2);
      if (!blobMats.has(key)) blobMats.set(key, patch(new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity: alpha, depthWrite: false, color: '#FFFFFF' })));
      const m = new THREE.Mesh(blobGeo, blobMats.get(key));
      m.position.set(x, 0.035, z); m.scale.set(size, 1, size); m.renderOrder = 1; parent.add(m); return m;
    }

    // ---------------- 글자 스프라이트 (말풍선·졸음 표시)
    function textSprite(text, opt = {}) {
      const w = 512, h = 200;
      const tex = canvasTex(w, h, (c) => {
        c.fillStyle = opt.bg || '#FFFDF7'; c.strokeStyle = opt.stroke || '#3F8C86'; c.lineWidth = 10;
        c.beginPath(); if (c.roundRect) c.roundRect(14, 14, w - 28, h - 70, 60); else c.rect(14, 14, w - 28, h - 70); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(w / 2 - 26, h - 58); c.lineTo(w / 2 - 6, h - 14); c.lineTo(w / 2 + 22, h - 58); c.closePath(); c.fill(); c.stroke();
        c.fillStyle = opt.bg || '#FFFDF7'; c.fillRect(w / 2 - 20, h - 64, 38, 12);
        c.fillStyle = opt.color || '#2F3642'; c.font = `700 ${opt.size || 62}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(text, w / 2, (h - 56) / 2 + 10);
      });
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
      s.scale.set(2.1, 0.82, 1); s.renderOrder = 10; return s;
    }

    // ---------------- 사람 (큰 머리 2등신) — 원본 + 헤어·표정·소품 확장
    const SKIN = ['#F6D7BD', '#EDC3A0', '#DDAA85', '#F8E0CC'];
    function person(o, parent = scene) {
      const g = new THREE.Group(), s = o.scale || 1, legs = [], arms = [];
      for (const sx of [-0.12, 0.12]) {
        const hip = new THREE.Group(); hip.position.set(sx, 0.36, 0); g.add(hip);
        mesh(new THREE.CapsuleGeometry(0.095, 0.14, 4, 10), M(o.skin), 0, -0.14, 0, hip);
        mesh(new THREE.SphereGeometry(0.12, 12, 10), M(o.shoes || '#8A5A3A'), 0, -0.3, 0.04, hip).scale.set(1, 0.8, 1.25);
        legs.push(hip);
      }
      mesh(new THREE.CapsuleGeometry(0.27, 0.12, 6, 16), M(o.bottom), 0, 0.5, 0, g).scale.set(1, 1, 0.9);
      mesh(new THREE.SphereGeometry(0.27, 18, 14), M(o.shirt), 0, 0.72, 0, g).scale.set(1, 0.9, 0.88);
      if (o.overall) { mesh(rbox(0.3, 0.26, 0.1, 0.04), M(o.bottom), 0, 0.68, 0.2, g); for (const sx of [-0.14, 0.14]) mesh(new THREE.BoxGeometry(0.06, 0.3, 0.05), M(o.bottom), sx, 0.78, 0.2, g).rotation.x = -0.35; }
      for (const sx of [-0.3, 0.3]) {
        const sh = new THREE.Group(); sh.position.set(sx, 0.78, 0); g.add(sh);
        mesh(new THREE.CapsuleGeometry(0.08, 0.16, 4, 8), M(o.shirt), 0, -0.13, 0, sh);
        mesh(new THREE.SphereGeometry(0.09, 10, 8), M(o.skin), 0, -0.28, 0, sh);
        sh.rotation.z = sx > 0 ? 0.35 : -0.35; arms.push(sh);
      }
      const head = new THREE.Group(); head.position.set(0, 1.28, 0); g.add(head);
      mesh(new THREE.SphereGeometry(0.5, 28, 22), M(o.skin, { r: 0.7 }), 0, 0, 0, head).scale.set(1.04, 0.95, 0.96);
      const face = o.face || 'smile';
      for (const ex of [-0.17, 0.17]) {
        const eye = mesh(new THREE.SphereGeometry(0.075, 14, 12), M('#2A2622', { r: 0.25 }), ex, -0.04, 0.45, head);
        eye.scale.set(0.85, (face === 'wink' && ex > 0) || face === 'calm' ? 0.3 : 1.25, 0.45);
        if (!(face === 'wink' && ex > 0) && face !== 'calm') mesh(new THREE.SphereGeometry(0.025, 8, 6), M('#FFFFFF', { em: '#FFFFFF', ei: 0.6 }), ex + 0.025, 0.0, 0.485, head);
        const bl = mesh(new THREE.CircleGeometry(0.075, 14), M('#F29C92', { transparent: true, opacity: 0.6 }), ex * 1.6, -0.17, 0.43, head); bl.rotation.y = ex > 0 ? 0.55 : -0.55;
      }
      if (face === 'grin') { const m = mesh(new THREE.SphereGeometry(0.075, 14, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M('#8A4A3A'), 0, -0.15, 0.455, head); m.scale.set(1.3, 1, 0.5); }
      else if (face === 'calm') mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), M('#8A4A3A'), 0, -0.18, 0.47, head);
      else mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 12, Math.PI), M('#8A4A3A'), 0, -0.17, 0.465, head).rotation.z = Math.PI;
      const Hm = M(o.hair, { r: 0.75 });
      mesh(new THREE.SphereGeometry(0.53, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.55), Hm, 0, 0.03, -0.03, head).rotation.x = -0.35;
      mesh(new THREE.SphereGeometry(0.5, 24, 18, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.45), Hm, 0, 0.0, -0.08, head).scale.set(1.04, 1.02, 1.02);
      if (o.style !== 'spiky') for (let i = -2; i <= 2; i++) mesh(new THREE.SphereGeometry(0.16, 12, 10), Hm, i * 0.14, 0.24 - Math.abs(i) * 0.02, 0.36 - Math.abs(i) * 0.05, head).scale.set(1, 0.7, 0.55);
      if (o.style === 'bob') for (const sx of [-0.43, 0.43]) mesh(new THREE.SphereGeometry(0.2, 14, 12), Hm, sx, -0.2, 0.02, head).scale.set(0.8, 1.45, 1.1);
      if (o.style === 'bun') mesh(new THREE.SphereGeometry(0.2, 14, 12), Hm, 0, 0.45, -0.25, head);
      if (o.style === 'curly') for (let i = 0; i < 11; i++) { const a = -0.3 + i / 10 * (Math.PI + 0.6); mesh(new THREE.SphereGeometry(0.17, 12, 10), Hm, Math.cos(a) * 0.46, 0.12 + Math.sin(a) * 0.3, -0.08 + Math.sin(a) * 0.05, head); }
      if (o.style === 'spiky') for (let i = 0; i < 6; i++) { const a = -1 + i * 0.4; const c = mesh(new THREE.ConeGeometry(0.13, 0.36, 8), Hm, Math.sin(a) * 0.3, 0.48, 0.12 - Math.abs(a) * 0.1, head); c.rotation.z = -a * 0.7; c.rotation.x = 0.35; }
      const acc = o.acc || 'none';
      if (o.hat) { mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 24), M(o.hat), 0, 0.33, 0, head); mesh(new THREE.SphereGeometry(0.42, 20, 12, 0, 6.28, 0, 1.4), M(o.hat), 0, 0.3, 0, head); }
      if (acc === 'cap') { mesh(new THREE.SphereGeometry(0.54, 24, 14, 0, 6.28, 0, 1.3), M(o.accColor || o.shirt), 0, 0.08, 0, head); const b = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 20, 1, false, -Math.PI / 2, Math.PI), M(o.accColor || o.shirt), 0, 0.2, 0.38, head); b.scale.set(1, 1, 0.9); }
      if (acc === 'beanie') { mesh(new THREE.SphereGeometry(0.55, 24, 14, 0, 6.28, 0, 1.25), M(o.accColor || o.shirt), 0, 0.07, 0, head); mesh(new THREE.TorusGeometry(0.47, 0.07, 8, 28), M('#FFFDF7'), 0, 0.26, 0, head).rotation.x = Math.PI / 2; mesh(new THREE.SphereGeometry(0.13, 12, 10), M('#FFFDF7'), 0, 0.62, 0, head); }
      if (acc === 'glasses') { for (const ex of [-0.17, 0.17]) mesh(new THREE.TorusGeometry(0.12, 0.018, 8, 20), M('#2F3642'), ex, -0.04, 0.5, head); mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), M('#2F3642'), 0, -0.02, 0.52, head); }
      if (acc === 'headphones') { const band = mesh(new THREE.TorusGeometry(0.55, 0.045, 8, 24, Math.PI), M('#3B3B3B'), 0, 0.02, 0, head); band.rotation.z = 0; for (const sx of [-0.53, 0.53]) mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 16), M('#3B3B3B'), sx, -0.02, 0, head).rotation.z = Math.PI / 2; }
      if (acc === 'flower' || o.flower) { const f = new THREE.Group(); for (let i = 0; i < 5; i++) { const a = i / 5 * 6.28; mesh(new THREE.SphereGeometry(0.06, 8, 6), M('#F4A6C0'), Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0, f); } mesh(new THREE.SphereGeometry(0.04, 8, 6), M('#F6D06A'), 0, 0, 0.03, f); f.position.set(0.3, 0.28, 0.3); f.rotation.y = 0.6; head.add(f); }
      g.scale.setScalar(s);
      g.userData = { legs, arms, head, phase: rnd() * 6.28, baseY: 0 };
      parent.add(shade(g));
      if (parent === scene) g.userData.blob = blob(0, 0, 1.1 * s, 0.4);
      return g;
    }
    function animatePerson(p, moving, t, dt) {
      const u = p.userData; u.phase += dt * (moving ? 10 : 0);
      const sw = moving ? Math.sin(u.phase) * 0.7 : 0;
      if (!u.seated) { u.legs[0].rotation.x = sw; u.legs[1].rotation.x = -sw; }
      u.arms[0].rotation.x = -sw * 0.9; u.arms[1].rotation.x = sw * 0.9;
      const bob = moving ? Math.abs(Math.sin(u.phase)) * 0.07 : Math.sin(t * 2 + u.phase) * 0.012;
      p.position.y = bob * p.scale.y + u.baseY;
      u.head.rotation.z = moving ? Math.sin(u.phase) * 0.04 : Math.sin(t * 0.8 + u.phase) * 0.05;
      if (u.blob) u.blob.position.set(p.position.x, 0.04, p.position.z);
    }
    function setSeated(p, on, baseY = 0.28) {
      const u = p.userData; u.seated = on; u.baseY = on ? baseY : 0;
      u.legs.forEach(l => l.rotation.x = on ? -1.35 : 0);
    }
    function removePerson(p) { if (!p) return; if (p.userData.blob) p.userData.blob.parent.remove(p.userData.blob); p.parent && p.parent.remove(p); }

    // 캐릭터 조합값 → 3D 모습
    function lookFromAvatar(av) {
      av = av || {};
      return { skin: av.skin || SKIN[0], hair: av.hairColor || '#2b2b2b', shirt: av.outfit || '#4caf6e', bottom: '#56657A', shoes: '#8A5A3A',
        style: ({ short: 'short', long: 'bob', curly: 'curly', bun: 'bun', spiky: 'spiky' })[av.hair] || 'short',
        acc: av.acc || 'none', face: av.face || 'smile' };
    }
    const LUMI_LOOK = { shirt: '#FFFDF7', bottom: '#B56CC0', overall: true, hair: '#5A3B2C', skin: SKIN[2], style: 'bun', flower: true };

    // ---------------- 세계를 한 번만 짓는다 (처음 들어갈 때)
    const colliders = [];
    const MAPDATA = { paths: [], pathW: 2.4, lakes: [], till: [], trees: [], riverZ: -24 };   // 미니맵용 지도 정보
    const places = {};        // 문·장소 → 서는 위치 {x,z}
    const doors = [];         // 근처 판정용 {id,label,x,z,r,area}
    let sky, sun, SUN_DIR, skyDeco = null, sunDisc = null, cloudRing = null, fountainJets = [], flags = [], chimneyPos, smoke = [], butterflies = [], petals, petalGeo, PN = 0;
    let npcObjs = [], villagers = [], dog, dogLegs = [], tail, dogBlob, bubble, homeSign = null, roomLight;
    const RX = 0, RZ = 110;     // 내 방 실내 위치 (마을과 멀리 떨어진 곳)
    let built = false;

    function frontOf(g, lx, lz) { const v = new THREE.Vector3(lx, 0, lz); g.updateMatrixWorld(); g.localToWorld(v); return { x: v.x, z: v.z }; }
    function faceTo(g, x, z, tx = 0, tz = 0) { g.rotation.y = Math.atan2(tx - x, tz - z); }
    function signTex(text) {
      return canvasTex(512, 192, (g, w, h) => {
        g.fillStyle = '#FFF8EC'; g.beginPath(); if (g.roundRect) g.roundRect(8, 8, w - 16, h - 16, 44); else g.rect(8, 8, w - 16, h - 16); g.fill();
        g.fillStyle = COL.ink; g.font = `700 ${text.length > 4 ? 76 : 88}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 4);
      });
    }
    function signpost(x, z, text, rot = 0) {
      const g = new THREE.Group(), tex = signTex(text);
      mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.6, 8), M(COL.woodDark), 0, 0.8, 0, g);
      mesh(rbox(2.3, 0.9, 0.16, 0.08), M(COL.wood), 0, 1.75, 0, g);
      const f = mesh(new THREE.PlaneGeometry(2.1, 0.78), M('#FFFFFF', { map: tex }), 0, 1.75, 0.09, g);
      const b = mesh(new THREE.PlaneGeometry(2.1, 0.78), M('#FFFFFF', { map: tex }), 0, 1.75, -0.09, g); b.rotation.y = Math.PI;
      g.position.set(x, 0, z); g.rotation.y = rot; scene.add(shade(g)); colliders.push({ x, z, r: 0.35 }); blob(x, z, 0.8, 0.3);
      return { front: f, back: b };
    }
    function windowPane(parent, x, y, z, w = 0.9, h = 1.0, lit = false, ry = 0) {
      const g = new THREE.Group();
      mesh(rbox(w + 0.18, h + 0.18, 0.12, 0.05), M('#FFFDF7'), 0, 0, 0, g);
      mesh(rbox(w, h, 0.14, 0.04), M(lit ? COL.lit : COL.glass, { r: 0.35, em: lit ? '#F2B45A' : '#000000', ei: lit ? 0.7 : 0 }), 0, 0, 0.01, g);
      mesh(new THREE.BoxGeometry(0.06, h, 0.16), M('#FFFDF7'), 0, 0, 0.02, g);
      mesh(new THREE.BoxGeometry(w, 0.06, 0.16), M('#FFFDF7'), 0, 0, 0.02, g);
      g.position.set(x, y, z); g.rotation.y = ry; parent.add(g);
    }
    function doorMesh(parent, x, z, color, h = 1.9) {
      mesh(rbox(1.2, h, 0.2, 0.12), M(color), x, h / 2, z, parent);
      mesh(new THREE.SphereGeometry(0.07, 8, 6), M(COL.gold, { r: 0.4 }), x + 0.38, h * 0.48, z + 0.12, parent);
    }
    function towardCenter(p, d) { const l = Math.hypot(p.x, p.z) || 1; return { x: p.x - p.x / l * d, z: p.z - p.z / l * d }; }

    const SUN_DIR_SKY = new THREE.Vector3(0.18, 0, -1);   // 하늘의 해: 기본 시점(북쪽)을 낮췄을 때 지원센터 위로 보이게
    function build() {
      if (built) return; built = true;
      // 하늘·빛
      sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { sunDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() }, top: { value: new THREE.Color('#2F84DA') }, mid: { value: new THREE.Color('#5CADEA') }, low: { value: new THREE.Color('#A6D4F2') } },
        vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 low; uniform vec3 sunDir; varying vec3 vp; void main(){ float h = vp.y; vec3 c = h > 0.08 ? mix(mid, top, smoothstep(0.08, 0.7, h)) : mix(low, mid, smoothstep(-0.05, 0.08, h)); c = mix(c, low, (1.0 - smoothstep(0.0, 0.1, abs(h))) * 0.12); float sd = max(dot(vp, normalize(sunDir)), 0.0); c += vec3(1.0, 0.92, 0.72) * (pow(sd, 6.0) * 0.12 + pow(sd, 48.0) * 0.3); gl_FragColor = vec4(pow(c, vec3(2.2)), 1.0); }'   // 색은 화면에 보이는 색(sRGB)으로 적고 여기서 선형으로 바꾼다
      }));
      scene.add(sky);
      // ☀ 해·구름 — 하늘 장식. 땅에 닿지 않게 카메라 초점을 따라다닌다(실내에서는 숨김)
      {
        skyDeco = new THREE.Group(); scene.add(skyDeco);
        const az = Math.atan2(SUN_DIR_SKY.x, SUN_DIR_SKY.z), R = 240;
        const sunM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#FFE57A').multiplyScalar(1.25), fog: false });
        const haloM = new THREE.MeshBasicMaterial({ color: '#FFF3C4', fog: false, transparent: true, opacity: 0.28, depthWrite: false });
        sunDisc = new THREE.Group();
        sunDisc.add(new THREE.Mesh(new THREE.CircleGeometry(8, 40), sunM));
        const halo = new THREE.Mesh(new THREE.RingGeometry(8.6, 14, 40), haloM); halo.position.z = -0.1; sunDisc.add(halo);
        sunDisc.position.set(Math.sin(az) * R, -9, Math.cos(az) * R);   /* 원본 시점에서 보이는 높이 — 둥근 지평선 때문에 하늘이 카메라보다 아래로 보인다 */ sunDisc.renderOrder = -1; skyDeco.add(sunDisc);
        sky.material.uniforms.sunDir.value.copy(sunDisc.position).normalize();
        cloudRing = new THREE.Group(); skyDeco.add(cloudRing);
        const rnd = (() => { let q = 7177; return () => (q = (q * 16807) % 2147483647) / 2147483647; })();   // 따로 쓰는 난수 — 마을 나무·풀 배치 순서를 바꾸지 않게
        const cloudM = new THREE.MeshStandardMaterial({ color: '#FFFFFF', emissive: '#EAF2FF', emissiveIntensity: 0.55, roughness: 1, fog: false });   // 둥근 지평선 셰이더를 안 씀(멀리 있어 휘면 땅 밑으로 꺼짐)
        const puff = new THREE.SphereGeometry(1, 16, 12);
        for (let i = 0; i < 12; i++) {
          const c = new THREE.Group(), a = i / 12 * Math.PI * 2 + (rnd() - 0.5) * 0.35, R2 = 200 + rnd() * 30, s = 5 + rnd() * 3;
          [[0, 0, 0, 1.3], [1.3, -0.2, 0.2, 1.0], [-1.3, -0.25, -0.1, 1.0], [0.6, 0.6, 0, 0.95], [-0.5, 0.5, 0.2, 0.85], [2.3, -0.45, 0, 0.7], [-2.2, -0.45, 0, 0.7]]
            .forEach(([x, y, z, r]) => { const m = new THREE.Mesh(puff, cloudM); m.position.set(x, y, z); m.scale.set(r, r * 0.8, r); c.add(m); });
          c.scale.setScalar(s); c.position.set(Math.sin(a) * R2, -14 + rnd() * 20, Math.cos(a) * R2); c.lookAt(0, c.position.y, 0); cloudRing.add(c);
        }
      }
      scene.add(new THREE.HemisphereLight('#EAF4FF', '#7FA85A', 0.58));
      sun = new THREE.DirectionalLight('#FFF4E2', 1.5);
      sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 3.2;
      const SH = 34; Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 120 });
      sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.035;
      scene.add(sun); scene.add(sun.target);
      SUN_DIR = new THREE.Vector3(-0.85, 0.95, -0.55).normalize();

      // 땅
      const G = 62, GPX = LITE ? 1024 : 2048, S = GPX / (2 * G);   // 넓어진 마을(가로 약 104, 세로 약 71)을 덮는 땅
      const toPx = (x, z) => [(x + G) * S, (z + G) * S];
      const RIVER_Z = -24;
      const PATHS = [
        [[0, -8.5], [0, -13]], [[-8.5, 0], [-13.5, -1]], [[6.5, -6], [11, -9]], [[8.8, 1.5], [13, -1]],
        [[-4, 8.5], [-5.2, 11]], [[5.5, 6.8], [3, 9.5], [2.6, 17], [9, 17.8], [15, 17.2]], [[0, -17], [0, -28]], [[-13.5, -1], [-12, 9]],
        [[7.5, 5.5], [15, 5.8], [18.5, 10.6]],
        // 넓어진 마을 산책로: 남쪽 호수, 서쪽 숲길, 동쪽 꽃 언덕·들판을 한 바퀴로 잇는다
        [[-5.2, 11], [-6, 22], [-2, 31], [3.5, 37.5]], [[15, 17.2], [26, 20.5], [33, 29], [27, 39.5], [17.5, 43.5]],
        [[-12, 9], [-22, 15.5], [-33, 17.5], [-42, 8], [-41, -5], [-29, -8.5], [-21, -6.5]], [[-22, 15.5], [-26, 29], [-15, 39], [3.5, 40]],
        [[18.5, 10.6], [29, 6], [38.5, -3.5], [37, -13]]
      ];
      const PATH_W = 2.4;
      const TILL = [{ x0: 4.2, z0: 8.9, x1: 13.6, z1: 15.8 }];
      MAPDATA.paths = PATHS; MAPDATA.pathW = PATH_W; MAPDATA.till = TILL; MAPDATA.riverZ = RIVER_Z;
      function segDist(px, pz, ax, az, bx, bz) { const vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz))); return Math.hypot(px - ax - vx * t, pz - az - vz * t); }
      function onPath(x, z, pad = 0) { for (const p of PATHS) for (let i = 0; i < p.length - 1; i++) if (segDist(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]) < PATH_W / 2 + pad) return true; return false; }
      function inTill(x, z, pad = 0) { return TILL.some(t => x > t.x0 - pad && x < t.x1 + pad && z > t.z0 - pad && z < t.z1 + pad); }
      const groundTex = canvasTex(GPX, GPX, (g, w, h) => {
        g.fillStyle = '#7DAA4E'; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 900; i++) {
          const x = rnd() * w, y = rnd() * h, r = (20 + rnd() * 90) * S / 20.48;
          const gr = g.createRadialGradient(x, y, 0, x, y, r);
          const c = rnd() < 0.55 ? '160,196,98' : '96,140,62';
          gr.addColorStop(0, `rgba(${c},0.35)`); gr.addColorStop(1, `rgba(${c},0)`);
          g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
        }
        const [pcx, pcy] = toPx(0, 0);
        g.save(); g.filter = 'blur(3px)'; g.fillStyle = '#E8D8B4'; g.beginPath(); g.arc(pcx, pcy, 9.4 * S, 0, 7); g.fill(); g.restore();
        g.strokeStyle = 'rgba(190,168,128,.55)'; g.lineWidth = 5 * S / 20.48;
        for (const r of [3.8, 6.2, 8.6]) { g.beginPath(); g.arc(pcx, pcy, r * S, 0, 7); g.stroke(); }
        for (let a = 0; a < 24; a++) { const t = a / 24 * 6.283; g.beginPath(); g.moveTo(pcx + Math.cos(t) * 3.8 * S, pcy + Math.sin(t) * 3.8 * S); g.lineTo(pcx + Math.cos(t) * 9 * S, pcy + Math.sin(t) * 9 * S); g.stroke(); }
        for (const [lw, col, bl] of [[PATH_W * S * 1.25, 'rgba(196,170,112,.55)', 6], [PATH_W * S, '#DCC596', 3], [PATH_W * S * 0.55, 'rgba(236,218,176,.8)', 5]]) {
          g.save(); g.filter = `blur(${bl}px)`; g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
          for (const p of PATHS) { g.beginPath(); p.forEach(([x, z], i) => { const [px, py] = toPx(x, z); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke(); }
          g.restore();
        }
        for (const t of TILL) {
          const [x0, y0] = toPx(t.x0, t.z0), [x1, y1] = toPx(t.x1, t.z1);
          g.save(); g.filter = 'blur(5px)'; g.fillStyle = '#7A5236'; g.beginPath(); if (g.roundRect) g.roundRect(x0, y0, x1 - x0, y1 - y0, 40 * S / 20.48); else g.rect(x0, y0, x1 - x0, y1 - y0); g.fill(); g.restore();
          for (let zz = t.z0 + 1.1; zz < t.z1 - 0.4; zz += 1.95) {
            const yy = toPx(0, zz)[1];
            g.save(); g.filter = 'blur(4px)'; g.fillStyle = 'rgba(146,104,70,.9)'; g.fillRect(x0 + 18, yy - 16 * S / 20.48, x1 - x0 - 36, 30 * S / 20.48); g.restore();
          }
        }
        const ry = toPx(0, RIVER_Z)[1];
        g.save(); g.filter = 'blur(8px)'; g.fillStyle = '#E2CD98'; g.fillRect(0, ry - 4.4 * S, w, 8.8 * S); g.restore();
        const [ox, oy] = toPx(-14, 12); g.save(); g.filter = 'blur(6px)'; g.fillStyle = '#D6C497'; g.beginPath(); g.arc(ox, oy, 4.2 * S, 0, 7); g.fill(); g.restore();
      });
      {
        const outer = new THREE.PlaneGeometry(260, 260, 60, 60); outer.rotateX(-Math.PI / 2);
        mesh(outer, M('#6F9E47'), 0, -0.02, 0).receiveShadow = true;
        const gg = new THREE.PlaneGeometry(2 * G, 2 * G, 160, 160); gg.rotateX(-Math.PI / 2);
        mesh(gg, M('#FFFFFF', { map: groundTex, r: 0.95 }), 0, 0, 0).receiveShadow = true;
      }
      // 풀잎
      {
        const bg = new THREE.BufferGeometry();
        const bp = [-0.05, 0, 0, 0.05, 0, 0, -0.035, 0.22, 0.02, 0.035, 0.22, 0.02, -0.018, 0.4, 0.06, 0.018, 0.4, 0.06, 0, 0.55, 0.12];
        const bc = [], dark = new THREE.Color('#44702F'), lite = new THREE.Color('#98BF5E'), tc = new THREE.Color();
        for (let i = 0; i < 7; i++) { tc.copy(dark).lerp(lite, bp[i * 3 + 1] / 0.55); bc.push(tc.r, tc.g, tc.b); }
        bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
        bg.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
        bg.setAttribute('normal', new THREE.Float32BufferAttribute([0,1,0, 0,1,0, 0,1,0, 0,1,0, 0,1,0, 0,1,0, 0,1,0], 3));
        bg.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6]);
        const N = LITE ? 4200 : isSmall ? 26000 : 58000, im = new THREE.InstancedMesh(bg, M('#FFFFFF', { vc: true, double: true, wind: 0.16, r: 1 }), N);
        const o = new THREE.Object3D(), tint = new THREE.Color(); let k = 0;
        for (let tries = 0; k < N && tries < N * 4; tries++) {
          const x = (rnd() - 0.5) * 110, z = -21 + rnd() * 76;
          if (Math.hypot(x, z) < 9.6 || Math.hypot(x - 10, z - 44) < 7.2 || onPath(x, z, -0.2) || inTill(x, z, -0.3) || Math.abs(z - RIVER_Z) < 4.4 || Math.hypot(x + 14, z - 12) < 4.2) continue;
          if (Math.hypot(x - 22, z - 12) < 3.2 || Math.hypot(x + 11.8, z + 10.6) < 3.2) continue;
          o.position.set(x, 0, z); o.rotation.set(0, rnd() * 6.28, (rnd() - 0.5) * 0.4);
          const s = 0.55 + rnd() * 0.45; o.scale.set(s, s * (0.7 + rnd() * 0.45), s); o.updateMatrix();
          im.setMatrixAt(k, o.matrix); tint.setHSL(0.22 + rnd() * 0.06, 0.45, 0.78 + rnd() * 0.2); im.setColorAt(k, tint); k++;
        }
        im.count = k; im.receiveShadow = true; im.castShadow = false; scene.add(im);
      }
      // 강·다리·언덕
      {
        const wg = new THREE.PlaneGeometry(200, 5.4, 100, 4); wg.rotateX(-Math.PI / 2);
        mesh(wg, M(COL.water, { r: 0.3, em: '#5FA9B0', ei: 0.1 }), 0, 0.05, RIVER_Z).receiveShadow = true;
        const bridge = new THREE.Group();
        for (let i = 0; i < 9; i++) { const t = (i - 4) / 4; mesh(rbox(3.2, 0.25, 0.9, 0.06), M(i % 2 ? COL.wood : '#C08E62'), 0, 0.55 + (1 - t * t) * 0.55, RIVER_Z + (i - 4) * 0.92, bridge); }
        for (const sx of [-1.55, 1.55]) {
          for (let i = 0; i < 5; i++) { const t = (i - 2) / 2; mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.1, 8), M(COL.woodDark), sx, 1.2 + (1 - t * t) * 0.55, RIVER_Z + (i - 2) * 1.8, bridge); }
          mesh(rbox(0.16, 0.16, 8.2, 0.05), M(COL.wood), sx, 1.85, RIVER_Z, bridge);
        }
        scene.add(shade(bridge));
        const rockG = new THREE.DodecahedronGeometry(0.5, 0);
        for (let i = 0; i < 40; i++) {
          const x = -60 + i * 3 + Math.sin(i * 7.1) * 1.2; if (Math.abs(x) < 3) continue;
          const r = mesh(rockG, M(i % 3 ? '#C9BBA0' : '#B5A688', { flat: true }), x, 0.15, RIVER_Z + (i % 2 ? 1 : -1) * (2.9 + Math.sin(i) * 0.4));
          r.scale.set(1 + (i % 3) * 0.3, 0.6, 0.9); r.rotation.y = i; shade(r);
        }
        const g = new THREE.BoxGeometry(200, 5, 40, 100, 3, 20);
        const col = [], p = g.attributes.position, nn = g.attributes.normal, top = new THREE.Color('#93BC62'), side = new THREE.Color('#B8845A'), side2 = new THREE.Color('#9C6D4A');
        for (let i = 0; i < p.count; i++) { const c = nn.getY(i) > 0.5 ? top : (Math.floor((p.getY(i) + 2.5) * 1.3) % 2 ? side : side2); col.push(c.r, c.g, c.b); }
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        const cliff = mesh(g, M('#FFFFFF', { vc: true }), 0, 2.3, RIVER_Z - 24.5); cliff.receiveShadow = true; cliff.castShadow = true; cliff.customDepthMaterial = depthMat;
      }
      // 나무·덤불·꽃
      function tree(x, z, kind = 'round', s = 1, y = 0) {
        if (!y) MAPDATA.trees.push([x, z]);
        const g = new THREE.Group();
        if (kind === 'pine') {
          mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.2, 8), M(COL.woodDark), 0, 0.6, 0, g);
          const pp = ['#3E6A3A', '#5E8A55', '#8DB27A'];
          leafy(g, [{ x: 0, y: 1.9, z: 0, r: 1.7, n: 90, size: 0.75, pal: pp, flat: 0.5 }, { x: 0, y: 3.0, z: 0, r: 1.3, n: 70, size: 0.7, pal: pp, flat: 0.5 }, { x: 0, y: 3.9, z: 0, r: 0.8, n: 40, size: 0.6, pal: pp, flat: 0.6 }], 0.012);
        } else {
          mesh(new THREE.CylinderGeometry(0.2, 0.34, 2.2, 9), M('#8A6446'), 0, 1.1, 0, g);
          mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.1, 7), M('#8A6446'), 0.35, 2.1, 0.1, g).rotation.z = -0.6;
          const pal = kind === 'blossom' ? PAL.blossom : kind === 'orange' ? PAL.orange : PAL.tree;
          leafy(g, [{ x: 0.2, y: 2.8, z: -0.1, r: 1.55, n: 150, size: 0.62, pal }, { x: -0.55, y: 3.05, z: 0.4, r: 1.25, n: 110, size: 0.6, pal }, { x: 0.1, y: 3.8, z: 0.2, r: 1.0, n: 80, size: 0.55, pal }], 0.018);
          if (kind === 'orange') for (let i = 0; i < 11; i++) { const a = rnd() * 6.28, yy = 2.4 + rnd() * 1.6, r = 1.25 + rnd() * 0.3; mesh(new THREE.SphereGeometry(0.2, 14, 10), M('#F29A2E', { r: 0.45 }), Math.cos(a) * r, yy, Math.sin(a) * r, g); }
        }
        g.position.set(x, y, z); g.scale.setScalar(s); g.rotation.y = x * 1.7 + z;
        scene.add(shade(g));
        if (!y) { colliders.push({ x, z, r: 0.6 * s }); blob(x, z, 1.9 * s, 0.32); }
      }
      function bush(x, z, s = 1, fl = null) {
        const g = new THREE.Group();
        leafy(g, [{ x: 0, y: 0.55, z: 0, r: 0.85, n: 70, size: 0.45, pal: PAL.bush, flat: 0.7 }, { x: 0.6, y: 0.45, z: 0.3, r: 0.6, n: 40, size: 0.42, pal: PAL.bush, flat: 0.7 }], 0.03);
        if (fl) for (let i = 0; i < 9; i++) { const a = rnd() * 6.28; mesh(new THREE.SphereGeometry(0.09, 8, 6), M(fl), Math.cos(a) * 0.8, 0.5 + rnd() * 0.5, Math.sin(a) * 0.8, g); }
        g.position.set(x, 0, z); g.scale.setScalar(s); scene.add(shade(g)); colliders.push({ x, z, r: 0.9 * s }); blob(x, z, 1.4 * s, 0.28);
      }
      [
        [-17, -13.5, 'pine', 1.1], [-19, -7, 'round', 1.1], [-20, 4, 'pine', 1.2], [-18, 14, 'round', 1.15], [-10, 19.5, 'blossom', 1],
        [-2, 21, 'round', 0.95], [19, 19.5, 'round', 1.1], [21, -4, 'pine', 1.15], [19, -15, 'round', 1.05],
        [7, -17, 'round', 1.0], [-7, -17, 'round', 1.0], [-24, -16, 'pine', 1.2], [25, 3, 'pine', 1.2], [-6, 5.5, 'blossom', 0.8],
        [-25, 8, 'round', 1.2], [27, 18, 'round', 1.1], [-14, 21, 'pine', 1.1], [15.8, 7.4, 'orange', 1.0], [21, 22.5, 'blossom', 0.95]
      ].forEach(([x, z, k, s]) => tree(x, z, k, s));
      for (let i = 0; i < (LITE ? 8 : 22); i++) { const x = -64 + i * (LITE ? 16 : 6.2) + Math.sin(i * 3.3) * 2; tree(x, RIVER_Z - 13 - (i % 3) * 3.5, i % 3 ? 'round' : 'pine', 1.15 + (i % 4) * 0.12, 4.8); }
      [[-7, -9.5, '#F4A6A0'], [7, -10.8], [-10.5, 3.5, '#F6D06A'], [3.8, -11], [13, -12.5, '#FFFFFF'], [-16, -2], [2.2, 20.2, '#F4A6A0'], [-0.5, 16.5, '#F6D06A'], [17, 16.5]].forEach(([x, z, f]) => bush(x, z, 1, f));
      {
        const flowers = [], palette = ['#F4A6A0', '#F6D06A', '#FFFFFF', '#E5877A', '#C9A4E0'];
        [[-9, 9], [8.5, -3], [-10, -6], [-1.5, 13.4], [14, -2.5], [-15, 5], [0.5, 18.7], [-4, -14], [18.5, 9]].forEach(([bx, bz]) => {
          for (let i = 0; i < 24; i++) { const a = rnd() * 6.28, r = Math.sqrt(rnd()) * 1.5; flowers.push([bx + Math.cos(a) * r, bz + Math.sin(a) * r]); }
        });
        const o = new THREE.Object3D(), c = new THREE.Color();
        const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6), M('#FFFFFF', { r: 0.7 }), flowers.length);
        const stem = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 4), M('#5E8F45'), flowers.length);
        flowers.forEach(([x, z], i) => {
          o.position.set(x, 0.38, z); o.scale.set(1, 0.7, 1); o.updateMatrix(); head.setMatrixAt(i, o.matrix); c.set(palette[(i * 7) % palette.length]); head.setColorAt(i, c);
          o.position.set(x, 0.18, z); o.scale.set(1, 1, 1); o.updateMatrix(); stem.setMatrixAt(i, o.matrix);
        });
        for (const im of [head, stem]) { im.castShadow = true; im.receiveShadow = true; im.customDepthMaterial = depthMat; scene.add(im); }
      }
      // 텃밭
      {
        function cabbage(x, z, s = 1) {
          const g = new THREE.Group();
          mesh(new THREE.SphereGeometry(0.46, 24, 18), M('#D6E8A4', { r: 0.6 }), 0, 0.5, 0, g).scale.set(1, 0.95, 1);
          for (let i = 0; i < 8; i++) {
            const a = i / 8 * 6.28 + rnd() * 0.3, tilt = 0.95 + rnd() * 0.35;
            const holder = new THREE.Group(); holder.rotation.y = a; holder.position.set(Math.sin(a) * 0.12, 0.08, Math.cos(a) * 0.12); g.add(holder);
            const leaf = mesh(new THREE.SphereGeometry(0.62, 16, 10, -0.75, 1.5, 0, 1.2), M(i % 2 ? '#9FCB62' : '#86B852', { double: true, r: 0.65 }), 0, 0, 0, holder);
            leaf.rotation.x = -tilt; leaf.scale.set(1.05, 1.1, 0.8);
          }
          g.position.set(x, 0, z); g.scale.setScalar(s); g.rotation.y = rnd() * 6; scene.add(shade(g)); blob(x, z, 2.2 * s, 0.38); colliders.push({ x, z, r: 0.75 * s });
        }
        function tomato(x, z) {
          const g = new THREE.Group();
          mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.9, 6), M('#C9A574'), 0.1, 0.95, -0.15, g);
          leafy(g, [{ x: 0, y: 0.75, z: 0, r: 0.7, n: 90, size: 0.34, pal: PAL.tomato, flat: 0.9 }, { x: 0.1, y: 1.3, z: 0, r: 0.55, n: 60, size: 0.32, pal: PAL.tomato }], 0.03);
          for (let i = 0; i < 9; i++) {
            const a = rnd() * 6.28, r = 0.55 + rnd() * 0.25, yy = 0.45 + rnd() * 1.0;
            const t = mesh(new THREE.SphereGeometry(0.17 + rnd() * 0.05, 16, 12), M(i % 4 === 0 ? '#F07A3E' : '#E24A36', { r: 0.32 }), Math.cos(a) * r, yy, Math.sin(a) * r, g);
            mesh(new THREE.ConeGeometry(0.08, 0.06, 5), M('#4E7A36'), 0, 0.17, 0, t);
          }
          g.position.set(x, 0, z); scene.add(shade(g)); blob(x, z, 2.0, 0.35); colliders.push({ x, z, r: 0.7 });
        }
        function carrot(x, z) {
          const g = new THREE.Group();
          mesh(new THREE.SphereGeometry(0.22, 16, 12), M('#EE8436', { r: 0.55 }), 0, 0.12, 0, g).scale.set(1, 1.2, 1);
          leafy(g, [{ x: 0, y: 0.72, z: 0, r: 0.4, n: 40, size: 0.28, pal: PAL.carrot, flat: 1.2 }], 0.06);
          g.position.set(x, 0, z); scene.add(shade(g)); blob(x, z, 1.1, 0.3);
        }
        [7.8, 9.6, 11.4].forEach(x => tomato(x, 10.1));
        [5.3, 7.3].forEach(x => cabbage(x, 12.0, 1));
        [9.6, 11.6].forEach(x => tomato(x, 12.1));
        [4.9, 5.8, 6.7, 7.6, 8.5].forEach(x => carrot(x, 14.1));
        cabbage(10.1, 14.2, 0.95); [11.7, 12.6].forEach(x => carrot(x, 14.1));
        const fence = new THREE.Group();
        const post = (x, z) => { mesh(rbox(0.26, 1.2, 0.26, 0.08), M('#A57852'), x, 0.6, z, fence); mesh(new THREE.SphereGeometry(0.14, 10, 8), M('#B98A60'), x, 1.22, z, fence); };
        for (let x = 3.6; x <= 14.2; x += 1.77) post(x, 8.2);
        for (let z = 8.2 + 1.77; z <= 15.3; z += 1.77) post(14.2, z);
        for (const y of [0.55, 0.95]) { mesh(rbox(10.8, 0.14, 0.14, 0.05), M('#B98A60'), 8.9, y, 8.2, fence); mesh(rbox(0.14, 0.14, 7.2, 0.05), M('#B98A60'), 14.2, y, 11.75, fence); }
        scene.add(shade(fence)); colliders.push({ r: 0.3, seg: [3.6, 8.2, 14.2, 8.2] }, { r: 0.3, seg: [14.2, 8.2, 14.2, 15.3] });
      }
      // 지원센터 (원본 주민센터 건물)
      {
        const x = 0, z = -17, g = new THREE.Group();
        mesh(rbox(10.6, 0.4, 7.2, 0.12), M('#E7D6B6'), 0, 0.2, 0, g);
        mesh(rbox(9.6, 4.4, 6.2, 0.22), M(COL.wall), 0, 2.6, 0, g);
        mesh(rbox(9.8, 0.35, 6.4, 0.1), M(COL.teal), 0, 4.4, 0, g);
        hipRoof(g, 4.575, 10.8, 7.4, 2.6, M(COL.teal));   // 몸체 9.6×6.2 + 처마 0.6씩, 청록 띠(윗면 4.575) 위에 붙인다
        mesh(rbox(3.6, 0.3, 1.8, 0.08), M('#EFE3CB'), 0, 0.55, 3.8, g);
        for (const px of [-1.4, -0.47, 0.47, 1.4]) mesh(new THREE.CylinderGeometry(0.16, 0.18, 3.2, 12), M('#FFFDF5'), px, 2.2, 4.3, g);
        mesh(rbox(3.9, 0.35, 1.9, 0.08), M('#F3E7D0'), 0, 3.9, 3.9, g);
        mesh(prism(3.9, 1.1, 1.8, 0.05), M('#F8EEDB'), 0, 4.05, 3.9, g);
        doorMesh(g, 0, 3.12, COL.tealDark, 2.3);
        for (const wx of [-3.4, -1.9, 1.9, 3.4]) { windowPane(g, wx, 1.7, 3.12, 0.9, 1.1); windowPane(g, wx, 3.35, 3.12, 0.9, 0.8); }
        mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 8), M(COL.ink), 3.6, 6.6, -1.2, g);
        flags.push(mesh(new THREE.PlaneGeometry(1.2, 0.7, 6, 1), M(COL.teal, { double: true }), 4.2, 7.8, -1.2, g));
        g.position.set(x, 0, z); faceTo(g, x, z); scene.add(shade(g));
        colliders.push({ x, z, r: 5.2 }, { x: -3, z: z + 1.5, r: 3.4 }, { x: 3, z: z + 1.5, r: 3.4 }); blob(x, z + 1, 13, 0.3);
        signpost(-2.6, -11.4, '지원센터', 0.25);
        places.support = { x: 0, z: -10.6 };
      }
      // 미션방
      {
        const x = -17, z = -1, g = new THREE.Group();
        mesh(rbox(5.4, 3.2, 5, 0.25), M(COL.wallWarm), 0, 1.6, 0, g);
        mesh(prism(6.2, 2.1, 5.8, 0.1), M(COL.roof), 0, 3.15, 0, g).rotation.y = Math.PI / 2;
        mesh(rbox(2.0, 2.6, 2.0, 0.18), M(COL.wallWarm), -1.4, 4.4, -1.2, g);
        mesh(new THREE.ConeGeometry(1.7, 2.2, 4), M(COL.teal), -1.4, 6.8, -1.2, g).rotation.y = Math.PI / 4;
        windowPane(g, -1.4, 4.5, -0.18, 0.7, 0.8, true);
        mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 6), M(COL.ink), -1.4, 8.4, -1.2, g);
        flags.push(mesh(new THREE.PlaneGeometry(0.8, 0.45, 4, 1), M(COL.gold, { double: true }), -1.0, 8.8, -1.2, g));
        doorMesh(g, 1.1, 2.52, COL.wood);
        windowPane(g, -1.3, 1.7, 2.52, 0.9, 1.0, true);
        const board = canvasTex(384, 448, (c, w, h) => {
          c.fillStyle = '#FFF6E2'; c.fillRect(0, 0, w, h); c.strokeStyle = '#B7835A'; c.lineWidth = 18; c.strokeRect(9, 9, w - 18, h - 18);
          c.fillStyle = COL.ink; c.font = `700 52px ${FONT}`; c.textAlign = 'center'; c.fillText('단계별 퀘스트', w / 2, 92);
          [['1단계 첫걸음', true], ['2단계 인사', false], ['3단계 모임', false], ['4단계 동네로', false]].forEach(([t, d], i) => {
            const yy = 160 + i * 72; c.fillStyle = d ? COL.teal : '#FFFFFF'; c.strokeStyle = COL.tealDark; c.lineWidth = 5;
            c.fillRect(46, yy - 26, 44, 44); c.strokeRect(46, yy - 26, 44, 44);
            c.fillStyle = COL.ink; c.font = `38px ${FONT}`; c.textAlign = 'left'; c.fillText(t, 112, yy + 8);
          });
        });
        mesh(new THREE.PlaneGeometry(1.5, 1.75), M('#FFFFFF', { map: board }), 2.72, 1.75, 0.3, g).rotation.y = Math.PI / 2;
        g.position.set(x, 0, z); faceTo(g, x, z); g.rotation.y -= Math.PI / 2; scene.add(shade(g));
        colliders.push({ x, z, r: 3.6 }); blob(x, z, 8, 0.3);
        signpost(-11.2, -3.2, '미션방', Math.PI / 2 - 0.3);
        places.mission = frontOf(g, 1.1, 4.2);
      }
      // 동아리센터 (원본 동아리방 건물)
      {
        const x = 15, z = -11, g = new THREE.Group();
        mesh(rbox(6.4, 3.0, 4.6, 0.25), M('#F1DFC0'), 0, 1.5, 0, g);
        for (let i = -5; i <= 5; i++) mesh(new THREE.BoxGeometry(0.05, 2.7, 0.05), M('#E0C9A2'), i * 0.55, 1.5, 2.33, g);
        const roofG = prism(7.2, 2.0, 5.4, 0.1); roofG.rotateY(Math.PI / 2); mesh(roofG, M(COL.roof), 0, 2.95, 0, g);
        windowPane(g, -2.0, 1.7, 2.33, 1.2, 1.1, true); windowPane(g, -0.2, 1.7, 2.33, 1.2, 1.1, true);
        doorMesh(g, 1.9, 2.33, '#C36B4A');
        const aw = canvasTex(512, 64, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#FBF3E4' : COL.teal; c.fillRect(i * w / 8, 0, w / 8, h); } });
        mesh(new THREE.PlaneGeometry(4.2, 1.0), M('#FFFFFF', { map: aw, double: true }), -1.1, 2.55, 2.75, g).rotation.x = -0.9;
        mesh(rbox(0.6, 1.6, 0.6, 0.08), M('#C98B5B'), 1.8, 4.6, -0.6, g);
        g.position.set(x, 0, z); faceTo(g, x, z); scene.add(shade(g));
        g.updateMatrixWorld(); chimneyPos = new THREE.Vector3(1.8, 5.5, -0.6).applyMatrix4(g.matrixWorld);
        colliders.push({ x, z, r: 3.7 }); blob(x, z, 8.5, 0.3);
        signpost(10.2, -6.4, '동아리센터', -0.9);
        places.club = frontOf(g, 1.9, 4.0);
        places.coco = frontOf(g, -2.3, 4.3);
      }
      // 게임방 (원본 미니게임 천막)
      {
        const x = 17.5, z = -1.5, g = new THREE.Group();
        const floorTex = canvasTex(512, 512, (c, w, h) => { const n = 8; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { c.fillStyle = (i + j) % 2 ? '#F4EAD6' : COL.teal; c.fillRect(i * w / n, j * h / n, w / n, h / n); } });
        mesh(new THREE.CylinderGeometry(4.2, 4.4, 0.35, 32), M('#D9B58A'), 0, 0.17, 0, g);
        mesh(new THREE.CircleGeometry(3.4, 32), M('#FFFFFF', { map: floorTex }), 0, 0.36, 0, g).rotation.x = -Math.PI / 2;
        for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; mesh(new THREE.CylinderGeometry(0.14, 0.14, 3.2, 10), M('#F7EEDD'), Math.cos(a) * 3.7, 1.9, Math.sin(a) * 3.7, g); }
        const stripes = canvasTex(1024, 64, (c, w, h) => { const n = 16; for (let i = 0; i < n; i++) { c.fillStyle = i % 2 ? '#FBF1E0' : '#E58A5F'; c.fillRect(i * w / n, 0, w / n, h); } });
        mesh(new THREE.ConeGeometry(4.8, 2.8, 32, 1, true), M('#FFFFFF', { map: stripes, double: true }), 0, 4.9, 0, g);
        for (let i = 0; i < 16; i++) { const a = (i + 0.5) / 16 * Math.PI * 2; mesh(new THREE.SphereGeometry(0.38, 12, 8), M(i % 2 ? '#FBF1E0' : '#E58A5F'), Math.cos(a) * 4.75, 3.45, Math.sin(a) * 4.75, g); }
        mesh(new THREE.SphereGeometry(0.3, 12, 10), M(COL.gold, { r: 0.5 }), 0, 6.45, 0, g);
        mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.12, 20), M(COL.wood), -1.2, 1.1, 0.5, g);
        mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 8), M(COL.woodDark), -1.2, 0.7, 0.5, g);
        for (let i = 0; i < 4; i++) mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 8), M(['#E0654A', '#3F8C86', '#F2C14E', '#5B7DB1'][i]), -1.2 + Math.cos(i * 1.6) * 0.45, 1.27, 0.5 + Math.sin(i * 1.6) * 0.45, g);
        g.position.set(x, 0, z); scene.add(shade(g)); blob(x, z, 10, 0.25);
        colliders.push({ x: x - 1.2, z: z + 0.5, r: 1.1 });
        for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; colliders.push({ x: x + Math.cos(a) * 3.7, z: z + Math.sin(a) * 3.7, r: 0.35 }); }
        signpost(12.6, 1.4, '게임방', -1.2);
        places.game = { x: 12.2, z: -0.4 };
      }
      // 카페 (새로 지음 — 광장 북서쪽. 카메라 쪽(남쪽)에 두면 지붕이 캐릭터를 가린다)
      {
        const x = -11.8, z = -10.6, g = new THREE.Group();
        mesh(rbox(5.4, 3.0, 4.4, 0.25), M('#F3DFC0'), 0, 1.5, 0, g);
        const roofG = prism(6.4, 1.9, 5.2, 0.1); roofG.rotateY(Math.PI / 2); mesh(roofG, M('#B56C5A'), 0, 2.95, 0, g);
        windowPane(g, -1.5, 1.6, 2.23, 1.5, 1.2, true);
        doorMesh(g, 1.3, 2.23, COL.teal);
        const aw = canvasTex(512, 64, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#FBF3E4' : '#B56C5A'; c.fillRect(i * w / 8, 0, w / 8, h); } });
        mesh(new THREE.PlaneGeometry(5.0, 1.0), M('#FFFFFF', { map: aw, double: true }), 0, 2.55, 2.65, g).rotation.x = -0.9;
        const st = canvasTex(512, 160, (c, w, h) => { c.fillStyle = '#2F3642'; if (c.roundRect) { c.beginPath(); c.roundRect(6, 6, w - 12, h - 12, 40); c.fill(); } else c.fillRect(0, 0, w, h); c.fillStyle = '#FFF8EC'; c.font = `700 84px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('카페', w / 2, h / 2 + 4); });
        mesh(new THREE.PlaneGeometry(1.8, 0.56), M('#FFFFFF', { map: st }), 0, 3.35, 2.26, g);
        const tbl = new THREE.Group(); tbl.position.set(-1.4, 0, 3.9); g.add(tbl);
        mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 20), M('#FFFDF7'), 0, 0.82, 0, tbl);
        mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.8, 8), M(COL.ink), 0, 0.4, 0, tbl);
        mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.16, 12), M('#E58A5F'), 0.15, 0.94, 0.1, tbl);
        for (const sx of [-0.95, 0.95]) { mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.07, 14), M(COL.wood), sx, 0.5, 0, tbl); mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), M(COL.woodDark), sx, 0.25, 0, tbl); }
        g.position.set(x, 0, z); faceTo(g, x, z); scene.add(shade(g));
        colliders.push({ x, z, r: 3.3 }); blob(x, z, 8, 0.3);
        const tw = frontOf(g, -1.4, 3.9); colliders.push({ x: tw.x, z: tw.z, r: 1.3 });
        places.cafe = frontOf(g, 1.3, 3.8);
        places.lumi = frontOf(g, -1.2, 5.6);
      }
      // 공원 (연못·벤치)
      {
        const x = -14, z = 12;
        mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.3, 36), M('#D8C8A4'), x, 0.1, z);
        mesh(new THREE.CylinderGeometry(3.0, 3.0, 0.32, 36), M(COL.water, { r: 0.25, em: '#5FA9B0', ei: 0.12 }), x, 0.14, z).receiveShadow = true;
        for (let i = 0; i < 16; i++) { const a = i / 16 * 6.28; const r = mesh(new THREE.DodecahedronGeometry(0.42, 0), M(i % 2 ? '#C9BBA0' : '#B5A688', { flat: true }), x + Math.cos(a) * 3.5, 0.25, z + Math.sin(a) * 3.5); r.scale.y = 0.6; shade(r); }
        for (const [dx, dz] of [[1, 0.6], [-0.8, -1.1], [0.2, 1.6]]) { mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 14), M('#7FA35A'), x + dx, 0.33, z + dz); mesh(new THREE.SphereGeometry(0.12, 8, 6), M('#F4A6A0'), x + dx + 0.15, 0.4, z + dz); }
        colliders.push({ x, z, r: 3.7 });
        signpost(-9.4, 8.2, '공원', 0.9);
        places.park = { x: -9.8, z: 10.2 };
      }
      function bench(x, z) {
        const g = new THREE.Group();
        mesh(rbox(2.2, 0.16, 0.6, 0.05), M(COL.wood), 0, 0.55, 0, g);
        mesh(rbox(2.2, 0.5, 0.12, 0.05), M('#C99468'), 0, 0.95, -0.28, g);
        for (const px of [-0.9, 0.9]) mesh(new THREE.BoxGeometry(0.1, 0.55, 0.5), M(COL.woodDark), px, 0.27, 0, g);
        g.position.set(x, 0, z); faceTo(g, x, z); scene.add(shade(g)); colliders.push({ x, z, r: 1.0 }); blob(x, z, 2.4, 0.3);
      }
      bench(6.7, -5.0); bench(-7.2, -4.2); bench(-17.5, 7.2);
      function lamp(x, z) {
        const g = new THREE.Group();
        mesh(new THREE.CylinderGeometry(0.09, 0.12, 3.2, 8), M(COL.ink), 0, 1.6, 0, g);
        mesh(rbox(0.5, 0.6, 0.5, 0.1), M('#FCE3A6', { em: '#F7C66A', ei: 1.1 }), 0, 3.4, 0, g);
        mesh(new THREE.ConeGeometry(0.42, 0.35, 4), M(COL.ink), 0, 3.85, 0, g).rotation.y = Math.PI / 4;
        g.position.set(x, 0, z); scene.add(shade(g)); colliders.push({ x, z, r: 0.35 }); blob(x, z, 0.9, 0.3);
      }
      [[-7.8, -7.8], [7.8, -7.8], [-7.8, 7.8], [7.8, 7.8]].forEach(([x, z]) => lamp(x, z));
      // 분수 (광장)
      {
        const g = new THREE.Group();
        mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.5, 40), M('#E2D0AC'), 0, 0.25, 0, g);
        mesh(new THREE.TorusGeometry(3.2, 0.2, 10, 40), M('#EFE2C6'), 0, 0.72, 0, g).rotation.x = Math.PI / 2;
        mesh(new THREE.CylinderGeometry(2.95, 2.95, 0.08, 40), M(COL.water, { r: 0.2, em: '#5FA9B0', ei: 0.18 }), 0, 0.56, 0, g);
        mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.8, 16), M('#D8C49D'), 0, 1.3, 0, g);
        mesh(new THREE.CylinderGeometry(1.2, 0.8, 0.35, 24), M('#E6D5B2'), 0, 2.25, 0, g);
        mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.06, 24), M(COL.water, { r: 0.2, em: '#5FA9B0', ei: 0.18 }), 0, 2.42, 0, g);
        for (let i = 0; i < 10; i++) { const jet = mesh(new THREE.SphereGeometry(0.1, 8, 6), M('#E9F7F5', { em: '#FFFFFF', ei: 0.6 }), 0, 2.6, 0, g); jet.userData = { a: i / 10 * 6.28, t: i / 10 }; fountainJets.push(jet); }
        scene.add(shade(g)); colliders.push({ x: 0, z: 0, r: 3.6 }); blob(0, 0, 8.6, 0.28);
        places.plaza = { x: 1.2, z: 5.4 };
      }
      // 내 집 (마을 동쪽) — 들어가면 내 방
      {
        const x = 22, z = 12, g = new THREE.Group();
        mesh(rbox(5.0, 3.1, 4.6, 0.25), M(COL.wall), 0, 1.55, 0, g);
        mesh(prism(5.9, 2.2, 5.4, 0.1), M(COL.roof), 0, 3.1, 0, g).rotation.y = Math.PI / 2;
        mesh(rbox(0.7, 1.4, 0.7, 0.08), M('#C98B5B'), -1.4, 4.3, -0.8, g);
        windowPane(g, -1.3, 1.7, 2.33, 1.1, 1.0, true); doorMesh(g, 1.0, 2.33, COL.teal);
        const bed = new THREE.Group(); bed.position.set(-1.4, 0, 3.0); g.add(bed);
        leafy(bed, [{ x: 0, y: 0.3, z: 0, r: 0.7, n: 40, size: 0.4, pal: PAL.bush, flat: 0.6 }], 0.03);
        for (let i = 0; i < 7; i++) { const a = rnd() * 6.28; mesh(new THREE.SphereGeometry(0.09, 8, 6), M(i % 2 ? '#F4A6A0' : '#F6D06A'), Math.cos(a) * 0.6, 0.45, Math.sin(a) * 0.4, bed); }
        g.position.set(x, 0, z); faceTo(g, x, z); scene.add(shade(g));
        colliders.push({ x, z, r: 3.1 }); blob(x, z, 8, 0.3);
        const sp = frontOf(g, 2.9, 3.4); const s = signpost(sp.x, sp.z, '내 집', g.rotation.y); homeSign = s;
        places.home = frontOf(g, 1.0, 3.7);
      }
      // 내 방 (실내)
      {
        const g = new THREE.Group(); g.position.set(RX, 0, RZ); scene.add(g);
        mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), M('#4A3A2E'), 0, -0.05, 0, g).receiveShadow = true;
        const plank = canvasTex(512, 512, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#C99468' : '#BD875B'; c.fillRect(0, i * h / 8, w, h / 8); c.fillStyle = 'rgba(90,58,36,.35)'; c.fillRect(0, i * h / 8, w, 3); c.fillRect((i * 173) % w, i * h / 8, 3, h / 8); } });
        plank.wrapS = plank.wrapT = THREE.RepeatWrapping; plank.repeat.set(2, 1.6);
        mesh(new THREE.BoxGeometry(10.4, 0.3, 8.6), M('#FFFFFF', { map: plank, r: 0.8 }), 0, -0.14, 0, g).receiveShadow = true;
        mesh(rbox(10.8, 4.4, 0.3, 0.08), M('#F3E2C7'), 0, 2.2, -4.35, g);
        mesh(rbox(10.8, 1.1, 0.36, 0.06), M('#E7CFA8'), 0, 0.55, -4.3, g);
        for (const sx of [-1, 1]) { mesh(rbox(0.3, 4.4, 8.8, 0.08), M('#F6E9D3'), sx * 5.35, 2.2, 0, g); mesh(rbox(0.36, 1.1, 8.8, 0.06), M('#E7CFA8'), sx * 5.3, 0.55, 0, g); }
        mesh(rbox(0.2, 2.3, 1.3, 0.1), M(COL.teal), 5.15, 1.15, 2.4, g);
        mesh(new THREE.SphereGeometry(0.07, 8, 6), M(COL.gold, { r: 0.4 }), 5.02, 1.1, 2.0, g);
        windowPane(g, -1.9, 2.5, -4.18, 1.4, 1.3, true); windowPane(g, 1.9, 2.5, -4.18, 1.4, 1.3, true);
        const pic = canvasTex(256, 200, (c, w, h) => { c.fillStyle = '#FFF8EC'; c.fillRect(0, 0, w, h); c.fillStyle = '#9CC7D0'; c.fillRect(20, 20, w - 40, h - 80); c.fillStyle = '#78A64E'; c.beginPath(); c.moveTo(20, h - 60); c.lineTo(110, 70); c.lineTo(w - 20, h - 60); c.fill(); c.fillStyle = '#E9B44C'; c.beginPath(); c.arc(w - 60, 55, 16, 0, 7); c.fill(); });
        mesh(new THREE.PlaneGeometry(1.0, 0.8), M('#FFFFFF', { map: pic }), 0, 2.7, -4.18, g);
        // 침대
        const bed = new THREE.Group(); bed.position.set(-3.2, 0, -2.4); g.add(bed);
        mesh(rbox(2.2, 0.45, 3.2, 0.1), M(COL.wood), 0, 0.25, 0, bed);
        mesh(rbox(2.0, 0.3, 3.0, 0.12), M('#FFF8EC'), 0, 0.62, 0, bed);
        mesh(rbox(2.06, 0.22, 1.9, 0.1), M('#8FB6D9'), 0, 0.82, 0.5, bed);
        mesh(rbox(1.3, 0.28, 0.7, 0.12), M('#FFFDF7'), 0, 0.88, -1.05, bed);
        mesh(rbox(2.2, 1.3, 0.2, 0.08), M('#A57852'), 0, 0.9, -1.6, bed);
        // 책상·의자·스탠드
        const desk = new THREE.Group(); desk.position.set(3.2, 0, -3.4); g.add(desk);
        mesh(rbox(2.4, 0.12, 1.1, 0.04), M(COL.wood), 0, 1.0, 0, desk);
        for (const [lx, lz] of [[-1.05, -0.4], [1.05, -0.4], [-1.05, 0.4], [1.05, 0.4]]) mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6), M(COL.woodDark), lx, 0.5, lz, desk);
        mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.06, 12), M(COL.ink), 0.8, 1.09, -0.2, desk);
        mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), M(COL.ink), 0.8, 1.35, -0.2, desk);
        mesh(new THREE.ConeGeometry(0.2, 0.22, 12, 1, true), M('#FCE3A6', { em: '#F7C66A', ei: 1.0, double: true }), 0.8, 1.62, -0.2, desk);
        for (let i = 0; i < 3; i++) mesh(rbox(0.5, 0.08, 0.36, 0.02), M(['#E0654A', '#3F8C86', '#F2C14E'][i]), -0.6, 1.1 + i * 0.08, 0, desk);
        const chair = new THREE.Group(); chair.position.set(3.2, 0, -2.3); g.add(chair);
        mesh(rbox(0.8, 0.1, 0.8, 0.04), M('#C99468'), 0, 0.55, 0, chair); mesh(rbox(0.8, 0.8, 0.1, 0.04), M('#C99468'), 0, 0.95, 0.38, chair);
        for (const [lx, lz] of [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]]) mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 6), M(COL.woodDark), lx, 0.27, lz, chair);
        // 책장
        const shelf = new THREE.Group(); shelf.position.set(-4.75, 0, 1.4); g.add(shelf);
        mesh(rbox(0.6, 2.3, 1.8, 0.06), M('#A57852'), 0, 1.15, 0, shelf);
        for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) mesh(rbox(0.36, 0.5, 0.18, 0.02), M(['#E0654A', '#3F8C86', '#F2C14E', '#5B7DB1', '#C9A4E0', '#FFFDF7'][(i + r) % 6]), 0.12, 0.45 + r * 0.7, -0.62 + i * 0.25, shelf);
        // 러그·화분
        const rug = mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.04, 40), M('#E9C46A'), 0.3, 0.03, 0.6, g); rug.scale.z = 0.75; rug.receiveShadow = true;
        const pot = new THREE.Group(); pot.position.set(4.4, 0, 0.4); g.add(pot);
        mesh(new THREE.CylinderGeometry(0.32, 0.25, 0.55, 14), M('#C36B4A'), 0, 0.27, 0, pot);
        leafy(pot, [{ x: 0, y: 0.95, z: 0, r: 0.5, n: 50, size: 0.36, pal: PAL.bush }], 0.02);
        shade(g);
        roomLight = new THREE.PointLight('#FFD8A2', 0.9, 16, 1.6); roomLight.position.set(RX, 3.4, RZ); scene.add(roomLight);
        colliders.push({ r: 0.3, seg: [RX - 5.2, RZ - 4.2, RX + 5.2, RZ - 4.2] }, { r: 0.3, seg: [RX - 5.2, RZ - 4.2, RX - 5.2, RZ + 4.3] }, { r: 0.3, seg: [RX + 5.2, RZ - 4.2, RX + 5.2, RZ + 4.3] });
        colliders.push({ x: RX - 3.2, z: RZ - 3.0, r: 1.25 }, { x: RX - 3.2, z: RZ - 1.6, r: 1.1 }, { x: RX + 3.2, z: RZ - 3.4, r: 1.1 }, { x: RX - 4.7, z: RZ + 1.4, r: 0.8 }, { x: RX + 4.4, z: RZ + 0.4, r: 0.4 });
        places.bedside = { x: RX - 1.7, z: RZ - 1.9 };
        places.roomDoor = { x: RX + 4.0, z: RZ + 2.4 };
        places.roomMid = { x: RX + 0.8, z: RZ + 0.2 };
      }
      // NPC
      const NPC_LOOK = {
        policy: { x: -5, z: -3.2, color: '#5B7DB1', look: { shirt: '#FFFDF7', bottom: '#5B7DB1', hair: '#3B2E2A', skin: SKIN[1], style: 'short' } },
        job:    { x: 5.2, z: -3.6, color: '#E08A4A', look: { shirt: '#F6E3C4', bottom: '#E08A4A', hair: '#2E2622', skin: SKIN[3], hat: '#8E6242', style: 'short' } },
        psych:  { x: places.lumi.x, z: places.lumi.z, color: '#B56CC0', look: LUMI_LOOK },
        chief:  { x: -4.2, z: 4.6, color: '#B08A3E', look: { shirt: '#B08A3E', bottom: '#5A4A3C', hair: '#B9B4AA', skin: SKIN[0], hat: '#6B4A36', style: 'short' } },
        coco:   { x: places.coco.x, z: places.coco.z, color: '#2E6B4F', look: { shirt: '#F4B942', bottom: '#2E6B4F', hair: '#3B2E2A', skin: SKIN[2], hat: '#2E6B4F', style: 'short' } }
      };
      npcObjs = Object.keys(NPC_LOOK).map(id => {
        const n = NPC_LOOK[id], p = person({ ...n.look, scale: 1.1 }); p.position.set(n.x, 0, n.z); p.rotation.y = Math.atan2(-n.x, -n.z);
        const mk = mesh(new THREE.OctahedronGeometry(0.17, 0), M(n.color, { em: n.color, ei: 0.5, r: 0.4 }), 0, 2.15, 0, p); mk.scale.set(1, 1.35, 1);
        if (id === 'policy') mesh(rbox(0.3, 0.38, 0.05, 0.03), M('#FFF8EC'), 0.32, 0.55, 0.22, p);
        if (id === 'job') mesh(rbox(0.42, 0.3, 0.14, 0.05), M('#6B4A36'), 0.38, 0.36, 0.05, p);
        if (id === 'psych') mesh(rbox(0.26, 0.3, 0.26, 0.06), M('#FCE3A6', { em: '#F7C66A', ei: 1.2 }), 0.4, 0.42, 0.1, p);
        if (id === 'coco') mesh(new THREE.SphereGeometry(0.16, 14, 10), M('#E0654A'), 0.36, 0.5, 0.14, p);  // 공 — 활동 담당
        const col = { x: n.x, z: n.z, r: 0.7, npc: true }; colliders.push(col);
        return { id, x: n.x, z: n.z, obj: p, marker: mk, col, visible: true };
      });
      places.chief = { x: -2.6, z: 6.4 };
      bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(256, 192, (c, w, h) => {
        c.fillStyle = '#FFFDF7'; c.strokeStyle = '#3F8C86'; c.lineWidth = 10;
        c.beginPath(); if (c.roundRect) c.roundRect(12, 12, w - 24, h - 70, 56); else c.rect(12, 12, w - 24, h - 70); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(80, h - 62); c.lineTo(66, h - 14); c.lineTo(118, h - 62); c.closePath(); c.fill(); c.stroke();
        c.fillStyle = '#FFFDF7'; c.fillRect(74, h - 68, 50, 12);
        c.fillStyle = '#3F8C86'; for (let i = -1; i <= 1; i++) { c.beginPath(); c.arc(w / 2 + i * 44, (h - 58) / 2 + 8, 13, 0, 7); c.fill(); }
      }), transparent: true, depthWrite: false }));
      bubble.scale.set(1.3, 0.98, 1); scene.add(bubble);
      // ── 넓어진 마을: 남쪽 호수 · 서쪽 숲길 · 동쪽 들판 · 동남쪽 꽃 언덕 (산책로로 한 바퀴 이어짐)
      {
        const beside = (x, z, pad = 1.35) => { for (let r = 0; r < 7; r += 0.4) for (let a = 0; a < 6.28; a += 0.5) { const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (!onPath(px, pz, pad)) return [px, pz]; } return [x, z]; };
        // 남쪽 호수 + 나무 데크
        const lx = 10, lz = 44, lr = 6.2;
        mesh(new THREE.CylinderGeometry(lr + 0.6, lr + 0.8, 0.3, 40), M('#D8C8A4'), lx, 0.1, lz);
        mesh(new THREE.CylinderGeometry(lr, lr, 0.32, 40), M(COL.water, { r: 0.25, em: '#5FA9B0', ei: 0.12 }), lx, 0.14, lz).receiveShadow = true;
        for (let i = 0; i < 26; i++) { const a = i / 26 * 6.28; if (Math.abs(a - Math.PI) < 0.3) continue; const r = mesh(new THREE.DodecahedronGeometry(0.46, 0), M(i % 2 ? '#C9BBA0' : '#B5A688', { flat: true }), lx + Math.cos(a) * (lr + 0.65), 0.25, lz + Math.sin(a) * (lr + 0.65)); r.scale.y = 0.6; shade(r); }
        for (const [dx, dz] of [[1.8, -1.2], [-1.6, 2.1], [2.6, 2.4], [-0.6, -2.8], [3.4, -0.2]]) { mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 14), M('#7FA35A'), lx + dx, 0.33, lz + dz); mesh(new THREE.SphereGeometry(0.12, 8, 6), M('#F4A6A0'), lx + dx + 0.15, 0.4, lz + dz); }
        { const d = new THREE.Group(); for (let i = 0; i < 6; i++) mesh(rbox(0.62, 0.16, 1.7, 0.04), M(i % 2 ? COL.wood : '#C08E62'), -lr - 0.9 + i * 0.66, 0.46, 0, d);
          for (const [px, pz] of [[-lr - 1.1, -0.75], [-lr - 1.1, 0.75], [-lr + 2.3, -0.75], [-lr + 2.3, 0.75]]) mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.9, 8), M(COL.woodDark), px, 0.2, pz, d);
          d.position.set(lx, 0, lz); scene.add(shade(d)); }
        colliders.push({ x: lx, z: lz, r: lr + 0.5 }); blob(lx, lz, lr * 2.4, 0.18);
        MAPDATA.lakes.push({ x: lx, z: lz, r: lr, n: '호수' }, { x: -14, z: 12, r: 3.2, n: '' });
        // 서쪽 숲
        { let n = 0; for (let t = 0; t < 500 && n < (LITE ? 12 : 30); t++) { const x = -50 + rnd() * 25, z = -14 + rnd() * 62; if (onPath(x, z, 1.5) || Math.hypot(x + 14, z - 12) < 6 || (x > -24 && z < 6)) continue; tree(x, z, rnd() < 0.45 ? 'pine' : 'round', 0.95 + rnd() * 0.35); n++; } }
        // 동쪽 들판: 나무·꽃 덤불
        { let n = 0; for (let t = 0; t < 500 && n < (LITE ? 8 : 18); t++) { const x = 29 + rnd() * 21, z = -16 + rnd() * 32; if (onPath(x, z, 1.5) || Math.hypot(x - 22, z - 12) < 5.5 || Math.hypot(x - 17.5, z + 1.5) < 6) continue; if (n % 3) tree(x, z, n % 5 ? 'round' : 'blossom', 0.9 + rnd() * 0.3); else bush(x, z, 1, ['#F4A6A0', '#F6D06A', '#FFFFFF'][n % 3]); n++; } }
        // 남서쪽 가장자리 나무
        { let n = 0; for (let t = 0; t < 300 && n < (LITE ? 5 : 12); t++) { const x = -24 + rnd() * 22, z = 30 + rnd() * 20; if (onPath(x, z, 1.5) || Math.hypot(x - 10, z - 44) < 8.5) continue; tree(x, z, rnd() < 0.5 ? 'round' : 'blossom', 0.9 + rnd() * 0.3); n++; } }
        // 동남쪽 꽃 언덕
        { const pts = [], palette = ['#F4A6A0', '#F6D06A', '#FFFFFF', '#E5877A', '#C9A4E0'];
          for (let i = 0; i < 22; i++) { const bx = 22 + rnd() * 26, bz = 22 + rnd() * 28; if (onPath(bx, bz, 1.8) || Math.hypot(bx - 10, bz - 44) < 8.5) continue; for (let k = 0; k < (LITE ? 10 : 26); k++) { const a = rnd() * 6.28, r = Math.sqrt(rnd()) * 1.9; pts.push([bx + Math.cos(a) * r, bz + Math.sin(a) * r]); } }
          const o = new THREE.Object3D(), c = new THREE.Color();
          const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6), M('#FFFFFF', { r: 0.7 }), pts.length), stem = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 4), M('#5E8F45'), pts.length);
          pts.forEach(([x, z], i) => { o.position.set(x, 0.38, z); o.scale.set(1, 0.7, 1); o.updateMatrix(); head.setMatrixAt(i, o.matrix); c.set(palette[(i * 7) % palette.length]); head.setColorAt(i, c); o.position.set(x, 0.18, z); o.scale.set(1, 1, 1); o.updateMatrix(); stem.setMatrixAt(i, o.matrix); });
          for (const im of [head, stem]) { im.castShadow = true; im.receiveShadow = true; im.customDepthMaterial = depthMat; scene.add(im); } }
        // 산책로 벤치·가로등 (길 바로 옆)
        [[-6.4, 25], [-31, 17.2], [-40.6, 1], [32.4, 27], [31, 5.4], [-3.5, 39.6]].forEach(([x, z]) => { const [bx, bz] = beside(x, z, 1.6); bench(bx, bz); });
        [[-4.8, 31], [-23, 15], [-41.5, 7], [27.5, 20.3], [38, -3.2], [-20, 34], [22, 42]].forEach(([x, z]) => { const [px, pz] = beside(x, z, 1.4); lamp(px, pz); });
      }
      // 이웃 주민·강아지·연기·나비·꽃가루·구름
      const WAYS = [[-6, 8], [6, 6.5], [-8.5, -1], [8.5, 0], [-2, -9.5], [3, -9.5], [-11, 5], [10.5, -4], [1.5, 13], [-1, 17.5], [6, 18.3], [16, 17.5], [-10, -8], [12, -3.5], [-13, 2], [0, -14]];
      villagers = [
        { shirt: '#F2C14E', bottom: '#6B5B4E', hair: '#1F1B1A', style: 'short' }, { shirt: '#FFFDF7', bottom: '#E07A6B', hair: '#6B4A36', style: 'bun', overall: true },
        { shirt: '#6FA8A0', bottom: '#4E5A6B', hair: '#2E2622', style: 'short' }, { shirt: '#F6E3C4', bottom: '#7FA3D1', hair: '#3B2E2A', style: 'bob', hat: '#E9B44C' },
        { shirt: '#C9A4E0', bottom: '#4E5A6B', hair: '#1F1B1A', style: 'bob' }
      ].slice(0, LITE ? 2 : 5).map((v, i) => { const w = WAYS[(i * 3 + 1) % WAYS.length]; const p = person({ ...v, skin: SKIN[i % 4] }); p.position.set(w[0], 0, w[1]); return { obj: p, target: null, wait: rnd() * 3, ways: WAYS }; });
      {
        const p = person({ shirt: '#FFFDF7', bottom: '#C36B4A', overall: true, hair: '#3B2E2A', skin: SKIN[1], style: 'short', hat: '#E9C46A' });
        p.position.set(12.9, 0, 12.9); p.rotation.y = -2.2; p.userData.baseY = -0.18; p.userData.seated = true; p.userData.legs.forEach(l => l.rotation.x = -1.1);
        villagers.push({ obj: p, fixed: true });
      }
      dog = new THREE.Group();
      mesh(new THREE.CapsuleGeometry(0.2, 0.42, 4, 10), M('#E3B07C'), 0, 0.38, 0, dog).rotation.x = Math.PI / 2;
      mesh(new THREE.SphereGeometry(0.25, 16, 12), M('#E3B07C'), 0, 0.62, 0.38, dog);
      for (const ex of [-0.17, 0.17]) mesh(new THREE.SphereGeometry(0.1, 8, 6), M('#B98559'), ex, 0.78, 0.32, dog).scale.set(0.8, 1.4, 0.6);
      mesh(new THREE.SphereGeometry(0.05, 8, 6), M(COL.ink), 0, 0.6, 0.62, dog);
      for (const [lx, lz] of [[-0.12, 0.22], [0.12, 0.22], [-0.12, -0.22], [0.12, -0.22]]) dogLegs.push(mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.28, 6), M('#B98559'), lx, 0.14, lz, dog));
      tail = mesh(new THREE.CapsuleGeometry(0.045, 0.22, 3, 6), M('#E3B07C'), 0, 0.55, -0.42, dog); tail.rotation.x = -0.7;
      dog.position.set(10, 0, 18); scene.add(shade(dog)); dogBlob = blob(10, 18, 0.9, 0.35);
      for (let i = 0; i < 6; i++) { const s = mesh(new THREE.SphereGeometry(0.35, 10, 8), patch(new THREE.MeshStandardMaterial({ color: '#FFF8EC', transparent: true, opacity: 0.6, roughness: 1 })), 0, 0, 0); s.userData.t = i / 6; smoke.push(s); }
      for (let i = 0; i < 8; i++) {
        const b = new THREE.Group(), col = ['#FFFFFF', '#F6D06A', '#F4A6A0'][i % 3];
        const wl = mesh(new THREE.CircleGeometry(0.14, 10), M(col, { double: true }), -0.1, 0, 0, b), wr = mesh(new THREE.CircleGeometry(0.14, 10), M(col, { double: true }), 0.1, 0, 0, b);
        b.userData = { wl, wr, cx: i < 4 ? 6 + rnd() * 8 : (rnd() - 0.5) * 30, cz: i < 4 ? 10 + rnd() * 6 : -6 + rnd() * 22, r: 1.2 + rnd() * 2, sp: 0.4 + rnd() * 0.4, ph: rnd() * 6 };
        scene.add(b); butterflies.push(b);
      }
      petalGeo = new THREE.BufferGeometry(); PN = reduceMotion ? 40 : 160; const pp = new Float32Array(PN * 3);
      for (let i = 0; i < PN; i++) { pp[i * 3] = (rnd() - 0.5) * 50; pp[i * 3 + 1] = rnd() * 9; pp[i * 3 + 2] = (rnd() - 0.5) * 30; }
      petalGeo.setAttribute('position', new THREE.BufferAttribute(pp, 3));
      const dustTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,245,215,1)'); gr.addColorStop(1, 'rgba(255,245,215,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
      petals = new THREE.Points(petalGeo, new THREE.PointsMaterial({ map: dustTex, color: '#FFFFFF', size: 0.16, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
      scene.add(petals);
      for (let i = 0; i < 7; i++) {
        const c = new THREE.Group(), cm = new THREE.MeshBasicMaterial({ color: '#FFFFFF', fog: false });
        for (let k = 0; k < 5; k++) { const s = new THREE.Mesh(new THREE.SphereGeometry(3 + rnd() * 3, 14, 10), cm); s.position.set(k * 4 - 8, rnd() * 2, rnd() * 2); c.add(s); }
        c.position.set(-120 + i * 40 + rnd() * 10, 42 + rnd() * 16, -150 - rnd() * 40); c.scale.y = 0.6; scene.add(c);
      }
      // 근처 판정용 문
      doors.push(
        { id: 'support', label: '지원센터', ...places.support, r: 2.6, area: 'village' },
        { id: 'mission', label: '미션방', ...places.mission, r: 2.4, area: 'village' },
        { id: 'club', label: '동아리센터', ...places.club, r: 2.4, area: 'village' },
        { id: 'game', label: '게임방', ...places.game, r: 2.4, area: 'village' },
        { id: 'cafe', label: '카페', ...places.cafe, r: 2.2, area: 'village' },
        { id: 'park', label: '공원', ...places.park, r: 2.6, area: 'village' },
        { id: 'home', label: '내 집', ...places.home, r: 2.4, area: 'village' },
        { id: 'room-door', label: '밖으로', ...places.roomDoor, r: 1.8, area: 'room' }
      );
    }

    // ---------------- 후처리 (원본 그대로)
    const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), fsScene = new THREE.Scene();
    const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); fsQuad.frustumCulled = false; fsScene.add(fsQuad);
    const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    const blurMat = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } }, vertexShader: VS, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 dir; varying vec2 vUv;
        void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
          c += texture2D(tDiffuse, vUv + dir * 1.3846153846).rgb * 0.3162162162; c += texture2D(tDiffuse, vUv - dir * 1.3846153846).rgb * 0.3162162162;
          c += texture2D(tDiffuse, vUv + dir * 3.2307692308).rgb * 0.0702702703; c += texture2D(tDiffuse, vUv - dir * 3.2307692308).rgb * 0.0702702703;
          gl_FragColor = vec4(c, 1.0); }` });
    const copyMat = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, threshold: { value: -1 } }, vertexShader: VS, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tDiffuse; uniform float threshold; varying vec2 vUv;
        void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; if (threshold >= 0.0) { float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c *= smoothstep(threshold, threshold + 0.35, l); }
          gl_FragColor = vec4(c, 1.0); }` });
    const finalMat = new THREE.ShaderMaterial({
      uniforms: { tSharp: { value: null }, tBlur: { value: null }, tBloom: { value: null }, focusY: { value: 0.42 }, band: { value: 0.2 }, time: { value: 0 } },
      vertexShader: VS, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tSharp; uniform sampler2D tBlur; uniform sampler2D tBloom; uniform float focusY; uniform float band; uniform float time; varying vec2 vUv;
        vec3 aces(vec3 x){ const float a=2.51; const float b=0.03; const float c=2.43; const float d=0.59; const float e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0); }
        void main(){
          vec3 sharp = texture2D(tSharp, vUv).rgb, blur = texture2D(tBlur, vUv).rgb;
          float dy = vUv.y - focusY;
          float m = (dy > 0.0 ? smoothstep(band, band + 0.4, dy) : smoothstep(band, band + 0.3, -dy)) * 0.2;
          vec3 c = mix(sharp, blur, m);
          c += texture2D(tBloom, vUv).rgb * 0.12;
          vec2 sp = vUv - vec2(0.08, 1.05); float ray = pow(max(0.0, 1.0 - length(sp * vec2(1.0, 1.25)) / 1.25), 2.2);
          float streak = 0.55 + 0.45 * sin(atan(sp.y, sp.x) * 22.0 + time * 0.15);
          c += vec3(1.0, 0.95, 0.85) * ray * 0.0 * streak;
          c *= vec3(1.0, 1.0, 0.99);
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l), c, 1.14);
          c = aces(c * 0.95);
          vec2 q = vUv - 0.5; c *= 1.0 - dot(q * vec2(0.95, 1.2), q * vec2(0.95, 1.2)) * 0.15;
          c = pow(c, vec3(1.0 / 2.2));
          c += (fract(sin(dot(vUv * 913.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
          gl_FragColor = vec4(c, 1.0); }` });
    const rtType = (isGL2 || renderer.extensions.has('OES_texture_half_float')) ? THREE.HalfFloatType : THREE.UnsignedByteType;
    let rtScene, rtA, rtB, rtC, rtD, W = 1, Hh = 1;
    function makeRT(w, h) { return new THREE.WebGLRenderTarget(w, h, { type: rtType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false }); }
    function buildRTs() {
      [rtScene, rtA, rtB, rtC, rtD].forEach(r => r && r.dispose());
      const w = Math.max(1, Math.floor(W * DPR)), h = Math.max(1, Math.floor(Hh * DPR));
      rtScene = new THREE.WebGLRenderTarget(w, h, { type: rtType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      if (isGL2 && !LITE) rtScene.samples = 4;
      const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
      rtA = makeRT(hw, hh); rtB = makeRT(hw, hh); rtC = makeRT(qw, qh); rtD = makeRT(qw, qh);
    }
    function pass(mat, target) { fsQuad.material = mat; renderer.setRenderTarget(target); renderer.render(fsScene, fsCam); }
    let gfxHigh = !isSmall && !LITE;
    function renderFrame() {
      renderer.setRenderTarget(rtScene); renderer.render(scene, camera);
      copyMat.uniforms.tDiffuse.value = rtScene.texture; copyMat.uniforms.threshold.value = -1; pass(copyMat, rtA);
      const it = gfxHigh ? 2 : 1;
      for (let i = 0; i < it; i++) {
        blurMat.uniforms.tDiffuse.value = rtA.texture; blurMat.uniforms.dir.value.set(1.1 / rtA.width, 0); pass(blurMat, rtB);
        blurMat.uniforms.tDiffuse.value = rtB.texture; blurMat.uniforms.dir.value.set(0, 1.1 / rtA.height); pass(blurMat, rtA);
      }
      copyMat.uniforms.tDiffuse.value = rtA.texture; copyMat.uniforms.threshold.value = 1.1; pass(copyMat, rtC);
      for (let i = 0; i < 2; i++) {
        blurMat.uniforms.tDiffuse.value = rtC.texture; blurMat.uniforms.dir.value.set(2.0 / rtC.width, 0); pass(blurMat, rtD);
        blurMat.uniforms.tDiffuse.value = rtD.texture; blurMat.uniforms.dir.value.set(0, 2.0 / rtC.height); pass(blurMat, rtC);
      }
      finalMat.uniforms.tSharp.value = rtScene.texture; finalMat.uniforms.tBlur.value = rtA.texture; finalMat.uniforms.tBloom.value = rtC.texture;
      pass(finalMat, null);
    }

    // ---------------- 플레이어·안내하는 루미·표시물
    let player = null, playerAvatarKey = '', guide = null, guideState = null, marker = null, zzz = null, knock = null, waitSpr = null;
    const hooks = { near: null, action: null, tick: null, view: null, blocked: () => false };
    let mode = 'village', running = false, nearTarget = null;
    const keys = new Set(); let tapTarget = null, autoPath = null;

    function setAvatar(av) {
      const key = JSON.stringify(av || {});
      if (player && key === playerAvatarKey) return;
      const pos = player ? player.position.clone() : new THREE.Vector3(), rot = player ? player.rotation.y : Math.PI;
      const seated = player && player.userData.seated;
      removePerson(player);
      player = person(lookFromAvatar(av)); player.position.copy(pos); player.rotation.y = rot; playerAvatarKey = key;
      if (seated) setSeated(player, true);
    }
    function ensureGuide() {
      if (guide) return guide;
      guide = person({ ...LUMI_LOOK, scale: 1.1 }); guide.visible = false; guide.userData.blob.visible = false;
      mesh(rbox(0.26, 0.3, 0.26, 0.06), M('#FCE3A6', { em: '#F7C66A', ei: 1.2 }), 0.4, 0.42, 0.1, guide);
      return guide;
    }
    function ensureMarker() {
      if (marker) return marker;
      marker = new THREE.Group();
      const m = mesh(new THREE.OctahedronGeometry(0.4, 0), M('#F2C14E', { em: '#F2C14E', ei: 0.8, r: 0.4 }), 0, 0, 0, marker); m.scale.set(1, 1.5, 1);
      marker.visible = false; scene.add(marker); return marker;
    }

    // 분수를 가로지르면 둘레로 돌아간다
    // ---------------- 길찾기: 0.5칸 격자 A* + 직선 당기기 (건물·울타리·벤치를 돌아간다)
    let grid = null;
    function buildGrid() {
      const cs = 0.5, x0 = -54, z0 = -19, nx = 217, nz = 149, blocked = new Uint8Array(nx * nz), pad = 0.5;
      const cols = colliders.filter(c => (c.seg ? c.seg[1] < 60 : c.z < 60));
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const x = x0 + i * cs, z = z0 + j * cs;
        for (const c of cols) {
          let d;
          if (c.seg) { const [ax, az, bx, bz] = c.seg, vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz))); d = Math.hypot(x - ax - vx * t, z - az - vz * t); }
          else d = Math.hypot(x - c.x, z - c.z);
          if (d < c.r + pad) { blocked[j * nx + i] = 1; break; }
        }
      }
      grid = { cs, x0, z0, nx, nz, blocked };
    }
    function cellOf(p) { return [Math.round((p.x - grid.x0) / grid.cs), Math.round((p.z - grid.z0) / grid.cs)]; }
    function freeCell(i, j) { return i >= 0 && j >= 0 && i < grid.nx && j < grid.nz && !grid.blocked[j * grid.nx + i]; }
    function nearestFree(i, j) {
      if (freeCell(i, j)) return [i, j];
      for (let r = 1; r < 12; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (Math.max(Math.abs(di), Math.abs(dj)) === r && freeCell(i + di, j + dj)) return [i + di, j + dj];
      return null;
    }
    function losFree(a, b) {
      const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(L / 0.25);
      for (let k = 1; k < n; k++) { const t = k / n, c = cellOf({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }); if (!freeCell(c[0], c[1])) return false; }
      return true;
    }
    function astar(from, to) {
      if (!grid) buildGrid();
      const s = nearestFree(...cellOf(from)), g = nearestFree(...cellOf(to));
      if (!s || !g) return null;
      const nx = grid.nx, N = nx * grid.nz, gs = new Float32Array(N).fill(1e9), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
      const si = s[1] * nx + s[0], gi = g[1] * nx + g[0];
      const open = [si]; gs[si] = 0; const f = new Float32Array(N).fill(1e9);
      const hh = (i) => { const dx = Math.abs(i % nx - g[0]), dz = Math.abs(((i / nx) | 0) - g[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
      f[si] = hh(si);
      let guard = 0;
      while (open.length && guard++ < 60000) {
        let bi = 0; for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
        const cur = open[bi]; open.splice(bi, 1);
        if (cur === gi) break;
        if (closed[cur]) continue; closed[cur] = 1;
        const ci = cur % nx, cj = (cur / nx) | 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di, nj = cj + dj; if (!freeCell(ni, nj)) continue;
          if (di && dj && (!freeCell(ci + di, cj) || !freeCell(ci, cj + dj))) continue;
          const nn = nj * nx + ni, ng = gs[cur] + (di && dj ? 1.414 : 1);
          if (ng < gs[nn]) { gs[nn] = ng; came[nn] = cur; f[nn] = ng + hh(nn); open.push(nn); }
        }
      }
      if (came[gi] < 0 && gi !== si) return null;
      const cells = []; for (let c = gi; c >= 0 && c !== si; c = came[c]) cells.push(c); cells.reverse();
      const pts = cells.map(c => ({ x: grid.x0 + (c % nx) * grid.cs, z: grid.z0 + ((c / nx) | 0) * grid.cs }));
      pts.push({ x: to.x, z: to.z });
      const out = []; let a = { x: from.x, z: from.z }, k = 0;
      while (k < pts.length) { let j = pts.length - 1; while (j > k && !losFree(a, pts[j])) j--; out.push(pts[j]); a = pts[j]; k = j + 1; }
      return out;
    }
    function route(from, to) {
      if (mode === 'room' || from.z > 40) return [{ x: to.x, z: to.z }];
      return astar(from, to) || route0(from, to);
    }
    function route0(from, to) {
      const vx = to.x - from.x, vz = to.z - from.z, L2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, -(from.x * vx + from.z * vz) / L2));
      const cx = from.x + vx * t, cz = from.z + vz * t;
      if (Math.hypot(cx, cz) < 5 && t > 0.05 && t < 0.95) {
        let ax = (from.x + to.x) / 2, az = (from.z + to.z) / 2;
        if (Math.hypot(ax, az) < 0.5) { ax = -vz; az = vx; }
        const l = Math.hypot(ax, az) || 1;
        return [{ x: ax / l * 6.2, z: az / l * 6.2 }, { x: to.x, z: to.z }];
      }
      return [{ x: to.x, z: to.z }];
    }

    // ---------------- 입력
    let bindings = { forward:'KeyW', left:'KeyA', back:'KeyS', right:'KeyD', interact:'KeyE', map:'KeyM' };
    const inputCode = e => e.code || (/^[a-z0-9]$/i.test(e.key) ? (/^[0-9]$/.test(e.key) ? 'Digit' : 'Key') + e.key.toUpperCase() : e.key === ' ' ? 'Space' : e.key);
    function onKey(e) {
      if (!running) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      if (tag === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
      if (hooks.blocked()) return;
      const code = inputCode(e);
      if (['forward','left','back','right'].some(action => bindings[action] === code) || ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(code)) {
        keys.add(code); tapTarget = null; autoPath = null; e.preventDefault();
      }
      if (!e.repeat && (code === bindings.interact || code === 'Enter' || code === 'Space')) { e.preventDefault(); if (hooks.action) hooks.action(nearTarget); }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', e => keys.delete(inputCode(e)));
    window.addEventListener('blur', () => keys.clear());
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
    // ---------------- 자유 시점: 마우스/손가락으로 끌면 돌리고, 휠로 가까이·멀리. 짧게 누르면 기존처럼 그곳으로 걷는다
    const VIEW0 = { yaw: 0, pitch: Math.atan2(13.7, 16.8), dist: Math.hypot(13.7, 16.8) };
    const VIEW0R = { yaw: 0, pitch: Math.atan2(8.6, 9.2), dist: Math.hypot(8.6, 9.2) };
    const view = { yaw: 0, pitch: VIEW0.pitch, zoom: 1 }, viewT = { yaw: 0, pitch: VIEW0.pitch, zoom: 1 };
    const PITCH_MIN = 0.36, PITCH_MAX = 1.12, ROOM_YAW = 0.6;
    function base() { return mode === 'room' ? VIEW0R : VIEW0; }
    function clampView(v) {
      if (mode === 'room') v.yaw = Math.max(-ROOM_YAW, Math.min(ROOM_YAW, v.yaw));   // 방은 벽이 가리지 않는 만큼만
      v.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, v.pitch)); v.zoom = Math.max(0.6, Math.min(1.35, v.zoom));
    }
    function viewChanged() { const b = base(); return Math.abs(viewT.yaw) > 0.03 || Math.abs(viewT.pitch - b.pitch) > 0.03 || Math.abs(viewT.zoom - 1) > 0.03; }
    let lastViewFlag = false;
    function notifyView() { const f = viewChanged(); if (f !== lastViewFlag) { lastViewFlag = f; if (hooks.view) hooks.view(f); } }
    function resetView(instant) { const b = base(); viewT.yaw = 0; viewT.pitch = b.pitch; viewT.zoom = 1; if (instant) Object.assign(view, viewT); notifyView(); }
    const drag = { id: null, x: 0, y: 0, moved: false, down: null };
    renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
    renderer.domElement.addEventListener('pointermove', e => {
      if (drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(e.clientX - drag.down.clientX, e.clientY - drag.down.clientY) < 7) return;
      drag.moved = true; drag.x = e.clientX; drag.y = e.clientY;
      viewT.yaw -= dx * 0.008; viewT.pitch += dy * 0.005; clampView(viewT); notifyView();
    });
    const endDrag = e => {
      if (drag.id !== e.pointerId) return;
      const tap = !drag.moved && e.type === 'pointerup' && drag.down.button === 0 ? drag.down : null;
      drag.id = null;
      if (tap) onTap(tap);
    };
    renderer.domElement.addEventListener('pointerup', endDrag);
    renderer.domElement.addEventListener('pointercancel', endDrag);
    renderer.domElement.addEventListener('wheel', e => {
      if (!running || hooks.blocked()) return;
      e.preventDefault(); viewT.zoom *= Math.exp(e.deltaY * 0.0012); clampView(viewT); notifyView();
    }, { passive: false });
    renderer.domElement.addEventListener('pointerdown', e => {
      if (!running || hooks.blocked()) return;
      drag.id = e.pointerId; drag.x = e.clientX; drag.y = e.clientY; drag.moved = false; drag.down = { clientX: e.clientX, clientY: e.clientY, button: e.button };
      try { renderer.domElement.setPointerCapture(e.pointerId); } catch (_) {}
    });
    function onTap(e) {
      if (!running || hooks.blocked()) return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      let y0 = 0;
      for (let i = 0; i < 3; i++) { groundPlane.constant = y0; if (!ray.ray.intersectPlane(groundPlane, hit)) return; y0 = bendY(hit.x, hit.z); }
      for (const n of npcObjs) if (n.visible && Math.hypot(hit.x - n.x, hit.z - n.z) < 1.3 && Math.hypot(player.position.x - n.x, player.position.z - n.z) < 3.2) { if (hooks.action) hooks.action({ type: 'npc', id: n.id }); return; }
      autoPath = null; tapTarget = new THREE.Vector2(hit.x, hit.z);
    }

    // ---------------- 이동·충돌
    const VB = { x0: -52, x1: 52, z0: -19, z1: 52 };
    const RB = { x0: RX - 4.8, x1: RX + 4.8, z0: RZ - 3.8, z1: RZ + 3.9 };
    function collide(pos, r) {
      for (const c of colliders) {
        if (c.off) continue;
        if (c.seg) {
          const [ax, az, bx, bz] = c.seg, vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((pos.x - ax) * vx + (pos.z - az) * vz) / (vx * vx + vz * vz)));
          const qx = ax + vx * t, qz = az + vz * t, dx = pos.x - qx, dz = pos.z - qz, d = Math.hypot(dx, dz), min = c.r + r;
          if (d < min && d > 1e-4) { pos.x = qx + dx / d * min; pos.z = qz + dz / d * min; }
          continue;
        }
        const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz), min = c.r + r;
        if (d < min && d > 1e-4) { pos.x = c.x + dx / d * min; pos.z = c.z + dz / d * min; }
      }
      const B = mode === 'room' ? RB : VB;
      pos.x = Math.min(B.x1, Math.max(B.x0, pos.x)); pos.z = Math.min(B.z1, Math.max(B.z0, pos.z));
    }
    function turnToward(obj, dx, dz, dt, rate = 10) { let d = Math.atan2(dx, dz) - obj.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); obj.rotation.y += d * Math.min(1, dt * rate); }


    // ---------------- 미니맵 — 좌측 상단 원형. 내 위치가 가운데, 화면 위쪽 = 카메라가 보는 방향
    const MAP_B = { x0: -58, x1: 58, z0: -34, z1: 58 }, MAP_S = 4, MAP_SPAN = 30;
    const MAP_BUILD = [
      { n: '지원센터', x: 0, z: -17, w: 11, d: 7.5, c: '#4FB9A8' }, { n: '미션방', x: -17, z: -1, w: 6, d: 6, c: '#FF8F7A' },
      { n: '동아리센터', x: 15, z: -11, w: 7, d: 5.5, c: '#A98BF0' }, { n: '게임방', x: 17.5, z: -1.5, r: 4.4, c: '#FFB45C' },
      { n: '카페', x: -11.8, z: -10.6, w: 6, d: 5, c: '#FF8FB3' }, { n: '내 집', x: 22, z: 12, w: 5.6, d: 5, c: '#6FB6F2' }
    ];
    const MAP_AREA = [{ n: '광장', x: 0, z: 5.5 }, { n: '공원', x: -14, z: 16.5 }, { n: '호수', x: 10, z: 36.8 }, { n: '숲길', x: -38, z: 22 }, { n: '꽃 언덕', x: 36, z: 38 }, { n: '들판', x: 42, z: 6 }];
    const NPC_DOT = { psych: '#B56CC0', policy: '#3F7FD6', job: '#2F9E8F', chief: '#E0A020', coco: '#2E6B4F' };
    let mm = null;
    function mmBase() {
      const W = (MAP_B.x1 - MAP_B.x0) * MAP_S, H = (MAP_B.z1 - MAP_B.z0) * MAP_S, c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d'), P = (x, z) => [(x - MAP_B.x0) * MAP_S, (z - MAP_B.z0) * MAP_S];
      g.fillStyle = '#9BD27A'; g.fillRect(0, 0, W, H);
      const [, ry] = P(0, MAPDATA.riverZ); g.fillStyle = '#7FBF62'; g.fillRect(0, 0, W, ry - 2.7 * MAP_S); g.fillStyle = '#6FC7E4'; g.fillRect(0, ry - 2.7 * MAP_S, W, 5.4 * MAP_S);
      { const [bx0, bz0] = P(VB.x0, VB.z0), [bx1, bz1] = P(VB.x1, VB.z1); g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 3; g.setLineDash([10, 8]); g.strokeRect(bx0, bz0, bx1 - bx0, bz1 - bz0); g.setLineDash([]); }
      g.fillStyle = 'rgba(46,120,60,.45)'; for (const [x, z] of MAPDATA.trees) { const [px, py] = P(x, z); g.beginPath(); g.arc(px, py, 1.2 * MAP_S, 0, 7); g.fill(); }
      g.strokeStyle = '#F4E2B8'; g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = MAPDATA.pathW * MAP_S;
      for (const p of MAPDATA.paths) { g.beginPath(); p.forEach(([x, z], i) => { const [px, py] = P(x, z); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke(); }
      { const [px, py] = P(0, 0); g.fillStyle = '#F6E7C6'; g.beginPath(); g.arc(px, py, 9.4 * MAP_S, 0, 7); g.fill(); g.fillStyle = '#7FD0EA'; g.beginPath(); g.arc(px, py, 3.2 * MAP_S, 0, 7); g.fill(); }
      for (const l of MAPDATA.lakes) { const [px, py] = P(l.x, l.z); g.fillStyle = '#7FD0EA'; g.beginPath(); g.arc(px, py, l.r * MAP_S, 0, 7); g.fill(); }
      for (const t of MAPDATA.till) { const [a, b] = P(t.x0, t.z0), [c2, d] = P(t.x1, t.z1); g.fillStyle = '#B98B5E'; g.fillRect(a, b, c2 - a, d - b); }
      for (const b of MAP_BUILD) { const [px, py] = P(b.x, b.z); g.fillStyle = b.c; g.strokeStyle = '#3E4454'; g.lineWidth = 3; g.beginPath();
        if (b.r) g.arc(px, py, b.r * MAP_S, 0, 7); else if (g.roundRect) g.roundRect(px - b.w * MAP_S / 2, py - b.d * MAP_S / 2, b.w * MAP_S, b.d * MAP_S, 8); else g.rect(px - b.w * MAP_S / 2, py - b.d * MAP_S / 2, b.w * MAP_S, b.d * MAP_S);
        g.fill(); g.stroke(); }
      return c;
    }
    function drawMinimap() {
      if (!mm || !player || mode !== 'village') return;
      if (!mm.base) mm.base = mmBase();
      { const cw = mm.canvas.clientWidth; if (cw && cw !== mm.size) attachMinimap(mm.canvas); }
      const dpr = mm.dpr, Sz = mm.size, R = Sz / 2, k = R / MAP_SPAN, g = mm.ctx, yaw = window.__SW_NORTH_FIXED ? 0 : view.yaw, px = player.position.x, pz = player.position.z;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, Sz, Sz);
      g.save(); g.beginPath(); g.arc(R, R, R - 1.5, 0, 7); g.clip(); g.fillStyle = '#7FBF62'; g.fillRect(0, 0, Sz, Sz);
      g.translate(R, R); g.rotate(yaw); g.scale(k / MAP_S, k / MAP_S); g.drawImage(mm.base, -(px - MAP_B.x0) * MAP_S, -(pz - MAP_B.z0) * MAP_S); g.restore();
      const cy = Math.cos(yaw), sy = Math.sin(yaw), W2M = (x, z) => { const dx = (x - px) * k, dz = (z - pz) * k; return [R + dx * cy - dz * sy, R + dx * sy + dz * cy]; }, inside = ([x, y], m = 6) => Math.hypot(x - R, y - R) < R - m;
      g.save(); g.beginPath(); g.arc(R, R, R - 1.5, 0, 7); g.clip();
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      const label = (t, x, y, size, col) => { g.font = `700 ${size}px ${FONT}`; g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.95)'; g.strokeText(t, x, y); g.fillStyle = col; g.fillText(t, x, y); };
      const fs = Sz / 150;   // 작은 화면(모바일)에서는 글자를 줄이고 구역 이름은 생략
      if (Sz >= 130) for (const a of MAP_AREA) { const q = W2M(a.x, a.z); if (inside(q, 14)) label(a.n, q[0], q[1], 9, '#4A6B3A'); }
      for (const b of MAP_BUILD) { const q = W2M(b.x, b.z); if (inside(q, 10 * fs)) label(b.n, q[0], q[1], Math.max(8, Math.round(10 * fs)), '#2F3642'); }
      const dot = (x, z, col, r, ring) => { const q = W2M(x, z); if (!inside(q, 3)) return; g.beginPath(); g.arc(q[0], q[1], r, 0, 7); g.fillStyle = col; g.fill(); g.lineWidth = ring ? 2 : 1.4; g.strokeStyle = '#FFFFFF'; g.stroke(); };
      for (const v of villagers) if (v.obj.visible !== false) dot(v.obj.position.x, v.obj.position.z, '#8A8F9C', 2.6);
      for (const n of npcObjs) if (n.visible) dot(n.obj.position.x, n.obj.position.z, NPC_DOT[n.id] || '#5A6070', 4.2, true);
      if (guide && guide.visible) dot(guide.position.x, guide.position.z, NPC_DOT.psych, 4.6, true);
      g.restore();
      // 나 — 가운데 화살표 (바라보는 방향)
      const fx = Math.sin(player.rotation.y), fz = Math.cos(player.rotation.y), ang = Math.atan2(fx * sy + fz * cy, fx * cy - fz * sy);
      g.save(); g.translate(R, R); g.rotate(ang); g.beginPath(); g.moveTo(8, 0); g.lineTo(-5, 5.5); g.lineTo(-2.5, 0); g.lineTo(-5, -5.5); g.closePath();
      g.fillStyle = '#FF5A4E'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#FFFFFF'; g.stroke(); g.restore();
      // 북쪽 표시
      const nq = [R + (0 * cy - (-1) * sy) * (R - 11), R + (0 * sy + (-1) * cy) * (R - 11)];
      label('N', nq[0], nq[1], 12, '#CC443B');
      g.beginPath(); g.arc(R, R, R - 1.5, 0, 7); g.lineWidth = 3; g.strokeStyle = 'rgba(255,248,236,.95)'; g.stroke();
    }
    function attachMinimap(canvas) {
      if (!canvas) return;
      const size = canvas.clientWidth || 150, dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr);
      mm = { canvas, ctx: canvas.getContext('2d'), size, dpr, base: mm && mm.base, frame: 0 };
    }
    window.addEventListener('resize', () => { if (mm) attachMinimap(mm.canvas); });
    // ---------------- 카메라·루프
    const camOffV = new THREE.Vector3(0, 13.7, 16.8), camOffR = new THREE.Vector3(0, 8.6, 9.2);
    const camFocus = new THREE.Vector3();
    function resize() {
      W = window.innerWidth; Hh = window.innerHeight;
      renderer.setPixelRatio(DPR); renderer.setSize(W, Hh, false);
      camera.aspect = W / Hh; camera.fov = W < 640 ? 50 : 36; camera.updateProjectionMatrix();
      buildRTs();
    }
    window.addEventListener('resize', () => { if (running) resize(); });
    function setGfx(high) {
      gfxHigh = high && !LITE;
      DPR = gfxHigh ? Math.min(window.devicePixelRatio || 1, 1.75) : 1;
      const ms = gfxHigh ? 2048 : 1024; if (sun) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
      resize();
    }
    const clock = new THREE.Clock(), tmpV = new THREE.Vector3();
    function nearest() {
      let best = null, bd = 99;
      const px = player.position.x, pz = player.position.z;
      if (mode === 'village') for (const n of npcObjs) { if (!n.visible) continue; const d = Math.hypot(px - n.x, pz - n.z); if (d < 3.0 && d < bd) { bd = d; best = { type: 'npc', id: n.id }; } }
      for (const d0 of doors) { if (d0.area !== mode) continue; const d = Math.hypot(px - d0.x, pz - d0.z); if (d < d0.r && d < bd) { bd = d; best = { type: 'door', id: d0.id, label: d0.label }; } }
      return best;
    }
    function tick() {
      if (!running) return;
      const dt = Math.min(clock.getDelta(), 0.05) * (window.__SW_TIMESCALE || 1), t = clock.elapsedTime;
      U.time.value = reduceMotion ? 0 : t;
      let mx = 0, mz = 0, stepCap = Infinity;
      const blocked = hooks.blocked() || (player && player.userData.seated) || (guideState && guideState.lockPlayer);
      if (!blocked) {
        if (keys.has(bindings.forward) || keys.has('ArrowUp')) mz -= 1;
        if (keys.has(bindings.back) || keys.has('ArrowDown')) mz += 1;
        if (keys.has(bindings.left) || keys.has('ArrowLeft')) mx -= 1;
        if (keys.has(bindings.right) || keys.has('ArrowRight')) mx += 1;
        if (mx || mz) { const c = Math.cos(view.yaw), sn = Math.sin(view.yaw), ix = mx, iz = mz; mx = ix * c + iz * sn; mz = -ix * sn + iz * c; }   // 화면 기준 위·아래·좌·우
        if (!mx && !mz && autoPath && autoPath.length) {
          const wp = autoPath[0], dx = wp.x - player.position.x, dz = wp.z - player.position.z, d = Math.hypot(dx, dz);
          if (d > 0.35) { mx = dx / d; mz = dz / d; stepCap = d; } else { autoPath.shift(); if (!autoPath.length) autoPath = null; }
        } else if (!mx && !mz && tapTarget) { const dx = tapTarget.x - player.position.x, dz = tapTarget.y - player.position.z, d = Math.hypot(dx, dz); if (d > 0.25) { mx = dx / d; mz = dz / d; stepCap = d; } else tapTarget = null; }
      }
      const moving = !!(mx || mz);
      if (moving) {
        const l = Math.hypot(mx, mz); mx /= l; mz /= l;
        const bx = player.position.x, bz = player.position.z;
        const step = Math.min(4.6 * dt, stepCap);
        player.position.x += mx * step; player.position.z += mz * step; collide(player.position, 0.4);
        if (Math.hypot(player.position.x - bx, player.position.z - bz) < step * 0.2) {
          if (autoPath && autoPath.length && (autoPath.stuck = (autoPath.stuck || 0) + 1) < 40) {
            // 막히면 옆으로 한 걸음 비켜서 다시 간다
            const side = (autoPath.stuck % 2 ? 1 : -1) * 2.2;
            if (autoPath.stuck % 8 === 1) autoPath.unshift({ x: player.position.x - mz * side, z: player.position.z + mx * side });
          } else { tapTarget = null; autoPath = null; }
        }
        turnToward(player, mx, mz, dt);
      }
      animatePerson(player, moving, t, dt);
      if (zzz) { zzz.visible = !!player.userData.sleeping; zzz.position.set(player.position.x + 0.6, 2.6 + Math.sin(t * 2) * 0.1 - bendY(player.position.x, player.position.z), player.position.z); }

      // 안내하는 루미
      if (guide && guide.visible) {
        let gm = false;
        if (guideState && guideState.path && guideState.path.length) {
          const wp = guideState.path[0], dx = wp.x - guide.position.x, dz = wp.z - guide.position.z, d = Math.hypot(dx, dz);
          // 유저가 루미보다 목적지에서 더 멀리(뒤처져) 있고, 거리도 멀 때만 기다린다 — 앞질러 가면 그냥 따라간다
          const dest = guideState.path[guideState.path.length - 1];
          const behind = Math.hypot(player.position.x - dest.x, player.position.z - dest.z) > Math.hypot(guide.position.x - dest.x, guide.position.z - dest.z);
          const far = guideState.leash && behind && Math.hypot(guide.position.x - player.position.x, guide.position.z - player.position.z) > guideState.leash;
          guideState.waiting = !!far;
          if (far) { turnToward(guide, player.position.x - guide.position.x, player.position.z - guide.position.z, dt, 6); }   // 너무 멀어지면 멈춰서 기다린다
          else if (d > 0.25) { const sp = guideState.speed || 3.4; guide.position.x += dx / d * Math.min(d, sp * dt); guide.position.z += dz / d * Math.min(d, sp * dt); turnToward(guide, dx, dz, dt, 8); gm = true; }
          else { guideState.path.shift(); if (!guideState.path.length) { const cb = guideState.done; guideState.done = null; if (cb) cb(); } }
        } else { turnToward(guide, player.position.x - guide.position.x, player.position.z - guide.position.z, dt, 4); }
        animatePerson(guide, gm, t, dt);
        if (knock) { knock.visible = !!(guideState && guideState.knock); knock.position.set(guide.position.x, 2.9 - bendY(guide.position.x, guide.position.z), guide.position.z); }
        if (waitSpr) { waitSpr.visible = !!(guideState && (guideState.waiting || guideState.hello)); waitSpr.position.set(guide.position.x, 2.9 - bendY(guide.position.x, guide.position.z) + Math.sin(t * 3) * 0.05, guide.position.z); }
      } else { if (knock) knock.visible = false; if (waitSpr) waitSpr.visible = false; }
      if (marker && marker.visible) { marker.children[0].rotation.y += dt * 2; marker.position.y = 3.2 + Math.sin(t * 3) * 0.2 - bendY(marker.position.x, marker.position.z); }

      if (mode === 'village') {
        for (const n of npcObjs) {
          if (!n.visible) continue;
          const dx = player.position.x - n.x, dz = player.position.z - n.z, d = Math.hypot(dx, dz);
          if (d < 6) turnToward(n.obj, dx, dz, dt, 4);
          animatePerson(n.obj, false, t, dt);
          n.marker.rotation.y += dt * 1.6; n.marker.position.y = 2.15 + Math.sin(t * 2.2 + n.x) * 0.07;
        }
        for (const v of villagers) {
          if (v.fixed) { animatePerson(v.obj, false, t, dt); continue; }
          if (v.wait > 0) { v.wait -= dt; animatePerson(v.obj, false, t, dt); continue; }
          if (!v.target) { const w = v.ways[Math.floor(rnd() * v.ways.length)]; v.target = new THREE.Vector2(w[0] + (rnd() - 0.5) * 2, w[1] + (rnd() - 0.5) * 2); }
          const dx = v.target.x - v.obj.position.x, dz = v.target.y - v.obj.position.z, d = Math.hypot(dx, dz);
          if (d < 0.3) { v.target = null; v.wait = 1.5 + rnd() * 4; animatePerson(v.obj, false, t, dt); continue; }
          const bx = v.obj.position.x, bz = v.obj.position.z;
          v.obj.position.x += dx / d * 1.6 * dt; v.obj.position.z += dz / d * 1.6 * dt; collide(v.obj.position, 0.35);
          if (Math.hypot(v.obj.position.x - bx, v.obj.position.z - bz) < 1.6 * dt * 0.3) { v.target = null; v.wait = 0.5; }
          turnToward(v.obj, dx, dz, dt, 6); animatePerson(v.obj, true, t, dt);
        }
        { const tx = player.position.x + 1.1, tz = player.position.z + 0.9, dx = tx - dog.position.x, dz = tz - dog.position.z, d = Math.hypot(dx, dz), mv = d > 1.5;
          if (mv) { dog.position.x += dx / d * Math.min(d, 6) * dt * 1.2; dog.position.z += dz / d * Math.min(d, 6) * dt * 1.2; collide(dog.position, 0.3); turnToward(dog, dx, dz, dt, 8); }
          const ph = t * (mv ? 14 : 0); dogLegs.forEach((l, i) => l.rotation.x = Math.sin(ph + (i % 2) * Math.PI) * 0.6);
          tail.rotation.z = Math.sin(t * (mv ? 16 : 6)) * 0.5; dog.position.y = mv ? Math.abs(Math.sin(ph)) * 0.05 : 0; dogBlob.position.set(dog.position.x, 0.04, dog.position.z); }
        for (const j of fountainJets) { const u = j.userData; u.t = (u.t + dt * 0.7) % 1; const r = u.t * 2.1; j.position.set(Math.cos(u.a) * r, 2.6 + u.t * 1.6 - u.t * u.t * 3.4, Math.sin(u.a) * r); }
        flags.forEach((f, i) => f.rotation.y = Math.sin(t * 2.4 + i) * 0.25);
        for (const s of smoke) { const u = s.userData; u.t = (u.t + dt * 0.18) % 1; s.position.set(chimneyPos.x + u.t * 1.6, chimneyPos.y + u.t * 4, chimneyPos.z); s.scale.setScalar(0.6 + u.t * 1.6); s.material.opacity = 0.55 * (1 - u.t); }
        for (const b of butterflies) { const u = b.userData, a = t * u.sp + u.ph; const x = u.cx + Math.cos(a) * u.r, z = u.cz + Math.sin(a * 1.3) * u.r; b.position.set(x, 1.1 + Math.sin(a * 2.3) * 0.45, z); b.rotation.y = -a; const f = Math.sin(t * 18 + u.ph) * 0.9; u.wl.rotation.y = f; u.wr.rotation.y = -f; }
        if (!reduceMotion) { const pa = petalGeo.attributes.position; for (let i = 0; i < PN; i++) { let y = pa.getY(i) - dt * 0.25, x = pa.getX(i) + dt * 0.35 + Math.sin(t + i) * dt * 0.2; if (y < 0) y = 9; if (x > 25) x = -25; pa.setX(i, x); pa.setY(i, y); } pa.needsUpdate = true; }
        const bn = npcObjs.find(n => n.id === (api.bubbleNpc || 'psych') && n.visible);
        bubble.visible = !!bn;
        if (bn) { const ps = bn.obj.position; bubble.position.set(ps.x + 0.6, 2.95 - bendY(ps.x, ps.z) + Math.sin(t * 2) * 0.05, ps.z); }
      }

      const nt = nearest();
      if (JSON.stringify(nt) !== JSON.stringify(nearTarget)) { nearTarget = nt; if (hooks.near) hooks.near(nt); }
      if (hooks.tick) hooks.tick(dt);

      if (mode === 'room') camFocus.lerp(new THREE.Vector3(RX + (player.position.x - RX) * 0.35, 0, RZ + (player.position.z - RZ) * 0.35 + 0.6), reduceMotion ? 1 : Math.min(1, dt * 3));
      else camFocus.lerp(player.position, reduceMotion ? 1 : Math.min(1, dt * 4));
      U.center.value.set(camFocus.x, 0, camFocus.z);
      petals.position.set(camFocus.x, -1, camFocus.z - 4);
      { const k = reduceMotion ? 1 : Math.min(1, dt * 12);
        let dy = viewT.yaw - view.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        view.yaw += dy * k; view.pitch += (viewT.pitch - view.pitch) * k; view.zoom += (viewT.zoom - view.zoom) * k; }
      U.yaw.value = view.yaw;
      { const b = base(), D = b.dist * view.zoom, sy = Math.sin(view.yaw), cy = Math.cos(view.yaw), ah = mode === 'room' ? 1.6 : 3;
        camera.position.set(camFocus.x + sy * Math.cos(view.pitch) * D, camFocus.y + Math.sin(view.pitch) * D, camFocus.z + cy * Math.cos(view.pitch) * D);
        camera.lookAt(camFocus.x - sy * ah, 0.9, camFocus.z - cy * ah); }
      if (skyDeco) { skyDeco.visible = mode !== 'room'; skyDeco.position.set(camFocus.x, 0, camFocus.z); if (!reduceMotion) cloudRing.rotation.y += dt * 0.004; sunDisc.lookAt(camera.position); }
      sun.position.copy(camFocus).addScaledVector(SUN_DIR, 50); sun.target.position.copy(camFocus); sun.target.updateMatrixWorld();
      if (mm && (mm.frame++ % 2 === 0)) drawMinimap();
      sky.position.copy(camera.position);
      tmpV.set(player.position.x, 0.9 - bendY(player.position.x, player.position.z), player.position.z).project(camera);
      finalMat.uniforms.focusY.value += ((tmpV.y * 0.5 + 0.5) - finalMat.uniforms.focusY.value) * Math.min(1, dt * 5);
      finalMat.uniforms.band.value = mode === 'room' ? 0.35 : 0.2;
      finalMat.uniforms.time.value = t;
      renderFrame();
      requestAnimationFrame(tick);
    }

    // ---------------- 캐릭터 미리보기 (꾸미기 화면)
    let pv = null;
    function preview(container, av) {
      if (!pv) {
        const r = new THREE.WebGLRenderer({ antialias: true, alpha: true }); r.outputEncoding = THREE.sRGBEncoding; r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight('#FFE6C4', '#8A7A5E', 0.9));
        const dl = new THREE.DirectionalLight('#FFD8A2', 1.4); dl.position.set(-2, 4, 3); sc.add(dl);
        const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50); cam.position.set(0, 1.35, 5.8); cam.lookAt(0, 1.05, 0);   // 머리(모자·곱슬·묶은 머리 포함)까지 전신이 보이게
        const stand = mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.08, 32), M('#E7D3B4'), 0, -0.04, 0, sc);
        pv = { r, sc, cam, who: null, raf: 0, key: '', stand };
      }
      if (pv.r.domElement.parentNode !== container) container.appendChild(pv.r.domElement);
      const size = Math.min(container.clientWidth || 220, 260); pv.r.setSize(size, size, false); pv.r.domElement.style.width = size + 'px'; pv.r.domElement.style.height = size + 'px';
      const key = JSON.stringify(av);
      if (key !== pv.key) { const rot = pv.who ? pv.who.rotation.y : 0.35; if (pv.who) pv.sc.remove(pv.who); pv.who = person(lookFromAvatar(av), pv.sc); pv.who.scale.setScalar(1.12); pv.who.rotation.y = rot; pv.key = key; }
      if (!pv.raf) {
        const c2 = new THREE.Clock();
        const loop = () => {
          if (!pv.r.domElement.isConnected) { pv.raf = 0; return; }
          const dt = Math.min(c2.getDelta(), 0.05), t = c2.elapsedTime;
          const saved = U.k.value; U.k.value = 0; U.center.value.set(0, 0, 0);
          pv.who.rotation.y = 0.35 + Math.sin(t * 0.6) * 0.6; animatePerson(pv.who, false, t, dt);
          pv.r.render(pv.sc, pv.cam); U.k.value = saved;
          pv.raf = requestAnimationFrame(loop);
        };
        pv.raf = requestAnimationFrame(loop);
      }
    }

    const api = {
      bubbleNpc: null,
      hooks,
      places: () => places,
      enter(m, opt = {}) {
        build();
        U.k.value = BEND_K;
        if (!zzz) { zzz = textSprite('Z z z', { size: 70, color: '#5B7DB1', stroke: '#5B7DB1' }); zzz.visible = false; scene.add(zzz); }
        if (!knock) { knock = textSprite('똑똑!', { stroke: '#B56CC0' }); knock.visible = false; scene.add(knock); }
        if (!waitSpr) { waitSpr = textSprite('이쪽이야!', { stroke: '#B56CC0' }); waitSpr.visible = false; scene.add(waitSpr); }
        setAvatar(opt.avatar);
        mode = m; keys.clear(); tapTarget = null; autoPath = null;
        U.k.value = mode === 'room' ? 0 : BEND_K;   // 실내는 둥근 지평선을 끈다(바닥이 꺼져 보이지 않게)
        if (mode === 'room' || opt.resetView) resetView(true); else { clampView(viewT); notifyView(); }
        const sp = opt.spawn || (opt.spawnPlace && places[opt.spawnPlace]);
        if (sp) {
          player.position.set(sp.x, 0, sp.z);
          // Keep the companion beside the player on every village teleport.
          if (mode === 'village' && dog) {
            dog.position.set(sp.x + 1.1, 0, sp.z + 0.9);
            collide(dog.position, 0.3);
            dogLegs.forEach(l => l.rotation.x = 0);
            if (dogBlob) dogBlob.position.set(dog.position.x, 0.04, dog.position.z);
          }
        }
        player.rotation.y = opt.facing != null ? opt.facing : Math.atan2(-player.position.x, -player.position.z);
        setSeated(player, !!opt.seated); player.userData.sleeping = !!opt.sleeping;
        if (opt.seated) player.rotation.y = Math.PI / 2;
        camFocus.copy(mode === 'room' ? new THREE.Vector3(RX + (player.position.x - RX) * 0.35, 0, RZ + (player.position.z - RZ) * 0.35 + 0.6) : player.position);
        nearTarget = undefined;
        document.body.classList.add('in-world');
        if (!running) { running = true; setGfx(gfxHigh); clock.getDelta(); requestAnimationFrame(tick); }
      },
      leave() { running = false; keys.clear(); document.body.classList.remove('in-world'); },
      isRunning: () => running,
      mode: () => mode,
      wake() { player.userData.sleeping = false; setSeated(player, false); player.position.x += 0.6; player.rotation.y = Math.PI / 4; },
      playerPos: () => ({ x: player.position.x, z: player.position.z }),
      setAvatar,
      setNpcVisible(id, on) { const n = npcObjs.find(x => x.id === id); if (!n) return; n.visible = on; n.obj.visible = on; n.obj.userData.blob.visible = on; n.col.off = !on; },
      guideShow(x, z, facing) { ensureGuide(); guide.visible = true; guide.userData.blob.visible = true; guide.position.set(x, 0, z); if (facing != null) guide.rotation.y = facing; guideState = { path: null }; },
      guideWalk(x, z, done, opt = {}) { ensureGuide(); if (!guide.visible) api.guideShow(x, z); guideState = { path: opt.direct ? [{ x, z }] : route(guide.position, { x, z }), done, speed: opt.speed, knock: opt.knock, lockPlayer: opt.lockPlayer, leash: opt.leash, hello: opt.hello }; },
      guideHello(on) { if (guideState) guideState.hello = on; },
      guideWaiting: () => !!(guideState && guideState.waiting),
      guideKnock(on) { if (guideState) guideState.knock = on; },
      guideHide() { if (guide) { guide.visible = false; guide.userData.blob.visible = false; } guideState = null; },
      guidePos: () => guide && guide.visible ? { x: guide.position.x, z: guide.position.z } : null,
      guideMoving: () => !!(guideState && guideState.path && guideState.path.length && !guideState.waiting),
      autoWalkTo(x, z) { autoPath = route(player.position, { x, z }); tapTarget = null; },
      stopAuto() { autoPath = null; tapTarget = null; },
      isAuto: () => !!(autoPath && autoPath.length),
      setMarker(p) { ensureMarker(); if (!p) { marker.visible = false; return; } marker.visible = true; marker.position.set(p.x, 3.2, p.z); },
      setHomeName(name) { if (!homeSign || !name) return; const tex = signTex(name.length > 5 ? '내 집' : name + '네 집'); homeSign.front.material = M('#FFFFFF', { map: tex }); homeSign.back.material = homeSign.front.material; },
      toggleGfx() { setGfx(!gfxHigh); return gfxHigh; },
      setQuality(high) { setGfx(!!high); return gfxHigh; },
      setBindings(value) { bindings = { ...bindings, ...value }; keys.clear(); },
      pauseInput() { keys.clear(); tapTarget = null; autoPath = null; drag.id = null; },
      mapBase: () => mmBase(),
      npcPositions: () => npcObjs.map(n => ({ id:n.id, x:n.x, z:n.z })),
      attachMinimap,
      minimapInfo: () => mm ? { size: mm.size, span: MAP_SPAN } : null,
      resetView() { resetView(false); },
      viewChanged,
      view: () => ({ yaw: view.yaw, pitch: view.pitch, zoom: view.zoom }),
      gfxHigh: () => gfxHigh,
      preview,
      renderer
    };
    return api;
  }
