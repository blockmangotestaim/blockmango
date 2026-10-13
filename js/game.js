/* =====================================================================
   FIST ARENA - game.js
   three.js rendering, touch/keyboard input (tdpad + tpole), HUD, main loop.
   All game rules live in sim.js.
   ===================================================================== */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (typeof THREE === 'undefined') {
    $('menu').innerHTML = '<div class="panel"><h1>three.js did not load</h1><p>Check your connection and reload the page.</p></div>';
    return;
  }
  const C = CONFIG, S = Sim, W = S.world, B = S.B, CT = C.controls, V = C.view, CB = C.combat, PL = C.player;
  const DEG = Math.PI / 180, TICK = 1 / C.tickRate;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrapRad = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const SKY = 0xb9cef7;   // from the reference screenshot

  /* ---------------- three.js setup ---------------- */
  const canvas = $('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(SKY);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY, 28, 75);
  const camera = new THREE.PerspectiveCamera(V.fov, 1, 0.05, 200);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();

  /* ---------------- procedural MCPE-style textures ---------------- */
  function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function makeTex(seed, draw) {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const g = c.getContext('2d'); draw(g, mulberry(seed));
    const t = new THREE.CanvasTexture(c);
    t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    return t;
  }
  const px = (g, x, y, r, gg, b, v, rnd) => { const d = (rnd() - 0.5) * v; g.fillStyle = `rgb(${clamp(r + d, 0, 255) | 0},${clamp(gg + d, 0, 255) | 0},${clamp(b + d, 0, 255) | 0})`; g.fillRect(x, y, 1, 1); };
  const fillNoise = (g, rnd, r, gg, b, v) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(g, x, y, r, gg, b, v, rnd); };
  const tiles = [
    makeTex(1, (g, r) => fillNoise(g, r, 92, 150, 52, 34)),                                  // 0 grass top
    makeTex(2, (g, r) => { fillNoise(g, r, 134, 96, 67, 28); for (let x = 0; x < 16; x++) { const d = 3 + (r() * 2 | 0); for (let y = 0; y < d; y++) px(g, x, y, 92, 150, 52, 34, r); } }), // 1 grass side
    makeTex(3, (g, r) => fillNoise(g, r, 134, 96, 67, 28)),                                  // 2 dirt
    makeTex(4, (g, r) => fillNoise(g, r, 126, 126, 126, 26)),                                // 3 stone
    makeTex(5, (g, r) => { fillNoise(g, r, 160, 130, 78, 14); g.fillStyle = 'rgba(70,50,20,.55)'; for (let y = 3; y < 16; y += 4) g.fillRect(0, y, 16, 1); for (let y = 0; y < 16; y += 4) g.fillRect((y * 5) % 16, y, 1, 4); }), // 4 planks
    makeTex(6, (g, r) => { fillNoise(g, r, 112, 112, 112, 34); g.fillStyle = 'rgba(40,40,40,.6)'; for (let y = 0; y < 16; y += 5) g.fillRect(0, y, 16, 1); for (let y = 0; y < 16; y += 5) for (let x = (y / 5 % 2) * 4 + 2; x < 16; x += 8) g.fillRect(x, y, 1, 5); }), // 5 cobble
  ];
  // Custom texture overrides: tile index -> { url, smooth }. The procedural tile above is used until the image loads
  // (or forever if it fails). smooth = mipmapped + linear filtering for painted textures; false keeps hard pixels.
  const TEXTURE_FILES = {
    0: { url: 'assets/grass_top.png', smooth: true },
    1: { url: 'assets/grass_side.png', smooth: true },
    2: { url: 'assets/dirt.png', smooth: true },
    5: { url: 'assets/cobble.png', smooth: false },
  };
  let groundTex = null;
  function useImage(t, img, smooth) {
    t.image = img;
    t.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
    t.minFilter = smooth ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
    t.generateMipmaps = smooth; t.anisotropy = smooth ? 4 : 1; t.needsUpdate = true;
  }
  Object.entries(TEXTURE_FILES).forEach(([i, f]) => {
    const img = new Image();
    img.onload = () => { useImage(tiles[i], img, f.smooth); if (+i === 0 && groundTex) useImage(groundTex, img, f.smooth); };
    img.src = f.url;
  });
  const FACES = [
    { d: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], s: 0.8 },
    { d: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], s: 0.8 },
    { d: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], s: 1.0 },
    { d: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], s: 0.5 },
    { d: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], s: 0.6 },
    { d: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], s: 0.6 },
  ];
  const UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const faceTile = (b, f) => b === B.GRASS ? (f === 2 ? 0 : f === 3 ? 2 : 1) : b === B.DIRT ? 2 : b === B.STONE ? 3 : b === B.PLANKS ? 4 : 5;

  const GROUND_SIZE = 400; let worldGroup = null, ground = null;
  function buildWorld() {
    if (ground) scene.remove(ground);
    if (worldGroup) { scene.remove(worldGroup); worldGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    worldGroup = new THREE.Group();
    const bk = tiles.map(() => ({ p: [], n: [], u: [], c: [], i: [], v: 0 }));
    for (let y = 0; y < W.WY; y++) for (let z = 0; z < W.WZ; z++) for (let x = 0; x < W.WX; x++) {
      const b = W.getBlock(x, y, z); if (!b || y === 0) continue;   // floor (y=0) is the infinite ground plane
      for (let f = 0; f < 6; f++) {
        const F = FACES[f];
        if (W.getBlock(x + F.d[0], y + F.d[1], z + F.d[2])) continue;
        const k = bk[faceTile(b, f)];
        for (let q = 0; q < 4; q++) { const c = F.c[q]; k.p.push(x + c[0], y + c[1], z + c[2]); k.n.push(...F.d); k.u.push(...UV[q]); k.c.push(F.s, F.s, F.s); }
        k.i.push(k.v, k.v + 1, k.v + 2, k.v, k.v + 2, k.v + 3); k.v += 4;
      }
    }
    bk.forEach((k, t) => {
      if (!k.v) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(k.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(k.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(k.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(k.c, 3));
      g.setIndex(k.i);
      worldGroup.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tiles[t], vertexColors: true })));
    });
    // endless floor: a big repeating plane that follows the player in whole-block steps so the tiling never shifts
    groundTex = tiles[0].clone(); groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping; groundTex.repeat.set(GROUND_SIZE, GROUND_SIZE); groundTex.needsUpdate = true;
    ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), new THREE.MeshBasicMaterial({ map: groundTex, color: 0xdcdcdc }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = 1;
    scene.add(ground);
    scene.add(worldGroup);
  }

  /* ---------------- humanoid model (Steve proportions, 32px = 1.8 blocks) ---------------- */
  const SHADE = [0.8, 0.8, 1.0, 0.5, 0.6, 0.6];
  function faceTex(skin, hair) {
    const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d');
    g.fillStyle = skin; g.fillRect(0, 0, 8, 8); g.fillStyle = hair; g.fillRect(0, 0, 8, 2); g.fillRect(0, 2, 1, 1); g.fillRect(7, 2, 1, 1);
    g.fillStyle = '#fff'; g.fillRect(1, 4, 2, 1); g.fillRect(5, 4, 2, 1);
    g.fillStyle = '#3a2f8f'; g.fillRect(2, 4, 1, 1); g.fillRect(5, 4, 1, 1);
    g.fillStyle = '#8a4b3a'; g.fillRect(3, 6, 2, 1);
    const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; return t;
  }
  function boxMats(colors, tint, frontMap) {
    return SHADE.map((s, i) => {
      const useMap = frontMap && i === 5;
      const base = new THREE.Color(useMap ? 0xffffff : (Array.isArray(colors) ? colors[i] : colors)).multiplyScalar(s);
      const m = new THREE.MeshBasicMaterial({ color: base.clone(), map: useMap ? frontMap : null });
      if (tint) tint.push({ m, base }); return m;
    });
  }
  function makeHumanoid(o) {
    const s = 1.8 / 32, tint = [], g = new THREE.Group(); g.rotation.order = 'YXZ';
    const box = (w, h, d, mats, ox, oy, oz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w * s, h * s, d * s), mats); m.position.set(ox * s, oy * s, oz * s); return m; };
    g.add(box(8, 12, 4, boxMats(o.shirt, tint), 0, 18, 0));
    const head = new THREE.Group(); head.position.set(0, 24 * s, 0);
    const hc = [o.skin, o.skin, o.hair, o.skin, o.hair, o.skin];
    head.add(box(8, 8, 8, boxMats(hc, tint, faceTex('#' + new THREE.Color(o.skin).getHexString(), '#' + new THREE.Color(o.hair).getHexString())), 0, 4, 0)); g.add(head);
    const limb = (mats, x, y) => { const piv = new THREE.Group(); piv.position.set(x * s, y * s, 0); piv.add(box(4, 12, 4, mats, 0, -6, 0)); g.add(piv); return piv; };
    const armL = limb(boxMats(o.skin, tint), -6, 24), armR = limb(boxMats(o.skin, tint), 6, 24);
    const legL = limb(boxMats(o.pants, tint), -2, 12), legR = limb(boxMats(o.pants, tint), 2, 12);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; scene.add(shadow); scene.add(g);
    return { group: g, head, armL, armR, legL, legR, tint, shadow, tinted: false };
  }
  function setTint(m, on) {
    if (m.tinted === on) return; m.tinted = on;
    if (m.mats) { m.mats.forEach(x => x.emissive.setHex(on ? 0x8a1818 : 0x000000)); return; }
    const red = new THREE.Color(0xff3030);
    m.tint.forEach(t => t.m.color.copy(t.base).lerp(red, on ? 0.55 : 0));
  }
  function updateModel(e, m, alpha) {
    const x = lerp(e.px, e.x, alpha), y = lerp(e.py, e.y, alpha), z = lerp(e.pz, e.z, alpha);
    m.group.position.set(x, y, z);
    m.group.rotation.y = e.pyaw + wrapRad(e.yaw - e.pyaw) * alpha;
    const dp = e.alive ? Math.min(1, (e.deathTicks + alpha) / 10) : 0;
    m.group.rotation.z = e.alive ? 0 : dp * Math.PI / 2;
    if (!e.alive) m.group.position.y += 0.2 * dp;
    const sg = m.sign || 1;
    m.head.rotation.x = lerp(e.ppitch, e.pitch, alpha) * sg;
    const amp = lerp(e.plimbAmp, e.limbAmp, alpha), ph = lerp(e.plimbPhase, e.limbPhase, alpha);
    const swingA = Math.cos(ph * 0.6662) * 1.4 * amp;
    m.armL.rotation.x = swingA * sg; m.legR.rotation.x = swingA * 0.7 * sg;
    m.armR.rotation.x = -swingA * sg; m.legL.rotation.x = -swingA * 0.7 * sg;
    if (e.swing > 0) { const p = clamp((CB.swingTicks - e.swing + alpha) / CB.swingTicks, 0, 1); m.armR.rotation.x = Math.sin(p * Math.PI) * 1.9 * sg; }
    setTint(m, e.hurtTime > 0 && e.alive);
    m.shadow.position.set(x, W.surfaceY(x, z) + 0.02, z);
    m.shadow.visible = e.alive;
  }

  /* ---------------- GLB bot model (static meshes, rigged by hand: pivots at shoulders/hips/neck) ---------------- */
  const MODEL_UNITS_TALL = 17.96;                       // model height (head top) in its own units -> scaled to 1.8 blocks
  function makeGltfHumanoid(gltf) {
    const root = gltf.scene; root.updateMatrixWorld(true);
    const nm = n => THREE.PropertyBinding.sanitizeNodeName(n);
    const rig = new THREE.Group(), mats = [];
    const part = (names, px, py, pz) => {
      const pv = new THREE.Group(); pv.position.set(px, py, pz); rig.add(pv);
      names.forEach(n => { const o = root.getObjectByName(nm(n)); if (o) pv.attach(o); });
      return pv;
    };
    // model faces +Z and its +X is our -X after the 180deg flip below, so "R" parts are the model's -X side
    part(['clothes_pants.1'], 0, 0, 0);
    const head = part(['custom_face.1'], 0.03, 12.8, 0);
    const armR = part(['clothes_tops.002'], -3.05, 13.2, 0), armL = part(['clothes_tops.003'], 3.05, 13.2, 0);
    const legR = part(['clothes_pants.003'], -1.12, 6.83, 0), legL = part(['clothes_pants.002'], 1.12, 6.83, 0);
    rig.traverse(o => {
      if (!o.isMesh) return;
      const old = o.material, m = new THREE.MeshLambertMaterial({ map: old.map, side: THREE.DoubleSide, alphaTest: 0.5 });
      if (m.map) { m.map.encoding = THREE.LinearEncoding; m.map.magFilter = THREE.NearestFilter; m.map.needsUpdate = true; }
      o.material = m; mats.push(m);
    });
    const s = 1.8 / MODEL_UNITS_TALL;
    rig.scale.setScalar(s); rig.rotation.y = Math.PI;
    const g = new THREE.Group(); g.rotation.order = 'YXZ'; g.add(rig);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; scene.add(shadow); scene.add(g);
    return { group: g, head, armL, armR, legL, legR, mats, tint: [], shadow, tinted: false, sign: -1 };
  }
  scene.add(new THREE.AmbientLight(0xffffff, 0.72)); const sun = new THREE.DirectionalLight(0xffffff, 0.42); sun.position.set(0.4, 1, 0.8); scene.add(sun);
  // Minimal GLB reader (static meshes + embedded PNG textures). Uses only atob + <img data:> so it works under strict CSP / sandboxed previews.
  function parseGlb(buf) {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('not a GLB');
    let off = 12, json = null, bin = null;
    while (off + 8 <= buf.byteLength) {
      const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true), data = buf.slice(off + 8, off + 8 + len);
      if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(data)); else if (type === 0x004E4942) bin = data;
      off += 8 + len;
    }
    const readAcc = i => {
      const a = json.accessors[i], bv = json.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
      const CT = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array }[a.componentType], es = CT.BYTES_PER_ELEMENT;
      const base = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || n * es;
      if (stride === n * es) return new CT(bin.slice(base, base + a.count * n * es));
      const out = new CT(a.count * n), src = new DataView(bin);
      for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) { const p = base + k * stride + c * es; out[k * n + c] = es === 4 ? (a.componentType === 5126 ? src.getFloat32(p, true) : src.getUint32(p, true)) : es === 2 ? src.getUint16(p, true) : src.getUint8(p); }
      return out;
    };
    const imgs = (json.images || []).map(im => new Promise((res, rej) => {
      const bv = json.bufferViews[im.bufferView], bytes = new Uint8Array(bin, bv.byteOffset || 0, bv.byteLength);
      let s = ''; for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
      const el = new Image(); el.onload = () => res(el); el.onerror = rej; el.src = 'data:' + (im.mimeType || 'image/png') + ';base64,' + btoa(s);
    }));
    return Promise.all(imgs).then(elements => {
      const wrap = w => w === 33071 ? THREE.ClampToEdgeWrapping : w === 33648 ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
      const texs = (json.textures || []).map(t => {
        const tx = new THREE.Texture(elements[t.source]), sm = (json.samplers || [])[t.sampler || 0] || {};
        tx.flipY = false; tx.wrapS = wrap(sm.wrapS); tx.wrapT = wrap(sm.wrapT); tx.needsUpdate = true; return tx;
      });
      const mats = (json.materials || []).map(m => { const bc = m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture; return new THREE.MeshBasicMaterial({ map: bc ? texs[bc.index] : null, side: THREE.DoubleSide }); });
      const objs = json.nodes.map(n => {
        const o = new THREE.Group(); o.name = THREE.PropertyBinding.sanitizeNodeName(n.name || '');
        if (n.matrix) { o.matrix.fromArray(n.matrix); o.matrix.decompose(o.position, o.quaternion, o.scale); }
        if (n.mesh !== undefined) json.meshes[n.mesh].primitives.forEach(p => {
          const geo = new THREE.BufferGeometry(), at = p.attributes;
          geo.setAttribute('position', new THREE.BufferAttribute(readAcc(at.POSITION), 3));
          if (at.NORMAL !== undefined) geo.setAttribute('normal', new THREE.BufferAttribute(readAcc(at.NORMAL), 3)); else geo.computeVertexNormals();
          if (at.TEXCOORD_0 !== undefined) geo.setAttribute('uv', new THREE.BufferAttribute(readAcc(at.TEXCOORD_0), 2));
          if (p.indices !== undefined) geo.setIndex(new THREE.BufferAttribute(readAcc(p.indices), 1));
          o.add(new THREE.Mesh(geo, mats[p.material]));
        });
        return o;
      });
      json.nodes.forEach((n, i) => (n.children || []).forEach(c => objs[i].add(objs[c])));
      const scene = new THREE.Group(); (json.scenes[json.scene || 0].nodes || []).forEach(i => scene.add(objs[i]));
      return { scene };
    });
  }
  function loadBotModel() {
    if (typeof BOT_GLB_B64 === 'undefined') { console.warn('Bot model data missing, using the built-in blocky bot.'); return; }
    try {
      const bin = atob(BOT_GLB_B64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      parseGlb(u8.buffer).then(gltf => {
        const m = makeGltfHumanoid(gltf);
        if (botModel) { scene.remove(botModel.group); scene.remove(botModel.shadow); }
        botModel = m;
      }).catch(err => console.warn('Bot model failed to load, using the built-in blocky bot.', err));
    } catch (err) { console.warn('Bot model failed to load, using the built-in blocky bot.', err); }
  }

  let botModel = null;
  function buildEntities() {
    if (botModel) { scene.remove(botModel.group); scene.remove(botModel.shadow); }
    botModel = makeHumanoid({ skin: 0xc58c6b, hair: 0x2a1a10, shirt: 0xb83a3a, pants: 0x3a3a6a });   // fallback until the GLB loads
    loadBotModel();
  }

  /* first-person fist */
  const hand = new THREE.Group();
  (() => {
    const skinM = boxMats(0xc58c6b), sleeveM = boxMats(0x2aa6b0);
    [...skinM, ...sleeveM].forEach(m => { m.depthTest = false; m.fog = false; });
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.42), skinM); fist.renderOrder = 999;
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.26), sleeveM); sleeve.position.z = 0.3; sleeve.renderOrder = 999;
    hand.add(fist, sleeve); camera.add(hand);
  })();

  /* ---------------- audio (tiny synthesized sfx) ---------------- */
  let actx = null, noiseBuf = null;
  function initAudio() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      if (!noiseBuf) { noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.15, actx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    } catch (e) { actx = null; }
  }
  function sfx(kind) {
    if (!actx) return; const t = actx.currentTime, g = actx.createGain(); g.connect(actx.destination);
    if (kind === 'hit' || kind === 'crit') {
      const s = actx.createBufferSource(); s.buffer = noiseBuf; const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = kind === 'crit' ? 1500 : 800;
      s.connect(f); f.connect(g); g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1); s.start(t); s.stop(t + 0.12);
    } else {
      const o = actx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(kind === 'death' ? 160 : 230, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.2);
      o.connect(g); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22); o.start(t); o.stop(t + 0.24);
    }
  }
  S.events.onHit = (a, t, d, crit) => sfx(crit ? 'crit' : 'hit');
  S.events.onHurt = (t) => { if (t === S.player) sfx('hurt'); };
  S.events.onDeath = (e) => { sfx('death'); if (e === S.player) { $('death').classList.remove('hidden'); } updateScore(); };
  S.events.onRespawn = (e) => { if (e === S.player) { $('death').classList.add('hidden'); eyeH = PL.eyeHeight; } };

  /* ---------------- HUD ---------------- */
  const hpFill = $('hpfill'), hpText = $('hptext'); let lastHP = -1;
  function updateHearts() {   // HP bar: fill width + "hp/max" text
    const hp = Math.ceil(S.player.health); if (hp === lastHP) return; lastHP = hp;
    hpFill.style.width = (S.player.health / PL.maxHealth * 100) + '%'; hpText.textContent = hp + '/' + PL.maxHealth;
  }
  function updateScore() { $('score').textContent = `You ${S.score.player}  :  ${S.score.bot} Bot`; }

  /* ---------------- settings (saved in the browser) ---------------- */
  const settings = { sens: 1 };
  try { Object.assign(settings, JSON.parse(localStorage.getItem('fa_settings') || '{}')); } catch (e) { }
  const saveSettings = () => { try { localStorage.setItem('fa_settings', JSON.stringify(settings)); } catch (e) { } };
  const ringEl = $('ring');
  function applySettings() {
    $('sens').value = Math.round(settings.sens * 100); $('sensVal').textContent = Math.round(settings.sens * 100) + '%';
    ringEl.style.setProperty('--ringvh', CT.ringDiameterVh);
  }
  $('sens').addEventListener('input', e => { settings.sens = e.target.value / 100; applySettings(); saveSettings(); });

  /* ---------------- input ---------------- */
  let mode = C.defaultMode;
  try { mode = localStorage.getItem('fa_mode') || mode; } catch (e) { }
  const ctrl = { padF: 0, padS: 0, jump: false, sneak: false, autoSprint: false, sprintLock: 0 };
  const keys = new Set(); let kbSprint = false, lastW = 0;
  let running = false, locked = false, wasLocked = false;
  // Tap = attack whatever is under that screen point (MCPE touch). No point = view centre (desktop mouse).
  function screenRay(cx, cy) {
    const p = S.player, t = Math.tan(camera.fov * DEG / 2), nx = (cx / window.innerWidth) * 2 - 1, ny = 1 - (cy / window.innerHeight) * 2;
    const lx = nx * t * camera.aspect, ly = ny * t, sp = Math.sin(p.pitch), cp = Math.cos(p.pitch);
    const y1 = ly * cp + sp, z1 = ly * sp - cp;            // pitch
    const sy = Math.sin(p.yaw), cy_ = Math.cos(p.yaw);
    const x2 = lx * cy_ + z1 * sy, z2 = -lx * sy + z1 * cy_; // yaw
    const l = Math.hypot(x2, y1, z2); return { x: x2 / l, y: y1 / l, z: z2 / l };
  }
  const queueAttack = (cx, cy) => {
    if (!running || !S.player.alive) return;
    S.player.aimDir = (cx === undefined) ? null : screenRay(cx, cy);
    S.player.wantAttack = true;
  };
  const showRing = (x, y) => { ringEl.style.transform = `translate(${x}px,${y}px)`; ringEl.classList.add('on'); };
  const hideRing = () => ringEl.classList.remove('on');

  const padEl = $('pad'), orb = $('orb');
  const arrows = { up: padEl.querySelector('.up'), down: padEl.querySelector('.down'), left: padEl.querySelector('.left'), right: padEl.querySelector('.right') };
  let padPtr = null, padT0 = 0, padFar = false, lastFwdPress = 0, prevFwd = false;
  const DPAD = [{ f: 0, s: 1 }, { f: -1, s: 1 }, { f: -1, s: 0 }, { f: -1, s: -1 }, { f: 0, s: -1 }, { f: 1, s: -1 }, { f: 1, s: 0 }, { f: 1, s: 1 }];

  function padUpdate(cx_, cy_) {
    const r = padEl.getBoundingClientRect(), R = r.width / 2, cx = r.left + R, cy = r.top + R;
    const dx = cx_ - cx, dy = cy_ - cy, mag = Math.hypot(dx, dy);
    let f = 0, s = 0, ox = 0, oy = 0, tilt = 0;
    if (mode === 'tpole') {
      const reach = R * CT.poleReach; let nx = dx / reach, ny = dy / reach, m = Math.hypot(nx, ny);
      if (m > 1) { nx /= m; ny /= m; m = 1; }
      if (m > CT.deadZone) { const k = CT.poleAnalogSpeed ? ((m - CT.deadZone) / (1 - CT.deadZone)) / m : 1 / m; s = nx * k; f = -ny * k; tilt = m; }
      ox = nx * R * 0.42; oy = ny * R * 0.42;
    } else if (mag > R * CT.dpadCenterRadius) {
      const ang = Math.atan2(dy, dx) / DEG, i = ((Math.round(ang / 45) % 8) + 8) % 8;
      f = DPAD[i].f; s = DPAD[i].s; tilt = 1;
    }
    if (mag > R * 0.3) padFar = true;
    ctrl.padF = f; ctrl.padS = s;
    ctrl.autoSprint = tilt >= (mode === 'tpole' ? CT.sprintMinTilt : 1) && S.inSprintCone(f, s);   // straight forward = sprint, angled = walk
    orb.style.transform = `translate(${ox}px,${oy}px)`;
    arrows.up.classList.toggle('on', f > 0.3); arrows.down.classList.toggle('on', f < -0.3);
    arrows.left.classList.toggle('on', s < -0.3); arrows.right.classList.toggle('on', s > 0.3);
  }
  function padEnd() {
    if (padPtr === null) return;
    if (!padFar && performance.now() - padT0 < CT.tapMaxMs) { ctrl.sneak = !ctrl.sneak; orb.classList.toggle('sneak', ctrl.sneak); }
    padPtr = null; ctrl.padF = ctrl.padS = 0; ctrl.autoSprint = false;
    orb.style.transform = ''; padEl.classList.remove('active');
    Object.values(arrows).forEach(a => a.classList.remove('on'));
  }
  padEl.addEventListener('pointerdown', e => {
    if (padPtr !== null) return; padPtr = e.pointerId; padEl.setPointerCapture(e.pointerId);
    padT0 = performance.now(); padFar = false; padEl.classList.add('active'); padUpdate(e.clientX, e.clientY); e.preventDefault();
  });
  padEl.addEventListener('pointermove', e => { if (e.pointerId === padPtr) padUpdate(e.clientX, e.clientY); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => padEl.addEventListener(t, e => { if (e.pointerId === padPtr) padEnd(); }));

  const jumpEl = $('jump'); let jumpPtr = null;
  jumpEl.addEventListener('pointerdown', e => { jumpPtr = e.pointerId; jumpEl.setPointerCapture(e.pointerId); ctrl.jump = true; jumpEl.classList.add('active'); e.preventDefault(); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => jumpEl.addEventListener(t, e => { if (e.pointerId === jumpPtr) { jumpPtr = null; ctrl.jump = false; jumpEl.classList.remove('active'); } }));

  // look (swipe) + tap/hold to attack
  const lookEl = $('look'), lookPtrs = new Map();
  const look = (dx, dy, sens) => {
    sens *= settings.sens;
    const p = S.player; if (!running || !p.alive) return;
    p.yaw -= dx * sens * DEG; p.pitch = clamp(p.pitch - dy * sens * DEG, -Math.PI / 2, Math.PI / 2);
  };
  lookEl.addEventListener('pointerdown', e => {
    if (!running) return;
    if (e.pointerType === 'mouse') { if (!document.pointerLockElement && lookEl.requestPointerLock) lookEl.requestPointerLock(); return; }
    lookEl.setPointerCapture(e.pointerId); const t = performance.now();
    showRing(e.clientX, e.clientY);
    lookPtrs.set(e.pointerId, { sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, t0: t, moved: false, lastAtk: t });
    e.preventDefault();
  });
  lookEl.addEventListener('pointermove', e => {
    const p = lookPtrs.get(e.pointerId); if (!p) return;
    look(e.clientX - p.lx, e.clientY - p.ly, CT.touchLookSens); p.lx = e.clientX; p.ly = e.clientY; showRing(p.lx, p.ly);
    if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > CT.tapMaxMove) p.moved = true;
  });
  const lookEnd = e => {
    const p = lookPtrs.get(e.pointerId); if (!p) return; lookPtrs.delete(e.pointerId);
    if (!lookPtrs.size) hideRing();
    if (e.type === 'pointerup' && !p.moved && performance.now() - p.t0 < CT.tapMaxMs) queueAttack(p.lx, p.ly);
  };
  ['pointerup', 'pointercancel'].forEach(t => lookEl.addEventListener(t, lookEnd));

  let mouseHeld = false, mouseLast = 0;
  document.addEventListener('mousemove', e => { if (document.pointerLockElement) look(e.movementX, e.movementY, CT.mouseLookSens); });
  document.addEventListener('mousedown', e => { if (document.pointerLockElement && e.button === 0) { queueAttack(); mouseHeld = true; mouseLast = performance.now(); showRing(window.innerWidth / 2, window.innerHeight / 2); } });
  document.addEventListener('mouseup', () => { mouseHeld = false; hideRing(); });
  document.addEventListener('pointerlockchange', () => {
    locked = !!document.pointerLockElement;
    if (!locked && wasLocked && running) openMenu('Paused');
    wasLocked = locked;
  });
  document.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('keydown', e => {
    if (e.repeat) return; keys.add(e.code);
    if (e.code === 'KeyW' || e.code === 'ArrowUp') { const n = performance.now(); if (n - lastW < CT.doubleTapMs) kbSprint = true; lastW = n; }
    if (e.code === 'F3') { e.preventDefault(); toggleDebug(); }
    if (e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'KeyW' || e.code === 'ArrowUp') kbSprint = false; });
  window.addEventListener('blur', () => { keys.clear(); kbSprint = false; padEnd(); ctrl.jump = false; });

  function readControls() {
    const p = S.player; if (!p.alive) { p.input.f = p.input.s = 0; p.input.jump = false; return; }
    let f = ctrl.padF, s = ctrl.padS;
    if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1; if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1; if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
    p.input.f = clamp(f, -1, 1); p.input.s = clamp(s, -1, 1);
    p.input.jump = ctrl.jump || keys.has('Space');
    p.sneaking = ctrl.sneak || keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (p.sprintCancel) { p.sprintCancel = false; ctrl.sprintLock = CB.resprintTicks; kbSprint = false; }
    let ws = ctrl.autoSprint || kbSprint || keys.has('ControlLeft');
    if (ctrl.sprintLock > 0) { ctrl.sprintLock--; ws = false; }
    p.wantSprint = ws;
  }
  function holdAttacks(now) {
    for (const p of lookPtrs.values()) if (!p.moved && now - p.t0 > CT.holdAttackMs && now - p.lastAtk > CT.holdRepeatMs) { queueAttack(p.lx, p.ly); p.lastAtk = now; }
    if (mouseHeld && now - mouseLast > CT.holdRepeatMs + 100) { queueAttack(); mouseLast = now; }
  }

  /* ---------------- menu ---------------- */
  const menu = $('menu');
  const MODE_DESC = {
    tdpad: 'Arrow pad, 8 fixed directions. Up = sprint. Diagonals and sides = walk. The bot plays this style too: mostly sprinting.',
    tpole: 'Analog pole. Drag the teal knob. Straight forward = sprint, any angle = walk. The bot plays this style too: mostly walking.',
  };
  function setMode(m) {
    mode = m; try { localStorage.setItem('fa_mode', m); } catch (e) { }
    padEl.dataset.mode = m; S.botStyle = m;
    document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('sel', b.dataset.mode === m));
    $('modeDesc').textContent = MODE_DESC[m]; padEnd();
  }
  document.querySelectorAll('#modeSeg button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  function openMenu(title) {
    running = false; padEnd(); ctrl.jump = false; lookPtrs.clear(); mouseHeld = false; hideRing();
    $('menuTitle').textContent = title === 'Paused' ? 'Paused' : 'Fist Arena';
    $('playBtn').textContent = title === 'Paused' ? 'Resume' : 'Play';
    menu.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function startGame() {
    initAudio(); menu.classList.add('hidden'); running = true; last = performance.now();
    const de = document.documentElement;
    try { if (de.requestFullscreen && !document.fullscreenElement) de.requestFullscreen().catch(() => { }); } catch (e) { }
    try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => { }); } catch (e) { }
    if (!matchMedia('(pointer:coarse)').matches && lookEl.requestPointerLock) { try { lookEl.requestPointerLock(); } catch (e) { } }
  }
  $('playBtn').addEventListener('click', startGame);
  $('pauseBtn').addEventListener('click', () => openMenu('Paused'));
  $('resetBtn').addEventListener('click', () => { S.score.player = S.score.bot = 0; updateScore(); });
  let debugOn = false;
  function toggleDebug() { debugOn = !debugOn; $('debug').classList.toggle('hidden', !debugOn); $('dbgBtn').textContent = 'Debug: ' + (debugOn ? 'on' : 'off'); }
  $('dbgBtn').addEventListener('click', toggleDebug);
  if (matchMedia('(pointer:coarse)').matches) $('kbHint').classList.add('hidden');

  /* ---------------- main loop ---------------- */
  let acc = 0, last = performance.now(), eyeH = PL.eyeHeight, fovCur = V.fov, dbgT = 0, fps = 60;
  function render(alpha, dt) {
    const p = S.player;
    updateModel(S.bot, botModel, alpha);

    eyeH += ((p.alive ? (p.sneaking ? PL.sneakEyeHeight : PL.eyeHeight) : 0.3) - eyeH) * Math.min(1, dt * (p.alive ? 14 : 3));
    const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha), z = lerp(p.pz, p.z, alpha);
    let bobX = 0, bobY = 0, bobRoll = 0, bobPitch = 0;
    if (V.viewBob && p.alive) {
      const f2 = lerp(p.pcamYaw, p.camYaw, alpha), f1 = -lerp(p.pwalkMod, p.walkMod, alpha);
      bobX = Math.sin(f1 * Math.PI) * f2 * 0.5; bobY = -Math.abs(Math.cos(f1 * Math.PI) * f2);
      bobRoll = Math.sin(f1 * Math.PI) * f2 * 3 * DEG; bobPitch = Math.abs(Math.cos(f1 * Math.PI - 0.2) * f2) * 5 * DEG;
    }
    let roll = bobRoll;
    if (p.hurtTime > 0 && p.alive) { const t = clamp((p.hurtTime - alpha) / 10, 0, 1); roll -= Math.sin(t * t * t * t * Math.PI) * 14 * DEG; }
    if (!p.alive) roll += Math.min(1, (p.deathTicks + alpha) / 10) * 70 * DEG;
    ground.position.x = Math.round(x); ground.position.z = Math.round(z);
    camera.position.set(x + Math.cos(p.yaw) * bobX, y + eyeH + bobY, z - Math.sin(p.yaw) * bobX);
    camera.rotation.set(p.pitch + bobPitch, p.yaw, roll);
    const fovT = V.fov * (p.sprinting ? V.sprintFovMul : 1); fovCur += (fovT - fovCur) * Math.min(1, dt * 8);
    if (Math.abs(camera.fov - fovCur) > 0.01) { camera.fov = fovCur; camera.updateProjectionMatrix(); }

    const sw = p.swing > 0 ? clamp((CB.swingTicks - p.swing + alpha) / CB.swingTicks, 0, 1) : 0, sp = Math.sin(sw * Math.PI);
    hand.visible = p.alive;
    hand.position.set(0.34 + bobX * 2 - sp * 0.14, -0.3 + bobY * 2 - sp * 0.06, -0.42 - sp * 0.3);
    hand.rotation.set(-0.12 - sp * 0.5, 0.28 + sp * 0.2, 0);

    $('hurt').style.opacity = p.hurtTime > 0 && p.alive ? clamp((p.hurtTime - alpha) / 10, 0, 1) * 0.45 : 0;
    renderer.render(scene, camera);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.25); last = now;
    fps += (1 / Math.max(dt, 0.001) - fps) * 0.05;
    if (running) {
      holdAttacks(now); acc += dt;
      while (acc >= TICK) { readControls(); S.step(); acc -= TICK; updateHearts(); updateScore(); }
      const p = S.player;
      $('death').querySelector('span').textContent = `Respawning in ${Math.max(1, Math.ceil(p.deathTimer / C.tickRate))}`;
    }
    render(running ? acc / TICK : 1, dt);
    if (debugOn && now - dbgT > 150) {
      dbgT = now; const p = S.player;
      $('debug').textContent = `mode ${mode}  fps ${fps | 0}\nxyz ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}\nspeed ${(Math.hypot(p.x - p.px, p.z - p.pz) * 20).toFixed(2)} b/s  vy ${p.vy.toFixed(3)}\nground ${p.onGround ? 1 : 0} sprint ${p.sprinting ? 1 : 0} sneak ${p.sneaking ? 1 : 0}\nhp ${p.health}  bot hp ${S.bot.health}\ninput f ${p.input.f.toFixed(2)} s ${p.input.s.toFixed(2)}`;
    }
  }

  /* ---------------- boot ---------------- */
  S.reset(); S.botStyle = mode; buildWorld(); buildEntities(); setMode(mode); applySettings(); updateHearts(); updateScore();
  openMenu('Fist Arena');
  requestAnimationFrame(frame);
  window.__FA = { Sim: S, CONFIG: C, camera, hand };   // handy from the browser console while tuning
})();
