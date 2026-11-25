
/* =====================================================================
   Personagens (LowPolyCharacterPack): esqueleto automático + poses animadas
   Os FBX vêm sem esqueleto e em pose A; aqui cada um ganha ossos (quadril, tronco, cabeça,
   braço/antebraço, coxa/canela) com pesos calculados pela posição de cada vértice.
   Poses: em pé, andando, sentado, acenando, dirigindo, pilotando moto e pedalando.
   ===================================================================== */
const CHARS = {};
const CHAR_NAMES = { LowPolyCharacter1: 'Homem de blusa azul', LowPolyCharacter2: 'Homem de chapéu', LowPolyCharacter3: 'Homem de blusa vinho', LowPolyCharacter4: 'Mulher de blusa verde' };
const BONE_NAMES = ['hips', 'spine', 'head', 'uaL', 'laL', 'uaR', 'laR', 'ulL', 'llL', 'ulR', 'llR'];
const HIP_Y = 0.95;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function rigCharacter(src){
  // o GLB vem com uma malha por material: junta tudo numa malha só (um grupo por material)
  const meshes = []; src.updateMatrixWorld(true); src.traverse(c => { if (c.isMesh) meshes.push(c); });
  const geos = meshes.map(m => { const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()); g.applyMatrix4(m.matrixWorld); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; });
  const geo = BufferGeometryUtils.mergeGeometries(geos, true);
  const mesh = { material: meshes.map(m => m.material) };
  const pos = geo.attributes.position, n = pos.count;
  // mão = vértice mais distante do centro; ombro e cotovelo a partir dela
  let tip = [0.7, 0.94];
  for (let i = 0; i < n; i++){ const x = Math.abs(pos.getX(i)); if (x > tip[0] - 1e-6 && pos.getY(i) > 0.8){ tip = [x, pos.getY(i)]; } }
  const S = [0.19, 1.45], E = [S[0] + (tip[0] - S[0]) * 0.45, S[1] + (tip[1] - S[1]) * 0.45];
  const J = { hips: [0, HIP_Y, 0], spine: [0, 1.12, 0], head: [0, 1.56, 0], uaL: [S[0], S[1], 0], laL: [E[0], E[1], 0], uaR: [-S[0], S[1], 0], laR: [-E[0], E[1], 0],
    ulL: [0.11, 0.92, 0], llL: [0.11, 0.5, 0], ulR: [-0.11, 0.92, 0], llR: [-0.11, 0.5, 0] };
  const parent = { spine: 'hips', head: 'spine', uaL: 'spine', laL: 'uaL', uaR: 'spine', laR: 'uaR', ulL: 'hips', llL: 'ulL', ulR: 'hips', llR: 'ulR' };
  const bones = {}, list = [];
  for (const nm of BONE_NAMES){
    const b = new THREE.Bone(); b.name = nm; bones[nm] = b; list.push(b);
    const p = parent[nm], a = J[nm];
    if (p){ const pa = J[p]; b.position.set(a[0] - pa[0], a[1] - pa[1], a[2] - pa[2]); bones[p].add(b); } else b.position.set(...a);
  }
  const idx = new Uint16Array(n * 4), wt = new Float32Array(n * 4), I = nm => BONE_NAMES.indexOf(nm);
  const dx = tip[0] - S[0], dy = tip[1] - S[1], L = Math.hypot(dx, dy);
  for (let i = 0; i < n; i++){
    const x = pos.getX(i), y = pos.getY(i), ax = Math.abs(x), L_ = x >= 0 ? 'L' : 'R';
    const t = ((ax - S[0]) * dx + (y - S[1]) * dy) / (L * L), perp = Math.abs((ax - S[0]) * dy - (y - S[1]) * dx) / L;
    const inf = [];
    const wArm = perp < 0.17 && y > 0.86 ? smooth(-0.07, 0.07, t) : 0;
    const wLeg = ax < 0.32 && y < 1.0 ? smooth(0.99, 0.84, y) : 0;
    const wHead = ax < 0.2 ? smooth(1.52, 1.62, y) : 0;
    if (wArm > 0){ const lo = smooth(0.40, 0.50, t); inf.push([I('ua' + L_), wArm * (1 - lo)], [I('la' + L_), wArm * lo], [I('spine'), 1 - wArm]); }
    else if (wLeg > 0){ const lo = smooth(0.56, 0.45, y); inf.push([I('ul' + L_), wLeg * (1 - lo)], [I('ll' + L_), wLeg * lo], [I('hips'), 1 - wLeg]); }
    else if (wHead > 0) inf.push([I('head'), wHead], [I('spine'), 1 - wHead]);
    else { const sp = smooth(1.0, 1.2, y); inf.push([I('spine'), sp], [I('hips'), 1 - sp]); }
    inf.slice(0, 4).forEach(([b, w], k) => { idx[i * 4 + k] = b; wt[i * 4 + k] = w; });
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));
  const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(m => { const c = m.clone(); c.roughness = .85; c.metalness = 0; return c; });
  const sm = new THREE.SkinnedMesh(geo, mats); sm.castShadow = true; sm.receiveShadow = true; sm.frustumCulled = false;
  sm.add(bones.hips); sm.bind(new THREE.Skeleton(list));
  // posição e tamanho de cada olho (vértices do material "Eye"), para as pálpebras
  const eyes = [], eyeIdx = mesh.material.findIndex(m => /eye/i.test(m.name || ''));
  if (eyeIdx >= 0){
    const pts = { 1: [], '-1': [] };
    for (const g of geo.groups) if (g.materialIndex === eyeIdx) for (let i = g.start; i < g.start + g.count; i++){ const x = pos.getX(i); pts[x >= 0 ? 1 : -1].push([x, pos.getY(i), pos.getZ(i)]); }
    for (const sd of [1, -1]){ const P = pts[sd]; if (!P.length) continue;
      const mn = [0, 1, 2].map(k => P.reduce((a, p) => Math.min(a, p[k]), 9)), mx = [0, 1, 2].map(k => P.reduce((a, p) => Math.max(a, p[k]), -9));
      eyes.push({ c: mn.map((v, k) => (v + mx[k]) / 2), s: mx.map((v, k) => v - mn[k]) }); }
  }
  const root = new THREE.Group(); root.add(sm); root.userData.rig = { S, E, tip, eyes };
  setPose(root, 'stand', { t: 0 });
  return root;
}
function cloneChar(file){ const src = CHARS[file] || Object.values(CHARS)[0], c = SkeletonUtils.clone(src); c.userData = { rig: src.userData.rig }; return c; }
function charBones(o){
  if (!o.userData.cb){ const cb = {}; BONE_NAMES.forEach(nm => cb[nm] = o.getObjectByName(nm)); o.userData.cb = cb; }
  return o.userData.cb;
}
// aplica uma pose; ctx: t (tempo), s (distância andada), v (velocidade m/s)
function setPose(o, pose, ctx){
  const B = charBones(o); if (!B.hips) return;
  const t = ctx.t || 0, s = ctx.s || 0, v = ctx.v || 0, A = 0.66;
  BONE_NAMES.forEach(nm => B[nm].rotation.set(0, 0, 0));
  B.hips.position.set(0, HIP_Y, 0);
  B.uaL.rotation.set(0, 0, -A + 0.08); B.uaR.rotation.set(0, 0, A - 0.08);
  const legs = (th, kn, spread = 0) => { B.ulL.rotation.set(th, 0, spread); B.ulR.rotation.set(th, 0, -spread); B.llL.rotation.x = kn; B.llR.rotation.x = kn; };
  const arms = (fx, side, el) => { B.uaL.rotation.set(fx, 0, -A + side); B.uaR.rotation.set(fx, 0, A - side); B.laL.rotation.x = el; B.laR.rotation.x = el; };
  switch (pose){
    case 'walk': case 'run':
      if (o.userData.rig){ gaitIK(o, B, ctx, pose === 'run'); break; }
      { const ph = s / 0.8 * Math.PI, w = Math.sin(ph) * 0.5; B.ulL.rotation.x = -w; B.ulR.rotation.x = w; B.uaL.rotation.x = w * 0.9; B.uaR.rotation.x = -w * 0.9; }
      break;
    case 'sit':
      legs(-1.5, 1.5, 0.05); if (!ctx.rider) B.hips.position.y = HIP_Y - 0.48; arms(-0.45, 0.15, -0.9); B.head.rotation.y = 0.15 * Math.sin(t * 0.7);
      break;
    case 'wave':
      B.uaR.rotation.set(0, 0, -1.95); B.laR.rotation.set(0, 0, -0.45 + 0.4 * Math.sin(t * 7)); B.head.rotation.z = 0.05;
      break;
    case 'drive':
      legs(-1.42, 1.3, 0.08); B.spine.rotation.x = -0.12; arms(-1.0, 0.32, -0.75);
      B.head.rotation.y = 0.12 * Math.sin(t * 0.6); B.uaL.rotation.y = B.uaR.rotation.y = 0.04 * Math.sin(t * 0.9);
      break;
    case 'ride':
      if (ctx.ride && o.userData.rig){ rideIK(o, B, ctx); break; }
      legs(-1.1, 1.75, 0.22); B.spine.rotation.x = 0.38; arms(-1.25, 0.35, -0.3); B.head.rotation.x = -0.3;
      break;
    case 'moto':
      legs(-1.1, 1.75, 0.22); B.spine.rotation.x = 0.38; arms(-1.25, 0.35, -0.3); B.head.rotation.x = -0.3;
      break;
    case 'bike': {
      const f = s * 2.3, a = Math.sin(f), b = Math.sin(f + Math.PI);
      B.ulL.rotation.set(-1.25 + 0.38 * a, 0, 0.06); B.ulR.rotation.set(-1.25 + 0.38 * b, 0, -0.06);
      B.llL.rotation.x = 1.35 - 0.55 * a; B.llR.rotation.x = 1.35 - 0.55 * b;
      B.spine.rotation.x = 0.5; arms(-1.35, 0.3, -0.2); B.head.rotation.x = -0.45;
      break; }
    default:   // em pé, respirando
      B.spine.rotation.x = 0.015 * Math.sin(t * 1.6); B.head.rotation.y = 0.1 * Math.sin(t * 0.5);
  }
}
/* pessoa dentro do veículo: banco e pose de acordo com o tipo de veículo */
const DRIVER_OPTS = () => [['', 'Ninguém'], ...Object.keys(CHARS).map(k => [k, CHAR_NAMES[k] || k])];
/* ---------- cinemática inversa (2 ossos): braço até a manopla, perna até o pedal ---------- */
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
function ik2(bA, bB, S, T, la, lb, pole, restA, restB, parentQ){
  const v = T.clone().sub(S), d = clamp(v.length(), Math.abs(la - lb) + 1e-3, (la + lb) * 0.999), dir = v.normalize();
  const cA = clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1), sA = Math.sqrt(1 - cA * cA);
  const perp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))); if (perp.lengthSq() < 1e-6) perp.set(0, 0, 1); perp.normalize();
  const E = S.clone().add(dir.clone().multiplyScalar(la * cA)).add(perp.multiplyScalar(la * sA)), W = S.clone().add(dir.clone().multiplyScalar(d));
  const u = E.clone().sub(S).normalize(), f = W.clone().sub(E).normalize();
  _q.copy(parentQ).invert(); bA.quaternion.setFromUnitVectors(restA, u.applyQuaternion(_q));
  _q2.copy(parentQ).multiply(bA.quaternion).invert(); bB.quaternion.setFromUnitVectors(restB, f.applyQuaternion(_q2));
}
// pontos de apoio de cada veículo de 2 rodas (medidos nos modelos: banco, manoplas, pedivela/pedaleiras)
const RIDE = {
  bicycle:   { seat: [0.93, -0.19], grip: [0.22, 0.975, 0.40], pedal: { c: [0.36, -0.05], r: 0.17, x: 0.13 }, lean: 0.42, knee: 0.08, reach: 0.88 },
  motorbike: { seat: [0.93, -0.32], grip: [0.32, 1.00, 0.58], peg: [0.21, 0.40, -0.12], lean: 0.22, knee: 0.55, reach: 0.86 },
  scooter:   { seat: [0.79, -0.42], grip: [0.27, 0.99, 0.58], peg: [0.13, 0.27, 0.12], lean: 0.02, knee: 0.25, reach: 0.86 }
};
function rideIK(o, B, ctx){
  const R = ctx.ride, A = R.a, rig = o.userData.rig, k = R.k, P = R.pos;
  const toC = (x, y, z) => new V3((x - P[0]) / k, (y - P[1]) / k, (z - P[2]) / k);
  const L = Math.hypot(rig.tip[0] - rig.S[0], rig.tip[1] - rig.S[1]), la = 0.45 * L, lb = 0.42 * L;
  const pv = new V3(0, 1.12, 0), shoulder = (sd, lam) => { const r = new V3(sd * rig.S[0], rig.S[1] - 1.12, 0).applyAxisAngle(new V3(1, 0, 0), lam); return pv.clone().add(r); };
  const wrist = sd => toC(sd * A.grip[0], A.grip[1] + 0.02, A.grip[2] - 0.07);
  // inclina o tronco só o necessário para as mãos alcançarem o guidão
  let lam = A.lean;
  for (; lam < 1.1; lam += 0.03) if (shoulder(1, lam).distanceTo(wrist(1)) <= (A.reach || 0.9) * (la + lb)) break;
  // na bicicleta o quadril acompanha a pedalada
  const sway = A.pedal ? 0.05 * Math.sin((ctx.s || 0) * 1.6) : 0;
  B.hips.rotation.set(0, 0, sway); const hq = B.hips.quaternion.clone();
  B.spine.rotation.set(lam, 0, -sway * 1.2); B.head.rotation.set(-lam * 0.75, 0.06 * Math.sin((ctx.t || 0) * 0.8), 0);
  const spineQ = new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), lam), I = new THREE.Quaternion();
  for (const sd of [1, -1]){
    const s = sd > 0 ? 'L' : 'R';
    const restA = new V3(sd * (rig.E[0] - rig.S[0]), rig.E[1] - rig.S[1], 0).normalize();
    ik2(B['ua' + s], B['la' + s], shoulder(sd, lam), wrist(sd), la, lb, new V3(sd * 0.8, -1, -0.3).normalize(), restA, restA, spineQ);
    let foot;
    if (A.pedal){ const ph = (ctx.s || 0) * 1.6 + (sd > 0 ? 0 : Math.PI); foot = toC(sd * A.pedal.x, A.pedal.c[0] + A.pedal.r * Math.sin(ph), A.pedal.c[1] + A.pedal.r * Math.cos(ph)); }
    else foot = toC(sd * A.peg[0], A.peg[1], A.peg[2]);
    foot.y += 0.075; foot.z -= 0.03;
    const hipJ = new V3(sd * 0.11, -0.03, 0).applyQuaternion(hq).add(new V3(0, HIP_Y, 0));
    ik2(B['ul' + s], B['ll' + s], hipJ, foot, 0.42, 0.42, new V3(sd * (A.knee ?? 0.12), 0, 1).normalize(), new V3(0, -1, 0), new V3(0, -1, 0), hq);
  }
}
/* ---------- marcha: pés plantados no chão (sem afundar nem deslizar) ----------
   Cada perna alterna apoio (pé parado no chão enquanto o corpo passa) e balanço (pé sobe e vai à frente).
   Corrida: apoio mais curto, fase no ar, joelho alto, braços dobrados e tronco inclinado. */
function gaitIK(o, B, ctx, forceRun){
  const v = ctx.v || 0, t = ctx.t || 0;
  // parado mas com pose de andar/correr: anda no lugar
  const sv = v > 0.05 ? (ctx.s || 0) : t * (forceRun ? 3.2 : 1.3), vv = v > 0.05 ? v : (forceRun ? 3.2 : 1.3);
  const run = forceRun || vv > 2.3, k = run ? clamp((vv - 1.8) / 2, 0.35, 1) : 0;   // k: intensidade da corrida
  const cycle = run ? clamp(1.7 + 0.42 * vv, 2.0, 4.6) : clamp(1.15 + 0.3 * vv, 1.15, 1.8);   // metros por passada dupla
  const duty = run ? 0.38 : 0.6, Ls = cycle * duty * (run ? 0.8 : 0.62), lift = run ? 0.12 + 0.12 * k : 0.06;
  const p0 = (sv / cycle) % 1;
  const L1 = 0.42, L2 = 0.42, I = new THREE.Quaternion();
  const footAt = ph => {                                       // posição do tornozelo (frente/trás, altura) numa fase 0..1
    if (ph < duty){ const u = ph / duty, z = Ls / 2 - Ls * u; return { z, y: 0.08 + 0.32 * Math.max(0, -z), st: 1 }; }   // calcanhar sobe quando o pé fica para trás
    const u = (ph - duty) / (1 - duty), e = 0.5 - 0.5 * Math.cos(Math.PI * u);
    return { z: -Ls / 2 + Ls * e, y: 0.08 + lift * Math.sin(Math.PI * u) * (run ? 1.2 : 1), st: 0 };
  };
  const fL = footAt(p0), fR = footAt((p0 + 0.5) % 1);
  // quadril: desce para a perna de apoio alcançar o chão; na corrida sobe na fase no ar
  const reach = (L1 + L2) * (run ? 0.95 : 0.99);
  const hipFor = f => f.y + Math.sqrt(Math.max(0.1, reach * reach - f.z * f.z));
  let hy = Math.min(fL.st ? hipFor(fL) : 9, fR.st ? hipFor(fR) : 9);
  if (hy > 5) hy = hipFor({ z: 0 }) + (run ? 0.05 * k : 0);   // os dois pés no ar (corrida)
  hy -= run ? 0.06 * k : 0.005;
  const lean = run ? 0.12 + 0.14 * k : 0.045;
  B.hips.position.set(0, hy + (HIP_Y - 0.92), 0);
  B.hips.rotation.set(0, 0, 0.035 * Math.sin(2 * Math.PI * p0));       // leve balanço lateral do quadril
  const hq = B.hips.quaternion.clone();
  for (const [sd, f, s] of [[1, fL, 'L'], [-1, fR, 'R']]){
    const hip = new V3(sd * 0.11, -0.03, 0).applyQuaternion(hq).add(new V3(0, hy + (HIP_Y - 0.92), 0));
    const ankle = new V3(sd * 0.1, f.y, f.z + 0.03);
    ik2(B['ul' + s], B['ll' + s], hip, ankle, L1, L2, new V3(sd * 0.05, 0, 1).normalize(), new V3(0, -1, 0), new V3(0, -1, 0), hq);
  }
  // tronco: inclina para a frente correndo e gira contra o quadril; braços opostos às pernas
  const sw = fL.z / (Ls / 2 || 1);                              // +1 pé esquerdo à frente
  B.spine.rotation.set(lean, 0.13 * sw * (run ? 1.3 : 1), 0);
  B.head.rotation.set(-lean * 0.8, -0.1 * sw, 0);
  const A = 0.66, amp = run ? 0.75 + 0.35 * k : 0.38 + 0.12 * Math.min(1, vv / 1.6);
  B.uaL.rotation.set(sw * amp, 0, -A + (run ? 0.2 : 0.1)); B.uaR.rotation.set(-sw * amp, 0, A - (run ? 0.2 : 0.1));
  const elbow = run ? -1.45 : -0.35;
  B.laL.rotation.set(elbow - (run ? 0.25 * Math.max(0, -sw) : 0.25 * Math.max(0, -sw)), 0, 0);
  B.laR.rotation.set(elbow - (run ? 0.25 * Math.max(0, sw) : 0.25 * Math.max(0, sw)), 0, 0);
}
function riderSeat(info, box){
  const f = info.file || '', L = box.max.z - box.min.z, H = box.max.y, hw = (box.max.x - box.min.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const rd = RIDE[f]; if (rd) return { x: 0, y: rd.seat[0] + 0.1, z: rd.seat[1], pose: 'ride', ride: rd };
  if (/jet_ski/.test(f)) return { x: 0, y: H * 0.76, z: cz - 0.15, pose: 'moto' };
  if (/bus|truck|van|ambulance|tanker/.test(f) && !/pickup/.test(f)) return { x: hw * 0.45, y: H * 0.4, z: box.max.z - 1.25, pose: 'drive' };
  if (/pickup/.test(f)) return { x: hw * 0.4, y: H * 0.34, z: cz + L * 0.08, pose: 'drive' };
  if (/forklift/.test(f)) return { x: 0, y: H * 0.42, z: cz - 0.35, pose: 'drive' };
  if (/golf/.test(f)) return { x: hw * 0.4, y: H * 0.32, z: cz, pose: 'drive' };
  if (/boat/.test(f)) return { x: 0, y: H * 0.3, z: cz - L * 0.15, pose: 'sit' };
  return { x: hw * 0.4, y: H * 0.34, z: cz - L * 0.02, pose: 'drive' };
}
function addRider(o, info, e){
  const file = e.p?.driver; if (!file || !CHARS[file]) return;
  const box = info.box, seat = riderSeat(info, box);
  const sx = seat.x + (+e.p.dxs || 0), sy = seat.y + (+e.p.dys || 0), sz = seat.z + (+e.p.dzs || 0);
  // cabe embaixo do teto (carros baixos encolhem um pouco a pessoa)
  const fit = seat.pose === 'drive' || seat.pose === 'sit' ? clamp((box.max.y - 0.1 - sy) / 0.86, 0.55, 1) : 1;
  const k = fit * (+e.p.dss || 1);
  const r = cloneChar(file); r.scale.setScalar(k); r.position.set(sx, sy - HIP_Y * k, sz);
  prepRiderFace(r); r.userData.pose = seat.pose; o.add(r); o.userData.rider = r;
  if (seat.pose === 'drive') buildCabin(o, { x: sx, y: sy, z: sz }, k);
  if (seat.ride) r.userData.ride = { a: seat.ride, k, pos: r.position.toArray() };
  // vidros transparentes para ver o motorista
  if (seat.pose === 'drive') o.traverse(c => { if (c.isMesh && !c.isSkinnedMesh){ const ms = Array.isArray(c.material) ? c.material : [c.material]; const nm = ms.map(m => /glass/i.test(m.name) ? Object.assign(m.clone(), { transparent: true, opacity: 0.35, depthWrite: false }) : m); c.material = Array.isArray(c.material) ? nm : nm[0]; } });
}

/* personagens como pedestres (Pessoas e natureza) */
for (const file of Object.keys(CHAR_NAMES)) P({ id: 'h:' + file, name: CHAR_NAMES[file], cat: 'Pessoas e natureza', ped: true, movable: true, solid: true,
  defaults: { pose: 'auto' },
  fields: [['pose', 'Pose', 'sel', [['auto', 'Automática (anda ou corre pela velocidade; parado fica em pé)'], ['walk', 'Andando'], ['run', 'Correndo'], ['sit', 'Sentado (banco, ponto de ônibus)'], ['wave', 'Acenando'], ['stand', 'Em pé parado']]]],
  build(){ return cloneChar(file); },
  update(o, p, c){ const mv = o.userData.moveV || 0, pose = p.pose === 'auto' ? (mv > 2.3 ? 'run' : mv > 0.05 ? 'walk' : 'stand') : p.pose; setPose(o, pose, { t: c.t, s: o.userData.moveS, v: o.userData.moveV }); } });
