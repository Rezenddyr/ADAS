import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

const V3 = THREE.Vector3;
const $ = s => document.querySelector(s);
const TILE = 8;                 // 1 bloco Kenney = 8 metros
const KENNEY_SCALE = 8;
const DEG = Math.PI / 180;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const clamp = THREE.MathUtils.clamp;

/* ---------------- nomes em português ---------------- */
const NAMES = {
  car_sedan:'Sedã',car_hatchback:'Hatch',car_suv:'SUV',car_sports:'Esportivo',car_taxi:'Táxi',car_police:'Polícia',pickup_truck:'Picape',race_car:'Carro de corrida',
  delivery_van:'Van de entrega',camper_van:'Motorhome',ambulance:'Ambulância',box_truck:'Caminhão baú',fire_truck:'Bombeiros',garbage_truck:'Caminhão de lixo',
  fuel_tanker:'Caminhão tanque',city_bus:'Ônibus',school_bus:'Ônibus escolar',forklift:'Empilhadeira',golf_cart:'Carrinho de golfe',motorbike:'Moto',scooter:'Scooter',
  bicycle:'Bicicleta',rowboat:'Barco a remo',motorboat:'Lancha',sailboat:'Veleiro',jet_ski:'Jet ski',
  street_lamp:'Poste',double_lamp:'Poste duplo',park_lamp:'Luminária de praça',traffic_light:'Semáforo',bench:'Banco',fire_hydrant:'Hidrante',trash_can:'Lixeira',
  dumpster:'Caçamba',bus_stop:'Ponto de ônibus',bollard:'Balizador',planter:'Floreira',newspaper_box:'Caixa de jornal',traffic_cone:'Cone',barrier:'Barreira',
  road_sign_stop:'Placa PARE',road_sign_street:'Placa de rua',crosswalk_sign:'Placa pedestre',speed_bump:'Lombada',manhole:'Bueiro',taxi:'Táxi simples',kiosk:'Quiosque',
  phone_booth:'Orelhão',awning_shop:'Loja com toldo',street_food_cart:'Carrinho de lanche',mailbox:'Caixa de correio',parking_meter:'Parquímetro'
};
const TOK = {road:'',straight:'reta',bend:'curva',curve:'curva larga',crossroad:'cruzamento',intersection:'junção T',roundabout:'rotatória',end:'fim',side:'lateral',
  entry:'entrada',exit:'saída',split:'bifurcação',slant:'rampa',slantHigh:'rampa alta',high:'alta',flat:'plana',barrier:'c/ barreira',bridge:'ponte',pillar:'pilar',crossing:'faixa pedestre',
  driveway:'acesso',single:'simples',double:'duplo',square:'quadrada',half:'meia',light:'poste',sign:'placa',tile:'piso',low:'baixo',wide:'largo',pole:'poste',
  electricity:'elétrico',wires:'fios',construction:'obra',cone:'cone',fence:'cerca',traffic:'semáforo',hanging:'suspenso',object:'',highway:'rodovia',
  detailed:'detalhada',empty:'vazia',stop:'pare',street:'rua',warning:'aviso',curved:'curvo',cross:'cruz',line:'c/ linha',path:'c/ caminho',pavement:'calçada',
  sidewalk:'calçada',round:'redondo',horizontal:'horizontal',vertical:'vertical',dumpster:'caçamba'};
function niceName(pack, file){
  if (NAMES[file] && pack !== 'kenney') return NAMES[file];
  if (pack === 'kenney'){
    let w = file.split('-').map(t => TOK[t] ?? t).filter(Boolean).join(' ');
    if (file.startsWith('road-')) w = 'Estrada ' + w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  const s = file.replace(/[_-]+/g,' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ---------------- renderer / cena ---------------- */
const view = $('#view'), stage = $('#stage'), hudEl = $('#hud');
const renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
stage.prepend(renderer.domElement);
renderer.domElement.tabIndex = 0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 16/9, 0.1, 4000);
camera.position.set(30, 24, 30);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true; orbit.dampingFactor = 0.12;
orbit.maxPolarAngle = Math.PI * 0.495;
orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

const hemi = new THREE.HemisphereLight();
scene.add(hemi);
const sun = new THREE.DirectionalLight();
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left:-100, right:100, top:100, bottom:-100, near:1, far:500 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

const skyU = { top:{ value:new THREE.Color() }, bottom:{ value:new THREE.Color() } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), new THREE.ShaderMaterial({
  uniforms: skyU, side: THREE.BackSide, depthWrite:false, fog:false,
  vertexShader:`varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader:`uniform vec3 top; uniform vec3 bottom; varying vec3 vW;
    void main(){ float h = normalize(vW - cameraPosition).y; gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.02, 0.5, h)), 1.0);
    #include <colorspace_fragment>
    }`
}));
sky.frustumCulled = false; sky.renderOrder = -2;
scene.add(sky);
scene.fog = new THREE.Fog(0xffffff, 150, 1200);
let mountains = null;   // fundo APEX

const groundMat = new THREE.MeshStandardMaterial({ color:'#6d9c4a', roughness:1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), groundMat);
ground.rotation.x = -Math.PI/2; ground.position.y = -0.02; ground.receiveShadow = true;
scene.add(ground);

const objectsGroup = new THREE.Group(); scene.add(objectsGroup);
const helpers = new THREE.Group(); scene.add(helpers);
const grid = new THREE.GridHelper(800, 100, 0x000000, 0x000000);
grid.material.transparent = true; grid.material.opacity = 0.16; grid.material.depthWrite = false;
grid.position.set(TILE/2, 0.01, TILE/2);
helpers.add(grid);
const routeGroup = new THREE.Group(); helpers.add(routeGroup);
const selBox = new THREE.Box3Helper(new THREE.Box3(), 0xffb547); selBox.visible = false; helpers.add(selBox);
const hoverDot = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), new THREE.MeshBasicMaterial({ color:0xffb547, depthTest:false, transparent:true, opacity:.8 }));
hoverDot.visible = false; hoverDot.renderOrder = 10; helpers.add(hoverDot);

const tc = new TransformControls(camera, renderer.domElement);
tc.showY = false;
tc.addEventListener('dragging-changed', e => { orbit.enabled = !e.value && state.camMode === 'free'; });
scene.add(tc);

/* ---------------- modelos ---------------- */
const DATA = JSON.parse($('#model-data').textContent);
const AST = DATA.ast;
const manager = new THREE.LoadingManager();
manager.setURLModifier(url => /colormap\.png$/i.test(url) ? DATA.colormap : url);
const loader = new GLTFLoader(manager);
const MODELS = {};
const CATS = ['Estradas','Veículos','Pessoas e natureza','Rua','Sinalização','Placas e marcações','ADAS (efeitos)','Painel (HUD)','Meus modelos'];
const CATNOTE = {
  'ADAS (efeitos)':'Clique em cima de um veículo para prender o efeito nele (ele anda junto). Clicando no chão, o efeito fica parado no lugar.',
  'Painel (HUD)':'Itens 2D desenhados por cima da imagem, como no cluster. Arraste para posicionar; o quadrado do canto muda o tamanho.',
  'Estradas':'Escolha uma peça e clique no chão. Com a peça selecionada, mude o número de faixas e emende retas, curvas e cruzamentos pela barra de cima.',
  'Pessoas e natureza':'Pessoas andam (mexendo braços e pernas) quando recebem uma rota. Para colocar alguém dentro de um carro, moto ou bicicleta, selecione o veículo e escolha a pessoa no painel.'
};
const glowMats = new Set();
const customDefs = [];
const DEFAULT_HOST = new THREE.Box3(new V3(-0.94, 0, -2.31), new V3(0.94, 1.47, 2.31));

function b64ToBuf(b64){ const s = atob(b64); const u = new Uint8Array(s.length); for (let i=0;i<s.length;i++) u[i] = s.charCodeAt(i); return u.buffer; }
function parseGLB(buf){ return new Promise((res, rej) => loader.parse(buf, '', g => res(g.scene), rej)); }

function registerModel(def, obj){
  const pack = def.pack;
  const isRoad = pack === 'kenney' && /^(road-|tile-|bridge-)/.test(def.file);
  const cat = pack === 'kenney' ? (isRoad ? 'Estradas' : 'Sinalização') : pack === 'vehicles' ? 'Veículos' : pack === 'street' ? 'Rua' : 'Meus modelos';
  if (pack === 'kenney') obj.scale.multiplyScalar(KENNEY_SCALE);
  const root = new THREE.Group(); root.add(obj); root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new V3());
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = size.y > 0.3; o.receiveShadow = true;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (/headlight|taillight|glow/i.test(m.name)) glowMats.add(m); });
  });
  const isVehicle = pack === 'vehicles' || def.file === 'taxi' || !!def.vehicle;
  return MODELS[def.id] = {
    id:def.id, file:def.file, pack, cat, isRoad, tpl:root, box, size,
    name: def.name || niceName(pack, def.file),
    isVehicle, movable: !isRoad, solid: !isRoad,
    isLamp: /lamp|^light-/.test(def.file), thumb:''
  };
}
function registerProc(def){
  const tpl = def.build({ ...def.defaults }, DEFAULT_HOST, true);
  tpl.updateMatrixWorld(true);
  const box = def.fx ? new THREE.Box3(new V3(-1, 0, -1), new V3(1, 1, 1)) : new THREE.Box3().setFromObject(tpl);
  return MODELS[def.id] = {
    id:def.id, name:def.name, cat:def.cat, proc:true, def, tpl, box, size: box.getSize(new V3()),
    isRoad: !!def.road, isVehicle:false, isPed: !!def.ped, fx: !!def.fx, attach: !!def.attach, world: !!def.world,
    movable: !!def.movable, solid: !!def.solid, isLamp:false, thumb:''
  };
}

/* thumbnails */
const thumbR = new THREE.WebGLRenderer({ antialias:true, alpha:true, preserveDrawingBuffer:true });
thumbR.setSize(128, 128); thumbR.toneMapping = THREE.ACESFilmicToneMapping;
const tScene = new THREE.Scene();
tScene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 2.2));
const tLight = new THREE.DirectionalLight(0xffffff, 2.2); tLight.position.set(3, 6, 4); tScene.add(tLight);
const tCam = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
function makeThumb(info){
  const o = info.tpl;
  tScene.add(o); o.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(o);
  if (b.isEmpty()) b.set(new V3(-1,0,-1), new V3(1,1,1));
  const c = b.getCenter(new V3()), r = Math.max(0.05, b.getSize(new V3()).length() / 2);
  const d = r / Math.sin(15 * DEG) * 1.02;
  const dir = info.fx ? new V3(0.9, 1.4, -0.9) : new V3(1, 0.85, 1.25);
  tCam.position.copy(c).add(dir.normalize().multiplyScalar(d));
  tCam.near = d / 100; tCam.far = d * 10; tCam.updateProjectionMatrix(); tCam.lookAt(c);
  thumbR.render(tScene, tCam);
  info.thumb = thumbR.domElement.toDataURL();
  tScene.remove(o);
  const img = document.querySelector(`.item[data-id="${CSS.escape(info.id)}"] img`); if (img) img.src = info.thumb;
}

/* ---------------- estado ---------------- */
const DEFAULT_SETTINGS = { env:'dia', duration:12, res:'1920x1080', ground:'#6d9c4a', exposure:1, gifw:640, loop:true,
  orbit: { turns:1, height:25, dist:0, dir:1 } };
const state = {
  entries: [], hud: [], steps: [], shots: [],
  settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
  selected: null, multi: [], orbitUid: null, measureA: null, hudSel: null, mode: 'select', placing: null, ghost: null, ghostRot: 0, ghostHost: null,
  snap: true, grid: true, t: 0, playing: false, preview: false, recording: false, capturing: false,
  camMode: 'free', freeCam: null, draft: null, hover: null, markerIdx: null, cat: 'Estradas', stepPause: true
};
let nextUid = 1;
const objects = new Map();
const getEntry = uid => state.entries.find(e => e.uid === uid);
const selEntry = () => getEntry(state.selected);
const defaultMotion = info => ({ type:'none', speed: info.isVehicle ? 40 : info.isPed ? 5 : 10, delay:0, end:'repeat', flip:false, pts:[], events:[], loopDist: 80 });
const childrenOf = uid => state.entries.filter(e => e.parent === uid);
function boxOf(e){
  const o = objects.get(e.uid);
  if (o && o.userData.box) return o.userData.box;
  return MODELS[e.model]?.box || DEFAULT_HOST;
}
const hostBoxOf = e => e.parent ? boxOf(getEntry(e.parent) || {}) : DEFAULT_HOST;

/* ---------------- objetos ---------------- */
function buildObject(e){
  const info = MODELS[e.model];
  let o;
  if (info.proc){
    o = info.def.build({ ...info.def.defaults, ...(e.p || {}) }, hostBoxOf(e), false);
    o.updateMatrixWorld(true);
    if (!info.fx) o.userData.box = new THREE.Box3().setFromObject(o);
  } else { o = info.tpl.clone(true); if (info.isRoad && lanesPerSide(e) > 1) addLaneLines(o, info, lanesPerSide(e)); if (info.isRoad) addParking(o, info, e); if (info.isVehicle) addRider(o, info, e); }
  o.userData.uid = e.uid;
  return o;
}
function createObject(e){
  const info = MODELS[e.model]; if (!info) return;
  const o = buildObject(e);
  const parent = e.parent ? objects.get(e.parent) : null;
  if (parent && !info.world) parent.add(o); else objectsGroup.add(o);
  objects.set(e.uid, o);
  poseAt(e, o, state.t);
}
function removeObject(uid){ const o = objects.get(uid); if (o && o.parent) o.parent.remove(o); objects.delete(uid); }
function rebuildEntry(e){
  const wasAttached = tc.object === objects.get(e.uid);
  removeObject(e.uid); curveCache.delete(e.uid);
  createObject(e);
  for (const c of childrenOf(e.uid)){ const co = objects.get(c.uid); if (co && !MODELS[c.model].world) objects.get(e.uid).add(co); }
  if (wasAttached) tc.attach(objects.get(e.uid));
  nightSig = '';
}
function sortEntries(){ state.entries.sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0)); }
function rebuild(){
  tc.detach(); state.markerIdx = null;
  for (const o of objects.values()) if (o.parent) o.parent.remove(o);
  objects.clear(); curveCache.clear(); nightSig = ''; nightLights.length = 0;
  fxIcons.forEach(sp => iconGroup.remove(sp)); fxIcons.clear(); fxSnd.forEach(sp => iconGroup.remove(sp)); fxSnd.clear(); accCache.clear();
  state.entries = state.entries.filter(e => MODELS[e.model] && (!e.parent || state.entries.some(p => p.uid === e.parent)));
  sortEntries();
  state.entries.forEach(createObject);
  if (state.selected && !selEntry()) state.selected = null;
  if (state.hudSel && !state.hud.find(h => h.id === state.hudSel)) state.hudSel = null;
  changed();
  select(state.selected);
}
let roadObjs = [];
function changed(){
  roadObjs = state.entries.filter(e => MODELS[e.model]?.isRoad).map(e => objects.get(e.uid)).filter(Boolean);
  refreshRoutes(); populateCamSelect(); updateNightLights(); sceneBoundsDirty = true; renderLayers(); updateEmpty(); scheduleSave();
}

/* ---------------- movimento ---------------- */
const curveCache = new Map();
function getCurve(e){
  const m = e.motion, key = m.end + JSON.stringify(m.pts);
  let c = curveCache.get(e.uid);
  if (c && c.key === key) return c;
  const curve = makeCurve(m.pts, m.end === 'loop');
  c = { key, curve, L: curve.getLength() };
  curveCache.set(e.uid, c);
  return c;
}
function makeCurve(pts, closed){
  const v = pts.map(p => new V3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(v, closed && v.length > 2, 'centripetal', 0.5);
  curve.arcLengthDivisions = Math.max(200, v.length * 60);
  return curve;
}
// distância percorrida (m) e velocidade (m/s) no tempo t, com mudanças de velocidade (frear / acelerar)
function profile(m, t){
  const t0 = m.delay || 0;
  let v = m.speed / 3.6;
  if (t <= t0) return { s: 0, v: 0, started: false };
  let s = 0, time = t0;
  const evs = (m.events || []).filter(e => isFinite(e.t)).slice().sort((a, b) => a.t - b.t);
  for (const ev of evs){
    const st = Math.max(ev.t, time);
    if (st >= t) break;
    s += v * (st - time); time = st;
    const v1 = Math.max(0, ev.v) / 3.6, d = Math.max(0.05, ev.d || 0.05), a = (v1 - v) / d;
    const end = Math.min(t, st + d), dt = end - st;
    s += v * dt + 0.5 * a * dt * dt;
    if (end < st + d) return { s, v: v + a * dt, started: true };
    v = v1; time = st + d;
  }
  s += v * (t - time);
  return { s, v, started: true };
}
const _t = new V3();
function poseAt(e, o, t){
  const info = MODELS[e.model];
  if (e.parent && info.world){ o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); return; }
  o.position.fromArray(e.pos); o.rotation.set(0, e.rot, 0); o.scale.setScalar(e.scale);
  o.userData.moveS = 0; o.userData.moveV = 0;
  const m = e.motion;
  if (!m || m.type === 'none') return;
  const pr = profileFor(e, t), s = pr.s;
  o.userData.moveS = s; o.userData.moveV = pr.v;
  if (m.type === 'forward'){
    const dir = m.flip ? -1 : 1, D = +m.loopDist || 0;
    let d = s;
    if (D > 0){ if (m.end === 'stop'){ d = Math.min(s, D); if (s >= D) o.userData.moveV = 0; } else d = s % D; }
    o.position.x += Math.sin(e.rot) * d * dir; o.position.z += Math.cos(e.rot) * d * dir;
  } else if (m.type === 'route' && m.pts.length >= 2){
    const { curve, L } = getCurve(e);
    if (L < 0.01) return;
    const d = m.end === 'stop' ? Math.min(s, L) : s % L;
    if (m.end === 'stop' && s >= L) o.userData.moveV = 0;
    const u = Math.min(1, d / L);
    curve.getPointAt(u, o.position);
    const tan = curve.getTangentAt(u);
    o.lookAt(_t.copy(o.position).add(tan));
    if (m.flip) o.rotateY(Math.PI);
    if (/^(bicycle|motorbike|scooter|jet_ski)$/.test(info.file || '') && pr.v > 0.5){
      const u2 = Math.min(1, (d + 1.5) / L), t2 = curve.getTangentAt(u2);
      let dy = Math.atan2(t2.x, t2.z) - Math.atan2(tan.x, tan.z); dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const roll = clamp(Math.atan(pr.v * pr.v * (dy / 1.5) / 9.81), -0.55, 0.55);
      o.rotateZ(-roll * (m.flip ? -1 : 1));
    }
  }
}
const visibleAt = (v, t) => !v || ((t >= (v.from || 0)) && (!(v.to > 0) || t < v.to));
let frameCtx = { t: 0, dt: 0 };
function applyPoses(){
  for (const e of state.entries){
    const o = objects.get(e.uid); if (!o) continue;
    poseAt(e, o, state.t);
    o.visible = !e.hidden && (visibleAt(e.vis, state.t) || (e.uid === state.selected && !state.preview && !state.recording && !state.capturing));
  }
  objectsGroup.updateMatrixWorld(true);
  solidsCache = null; leadCache.clear();
  fxIcons.forEach(sp => sp.visible = false); fxSnd.forEach(sp => sp.visible = false);
  for (const e of state.entries){
    const ro = objects.get(e.uid)?.userData.rider;
    if (ro){ setPose(ro, ro.userData.pose, { t: state.t, s: objects.get(e.uid).userData.moveS, v: objects.get(e.uid).userData.moveV, rider: true, ride: ro.userData.ride }); applyDriverFace(e, ro, state.t); }
    const info = MODELS[e.model]; if (!info?.proc || !info.def.update) continue;
    const o = objects.get(e.uid); if (!o || !o.visible) continue;
    const hostE = e.parent ? getEntry(e.parent) : null;
    info.def.update(o, { ...info.def.defaults, ...(e.p || {}) }, { t: state.t, dt: frameCtx.dt, e, host: hostE ? objects.get(hostE.uid) : null, hostE });
  }
}

/* ---------------- percepção: obstáculos, veículo à frente ---------------- */
let solidsCache = null;
const leadCache = new Map();
function solids(){
  if (solidsCache) return solidsCache;
  solidsCache = [];
  for (const e of state.entries){
    const info = MODELS[e.model];
    if (!info || !info.solid || e.parent) continue;
    const o = objects.get(e.uid); if (!o || !o.visible) continue;
    const b = boxOf(e).clone().applyMatrix4(o.matrixWorld);
    const sz = b.getSize(new V3());
    solidsCache.push({ uid: e.uid, o, box: b, c: b.getCenter(new V3()), r: Math.max(sz.x, sz.z) / 2, moving: !!(e.motion && e.motion.type !== 'none') });
  }
  return solidsCache;
}
const _inv = new THREE.Matrix4(), _lc = new V3();
// distância (m) entre a frente do veículo e o objeto mais próximo na mesma faixa
function leadOf(uid){
  if (leadCache.has(uid)) return leadCache.get(uid);
  const e = getEntry(uid), o = objects.get(uid);
  let best = Infinity;
  if (e && o){
    const hb = boxOf(e);
    _inv.copy(o.matrixWorld).invert();
    for (const s of solids()){
      if (s.uid === uid) continue;
      _lc.copy(s.c).applyMatrix4(_inv);
      if (_lc.z <= 0 || Math.abs(_lc.x) > 1.5 + s.r * 0.5) continue;
      const gap = _lc.z - hb.max.z - s.r * 0.9;
      if (gap < best) best = gap;
    }
  }
  best = Math.max(0, best);
  leadCache.set(uid, best);
  return best;
}
// algo dentro de um setor (origem e direção do objeto o)?
function detectInSector(o, range, halfAng, excludeUid){
  _inv.copy(o.matrixWorld).invert();
  for (const s of solids()){
    if (s.uid === excludeUid) continue;
    _lc.copy(s.c).applyMatrix4(_inv); _lc.y = 0;
    const d = Math.hypot(_lc.x, _lc.z) - s.r * 0.7;
    if (d > range || _lc.z < -s.r) continue;
    const a = Math.abs(Math.atan2(_lc.x, _lc.z));
    if (a <= halfAng + Math.atan2(s.r, Math.max(0.5, d))) return s;
  }
  return null;
}
/* ícone de alerta que aparece quando um efeito ADAS detecta algo */
const iconGroup = new THREE.Group(); scene.add(iconGroup);
const fxIcons = new Map();
function fxAlertIcon(c, p, hit){
  if (!p.icon || !hit) return;
  const key = p.iconColor + '|' + p.iconSize;
  let s = fxIcons.get(c.e.uid);
  if (!s || s.userData.key !== key){
    if (s) iconGroup.remove(s);
    s = makeSprite(iconCanvas({ shape: 'tri', text: '!', bg: p.iconColor, tc: '#111111' }), p.iconSize);
    s.userData.key = key; fxIcons.set(c.e.uid, s); iconGroup.add(s);
  }
  let box;
  if (p.iconAt === 'host' && c.hostE) box = boxOf(c.hostE).clone().applyMatrix4(c.host.matrixWorld);
  else box = hit.box;
  const ctr = box.getCenter(new V3());
  s.position.set(ctr.x, box.max.y + 0.5 + Math.sin(c.t * 3) * 0.12, ctr.z);
  s.material.opacity = Math.sin(c.t * Math.PI * 2.4) > -0.3 ? 1 : 0.35;
  s.visible = true;
  if (p.iconSnd){                                   // ícone de som ao lado: aviso sonoro
    let sp = fxSnd.get(c.e.uid);
    if (!sp || sp.userData.key !== key){ if (sp) iconGroup.remove(sp); sp = makeSprite(speakerCanvas('#0369a1'), p.iconSize * 0.8); sp.userData.key = key; fxSnd.set(c.e.uid, sp); iconGroup.add(sp); }
    const right = new V3(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(p.iconSize * 0.85);
    sp.position.copy(s.position).add(right); sp.material.opacity = s.material.opacity; sp.visible = true;
  }
}
const fxSnd = new Map();

/* ---------------- superfície / raycast ---------------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), downRay = new THREE.Raycaster();
ray.params.Line.threshold = 0.15;
const groundPlane = new THREE.Plane(new V3(0,1,0), 0);
function setRay(ev){
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function pickSurface(exclude){
  const targets = roadObjs.filter(o => o !== exclude);
  const hit = ray.intersectObjects(targets, true)[0];
  if (hit) return hit.point.clone();
  const p = new V3();
  return ray.ray.intersectPlane(groundPlane, p) ? p : null;
}
function surfaceY(x, z, exclude){
  downRay.set(new V3(x, 300, z), new V3(0, -1, 0));
  const hit = downRay.intersectObjects(roadObjs.filter(o => o !== exclude), true)[0];
  return hit ? hit.point.y : 0;
}
function pickEntity(filter){
  const hits = ray.intersectObjects(objectsGroup.children, true);
  let best = null, bp = -1;
  for (const h of hits){
    const mt = h.object.material;
    if (mt && !Array.isArray(mt) && mt.transparent && mt.opacity < 0.06) continue;
    if (!h.object.visible) continue;
    let o = h.object; while (o && o.userData.uid === undefined) o = o.parent;
    if (!o) continue;
    const e = getEntry(o.userData.uid);
    if (!e || (filter && !filter(e))) continue;
    const info = MODELS[e.model];
    const pr = info.isRoad ? 0 : info.fx ? 2 : info.solid || info.movable ? 3 : 1;
    if (pr > bp){ bp = pr; best = e; if (pr === 3) break; }
  }
  return best;
}
let altDown = false;
function snapXZ(info, rot, x, z, k = 1){
  if (!state.snap || altDown) return [x, z];
  if (info.isRoad){
    let w = info.size.x, d = info.size.z;
    if (Math.abs(Math.round(rot / (Math.PI/2))) % 2 === 1) [w, d] = [d, w];
    const T = TILE * k;
    const ox = Math.max(1, Math.round(w / TILE)) % 2 === 0 ? T/2 : 0;
    const oz = Math.max(1, Math.round(d / TILE)) % 2 === 0 ? T/2 : 0;
    return [Math.round((x - ox) / T) * T + ox, Math.round((z - oz) / T) * T + oz];
  }
  return [Math.round(x * 4) / 4, Math.round(z * 4) / 4];
}

/* ---------------- histórico / salvar ---------------- */
const history = [];
function snapshot(){ return JSON.stringify({ entries: state.entries, hud: state.hud, steps: state.steps, shots: state.shots }); }
function pushHistory(){ history.push(snapshot()); if (history.length > 80) history.shift(); }
function undo(){
  if (state.mode === 'route') { cancelRoute(); return; }
  const s = history.pop(); if (!s) { toast('Nada para desfazer'); return; }
  const d = JSON.parse(s); Object.assign(state, { entries: d.entries, hud: d.hud, steps: d.steps, shots: d.shots });
  rebuild(); renderProps(); hudDirty = true; renderMarks();
}
function serialize(withCustom){
  const o = { app:'cena3d', v:2, entries: state.entries, hud: state.hud, steps: state.steps, shots: state.shots, settings: state.settings, ecu: ECU, nextUid };
  if (withCustom) o.custom = customDefs;
  return o;
}
const SAVE_KEY = 'cena3d-adas-scene';
let saveTimer;
function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(false))); } catch {}
    try { localStorage.setItem('cena3d-custom', JSON.stringify(customDefs)); } catch {}
  }, 500);
}
async function loadScene(d){
  if (d.custom) for (const c of d.custom) await addCustom(c, true);
  state.entries = d.entries || []; state.hud = d.hud || []; state.steps = d.steps || []; state.shots = d.shots || [];
  Object.assign(state.settings, d.settings || {});
  if (d.ecu) Object.assign(ECU, d.ecu);
  nextUid = Math.max(d.nextUid || 1, ...state.entries.map(e => e.uid + 1), ...state.hud.map(h => h.id + 1), 1);
  state.selected = null; state.hudSel = null; state.t = 0; state.playing = false;
  applyEnv(); rebuild(); renderProps(); updateTimeUI(); syncPlayBtn(); layoutStage(); hudDirty = true; renderMarks();
}
function download(blob, name){
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function addCustom(c, silent){
  if (MODELS[c.id]) return MODELS[c.id];
  try {
    const obj = await parseGLB(b64ToBuf(c.data));
    const info = registerModel({ id:c.id, file:c.name, name:c.name, pack:'custom' }, obj);
    if (!customDefs.find(x => x.id === c.id)) customDefs.push(c);
    makeThumb(info);
    return info;
  } catch (err) { if (!silent) toast('Não consegui abrir ' + c.name); console.error(err); }
}

/* ---------------- ambiente ---------------- */
const ENVS = {
  dia:     { name:'☀️ Dia', top:'#5ea4ef', bottom:'#cfe6fa', hs:'#d7ebff', hg:'#5b6e45', hi:1.1, sc:'#fff4e2', si:2.6, sp:[60,110,35], glow:0, fogN:180, fogF:1300 },
  tarde:   { name:'🌇 Pôr do sol', top:'#3c5f9e', bottom:'#ffb27a', hs:'#ffd3a8', hg:'#4a3a2c', hi:0.7, sc:'#ffa860', si:2.3, sp:[140,32,-50], glow:0.8, fogN:140, fogF:1100 },
  noite:   { name:'🌙 Noite', top:'#040915', bottom:'#14244a', hs:'#3a4d85', hg:'#0d0f17', hi:0.32, sc:'#9fb6ff', si:0.35, sp:[-60,90,30], glow:3.5, fogN:60, fogF:700 },
  nublado: { name:'☁️ Nublado', top:'#8d99a6', bottom:'#c9d0d7', hs:'#e3e8ee', hg:'#5e6660', hi:1.6, sc:'#ffffff', si:0.7, sp:[30,120,20], glow:0, fogN:90, fogF:700 },
  apex:    { name:'🏔 APEX (cluster, noite com montanhas)', top:'#020305', bottom:'#0a1220', hs:'#7f93b8', hg:'#0b0e14', hi:0.75, sc:'#cfe0ff', si:0.9, sp:[-40,90,60], glow:2.5, fogN:120, fogF:1400, mtn:true }
};
function applyEnv(){
  const E = ENVS[state.settings.env] || ENVS.dia;
  skyU.top.value.set(E.top); skyU.bottom.value.set(E.bottom);
  scene.fog.color.set(E.bottom); scene.fog.near = E.fogN; scene.fog.far = E.fogF;
  hemi.color.set(E.hs); hemi.groundColor.set(E.hg); hemi.intensity = E.hi;
  sun.color.set(E.sc); sun.intensity = E.si; sun.position.set(...E.sp);
  sun.shadow.radius = state.settings.env === 'nublado' ? 8 : 2;
  glowMats.forEach(m => { m.emissive.copy(m.color); m.emissiveIntensity = E.glow; });
  groundMat.color.set(state.settings.ground);
  renderer.toneMappingExposure = state.settings.exposure;
  if (mountains) mountains.visible = !!E.mtn;
  updateNightLights();
}
function makeMountains(){
  if (!DATA.mtn) return;
  const tex = new THREE.TextureLoader().load(DATA.mtn);
  tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(4, 1);
  const R = 1500, H = 2 * Math.PI * R / 4 * 768 / 1376;
  mountains = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 64, 1, true),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, transparent: true, depthWrite: false, opacity: .9 }));
  mountains.position.y = H / 2 - 260; mountains.renderOrder = -1; mountains.visible = false;
  scene.add(mountains);
}
const nightLights = []; let nightSig = '';
function updateNightLights(){
  const night = ENVS[state.settings.env]?.glow >= 2.5;
  const lamps = [], cars = [];
  if (night) for (const e of state.entries){
    const info = MODELS[e.model];
    if (!objects.get(e.uid)) continue;
    if (info.isLamp && lamps.length < 10) lamps.push(e);
    else if (info.isVehicle && e.motion && e.motion.type !== 'none' && cars.length < 6) cars.push(e);
  }
  const sig = lamps.map(e => e.uid).join(',') + '|' + cars.map(e => e.uid).join(',');
  if (sig === nightSig) return;
  nightSig = sig;
  nightLights.forEach(l => l.parent && l.parent.remove(l)); nightLights.length = 0;
  for (const e of lamps){
    const o = objects.get(e.uid), b = boxOf(e);
    const p = new THREE.PointLight(0xffc98a, 60, 24, 1.6);
    p.position.set((b.min.x + b.max.x)/2, b.max.y - 0.4, (b.min.z + b.max.z)/2);
    o.add(p); nightLights.push(p);
  }
  for (const e of cars){
    const o = objects.get(e.uid), b = boxOf(e);
    const s = new THREE.SpotLight(0xfff2d0, 250, 55, 0.5, 0.6, 1.4);
    s.position.set(0, b.min.y + (b.max.y - b.min.y) * 0.35, b.max.z);
    s.target.position.set(0, 0, b.max.z + 14);
    o.add(s, s.target); nightLights.push(s, s.target);
  }
}

/* ---------------- quadro (mesmo formato do vídeo) ---------------- */
let HW = 1280, HH = 720;
function outRes(){
  const r = state.settings.res;
  if (r === 'tela'){ const b = view.getBoundingClientRect(); return [Math.max(2, Math.round(b.width)), Math.max(2, Math.round(b.height))]; }
  return r.split('x').map(Number);
}
function layoutStage(){
  const b = view.getBoundingClientRect();
  if (b.width < 2 || b.height < 2) return;
  const [ow, oh] = outRes(), ar = ow / oh;
  let w = b.width, h = w / ar;
  if (h > b.height){ h = b.height; w = h * ar; }
  Object.assign(stage.style, { left: (b.width - w) / 2 + 'px', top: (b.height - h) / 2 + 'px', width: w + 'px', height: h + 'px' });
  const nh = Math.round(HW / ar);
  if (nh !== HH){ HH = nh; hudDirty = true; }
  hudEl.setAttribute('viewBox', `0 0 ${HW} ${HH}`);
  if (state.preview || state.recording){ renderer.setPixelRatio(1); renderer.setSize(ow, oh, false); }
  else { renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(w, h, false); }
  camera.aspect = ar; camera.updateProjectionMatrix();
}
new ResizeObserver(layoutStage).observe(view);

/* ---------------- rotas (visual) ---------------- */
const arrowGeo = new THREE.ConeGeometry(0.35, 1.0, 8); arrowGeo.rotateX(Math.PI/2);
const markerGeo = new THREE.SphereGeometry(0.5, 16, 12);
const ROUTE_COLORS = [0xffb547, 0x4fd1ff, 0xff6bd6, 0x7dff7a, 0xff7a59, 0xb08cff];
function clearGroup(g, keepMarkers){
  for (const c of g.children.slice()){
    if (keepMarkers && c.userData.marker) continue;
    g.remove(c);
    if (c.geometry && c.geometry !== arrowGeo && c.geometry !== markerGeo) c.geometry.dispose();
    if (c.material) c.material.dispose();
  }
}
function drawRoute(pts, color, closed, strong){
  const curve = makeCurve(pts, closed), L = curve.getLength();
  const samples = curve.getSpacedPoints(Math.max(20, Math.round(L * 2))).map(p => p.add(new V3(0, 0.3, 0)));
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(samples),
    new THREE.LineBasicMaterial({ color, transparent:true, opacity: strong ? 1 : 0.55, depthTest:false }));
  line.renderOrder = 5; routeGroup.add(line);
  const mat = new THREE.MeshBasicMaterial({ color, transparent:true, opacity: strong ? 0.95 : 0.5, depthTest:false });
  const n = Math.min(80, Math.floor(L / 6));
  for (let i = 1; i <= n; i++){
    const u = i / (n + 1), p = curve.getPointAt(u).add(new V3(0, 0.3, 0)), t = curve.getTangentAt(u);
    const a = new THREE.Mesh(arrowGeo, mat); a.position.copy(p); a.lookAt(p.clone().add(t)); a.renderOrder = 6; routeGroup.add(a);
  }
}
function refreshRoutes(skipMarkers){
  clearGroup(routeGroup, skipMarkers);
  state.entries.forEach(e => {
    const m = e.motion; if (!m) return;
    const drafting = state.draft && state.draft.uid === e.uid;
    let pts = drafting ? state.draft.pts.slice() : m.pts;
    if (drafting && state.hover) pts = [...pts, [state.hover.x, state.hover.y, state.hover.z]];
    if (!drafting && m.type !== 'route') return;
    const sel = e.uid === state.selected;
    const color = ROUTE_COLORS[e.uid % ROUTE_COLORS.length];
    if (pts.length >= 2) drawRoute(pts, color, m.end === 'loop' && !drafting, sel || drafting);
    if ((sel || drafting) && !skipMarkers){
      const list = drafting ? state.draft.pts : m.pts;
      list.forEach((p, idx) => {
        const mk = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: idx === 0 ? 0x3ecf8e : 0xffffff, depthTest:false }));
        mk.position.set(p[0], p[1] + 0.3, p[2]); mk.renderOrder = 7;
        mk.userData = { marker:true, uid:e.uid, idx };
        routeGroup.add(mk);
      });
    }
  });
  if (state.markerIdx != null && !skipMarkers){
    const mk = routeGroup.children.find(c => c.userData.marker && c.userData.idx === state.markerIdx);
    if (mk) tc.attach(mk); else state.markerIdx = null;
  }
}
