
/* =====================================================================
   Interação, painéis, câmeras, passos, exportação e inicialização
   ===================================================================== */
const hasRoute = e => e.motion && e.motion.type === 'route' && e.motion.pts.length >= 2;
const isWorldFx = e => (e.parent && MODELS[e.model]?.world) || (e.model === 'f:measure' && !e.parent);
function entryName(e){ const i = MODELS[e.model]; return (i ? i.name : e.model) + ' #' + e.uid; }

/* ---------------- seleção ---------------- */
const isMoving = e => !!(e && e.motion && e.motion.type !== 'none');
function syncGizmo(force){
  if (state.markerIdx != null) return;
  if (state.multi.length > 1){
    if (!state.preview && !state.playing && groupMovable()){ if (force || tc.object !== groupPivot) attachGroupPivot(); } else tc.detach();
    return;
  }
  const e = selEntry();
  const ok = e && !state.preview && !state.playing && !isWorldFx(e) && !(isMoving(e) && state.t > 0.001);
  if (ok){ const o = objects.get(e.uid); if (tc.object !== o){ tc.attach(o); setGizmo(tc.mode === 'rotate' && !hasRoute(e) ? 'rotate' : 'translate', true); } }
  else tc.detach();
}
function select(uid, add, single){
  if (add && uid != null){
    const set = new Set(selUids()); set.has(uid) ? set.delete(uid) : set.add(uid);
    state.multi = [...set]; uid = state.multi.length ? state.multi[state.multi.length - 1] : null;
  } else {
    const e = uid != null && getEntry(uid);
    state.multi = !single && e && e.group && !e.parent ? state.entries.filter(x => x.group === e.group).map(x => x.uid) : [];
  }
  if (state.multi.length < 2) state.multi = [];
  state.selected = uid ?? null; state.markerIdx = null;
  if (uid != null) state.hudSel = null;
  tc.detach(); syncGizmo();
  hudDirty = true; refreshRoutes(); renderProps(); markLib(); renderLayers();
}
function setGizmo(mode, quiet){
  const e = selEntry();
  if (mode === 'rotate' && e && hasRoute(e)){ if (!quiet) toast('A direção deste objeto é definida pela rota'); mode = 'translate'; }
  tc.setMode(mode);
  tc.showX = mode === 'translate'; tc.showZ = mode === 'translate'; tc.showY = mode === 'rotate';
  const info = e && MODELS[e.model];
  tc.setRotationSnap(state.snap ? (info && info.isRoad ? 90 * DEG : 15 * DEG) : null);
  document.querySelectorAll('[data-a=move],[data-a=rotate]').forEach(b => b.classList.toggle('active', b.dataset.a === (mode === 'translate' ? 'move' : 'rotate')));
}
function dragConnect(e, o, info){
  o.updateMatrixWorld(true);
  const mine = []; roadSpec(e).paths.forEach((_, i) => { const R = roadEnds(e, i); mine.push(R.start, R.end); });
  const cn = smartConnect(info, o.position.x, o.position.z, e.uid, 0, mine);
  if (!cn){ if (state.dragConn){ state.dragConn = null; updateHint(); } return false; }
  o.position.set(...cn.pos); o.rotation.set(0, cn.rot, 0);
  e.pos = cn.pos.slice(); e.rot = cn.rot;
  if (cn.n !== lanesPerSide(e)){ e.p = { ...(e.p || {}), lanes: cn.n }; e.scale = cn.n; o.scale.setScalar(cn.n); }
  state.dragConn = cn; updateHint(null, cn);
  return true;
}
function yawOf(q){ const v = new V3(0, 0, 1).applyQuaternion(q); return Math.atan2(v.x, v.z); }

tc.addEventListener('mouseDown', () => { pushHistory(); if (tc.object === groupPivot) groupDragStart(); });
tc.addEventListener('mouseUp', () => { if (groupDrag){ groupDrag = null; changed(); attachGroupPivot(); } if (state.dragConn){ const e = selEntry(); state.dragConn = null; updateHint(); if (e) rebuildEntry(e); changed(); } if (state.markerIdx != null) refreshRoutes(); scheduleSave(); renderProps(); });
tc.addEventListener('objectChange', () => {
  const o = tc.object; if (!o) return;
  if (o === groupPivot){ groupDragMove(); return; }
  if (o.userData.marker){
    const e = getEntry(o.userData.uid); const p = e.motion.pts[o.userData.idx];
    const y = surfaceY(o.position.x, o.position.z);
    p[0] = o.position.x; p[1] = y; p[2] = o.position.z; o.position.y = y + 0.3;
    if (o.userData.idx === 0) e.pos = p.slice();
    refreshRoutes(true); return;
  }
  const e = getEntry(o.userData.uid), info = MODELS[e.model];
  if (e.parent){
    if (tc.mode === 'translate'){ const r = v => state.snap && !altDown ? Math.round(v * 20) / 20 : v; o.position.x = r(o.position.x); o.position.z = r(o.position.z); e.pos = [o.position.x, e.pos[1], o.position.z]; o.position.y = e.pos[1]; }
    else e.rot = yawOf(o.quaternion);
  } else if (tc.mode === 'translate' && kroadOf(info) && dragConnect(e, o, info)){
    // encaixou sozinho em outra estrada
  } else if (tc.mode === 'translate'){
    const [x, z] = snapXZ(info, e.rot, o.position.x, o.position.z, e.scale || 1);
    const y = info.isRoad ? e.pos[1] : surfaceY(x, z, o) + (info.fx ? 0.02 : 0);
    const dx = x - e.pos[0], dz = z - e.pos[2];
    if (e.motion && e.motion.pts.length) e.motion.pts.forEach((p, i) => { p[0] += dx; p[2] += dz; p[1] = i === 0 ? y : surfaceY(p[0], p[2], o); });
    e.pos = [x, y, z];
    o.position.set(x, y, z);
    refreshRoutes();
  } else e.rot = yawOf(o.quaternion);
  if (info.isRoad) roadObjs = state.entries.filter(x => MODELS[x.model]?.isRoad).map(x => objects.get(x.uid));
  updatePropValues(); sceneBoundsDirty = true;
});

/* ---------------- colocar objetos ---------------- */
function ghostFrom(info, hb){
  const g = info.proc ? info.def.build({ ...info.def.defaults }, hb || DEFAULT_HOST, false) : info.tpl.clone(true);
  if (!info.fx) g.traverse(o => { if (o.isMesh){ o.castShadow = false; const ms = (Array.isArray(o.material) ? o.material : [o.material]).map(m => { const c = m.clone(); c.transparent = true; c.opacity = 0.55; return c; }); o.material = ms.length === 1 ? ms[0] : ms; } });
  return g;
}
function setGhost(g){ if (state.ghost) helpers.remove(state.ghost); state.ghost = g; g.visible = false; helpers.add(g); }
function startPlacing(id){
  cancelModes();
  const info = MODELS[id]; if (!info) return;
  state.mode = 'place'; state.placing = id; state.ghostHost = null; state.ghostConn = null; state.connPick = 0;
  if (!info.isRoad) state.ghostRot = 0;
  setGhost(ghostFrom(info));
  select(null); state.hudSel = null; markLib(); updateHint();
}
const hostable = e => { const i = MODELS[e.model]; return i && !i.fx && !i.isRoad && !e.parent; };
function updateGhost(){
  const info = MODELS[state.placing]; let g = state.ghost;
  if (info.attach){
    const host = pickEntity(hostable);
    if (host){
      const hb = boxOf(host), a = info.def.anchor(hb), ho = objects.get(host.uid);
      if (state.ghostHost !== host.uid){ state.ghostHost = host.uid; setGhost(ghostFrom(info, hb)); g = state.ghost; }
      ho.updateMatrixWorld(true);
      g.position.copy(ho.localToWorld(new V3(...a.pos)));
      g.quaternion.copy(ho.getWorldQuaternion(new THREE.Quaternion())).multiply(new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), a.rot + state.ghostRot));
      g.visible = true; updateHint(host); return;
    }
    if (state.ghostHost != null){ state.ghostHost = null; setGhost(ghostFrom(info)); g = state.ghost; }
    updateHint();
  }
  let p;
  if (info.isRoad){ p = new V3(); if (!ray.ray.intersectPlane(groundPlane, p)) p = null; }
  else p = pickSurface();
  if (!p){ g.visible = false; return; }
  const cn = smartConnect(info, p.x, p.z, null, state.connPick || 0);
  state.ghostConn = cn;
  if (cn){
    g.position.set(cn.pos[0], cn.pos[1], cn.pos[2]); g.quaternion.identity(); g.rotation.set(0, cn.rot, 0); g.scale.setScalar(cn.n); g.visible = true;
    updateHint(null, cn); return;
  }
  updateHint();
  const gk = kroadOf(info) ? (state.roadLanes || 1) : 1;
  const [x, z] = snapXZ(info, state.ghostRot, p.x, p.z, gk);
  g.position.set(x, info.isRoad ? 0 : surfaceY(x, z) + (info.fx ? 0.02 : 0), z);
  g.quaternion.identity(); g.rotation.set(0, state.ghostRot, 0); g.scale.setScalar(gk); g.visible = true;
}
function placeGhost(noHistory){
  const g = state.ghost; if (!g || !g.visible) return null;
  const info = MODELS[state.placing];
  if (!noHistory) pushHistory();
  const e = { uid: nextUid++, model: info.id, pos: g.position.toArray(), rot: state.ghostRot, scale: 1, vis: { from: 0, to: 0 },
    motion: info.movable ? defaultMotion(info) : null };
  if (info.proc) e.p = JSON.parse(JSON.stringify(info.def.defaults));
  if (kroadOf(info)){ e.p = { lanes: state.roadLanes || 1 }; e.scale = e.p.lanes; }
  if (state.ghostConn){ const cn = state.ghostConn; e.pos = cn.pos.slice(); e.rot = cn.rot; e.scale = cn.n; e.p = { lanes: cn.n, ...inheritPark(cn.to, info.id) }; state.ghostConn = null; state.connPick = 0; }
  if (state.ghostHost != null){ const host = getEntry(state.ghostHost), a = info.def.anchor(boxOf(host)); e.parent = host.uid; e.pos = a.pos.slice(); e.rot = a.rot + state.ghostRot; }
  state.entries.push(e); sortEntries(); createObject(e); changed();
  if (e.parent){ cancelModes(); select(e.uid); toast(`${info.name} preso ao ${entryName(getEntry(e.parent))}. Ajuste à direita.`); }
  else if (info.isVehicle){ cancelModes(); select(e.uid); toast('Veículo colocado! Agora clique em “Desenhar rota” no painel à direita.'); }
  else if (info.fx){ cancelModes(); select(e.uid); }
  return e;
}
function cancelModes(){
  if (state.mode === 'route') cancelRoute();
  if (state.ghost){ helpers.remove(state.ghost); state.ghost = null; }
  state.mode = 'select'; state.placing = null; state.ghostHost = null; state.measureA = null; hoverDot.visible = false;
  markLib(); updateHint();
}

/* ---------------- desenhar rota ---------------- */
function startRoute(append){
  const e = selEntry(); if (!e || !e.motion) return;
  if (state.t !== 0) setTime(0, true);
  pushHistory();
  tc.detach(); state.markerIdx = null;
  const pts = append && e.motion.pts.length >= 2 ? e.motion.pts.map(p => p.slice()) : [e.pos.slice()];
  state.mode = 'route'; state.draft = { uid: e.uid, pts, prev: JSON.stringify(e.motion) };
  updateHint(); renderProps(); refreshRoutes();
}
function addRoutePoint(p){
  const d = state.draft, last = d.pts[d.pts.length - 1];
  if (Math.hypot(p.x - last[0], p.z - last[2]) < 0.4) return;
  d.pts.push([p.x, p.y, p.z]); refreshRoutes(); renderProps();
}
function finishRoute(){
  const d = state.draft; if (!d) return;
  const e = getEntry(d.uid);
  state.draft = null; state.mode = 'select'; state.hover = null; hoverDot.visible = false;
  if (d.pts.length >= 2){
    e.motion.pts = d.pts; e.motion.type = 'route'; e.motion.byLane = false; e.pos = d.pts[0].slice();
    toast('Rota pronta! Aperte ▶ para ver andando.');
  } else history.pop();
  updateHint(); select(e.uid); changed();
}
function cancelRoute(){
  const d = state.draft; if (!d) return;
  const e = getEntry(d.uid); e.motion = JSON.parse(d.prev);
  state.draft = null; state.mode = 'select'; state.hover = null; hoverDot.visible = false;
  history.pop(); updateHint(); select(e.uid);
}

/* ---------------- mouse no 3D ---------------- */
let downX = 0, downY = 0, downBtn = -1, downOnGizmo = false, lastGhostEv = null;
const cv = renderer.domElement;
cv.addEventListener('contextmenu', ev => ev.preventDefault());
cv.addEventListener('pointerdown', ev => { downX = ev.clientX; downY = ev.clientY; downBtn = ev.button; downOnGizmo = !!(tc.object && tc.axis);
  if (ev.button === 0 && !state.preview && state.mode === 'place' && kroadOf(MODELS[state.placing])) paintStart(ev); });
cv.addEventListener('pointermove', ev => {
  altDown = ev.altKey;
  if (state.preview) return;
  if (painting){ lastGhostEv = ev; paintMove(ev); return; }
  if (state.mode === 'place' && state.ghost){ lastGhostEv = ev; setRay(ev); updateGhost(); }
  else if (state.mode === 'route'){
    setRay(ev);
    const p = pickSurface(objects.get(state.draft.uid));
    state.hover = p; hoverDot.visible = !!p; if (p) hoverDot.position.copy(p).add(new V3(0, 0.3, 0));
    refreshRoutes();
  }
});
cv.addEventListener('pointerup', ev => {
  if (painting){ paintEnd(); return; }
  if (state.preview) return;
  if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 5 || downOnGizmo || ev.button !== downBtn) return;
  setRay(ev);
  if (ev.button === 2){
    if (state.mode === 'place') cancelModes();
    else if (state.mode === 'route') finishRoute();
    return;
  }
  if (ev.button !== 0) return;
  if (state.mode === 'place'){ updateGhost(); placeGhost(); return; }
  if (state.mode === 'route'){ const p = pickSurface(objects.get(state.draft.uid)); if (p) addRoutePoint(p); return; }
  const mk = ray.intersectObjects(routeGroup.children.filter(c => c.userData.marker), false)[0];
  if (mk){ state.markerIdx = mk.object.userData.idx; tc.setMode('translate'); tc.showX = tc.showZ = true; tc.showY = false; tc.attach(mk.object); renderProps(); return; }
  if (state.mode === 'measure'){ measureClick(); return; }
  const e = pickEntity();
  if (state.playing && e) togglePlay();
  const add = ev.ctrlKey || ev.shiftKey || ev.metaKey;
  if (add && !e) return;
  select(e ? e.uid : null, add);
});
cv.addEventListener('dblclick', () => { if (state.mode === 'route') finishRoute(); });

/* ---------------- ações ---------------- */
function deleteEntry(e){
  for (const c of childrenOf(e.uid)) deleteEntry(c);
  removeObject(e.uid);
  state.entries = state.entries.filter(x => x !== e);
  if (state.camMode.endsWith(':' + e.uid)) setCamMode('free');
}
function deleteSelected(){
  const h = hudById(state.hudSel);
  if (h){ pushHistory(); state.hud = state.hud.filter(x => x !== h); state.hudSel = null; hudDirty = true; renderProps(); renderLayers(); scheduleSave(); return; }
  if (state.multi.length > 1){
    pushHistory(); tc.detach();
    state.multi.map(getEntry).filter(Boolean).forEach(deleteEntry);
    state.multi = []; state.selected = null; changed(); renderProps(); return;
  }
  const e = selEntry(); if (!e) return;
  if (state.markerIdx != null){
    if (e.motion.pts.length <= 2){ toast('A rota precisa de pelo menos 2 pontos'); return; }
    pushHistory(); e.motion.pts.splice(state.markerIdx, 1); e.pos = e.motion.pts[0].slice();
    state.markerIdx = null; tc.detach(); select(e.uid); changed(); return;
  }
  pushHistory(); tc.detach();
  deleteEntry(e);
  state.selected = null; changed(); renderProps();
}
function cloneEntry(e, parentUid, off){
  const c = JSON.parse(JSON.stringify(e)); c.uid = nextUid++; c.ego = false;
  if (parentUid != null) c.parent = parentUid;
  else if (off){ c.pos[0] += off[0]; c.pos[2] += off[1]; if (c.motion) c.motion.pts.forEach(p => { p[0] += off[0]; p[2] += off[1]; }); }
  state.entries.push(c);
  for (const ch of childrenOf(e.uid)) if (ch.uid !== c.uid) cloneEntry(ch, c.uid);
  return c;
}
function duplicate(){
  const h = hudById(state.hudSel);
  if (h){ pushHistory(); const c = { ...JSON.parse(JSON.stringify(h)), id: nextUid++, x: h.x + 16, y: h.y + 16 }; state.hud.push(c); selectHud(c.id); scheduleSave(); return; }
  if (state.multi.length > 1){
    pushHistory();
    const es = state.multi.map(getEntry), gmap = {}, b = membersBox(state.multi), off = [Math.ceil((b.max.x - b.min.x + 2) / TILE) * TILE, 0];
    const made = es.map(x => { const c = cloneEntry(x, null, off); if (x.group){ gmap[x.group] = gmap[x.group] || 'g' + (nextUid++); c.group = gmap[x.group]; } return c; });
    sortEntries(); rebuild(); state.multi = made.map(c => c.uid); state.selected = made[0].uid; select(made[0].uid, false); if (state.multi.length < 2){ state.multi = made.map(c => c.uid); syncGizmo(true); renderProps(); }
    toast('Seleção duplicada ao lado'); return;
  }
  const e = selEntry(); if (!e) return;
  pushHistory();
  const info = MODELS[e.model];
  const tk = TILE * (info.isRoad ? (e.scale || 1) : 1), off = info.isRoad ? [tk * Math.round(Math.cos(e.rot)), -tk * Math.round(Math.sin(e.rot))] : [2, 2];
  const c = cloneEntry(e, e.parent ? e.parent : null, e.parent ? null : off);
  if (e.parent) c.pos[0] += 0.5;
  sortEntries(); rebuild(); select(c.uid);
}
function detach(e){
  const o = objects.get(e.uid); if (!o || !e.parent) return;
  pushHistory();
  const ho = objects.get(e.parent), w = MODELS[e.model].world;
  const wp = w ? ho.localToWorld(new V3(...e.pos)) : o.getWorldPosition(new V3()), q = (w ? ho : o).getWorldQuaternion(new THREE.Quaternion());
  e.parent = undefined; e.pos = wp.toArray(); e.rot = yawOf(q);
  rebuild(); select(e.uid);
}
function rotateBy(a){
  if (state.mode === 'place'){ if (state.ghostConn && state.ghostConn.count > 1){ state.connPick = (state.connPick || 0) + 1; if (lastGhostEv) { setRay(lastGhostEv); updateGhost(); } return; } state.ghostRot += a; return; }
  const e = selEntry(); if (!e || state.markerIdx != null) return;
  if (hasRoute(e)){ toast('A direção deste objeto é definida pela rota'); return; }
  pushHistory(); e.rot += a; poseAt(e, objects.get(e.uid), 0); updatePropValues(); changed();
}
function focusSelected(){
  const e = selEntry(), o = objects.get(state.selected); if (!o) return;
  const p = boxOf(e).clone().applyMatrix4(o.matrixWorld).getCenter(new V3());
  const off = camera.position.clone().sub(orbit.target).setLength(Math.max(10, boxOf(e).getSize(new V3()).length() * 3));
  if (state.camMode !== 'free') setCamMode('free');
  orbit.target.copy(p); camera.position.copy(p).add(off);
}
function moveHud(dx, dy){ const h = hudById(state.hudSel); if (!h) return; pushHistory(); h.x += dx; h.y += dy; hudDirty = true; updatePropValues(); scheduleSave(); }

/* ---------------- tempo / play / passos ---------------- */
function setTime(t, pause){
  state.t = Math.max(0, Math.min(t, state.settings.duration));
  if (pause){ state.playing = false; syncPlayBtn(); }
  camSnap = true; updateTimeUI(); syncGizmo();
}
function togglePlay(){
  if (state.recording || state.capturing) return;
  if (state.mode !== 'select') cancelModes();
  if (!state.playing && state.t >= state.settings.duration - 0.01) state.t = 0;
  state.playing = !state.playing;
  if (state.playing){ tc.detach(); state.markerIdx = null; audioCtx(); }
  else if (state.selected && !state.preview) select(state.selected);
  syncPlayBtn();
}
function syncPlayBtn(){ $('#playBtn').textContent = state.playing ? '⏸' : '▶'; }
function updateTimeUI(){
  const sl = $('#time'); sl.max = state.settings.duration; sl.value = state.t;
  $('#timeLabel').textContent = `${state.t.toFixed(1)}s / ${state.settings.duration}s`;
}
function renderMarks(){
  $('#marks').innerHTML = state.steps.map((s, i) => `<i style="left:${(s.t / state.settings.duration * 100).toFixed(2)}%" title="Passo ${i + 1}: ${esc(s.title)}"></i>`).join('');
}
const sortSteps = () => state.steps.sort((a, b) => a.t - b.t);
let lastStepIdx = -2;
function stepCam(){
  if (!(state.preview || state.recording || state.capturing)) { lastStepIdx = -2; return; }
  const i = curStepIdx(state.t);
  if (i !== lastStepIdx){ lastStepIdx = i; const s = state.steps[i]; if (s && s.cam) setCamMode(s.cam); }
}
function stepNav(dir){
  if (!state.steps.length){ if (dir > 0) togglePlay(); return; }
  const i = curStepIdx(state.t);
  if (dir > 0){ if (!state.playing){ if (state.t >= state.settings.duration - 0.01){ state.t = 0; lastStepIdx = -2; } state.playing = true; audioCtx(); syncPlayBtn(); } }
  else {
    const cur = state.steps[i], target = cur && state.t - cur.t > 0.6 ? i : Math.max(0, i - 1);
    setTime(state.steps[target] ? state.steps[target].t : 0, true); lastStepIdx = -2;
  }
}
function updateStepNav(){
  const el = $('#stepnav'), n = state.steps.length;
  el.classList.toggle('has', n > 0 && state.preview && !state.recording);
  if (!n || !state.preview) return;
  const i = curStepIdx(state.t), s = state.steps[i];
  const txt = s ? `<b>Passo ${i + 1}/${n}</b> — ${esc(s.title)}` : `<b>Início</b> — aperte Continuar`;
  if ($('#stLbl').innerHTML !== txt) $('#stLbl').innerHTML = txt;
  $('#stNext').classList.toggle('pulse', !state.playing);
  $('#stNext').textContent = state.playing ? '⏸ Pausar' : (state.t >= state.settings.duration - 0.01 ? '↺ Recomeçar' : 'Continuar ▶');
}
function setPreview(on){
  if (state.recording) return;
  cancelModes();
  state.preview = on; document.body.classList.toggle('preview', on);
  setHelpersVisible(!on);
  if (on){
    tc.detach(); state.selected = null; state.hudSel = null; state.markerIdx = null;
    if (state.camMode === 'free' && state.shots.length && !state.steps.some(s => s.cam)) setCamMode('seq');
    state.t = 0; lastStepIdx = -2; camSnap = true;
    state.playing = !(state.steps.length && state.stepPause);
    if (state.playing) audioCtx();
  } else { state.playing = false; state.t = 0; setCamMode('free'); renderProps(); }
  hudDirty = true; syncPlayBtn(); updateTimeUI(); renderLayers();
  requestAnimationFrame(layoutStage);
  $('#bPreview').textContent = on ? '✎ Editar cena' : '▶ Apresentar';
}

/* ---------------- câmeras ---------------- */
function camOptions(){
  const opts = [['free', '🎥 Câmera livre (mouse)'], ['auto', '🔄 360° em volta da cena']];
  const ou = state.orbitUid != null && getEntry(state.orbitUid);
  if (ou && !(ou.motion && ou.motion.type !== 'none')) opts.push(['orbit:' + ou.uid, '🔄 360° em volta de ' + entryName(ou)]);
  if (state.shots.length) opts.push(['seq', '🎬 Sequência das câmeras salvas']);
  state.shots.forEach((s, i) => opts.push(['shot:' + i, '📌 ' + s.name]));
  state.entries.filter(e => e.motion && e.motion.type !== 'none').forEach(e => {
    const n = entryName(e) + (e.ego ? ' (principal)' : '');
    opts.push(['orbit:' + e.uid, '🔄 360° em volta de ' + n], ['follow:' + e.uid, '🚗 Seguir ' + n], ['hood:' + e.uid, '👀 No capô: ' + n], ['top:' + e.uid, '⬇ De cima: ' + n], ['side:' + e.uid, '↔ Lateral: ' + n]);
  });
  return opts;
}
function populateCamSelect(){
  const sel = $('#camSel'), opts = camOptions();
  if (!opts.find(o => o[0] === state.camMode)) state.camMode = 'free';
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  sel.value = state.camMode;
}
function setCamMode(m){
  if (!camOptions().find(o => o[0] === m)) m = 'free';
  if (state.camMode === 'free' && m !== 'free') state.freeCam = { pos: camera.position.clone(), target: orbit.target.clone(), fov: camera.fov };
  if (m === 'free' && state.camMode !== 'free' && state.freeCam){
    camera.position.copy(state.freeCam.pos); orbit.target.copy(state.freeCam.target); camera.fov = state.freeCam.fov; camera.updateProjectionMatrix();
  }
  state.camMode = m; $('#camSel').value = m;
  orbit.enabled = m === 'free';
  camSnap = true;
}
let sceneBoundsDirty = true; const sceneBox = new THREE.Box3(), sceneCenter = new V3(); let sceneRadius = 30;
function updateSceneBounds(){
  if (!sceneBoundsDirty) return; sceneBoundsDirty = false;
  sceneBox.makeEmpty();
  state.entries.forEach(e => { if (!e.parent) sceneBox.expandByPoint(new V3(...e.pos)); });
  if (sceneBox.isEmpty()) { sceneCenter.set(0, 0, 0); sceneRadius = 30; return; }
  sceneBox.getCenter(sceneCenter); sceneRadius = Math.max(20, sceneBox.getSize(new V3()).length() / 2);
}
let camSnap = true;
const _a = new V3(), _b = new V3();
function applyShot(s){
  camera.position.fromArray(s.pos); camera.lookAt(_a.fromArray(s.target));
  if (camera.fov !== s.fov){ camera.fov = s.fov; camera.updateProjectionMatrix(); }
}
function updateCamera(dt){
  const m = state.camMode;
  if (m === 'free'){ orbit.update(); return; }
  if (m === 'auto' || m.startsWith('orbit:')){
    // 360°: dá o número de voltas escolhido durante a duração da cena (o vídeo fecha a volta certinho)
    const O = orbitParams();
    let ctr, R;
    if (m === 'auto'){ updateSceneBounds(); ctr = sceneCenter.clone(); R = O.dist > 0 ? O.dist : sceneRadius * 1.6; }
    else { const e = getEntry(+m.split(':')[1]), o = e && objects.get(e.uid); if (!o) return; const b = boxOf(e).clone().applyMatrix4(o.matrixWorld); ctr = b.getCenter(new V3()); R = O.dist > 0 ? O.dist : Math.max(7, b.getSize(new V3()).length() * 1.7); }
    const ang = 0.7 + (O.dir < 0 ? -1 : 1) * Math.PI * 2 * O.turns * state.t / state.settings.duration, el = clamp(O.height, 2, 88) * DEG;
    camera.position.set(ctr.x + Math.cos(ang) * Math.cos(el) * R, ctr.y + Math.sin(el) * R, ctr.z + Math.sin(ang) * Math.cos(el) * R);
    camera.lookAt(ctr);
    if (camera.fov !== 45){ camera.fov = 45; camera.updateProjectionMatrix(); }
    return;
  }
  if (m === 'seq'){
    const n = state.shots.length; if (!n) return;
    applyShot(state.shots[Math.min(n - 1, Math.floor(state.t / (state.settings.duration / n)))]); return;
  }
  const [kind, id] = m.split(':');
  if (kind === 'shot'){ const s = state.shots[+id]; if (s) applyShot(s); return; }
  const e = getEntry(+id), o = objects.get(+id); if (!e || !o) return;
  const b = boxOf(e), k = clamp((b.max.z - b.min.z) / 4.6, 0.4, 2.6);
  const flip = e.motion && e.motion.flip ? -1 : 1;
  let pos, look, fov = 55;
  if (kind === 'follow'){ pos = o.localToWorld(_a.set(0, 3.0 * k, -8.5 * k * flip)); look = o.localToWorld(_b.set(0, 1.1 * k, 4 * k * flip)); }
  else if (kind === 'hood'){ pos = o.localToWorld(_a.set(0, b.max.y * 0.78, (b.max.z - 0.3) * flip)); look = o.localToWorld(_b.set(0, b.max.y * 0.6, 30 * flip)); fov = 70; }
  else if (kind === 'top'){ pos = o.localToWorld(_a.set(0, 22 * k, -0.01 * flip)); look = o.localToWorld(_b.set(0, 0, 0.6 * flip)); fov = 45; }
  else { pos = o.localToWorld(_a.set(7 * k, 1.6, 1.5 * flip)); look = o.localToWorld(_b.set(0, b.max.y * 0.45, 0.5 * flip)); fov = 45; }
  if (camSnap || !state.playing || camera.position.distanceTo(pos) > 25 || kind !== 'follow') camera.position.copy(pos);
  else camera.position.lerp(pos, 1 - Math.exp(-dt * 6));
  camSnap = false;
  camera.lookAt(look);
  if (camera.fov !== fov){ camera.fov = fov; camera.updateProjectionMatrix(); }
}

/* ---------------- foto, vídeo e GIF ---------------- */
function setHelpersVisible(v){ helpers.visible = v; tc.visible = v; }
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const comp = document.createElement('canvas'), cctx = comp.getContext('2d');
function renderAt(w, h){
  renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
function stepScene(dt){
  applyPoses(); ecuFromScene(); stepCam(); updateCamera(dt);
  sky.position.copy(camera.position); if (mountains) mountains.position.set(camera.position.x, mountains.position.y, camera.position.z);
  renderer.render(scene, camera); renderPips();
}
async function takePhoto(){
  if (state.recording || state.capturing) return;
  state.capturing = true;
  const [w, h] = outRes();
  setHelpersVisible(false); renderAt(w, h); stepScene(0);
  comp.width = w; comp.height = h; cctx.drawImage(renderer.domElement, 0, 0, w, h);
  if (state.hud.length){ try { cctx.drawImage(await rasterHud(hudDoc(w, h)), 0, 0, w, h); } catch {} }
  const blob = await new Promise(r => comp.toBlob(r, 'image/png'));
  setHelpersVisible(!state.preview); state.capturing = false; layoutStage();
  download(blob, `cena-${stamp()}.png`);
  toast(`Foto salva (${w}×${h})`);
}
let recorder = null, recChunks = [], recExt = 'webm';
function toggleRecording(){ state.recording ? stopRecording(false) : startRecording(); }
function startRecording(){
  if (!window.MediaRecorder || !comp.captureStream){ toast('Seu navegador não suporta gravação de vídeo'); return; }
  cancelModes();
  const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mime = types.find(t => MediaRecorder.isTypeSupported(t));
  recExt = mime && mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  tc.detach(); state.markerIdx = null;
  state.recording = true; state.t = 0; state.playing = true; camSnap = true; lastStepIdx = -2;
  NT.list = []; NT.cur = ''; NT.since = {};
  const [w, h] = outRes(); comp.width = w; comp.height = h;
  layoutStage(); setHelpersVisible(false);
  const stream = comp.captureStream(60);
  const ac = audioCtx();
  if (ac && +ECU.snd){ try { recDest = ac.createMediaStreamDestination(); stream.addTrack(recDest.stream.getAudioTracks()[0]); } catch { recDest = null; } }
  try { recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 20e6 }); }
  catch { recorder = new MediaRecorder(stream); recExt = 'webm'; }
  recChunks = [];
  const rec = recorder;
  rec.ondataavailable = ev => ev.data.size && recChunks.push(ev.data);
  rec.onstop = () => {
    if (rec._cancel) return;
    download(new Blob(recChunks, { type: rec.mimeType }), `cena-${stamp()}.${recExt}`);
    toast('Vídeo salvo na pasta de Downloads');
  };
  recorder.start(250);
  $('#recBtn').textContent = '⏹ Parar'; $('#recBtn').classList.add('rec');
  $('#recbadge').style.display = 'block';
  syncPlayBtn();
}
function stopRecording(complete){
  if (!recorder) return;
  recorder._cancel = !complete && state.t < 0.5;
  recorder.stop(); recorder = null; recDest = null;
  state.recording = false; state.playing = false;
  setHelpersVisible(!state.preview); layoutStage();
  $('#recBtn').textContent = '⏺ Vídeo'; $('#recBtn').classList.remove('rec');
  $('#recbadge').style.display = 'none';
  syncPlayBtn();
}
/* GIF: paleta adaptativa (median cut), pontilhado leve e LZW, sem bibliotecas (mesmo do ADAS Studio) */
function lzwGif(ix){ const clr = 256, eoi = 257, o = []; let cs = 9, nx = 258, cur = 0, sh = 0, tab = new Map(), blk = [];
  const put = c => { cur |= c << sh; sh += cs; while (sh >= 8){ blk.push(cur & 255); cur >>>= 8; sh -= 8; if (blk.length === 255){ o.push(255, ...blk); blk = []; } } };
  put(clr); let ib = ix[0];
  for (let i = 1; i < ix.length; i++){ const k = ix[i], key = (ib << 8) | k, c = tab.get(key); if (c === undefined){ put(ib); if (nx === 4096){ put(clr); nx = 258; cs = 9; tab = new Map(); } else { if (nx >= (1 << cs)) cs++; tab.set(key, nx++); } ib = k; } else ib = c; }
  put(ib); if (nx >= (1 << cs)) cs++; put(eoi); if (sh > 0) blk.push(cur & 255); if (blk.length) o.push(blk.length, ...blk); return Uint8Array.from(o); }
function gifPal(fr){ const smp = []; fr.forEach((d, fi) => { for (let i = (fi % 7) * 4; i < d.length; i += 244) smp.push([d[i], d[i + 1], d[i + 2]]); });
  const bx = [smp]; while (bx.length < 255){ let bi = -1, bs = 0, bc = 0; bx.forEach((b, i) => { if (b.length < 2) return; for (let c = 0; c < 3; c++){ let lo = 255, hi = 0; for (const p of b){ if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; } const r = (hi - lo) * Math.sqrt(b.length); if (r > bs){ bs = r; bi = i; bc = c; } } }); if (bi < 0) break; const b = bx.splice(bi, 1)[0]; b.sort((p, q) => p[bc] - q[bc]); const m = b.length >> 1; bx.push(b.slice(0, m), b.slice(m)); }
  const pal = bx.map(b => { const t = [0, 0, 0]; for (const p of b){ t[0] += p[0]; t[1] += p[1]; t[2] += p[2]; } return t.map(v => Math.round(v / b.length)); }); while (pal.length < 256) pal.push([0, 0, 0]);
  const cache = new Map(), near = (r, g, b) => { const k = (r >> 2) << 12 | (g >> 2) << 6 | (b >> 2); let v = cache.get(k); if (v === undefined){ let bd = 1e9; for (let i = 0; i < 255; i++){ const q = pal[i], dd = (q[0] - r) ** 2 + (q[1] - g) ** 2 + (q[2] - b) ** 2; if (dd < bd){ bd = dd; v = i; } } cache.set(k, v); } return v; }; return { pal, near }; }
const GL2 = n => [n & 255, (n >> 8) & 255];
function gifHead(w, h, pal){ return [Uint8Array.from([71, 73, 70, 56, 57, 97, ...GL2(w), ...GL2(h), 0xF7, 0, 0]), Uint8Array.from(pal.flat()), Uint8Array.from([0x21, 0xFF, 11, ...[...'NETSCAPE2.0'].map(c => c.charCodeAt(0)), 3, 1, 0, 0, 0])]; }
const BY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function gifFrame(d, w, h, near, delay, prev){ const ix = new Uint8Array(w * h); for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++){ const t = (BY[(y & 3) * 4 + (x & 3)] - 7.5) * 1.4, j = i * 4, c = v => { v += t; return v < 0 ? 0 : v > 255 ? 255 : v | 0; }; ix[i] = near(c(d[j]), c(d[j + 1]), c(d[j + 2])); }
  const out = prev ? ix.map((v, i) => v === prev[i] ? 255 : v) : ix;
  return { ix, b: [Uint8Array.from([0x21, 0xF9, 4, prev ? 5 : 4, ...GL2(delay), 255, 0, 0x2C, 0, 0, 0, 0, ...GL2(w), ...GL2(h), 0, 8]), lzwGif(out), Uint8Array.of(0)] }; }
async function makeGif(){
  if (state.recording || state.capturing) return;
  cancelModes();
  const [ow, oh] = outRes(), Wt = +(state.settings.gifw || 640), Ht = Math.round(Wt * oh / ow) & ~1, fps = 12, n = Math.min(300, Math.ceil(state.settings.duration * fps)), dl = Math.round(100 / fps);
  const t0 = state.t, wasPlaying = state.playing;
  state.capturing = true; state.playing = false; setHelpersVisible(false); renderAt(Wt, Ht); camSnap = true; lastStepIdx = -2;
  const c = document.createElement('canvas'); c.width = Wt; c.height = Ht; const cx = c.getContext('2d', { willReadFrequently: true });
  const grab = async i => { state.t = i / fps; stepScene(1 / fps); cx.drawImage(renderer.domElement, 0, 0, Wt, Ht); if (state.hud.length){ try { cx.drawImage(await rasterHud(hudDoc(Wt, Ht)), 0, 0, Wt, Ht); } catch {} } return cx.getImageData(0, 0, Wt, Ht).data; };
  try {
    toast('Preparando cores do GIF…');
    const smp = []; for (const i of [0, n >> 2, n >> 1, (3 * n) >> 2]) smp.push((await grab(i)).slice());
    const { pal, near } = gifPal(smp), parts = gifHead(Wt, Ht, pal);
    camSnap = true; lastStepIdx = -2;
    let prev = null;
    for (let i = 0; i < n; i++){ const f = gifFrame(await grab(i), Wt, Ht, near, dl, prev); parts.push(...f.b); prev = f.ix; if (i % 6 === 0){ toast('Gerando GIF: ' + Math.round(i / n * 100) + '%'); await new Promise(r => setTimeout(r)); } }
    parts.push(Uint8Array.of(0x3B));
    download(new Blob(parts, { type: 'image/gif' }), `cena-${stamp()}.gif`);
    toast('GIF salvo na pasta de Downloads');
  } catch (err){ console.error(err); toast('Não foi possível gerar o GIF'); }
  state.t = t0; state.playing = wasPlaying; state.capturing = false; setHelpersVisible(!state.preview); layoutStage(); camSnap = true;
}

/* ---------------- loop ---------------- */
let last = performance.now();
function frame(now){
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now; frameCtx.dt = dt;
  if (state.capturing) return;
  if (state.playing){
    const prev = state.t;
    state.t += dt;
    if (state.preview && state.stepPause && !state.recording){
      const nx = state.steps.find(s => s.t > prev + 1e-4 && s.t <= state.t);
      if (nx){ state.t = nx.t; state.playing = false; syncPlayBtn(); }
    }
    if (state.t >= state.settings.duration){
      if (state.recording){ state.t = state.settings.duration; stopRecording(true); }
      else if (state.preview && state.stepPause && state.steps.length){ state.t = state.settings.duration; state.playing = false; syncPlayBtn(); }
      else if (state.settings.loop === false){ state.t = state.settings.duration; state.playing = false; syncPlayBtn(); }
      else { state.t = 0; camSnap = true; lastStepIdx = -2; }
    }
    updateTimeUI();
    if (state.recording) $('#recbadge').textContent = '● REC ' + state.t.toFixed(1) + 's';
  }
  applyPoses();
  ecuFromScene();
  stepCam();
  updateSceneBounds();
  updateCamera(dt);
  const se = selEntry(), so = se && objects.get(se.uid);
  if (state.multi.length > 1 && helpers.visible){ selBox.box.copy(membersBox(state.multi)); selBox.visible = !selBox.box.isEmpty(); }
  else if (so && so.visible && state.markerIdx == null && helpers.visible){
    if (MODELS[se.model].fx) selBox.box.setFromObject(so); else selBox.box.copy(boxOf(se)).applyMatrix4(so.matrixWorld);
    selBox.visible = true;
  } else selBox.visible = false;
  grid.visible = state.grid;
  sky.position.copy(camera.position);
  if (mountains) mountains.position.set(camera.position.x, mountains.position.y, camera.position.z);
  const c = state.preview ? sceneCenter : orbit.target;
  sun.target.position.set(Math.round(c.x / 20) * 20, 0, Math.round(c.z / 20) * 20);
  sun.position.copy(sun.target.position).add(_a.fromArray((ENVS[state.settings.env] || ENVS.dia).sp));
  renderer.render(scene, camera); renderPips();
  updateHudDom(); hudSoundCues();
  if (state.recording){
    const [w, h] = outRes();
    if (state.hud.length) requestHud(hudDoc(w, h));
    cctx.drawImage(renderer.domElement, 0, 0, w, h);
    if (state.hud.length && hudImg) cctx.drawImage(hudImg, 0, 0, w, h);
  }
  updateStepNav();
}

/* ---------------- biblioteca e camadas ---------------- */
const hudThumbs = {};
function renderCats(){
  $('#cats').innerHTML = CATS.filter(c => c !== 'Meus modelos' || Object.values(MODELS).some(m => m.cat === c))
    .map(c => `<button data-c="${c}" class="${c === state.cat ? 'on' : ''}">${c}</button>`).join('');
}
$('#cats').addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; state.cat = b.dataset.c; $('#search').value = ''; renderCats(); renderItems(); });
$('#search').addEventListener('input', renderItems);
function renderItems(){
  const q = $('#search').value.trim().toLowerCase();
  const list = Object.values(MODELS).filter(m => q ? (m.name + ' ' + (m.file || '') + ' ' + m.cat).toLowerCase().includes(q) : m.cat === state.cat);
  list.sort((a, b) => (b.proc ? 1 : 0) - (a.proc ? 1 : 0));
  const huds = HUD_ORDER.filter(t => q ? (HUDT[t].name + ' painel hud').toLowerCase().includes(q) : state.cat === 'Painel (HUD)');
  let html = list.map(m => `<div class="item" data-id="${m.id}" title="${esc(m.name)}"><img src="${m.thumb || ''}" alt=""><div>${esc(m.name)}</div></div>`).join('');
  html += huds.map(t => `<div class="item" data-hud="${t}" title="${esc(HUDT[t].name)}"><img src="${hudThumbs[t] || (hudThumbs[t] = hudThumb(t))}" alt=""><div>${esc(HUDT[t].name)}</div></div>`).join('');
  $('#items').innerHTML = html || '<div class="note" style="grid-column:1/-1">Nada encontrado.</div>';
  $('#catnote').textContent = q ? '' : (CATNOTE[state.cat] || '');
  markLib();
}
$('#items').addEventListener('click', ev => {
  const it = ev.target.closest('.item'); if (!it || state.preview) return;
  if (it.dataset.hud){ cancelModes(); addHud(it.dataset.hud); return; }
  if (it.dataset.id === 'f:measure'){ if (state.mode === 'measure') cancelModes(); else startMeasure(); return; }
  if (state.placing === it.dataset.id) cancelModes(); else startPlacing(it.dataset.id);
});
function markLib(){ document.querySelectorAll('.item').forEach(i => i.classList.toggle('on', !!i.dataset.id && (i.dataset.id === state.placing || (i.dataset.id === 'f:measure' && state.mode === 'measure')))); }
document.querySelector('.ltabs').addEventListener('click', ev => {
  const b = ev.target.closest('[data-lt]'); if (!b) return;
  document.querySelectorAll('.ltabs button').forEach(x => x.classList.toggle('on', x === b));
  $('#libwrap').style.display = b.dataset.lt === 'lib' ? 'flex' : 'none';
  $('#layers').style.display = b.dataset.lt === 'lay' ? 'block' : 'none';
  renderLayers();
});
function renderLayers(){
  const el = $('#layers'); if (el.style.display !== 'block') return;
  const row = (e, child) => `<div class="lay ${e.uid === state.selected ? 'on' : ''} ${e.hidden ? 'off' : ''} ${child ? 'child' : ''}" data-lu="${e.uid}"><button class="ey" data-eye="${e.uid}" title="Mostrar/ocultar">${e.hidden ? '◌' : '👁'}</button><span class="nm">${esc(MODELS[e.model]?.name || e.model)}${e.ego ? ' ★' : ''}</span><small>#${e.uid}</small></div>`;
  let h = `<div class="layh">Cena 3D (${state.entries.length})</div>`;
  const tops = state.entries.filter(e => !e.parent).slice().reverse();
  const walk = (e, d) => { h += row(e, d); childrenOf(e.uid).forEach(c => walk(c, true)); };
  tops.forEach(e => walk(e, false));
  if (!state.entries.length) h += '<p class="note">Nada ainda.</p>';
  h += `<div class="layh">Painel (HUD) (${state.hud.length})</div>`;
  h += state.hud.slice().reverse().map(x => `<div class="lay ${x.id === state.hudSel ? 'on' : ''} ${x.hidden ? 'off' : ''}" data-lh="${x.id}"><button class="ey" data-heye="${x.id}">${x.hidden ? '◌' : '👁'}</button><span class="nm">${esc(HUDT[x.t]?.name || x.t)}</span><small>#${x.id}</small></div>`).join('') || '<p class="note">Nada ainda.</p>';
  el.innerHTML = h;
}
$('#layers').addEventListener('click', ev => {
  const ey = ev.target.closest('[data-eye]'), hy = ev.target.closest('[data-heye]');
  if (ey){ const e = getEntry(+ey.dataset.eye); pushHistory(); e.hidden = !e.hidden; renderLayers(); scheduleSave(); return; }
  if (hy){ const e = hudById(+hy.dataset.heye); pushHistory(); e.hidden = !e.hidden; hudDirty = true; renderLayers(); scheduleSave(); return; }
  const r = ev.target.closest('[data-lu]'), rh = ev.target.closest('[data-lh]');
  if (r){ cancelModes(); select(+r.dataset.lu, ev.ctrlKey || ev.shiftKey || ev.metaKey); }
  if (rh){ cancelModes(); selectHud(+rh.dataset.lh); }
});

/* ---------------- campos genéricos ---------------- */
function fieldHTML([k, l, t, o], v){
  if (t === 'chk') return `<label class="chk full"><input type="checkbox" data-f="${k}" ${+v ? 'checked' : ''}> ${l}</label>`;
  if (t === 'sel') return `<label class="field full">${l}<select data-f="${k}">${o.map(([a, b]) => `<option value="${esc(a)}" ${String(v ?? '') === String(a) ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></label>`;
  if (t === 'area') return `<label class="field full">${l}<textarea data-f="${k}" rows="2">${esc(v)}</textarea></label>`;
  if (t === 'text') return `<label class="field full">${l}<input type="text" data-f="${k}" value="${esc(v)}"></label>`;
  if (t === 'color') return `<label class="field">${l}<input type="color" data-f="${k}" value="${isHex(v) ? v : '#000000'}"></label>`;
  if (t === 'range') return `<label class="field full">${l} <span data-rv="${k}">${(+v || 0).toFixed(2)}</span><input type="range" data-f="${k}" min="${o.min}" max="${o.max}" step="${o.step}" value="${v}"></label>`;
  return `<label class="field">${l}<input type="number" data-f="${k}" value="${v ?? ''}" ${o ? `min="${o.min}" max="${o.max}" step="${o.step}"` : ''}></label>`;
}
const fieldsHTML = (fields, obj) => `<div class="fgrid">${fields.map(f => fieldHTML(f, obj[f[0]])).join('')}</div>`;
function bindFields(root, obj, onChange){
  root.querySelectorAll('[data-f]').forEach(inp => {
    const k = inp.dataset.f, live = inp.type === 'range' || inp.type === 'color' || inp.type === 'text' || inp.tagName === 'TEXTAREA';
    let pushed = false; const ph = () => { if (!pushed){ pushHistory(); pushed = true; } };
    inp.addEventListener('focus', ph); inp.addEventListener('pointerdown', ph); inp.addEventListener('blur', () => pushed = false);
    inp.addEventListener(live ? 'input' : 'change', () => {
      ph();
      let v = inp.type === 'checkbox' ? (inp.checked ? 1 : 0) : (inp.type === 'number' || inp.type === 'range') ? parseFloat(inp.value) : inp.value;
      if (typeof v === 'number' && !isFinite(v)) return;
      obj[k] = v;
      const rv = root.querySelector(`[data-rv="${k}"]`); if (rv) rv.textContent = (+v).toFixed(2);
      onChange(k, v); scheduleSave();
      if (inp.type === 'checkbox' || inp.tagName === 'SELECT') pushed = false;
    });
  });
}

/* ---------------- painel de propriedades ---------------- */
function renderProps(){
  renderPropsInner(); renderQuick();
}
function renderPropsInner(){
  const el = $('#props');
  if (state.multi.length > 1 && state.mode === 'select'){ renderMultiPanel(el); return; }
  if (state.mode === 'route' && state.draft){
    const n = state.draft.pts.length;
    el.innerHTML = `<div class="sec"><h3>Desenhando rota</h3>
      <ol class="steps"><li>Clique na estrada para adicionar pontos, na ordem do trajeto.</li>
      <li>O ponto verde é onde o objeto começa.</li><li><b>Enter</b>, botão direito ou duplo clique concluem.</li>
      <li><b>Backspace</b> apaga o último ponto, <b>Esc</b> cancela.</li></ol>
      <p class="note">${n} ponto${n > 1 ? 's' : ''} na rota</p>
      <div class="btns"><button class="btn primary" data-a="finish" ${n < 2 ? 'disabled' : ''}>✓ Concluir rota</button><button class="btn" data-a="cancel">Cancelar</button></div></div>`;
    el.querySelector('[data-a=finish]').onclick = finishRoute;
    el.querySelector('[data-a=cancel]').onclick = cancelRoute;
    return;
  }
  const h = hudById(state.hudSel);
  if (h){ renderHudPanel(el, h); return; }
  const e = selEntry();
  if (!e){ renderScenePanel(el); return; }
  renderEntryPanel(el, e);
}
function renderEntryPanel(el, e){
  const info = MODELS[e.model], m = e.motion, route = hasRoute(e), att = !!e.parent, host = att && getEntry(e.parent);
  let html = `<div class="sec"><div class="objhead"><img src="${info.thumb}"><div><b>${esc(info.name)}</b><small>${info.cat} · #${e.uid}</small></div></div>`;
  if (att) html += `<p class="note">🔗 Preso a <b>${esc(entryName(host))}</b> — anda junto com ele.</p>`;
  if (state.markerIdx != null) html = `<div class="sec"><h3>Ponto ${state.markerIdx + 1} da rota</h3><p class="note">Arraste as setas para mover o ponto. Delete apaga o ponto.</p>
      <div class="btns"><button class="btn danger" data-a="delpt">Apagar ponto</button><button class="btn" data-a="back">Voltar ao objeto</button></div></div>` + html;
  if (att) html += `<div class="row"><label class="field">Frente (m)<input type="number" step="0.1" data-k="z"></label><label class="field">Lado (m, + dir.)<input type="number" step="0.1" data-k="lx"></label><label class="field">Altura (m)<input type="number" step="0.05" data-k="y"></label></div>
      <label class="field">Direção (°) — 0 frente, 180 trás, 90 direita<input type="number" step="5" data-k="dir"></label>`;
  else if (e.model === 'f:measure') html += `<p class="note">📏 Mede a distância entre os dois objetos escolhidos e acompanha quando eles andam. Para medir outros objetos, crie uma nova medida.</p>`;
  else html += `<div class="row"><label class="field">X<input type="number" step="0.5" data-k="x"></label><label class="field">Y<input type="number" step="0.1" data-k="y"></label><label class="field">Z<input type="number" step="0.5" data-k="z"></label></div>
      ${route ? '<p class="note">Direção definida pela rota.</p>' : `<label class="field">Rotação (graus)<input type="number" step="15" data-k="rot"></label>`}`;
  if (kroadOf(info)) html += `<label class="field">🛣 Número de faixas<select data-lanes="1">${LANE_OPTS.map(([v, l]) => `<option value="${v}" ${lanesPerSide(e) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="btns"><button class="btn sm" data-a="lanes-all" title="Muda todas as estradas da cena e mantém tudo encaixado">Aplicar a toda a pista</button></div>
      <p class="note">A peça cresce junto para continuar encaixando; cada faixa tem 3,2 m.</p>`
      + (parkable(info) ? `<label class="field" style="margin-top:6px">🅿 Vagas de estacionamento ao lado<select data-park="1">${PARK_OPTS.map(([v, l]) => `<option value="${v}" ${+(e.p?.park || 0) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" data-parkback="1" ${(e.p?.parkBack ?? 1) ? 'checked' : ''}> Calçada no fundo das vagas</label>
      <div class="btns"><button class="btn sm" data-a="park-all" title="Coloca as mesmas vagas em todas as retas da cena">Aplicar em todas as retas</button></div>` : '');
  else if (!info.isRoad && !isWorldFx(e)) html += `<label class="field">${info.fx ? 'Tamanho do efeito' : 'Escala'} <span data-v="scale"></span><input type="range" min="0.1" max="${info.fx ? 6 : 4}" step="0.05" data-k="scale"></label>`;
  html += `<div class="btns">${isWorldFx(e) ? '' : `<button class="btn" data-a="move" title="G">✥ Mover</button>${route ? '' : '<button class="btn" data-a="rotate" title="T">⟳ Girar</button>'}`}</div>
    <div class="btns"><button class="btn" data-a="center" title="F">🎯 Centralizar câmera</button><button class="btn" data-a="dup" title="Ctrl+D">Duplicar</button><button class="btn danger" data-a="del" title="Delete">Excluir</button>${att ? '<button class="btn" data-a="detach" title="Deixar parado no lugar">Soltar</button>' : ''}</div></div>`;
  if (m) html += movHTML(e);
  if (info.proc && info.def.fields?.length) html += `<div class="sec" id="pfields"><h3>${info.fx ? 'Ajustes do efeito' : 'Aparência'}</h3>${fieldsHTML(info.def.fields, { ...info.def.defaults, ...(e.p || {}) })}</div>`;
  html += `<div class="sec"><h3>Tempo na cena</h3><div class="row2"><label class="field">Aparece em (s)<input type="number" min="0" step="0.1" data-k="from"></label><label class="field">Some em (s, 0 = fim)<input type="number" min="0" step="0.1" data-k="to"></label></div>
    <div class="btns"><button class="btn sm" data-a="from-now">Aparecer agora (${state.t.toFixed(1)}s)</button><button class="btn sm" data-a="to-now">Sumir agora</button></div></div>`;
  if (info.isVehicle && Object.keys(CHARS).length){
    const sp = e.p || {};
    html += `<div class="sec"><h3>🧑 Pessoa no veículo</h3>
      <label class="field">Quem está dirigindo / pilotando<select data-drv="1">${DRIVER_OPTS().map(([v, l]) => `<option value="${v}" ${(sp.driver || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${sp.driver ? `<details><summary class="note" style="cursor:pointer">Ajustar posição da pessoa</summary>
      <div class="fgrid"><label class="field">Frente/trás (m)<input type="number" step="0.05" data-ds="dzs" value="${sp.dzs || 0}"></label><label class="field">Altura (m)<input type="number" step="0.05" data-ds="dys" value="${sp.dys || 0}"></label>
      <label class="field">Lado (m)<input type="number" step="0.05" data-ds="dxs" value="${sp.dxs || 0}"></label><label class="field">Tamanho<input type="number" step="0.05" min="0.3" max="2" data-ds="dss" value="${sp.dss || 1}"></label></div></details>` : ''}</div>`;
  }
  if (info.isVehicle && Object.keys(CHARS).length && !/bicycle|motorbike|scooter/.test(info.file || '')) html += e.p?.sleepOn
    ? `<div class="sec mov"><h3>👁 DDD ligado</h3><label class="field">O motorista fecha os olhos aos (s)<input type="number" min="0" step="0.5" data-ds="sleepFrom" value="${e.p.sleepFrom || 0}"></label><p class="note">2 s depois o sistema detecta o sono.</p><div class="btns"><button class="btn" data-a="off-ddd">Desligar DDD</button></div></div>`
    : `<div class="sec"><h3>👁 DDD — motorista com sono</h3><div class="btns"><button class="btn primary" data-a="demo-ddd">👁 Ligar DDD</button></div></div>`;
  if (info.isVehicle) html += `<div class="sec"><h3>📺 Telinhas</h3><p class="note">Mostram este veículo numa janelinha dentro da imagem, em tempo real.</p><div class="btns"><button class="btn sm" data-a="pip-360">🚗 Carro 3D (câmera 360)</button></div></div>`;
  if (m && !childrenOf(e.uid).length && info.isVehicle) html += `<p class="note">💡 Dica: na aba <b>ADAS (efeitos)</b>, escolha um efeito e clique neste veículo para prendê-lo.</p>`;
  const kids = childrenOf(e.uid);
  if (kids.length) html += `<div class="sec"><h3>Efeitos presos (${kids.length})</h3>${kids.map(k => `<div class="lay" data-kid="${k.uid}"><span class="nm">${esc(MODELS[k.model].name)}</span><small>#${k.uid}</small></div>`).join('')}</div>`;
  el.innerHTML = html;
  updatePropValues();
  el.querySelectorAll('[data-k]').forEach(inp => {
    if (inp.classList.contains('seg')) return;
    const ev = inp.type === 'range' ? 'input' : 'change';
    if (inp.type === 'range') inp.addEventListener('pointerdown', () => pushHistory());
    inp.addEventListener(ev, () => onPropChange(e, inp.dataset.k, inp));
  });
  const pf = el.querySelector('#pfields');
  if (pf){ e.p = { ...info.def.defaults, ...(e.p || {}) }; bindFields(pf, e.p, () => { rebuildEntry(e); if (tc.object == null && state.selected === e.uid && !isWorldFx(e)) tc.attach(objects.get(e.uid)); }); }
  el.querySelectorAll('[data-ev]').forEach(inp => inp.addEventListener('change', () => { pushHistory(); const v = parseFloat(inp.value); if (isFinite(v)) m.events[+inp.dataset.ev][inp.dataset.evk] = Math.max(0, v); scheduleSave(); }));
  el.querySelectorAll('[data-evdel]').forEach(b => b.onclick = () => { pushHistory(); m.events.splice(+b.dataset.evdel, 1); renderProps(); scheduleSave(); });
  el.querySelectorAll('[data-kid]').forEach(b => b.onclick = () => select(+b.dataset.kid));
  el.querySelectorAll('[data-mt]').forEach(b => b.onclick = () => setMotion(e, b.dataset.mt));
  const ac = el.querySelector('[data-acc]'); if (ac) ac.onchange = () => { pushHistory(); e.motion.acc = ac.value ? { hw: 1.8, min: 4, ...(e.motion.acc || {}), lead: +ac.value } : null; changed(); renderProps(); if (ac.value) toast('ACC ligado: aperte ▶ para ver ele se ajustar ao da frente.'); };
  el.querySelectorAll('[data-accv]').forEach(inp => inp.onchange = () => { const v = parseFloat(inp.value); if (!isFinite(v)) return; pushHistory(); e.motion.acc[inp.dataset.accv] = v; changed(); });
  el.querySelectorAll('[data-dsc]').forEach(inp => inp.onchange = () => { pushHistory(); e.p = { ...(e.p || {}), [inp.dataset.dsc]: inp.checked ? 1 : 0 }; renderProps(); scheduleSave(); hudDirty = true; });
  const ls = el.querySelector('[data-lanes]'); if (ls) ls.onchange = () => setRoadLanes(e, +ls.value, false);
  const dv = el.querySelector('[data-drv]'); if (dv) dv.onchange = () => { pushHistory(); e.p = { ...(e.p || {}), driver: dv.value }; rebuildEntry(e); changed(); renderProps(); };
  el.querySelectorAll('[data-ds]').forEach(inp => inp.onchange = () => { const v = parseFloat(inp.value); if (!isFinite(v)) return; pushHistory(); e.p = { ...(e.p || {}), [inp.dataset.ds]: v }; if (inp.dataset.ds === 'sleepFrom') state.hud.filter(h => h.t === 'alert' && h.kind === 'drowsy' && h.ddd === e.uid).forEach(h => h.from = +(v + 2).toFixed(1)); else rebuildEntry(e); hudDirty = true; scheduleSave(); });
  const pk = el.querySelector('[data-park]'); if (pk) pk.onchange = () => setRoadPark(e, { park: +pk.value });
  const pb = el.querySelector('[data-parkback]'); if (pb) pb.onchange = () => setRoadPark(e, { parkBack: pb.checked ? 1 : 0 });
  el.querySelectorAll('[data-end]').forEach(b => b.onclick = () => { pushHistory(); m.end = b.dataset.end; changed(); renderProps(); });
  const evAdd = brake => { pushHistory(); m.events = m.events || []; const t = +(state.t > 0 ? state.t : Math.min(state.settings.duration / 2, 4)).toFixed(1); m.events.push({ t, v: brake ? 0 : Math.round(m.speed / 2), d: brake ? 1.5 : 2 }); m.events.sort((a, b) => a.t - b.t); renderProps(); scheduleSave(); };
  const act = { move: () => setGizmo('translate'), rotate: () => setGizmo('rotate'), dup: duplicate, del: deleteSelected, detach: () => detach(e),
    'route-new': () => startRoute(false), 'route-add': () => startRoute(true), delpt: deleteSelected, back: () => select(e.uid), lane: () => followLane(e), 'pip-ddd': () => addPip('driver', e.uid), 'demo-ddd': () => demoDDD(e), 'off-ddd': () => offDDD(e), 'pip-360': () => addPip('car360', e.uid), 'park-all': () => setRoadPark(e, {}, true), 'lanes-all': () => setRoadLanes(e, +el.querySelector('[data-lanes]').value, true),
    'ev-brake': () => evAdd(true), 'ev-add': () => evAdd(false),
    'from-now': () => { pushHistory(); e.vis = { ...(e.vis || {}), from: +state.t.toFixed(2) }; updatePropValues(); scheduleSave(); },
    'to-now': () => { pushHistory(); e.vis = { ...(e.vis || {}), to: +state.t.toFixed(2) }; updatePropValues(); scheduleSave(); },
    center: centerCamera,
    watch: () => { setCamMode('follow:' + e.uid); state.t = 0; state.playing = true; tc.detach(); syncPlayBtn(); audioCtx(); } };
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => act[b.dataset.a] && act[b.dataset.a]());
  el.querySelectorAll('[data-a=move],[data-a=rotate]').forEach(b => b.classList.toggle('active', state.markerIdx == null && b.dataset.a === (tc.mode === 'translate' ? 'move' : 'rotate')));
}
function updatePropValues(){
  const el = $('#props'), set = (k, v) => { const i = el.querySelector(`[data-k="${k}"]`); if (i && document.activeElement !== i){ if (i.type === 'checkbox') i.checked = !!v; else i.value = v; } };
  const h = hudById(state.hudSel);
  if (h){ ['x', 'y', 'w', 'h'].forEach(k => set('h' + k, Math.round(h[k]))); return; }
  const e = selEntry(); if (!e) return;
  if (e.parent){ set('z', +e.pos[2].toFixed(2)); set('lx', +(-e.pos[0]).toFixed(2)); set('y', +e.pos[1].toFixed(2)); set('dir', Math.round(-e.rot / DEG)); }
  else { set('x', +e.pos[0].toFixed(2)); set('y', +e.pos[1].toFixed(2)); set('z', +e.pos[2].toFixed(2)); set('rot', Math.round(((e.rot / DEG) % 360 + 360) % 360)); }
  set('scale', e.scale);
  const sv = el.querySelector('[data-v=scale]'); if (sv) sv.textContent = e.scale.toFixed(2) + '×';
  set('from', e.vis?.from || 0); set('to', e.vis?.to || 0);
  if (e.motion){ set('speed', e.motion.speed); set('delay', e.motion.delay); set('loopDist', e.motion.loopDist ?? 80); set('flip', e.motion.flip); }
}
function onPropChange(e, k, inp){
  if (inp.type !== 'range') pushHistory();
  const v = inp.type === 'checkbox' ? inp.checked : inp.tagName === 'SELECT' ? inp.value : parseFloat(inp.value);
  if (typeof v === 'number' && !isFinite(v)) return;
  if (e.parent && (k === 'z' || k === 'lx' || k === 'y' || k === 'dir')){
    if (k === 'z') e.pos[2] = v; if (k === 'lx') e.pos[0] = -v; if (k === 'y') e.pos[1] = v; if (k === 'dir') e.rot = -v * DEG;
  } else if (k === 'x' || k === 'y' || k === 'z'){
    const i = 'xyz'.indexOf(k), d = v - e.pos[i];
    e.pos[i] = v; if (e.motion) e.motion.pts.forEach(p => p[i] += d);
  } else if (k === 'rot') e.rot = v * DEG;
  else if (k === 'scale') e.scale = v;
  else if (k === 'from' || k === 'to') e.vis = { ...(e.vis || {}), [k]: Math.max(0, v) };
  else if (k === 'ego'){ state.entries.forEach(x => x.ego = false); e.ego = v; renderProps(); toast(v ? 'Este é o carro principal: velocidade e distância do Simulador ECU vêm dele.' : 'Carro principal removido'); }
  else e.motion[k] = k === 'speed' || k === 'delay' || k === 'loopDist' ? Math.max(0, v) : v;
  if (k === 'end') renderProps();
  updatePropValues(); changed();
}
function renderHudPanel(el, h){
  const D = HUDT[h.t];
  let html = `<div class="sec"><div class="objhead"><img src="${hudThumbs[h.t] || ''}"><div><b>${esc(D.name)}</b><small>Painel (HUD) · #${h.id}</small></div></div>`;
  if (h.t === 'alert') html += `<p class="note">${h.kind === 'auto' ? 'Mostra a notificação de maior prioridade, com a lógica do APEX (veja o Simulador ECU).' : (h.show === 'always' ? 'Fica visível dentro de “Aparece em / Some em”.' : 'Aparece quando: ' + esc(ALWHY[h.kind] || '') + '.')}</p>`;
  for (const k in D.d) if (h[k] === undefined) h[k] = D.d[k];
  const fl = typeof D.f === 'function' ? D.f(h) : D.f;
  if (fl.length) html += fieldsHTML(fl, h);
  html += `<div class="row2"><label class="field">X<input type="number" data-k="hx"></label><label class="field">Y<input type="number" data-k="hy"></label>${h.t === 'text' ? '' : '<label class="field">Largura<input type="number" data-k="hw"></label><label class="field">Altura<input type="number" data-k="hh"></label>'}</div>`;
  html += fieldsHTML([F.op('op', 'Opacidade')], h) + `</div>`;
  html += `<div class="sec"><h3>Tempo e animação</h3>` + fieldsHTML([F.num('from', 'Aparece em (s)', 0, 3600, 0.1), F.num('to', 'Some em (s, 0 = fim)', 0, 3600, 0.1), ['anim', 'Animação', 'sel', ANIMS]], h)
    + `<div class="btns"><button class="btn sm" data-a="from-now">Aparecer agora (${state.t.toFixed(1)}s)</button><button class="btn sm" data-a="to-now">Sumir agora</button></div></div>`;
  html += `<div class="sec"><div class="btns"><button class="btn" data-a="dup">Duplicar</button><button class="btn danger" data-a="del">Excluir</button></div><div class="btns"><button class="btn" data-a="up">Para frente</button><button class="btn" data-a="dn">Para trás</button></div></div>`;
  el.innerHTML = html;
  bindFields(el, h, k => { if (h.t === 'pip' && (k === 'kind' || k === 'view')) renderProps(); if (k === 'kind' && h.t === 'alert'){ ['title', 'msg', 'sub', 'sev', 'num'].forEach(p => delete h[p]); renderProps(); } if (k === 'show' || k === 'kind') renderProps(); hudDirty = true; });
  el.querySelectorAll('[data-k]').forEach(inp => inp.addEventListener('change', () => { pushHistory(); const v = parseFloat(inp.value); if (!isFinite(v)) return; h[inp.dataset.k.slice(1)] = v; hudDirty = true; scheduleSave(); }));
  updatePropValues();
  const i = () => state.hud.indexOf(h);
  const act = { dup: duplicate, del: deleteSelected,
    up: () => { const k = i(); if (k < state.hud.length - 1){ pushHistory(); [state.hud[k], state.hud[k + 1]] = [state.hud[k + 1], state.hud[k]]; renderLayers(); } },
    dn: () => { const k = i(); if (k > 0){ pushHistory(); [state.hud[k], state.hud[k - 1]] = [state.hud[k - 1], state.hud[k]]; renderLayers(); } },
    'from-now': () => { pushHistory(); h.from = +state.t.toFixed(2); renderProps(); scheduleSave(); },
    'to-now': () => { pushHistory(); h.to = +state.t.toFixed(2); renderProps(); scheduleSave(); } };
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { act[b.dataset.a](); hudDirty = true; });
}
const ECUF = [['speed', 'Velocidade', 'km/h', 0, 240], ['lead', 'Veículo à frente', 'm', 0, 150], ['limit', 'Limite da via', 'km/h', 30, 130], ['power', 'Potência', 'kW', -100, 300], ['soc', 'Bateria', '%', 0, 100], ['temp', 'Temp. bateria', '°C', 0, 120], ['ambient', 'Temp. ambiente', '°C', -10, 45], ['hd', 'Rumo', '°', 0, 359]];
const NTF = [['adas', 'Assistência (ADAS) ligada'], ['leadOn', 'Veículo à frente detectado'], ['door', 'Porta aberta'], ['snd', 'Som das notificações (vai para o vídeo)']];
const SITF = [['drowsy', 'Motorista com sono / olhos fechados (DDD)'], ['hands', 'Mãos fora do volante'], ['lanedep', 'Carro saindo da faixa'], ['lkaoff', 'Assistente de faixa indisponível'], ['camblk', 'Câmera obstruída'], ['parkblk', 'Sensor de estacionamento bloqueado'], ['steerf', 'Falha na direção assistida']];
const ecuAuto = () => +ECU.auto && !!egoEntry();
function ecuLabels(){
  for (const [k] of ECUF){ const b = document.getElementById('ev_' + k); if (b) b.textContent = ECU[k]; const r = document.querySelector(`[data-ecu="${k}"]`); if (r && document.activeElement !== r){ r.value = ECU[k]; r.disabled = ecuAuto() && (k === 'speed' || k === 'lead'); } }
  const lo = document.querySelector('[data-ecu="leadOn"]'); if (lo){ lo.checked = !!+ECU.leadOn; lo.disabled = ecuAuto(); }
}
function renderScenePanel(el){
  const S = state.settings, sel = (v, list) => list.map(([a, b]) => `<option value="${a}" ${String(v) === String(a) ? 'selected' : ''}>${b}</option>`).join('');
  const camOpts = [['', '— manter a câmera —'], ...camOptions()];
  const ci = curStepIdx(state.t);
  el.innerHTML = `<details class="sec" open><summary>Passo a passo (${state.steps.length})</summary>
      <p class="note">Cada passo começa num tempo da cena. Na apresentação (▶ Apresentar), a cena para no começo de cada passo e continua quando você clica — ideal para explicar o ADAS ao cliente.</p>
      ${state.steps.map((s, i) => `<div class="step ${i === ci ? 'cur' : ''}"><div class="hd"><b>${i + 1}</b><input type="number" step="0.1" min="0" data-st="${i}" data-sk="t" value="${s.t}" title="Começa em (s)"><input class="tt" type="text" data-st="${i}" data-sk="title" value="${esc(s.title)}" placeholder="Título"><button class="btn sm" data-sgo="${i}" title="Ir para este passo">▶</button><button class="btn sm danger" data-sdel="${i}">✕</button></div>
        <textarea data-st="${i}" data-sk="text" placeholder="Explicação para o cliente">${esc(s.text)}</textarea>
        <select data-st="${i}" data-sk="cam" style="margin-top:5px">${sel(s.cam || '', camOpts)}</select></div>`).join('')}
      <div class="btns"><button class="btn primary" id="addStep">+ Passo em ${state.t.toFixed(1)}s</button>${state.hud.some(h => h.t === 'step') ? '' : '<button class="btn" id="addStepCard">+ Card do passo na tela</button>'}</div></details>
    <details class="sec" open><summary>Cena</summary>
      <label class="field">Ambiente<select data-s="env">${sel(S.env, Object.entries(ENVS).map(([k, v]) => [k, v.name]))}</select></label>
      <div class="row2"><label class="field">Cor do chão<input type="color" data-s="ground" value="${S.ground}"></label><label class="field">Duração (s)<input type="number" min="1" max="600" step="1" data-s="duration" value="${S.duration}"></label></div>
      <label class="field">Formato da foto / vídeo<select data-s="res">${sel(S.res, [['1280x720', 'HD 1280×720'], ['1920x1080', 'Full HD 1920×1080'], ['3840x2160', '4K 3840×2160'], ['1080x1920', 'Vertical 1080×1920 (Reels)'], ['1080x1080', 'Quadrado 1080×1080'], ['tela', 'Tamanho da tela']])}</select></label>
      <div class="row2"><label class="field">Largura do GIF<select data-s="gifw">${sel(S.gifw || 640, [[480, '480 px'], [640, '640 px'], [800, '800 px'], [960, '960 px']])}</select></label><label class="field">Brilho<input type="range" min="0.4" max="2" step="0.05" data-s="exposure" value="${S.exposure}"></label></div>
      <p class="note">${state.entries.length} objetos 3D · ${state.hud.length} itens no painel</p></details>
    <details class="sec"><summary>Câmeras salvas (${state.shots.length})</summary>
      ${state.shots.map((s, i) => `<div class="shot"><input value="${esc(s.name)}" data-shot="${i}"><button class="btn sm" data-go="${i}" title="Ver">👁</button><button class="btn sm" data-upd="${i}" title="Atualizar com a vista atual">⟳</button><button class="btn sm danger" data-del="${i}">✕</button></div>`).join('') || '<p class="note">Posicione a câmera com o mouse e salve vistas para usar nos passos, na foto ou no vídeo.</p>'}
      <h3 style="margin-top:10px">🔄 Câmera 360°</h3>
      <div class="row2"><label class="field">Voltas durante a cena<input type="number" min="0.25" max="10" step="0.25" data-o="turns" value="${orbitParams().turns}"></label><label class="field">Altura (°)<input type="number" min="2" max="88" step="1" data-o="height" value="${orbitParams().height}"></label></div>
      <div class="row2"><label class="field">Distância (m, 0 = automática)<input type="number" min="0" max="2000" step="1" data-o="dist" value="${orbitParams().dist}"></label><label class="field">Sentido<select data-o="dir"><option value="1" ${orbitParams().dir > 0 ? 'selected' : ''}>Anti-horário</option><option value="-1" ${orbitParams().dir < 0 ? 'selected' : ''}>Horário</option></select></label></div>
      <p class="note">Escolha “🔄 360° em volta…” na lista de câmeras (embaixo). Para girar em volta de um objeto parado, selecione-o e clique em 🎯 Centralizar câmera.</p>
      <div class="btns"><button class="btn" id="o360">▶ Ver 360° da cena</button></div>
      <label class="field" style="margin-top:6px">Lente (zoom) <span id="fovv">${Math.round(camera.fov)}°</span><input type="range" min="15" max="90" step="1" id="fov" value="${camera.fov}"></label>
      <div class="btns"><button class="btn primary" id="addShot">+ Salvar vista atual</button></div></details>
    <details class="sec ecu" open><summary>Simulador ECU</summary>
      <label class="chk" style="margin-bottom:8px"><input type="checkbox" data-ecu="auto" ${+ECU.auto ? 'checked' : ''}> Velocidade e distância vindas do ★ carro principal</label>
      ${egoEntry() ? '' : '<p class="note">Marque um veículo como “★ Carro principal” (painel do veículo) para a ECU acompanhar a cena.</p>'}
      ${ECUF.map(([k, l, u, a, b]) => `<label><span>${l}: <b id="ev_${k}">${ECU[k]}</b> ${u}</span><input type="range" data-ecu="${k}" min="${a}" max="${b}" value="${ECU[k]}"></label>`).join('')}
      <div class="row2"><label class="field">Marcha<select data-ecu="gear">${['P', 'R', 'N', 'D'].map(g => `<option ${ECU.gear === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label><label class="field">Modo<select data-ecu="mode">${['COMFORT', 'SPORT', 'ECO', 'OFF-ROAD'].map(g => `<option ${ECU.mode === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label></div>
      <div class="row2"><label class="chk"><input type="checkbox" data-ecu="blL" ${+ECU.blL ? 'checked' : ''}> Pisca esq.</label><label class="chk"><input type="checkbox" data-ecu="blR" ${+ECU.blR ? 'checked' : ''}> Pisca dir.</label></div></details>
    <details class="sec"><summary>Notificações ADAS</summary>
      <p class="note">Cada card só aparece enquanto a situação dele acontece. Para mostrar um card num momento exato, use a Notificação ADAS em “Sempre” e ajuste “Aparece em / Some em”.</p>
      <div id="ntst"></div>
      ${NTF.map(([k, l]) => `<label class="chk" style="display:flex;margin-bottom:6px"><input type="checkbox" data-ecu="${k}" ${+ECU[k] ? 'checked' : ''}> ${l}</label>`).join('')}
      <h3 style="margin-top:10px">Situações simuladas</h3>
      ${SITF.map(([k, l]) => `<label class="chk" style="display:flex;margin-bottom:6px"><input type="checkbox" data-ecu="${k}" ${+ECU[k] ? 'checked' : ''}> ${l}</label>`).join('')}
      <div class="btns"><button class="btn" id="addAlertAuto">+ Card automático no canto</button></div></details>
    <details class="sec"><summary>Como montar uma cena ADAS</summary><ol class="steps">
      <li>Monte a via com <b>Estradas</b> (ou Piso + Vagas para estacionamento).</li>
      <li>Coloque o carro, desenhe a rota e marque <b>★ Carro principal</b>.</li>
      <li>Em <b>ADAS (efeitos)</b>, escolha um efeito e clique no carro: cone de radar, zona, sensores, linhas guia…</li>
      <li>Use <b>Frear / acelerar no tempo</b> e <b>Aparece em / Some em</b> para contar a história.</li>
      <li>Adicione o <b>Painel (HUD)</b>: título, velocidade, notificações, indicadores.</li>
      <li>Crie os <b>passos</b> acima e clique em <b>▶ Apresentar</b>.</li></ol></details>
    <details class="sec"><summary>Atalhos</summary><div class="keys">
      <kbd>Botão esq.</kbd><span>girar câmera / selecionar</span><kbd>Botão dir.</kbd><span>arrastar câmera</span><kbd>Roda</kbd><span>zoom</span>
      <kbd>R</kbd><span>girar 90°</span><kbd>Q / E</kbd><span>girar 15°</span><kbd>G / T</kbd><span>mover / girar com setas</span>
      <kbd>Ctrl+D</kbd><span>duplicar</span><kbd>Delete</kbd><span>excluir</span><kbd>Ctrl+Z</kbd><span>desfazer</span>
      <kbd>F</kbd><span>focar no objeto</span><kbd>Espaço</kbd><span>play / pausa</span><kbd>V</kbd><span>apresentar</span>
      <kbd>→ / ←</kbd><span>próximo / anterior passo (apresentação)</span><kbd>Alt</kbd><span>mover sem encaixe</span><kbd>Esc</kbd><span>cancelar</span></div></details>`;
  ntStat(); ecuLabels();
  el.querySelectorAll('[data-s]').forEach(inp => {
    const k = inp.dataset.s;
    inp.addEventListener(inp.type === 'range' || inp.type === 'color' ? 'input' : 'change', () => {
      S[k] = inp.type === 'number' || inp.type === 'range' ? parseFloat(inp.value) : inp.value;
      if (k === 'env'){ if (S.env === 'apex' && S.ground === '#6d9c4a') S.ground = '#11161c'; else if (S.env !== 'apex' && S.ground === '#11161c') S.ground = '#6d9c4a'; el.querySelector('[data-s=ground]').value = S.ground; }
      if (k === 'duration'){ S.duration = Math.max(1, S.duration || 12); updateTimeUI(); renderMarks(); }
      applyEnv(); layoutStage(); scheduleSave();
    });
  });
  el.querySelectorAll('[data-st]').forEach(inp => {
    const i = +inp.dataset.st, k = inp.dataset.sk;
    inp.addEventListener('focus', () => pushHistory());
    inp.addEventListener(k === 't' || k === 'cam' ? 'change' : 'input', () => {
      const s = state.steps[i]; s[k] = k === 't' ? Math.max(0, parseFloat(inp.value) || 0) : inp.value;
      if (k === 't'){ sortSteps(); renderProps(); } renderMarks(); hudDirty = true; scheduleSave();
    });
  });
  el.querySelectorAll('[data-sdel]').forEach(b => b.onclick = () => { pushHistory(); state.steps.splice(+b.dataset.sdel, 1); renderProps(); renderMarks(); hudDirty = true; scheduleSave(); });
  el.querySelectorAll('[data-sgo]').forEach(b => b.onclick = () => { const s = state.steps[+b.dataset.sgo]; setTime(s.t, true); if (s.cam) setCamMode(s.cam); renderProps(); });
  $('#addStep').onclick = () => {
    pushHistory(); const t = +state.t.toFixed(1);
    if (state.steps.some(s => Math.abs(s.t - t) < 0.05)){ toast('Já existe um passo neste tempo — mova a barra de tempo antes'); history.pop(); return; }
    state.steps.push({ t, title: 'Passo ' + (state.steps.length + 1), text: '', cam: '' }); sortSteps(); renderProps(); renderMarks(); hudDirty = true; scheduleSave();
  };
  const sc = $('#addStepCard'); if (sc) sc.onclick = () => addHud('step');
  $('#addAlertAuto').onclick = () => addHud('alert');
  el.querySelectorAll('[data-shot]').forEach(i => i.onchange = () => { state.shots[+i.dataset.shot].name = i.value || 'Câmera'; populateCamSelect(); scheduleSave(); });
  el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { const s = state.shots[+b.dataset.go]; setCamMode('free'); camera.position.fromArray(s.pos); orbit.target.fromArray(s.target); camera.fov = s.fov; camera.updateProjectionMatrix(); });
  el.querySelectorAll('[data-upd]').forEach(b => b.onclick = () => { pushHistory(); Object.assign(state.shots[+b.dataset.upd], curShot()); scheduleSave(); toast('Câmera atualizada'); });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { pushHistory(); state.shots.splice(+b.dataset.del, 1); populateCamSelect(); renderProps(); scheduleSave(); });
  el.querySelectorAll('[data-o]').forEach(inp => inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (!isFinite(v)) return; state.settings.orbit = { ...orbitParams(), [inp.dataset.o]: v }; camSnap = true; scheduleSave(); }));
  $('#o360').onclick = () => { setCamMode('auto'); setTime(0, true); togglePlay(); };
  $('#fov').oninput = ev => { if (state.camMode !== 'free') setCamMode('free'); camera.fov = +ev.target.value; camera.updateProjectionMatrix(); $('#fovv').textContent = ev.target.value + '°'; };
  $('#addShot').onclick = () => {
    if (state.camMode !== 'free') setCamMode('free');
    pushHistory(); state.shots.push({ name: 'Câmera ' + (state.shots.length + 1), ...curShot() });
    populateCamSelect(); renderProps(); scheduleSave(); toast('Vista salva! Use nos passos ou na lista de câmeras.');
  };
  el.querySelectorAll('[data-ecu]').forEach(inp => inp.addEventListener('input', () => {
    const k = inp.dataset.ecu; ECU[k] = inp.type === 'checkbox' ? (inp.checked ? 1 : 0) : inp.type === 'range' ? +inp.value : inp.value;
    if (k === 'snd' && ECU.snd) audioCtx();
    ecuFromScene(); ecuLabels(); hudDirty = true; scheduleSave();
  }));
}
const curShot = () => ({ pos: camera.position.toArray(), target: orbit.target.toArray(), fov: camera.fov });

/* ---------------- movimento: painel claro ---------------- */
function movHTML(e){
  const m = e.motion, info = MODELS[e.model], who = info.isPed ? 'pedestre' : info.isVehicle ? 'veículo' : 'objeto';
  const cur = m.type === 'route' && m.byLane ? 'lane' : m.type, opt = (k, t, sub) => `<button class="mopt ${cur === k ? 'on' : ''}" data-mt="${k}"><b>${t}</b><small>${sub}</small></button>`;
  let h = `<div class="sec mov"><h3>🚗 Como este ${who} se move</h3>`;
  if (isMoving(e) && state.t > 0.001) h += '<p class="note">⏮ Para arrastar no mapa, volte ao início da cena (ele está andando agora).</p>';
  h += `<div class="mopts">${opt('none', '⏸ Parado', 'fica no lugar')}${opt('lane', '🛣 Seguir a faixa', 'automático na estrada com faixas')}${opt('route', '✎ Desenhar trajeto', 'você clica o caminho no chão')}${opt('forward', '➡ Reto', 'anda em linha reta')}</div>`;
  if (m.type === 'none'){ h += `<p class="note">Escolha acima como ele deve andar.</p></div>`; return h; }
  h += `<div class="row2"><label class="field">Velocidade (km/h)<input type="number" min="0" step="5" data-k="speed"></label><label class="field">Começa a andar em (s)<input type="number" min="0" step="0.5" data-k="delay"></label></div>`;
  if (m.type === 'forward') h += `<label class="field">Distância do percurso (m) — 0 = sem fim<input type="number" min="0" step="5" data-k="loopDist"></label>`;
  if (info.isVehicle){
    const leads = state.entries.filter(x => x !== e && MODELS[x.model]?.isVehicle && x.motion && x.motion.type !== 'none'), acc = m.acc || {};
    h += `<label class="field">🛡 Manter distância do veículo da frente (ACC)<select data-acc="1"><option value="">Não — velocidade fixa</option>${leads.map(x => `<option value="${x.uid}" ${+acc.lead === x.uid ? 'selected' : ''}>Seguir ${esc(entryName(x))}</option>`).join('')}</select></label>`;
    if (acc.lead) h += `<div class="row2"><label class="field">Distância em tempo (s)<input type="number" min="0.5" max="5" step="0.1" data-accv="hw" value="${acc.hw ?? 1.8}"></label><label class="field">Distância mínima (m)<input type="number" min="1" max="50" step="0.5" data-accv="min" value="${acc.min ?? 4}"></label></div>
      <p class="note">A velocidade acima vira a <b>máxima</b>. Ele acelera e freia sozinho conforme o veículo da frente, sem bater. Use “Frear / acelerar” no veículo da frente para ver o ajuste.</p>`;
  }
  if (m.type === 'route'){
    h += m.pts.length >= 2
      ? `<p class="note">Trajeto: ${m.pts.length} pontos · ${getCurve(e).L.toFixed(0)} m. Clique nas bolinhas brancas no mapa para ajustar.</p>
         <div class="btns"><button class="btn sm" data-a="lane">🛣 Refazer pela faixa</button><button class="btn sm" data-a="route-new">✎ Redesenhar</button><button class="btn sm" data-a="route-add">+ Pontos</button></div>`
      : `<div class="btns"><button class="btn primary" data-a="route-new">✎ Desenhar trajeto</button></div>`;
  }
  const end = (k, t) => `<button class="${m.end === k ? 'on' : ''}" data-end="${k}">${t}</button>`;
  h += `<label class="field" style="margin-top:8px">Quando chegar no fim do percurso</label><div class="seg">${end('repeat', '🔁 Volta ao início')}${m.type === 'route' ? end('loop', '↻ Circuito') : ''}${end('stop', '⏹ Para')}</div>`;
  h += `<p class="note">${m.end === 'stop' ? 'Ele anda uma vez e fica parado no final.' : m.end === 'loop' ? 'Circuito: o fim do trajeto emenda no começo (bom para pistas fechadas).' : 'Loop: quando chega no fim, reaparece no começo e anda de novo.'}</p>`;
  h += `<label class="field">Frear / acelerar em um momento da cena</label>` + (m.events || []).map((ev, i) => `<div class="evrow"><span>aos</span><input type="number" step="0.1" min="0" data-ev="${i}" data-evk="t" value="${ev.t}"><span>s →</span><input type="number" step="5" min="0" data-ev="${i}" data-evk="v" value="${ev.v}"><span>km/h em</span><input type="number" step="0.1" min="0.05" data-ev="${i}" data-evk="d" value="${ev.d}"><span>s</span><button class="btn sm danger" data-evdel="${i}">✕</button></div>`).join('')
    + `<div class="btns"><button class="btn sm" data-a="ev-brake">+ Frear até parar</button><button class="btn sm" data-a="ev-add">+ Mudar velocidade</button></div>`;
  h += `<label class="chk" style="margin-top:8px"><input type="checkbox" data-k="ego" ${e.ego ? 'checked' : ''}> ★ Carro principal (alimenta o Simulador ECU)</label>
    <label class="chk" style="margin-top:6px"><input type="checkbox" data-k="flip"> Inverter frente do modelo (se andar de ré)</label>
    <div class="btns" style="margin-top:8px"><button class="btn" data-a="watch">🎥 Testar seguindo</button></div></div>`;
  return h;
}
function setMotion(e, kind){
  const m = e.motion;
  if (kind === 'lane'){ followLane(e); return; }
  pushHistory();
  m.type = kind;
  if (kind === 'route' && m.pts.length >= 2) e.pos = m.pts[0].slice();
  if (m.end === 'loop' && kind !== 'route') m.end = 'repeat';
  changed(); select(e.uid);
  if (kind === 'route' && m.pts.length < 2) startRoute(false);
  if (kind === 'forward') toast('Andando reto. Ajuste a velocidade e a distância do percurso no painel.');
}

/* ---------------- estradas: seguir a faixa e emendar trechos (peças Kenney) ---------------- */
function roadEnds(re, i){
  const spec = roadSpec(re), o = objects.get(re.uid), path = spec.paths[i], a = path.at(0), b = path.at(path.L);
  o.updateMatrixWorld(true);
  const q = o.getWorldQuaternion(new THREE.Quaternion());
  return { re, i, o, p: spec.P, path, q, start: o.localToWorld(a.p.clone()), end: o.localToWorld(b.p.clone()), t0: a.t.clone().applyQuaternion(q), t1: b.t.clone().applyQuaternion(q) };
}
function roadEntryAt(x, z){
  downRay.set(new V3(x, 300, z), new V3(0, -1, 0));
  for (const h of downRay.intersectObjects(roadObjs, true)){
    let r = h.object; while (r && r.userData.uid === undefined) r = r.parent;
    const re = r && getEntry(r.userData.uid);
    if (re && roadSpec(re)) return re;
  }
  return null;
}
const roadsWithPaths = () => state.entries.filter(c => roadSpec(c) && objects.get(c.uid) && !c.hidden);
// gera o trajeto pela faixa mais próxima e continua pelas peças emendadas na ponta
function followLane(e, quiet){
  const m = e.motion, o = objects.get(e.uid);
  if (state.t > 0.001) setTime(0, true);
  poseAt(e, o, 0); objectsGroup.updateMatrixWorld(true);
  const wp = o.getWorldPosition(new V3());
  const re = roadEntryAt(wp.x, wp.z);
  if (!re){ if (!quiet) toast('Coloque o veículo em cima de uma estrada (reta, curva ou cruzamento) para ele seguir a faixa sozinho. Em rotatórias e peças especiais, use “Desenhar trajeto”.'); return false; }
  const fwd = new V3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion())); if (m.flip) fwd.negate();
  // escolhe o eixo da peça (no cruzamento há dois) mais perto e mais alinhado com o veículo
  let R = null, best = null, score = Infinity;
  roadSpec(re).paths.forEach((_, i) => {
    const Ri = roadEnds(re, i), lp = Ri.o.worldToLocal(wp.clone()), N = Math.ceil(Ri.path.L / 0.25);
    let bi = { d: Infinity };
    for (let k = 0; k <= N; k++){ const s = Ri.path.L * k / N, a = Ri.path.at(s), d = Math.hypot(lp.x - a.p.x, lp.z - a.p.z); if (d < bi.d) bi = { d, s, a, lp }; }
    const sc = bi.d * 0.1 + (1 - Math.abs(fwd.dot(bi.a.t.clone().applyQuaternion(Ri.q))));
    if (sc < score){ score = sc; R = Ri; best = bi; }
  });
  const off = (best.lp.x - best.a.p.x) * best.a.n.x + (best.lp.z - best.a.p.z) * best.a.n.z;
  const lanes = lanesOf(R.p), lane = lanes.reduce((x, y) => Math.abs(y.off - off) < Math.abs(x.off - off) ? y : x);
  let dir = lane.dir;
  // fora da mão certa? segue o sentido para onde o veículo aponta
  if (fwd.dot(best.a.t.clone().applyQuaternion(R.q)) * dir < -0.3) dir = -dir;
  const relW = lane.off * dir * roadSpec(re).n, pts = [];   // lado da faixa em metros, relativo ao sentido de marcha
  const lo = (Rr, d) => relW / roadSpec(Rr.re).n * d;
  const push = (Rr, ss, lo) => { const a = Rr.path.at(ss), w = Rr.o.localToWorld(a.p.clone().add(a.n.clone().multiplyScalar(lo))), l = pts[pts.length - 1]; if (!l || Math.hypot(w.x - l[0], w.z - l[2]) > 0.3) pts.push([w.x, surfaceY(w.x, w.z), w.z]); };
  const seg = (Rr, s0, s1, lo) => { const k = Math.max(1, Math.ceil(Math.abs(s1 - s0) / 3)); for (let i = 0; i <= k; i++) push(Rr, s0 + (s1 - s0) * i / k, lo); };
  let s = best.s, closed = false, pieces = 1;
  const visited = new Set(), startKey = re.uid + ':' + R.i;
  for (let k = 0; k < 200; k++){
    visited.add(R.re.uid + ':' + R.i);
    seg(R, s, dir > 0 ? R.path.L : 0, lo(R, dir));
    const endPt = dir > 0 ? R.end : R.start, endT = (dir > 0 ? R.t1 : R.t0).clone().multiplyScalar(dir);
    let next = null;
    for (const c of roadsWithPaths()){
      if (c === R.re) continue;
      for (let i = 0; i < roadSpec(c).paths.length && !next; i++){
        const C = roadEnds(c, i);
        if (C.start.distanceTo(endPt) < 1.2 && C.t0.dot(endT) > 0.9) next = { C, s: 0, d: 1 };
        else if (C.end.distanceTo(endPt) < 1.2 && C.t1.dot(endT) < -0.9) next = { C, s: C.path.L, d: -1 };
      }
      if (next) break;
    }
    if (!next) break;
    const key = next.C.re.uid + ':' + next.C.i;
    if (key === startKey){ seg(next.C, next.s, best.s, lo(next.C, next.d)); closed = true; break; }
    if (visited.has(key)) break;
    R = next.C; s = next.s; dir = next.d; pieces++;
  }
  if (closed && pts.length > 2 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][2] - pts.at(-1)[2]) < 1.5) pts.pop();
  if (pts.length < 2){ if (!quiet) toast('O veículo está no fim da estrada — coloque-o mais para o começo da pista.'); return false; }
  if (!quiet) pushHistory();
  m.type = 'route'; m.pts = pts; m.byLane = true; e.pos = pts[0].slice();
  m.end = closed ? 'loop' : (m.end === 'loop' ? 'repeat' : m.end);
  if (quiet) return true;
  changed(); select(e.uid);
  toast(`Pronto! Segue a faixa por ${getCurve(e).L.toFixed(0)} m${pieces > 1 ? ` (${pieces} peças de estrada)` : ''}${closed ? ' em circuito fechado' : ''}. Aperte ▶ para ver.`);
  return true;
}
// ponta livre da peça (onde não há outra peça encaixada): ponto e direção para fora
function freeEnd(e){
  const spec = roadSpec(e), others = roadsWithPaths().filter(c => c !== e);
  const taken = pt => others.some(c => roadSpec(c).paths.some((_, i) => { const C = roadEnds(c, i); return C.start.distanceTo(pt) < 1.2 || C.end.distanceTo(pt) < 1.2; }));
  let first = null;
  for (let i = 0; i < spec.paths.length; i++){
    const R = roadEnds(e, i);
    for (const [pt, h] of [[R.end, R.t1], [R.start, R.t0.clone().negate()]]){
      const c = { pt, h }; if (!first) first = c;
      if (!taken(pt)) return c;
    }
  }
  return first;
}
const CONT = { reta: ['k:road-straight', false], dir: ['k:road-bend', false], esq: ['k:road-bend', true], 'dir-l': ['k:road-curve', false], 'esq-l': ['k:road-curve', true], cruz: ['k:road-crossroad', false] };
// ---------- conexão inteligente entre peças ----------
// pontas livres de todas as estradas (opcionalmente ignorando uma peça, a que está sendo arrastada)
function roadFreeEnds(excludeUid){
  const roads = roadsWithPaths().filter(c => c.uid !== excludeUid), all = [];
  for (const c of roads) roadSpec(c).paths.forEach((_, i) => { const R = roadEnds(c, i); all.push({ c, pt: R.end, h: R.t1.clone() }, { c, pt: R.start, h: R.t0.clone().negate() }); });
  return all.filter(a => !all.some(b => b.c !== a.c && b.pt.distanceTo(a.pt) < 1.2)).map(a => ({ ...a, n: lanesPerSide(a.c), y: a.c.pos[1] }));
}
// posição e giro para a peça "info" (com n faixas por sentido) encostar na ponta "end", entrando pelo eixo i (rev = pelo outro lado)
function connectPose(info, n, end, i, rev){
  const path = kPath(kroadOf(info).paths[i]), S = rev ? path.at(path.L).p : path.at(0).p, T0 = rev ? path.at(path.L).t.clone().negate() : path.at(0).t;
  const rot = Math.atan2(end.h.x, end.h.z) - Math.atan2(T0.x, T0.z), c = Math.cos(rot), sn = Math.sin(rot), sx = S.x * n, sz = S.z * n;
  return { pos: [end.pt.x - (sx * c + sz * sn), end.y, end.pt.z - (-sx * sn + sz * c)], rot, n };
}
// todas as maneiras diferentes de encaixar a peça nessa ponta (sem repetir as que dão o mesmo resultado)
function connectOptions(info, n, end){
  const d = kroadOf(info), out = [], seen = new Set();
  d.paths.forEach((pd, i) => [false, true].forEach(rev => {
    const P = connectPose(info, n, end, i, rev), c = Math.cos(P.rot), sn = Math.sin(P.rot);
    const key = d.paths.map(q => { const pa = kPath(q); return [pa.at(0).p, pa.at(pa.L).p].map(v => { const x = P.pos[0] + (v.x * n * c + v.z * n * sn), z = P.pos[2] + (-v.x * n * sn + v.z * n * c); return Math.round(x) + ',' + Math.round(z); }).sort().join(';'); }).sort().join('|');
    if (!seen.has(key)){ seen.add(key); out.push(P); }
  }));
  return out;
}
// procura uma ponta livre perto do ponto (x, z) e devolve o encaixe escolhido
function smartConnect(info, x, z, excludeUid, pick = 0, near){
  if (!kroadOf(info) || !state.snap || altDown) return null;
  let best = null, bd = Infinity;
  for (const end of roadFreeEnds(excludeUid)){
    const d = near ? Math.min(...near.map(p => Math.hypot(p.x - end.pt.x, p.z - end.pt.z))) : Math.hypot(x - end.pt.x, z - end.pt.z);
    if (d < TILE * end.n * 0.8 && d < bd){ bd = d; best = end; }
  }
  if (!best) return null;
  const opts = connectOptions(info, best.n, best);
  opts.sort((a, b) => Math.hypot(a.pos[0] - x, a.pos[2] - z) - Math.hypot(b.pos[0] - x, b.pos[2] - z));
  return { ...opts[((pick % opts.length) + opts.length) % opts.length], count: opts.length, to: best.c };
}
function continueRoad(e, kind){
  const [model, rev] = CONT[kind], info = MODELS[model]; if (!info) return;
  const end = freeEnd(e), n = lanesPerSide(e);
  const { pos, rot } = connectPose(info, n, { ...end, y: e.pos[1] }, 0, rev);
  pushHistory();
  const ne = { uid: nextUid++, model, pos, rot, scale: n, vis: { from: 0, to: 0 }, motion: null, p: { lanes: n, ...inheritPark(e, model) } };
  state.entries.push(ne); sortEntries(); createObject(ne); changed(); select(ne.uid);
  toast('Peça encaixada na ponta da estrada. Continue emendando pela barra de cima.');
}
// liga/desliga vagas de estacionamento numa reta (ou em todas as retas)
function setRoadPark(e, patch, all){
  pushHistory();
  const v = { park: +(e.p?.park || 0), parkBack: e.p?.parkBack ?? 1, ...patch };
  const list = all ? state.entries.filter(x => parkable(MODELS[x.model])) : [e];
  for (const x of list){ x.p = { ...(x.p || {}), ...v }; rebuildEntry(x); }
  changed(); renderProps();
  if (all) toast(`Vagas aplicadas em ${list.length} reta(s).`);
}
// a reta nova emendada numa reta com vagas já vem com as mesmas vagas
const inheritPark = (to, model) => parkable(MODELS[model]) && to && parkable(MODELS[to.model]) && to.p?.park ? { park: to.p.park, parkBack: to.p.parkBack ?? 1 } : {};
// muda o número de faixas de uma peça (ou da pista inteira, mantendo tudo encaixado)
function setRoadLanes(e, n, all){
  pushHistory();
  state.roadLanes = n;
  if (!all){ e.p = { ...(e.p || {}), lanes: n }; e.scale = n; rebuildEntry(e); changed(); renderProps(); return; }
  const roads = state.entries.filter(x => roadSpec(x));
  const old = lanesPerSide(e), k = n / old;
  const c = new V3(); roads.forEach(r => c.add(new V3(...r.pos))); c.divideScalar(roads.length);
  const sc = p => { p[0] = c.x + (p[0] - c.x) * k; p[2] = c.z + (p[2] - c.z) * k; };
  for (const x of state.entries){
    if (x.parent) continue;
    if (roadSpec(x)){ x.p = { ...(x.p || {}), lanes: Math.max(1, Math.min(4, Math.round(lanesPerSide(x) * k))) }; x.scale = lanesPerSide(x); sc(x.pos); continue; }
    sc(x.pos); if (x.motion) x.motion.pts.forEach(sc);
  }
  rebuild();
  let redo = 0;
  for (const x of state.entries) if (x.motion && x.motion.byLane){ x.pos[1] = surfaceY(x.pos[0], x.pos[2]) || x.pos[1]; if (followLane(x, true)) redo++; }
  changed(); select(e.uid);
  toast(`Pista inteira com ${n * 2} faixas.${redo ? ` ${redo} veículo(s) refizeram o trajeto pela faixa.` : ''}`);
}

/* ---------------- barra rápida sobre a cena ---------------- */
function renderQuick(){
  const q = $('#quick'), e = selEntry();
  let h = '';
  if (state.multi.length > 1 && !state.preview && state.mode === 'select'){
    const es = state.multi.map(getEntry), grouped = es[0]?.group && es.every(x => x.group === es[0].group);
    h = `<b>${grouped ? '⛓ Grupo' : '☑ Seleção'}: ${es.length} objetos</b>${grouped ? '<button class="btn sm" data-q="ungroup">Desagrupar</button>' : '<button class="btn sm primary" data-q="group">⛓ Agrupar</button>'}<button class="btn sm" data-q="center">🎯 Centralizar câmera</button>`;
    q.innerHTML = h; q.style.display = 'flex'; return;
  }
  if (e && !state.preview && state.mode === 'select' && state.markerIdx == null){
    const info = MODELS[e.model], m = e.motion;
    if (m){
      const cur = m.type === 'route' && m.byLane ? 'lane' : m.type, t = k => cur === k ? 'active' : '';
      h = `<b>${info.isPed ? '🚶' : '🚗'} ${esc(entryName(e))}</b>
        <button class="btn sm ${t('none')}" data-q="none">⏸ Parado</button>
        <button class="btn sm ${t('lane')}" data-q="lane" title="Gera o trajeto sozinho pela faixa da Estrada com faixas">🛣 Seguir a faixa</button>
        <button class="btn sm ${t('route')}" data-q="route">✎ Desenhar trajeto</button>
        <button class="btn sm ${t('forward')}" data-q="forward">➡ Reto</button>
        ${m.type !== 'none' ? `<button class="btn sm ${m.end !== 'stop' ? 'active' : ''}" data-q="loop" title="Quando chegar no fim, volta ao início">🔁 Repetir: ${m.end !== 'stop' ? 'sim' : 'não'}</button>` : ''}
        <button class="btn sm" data-q="center" title="Centralizar a câmera neste objeto">🎯</button>
        <button class="btn sm primary" data-q="test">▶ Testar</button>`;
    } else if (kroadOf(info)){
      const n = lanesPerSide(e);
      h = `<b>🛣 ${esc(info.name)}</b>
        <select class="qsel" data-ql="1" title="Número de faixas desta peça">${LANE_OPTS.map(([v]) => `<option value="${v}" ${n === v ? 'selected' : ''}>${v * 2} faixas</option>`).join('')}</select>
        ${parkable(info) ? `<select class="qsel" data-qp="1" title="Vagas de estacionamento ao lado">${PARK_OPTS.map(([v, l]) => `<option value="${v}" ${+(e.p?.park || 0) === v ? 'selected' : ''}>🅿 ${v ? 'Vagas: ' + l.toLowerCase() : 'Sem vagas'}</option>`).join('')}</select>` : ''}
        <span class="qn">Emendar na ponta:</span>
        <button class="btn sm" data-q="c-reta">⬆ Reta</button><button class="btn sm" data-q="c-esq">↰ Curva</button><button class="btn sm" data-q="c-dir">↱ Curva</button>
        <button class="btn sm" data-q="c-esq-l">↰ Curva larga</button><button class="btn sm" data-q="c-dir-l">↱ Curva larga</button><button class="btn sm" data-q="c-cruz">✚ Cruzamento</button>`;
    }
  }
  q.innerHTML = h; q.style.display = h ? 'flex' : 'none';
}
$('#quick').addEventListener('change', ev => { const sl = ev.target.closest('[data-ql]'), sp = ev.target.closest('[data-qp]'), e = selEntry(); if (sl && e) setRoadLanes(e, +sl.value, false); if (sp && e) setRoadPark(e, { park: +sp.value }); });
$('#quick').addEventListener('click', ev => {
  const b = ev.target.closest('[data-q]'), e = selEntry(); if (!b || !e) return;
  const k = b.dataset.q, m = e.motion;
  if (k === 'group') return groupSelected();
  if (k === 'ungroup') return ungroupSelected();
  if (k === 'center') return centerCamera();
  if (k === 'none' || k === 'route' || k === 'forward' || k === 'lane') setMotion(e, k);
  else if (k === 'loop'){
    pushHistory();
    const near = m.type === 'route' && m.pts.length > 2 && Math.hypot(m.pts[0][0] - m.pts.at(-1)[0], m.pts[0][2] - m.pts.at(-1)[2]) < 12;
    m.end = m.end === 'stop' ? (near ? 'loop' : 'repeat') : 'stop';
    changed(); renderProps();
  }
  else if (k === 'test'){ setTime(0, true); togglePlay(); }
  else if (k.startsWith('c-')) continueRoad(e, k.slice(2));
});

/* ---------------- ajuda e loop da cena ---------------- */
function showHelp(on){ $('#help').style.display = on ? 'flex' : 'none'; if (on) try { localStorage.setItem('cena3d-help-seen', '1'); } catch {} }
$('#bHelp').onclick = () => showHelp(true);
$('#help').addEventListener('click', ev => { if (ev.target.id === 'help' || ev.target.closest('[data-close]')) showHelp(false); });
$('#loopBtn').onclick = () => { state.settings.loop = state.settings.loop === false; syncLoopBtn(); scheduleSave(); toast(state.settings.loop !== false ? '🔁 A cena repete do começo quando termina' : 'A cena para quando chega no fim'); };
function syncLoopBtn(){ const b = $('#loopBtn'); b.classList.toggle('active', state.settings.loop !== false); b.textContent = state.settings.loop !== false ? '🔁 Loop' : '➡ 1 vez'; b.title = state.settings.loop !== false ? 'Loop ligado: a cena inteira repete quando termina (clique para desligar)' : 'Loop desligado: a cena para no fim (clique para ligar)'; }

/* ---------------- seleção múltipla e grupos ---------------- */
const groupPivot = new THREE.Object3D(); helpers.add(groupPivot);
let groupDrag = null;
const selUids = () => state.multi.length > 1 ? state.multi : state.selected != null ? [state.selected] : [];
function membersBox(uids){
  const b = new THREE.Box3();
  for (const u of uids){ const e = getEntry(u), o = objects.get(u); if (e && o) b.union(boxOf(e).clone().applyMatrix4(o.matrixWorld)); }
  return b;
}
function multiCenter(){ const b = membersBox(state.multi); return b.isEmpty() ? new V3() : b.getCenter(new V3()); }
function groupMovable(){ return !state.multi.some(u => { const e = getEntry(u); return isMoving(e) && state.t > 0.001; }); }
function attachGroupPivot(){
  const c = multiCenter(); groupPivot.position.set(c.x, 0, c.z); groupPivot.rotation.set(0, 0, 0); groupPivot.updateMatrixWorld();
  tc.attach(groupPivot);
  if (tc.mode === 'rotate'){ tc.showX = tc.showZ = false; tc.showY = true; } else { tc.showX = tc.showZ = true; tc.showY = false; }
  tc.setRotationSnap(state.snap ? 15 * DEG : null);
}
function groupDragStart(){
  groupDrag = { c: groupPivot.position.clone(), items: state.multi.map(u => { const e = getEntry(u); return { e, pos: e.pos.slice(), rot: e.rot, pts: e.motion ? e.motion.pts.map(p => p.slice()) : null }; }) };
}
function groupDragMove(){
  if (!groupDrag) groupDragStart();
  const g = groupDrag, hasRoad = g.items.some(it => MODELS[it.e.model].isRoad);
  let dx = groupPivot.position.x - g.c.x, dz = groupPivot.position.z - g.c.z;
  if (state.snap && !altDown){ const st = hasRoad ? TILE : 0.5; dx = Math.round(dx / st) * st; dz = Math.round(dz / st) * st; }
  const a = tc.mode === 'rotate' ? yawOf(groupPivot.quaternion) : 0, ca = Math.cos(a), sa = Math.sin(a);
  const tf = p => { const x = p[0] - g.c.x, z = p[2] - g.c.z; return [g.c.x + x * ca + z * sa + dx, p[1], g.c.z - x * sa + z * ca + dz]; };
  for (const it of g.items){
    it.e.pos = tf(it.pos); it.e.rot = it.rot + a;
    if (it.pts) it.e.motion.pts = it.pts.map(tf);
  }
  roadObjs = state.entries.filter(x => MODELS[x.model]?.isRoad).map(x => objects.get(x.uid));
  refreshRoutes(); sceneBoundsDirty = true;
}
function groupSelected(){
  if (state.multi.length < 2) return;
  pushHistory(); const id = 'g' + (nextUid++);
  state.multi.forEach(u => getEntry(u).group = id);
  changed(); renderProps(); toast(`Grupo criado com ${state.multi.length} objetos. Clicar em qualquer um seleciona o grupo todo.`);
}
function ungroupSelected(){
  pushHistory(); state.multi.forEach(u => { delete getEntry(u).group; });
  changed(); renderProps(); toast('Grupo desfeito');
}
function renderMultiPanel(el){
  const es = state.multi.map(getEntry).filter(Boolean), grouped = es.length > 1 && es[0].group && es.every(x => x.group === es[0].group);
  el.innerHTML = `<div class="sec"><h3>${grouped ? '⛓ Grupo' : 'Seleção'} — ${es.length} objetos</h3>
    <p class="note">${grouped ? 'Clique em qualquer objeto do grupo para selecionar todos. Arraste as setas para mover tudo junto.' : 'Ctrl + clique (ou Shift + clique) adiciona ou tira objetos da seleção.'}</p>
    <div class="btns">${grouped ? '<button class="btn" data-a="ungroup">Desagrupar</button>' : '<button class="btn primary" data-a="group">⛓ Agrupar</button>'}<button class="btn" data-a="center">🎯 Centralizar câmera</button></div>
    <div class="btns"><button class="btn" data-a="move">✥ Mover</button><button class="btn" data-a="rotate">⟳ Girar</button></div>
    <div class="btns"><button class="btn" data-a="dup">Duplicar</button><button class="btn danger" data-a="del">Excluir</button></div></div>
    <div class="sec"><h3>Objetos</h3>${es.map(x => `<div class="lay" data-kid="${x.uid}"><span class="nm">${esc(MODELS[x.model].name)}</span><small>#${x.uid}</small></div>`).join('')}</div>`;
  const act = { group: groupSelected, ungroup: ungroupSelected, center: centerCamera, dup: duplicate, del: deleteSelected,
    move: () => { tc.setMode('translate'); syncGizmo(true); }, rotate: () => { tc.setMode('rotate'); syncGizmo(true); } };
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => act[b.dataset.a]());
  el.querySelectorAll('[data-kid]').forEach(b => b.onclick = () => { state.multi = []; select(+b.dataset.kid, false, true); });
}

/* ---------------- centralizar câmera e câmera 360 ---------------- */
function centerCamera(){
  const uids = selUids(); if (!uids.length) return;
  const b = membersBox(uids); if (b.isEmpty()) return;
  const p = b.getCenter(new V3()), size = b.getSize(new V3()).length();
  if (state.camMode !== 'free') setCamMode('free');
  const off = camera.position.clone().sub(orbit.target); if (off.lengthSq() < 1e-6) off.set(1, 0.8, 1);
  off.setLength(Math.max(8, size * 1.6));
  orbit.target.copy(p); camera.position.copy(p).add(off);
  state.orbitUid = uids.length === 1 ? uids[0] : null;
  populateCamSelect();
  toast(uids.length === 1 ? `Câmera centralizada. Para girar 360° em volta dele, escolha “🔄 360° em volta de ${entryName(getEntry(uids[0]))}” na lista de câmeras.` : 'Câmera centralizada na seleção.');
}
function orbitParams(){ return { turns: 1, height: 25, dist: 0, dir: 1, ...(state.settings.orbit || {}) }; }

/* ---------------- medidor: clicar nos dois objetos ---------------- */
function startMeasure(){
  cancelModes(); select(null);
  state.mode = 'measure'; state.measureA = null; markLib(); updateHint();
}
function measureClick(){
  const e = pickEntity(x => { const i = MODELS[x.model]; return !i.isRoad && !i.fx && i.solid !== false; });
  let ref = null;
  if (e && MODELS[e.model].solid) ref = { uid: e.uid };
  else { const p = pickSurface(); if (p) ref = { pt: p.toArray() }; }
  if (!ref) return;
  if (!state.measureA){ state.measureA = ref; updateHint(); toast(ref.uid != null ? `Primeiro: ${entryName(getEntry(ref.uid))}. Agora clique no segundo objeto.` : 'Primeiro ponto marcado. Agora clique no segundo objeto ou ponto.'); return; }
  const info = MODELS['f:measure'];
  pushHistory();
  const ne = { uid: nextUid++, model: 'f:measure', pos: [0, 0, 0], rot: 0, scale: 1, vis: { from: 0, to: 0 }, motion: null, p: { ...JSON.parse(JSON.stringify(info.def.defaults)), a: state.measureA, b: ref } };
  state.entries.push(ne); sortEntries(); createObject(ne);
  state.measureA = null; state.mode = 'select'; markLib(); updateHint(); changed(); select(ne.uid);
  toast('Medida criada! Ela acompanha os objetos quando eles andam.');
}

/* ---------------- colar pistas arrastando ---------------- */
let painting = null;
function paintStart(ev){
  painting = { last: null };
  orbit.enabled = false;
  setRay(ev); updateGhost();
  const e = placeGhost(); if (e) painting.last = e.uid;
}
function paintMove(ev){
  setRay(ev); updateGhost();
  const g = state.ghost, cn = state.ghostConn, last = painting.last && getEntry(painting.last);
  if (!g || !g.visible || !cn || !last || cn.to.uid !== last.uid) return;
  const lo = objects.get(last.uid), lc = lo.getWorldPosition(new V3());
  const p = new V3(); if (!ray.ray.intersectPlane(groundPlane, p)) return;
  if (Math.hypot(p.x - lc.x, p.z - lc.z) < TILE * lanesPerSide(last) * 0.6) return;
  const e = placeGhost(true); if (e) painting.last = e.uid;
}
function paintEnd(){ painting = null; orbit.enabled = state.camMode === 'free'; }

/* ---------------- dicas ---------------- */
let toastTimer;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.style.opacity = 1; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.style.opacity = 0, 3200); }
function updateHint(host, conn){
  const h = $('#hint');
  if (state.mode === 'measure'){ h.innerHTML = state.measureA ? '📏 Agora clique no <b>segundo</b> objeto (ou ponto no chão) · <b>Esc</b> cancela' : '📏 Clique no <b>primeiro</b> objeto que quer medir (ou num ponto do chão) · <b>Esc</b> cancela'; h.style.display = 'block'; return; }
  if (conn){ h.innerHTML = `🔗 Encaixando em <b>${esc(entryName(conn.to))}</b>${conn.count > 1 ? ' · <b>R</b> troca o lado' : ''} · segure <b>Alt</b> para soltar livre`; h.style.display = 'block'; return; }
  if (state.mode === 'place'){
    const info = MODELS[state.placing];
    h.innerHTML = info.attach ? (host ? `Clique para prender <b>${esc(info.name)}</b> em <b>${esc(entryName(host))}</b>` : `Passe o mouse sobre um <b>veículo</b> para prender <b>${esc(info.name)}</b> (ou clique no chão para deixar parado) · <b>Esc</b> sai`)
      : kroadOf(info) ? `Clique para colocar <b>${esc(info.name)}</b> · <b>segure e arraste</b> para ir colando pista · <b>R</b> gira · <b>Esc</b> sai` : `Clique para colocar <b>${esc(info.name)}</b> · <b>R</b> gira · <b>Esc</b> ou botão direito sai`;
    h.style.display = 'block';
  }
  else if (state.mode === 'route'){ h.innerHTML = 'Clique na estrada para marcar o caminho · <b>Enter</b> conclui · <b>Backspace</b> desfaz ponto · <b>Esc</b> cancela'; h.style.display = 'block'; }
  else h.style.display = 'none';
}
function updateEmpty(){
  const el = $('#empty'), show = !state.entries.length && !state.hud.length && !state.preview;
  el.style.display = show ? 'block' : 'none';
  if (show) el.innerHTML = `<div style="font-size:15px;font-weight:600;margin-bottom:8px">Cena vazia — monte do seu jeito</div>
    <div style="text-align:left;font-size:13px;line-height:1.6">1. Escolha uma <b>estrada</b> na Biblioteca e clique aqui<br>2. Coloque um <b>veículo</b> e desenhe a rota<br>3. Prenda <b>efeitos ADAS</b> clicando no veículo<br>4. Adicione o <b>painel (HUD)</b> e crie os <b>passos</b></div>`;
}

/* ---------------- teclado e botões ---------------- */
addEventListener('keydown', ev => {
  if (ev.target.closest && ev.target.closest('input,select,textarea')) return;
  const k = ev.key.toLowerCase(), ctrl = ev.ctrlKey || ev.metaKey;
  altDown = ev.altKey;
  if (ctrl && k === 'z'){ ev.preventDefault(); undo(); return; }
  if (ctrl && k === 'd'){ ev.preventDefault(); duplicate(); return; }
  if (ctrl && k === 'g'){ ev.preventDefault(); ev.shiftKey ? ungroupSelected() : groupSelected(); return; }
  if (ctrl && k === 's'){ ev.preventDefault(); saveFile(); return; }
  if (ctrl) return;
  if (state.preview){
    if (k === ' ' || k === 'arrowright' || k === 'pagedown' || k === 'enter'){ ev.preventDefault(); if (state.playing && k === ' ') togglePlay(); else stepNav(1); }
    else if (k === 'arrowleft' || k === 'pageup'){ ev.preventDefault(); stepNav(-1); }
    else if (k === 'escape'){ if (state.recording) stopRecording(false); else setPreview(false); }
    else if (k === 'v') setPreview(false);
    return;
  }
  if (k === ' '){ ev.preventDefault(); togglePlay(); return; }
  if (k === 'escape' && $('#help').style.display === 'flex'){ showHelp(false); return; }
  if (k === 'escape'){
    if (state.recording) stopRecording(false);
    else if (state.mode !== 'select') cancelModes();
    else if (state.markerIdx != null) select(state.selected);
    else { state.multi = []; select(null); selectHud(null); }
    return;
  }
  if (state.mode === 'route'){
    if (k === 'enter') finishRoute();
    if (k === 'backspace'){ ev.preventDefault(); if (state.draft.pts.length > 1){ state.draft.pts.pop(); refreshRoutes(); renderProps(); } }
    return;
  }
  if (state.hudSel != null && k.startsWith('arrow')){ ev.preventDefault(); const s = ev.shiftKey ? 10 : 1; moveHud(k === 'arrowright' ? s : k === 'arrowleft' ? -s : 0, k === 'arrowdown' ? s : k === 'arrowup' ? -s : 0); return; }
  if (k === 'delete' || k === 'backspace'){ ev.preventDefault(); deleteSelected(); }
  else if (k === 'r') rotateBy(-Math.PI / 2);
  else if (k === 'q') rotateBy(15 * DEG);
  else if (k === 'e') rotateBy(-15 * DEG);
  else if (k === 'g' && state.selected){ if (state.multi.length > 1){ tc.setMode('translate'); syncGizmo(true); } else setGizmo('translate'); }
  else if (k === 't' && state.selected){ if (state.multi.length > 1){ tc.setMode('rotate'); syncGizmo(true); } else setGizmo('rotate'); }
  else if (k === 'f') centerCamera();
  else if (k === 'v') setPreview(true);
});
addEventListener('keyup', ev => { altDown = ev.altKey; });

$('#playBtn').onclick = togglePlay;
$('#stopBtn').onclick = () => { if (state.recording) return; setTime(0, true); lastStepIdx = -2; if (state.selected && !state.preview) select(state.selected); };
$('#time').oninput = ev => { if (state.recording) return; tc.detach(); state.markerIdx = null; setTime(+ev.target.value, true); };
$('#time').onchange = () => { if (!state.selected && !state.hudSel) renderProps(); };
$('#camSel').onchange = ev => setCamMode(ev.target.value);
$('#photoBtn').onclick = takePhoto;
$('#gifBtn').onclick = makeGif;
$('#recBtn').onclick = toggleRecording;
$('#bPreview').onclick = () => setPreview(!state.preview);
$('#exitPreview').onclick = () => setPreview(false);
$('#stNext').onclick = () => { if (state.playing) togglePlay(); else stepNav(1); };
$('#stPrev').onclick = () => stepNav(-1);
$('#stPause').onchange = ev => { state.stepPause = ev.target.checked; };
$('#bUndo').onclick = undo;
$('#cSnap').onchange = ev => { state.snap = ev.target.checked; if (state.selected) setGizmo(tc.mode, true); };
$('#cGrid').onchange = ev => { state.grid = ev.target.checked; };
$('#bNew').onclick = () => { if ((state.entries.length || state.hud.length) && !confirm('Começar uma cena vazia? (a atual será apagada)')) return; pushHistory(); state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); Object.assign(ECU, JSON.parse(JSON.stringify(ECU_DEFAULT)));
  state.roadLanes = 1; state.multi = []; state.orbitUid = null; setCamMode('free'); state.freeCam = null;
  camera.position.set(30, 24, 30); orbit.target.set(0, 0, 0); camera.fov = 50; camera.updateProjectionMatrix();
  loadScene({ entries: [], hud: [], steps: [], shots: [], settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), ecu: JSON.parse(JSON.stringify(ECU_DEFAULT)) }).then(syncLoopBtn); toast('Cena nova, tudo do zero'); };
function saveFile(){ download(new Blob([JSON.stringify(serialize(true))], { type:'application/json' }), `cena-adas-${stamp()}.json`); toast('Projeto salvo em arquivo'); }
$('#bSave').onclick = saveFile;
$('#bOpen').onclick = () => $('#fOpen').click();
$('#fOpen').onchange = async ev => {
  const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (!Array.isArray(d.entries)) throw 0; pushHistory(); await loadScene(d); toast('Projeto carregado'); }
  catch (err) { console.error(err); toast('Arquivo inválido'); }
};
$('#bImport').onclick = () => $('#fImport').click();
$('#fImport').onchange = async ev => {
  const files = [...ev.target.files]; ev.target.value = '';
  for (const f of files){
    const buf = await f.arrayBuffer(); let s = ''; const u = new Uint8Array(buf);
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    const name = f.name.replace(/\.glb$/i, '');
    const info = await addCustom({ id: 'c:' + name + ':' + Date.now().toString(36), name, data: btoa(s) });
    if (info){ state.cat = 'Meus modelos'; renderCats(); renderItems(); toast(`“${name}” adicionado (${info.size.x.toFixed(1)}×${info.size.y.toFixed(1)}×${info.size.z.toFixed(1)} m)`); }
  }
  scheduleSave();
};

/* ---------------- inicialização ---------------- */
async function init(){
  const defs = DATA.models;
  for (let i = 0; i < defs.length; i++){
    const d = defs[i];
    try { const obj = await parseGLB(b64ToBuf(d.data)); if (d.pack === 'chars') CHARS[d.file] = rigCharacter(obj); else registerModel(d, obj); } catch (err) { console.warn('Falha ao carregar', d.file, err); }
    d.data = null;
    if (i % 8 === 0){ $('#loadbar').style.width = (i / defs.length * 100) + '%'; $('#loadtxt').textContent = `${i} / ${defs.length}`; await new Promise(r => setTimeout(r)); }
  }
  for (const p of PROCS){ try { registerProc(p); } catch (err) { console.error('Falha no modelo', p.id, err); } }
  makeMountains();
  let custom = []; try { custom = JSON.parse(localStorage.getItem('cena3d-custom') || '[]'); } catch {}
  for (const c of custom) await addCustom(c, true);
  renderCats(); renderItems();
  $('#loading').remove();
  let saved = null; try { saved = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch {}
  await loadScene(saved && saved.entries ? saved : { entries: [], hud: [], steps: [], shots: [] });
  layoutStage(); syncLoopBtn();
  try { if (!localStorage.getItem('cena3d-help-seen')) showHelp(true); } catch {}
  requestAnimationFrame(frame);
  const list = Object.values(MODELS).filter(m => !m.thumb);
  (function step(i){ if (i >= list.length) return; for (let j = i; j < Math.min(i + 6, list.length); j++){ try { makeThumb(list[j]); } catch (err) { console.warn(err); } } setTimeout(() => step(i + 6), 0); })(0);
}
init().catch(err => { console.error(err); $('#loadtxt').textContent = 'Erro ao iniciar: ' + err.message + ' (é preciso internet para carregar o three.js)'; });
