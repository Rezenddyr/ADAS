
/* =====================================================================
   Modelos procedurais (low poly): pessoas, natureza, placas, marcações e efeitos ADAS
   ===================================================================== */
const STD = (c, extra) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: .85, ...extra });
const mesh = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; return m; };
function fxMat(color, op){
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, vertexColors: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}
function geoFrom(pos, alpha){
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const col = []; for (const a of alpha) col.push(1, 1, 1, a);
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  return g;
}
// faixa em arco no chão (ângulo medido a partir de +Z, para +X)
function arcGeo(r0, r1, a0, a1, segs, al0 = 1, al1 = 1){
  const pos = [], al = [], P = (r, a) => [Math.sin(a) * r, 0, Math.cos(a) * r];
  for (let i = 0; i < segs; i++){
    const t0 = a0 + (a1 - a0) * i / segs, t1 = a0 + (a1 - a0) * (i + 1) / segs;
    const A = P(r0, t0), B = P(r1, t0), C = P(r1, t1), D = P(r0, t1);
    pos.push(...A, ...B, ...C, ...A, ...C, ...D); al.push(al0, al1, al1, al0, al1, al0);
  }
  return geoFrom(pos, al);
}
// setor com degradê do centro para a borda
function sectorGeo(range, half, alphas = [0.95, 0.55, 0.06]){
  const n = alphas.length - 1, segs = Math.max(8, Math.round(half * 24)), pos = [], al = [];
  for (let k = 0; k < n; k++){
    const g = arcGeo(range * k / n, range * (k + 1) / n, -half, half, segs, alphas[k], alphas[k + 1]);
    pos.push(...g.attributes.position.array);
    const c = g.attributes.color.array; for (let i = 3; i < c.length; i += 4) al.push(c[i]);
  }
  return geoFrom(pos, al);
}
// retângulo no chão (z0 -> z1), com alfa diferente em cada ponta
function rectGeo(x0, x1, z0, z1, a0 = 1, a1 = 1){
  return geoFrom([x0,0,z0, x1,0,z0, x1,0,z1, x0,0,z0, x1,0,z1, x0,0,z1], [a0, a0, a1, a0, a1, a1]);
}
function lineMat(color, op = .85){ return new THREE.LineBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false }); }
function arcLine(r, half, segs = 32, y = 0.06){
  const pts = []; for (let i = 0; i <= segs; i++){ const a = -half + 2 * half * i / segs; pts.push(new V3(Math.sin(a) * r, y, Math.cos(a) * r)); }
  return new THREE.BufferGeometry().setFromPoints(pts);
}
/* texto e placas desenhados em canvas */
function roundRect(x, X, Y, W, H, R){ x.beginPath(); x.moveTo(X + R, Y); x.arcTo(X + W, Y, X + W, Y + H, R); x.arcTo(X + W, Y + H, X, Y + H, R); x.arcTo(X, Y + H, X, Y, R); x.arcTo(X, Y, X + W, Y, R); x.closePath(); }
function shapePath(x, shape, inset){
  const S = 256, i = inset;
  x.beginPath();
  if (shape === 'tri'){ const k = i * 1.9; x.moveTo(S / 2, 14 + k); x.lineTo(S - 10 - k * .87, S - 22 - i * .5); x.lineTo(10 + k * .87, S - 22 - i * .5); x.closePath(); }
  else if (shape === 'sq'){ roundRect(x, 8 + i, 8 + i, S - 16 - 2 * i, S - 16 - 2 * i, Math.max(4, 26 - i)); }
  else if (shape === 'oct'){ const r = 124 - i; for (let k = 0; k < 8; k++){ const a = Math.PI / 8 + k * Math.PI / 4; x[k ? 'lineTo' : 'moveTo'](S / 2 + r * Math.cos(a), S / 2 + r * Math.sin(a)); } x.closePath(); }
  else x.arc(S / 2, S / 2, 122 - i, 0, Math.PI * 2);
}
function signCanvas(p, back){
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  if (back){ shapePath(x, p.shape, 0); x.fillStyle = '#8f98a3'; x.fill(); return c; }
  shapePath(x, p.shape, 0); x.fillStyle = p.ring; x.fill();
  shapePath(x, p.shape, p.shape === 'sq' ? 12 : p.shape === 'tri' ? 16 : 26); x.fillStyle = p.fill; x.fill();
  const lines = String(p.text ?? '').split('\n'), n = lines.length;
  const longest = Math.max(1, ...lines.map(l => l.length));
  let fs = Math.min(p.shape === 'tri' ? 92 : 128, 190 / (longest * 0.58), 170 / n);
  x.font = `800 ${fs}px Arial, Helvetica, sans-serif`; x.fillStyle = p.tc; x.textAlign = 'center'; x.textBaseline = 'middle';
  const cy = p.shape === 'tri' ? 160 : 132;
  lines.forEach((l, i) => x.fillText(l, 128, cy + (i - (n - 1) / 2) * fs * 1.05));
  return c;
}
function texOf(canvas){ const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function labelCanvas(text, o){
  const fs = 64, pad = 30, lines = String(text ?? '').split('\n');
  const c = document.createElement('canvas'), x = c.getContext('2d');
  x.font = `700 ${fs}px "Segoe UI", Arial, sans-serif`;
  const w = Math.ceil(Math.max(40, ...lines.map(l => x.measureText(l).width))) + pad * 2 + (o.accent ? 14 : 0);
  const h = Math.ceil(lines.length * fs * 1.22) + pad * 1.4;
  c.width = w; c.height = h;
  if (o.bgop > 0){ x.globalAlpha = o.bgop; x.fillStyle = o.bg; roundRect(x, 2, 2, w - 4, h - 4, Math.min(28, h / 3)); x.fill(); x.globalAlpha = 1; }
  if (o.accent){ x.fillStyle = o.accent; roundRect(x, 10, 14, 8, h - 28, 4); x.fill(); }
  x.font = `700 ${fs}px "Segoe UI", Arial, sans-serif`; x.fillStyle = o.tc; x.textBaseline = 'middle';
  lines.forEach((l, i) => x.fillText(l, pad + (o.accent ? 14 : 0), pad * .7 + fs * 1.22 * (i + .5)));
  return c;
}
function makeSprite(canvas, height){
  const mat = new THREE.SpriteMaterial({ map: texOf(canvas), depthTest: false, transparent: true });
  const s = new THREE.Sprite(mat); s.center.set(0.5, 0); s.renderOrder = 20;
  s.scale.set(height * canvas.width / canvas.height, height, 1);
  return s;
}
function iconCanvas(p){
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 14;
  shapePath(x, p.shape === 'circle' ? 'round' : p.shape, 0); x.fillStyle = p.bg; x.fill(); x.shadowBlur = 0;
  x.lineWidth = 10; x.strokeStyle = 'rgba(0,0,0,.55)'; shapePath(x, p.shape === 'circle' ? 'round' : p.shape, 5); x.stroke();
  const t = String(p.text ?? ''), fs = Math.min(150, 200 / Math.max(1, t.length * .62));
  x.font = `900 ${fs}px Arial, sans-serif`; x.fillStyle = p.tc; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(t, 128, p.shape === 'tri' ? 160 : 132);
  return c;
}

/* campos dos painéis: [chave, rótulo, tipo, opções] */
const F = {
  color: (k = 'color', l = 'Cor') => [k, l, 'color'],
  op: (k = 'op', l = 'Opacidade') => [k, l, 'range', { min: 0, max: 1, step: .05 }],
  num: (k, l, min, max, step = 1) => [k, l, 'num', { min, max, step }],
};
const ANCHORS = {
  front: hb => ({ pos: [0, 0.05, hb.max.z], rot: 0 }),
  rear: hb => ({ pos: [0, 0.05, hb.min.z], rot: Math.PI }),
  center: hb => ({ pos: [0, 0.04, 0], rot: 0 }),
  top: hb => ({ pos: [0, hb.max.y + 0.5, 0], rot: 0 }),
  lamp: hb => ({ pos: [0, Math.max(0.5, hb.max.y * 0.42), hb.max.z], rot: 0 }),
  windshield: hb => ({ pos: [0, hb.max.y * 0.88, hb.max.z * 0.2], rot: 0 }),
  ahead: hb => ({ pos: [0, 0.05, hb.max.z + 1], rot: 0 }),
};

const PROCS = [];
const P = d => PROCS.push(d);

/* ---------- estrada com número de faixas configurável ----------
   Toda peça começa na origem apontando para +Z (esquerda = +X), então as peças se encaixam pela ponta.
   path(p) dá o eixo central: at(s) -> ponto, normal para a esquerda e tangente. */
const ROAD_Y = 0.08;
function lanesOf(p){
  const n = Math.max(1, Math.round(p.lanes)), W = n * p.lw, fwd = p.twoway ? Math.ceil(n / 2) : n, out = [];
  for (let i = 0; i < n; i++) out.push({ off: -W / 2 + p.lw * (i + 0.5), dir: i < fwd ? 1 : -1 });   // da direita para a esquerda
  return out;
}


/* ---------- pessoas ---------- */
function buildPed(p){
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const k = p.kind === 'crianca' ? 0.62 : 1; body.scale.setScalar(k);
  const shirt = STD(p.shirt), pants = STD(p.pants), skin = STD(p.skin), hair = STD(p.hair), shoe = STD('#1d1f24');
  const box = (w, h, d, m) => mesh(new THREE.BoxGeometry(w, h, d), m);
  const leg = (x, name) => { const g = new THREE.Group(); g.position.set(x, 0.92, 0); g.name = name;
    const l = box(0.16, 0.84, 0.18, pants); l.position.y = -0.44; g.add(l);
    const s = box(0.17, 0.08, 0.27, shoe); s.position.set(0, -0.88, 0.04); g.add(s); return g; };
  const arm = (x, name) => { const g = new THREE.Group(); g.position.set(x, 1.47, 0); g.name = name;
    const a = box(0.12, 0.6, 0.14, shirt); a.position.y = -0.28; g.add(a);
    const h = box(0.1, 0.12, 0.12, skin); h.position.y = -0.63; g.add(h); return g; };
  const L1 = leg(0.1, 'legL'), L2 = leg(-0.1, 'legR'), A1 = arm(0.29, 'armL'), A2 = arm(-0.29, 'armR');
  body.add(L1, L2, A1, A2);
  const torso = p.kind === 'mulher' ? mesh(new THREE.CylinderGeometry(0.2, 0.27, 0.62, 6), shirt) : box(0.44, 0.6, 0.24, shirt);
  torso.position.y = 1.2; body.add(torso);
  const hip = box(0.4, 0.14, 0.22, pants); hip.position.y = 0.92; body.add(hip);
  const neck = box(0.1, 0.08, 0.1, skin); neck.position.y = 1.54; body.add(neck);
  const head = mesh(new THREE.IcosahedronGeometry(0.14, 1), skin); head.position.y = 1.7; body.add(head);
  const cap = mesh(new THREE.SphereGeometry(0.152, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), hair); cap.position.y = 1.72; body.add(cap);
  if (p.kind === 'mulher'){ const tail = box(0.24, 0.3, 0.08, hair); tail.position.set(0, 1.58, -0.12); body.add(tail); }
  root.userData.parts = { L1, L2, A1, A2 };
  return root;
}
function updatePed(o){
  const s = o.userData.moveS || 0, v = o.userData.moveV || 0, P = o.userData.parts; if (!P) return;
  const amp = v > 0.05 ? Math.min(0.6, 0.25 + v * 0.18) : 0, ph = s / 0.75 * Math.PI, w = Math.sin(ph) * amp;
  P.L1.rotation.x = w; P.L2.rotation.x = -w; P.A1.rotation.x = -w * 0.8; P.A2.rotation.x = w * 0.8;
}
const PED_FIELDS = [['kind', 'Tipo', 'sel', [['homem', 'Adulto'], ['mulher', 'Adulta'], ['crianca', 'Criança']]], F.color('shirt', 'Camisa'), F.color('pants', 'Calça'), F.color('skin', 'Pele'), F.color('hair', 'Cabelo')];
for (const [id, name, d] of [
  ['p:ped_man', 'Pedestre (homem)', { kind: 'homem', shirt: '#ff9a1f', pants: '#2f3b57', skin: '#d9a982', hair: '#2b211c' }],
  ['p:ped_woman', 'Pedestre (mulher)', { kind: 'mulher', shirt: '#d94f7a', pants: '#34405a', skin: '#c99272', hair: '#5a3624' }],
  ['p:ped_child', 'Criança', { kind: 'crianca', shirt: '#3fa7ff', pants: '#2b3348', skin: '#e2b48f', hair: '#3a2a1e' }]
]) P({ id, name, cat: 'Pessoas e natureza', ped: true, movable: true, solid: true, defaults: d, fields: PED_FIELDS, build: buildPed, update: updatePed });

/* ---------- natureza ---------- */
function buildTree(p){
  const g = new THREE.Group(), h = p.size, trunk = STD(p.trunk), leaf = STD(p.leaf), leaf2 = STD(p.leaf2 || p.leaf);
  if (p.kind === 'pinheiro'){
    const t = mesh(new THREE.CylinderGeometry(h * .035, h * .05, h * .3, 6), trunk); t.position.y = h * .15; g.add(t);
    [[.42, .36, .3], [.34, .3, .52], [.24, .26, .72]].forEach(([r, hh, y], i) => { const c = mesh(new THREE.ConeGeometry(h * r, h * hh, 7), i % 2 ? leaf2 : leaf); c.position.y = h * y; g.add(c); });
  } else if (p.kind === 'arbusto'){
    [[0, .45, 0, .5], [.4, .35, .15, .38], [-.35, .32, -.1, .36]].forEach(([x, y, z, r], i) => { const b = mesh(new THREE.IcosahedronGeometry(h * r, 0), i ? leaf2 : leaf); b.position.set(x * h, y * h, z * h); g.add(b); });
  } else {
    const t = mesh(new THREE.CylinderGeometry(h * .04, h * .06, h * .45, 6), trunk); t.position.y = h * .22; g.add(t);
    const f = mesh(new THREE.IcosahedronGeometry(h * .3, 0), leaf); f.position.y = h * .62; g.add(f);
    const f2 = mesh(new THREE.IcosahedronGeometry(h * .2, 0), leaf2); f2.position.set(h * .14, h * .76, h * .06); g.add(f2);
  }
  return g;
}
const TREE_FIELDS = [['kind', 'Tipo', 'sel', [['redonda', 'Árvore redonda'], ['pinheiro', 'Pinheiro'], ['arbusto', 'Arbusto']]], F.num('size', 'Altura (m)', 0.5, 25, 0.5), F.color('leaf', 'Folhagem'), F.color('leaf2', 'Folhagem clara'), F.color('trunk', 'Tronco')];
P({ id: 'p:tree', name: 'Árvore', cat: 'Pessoas e natureza', solid: true, defaults: { kind: 'redonda', size: 6, leaf: '#2f7d47', leaf2: '#4caf63', trunk: '#6b4a32' }, fields: TREE_FIELDS, build: buildTree });
P({ id: 'p:pine', name: 'Pinheiro', cat: 'Pessoas e natureza', solid: true, defaults: { kind: 'pinheiro', size: 8, leaf: '#1f5f3f', leaf2: '#2f7d4f', trunk: '#5a3e2b' }, fields: TREE_FIELDS, build: buildTree });
P({ id: 'p:bush', name: 'Arbusto', cat: 'Pessoas e natureza', solid: true, defaults: { kind: 'arbusto', size: 1.4, leaf: '#3d8b4a', leaf2: '#58a95e', trunk: '#6b4a32' }, fields: TREE_FIELDS, build: buildTree });
P({ id: 'p:treerow', name: 'Fileira de árvores', cat: 'Pessoas e natureza', solid: false,
  defaults: { kind: 'redonda', size: 6, count: 8, spacing: 10, leaf: '#2f7d47', leaf2: '#4caf63', trunk: '#6b4a32', mix: 1 },
  fields: [F.num('count', 'Quantidade', 1, 60), F.num('spacing', 'Espaçamento (m)', 2, 60, 0.5), ...TREE_FIELDS, ['mix', 'Alternar tamanhos', 'chk']],
  build(p){ const g = new THREE.Group(); for (let i = 0; i < p.count; i++){ const s = p.mix ? p.size * (0.8 + 0.4 * ((i * 37) % 10) / 10) : p.size; const t = buildTree({ ...p, size: s }); t.position.z = i * p.spacing; t.rotation.y = i * 1.3; g.add(t); } return g; } });

/* ---------- placas e marcações ---------- */
P({ id: 'p:sign3d', name: 'Placa 3D (velocidade, aviso…)', cat: 'Placas e marcações', solid: true,
  defaults: { shape: 'round', text: '60', fill: '#ffffff', ring: '#d92d20', tc: '#111111', size: 0.8, pole: 2.2 },
  fields: [['shape', 'Forma', 'sel', [['round', 'Redonda (velocidade)'], ['tri', 'Triangular (aviso)'], ['sq', 'Quadrada'], ['oct', 'Octógono (PARE)']]], ['text', 'Texto', 'area'],
    F.color('fill', 'Fundo'), F.color('ring', 'Borda'), F.color('tc', 'Cor do texto'), F.num('size', 'Tamanho (m)', 0.3, 4, 0.05), F.num('pole', 'Altura do poste (m)', 0, 8, 0.1)],
  build(p){
    const g = new THREE.Group(), s = p.size;
    if (p.pole > 0){ const pl = mesh(new THREE.CylinderGeometry(0.04, 0.04, p.pole + s / 2, 8), STD('#8f98a3')); pl.position.y = (p.pole + s / 2) / 2; g.add(pl); }
    const geo = new THREE.PlaneGeometry(s, s);
    const front = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: texOf(signCanvas(p)), transparent: true, alphaTest: .5, roughness: .6 }));
    front.position.set(0, p.pole + s / 2, 0.05); front.castShadow = true; g.add(front);
    const back = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: texOf(signCanvas(p, true)), transparent: true, alphaTest: .5 }));
    back.position.set(0, p.pole + s / 2, 0.04); back.rotation.y = Math.PI; g.add(back);
    return g;
  } });
P({ id: 'p:paint', name: 'Faixa pintada', cat: 'Placas e marcações',
  defaults: { len: 16, w: 0.15, color: '#f2f2f2', dashed: 1, dash: 3, gap: 4.5 },
  fields: [F.num('len', 'Comprimento (m)', 0.5, 400, 0.5), F.num('w', 'Largura (m)', 0.05, 2, 0.05), F.color(), ['dashed', 'Tracejada', 'chk'], F.num('dash', 'Traço (m)', 0.2, 20, 0.1), F.num('gap', 'Espaço (m)', 0.2, 20, 0.1)],
  build(p){
    const g = new THREE.Group(), m = STD(p.color, { flatShading: false, roughness: .9, polygonOffset: true, polygonOffsetFactor: -2 });
    const seg = (z0, z1) => { const q = mesh(new THREE.PlaneGeometry(p.w, z1 - z0), m, false); q.rotation.x = -Math.PI / 2; q.position.set(0, 0.015, (z0 + z1) / 2); g.add(q); };
    if (!p.dashed) seg(0, p.len); else for (let z = 0; z < p.len; z += p.dash + p.gap) seg(z, Math.min(p.len, z + p.dash));
    return g;
  } });
P({ id: 'p:zebra', name: 'Faixa de pedestres', cat: 'Placas e marcações',
  defaults: { len: 6.4, w: 3, n: 8, color: '#f2f2f2' },
  fields: [F.num('len', 'Largura da rua (m)', 1, 40, 0.1), F.num('w', 'Comprimento das listras (m)', 0.5, 8, 0.1), F.num('n', 'Listras', 2, 40), F.color()],
  build(p){ const g = new THREE.Group(), m = STD(p.color, { flatShading: false, polygonOffset: true, polygonOffsetFactor: -2 }), step = p.len / p.n;
    for (let i = 0; i < p.n; i++){ const q = mesh(new THREE.PlaneGeometry(step * .55, p.w), m, false); q.rotation.x = -Math.PI / 2; q.position.set(-p.len / 2 + step * (i + .5), 0.015, 0); g.add(q); }
    return g; } });
function arrowShapeGeo(len, w){
  const s = new THREE.Shape(), sw = w * .34, hl = Math.min(len * .45, w * 1.1);
  s.moveTo(-sw / 2, 0); s.lineTo(sw / 2, 0); s.lineTo(sw / 2, len - hl); s.lineTo(w / 2, len - hl); s.lineTo(0, len); s.lineTo(-w / 2, len - hl); s.lineTo(-sw / 2, len - hl); s.closePath();
  const g = new THREE.ShapeGeometry(s); g.rotateX(Math.PI / 2);   // forma (x, y) -> chão (x, 0, y): aponta para +Z
  const n = g.attributes.position.count, al = []; for (let i = 0; i < n; i++) al.push(1, 1, 1, 1);
  g.setAttribute('color', new THREE.Float32BufferAttribute(al, 4));
  return g;
}
P({ id: 'p:arrow', name: 'Seta no chão', cat: 'Placas e marcações', attach: true, anchor: ANCHORS.ahead,
  defaults: { len: 3.2, w: 1.4, color: '#ffb020', op: .9 },
  fields: [F.num('len', 'Comprimento (m)', 0.3, 30, 0.1), F.num('w', 'Largura (m)', 0.2, 10, 0.1), F.color(), F.op()],
  build(p){ const m = new THREE.Mesh(arrowShapeGeo(p.len, p.w), fxMat(p.color, p.op)); m.position.y = 0.02; m.renderOrder = 3; const g = new THREE.Group(); g.add(m); return g; } });
P({ id: 'p:stalls', name: 'Vagas de estacionamento', cat: 'Placas e marcações',
  defaults: { n: 6, w: 2.6, d: 5.2, color: '#e8edf3', closed: 0, lw: 0.12 },
  fields: [F.num('n', 'Vagas', 1, 60), F.num('w', 'Largura da vaga (m)', 1.8, 5, 0.1), F.num('d', 'Profundidade (m)', 3, 10, 0.1), F.color(), ['closed', 'Linha no fundo', 'chk']],
  build(p){ const g = new THREE.Group(), m = STD(p.color, { flatShading: false, polygonOffset: true, polygonOffsetFactor: -2 }), W = p.n * p.w;
    const bar = (x, z, w, d) => { const q = mesh(new THREE.PlaneGeometry(w, d), m, false); q.rotation.x = -Math.PI / 2; q.position.set(x, 0.015, z); g.add(q); };
    for (let i = 0; i <= p.n; i++) bar(-W / 2 + i * p.w, p.d / 2, p.lw, p.d);
    if (p.closed) bar(0, p.d, W, p.lw);
    return g; } });
P({ id: 'p:floor', name: 'Piso / área', cat: 'Placas e marcações',
  defaults: { w: 30, d: 30, color: '#3a414b' },
  fields: [F.num('w', 'Largura (m)', 1, 500, 0.5), F.num('d', 'Comprimento (m)', 1, 500, 0.5), F.color()],
  build(p){ const g = new THREE.Group(), q = mesh(new THREE.PlaneGeometry(p.w, p.d), STD(p.color, { flatShading: false, roughness: .95 }), false); q.rotation.x = -Math.PI / 2; q.position.y = 0.006; g.add(q); return g; } });
P({ id: 'p:curb', name: 'Calçada / meio-fio', cat: 'Placas e marcações', solid: true,
  defaults: { len: 16, w: 2, h: 0.15, color: '#a3acb7', edge: '#d7dce2' },
  fields: [F.num('len', 'Comprimento (m)', 0.5, 400, 0.5), F.num('w', 'Largura (m)', 0.2, 10, 0.1), F.num('h', 'Altura (m)', 0.05, 0.6, 0.01), F.color('color', 'Calçada'), F.color('edge', 'Meio-fio')],
  build(p){ const g = new THREE.Group(); const b = mesh(new THREE.BoxGeometry(p.w, p.h, p.len), STD(p.color)); b.position.set(0, p.h / 2, p.len / 2); g.add(b);
    const e = mesh(new THREE.BoxGeometry(0.16, p.h + 0.01, p.len), STD(p.edge)); e.position.set(-p.w / 2 + 0.08, p.h / 2 + 0.005, p.len / 2); g.add(e); return g; } });
P({ id: 'p:pillar', name: 'Pilar (garagem)', cat: 'Placas e marcações', solid: true,
  defaults: { h: 3, s: 0.6, color: '#8a939e', band: 1 },
  fields: [F.num('h', 'Altura (m)', 0.5, 12, 0.1), F.num('s', 'Largura (m)', 0.2, 3, 0.05), F.color(), ['band', 'Faixa amarela e preta', 'chk']],
  build(p){ const g = new THREE.Group(); const c = mesh(new THREE.BoxGeometry(p.s, p.h, p.s), STD(p.color)); c.position.y = p.h / 2; g.add(c);
    if (p.band){ const y = mesh(new THREE.BoxGeometry(p.s + .02, .45, p.s + .02), STD('#facc15')); y.position.y = .3; g.add(y); const k = mesh(new THREE.BoxGeometry(p.s + .03, .1, p.s + .03), STD('#111111')); k.position.y = .25; g.add(k); }
    return g; } });
P({ id: 'p:wall', name: 'Parede / muro', cat: 'Placas e marcações', solid: true,
  defaults: { len: 10, h: 2.5, t: 0.25, color: '#b7bec7' },
  fields: [F.num('len', 'Comprimento (m)', 0.5, 200, 0.5), F.num('h', 'Altura (m)', 0.2, 12, 0.1), F.num('t', 'Espessura (m)', 0.05, 2, 0.05), F.color()],
  build(p){ const g = new THREE.Group(), w = mesh(new THREE.BoxGeometry(p.len, p.h, p.t), STD(p.color)); w.position.y = p.h / 2; g.add(w); return g; } });

/* ---------- efeitos ADAS ---------- */
const FX = d => P({ cat: 'ADAS (efeitos)', fx: true, attach: true, ...d });
FX({ id: 'f:cone', name: 'Cone de radar / câmera', anchor: ANCHORS.front,
  defaults: { range: 40, ang: 30, color: '#2ee6c8', op: .5, edges: 1, sweep: 1, react: 1, alert: '#ff3b30', icon: 1, iconAt: 'obj', iconColor: '#ffb020', iconSize: 1.3 },
  fields: [F.num('range', 'Alcance (m)', 0.5, 250, 0.5), F.num('ang', 'Abertura (°)', 2, 200, 1), F.color(), F.op(), ['edges', 'Contorno', 'chk'], ['sweep', 'Varredura animada', 'chk'], ['react', 'Ficar com cor de alerta ao detectar algo', 'chk'], F.color('alert', 'Cor de alerta'), ['icon', 'Mostrar ícone de alerta ⚠ quando detectar algo', 'chk'], ['iconAt', 'Ícone em cima de', 'sel', [['obj', 'O objeto detectado'], ['host', 'O próprio veículo']]], F.color('iconColor', 'Cor do ícone'), F.num('iconSize', 'Tamanho do ícone (m)', 0.3, 6, 0.1), ['iconSnd', 'Ícone de som 🔊 junto (aviso sonoro)', 'chk']],
  build(p){
    const g = new THREE.Group(), h = p.ang / 2 * DEG, mat = fxMat(p.color, p.op);
    const m = new THREE.Mesh(sectorGeo(p.range, h), mat); m.renderOrder = 3; g.add(m); g.userData.mats = [mat];
    if (p.edges){
      const pts = [new V3(0, .06, 0)]; for (let i = 0; i <= 32; i++){ const a = -h + 2 * h * i / 32; pts.push(new V3(Math.sin(a) * p.range, .06, Math.cos(a) * p.range)); } pts.push(new V3(0, .06, 0));
      const lm = lineMat(p.color, .9), l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lm); l.renderOrder = 4; g.add(l); g.userData.mats.push(lm);
    }
    if (p.sweep){ const sm = lineMat(p.color, .9), s = new THREE.Line(arcLine(1, h), sm); s.renderOrder = 4; g.add(s); g.userData.sweep = s; g.userData.mats.push(sm); }
    return g;
  },
  update(o, p, c){
    const sw = o.userData.sweep;
    if (sw){ const f = (c.t / 1.6) % 1, r = Math.max(0.01, f * p.range); sw.scale.set(r, 1, r); sw.material.opacity = 0.95 * (1 - f); }
    if (p.react || p.icon){ const hit = detectInSector(o, p.range, p.ang / 2 * DEG, c.hostE?.uid ?? c.e.uid); if (p.react){ const col = hit ? p.alert : p.color; o.userData.mats.forEach(m => m.color.set(col)); } fxAlertIcon(c, p, hit); }
  } });
FX({ id: 'f:waves', name: 'Ondas de sensor', anchor: ANCHORS.front,
  defaults: { range: 5, ang: 80, color: '#ffb020', n: 3, speed: 1, op: .9 },
  fields: [F.num('range', 'Alcance (m)', 0.3, 60, 0.1), F.num('ang', 'Abertura (°)', 5, 220, 1), F.color(), F.op(), F.num('n', 'Ondas', 1, 6), F.num('speed', 'Velocidade da animação', 0.1, 5, 0.1)],
  build(p){ const g = new THREE.Group(), h = p.ang / 2 * DEG; g.userData.rings = [];
    for (let i = 0; i < p.n; i++){ const m = new THREE.Mesh(arcGeo(0.86, 1, -h, h, 28), fxMat(p.color, p.op)); m.renderOrder = 3; m.position.y = 0.05; const r = p.range * (i + 1) / p.n; m.scale.set(r, 1, r); g.add(m); g.userData.rings.push(m); }
    return g; },
  update(o, p, c){ o.userData.rings.forEach((m, i) => { const f = ((c.t * p.speed * 0.8) + i / p.n) % 1, r = Math.max(0.02, f * p.range); m.scale.set(r, 1, r); m.material.opacity = p.op * Math.sin(Math.PI * f); }); } });
FX({ id: 'f:zone', name: 'Zona no piso', anchor: ANCHORS.front,
  defaults: { len: 12, w: 3, color: '#3ddc84', op: .6, fade: .15, lead: 0, border: 0, react: 0, alert: '#ff3b30', icon: 0, iconAt: 'obj', iconColor: '#ffb020', iconSize: 1.3 },
  fields: [F.num('len', 'Comprimento (m)', 0.2, 300, 0.1), F.num('w', 'Largura (m)', 0.2, 40, 0.1), F.color(), F.op(), F.op('fade', 'Esmaecer no fim (0 a 1)'), ['lead', 'Ir até o veículo à frente (ACC / FCW)', 'chk'], ['border', 'Contorno', 'chk'], ['react', 'Ficar com cor de alerta ao detectar algo', 'chk'], F.color('alert', 'Cor de alerta'), ['icon', 'Mostrar ícone de alerta ⚠ quando detectar algo', 'chk'], ['iconAt', 'Ícone em cima de', 'sel', [['obj', 'O objeto detectado'], ['host', 'O próprio veículo']]], F.color('iconColor', 'Cor do ícone'), F.num('iconSize', 'Tamanho do ícone (m)', 0.3, 6, 0.1), ['iconSnd', 'Ícone de som 🔊 junto (aviso sonoro)', 'chk']],
  build(p){ const g = new THREE.Group(), mat = fxMat(p.color, p.op), m = new THREE.Mesh(rectGeo(-p.w / 2, p.w / 2, 0, 1, 1, p.fade), mat);
    m.renderOrder = 3; m.position.y = 0.02; m.scale.z = p.len; g.add(m); g.userData.m = m; g.userData.mats = [mat];
    if (p.border){ const lm = lineMat(p.color, .95), pts = [[-1, 0], [1, 0], [1, 1], [-1, 1], [-1, 0]].map(([x, z]) => new V3(x * p.w / 2, .05, z)); const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lm); l.scale.z = p.len; g.add(l); g.userData.l = l; g.userData.mats.push(lm); }
    return g; },
  update(o, p, c){
    let len = p.len;
    if (p.lead && c.hostE){ const gap = leadOf(c.hostE.uid); len = isFinite(gap) && gap < 300 ? Math.max(0.3, gap) : p.len; }
    o.userData.m.scale.z = len; if (o.userData.l) o.userData.l.scale.z = len;
    if (p.react || p.icon){ _inv.copy(o.matrixWorld).invert(); let hit = null;
      for (const s of solids()){ if (s.uid === (c.hostE?.uid ?? c.e.uid)) continue; _lc.copy(s.c).applyMatrix4(_inv); if (_lc.z > -s.r && _lc.z < len + s.r * .5 && Math.abs(_lc.x) < p.w / 2 + s.r * .6){ hit = s; break; } }
      if (p.react) o.userData.mats.forEach(m => m.color.set(hit ? p.alert : p.color));
      fxAlertIcon(c, p, hit); }
  } });
FX({ id: 'f:path', name: 'Trajetória / faixa destacada', anchor: ANCHORS.front, world: true,
  defaults: { len: 35, w: 2.4, color: '#4ade80', op: .6, style: 'faixa' },
  fields: [F.num('len', 'Comprimento (m)', 1, 300, 0.5), F.num('w', 'Largura (m)', 0.2, 12, 0.1), F.color(), F.op(), ['style', 'Estilo', 'sel', [['faixa', 'Faixa preenchida'], ['bordas', 'Só as bordas'], ['centro', 'Linha central']]]],
  build(p){
    const N = 48, per = p.style === 'faixa' ? 2 : p.style === 'bordas' ? 4 : 2, pos = new Float32Array((N + 1) * per * 3), col = new Float32Array((N + 1) * per * 4), idx = [];
    for (let i = 0; i <= N; i++){ const a = 1 - i / N * 0.92; for (let k = 0; k < per; k++) col.set([1, 1, 1, a], (i * per + k) * 4); }
    for (let i = 0; i < N; i++){ const q = (a, b) => { const A = i * per + a, B = i * per + b, C = (i + 1) * per + b, D = (i + 1) * per + a; idx.push(A, B, C, A, C, D); }; if (per === 2) q(0, 1); else { q(0, 1); q(2, 3); } }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 4)); geo.setIndex(idx);
    const m = new THREE.Mesh(geo, fxMat(p.color, p.op)); m.renderOrder = 3; m.frustumCulled = false;
    const g = new THREE.Group(); g.add(m); g.userData = { geo, N, per };
    // forma inicial: reta à frente (usada quando o efeito não está preso a um veículo)
    const pts = []; for (let i = 0; i <= N; i++) pts.push([new V3(0, 0.05, p.len * i / N), new V3(1, 0, 0)]);
    writeRibbon(g, pts, p); return g;
  },
  update(o, p, c){
    if (!c.host) return;
    const { N } = o.userData, he = c.hostE, ho = c.host, e = c.e, pts = [];
    const off = e.pos[2] - boxOf(he).max.z, lat = e.pos[0];
    const m = he.motion;
    if (m && m.type === 'route' && m.pts.length >= 2){
      const { curve, L } = getCurve(he), s0 = profileFor(he, c.t).s + boxOf(he).max.z + off;
      for (let i = 0; i <= N; i++){
        let d = s0 + p.len * i / N; d = m.end === 'loop' ? ((d % L) + L) % L : Math.min(d, L);
        const u = d / L, pt = curve.getPointAt(u), tg = curve.getTangentAt(u);
        const nr = new V3(tg.z, 0, -tg.x).normalize();
        pts.push([pt.add(nr.clone().multiplyScalar(-lat)).add(new V3(0, 0.05, 0)), nr]);
      }
    } else {
      const q = new THREE.Quaternion(); ho.getWorldQuaternion(q); const nr = new V3(1, 0, 0).applyQuaternion(q);
      for (let i = 0; i <= N; i++) pts.push([ho.localToWorld(new V3(lat, 0.05, e.pos[2] + p.len * i / N)), nr]);
    }
    writeRibbon(o, pts, p);
  } });
function writeRibbon(o, pts, p){
  const { geo, per } = o.userData, a = geo.attributes.position.array, hw = p.w / 2, ew = Math.min(0.18, hw * .4);
  pts.forEach(([pt, nr], i) => {
    const offs = per === 2 ? (p.style === 'centro' ? [-0.08, 0.08] : [-hw, hw]) : [-hw, -hw + ew, hw - ew, hw];
    offs.forEach((d, k) => a.set([pt.x + nr.x * d, pt.y, pt.z + nr.z * d], (i * per + k) * 3));
  });
  geo.attributes.position.needsUpdate = true; geo.computeBoundingSphere();
}
FX({ id: 'f:beam', name: 'Feixe de farol (AHB)', anchor: ANCHORS.lamp,
  defaults: { range: 45, ang: 24, color: '#ffe066', op: .22, light: 0 },
  fields: [F.num('range', 'Alcance (m)', 2, 200, 1), F.num('ang', 'Abertura (°)', 5, 90, 1), F.color(), F.op(), ['light', 'Iluminar a cena de verdade (melhor à noite)', 'chk']],
  build(p){
    const g = new THREE.Group(), r = Math.tan(p.ang / 2 * DEG) * p.range;
    const cg = new THREE.ConeGeometry(r, p.range, 32, 1, true); cg.rotateX(-Math.PI / 2); cg.translate(0, 0, p.range / 2);
    const cm = new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: p.op * .6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const cone = new THREE.Mesh(cg, cm); cone.rotation.x = 0.05; cone.renderOrder = 4; g.add(cone);
    const gm = new THREE.Mesh(sectorGeo(p.range, p.ang / 2 * DEG, [0.9, 0.5, 0]), fxMat(p.color, p.op * 1.4)); gm.position.y = 0.02; gm.renderOrder = 3;
    const gw = new THREE.Group(); gw.add(gm); g.add(gw); g.userData.ground = gw;
    if (p.light){ const s = new THREE.SpotLight(p.color, 400, p.range * 1.3, p.ang / 2 * DEG * 1.2, 0.6, 1.2); s.target.position.set(0, -1, 10); g.add(s, s.target); }
    return g;
  },
  update(o){ const gw = o.userData.ground; gw.position.y = -o.position.y + 0.02; } });
FX({ id: 'f:park', name: 'Sensores Park Assist', anchor: ANCHORS.center,
  defaults: { sides: 'ambos', sectors: 7, rings: 4, range: 1.8, c0: '#9aa5b1', c1: '#b5e048', c2: '#ffd60a', c3: '#ff9f0a', c4: '#ff3b30', idle: 1, icon: 0, iconAt: 'obj', iconColor: '#ffb020', iconSize: 1.3 },
  fields: [['sides', 'Lados', 'sel', [['ambos', 'Frente e trás'], ['frente', 'Só frente'], ['tras', 'Só trás']]], F.num('sectors', 'Setores', 2, 16), F.num('rings', 'Faixas', 1, 6), F.num('range', 'Alcance (m)', 0.3, 6, 0.1),
    F.color('c1', 'Longe'), F.color('c2', 'Médio'), F.color('c3', 'Perto'), F.color('c4', 'Muito perto'), ['idle', 'Mostrar faixas apagadas', 'chk'], ['icon', 'Mostrar ícone de alerta ⚠ quando detectar algo', 'chk'], ['iconAt', 'Ícone em cima de', 'sel', [['obj', 'O objeto detectado'], ['host', 'O próprio veículo']]], F.color('iconColor', 'Cor do ícone'), F.num('iconSize', 'Tamanho do ícone (m)', 0.3, 6, 0.1), ['iconSnd', 'Ícone de som 🔊 junto (aviso sonoro)', 'chk']],
  build(p, hb){
    const g = new THREE.Group(), hw = (hb.max.x - hb.min.x) / 2, th = p.range / p.rings, A0 = 8 * DEG, SP = 164 * DEG, gp = 1.6 * DEG, cells = [];
    const sides = p.sides === 'ambos' ? [1, -1] : p.sides === 'frente' ? [1] : [-1];
    for (const sd of sides){
      // arcos elípticos: colados no para-choque e contornando as quinas
      const inset = hw * 0.6, cz = sd > 0 ? hb.max.z - inset : hb.min.z + inset, r0 = inset + 0.12;
      const grp = new THREE.Group(); grp.position.set(0, 0.04, cz); grp.scale.x = (hw + 0.1) / r0; if (sd < 0) grp.rotation.y = Math.PI; g.add(grp);
      const sec = [];
      for (let s = 0; s < p.sectors; s++){
        const a0 = -SP / 2 + SP / p.sectors * s + gp / 2, a1 = -SP / 2 + SP / p.sectors * (s + 1) - gp / 2, rs = [];
        for (let k = 0; k < p.rings; k++){ const m = new THREE.Mesh(arcGeo(r0 + k * th, r0 + (k + 1) * th - th * .12, a0, a1, 6), fxMat(p.c0, .2)); m.renderOrder = 3; grp.add(m); rs.push(m); }
        sec.push({ rs, dirs: [a0 + 0.02, (a0 + a1) / 2, a1 - 0.02] });
      }
      cells.push({ grp, sec, r0 });
    }
    g.userData = { cells, th };
    return g;
  },
  update(o, p, c){
    const { cells, th } = o.userData, CL = [p.c1, p.c2, p.c3, p.c4, p.c4, p.c4], list = solids().filter(s => s.uid !== c.hostE?.uid), rr = new THREE.Ray(), hit = new V3();
    let near = null, nearD = Infinity;
    for (const cl of cells){
      const org = cl.grp.localToWorld(new V3(0, 0.45, 0));
      for (const sc of cl.sec){
        // 3 raios por setor; a distância conta a partir da faixa mais interna (elipse)
        let db = Infinity;
        for (const a of sc.dirs){
          const dir = new V3(Math.sin(a), 0, Math.cos(a)).transformDirection(cl.grp.matrixWorld); dir.y = 0; dir.normalize();
          const rIn = Math.hypot(Math.sin(a) * cl.r0 * cl.grp.scale.x, Math.cos(a) * cl.r0);
          rr.set(org, dir);
          for (const s of list){ if (rr.intersectBox(s.box, hit)){ const d = hit.distanceTo(org) - rIn; if (d < db) db = d; if (d < nearD && d < p.rings * th){ nearD = d; near = s; } } }
        }
        const lv = db < p.rings * th ? Math.max(1, p.rings - Math.floor(Math.max(0, db) / th)) : 0;
        sc.rs.forEach((m, i) => { const k = p.rings - i, lit = lv > 0 && k <= lv; m.material.color.set(lit ? CL[k - 1] : p.c0); m.material.opacity = lit ? .95 : p.idle ? .2 : 0; });
      }
    }
    fxAlertIcon(c, p, near);
  } });
FX({ id: 'f:guides', name: 'Linhas guia (câmera de ré)', anchor: ANCHORS.center,
  defaults: { len: 4, steer: 0, dir: 're', c1: '#ff3b30', c2: '#ffd60a', c3: '#34c759', ticks: 1, mid: 0, lw: 0.1 },
  fields: [F.num('len', 'Comprimento (m)', 0.5, 15, 0.1), F.num('steer', 'Curva (volante)', -100, 100, 1), ['dir', 'Direção', 'sel', [['re', 'Ré (atrás)'], ['frente', 'Frente']]],
    F.color('c1', 'Perto'), F.color('c2', 'Meio'), F.color('c3', 'Longe'), F.num('lw', 'Espessura (m)', 0.03, 0.4, 0.01), ['ticks', 'Marcas de distância', 'chk'], ['mid', 'Linha central', 'chk']],
  build(p, hb){
    const g = new THREE.Group(), sd = p.dir === 're' ? -1 : 1, z0 = sd < 0 ? hb.min.z : hb.max.z, hw = (hb.max.x - hb.min.x) / 2 * 0.95;
    const P2 = (u, side) => { const cx = p.steer / 100 * 0.45 * p.len * u * u; return new V3(side * hw + cx, 0.03, z0 + sd * u * p.len); };
    const strip = (pts, color, w) => { const pos = [], al = []; for (let i = 0; i < pts.length - 1; i++){ const a = pts[i], b = pts[i + 1], d = b.clone().sub(a).normalize(), n = new V3(d.z, 0, -d.x).multiplyScalar(w / 2);
        const A = a.clone().add(n), B = a.clone().sub(n), C = b.clone().sub(n), D = b.clone().add(n); pos.push(...A.toArray(), ...B.toArray(), ...C.toArray(), ...A.toArray(), ...C.toArray(), ...D.toArray()); al.push(1, 1, 1, 1, 1, 1); }
      const m = new THREE.Mesh(geoFrom(pos, al), fxMat(color, .95)); m.renderOrder = 3; g.add(m); };
    [[0, .34, p.c1], [.34, .67, p.c2], [.67, 1, p.c3]].forEach(([a, b, col]) => { for (const s of [-1, 1]){ const pts = []; for (let i = 0; i <= 8; i++) pts.push(P2(a + (b - a) * i / 8, s)); strip(pts, col, p.lw); } });
    if (p.ticks) [[.02, p.c1], [.34, p.c2], [.67, p.c3]].forEach(([u, col]) => { for (const s of [-1, 1]){ const a = P2(u, s); strip([a, a.clone().add(new V3(-s * hw * .28, 0, 0))], col, p.lw); } });
    if (p.mid){ for (let i = 0; i < 10; i += 2){ const pts = [0, 1].map(k => { const u = (i + k) / 10, q = P2(u, 0); return q; }); strip(pts, p.c2, p.lw * .7); } }
    return g;
  } });
FX({ id: 'f:camera', name: 'Câmera / sensor', anchor: ANCHORS.windshield,
  defaults: { color: '#c8d0da', size: 1 },
  fields: [F.color(), F.num('size', 'Tamanho', 0.3, 5, 0.1)],
  build(p){ const g = new THREE.Group(), s = p.size * 0.6; const b = mesh(new THREE.BoxGeometry(.3 * s, .18 * s, .22 * s), STD(p.color)); g.add(b);
    const l = mesh(new THREE.CylinderGeometry(.06 * s, .07 * s, .06 * s, 12), STD('#111317')); l.rotation.x = Math.PI / 2; l.position.z = .13 * s; g.add(l);
    const gl = mesh(new THREE.CircleGeometry(.04 * s, 12), new THREE.MeshBasicMaterial({ color: '#4fd1ff' })); gl.position.z = .162 * s; g.add(gl); return g; } });
FX({ id: 'f:alert3d', name: 'Alerta flutuante', anchor: ANCHORS.top,
  defaults: { shape: 'tri', text: '!', bg: '#ffb020', tc: '#111111', size: 1.3, blink: 1, bob: 1, snd: 0 },
  fields: [['shape', 'Forma', 'sel', [['tri', 'Triângulo'], ['circle', 'Círculo'], ['sq', 'Quadrado'], ['oct', 'Octógono']]], ['text', 'Texto / símbolo', 'text'], F.color('bg', 'Fundo'), F.color('tc', 'Cor do texto'), F.num('size', 'Tamanho (m)', 0.2, 10, 0.1), ['blink', 'Piscar', 'chk'], ['bob', 'Flutuar', 'chk'], ['snd', 'Ícone de som 🔊 ao lado (aviso sonoro)', 'chk']],
  build(p){ const g = new THREE.Group(), s = makeSprite(iconCanvas(p), p.size); g.add(s); g.userData.s = s;
    if (p.snd){ const sp = makeSprite(speakerCanvas('#0369a1'), p.size * 0.8); g.add(sp); g.userData.sp = sp; }
    return g; },
  update(o, p, c){ const s = o.userData.s, sp = o.userData.sp; s.position.y = p.bob ? Math.sin(c.t * 3) * 0.15 : 0; s.material.opacity = p.blink ? (Math.sin(c.t * Math.PI * 2.4) > -0.2 ? 1 : 0.25) : 1;
    if (sp){ const right = new V3(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(p.size * 0.85); const inv = o.getWorldQuaternion(new THREE.Quaternion()).invert(); sp.position.copy(right.applyQuaternion(inv)).add(new V3(0, s.position.y, 0)); sp.material.opacity = s.material.opacity; } } });
FX({ id: 'f:label', name: 'Rótulo de texto', anchor: ANCHORS.top,
  defaults: { text: 'Distância mantida', size: 0.7, tc: '#ffffff', bg: '#0b1018', bgop: .85, accent: '#00e5ff', stem: 1 },
  fields: [['text', 'Texto', 'area'], F.num('size', 'Altura da letra (m)', 0.1, 6, 0.05), F.color('tc', 'Texto'), F.color('bg', 'Fundo'), F.op('bgop', 'Opacidade do fundo'), F.color('accent', 'Destaque'), ['stem', 'Linha até o chão', 'chk']],
  build(p){ const g = new THREE.Group(), cv = labelCanvas(p.text, p), lines = String(p.text).split('\n').length, h = p.size * (lines * 1.22 + .7);
    const s = makeSprite(cv, h); g.add(s);
    if (p.stem){ const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V3(0, 0, 0), new V3(0, -20, 0)]), lineMat(p.accent || p.tc, .8)); l.renderOrder = 19; l.material.depthTest = false; g.add(l); g.userData.stem = l; }
    return g; },
  update(o){ const l = o.userData.stem; if (!l) return; const wp = o.getWorldPosition(new V3()); l.scale.y = Math.max(0.01, (wp.y - 0.05) / 20); } });
FX({ id: 'f:measure', name: 'Medida de distância', anchor: ANCHORS.front,
  defaults: { auto: 1, len: 20, color: '#ffffff', size: 0.6, a: null, b: null },
  fields: [F.color(), F.num('size', 'Tamanho do texto (m)', 0.2, 5, 0.1)],
  build(p){ const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: .9, depthWrite: false });
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 1), m); bar.rotation.x = -Math.PI / 2; bar.position.y = 0.06; bar.renderOrder = 4; g.add(bar);
    const t0 = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.1), m), t1 = t0.clone(); [t0, t1].forEach(t => { t.rotation.x = -Math.PI / 2; t.position.y = 0.06; t.renderOrder = 4; g.add(t); });
    const cv = labelCanvas('— m', { tc: '#ffffff', bg: '#0b1018', bgop: .8, accent: p.color }), s = makeSprite(cv, p.size * 1.6); g.add(s);
    g.userData = { bar, t1, s, last: '', p }; setMeasure(g, p.len, p); return g; },
  update(o, p, c){
    if (c.hostE){ setMeasure(o, p.auto ? leadOf(c.hostE.uid) : p.len, p); return; }
    const A = measureRef(p.a), B = measureRef(p.b);
    if (!A || !B){ o.visible = false; return; }
    const cA = A.box ? A.box.getCenter(new V3()) : A.pt, cB = B.box ? B.box.getCenter(new V3()) : B.pt;
    let pA = A.box ? A.box.clampPoint(cB, new V3()) : A.pt.clone(), pB = B.box ? B.box.clampPoint(pA, new V3()) : B.pt.clone();
    if (A.box) pA = A.box.clampPoint(pB, new V3());
    const y = Math.min(A.box ? A.box.min.y : A.pt.y, B.box ? B.box.min.y : B.pt.y) + 0.02;
    const dx = pB.x - pA.x, dz = pB.z - pA.z, d = Math.hypot(dx, dz);
    o.position.set(pA.x, y, pA.z); o.rotation.set(0, Math.atan2(dx, dz), 0); o.scale.set(1, 1, 1);
    setMeasure(o, d, p);
  } });
// ponta da medida: objeto (caixa dele) ou ponto clicado no chão
function measureRef(r){
  if (!r) return null;
  if (r.uid != null){ const e = getEntry(r.uid), ob = objects.get(r.uid); if (!e || !ob || !ob.visible) return null; return { box: boxOf(e).clone().applyMatrix4(ob.matrixWorld) }; }
  return { pt: new V3(...r.pt) };
}
function setMeasure(g, d, p){
  const { bar, t1, s } = g.userData, ok = isFinite(d) && d < 300;
  g.visible = ok; if (!ok) return;
  const L = Math.max(0.05, d); bar.scale.y = L; bar.position.z = L / 2; t1.position.z = L; s.position.set(0, 0.3, L / 2);
  const txt = (d < 10 ? d.toFixed(1) : Math.round(d)) + ' m';
  if (txt !== g.userData.last){ g.userData.last = txt; const cv = labelCanvas(txt, { tc: '#ffffff', bg: '#0b1018', bgop: .8, accent: p.color }); s.material.map.dispose(); s.material.map = texOf(cv); s.scale.set(p.size * 1.6 * cv.width / cv.height, p.size * 1.6, 1); }
}
FX({ id: 'f:highlight', name: 'Destaque (veículo detectado)', anchor: ANCHORS.center,
  defaults: { color: '#ff3b30', margin: 0.4, pulse: 1, box: 0, op: .9 },
  fields: [F.color(), F.op(), F.num('margin', 'Folga (m)', 0, 3, 0.05), ['pulse', 'Pulsar', 'chk'], ['box', 'Caixa 3D', 'chk']],
  build(p, hb){ const g = new THREE.Group(), x0 = hb.min.x - p.margin, x1 = hb.max.x + p.margin, z0 = hb.min.z - p.margin, z1 = hb.max.z + p.margin, w = 0.18, mat = fxMat(p.color, p.op), mats = [mat];
    const add = geo => { const m = new THREE.Mesh(geo, mat); m.position.y = 0.03; m.renderOrder = 3; g.add(m); };
    add(rectGeo(x0, x1, z0, z0 + w)); add(rectGeo(x0, x1, z1 - w, z1)); add(rectGeo(x0, x0 + w, z0, z1)); add(rectGeo(x1 - w, x1, z0, z1));
    add(rectGeo(x0, x1, z0, z1, .25, .25));
    if (p.box){ const bx = new THREE.Box3(new V3(x0, 0, z0), new V3(x1, hb.max.y + p.margin, z1)), bh = new THREE.Box3Helper(bx, p.color); bh.material.transparent = true; bh.material.depthTest = false; bh.renderOrder = 5; g.add(bh); mats.push(bh.material); }
    g.userData.mats = mats; return g; },
  update(o, p, c){ if (!p.pulse) return; const k = 0.55 + 0.45 * Math.sin(c.t * Math.PI * 2); o.userData.mats.forEach(m => m.opacity = p.op * k); } });
