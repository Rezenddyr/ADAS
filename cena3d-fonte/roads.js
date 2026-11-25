
/* =====================================================================
   Estradas Kenney com número de faixas
   - Cada peça cresce por inteiro (largura e comprimento) na proporção das faixas por sentido,
     assim continua encaixando nas outras; cada faixa mantém 3,2 m.
   - Linhas tracejadas extras desenhadas por cima, acompanhando reta, curva, rampa e ponte.
   - Eixo de cada peça (em metros, no espaço da peça com 1 faixa por sentido): usado para
     "Seguir a faixa" e para "Emendar na ponta".
   ===================================================================== */
const LANE_W = 3.2;
const KR = (() => {
  const line = (x0, x1, lines) => ({ paths: [{ kind: 'line', x0, x1 }], lines });
  const bend = { paths: [{ kind: 'arc', c: [-0.5, 0.5], r: 0.5 }], lines: true };
  const curve = { paths: [{ kind: 'arc', c: [-1, 1], r: 1.5 }], lines: true };
  const cross = { paths: [{ kind: 'line', x0: -0.5, x1: 0.5 }, { kind: 'lineZ', z0: -0.5, z1: 0.5 }], lines: false };
  const tee = line(-0.5, 0.5, false), full = line(-0.5, 0.5, true);
  return {
    'road-straight': full, 'road-straight-half': line(-0.25, 0.25, true), 'road-bridge': full, 'road-crossing': line(-0.5, 0.5, false),
    'road-driveway-single': full, 'road-driveway-double': full, 'road-slant': full, 'road-slant-high': full, 'road-slant-flat': full, 'road-slant-flat-high': full,
    'road-side': tee, 'road-side-entry': tee, 'road-side-exit': tee, 'road-end': line(-0.1, 0.5, false), 'road-end-round': line(-0.1, 0.5, false),
    'road-bend': bend, 'road-bend-sidewalk': bend, 'road-bend-square': bend, 'road-curve': curve, 'road-curve-pavement': curve,
    'road-crossroad': cross, 'road-crossroad-line': cross, 'road-crossroad-path': cross,
    'road-intersection': tee, 'road-intersection-line': tee, 'road-intersection-path': tee
  };
})();
function kroadOf(info){
  if (!info || info.pack !== 'kenney' || !info.isRoad) return null;
  return KR[info.file.replace(/-barrier(-end|-half)?$/, '')] || null;
}
const lanesPerSide = e => Math.max(1, Math.min(4, Math.round(e?.p?.lanes || 1)));
// eixo da peça no espaço local (metros, antes da escala das faixas)
function kPath(d){
  const S = KENNEY_SCALE, Y = 0.08;
  if (d.kind === 'line') return { L: (d.x1 - d.x0) * S, at: s => ({ p: new V3(d.x0 * S + s, Y, 0), n: new V3(0, 0, -1), t: new V3(1, 0, 0) }) };
  if (d.kind === 'lineZ') return { L: (d.z1 - d.z0) * S, at: s => ({ p: new V3(0, Y, d.z0 * S + s), n: new V3(1, 0, 0), t: new V3(0, 0, 1) }) };
  const R = d.r * S, cx = d.c[0] * S, cz = d.c[1] * S;
  return { L: R * Math.PI / 2, at: s => { const f = -Math.PI / 2 + s / R, t = new V3(-Math.sin(f), 0, Math.cos(f)); return { p: new V3(cx + R * Math.cos(f), Y, cz + R * Math.sin(f)), n: new V3(t.z, 0, -t.x), t }; } };
}
// faixas da peça: n por sentido, cada uma com LANE_W/n no espaço local (vira 3,2 m com a escala n)
function roadSpec(re){
  const d = kroadOf(MODELS[re.model]); if (!d) return null;
  const n = lanesPerSide(re);
  return { paths: d.paths.map(kPath), P: { lanes: 2 * n, lw: LANE_W / n, twoway: 1 }, n };
}
// linhas tracejadas entre as faixas, desenhadas em cima da peça
function addLaneLines(o, info, n){
  const d = kroadOf(info); if (!d || !d.lines || n <= 1) return;
  o.updateMatrixWorld(true);
  const meshes = []; o.traverse(c => { if (c.isMesh) meshes.push(c); });
  const rc = new THREE.Raycaster();
  const hAt = (x, z) => { rc.set(new V3(x, 50, z), new V3(0, -1, 0)); const h = rc.intersectObjects(meshes, false)[0]; return h ? h.point.y : 0.08; };
  const pos = [], w = 0.075 / n;
  for (const pd of d.paths){
    const path = kPath(pd), per = path.L / Math.max(1, Math.round(path.L * n / 9)), dash = per / 3;
    for (let j = 1; j < n; j++) for (const sg of [-1, 1]){
      const off = sg * LANE_W * j / n;
      for (let s = per / 3; s < path.L - 1e-3; s += per){
        const s1 = Math.min(path.L, s + dash), m = Math.max(1, Math.ceil((s1 - s) / 0.5));
        for (let i = 0; i < m; i++){
          const a = path.at(s + (s1 - s) * i / m), b = path.at(s + (s1 - s) * (i + 1) / m);
          const P = (q, o2) => { const x = q.p.x + q.n.x * o2, z = q.p.z + q.n.z * o2; return [x, hAt(x, z) + 0.004, z]; };
          const A = P(a, off - w), B = P(a, off + w), C = P(b, off + w), D = P(b, off - w);
          pos.push(...A, ...B, ...C, ...A, ...C, ...D);
        }
      }
    }
  }
  if (!pos.length) return;
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#ececec', roughness: .9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.receiveShadow = true; m.userData.laneLines = true; o.add(m);
}
const LANE_OPTS = [[1, '2 faixas (1 por sentido)'], [2, '4 faixas (2 por sentido)'], [3, '6 faixas (3 por sentido)'], [4, '8 faixas (4 por sentido)']];

/* ---------- vagas de estacionamento ao lado da reta (como no estacionamento visto de cima) ----------
   park: 0 nenhuma · 1 de um lado · 2 do outro lado · 3 dos dois lados. Vagas a 90°, ~2,6 m x 5,5 m, com calçada no fundo.
   Cores tiradas da textura das próprias peças Kenney, para combinar com a pista. */
const PARK_OPTS = [[0, 'Nenhuma'], [1, 'De um lado'], [2, 'Do outro lado'], [3, 'Dos dois lados']];
const PARK_COL = { asphalt: '#666b80', line: '#e3e7f5', walk: '#bdc6ee', walkSide: '#9da4c4' };
function parkable(info){ return !!info && info.pack === 'kenney' && /^road-straight(-half)?$/.test(info.file); }
function addParking(o, info, e){
  const park = +(e.p?.park || 0); if (!parkable(info) || !park) return;
  const k = lanesPerSide(e), d = kroadOf(info).paths[0], S = KENNEY_SCALE, x0 = d.x0 * S, x1 = d.x1 * S, len = x1 - x0;
  const D = 5.5 / k, z0 = 3.15, zc = 4, z1 = zc + D, top = 0.17, lw = 0.12 / k;
  const M = c => new THREE.MeshStandardMaterial({ color: c, roughness: .95 });
  const mA = M(PARK_COL.asphalt), mW = M(PARK_COL.walk), mWs = M(PARK_COL.walkSide);
  const mL = new THREE.MeshStandardMaterial({ color: PARK_COL.line, roughness: .9, polygonOffset: true, polygonOffsetFactor: -2 });
  const g = new THREE.Group(); g.userData.parking = true;
  const box = (w, h, dz, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, dz), m); b.position.set(x, y, z); b.receiveShadow = true; g.add(b); return b; };
  const flat = (w, dz, x, z) => { const q = new THREE.Mesh(new THREE.PlaneGeometry(w, dz), mL); q.rotation.x = -Math.PI / 2; q.position.set(x, top + 0.004, z); g.add(q); };
  const n = Math.max(1, Math.round(len * k / 2.6)), sp = len / n, cx = (x0 + x1) / 2;
  for (const s of [1, -1]){
    if (!(park === 3 || (park === 1 && s === 1) || (park === 2 && s === -1))) continue;
    box(len, top, z1 - z0, cx, top / 2, s * (z0 + z1) / 2, mA);                                   // piso das vagas
    flat(len, lw, cx, s * (zc + 0.15 / k));                                                       // linha de entrada
    const dl = D - 0.25 / k;
    for (let i = 0; i <= n; i++) flat(lw, dl, x0 + i * sp, s * (zc + 0.15 / k + dl / 2));          // divisórias
    if (e.p?.parkBack ?? 1){
      const wd = 1.8 / k, wh = 0.32;
      box(len, wh, wd, cx, wh / 2, s * (z1 + wd / 2), mW);                                         // calçada no fundo
      box(len, wh * 0.98, 0.05 / k, cx, wh / 2, s * (z1 + 0.025 / k), mWs);                         // face da calçada
    }
  }
  o.add(g);
}
