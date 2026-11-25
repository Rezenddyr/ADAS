
/* =====================================================================
   Recursos para apresentar funções ADAS:
   - DDD / IDM: motorista pisca e pode dormir ao volante; telinha com a câmera virada para o rosto
   - Telinha com o carro em 3D em tempo real (visão de cima tipo câmera 360, girando ou por trás)
   - ACC entre veículos: o carro de trás ajusta a velocidade ao da frente para não bater
   - Ícones de aviso visual (⚠) e sonoro (🔊)
   ===================================================================== */

/* ---------- motorista: piscar e dormir ---------- */
function driverState(e, t){
  const p = e.p || {};
  const from = +p.sleepFrom || 0, to = +p.sleepTo || 0;
  if (+p.sleepOn && t >= from && (!(to > 0) || t < to)){ const cf = t - from; return { closed: true, sleeping: true, closedFor: cf, amt: Math.min(1, cf / 0.35) }; }
  const ph = (t + (e.uid * 0.77) % 3.3) % 3.6;                 // pisca a cada ~3,6 s
  const amt = (p.blink ?? 1) && ph < 0.18 ? 1 - Math.abs(ph - 0.09) / 0.09 : 0;
  return { closed: amt > 0.5, sleeping: false, closedFor: 0, amt };
}
// cada motorista ganha materiais próprios para os olhos poderem fechar sem afetar as outras pessoas
const DRIVER_LAYER = 1;
function prepRiderFace(r){
  r.traverse(c => {
    if (!c.isSkinnedMesh) return;
    c.material = c.material.map(m => m.clone());
    const eye = c.material.find(m => /eye/i.test(m.name)), skin = c.material.find(m => /skin/i.test(m.name));
    if (eye && skin) r.userData.face = { eye, open: eye.color.clone(), shut: skin.color.clone(), skin };
  });
  // pálpebra (cor da pele) + linha dos cílios sobre cada olho, presas ao osso da cabeça
  const rig = r.userData.rig, head = r.getObjectByName('head'), F = r.userData.face;
  if (!rig?.eyes?.length || !head || !F) return;
  const lidMat = new THREE.MeshStandardMaterial({ color: F.skin.color.clone(), roughness: .85 });
  r.userData.lids = rig.eyes.map(ey => {
    const w = Math.max(0.03, ey.s[0] * 1.45), hgt = Math.max(0.022, ey.s[1] * 1.6), d = Math.max(0.006, ey.s[2] * 0.7);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), lidMat);   // meia esfera: concha da pálpebra
    lid.rotation.x = Math.PI / 2;                                                                                 // a concha aponta para a frente
    const base = new V3(ey.c[0], ey.c[1] - 1.56, ey.c[2] + ey.s[2] * 0.35);                                    // relativo ao osso da cabeça
    head.add(lid);
    return { lid, base, w, h: hgt, d };
  });
  markDriverLayer(r);
}
function markDriverLayer(r){ r.traverse(c => { c.layers.enable(DRIVER_LAYER); if (c.isMesh) c.receiveShadow = false; }); }
// 0 = olho aberto, 1 = fechado
function setLids(r, amt){
  for (const L of r.userData.lids || []){
    const a = Math.max(0.001, amt);
    L.lid.visible = amt > 0.02;
    L.lid.scale.set(L.w, L.d, L.h * a);                         // depois do giro: z da esfera vira a altura
    L.lid.position.set(L.base.x, L.base.y + L.h / 2 - L.h * a / 2, L.base.z);
  }
}
function applyDriverFace(e, r, t){
  const st = driverState(e, t), F = r.userData.face;
  if (F) F.eye.color.copy(st.amt > 0.85 ? F.shut : F.open);
  setLids(r, st.amt);
  if (st.sleeping){ const B = charBones(r); if (B.head){ const k = Math.min(1, st.closedFor / 0.8); B.head.rotation.x += (0.16 + 0.04 * Math.sin(t * 1.3)) * k; B.spine.rotation.x += 0.05 * k; } }
  return st;
}

/* ---------- ACC: segue o veículo da frente sem bater ---------- */
function profileFor(e, t, stack){
  const m = e.motion, lead = m && m.acc && m.acc.lead ? getEntry(+m.acc.lead) : null;
  if (lead && lead.motion && lead.motion.type !== 'none' && !(stack && stack.has(lead.uid))) return accProfile(e, lead, t, stack);
  return profile(m, t);
}
// posição do veículo depois de andar s metros pelo seu percurso
function posAlong(e, s){
  const m = e.motion;
  if (m.type === 'route' && m.pts.length >= 2){ const { curve, L } = getCurve(e); const d = m.end === 'stop' ? Math.min(s, L) : ((s % L) + L) % L; return curve.getPointAt(clamp(d / L, 0, 1)); }
  const dir = m.flip ? -1 : 1, D = +m.loopDist || 0; let d = s;
  if (D > 0) d = m.end === 'stop' ? Math.min(s, D) : s % D;
  return new V3(e.pos[0] + Math.sin(e.rot) * d * dir, e.pos[1], e.pos[2] + Math.cos(e.rot) * d * dir);
}
const accCache = new Map();
function accProfile(e, lead, t, stack){
  const m = e.motion;
  const key = JSON.stringify([m, e.pos, e.rot, lead.motion, lead.pos, lead.rot, state.settings.duration]);
  let c = accCache.get(e.uid);
  if (!c || c.key !== key){ c = simulateAcc(e, lead, new Set([...(stack || []), e.uid])); c.key = key; accCache.set(e.uid, c); }
  const i = Math.max(0, t) / c.dt, i0 = Math.floor(i);
  if (i0 >= c.s.length - 1) return { s: c.s[c.s.length - 1], v: c.v[c.v.length - 1], started: true };
  const f = i - i0;
  return { s: c.s[i0] * (1 - f) + c.s[i0 + 1] * f, v: c.v[i0] * (1 - f) + c.v[i0 + 1] * f, started: t > (m.delay || 0) };
}
function simulateAcc(e, lead, stack){
  const m = e.motion, dt = 1 / 30, T = state.settings.duration + 1, vmax = m.speed / 3.6, hw = m.acc.hw ?? 1.8, mg = m.acc.min ?? 4;
  const lenF = (boxOf(e).max.z - boxOf(e).min.z) / 2, lenL = (boxOf(lead).max.z - boxOf(lead).min.z) / 2;
  const S = [], Vv = [];
  let s = 0, v = vmax;
  for (let t = 0; t <= T + 1e-6; t += dt){
    S.push(s); Vv.push(t < (m.delay || 0) ? 0 : v);
    if (t < (m.delay || 0)) continue;
    const lp = profileFor(lead, t, stack), pL = posAlong(lead, lp.s), pF = posAlong(e, s), pN = posAlong(e, s + 0.5);
    const hd = pN.sub(pF); hd.y = 0; if (hd.lengthSq() < 1e-6) hd.set(Math.sin(e.rot), 0, Math.cos(e.rot)); hd.normalize();
    const rel = pL.clone().sub(pF); rel.y = 0;
    const ahead = rel.dot(hd), side = Math.abs(rel.x * hd.z - rel.z * hd.x);
    let a;
    if (ahead > 0 && side < 3 && ahead < 120){
      const gap = ahead - lenF - lenL, want = mg + hw * v;
      a = 0.45 * (gap - want) + 1.1 * (lp.v - v);
      if (gap < mg * 0.6) a = -9;                                         // freada forte perto demais
    } else a = 1.2 * (vmax - v);
    a = clamp(a, -9, 2.2);
    v = clamp(v + a * dt, 0, vmax); s += v * dt;
  }
  return { dt, s: S, v: Vv };
}

/* ---------- telinhas (picture-in-picture) desenhadas dentro da imagem ---------- */
const pipCam = new THREE.PerspectiveCamera(40, 1, 0.03, 3000);
const faceLight = new THREE.PointLight(0xfff4e8, 0, 3, 1.2); scene.add(faceLight);
// as luzes da cena também valem na camada do motorista
[hemi, sun, faceLight].forEach(l => l.layers.enable(DRIVER_LAYER));
const _cc = new THREE.Color();
const PIP_TB = 28;
function placePipCam(h, e, o){
  o.updateMatrixWorld(true);
  const q = o.getWorldQuaternion(new THREE.Quaternion()), fwd = new V3(0, 0, 1).applyQuaternion(q), up = new V3(0, 1, 0).applyQuaternion(q);
  if (h.kind === 'driver'){
    const r = o.userData.rider; if (!r) return false;
    const B = charBones(r); if (!B.head) return false;
    const face = B.head.localToWorld(new V3(0, 0.13, 0.04));
    pipCam.fov = 30; pipCam.near = 0.02; pipCam.up.copy(up);
    const ws = r.getWorldScale(new V3()).x;
    pipCam.position.copy(face).add(fwd.clone().multiplyScalar(0.55 * ws)).add(up.clone().multiplyScalar(0.02 * ws));
    pipCam.lookAt(face);
    return true;
  }
  const b = boxOf(e).clone().applyMatrix4(o.matrixWorld), c = b.getCenter(new V3()), L = Math.max(3, b.getSize(new V3()).length());
  const R = +h.dist > 0 ? +h.dist : L * 1.3;
  pipCam.fov = 45; pipCam.near = 0.1;
  if (h.view === 'top'){ pipCam.up.copy(fwd); pipCam.position.copy(c).add(new V3(0, R * 1.25, 0)); pipCam.lookAt(c); }
  else if (h.view === 'chase'){ pipCam.up.set(0, 1, 0); pipCam.position.copy(c).add(fwd.clone().multiplyScalar(-R)).add(new V3(0, R * 0.45, 0)); pipCam.lookAt(c); }
  else { const a = state.t * (+h.spin || 0.5) + Math.atan2(fwd.x, fwd.z) + 0.8, el = 0.42; pipCam.up.set(0, 1, 0); pipCam.position.copy(c).add(new V3(Math.sin(a) * Math.cos(el) * R, Math.sin(el) * R, Math.cos(a) * Math.cos(el) * R)); pipCam.lookAt(c); }
  return true;
}
function renderPips(){
  const list = state.hud.filter(h => h.t === 'pip' && !h.hidden && visibleAt(h, state.t)); if (!list.length) return;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2()), pr = renderer.getPixelRatio(), sx = size.x / HW, sy = size.y / HH;
  const hv = helpers.visible, tv = tc.visible; helpers.visible = false; tc.visible = false;
  renderer.setScissorTest(true);
  for (const h of list){
    const e = getEntry(+h.target), o = e && objects.get(e.uid); if (!o || !o.visible) continue;
    if (!placePipCam(h, e, o)) continue;
    const x = (h.x + 3) * sx, w = (h.w - 6) * sx, top = h.y + PIP_TB, hh = (h.h - PIP_TB - 3) * sy, y = size.y - (top * sy + hh);
    if (w < 4 || hh < 4) continue;
    pipCam.aspect = w / hh; pipCam.updateProjectionMatrix();
    renderer.setViewport(x / pr, y / pr, w / pr, hh / pr); renderer.setScissor(x / pr, y / pr, w / pr, hh / pr);
    const hidden = [];
    if (h.kind !== 'driver' && h.iso) for (const ch of objectsGroup.children) if (ch !== o && ch.visible && !MODELS[getEntry(ch.userData.uid)?.model]?.isRoad){ ch.visible = false; hidden.push(ch); }
    const sp = sky.position.clone(); sky.position.copy(pipCam.position);
    const drv = h.kind === 'driver', cc = renderer.getClearColor(_cc).clone(), ca = renderer.getClearAlpha();
    pipCam.layers.set(drv ? DRIVER_LAYER : 0);
    if (drv){ faceLight.position.copy(pipCam.position); faceLight.intensity = 2.4; renderer.setClearColor('#3a4554', 1); }
    renderer.render(scene, pipCam);
    faceLight.intensity = 0; pipCam.layers.set(0); renderer.setClearColor(cc, ca);
    sky.position.copy(sp); hidden.forEach(ch => ch.visible = true);
  }
  renderer.setScissorTest(false); renderer.setViewport(0, 0, size.x / pr, size.y / pr);
  helpers.visible = hv; tc.visible = tv;
}
const vehicleOpts = kind => [['', '— escolha o veículo —'], ...state.entries.filter(x => MODELS[x.model]?.isVehicle && (kind !== 'driver' || x.p?.driver)).map(x => [String(x.uid), entryName(x) + (x.p?.driver ? ' 🧑' : '')])];
function drawPip(e, exp){
  const w = e.w, h = e.h, ac = e.accent || '#00e5ff', ve = getEntry(+e.target);
  const title = e.title || (e.kind === 'driver' ? 'DDD · Monitoramento do motorista' : 'Câmera 360° · ' + (ve ? MODELS[ve.model].name : 'veículo'));
  let o = `<path d="M1 13a12 12 0 0 1 12-12H${w - 13}a12 12 0 0 1 12 12V${PIP_TB}H1Z" fill="#0b1018" fill-opacity=".94"/>` + TXT(12, PIP_TB / 2 + 1, title, 13, '#e8f1ff', 'start', 700);
  const msg = t => `<rect x="3" y="${PIP_TB}" width="${w - 6}" height="${h - PIP_TB - 3}" fill="#05070a" fill-opacity=".85"/>` + TXT(w / 2, PIP_TB + (h - PIP_TB) / 2, t, 13, '#94a3b8', 'middle', 600);
  if (!ve || !objects.get(ve.uid)) o += msg('Escolha o veículo no painel da direita');
  else if (e.kind === 'driver'){
    if (!objects.get(ve.uid).userData.rider) o += msg('Coloque uma pessoa dirigindo este veículo');
    else if (e.overlay ?? 1){
      const st = driverState(ve, state.t), alarm = st.sleeping && st.closedFor >= 2, col = alarm ? '#ef4444' : st.sleeping ? '#f59e0b' : '#22c55e';
      const vh = h - PIP_TB, cx = w / 2, cy = PIP_TB + vh * 0.42, bw = vh * 0.46, bh = bw * 1.2, x0 = cx - bw / 2, y0 = cy - bh / 2, k = bw * 0.24;
      if (alarm) o += `<rect x="6" y="${PIP_TB + 3}" width="${w - 12}" height="${vh - 9}" rx="6" fill="none" stroke="#ef4444" stroke-width="6" opacity="${Math.sin(state.t * 9) > 0 ? .95 : .3}"/>`;
      o += `<g fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round">` + [[x0, y0, 1, 1], [x0 + bw, y0, -1, 1], [x0, y0 + bh, 1, -1], [x0 + bw, y0 + bh, -1, -1]].map(([x, y, a2, b2]) => `<path d="M${x} ${y + b2 * k}V${y}H${x + a2 * k}"/>`).join('') + '</g>';
      const txt = alarm ? '⚠ SONO DETECTADO' : st.sleeping ? 'OLHOS FECHADOS…' : '✓ ATENTO';
      o += `<rect x="${w / 2 - 110}" y="${h - 44}" width="220" height="34" rx="17" fill="${col}"/>` + TXT(w / 2, h - 27, txt, 16, '#ffffff', 'middle', 800);
    }
  } else if (e.overlay ?? 1){
    o += `<rect x="${w - 52}" y="${PIP_TB + 8}" width="42" height="20" rx="5" fill="#0b1018" fill-opacity=".8" stroke="${ac}"/>` + TXT(w - 31, PIP_TB + 18.5, '360°', 11, ac, 'middle', 800);
    if (e.view === 'top') o += `<path d="M${w / 2} ${PIP_TB + 10}l7 10h-14z" fill="${ac}" opacity=".8"/>`;
  }
  o += `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="12" fill="none" stroke="${ac}" stroke-width="2.5"/>`;
  return o;
}
function addPip(kind, uid){
  addHud('pip'); const h = hudById(state.hudSel); if (!h) return;
  h.kind = kind; h.target = String(uid); if (kind === 'car360'){ h.view = 'top'; h.y = 130 + 270; }
  hudDirty = true; renderProps(); scheduleSave();
}

/* ---------- ícones de aviso visual / sonoro ---------- */
function speakerCanvas(bg){
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  x.fillStyle = bg; roundRect(x, 16, 16, 224, 224, 48); x.fill();
  x.fillStyle = '#ffffff'; x.beginPath(); x.moveTo(56, 104); x.lineTo(96, 104); x.lineTo(140, 64); x.lineTo(140, 192); x.lineTo(96, 152); x.lineTo(56, 152); x.closePath(); x.fill();
  x.strokeStyle = '#ffffff'; x.lineWidth = 14; x.lineCap = 'round';
  for (const r of [30, 58]){ x.beginPath(); x.arc(150, 128, r, -0.75, 0.75); x.stroke(); }
  return c;
}
let lastVis = new Map();
function hudSoundCues(){
  for (const h of state.hud){
    const snd = (h.t === 'sound' && (h.beep ?? 1)) || (h.t === 'alert' && h.show === 'always' && (h.bSnd ?? 1));
    if (!snd) continue;
    const vis = !h.hidden && visibleAt(h, state.t), was = lastVis.get(h.id);
    if (vis && was === false && state.playing) beep(h.t === 'alert' ? (h.sev || ALK[h.kind]?.[3] || 'warning') : 'warning');
    lastVis.set(h.id, vis);
  }
}
Object.assign(HUDT, {
  pip: { name: 'Telinha: motorista (DDD) ou carro 3D (360°)', w: 380, h: 250, d: { kind: 'driver', target: '', view: 'top', dist: 0, spin: 0.5, iso: 0, title: '', overlay: 1, accent: '#00e5ff' },
    f: e => [['kind', 'O que mostrar', 'sel', [['driver', 'Câmera no rosto do motorista (DDD / IDM)'], ['car360', 'Carro em 3D em tempo real (360°)']]], ['target', 'Veículo', 'sel', vehicleOpts(e.kind)],
      ...(e.kind === 'car360' ? [['view', 'Visão', 'sel', [['top', 'De cima (como a câmera 360)'], ['orbit', 'Girando em volta'], ['chase', 'Por trás']]], F.num('dist', 'Distância (m, 0 = automática)', 0, 200, 0.5), F.num('spin', 'Velocidade do giro', 0.05, 3, 0.05), ['iso', 'Mostrar só o carro (esconde os outros objetos)', 'chk']] : []),
      ['title', 'Título (vazio = automático)', 'text'], ['overlay', e.kind === 'driver' ? 'Mostrar rastreio do rosto e estado dos olhos' : 'Mostrar selo 360°', 'chk'], F.color('accent', 'Cor da moldura')],
    r: drawPip },
  risk: { name: 'Ícone de aviso visual ⚠', w: 100, h: 116, d: { color: '#f59e0b', label: 'Aviso visual', pulse: 1 },
    f: [F.color('color', 'Cor'), ['label', 'Texto embaixo', 'text'], ['pulse', 'Pulsar', 'chk']],
    r: e => { const s = Math.min(e.w, e.h - (e.label ? 26 : 0)) * 0.8, k = e.pulse ? 0.88 + 0.12 * Math.abs(Math.sin(state.t * 4)) : 1;
      return `<rect width="${e.w}" height="${e.h}" rx="14" fill="#0b1018" fill-opacity=".85" stroke="${e.color}" stroke-opacity=".7" stroke-width="2"/>`
        + `<g transform="translate(${e.w / 2} ${s / 2 + (e.h - s - (e.label ? 26 : 0)) / 2}) scale(${k}) translate(${-s / 2} ${-s / 2})">${ICO('tri', e.color, 0, 0, s)}</g>`
        + (e.label ? TXT(e.w / 2, e.h - 14, e.label, 12.5, '#e2e8f0', 'middle', 700) : ''); } },
  sound: { name: 'Ícone de aviso sonoro 🔊', w: 100, h: 116, d: { color: '#38bdf8', label: 'Aviso sonoro', beep: 1 },
    f: [F.color('color', 'Cor'), ['label', 'Texto embaixo', 'text'], ['beep', 'Tocar bipe quando aparecer (vai para o vídeo)', 'chk']],
    r: e => { const s = Math.min(e.w, e.h - (e.label ? 26 : 0)) * 0.8, ox = (e.w - s) / 2, oy = (e.h - s - (e.label ? 26 : 0)) / 2, u = s / 24;
      const waves = [0, 1, 2].map(i => { const ph = (state.t * 1.6 + i / 3) % 1; return `<path d="M${ox + 14 * u} ${oy + (12 - 3 - i * 2.5) * u}a${(3 + i * 2.5) * u} ${(3 + i * 2.5) * u} 0 0 1 0 ${(6 + i * 5) * u}" fill="none" stroke="${e.color}" stroke-width="${1.8 * u}" stroke-linecap="round" opacity="${(1 - ph * 0.7).toFixed(2)}"/>`; }).join('');
      return `<rect width="${e.w}" height="${e.h}" rx="14" fill="#0b1018" fill-opacity=".85" stroke="${e.color}" stroke-opacity=".7" stroke-width="2"/>`
        + `<path d="M${ox + 3 * u} ${oy + 9 * u}h${3.5 * u}l${4.5 * u} ${-4 * u}v${14 * u}l${-4.5 * u} ${-4 * u}h${-3.5 * u}z" fill="${e.color}" filter="url(#glow)"/>` + waves
        + (e.label ? TXT(e.w / 2, e.h - 14, e.label, 12.5, '#e2e8f0', 'middle', 700) : ''); } }
});
HUD_ORDER.push('pip', 'risk', 'sound');

/* ---------- rótulo de velocidade ao vivo (para mostrar os dois carros do ACC) ---------- */
FX({ id: 'f:speedtag', name: 'Velocidade ao vivo (rótulo)', anchor: ANCHORS.top,
  defaults: { size: 0.6, accent: '#00e5ff', tc: '#ffffff' },
  fields: [F.num('size', 'Tamanho do texto (m)', 0.2, 4, 0.05), F.color('accent', 'Destaque'), F.color('tc', 'Cor do texto')],
  build(p){ const g = new THREE.Group(), cv = labelCanvas('0 km/h', { tc: p.tc, bg: '#0b1018', bgop: .85, accent: p.accent }), s = makeSprite(cv, p.size * 1.6); g.add(s); g.userData = { s, last: '' }; return g; },
  update(o, p, c){
    const v = c.host ? (c.host.userData.moveV || 0) : 0, txt = Math.round(v * 3.6) + ' km/h';
    if (txt !== o.userData.last){ o.userData.last = txt; const s = o.userData.s, cv = labelCanvas(txt, { tc: p.tc, bg: '#0b1018', bgop: .85, accent: p.accent }); s.material.map.dispose(); s.material.map = texOf(cv); s.scale.set(p.size * 1.6 * cv.width / cv.height, p.size * 1.6, 1); }
  } });

/* ---------- demonstração DDD em 1 clique ---------- */
function demoDDD(e){
  pushHistory();
  const t0 = Math.max(1, +state.t.toFixed(1) || 2);
  e.p = { ...(e.p || {}), driver: e.p?.driver || Object.keys(CHARS)[0], blink: 1, sleepOn: 1, sleepFrom: t0, sleepTo: 0 };
  rebuildEntry(e); changed();
  if (!state.hud.some(h => h.t === 'pip' && h.kind === 'driver' && +h.target === e.uid)) addPip('driver', e.uid);
  if (!state.hud.some(h => h.t === 'alert' && h.kind === 'drowsy' && h.ddd === e.uid)){
    const D = HUDT.alert, al = { id: nextUid++, t: 'alert', w: D.w, h: D.h, op: 1, from: +(t0 + 2).toFixed(1), to: 0, ...JSON.parse(JSON.stringify(D.d)), kind: 'drowsy', show: 'always', ddd: e.uid };
    al.x = HW - al.w - 20; al.y = 20; state.hud.push(al);
  }
  hudDirty = true; renderLayers(); scheduleSave(); select(e.uid);
  toast(`DDD ligado: o motorista fecha os olhos aos ${t0} s e o sistema detecta 2 s depois. Aperte ▶.`);
}
function offDDD(e){
  pushHistory();
  e.p = { ...(e.p || {}), sleepOn: 0 };
  state.hud = state.hud.filter(h => !((h.t === 'pip' && h.kind === 'driver' && +h.target === e.uid) || (h.t === 'alert' && h.kind === 'drowsy' && h.ddd === e.uid)));
  rebuildEntry(e); changed(); hudDirty = true; renderLayers(); scheduleSave(); select(e.uid);
  toast('DDD desligado');
}

/* ---------- banco do motorista (aparece só na telinha do DDD, sobre fundo liso) ---------- */
function buildCabin(o, seat, k){
  const g = new THREE.Group(), { x: sx, y: sy, z: sz } = seat;
  const M = c => new THREE.MeshStandardMaterial({ color: c, roughness: .9 });
  const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };
  const fabric = M('#1d2026'), trim = M('#4a515c');
  // banco do motorista: encosto e apoio de cabeça
  box(0.52 * k, 0.62 * k, 0.12 * k, sx, sy + 0.33 * k, sz - 0.24 * k, fabric);
  box(0.30 * k, 0.20 * k, 0.11 * k, sx, sy + 0.82 * k, sz - 0.27 * k, fabric);
  box(0.04 * k, 0.12 * k, 0.04 * k, sx - 0.08 * k, sy + 0.68 * k, sz - 0.27 * k, trim); box(0.04 * k, 0.12 * k, 0.04 * k, sx + 0.08 * k, sy + 0.68 * k, sz - 0.27 * k, trim);
  g.traverse(c => c.layers.set(DRIVER_LAYER));                                          // invisível na cena principal
  g.userData.cabin = true; o.add(g);
}
