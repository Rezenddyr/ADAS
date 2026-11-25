
/* =====================================================================
   Simulador ECU, notificações ADAS (lógica do APEX) e painel 2D (HUD)
   ===================================================================== */
const ECU = { auto:1, speed:87, power:120, soc:78, temp:34, lead:35, limit:80, ambient:24, hd:45, gear:'D', mode:'COMFORT', blL:0, blR:0,
  adas:1, leadOn:1, door:0, snd:1, hands:0, lanedep:0, lkaoff:0, camblk:0, parkblk:0, steerf:0, drowsy:0 };
const ECU_DEFAULT = JSON.parse(JSON.stringify(ECU));
const blinkOn = () => Math.floor(performance.now() / 400) % 2 === 0;
const ECUMAP = { turn_l: () => +ECU.blL && blinkOn(), turn_r: () => +ECU.blR && blinkOn(), park_brake: () => ECU.gear === 'P', neutral: () => ECU.gear === 'N', battery_temp: () => ECU.temp > 60, tpms: () => 0, door_open: () => +ECU.door };
const egoEntry = () => state.entries.find(e => e.ego && objects.get(e.uid));
let ecuSig = '';
function ecuFromScene(){
  const e = egoEntry();
  if (+ECU.auto && e){
    const o = objects.get(e.uid);
    ECU.speed = Math.round((o.userData.moveV || 0) * 3.6);
    const gap = leadOf(e.uid);
    ECU.leadOn = isFinite(gap) && gap < 150 ? 1 : 0;
    if (ECU.leadOn) ECU.lead = Math.round(gap);
    // DDD: motorista do carro principal dormindo ao volante
    if (o.userData.rider && +(e.p?.sleepOn)){ const st = driverState(e, state.t); ECU.drowsy = st.sleeping && st.closedFor > 1.2 ? 1 : 0; }
  }
  const sig = JSON.stringify(ECU);
  if (sig !== ecuSig){ ecuSig = sig; ntEval(); ecuLabels(); hudDirty = true; }
}

/* notificações: mesma lógica do ApexECU_Cluster */
const ALC = { critical:'#ef4444', warning:'#f59e0b', info:'#1d9bf0', neutral:'#a3b1c2' };
const ALK = { forward_collision:['Colisão frontal','COLISÃO FRONTAL','Freie imediatamente','critical','fcw','tri',0,'',10],
  speed_120:['Velocidade perigosa (120)','VELOCIDADE PERIGOSA','Acima de 120 km/h','critical','spd','chev',120,'Alto risco de perda de controle',14],
  drowsy:['Sonolência do motorista (DDD / IDM)','SONOLÊNCIA DETECTADA','Faça uma pausa','critical','eye','tri',0,'Motorista de olhos fechados',12],
  hands_on_wheel:['Mãos no volante','MÃOS NO VOLANTE','Atenção do condutor','warning','wheel','hands',0,'',18],
  steering_assist:['Falha na direção assistida','FALHA NA DIREÇÃO','Procure assistência técnica','warning','wheelx','',0,'',32],
  speed_80:['Limite de velocidade excedido','LIMITE EXCEDIDO','Acima de 80 km/h','warning','spd','chev',80,'Reduza a velocidade',40],
  lka_unavailable:['Assistente de faixa indisponível','ASSISTENTE DE FAIXA','Indisponível','warning','lane','off',0,'',46],
  park_assist_blocked:['Park Assist bloqueado','PARK ASSIST','Sensor bloqueado','warning','park','',0,'',48],
  lane_departure:['Saída de faixa','SAÍDA DE FAIXA','Mantenha-se na faixa','warning','lane','',0,'',50],
  adas_limited:['ADAS limitado','ADAS LIMITADO','Câmera obstruída','warning','camoff','',0,'',50] };
const IC = { eye: c => `<path d="M2.5 11c3 4 6 5.5 9.5 5.5s6.5-1.5 9.5-5.5"/><path d="M5 14.6l-1.7 2.2M9 16.3l-.8 2.5M15 16.3l.8 2.5M19 14.6l1.7 2.2"/>`,
  speaker: c => `<path d="M3.5 9.5h3.5l4.5-4v13l-4.5-4h-3.5z" fill="${c}" fill-opacity=".25"/><path d="M15 9a4 4 0 0 1 0 6M17.8 6.3a8 8 0 0 1 0 11.4"/>`,
  tri: c => `<path d="M12 3.2L21.6 20H2.4Z"/><path d="M12 9.5v5"/><circle cx="12" cy="17.3" r=".9" fill="${c}" stroke="none"/>`,
  fcw: c => `<path d="M4 20.5V15l2.4-5.5h11.2L20 15v5.5"/><path d="M4 15h16M7 17.6h2M15 17.6h2M5.6 20.5v1.8M18.4 20.5v1.8"/><path d="M12 1.4L15.4 7.2H8.6Z" fill="${c}" fill-opacity=".25"/><path d="M12 3.5v1.6"/>`,
  wheel: c => `<circle cx="12" cy="12" r="9.2"/><circle cx="12" cy="12" r="2.6"/><path d="M2.8 12h6.6M14.6 12h6.6M12 14.6v6.6"/>`,
  wheelx: c => `<g transform="translate(-1.6 1.4) scale(.88)">${IC.wheel(c)}</g><path d="M21.4 4.5v9"/><circle cx="21.4" cy="17.4" r="1" fill="${c}" stroke="none"/>`,
  lane: c => `<path d="M5 21.5L9.5 2.5M19 21.5L14.5 2.5"/><path d="M12 4v2.4M12 9.6v2.8M12 15.6v3.6"/>`,
  park: c => `<rect x="8.3" y="4" width="7.4" height="16" rx="2.8"/><path d="M9.6 8.6h4.8M9.6 15.4h4.8"/><path d="M5.4 9a5 5 0 0 0 0 6M2.6 7a8.5 8.5 0 0 0 0 10M18.6 9a5 5 0 0 1 0 6M21.4 7a8.5 8.5 0 0 1 0 10"/>`,
  camoff: c => `<rect x="2.5" y="7.2" width="19" height="12.6" rx="2.2"/><circle cx="12" cy="13.4" r="3.4"/><path d="M8.2 7.2l1.6-2.6h4.4l1.6 2.6"/><path d="M3 3l18 18"/>` };
const ICO = (n, c, x, y, s, gl = 1) => { const f = IC[n]; return f ? `<g ${gl ? 'filter="url(#glow)"' : ''}><g transform="translate(${x} ${y}) scale(${s / 24})" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${f(c)}</g></g>` : ''; };
const adasOn = () => !!(+ECU.adas && !+ECU.door && ECU.gear === 'D');
const ALCOND = { drowsy: () => !!+ECU.drowsy, forward_collision: () => adasOn() && !!+ECU.leadOn && ECU.lead <= 13, speed_120: () => ECU.speed > 120, speed_80: () => ECU.speed > ECU.limit && ECU.speed <= 120,
  hands_on_wheel: () => adasOn() && !!+ECU.hands, lane_departure: () => adasOn() && !!+ECU.lanedep, lka_unavailable: () => !!+ECU.lkaoff, adas_limited: () => !!+ECU.camblk,
  park_assist_blocked: () => !!+ECU.parkblk, steering_assist: () => !!+ECU.steerf };
const ALWHY = { drowsy:'motorista de olhos fechados (DDD)', forward_collision:'ADAS ativo e veículo à frente a até 13 m', speed_120:'velocidade acima de 120 km/h', speed_80:'velocidade acima do limite da via', hands_on_wheel:'ADAS ativo e mãos fora do volante',
  lane_departure:'ADAS ativo e carro saindo da faixa', lka_unavailable:'assistente de faixa indisponível', adas_limited:'câmera obstruída', park_assist_blocked:'sensor de estacionamento bloqueado', steering_assist:'falha na direção assistida' };
const NT = { list: [], cur: '', t0: 0, hold: false, since: {}, tm: {} };
const ntPers = k => k === 'forward_collision' || k === 'speed_120' || k === 'drowsy';
let AC = null, recDest = null;
function audioCtx(){ try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch {} return AC; }
function beep(sev){
  if (!+ECU.snd || !(state.playing || state.recording)) return;
  const ac = audioCtx(); if (!ac) return;
  const t = ac.currentTime, sq = sev === 'critical' ? [[880, 0], [880, .17]] : [[660, 0]];
  for (const [f, d] of sq){
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = f; g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(.16, t + d + .01); g.gain.exponentialRampToValueAtTime(.001, t + d + .14);
    o.connect(g); g.connect(ac.destination); if (recDest) g.connect(recDest);
    o.start(t + d); o.stop(t + d + .15);
  }
}
function ntArb(){
  const top = NT.list.slice().sort((a, b) => a.p - b.p || b.ts - a.ts)[0], k = top ? top.k : '';
  if (k !== NT.cur){ NT.cur = k; NT.t0 = performance.now(); NT.hold = !!top && (top.pers || top.p <= 15); if (k) beep(ALK[k][3]); hudDirty = true; }
  ntStat();
}
function ntSet(k, on){
  const i = NT.list.findIndex(w => w.k === k); if (on === (i >= 0)) return;
  if (on) NT.list.push({ k, p: ALK[k][8], pers: ntPers(k), ts: Date.now() }); else NT.list.splice(i, 1);
  ntArb();
}
const ntTimer = (n, run, ms, fn) => { const t = NT.tm['_' + n]; if (run && !t) NT.tm['_' + n] = setInterval(fn, ms); else if (!run && t){ clearInterval(t); delete NT.tm['_' + n]; } };
function ntEval(){
  for (const k in ALCOND){ const on = !!ALCOND[k](); if (on && !NT.since[k]) NT.since[k] = performance.now(); else if (!on && NT.since[k]) delete NT.since[k]; ntSet(k, on); }
  ntTimer('fcw', !!NT.since.forward_collision, 700, () => beep('critical'));
  ntTimer('hs', !!NT.since.speed_120, 2000, () => beep('critical'));
  ntStat();
}
function ntStat(){
  const el = $('#ntst'); if (!el) return;
  const why = +ECU.door ? 'porta aberta' : ECU.gear !== 'D' ? 'câmbio fora de D' : 'assistência desligada', on = NT.cur && (NT.hold || performance.now() - NT.t0 < 3600);
  el.textContent = (adasOn() ? '● ADAS ativo' + (+ECU.leadOn ? ` · veículo à frente a ${ECU.lead} m` : '') : '○ ADAS inativo: ' + why) + (on ? ' · exibindo: ' + ALK[NT.cur][0] : '');
}

/* ---------------- HUD ---------------- */
let hudDirty = true;
const HUD_DEFS = '<defs><filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter><filter id="gray"><feColorMatrix type="saturate" values="0"/></filter></defs>';
const bk = x => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
const TXT = (x, y, t, fs, col, a = 'start', wt = 700, extra = '') => `<text x="${(+x).toFixed(1)}" y="${(+y).toFixed(1)}" font-size="${(+fs).toFixed(1)}" font-weight="${wt}" fill="${col}" text-anchor="${a}" dominant-baseline="central" ${extra}>${esc(t)}</text>`;
const multi = (x, y, text, fs, col, a = 'middle', wt = 700) => { const ls = String(text ?? '').split('\n'), lh = fs * 1.2; return ls.map((l, i) => TXT(x, y - (ls.length - 1) * lh / 2 + i * lh, l, fs, col, a, wt)).join(''); };
function wrapText(t, max){ const out = []; for (const para of String(t ?? '').split('\n')){ let line = ''; for (const w of para.split(' ')){ if ((line + ' ' + w).trim().length > max && line){ out.push(line); line = w; } else line = (line + ' ' + w).trim(); } out.push(line); } return out; }
const isHex = c => /^#[0-9a-f]{6}$/i.test(c);
const hudById = id => state.hud.find(h => h.id === id);
const curStepIdx = t => { let i = -1; state.steps.forEach((s, k) => { if (s.t <= t + 1e-6) i = k; }); return i; };

function alertP(e, all){
  const au = e.kind === 'auto', k = au ? (NT.cur && (NT.hold || performance.now() - NT.t0 < 3600) ? NT.cur : '') : e.kind, p = ALK[k];
  if (!p) return null;
  if (!au && !all && e.show !== 'always' && ALCOND[k] && !ALCOND[k]()) return null;
  const o = { k, title: p[1], msg: p[2], sev: p[3], ic: p[4], rd: p[5] || '', num: p[6] || 0, sub: p[7] || '' };
  if (k === 'speed_80'){ o.num = ECU.limit; o.msg = `Acima de ${ECU.limit} km/h`; }
  if (au) return o;
  for (const q of ['title', 'msg', 'sub', 'sev', 'num']) if (e[q] != null && e[q] !== '') o[q] = e[q];
  return o;
}
const ALR = { tri: (c, x, y, h) => ICO('tri', c, x - h * .25, y - h * .25, h * .5),
  chev: (c, x, y, h) => [0, 1, 2].map(i => `<path d="M${(x - h * .42 + i * h * .2).toFixed(1)} ${(y - h * .3).toFixed(1)}l${(h * .2).toFixed(1)} ${(h * .3).toFixed(1)}l${(-h * .2).toFixed(1)} ${(h * .3).toFixed(1)}" fill="none" stroke="${c}" stroke-width="${(h * .07).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${.3 + .35 * i}" ${i === 2 ? 'filter="url(#glow)"' : ''}/>`).join(''),
  off: (c, x, y, h) => `<circle cx="${x}" cy="${y}" r="${h * .18}" fill="none" stroke="#94a3b8" stroke-width="1.6"/><path d="M${x - h * .12} ${y + h * .12}L${x + h * .12} ${y - h * .12}" stroke="#94a3b8" stroke-width="1.6"/>`,
  hands: (c, x, y, h) => ICO('wheel', '#94a3b8', x - h * .24, y - h * .24, h * .48, 0) };
const ALT = (x, y, t, fs, col, wt, ls = 0) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${fs.toFixed(1)}" font-weight="${wt}" letter-spacing="${ls.toFixed(2)}" fill="${col}" stroke="none" dominant-baseline="central">${esc(t)}</text>`;
function drawAlert(e){
  const P = alertP(e), w = e.w, h = e.h, R = `x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="${h * .2}"`;
  if (!P) return null;
  const c = ALC[P.sev] || ALC.warning, id = 'al' + e.id, gl = P.sev === 'critical' ? .6 + .4 * Math.abs(Math.sin(performance.now() / 1000 * Math.PI / 1.1)) : 1, sp = P.ic === 'spd';
  let o = `<defs><linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c}" stop-opacity=".3"/><stop offset=".3" stop-color="#07090d" stop-opacity=".96"/><stop offset=".72" stop-color="#07090d" stop-opacity=".96"/><stop offset="1" stop-color="${c}" stop-opacity=".2"/></linearGradient><radialGradient id="${id}r" cx=".5" cy="1" r=".6"><stop offset="0" stop-color="${c}" stop-opacity=".4"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient><linearGradient id="${id}l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c}" stop-opacity="0"/><stop offset=".5" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>`;
  o += `<rect ${R} fill="none" stroke="${c}" stroke-width="${(h * .06).toFixed(1)}" stroke-opacity="${(.45 * gl).toFixed(2)}" filter="url(#glow)"/><rect ${R} fill="url(#${id}b)"/><rect ${R} fill="url(#${id}r)"/><rect ${R} fill="none" stroke="${c}" stroke-width="1.6" stroke-opacity="${(.55 + .45 * gl).toFixed(2)}"/><path d="M${h * .3} 2.4H${w - h * .3}" stroke="#ffffff" stroke-opacity=".08" stroke-width="1"/><path d="M${w * .28} ${h - 2}H${w * .72}" stroke="url(#${id}l)" stroke-width="2.4"/>`;
  const iy = h * .5; let dv, tx;
  if (sp){ const sx = h * .62, sy = h * .52, r = h * .27; o += `<circle cx="${sx}" cy="${sy}" r="${h * .36}" fill="none" stroke="${c}" stroke-width="${(h * .05).toFixed(1)}" stroke-dasharray="1.2 ${(h * .035).toFixed(1)}" stroke-opacity=".75"/><circle cx="${sx}" cy="${sy}" r="${r}" fill="#ffffff" stroke="${c}" stroke-width="${(h * .045).toFixed(1)}" filter="url(#glow)"/><text x="${sx}" y="${sy}" text-anchor="middle" dominant-baseline="central" font-size="${(r * (String(P.num).length > 2 ? .78 : .95)).toFixed(1)}" font-weight="800" fill="#111">${esc(P.num)}</text>` + ICO('tri', c, h * 1.58 - h * .25, iy - h * .25, h * .5); dv = h * 1.18; tx = h * 1.95; }
  else { o += ICO(P.ic, c, h * .85 - h * .27, iy - h * .27, h * .54); dv = h * 1.45; tx = h * 1.66; }
  o += `<path d="M${dv} ${h * .24}V${h * .8}" stroke="${c}" stroke-opacity=".6" stroke-width="1.2"/>`;
  const rx = P.rd ? w - h * 1.02 : w - h * .3, av = Math.max(30, rx - tx), fit = (s, f, q) => Math.min(f, av / Math.max(1, String(s).length * q)), fT = fit(P.title, h * .19, .72), fM = fit(P.msg, h * .15, .55), sb = P.sub && String(P.sub).trim();
  if (sb){ o += ALT(tx, h * .36, P.title, fT, sp ? c : '#f8fafc', 700, fT * .05) + ALT(tx, h * .58, P.msg, fM, '#e2e8f0', 500) + `<path d="M${tx} ${h * .71}H${tx + av * .92}" stroke="${c}" stroke-opacity=".55" stroke-width="1"/>` + ALT(tx, h * .83, P.sub, Math.min(h * .1, fit(P.sub, h * .1, .55)), '#94a3b8', 500); }
  else o += ALT(tx, h * .4, P.title, fT, sp ? c : '#f8fafc', 700, fT * .05) + ALT(tx, h * .67, P.msg, fM, '#cbd5e1', 500);
  if (P.rd && ALR[P.rd]) o += ALR[P.rd](c, w - h * .68, h * .52, h);
  // selos: aviso visual e/ou sonoro
  let bx = w - 8; const bs = h * 0.26;
  const badge = (ic, col) => { bx -= bs + 4; o += `<g transform="translate(${bx.toFixed(1)} ${(-bs * 0.55).toFixed(1)})"><rect width="${bs}" height="${bs}" rx="${bs * 0.25}" fill="#0b1018" stroke="${col}" stroke-width="1.4"/>${ICO(ic, col, bs * 0.1, bs * 0.1, bs * 0.8, 0)}</g>`; };
  if (e.bSnd ?? 1) badge('speaker', '#38bdf8');
  if (e.bVis ?? 1) badge('tri', c);
  return o;
}
const rootAttr = r => Object.entries(r || {}).map(([k, v]) => `${k}="${v}"`).join(' ');
const CMP = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], hdName = h => CMP[Math.round(((h % 360) + 360) % 360 / 45) % 8];
const gval = e => ({ power: ECU.power, temp: ECU.temp, soc: ECU.soc, speed: ECU.speed }[e.src] ?? +e.val);
const ANIMS = [['none', 'Nenhuma'], ['pop', 'Entrada (pulo)'], ['fade', 'Entrada suave'], ['blink', 'Piscar']];
const HUDT = {
  title: { name: 'Título e subtítulo', w: 520, h: 70, d: { text: 'ACC/CC', sub: 'Controle de cruzeiro adaptativo', color: '#e8f1ff', sc: '#8fa0b3', fs: 34 },
    f: [['text', 'Título', 'text'], ['sub', 'Subtítulo', 'text'], F.color('color', 'Cor do título'), F.color('sc', 'Cor do subtítulo'), F.num('fs', 'Tamanho', 10, 120)],
    r: e => TXT(0, e.fs * .6, e.text, e.fs, e.color) + TXT(0, e.fs * 1.55, e.sub, e.fs * .48, e.sc, 'start', 500) },
  speedbig: { name: 'Velocidade grande', w: 200, h: 140, d: { src: 'ecu', val: 100, color: '#ffffff', unit: 'km/h' },
    f: [['src', 'Valor', 'sel', [['ecu', 'Velocidade do Simulador ECU'], ['manual', 'Manual']]], F.num('val', 'Valor manual', 0, 999), F.color('color', 'Cor'), ['unit', 'Unidade', 'text']],
    r: e => TXT(e.w / 2, e.h * .42, e.src === 'ecu' ? Math.round(ECU.speed) : e.val, e.h * .62, e.color, 'middle') + TXT(e.w / 2, e.h * .88, e.unit, e.h * .15, '#8fa0b3', 'middle', 600) },
  text: { name: 'Texto', w: 260, h: 40, d: { text: 'Texto', fs: 28, color: '#ffffff', wt: 1, align: 'start' },
    f: [['text', 'Texto', 'area'], F.num('fs', 'Tamanho', 8, 160), F.color('color', 'Cor'), ['wt', 'Negrito', 'chk'], ['align', 'Alinhamento', 'sel', [['start', 'Esquerda'], ['middle', 'Centro'], ['end', 'Direita']]]],
    size: e => { const ls = String(e.text).split('\n'); e.w = Math.max(20, Math.max(...ls.map(l => l.length)) * e.fs * .56); e.h = ls.length * e.fs * 1.2; },
    r: e => multi(e.align === 'middle' ? e.w / 2 : e.align === 'end' ? e.w : 0, e.h / 2, e.text, e.fs, e.color, e.align, e.wt ? 700 : 400) },
  screen: { name: 'Tela / pílula', w: 300, h: 56, d: { text: 'ACC ativo 100 km/h', fs: 20, fill: '#12202e', stroke: '#2ee6c8', tc: '#e8f1ff', rx: 12, sw: 3 },
    f: [['text', 'Texto', 'area'], F.num('fs', 'Tamanho do texto', 8, 100), F.color('fill', 'Fundo'), F.color('stroke', 'Contorno'), F.color('tc', 'Cor do texto'), F.num('rx', 'Canto', 0, 100), F.num('sw', 'Espessura', 0, 20)],
    r: e => `<rect x="${e.sw / 2}" y="${e.sw / 2}" width="${e.w - e.sw}" height="${e.h - e.sw}" rx="${e.rx}" fill="${e.fill}" stroke="${e.stroke}" stroke-width="${e.sw}"/>` + multi(e.w / 2, e.h / 2, e.text, e.fs, e.tc) },
  rect: { name: 'Retângulo / moldura', w: 400, h: 240, d: { fill: '#000000', fo: 0, stroke: '#00e5ff', sw: 4, rx: 24, glow: 1 },
    f: [F.color('fill', 'Preenchimento'), F.op('fo', 'Opacidade do preenchimento'), F.color('stroke', 'Contorno'), F.num('sw', 'Espessura', 0, 30), F.num('rx', 'Canto', 0, 200), ['glow', 'Brilho', 'chk']],
    r: e => `<rect x="${e.sw / 2}" y="${e.sw / 2}" width="${Math.max(1, e.w - e.sw)}" height="${Math.max(1, e.h - e.sw)}" rx="${e.rx}" fill="${e.fill}" fill-opacity="${e.fo}" stroke="${e.stroke}" stroke-width="${e.sw}" ${e.glow ? 'filter="url(#glow)"' : ''}/>` },
  alert: { name: 'Notificação ADAS', w: 360, h: 80, d: { kind: 'auto', show: 'cond', anim: 'pop', bVis: 1, bSnd: 1 },
    f: [['kind', 'Alerta', 'sel', [['auto', 'Automático (lógica do APEX)'], ...Object.entries(ALK).map(([k, v]) => [k, v[0]])]], ['show', 'Exibir', 'sel', [['cond', 'Só quando a situação acontecer (Simulador ECU)'], ['always', 'Sempre (controle pelo tempo)']]],
      ['title', 'Título', 'text'], ['msg', 'Mensagem', 'text'], ['sub', 'Linha extra', 'text'], ['sev', 'Severidade', 'sel', [['', 'Padrão'], ['critical', 'Crítico'], ['warning', 'Atenção'], ['info', 'Informação'], ['neutral', 'Neutro']]], F.num('num', 'Placa (km/h)', 0, 300),
      ['bVis', 'Selo de aviso visual ⚠ no card', 'chk'], ['bSnd', 'Selo de aviso sonoro 🔊 no card (e bipe)', 'chk']],
    r: drawAlert },
  telltale: { name: 'Indicador do painel', w: 44, h: 44, d: { icon: 'low_beam', src: 'auto', on: 1 },
    f: [['icon', 'Ícone', 'sel', Object.keys(AST.tt).map(k => [k, k])], ['src', 'Origem', 'sel', [['auto', 'Automático (Simulador ECU)'], ['manual', 'Manual']]], ['on', 'Aceso (modo manual)', 'chk']],
    r: e => { const a = AST.tt[e.icon] || AST.tt.master_warning, m = ECUMAP[e.icon], on = e.src === 'manual' || !m ? !!+e.on : !!m(); return `<svg width="${e.w}" height="${e.h}" viewBox="${a.vb}" ${rootAttr(a.root)} ${on ? '' : 'filter="url(#gray)" opacity=".3"'}>${a.in}</svg>`; } },
  nav: { name: 'Seta de navegação', w: 70, h: 70, d: { icon: 'turn_right', color: '#00e5ff', text: '450 m', fs: 22 },
    f: [['icon', 'Seta', 'sel', Object.keys(AST.nv).map(k => [k, k])], F.color('color', 'Cor'), ['text', 'Texto abaixo', 'text'], F.num('fs', 'Tamanho do texto', 8, 80)],
    r: e => { const a = AST.nv[e.icon] || AST.nv.straight, c = e.color; return `<svg width="${e.w}" height="${e.h}" viewBox="${a.vb}" fill="${a.root.fill || 'none'}" stroke="${c}" stroke-width="${a.root['stroke-width'] || 2.5}" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)">${a.in.replace(/stroke="#[0-9a-fA-F]{6}"/g, `stroke="${c}"`)}</svg>` + (e.text ? TXT(e.w / 2, e.h + e.fs * .8, e.text, e.fs, '#CBD5E1', 'middle', 600) : ''); } },
  gauge: { name: 'Medidor radial', w: 260, h: 260, d: { src: 'power', gmin: -100, gmax: 300, val: 120, unit: 'kW', label: 'POWER', sub: 'DUAL MOTOR', warn: 0, stroke: '#00e5ff' },
    f: [['src', 'Fonte do valor', 'sel', [['power', 'Potência (ECU)'], ['temp', 'Temp. bateria (ECU)'], ['soc', 'Bateria % (ECU)'], ['speed', 'Velocidade (ECU)'], ['manual', 'Manual']]], F.num('gmin', 'Mín', -1000, 1000), F.num('gmax', 'Máx', -1000, 2000), F.num('val', 'Valor manual', -1000, 2000),
      ['unit', 'Unidade', 'text'], ['label', 'Rótulo', 'text'], ['sub', 'Subtítulo', 'text'], F.num('warn', 'Alerta acima de (0 = sem)', 0, 2000), F.color('stroke', 'Cor')],
    r: e => { const R = Math.min(e.w, e.h) * .42, cx = e.w / 2, cy = e.h / 2 + R * .04, mn = +e.gmin, mx = +e.gmax, v = gval(e), fr = x => Math.max(0, Math.min(1, (x - mn) / (mx - mn || 1))), ang = f => (135 + 270 * f) * DEG, pt = (f, r) => [cx + r * Math.cos(ang(f)), cy + r * Math.sin(ang(f))],
      arc = (f0, f1, r) => { const a = pt(f0, r), b = pt(f1, r); return `M${a[0].toFixed(1)} ${a[1].toFixed(1)}A${r} ${r} 0 ${Math.abs(f1 - f0) * 270 > 180 ? 1 : 0} ${f1 > f0 ? 1 : 0} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`; },
      z = fr(mn < 0 ? 0 : mn), f = fr(v), col = (+e.warn && v > +e.warn) ? '#ef4444' : v < 0 ? '#34d399' : e.stroke;
      let o = `<path d="${arc(0, 1, R)}" fill="none" stroke="#101824" stroke-width="${R * .13}" stroke-linecap="round"/>`;
      for (let i = 0; i <= 20; i++){ const q = i / 20, a = pt(q, R * .8), b = pt(q, R * (i % 5 ? .86 : .9)); o += `<path d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}" stroke="${(q <= f && q >= Math.min(z, f)) || (q >= f && q <= z) ? '#CBD5E1' : '#475569'}" stroke-width="${i % 5 ? 1 : 1.8}"/>`; }
      if (Math.abs(f - z) > .002) o += `<path d="${arc(Math.min(z, f), Math.max(z, f), R)}" fill="none" stroke="${col}" stroke-width="${R * .09}" stroke-linecap="round" filter="url(#glow)"/>`;
      const t = pt(f, R); o += `<circle cx="${t[0]}" cy="${t[1]}" r="${R * .085}" fill="#fff" stroke="${col}" stroke-width="2" filter="url(#glow)"/>`;
      return o + TXT(cx, cy - R * .5, e.label, R * .15, '#94A3B8', 'middle', 700, 'letter-spacing="1.5"') + TXT(cx, cy + R * .1, Math.round(v), R * .52, '#fff', 'middle') + TXT(cx, cy + R * .38, e.unit, R * .17, '#94A3B8', 'middle', 600) + TXT(cx, cy + R * .7, e.sub, R * .12, '#64748B', 'middle', 600, 'letter-spacing="1.2"'); } },
  speedo: { name: 'Velocímetro digital', w: 280, h: 130, d: {}, f: [],
    r: e => { const v = Math.round(ECU.speed), cx = e.w / 2, r = e.h * .14, c = v > ECU.limit + 5 ? '#fbbf24' : '#fff'; return TXT(cx, e.h * .45, v, e.h * .66, c, 'middle') + TXT(cx, e.h * .9, 'km/h', e.h * .17, '#94A3B8', 'middle', 600) + `<circle cx="${cx - e.w * .36}" cy="${e.h * .45}" r="${r}" fill="#fff" stroke="#ef4444" stroke-width="${r * .22}"/>` + TXT(cx - e.w * .36, e.h * .45, ECU.limit, r * .95, '#000', 'middle'); } },
  infobar: { name: 'Barra de status', w: 1280, h: 40, d: { kind: 'top', stroke: '#00e5ff' },
    f: [['kind', 'Posição', 'sel', [['top', 'Barra superior'], ['bottom', 'Barra inferior']]], F.color('stroke', 'Cor')],
    r: e => { const c = e.stroke, w = e.w, h = e.h, m = h / 2, T = (x, t, fs, col, a = 'middle', wt = 600) => TXT(x, m, t, fs, col, a, wt, 'letter-spacing=".8"'); let o = `<rect width="${w}" height="${h}" fill="#05070a" fill-opacity=".55"/>`;
      if (e.kind === 'bottom'){ const n = Math.round(ECU.soc / 12.5); o += `<rect x="${w * .03}" y="${m - h * .22}" width="${h * 1.1}" height="${h * .44}" rx="3" fill="none" stroke="${c}" stroke-width="1.5"/>`; for (let i = 0; i < 8; i++) o += `<rect x="${w * .03 + h * .06 + i * h * .125}" y="${m - h * .16}" width="${h * .09}" height="${h * .32}" fill="${i < n ? c : '#1E293B'}"/>`;
        o += T(w * .03 + h * 1.25, Math.round(ECU.soc) + '%', h * .46, '#fff', 'start', 700) + T(w * .03 + h * 2.5, Math.round(ECU.soc * 4.4) + ' km', h * .4, '#94A3B8', 'start');
        ['P', 'R', 'N', 'D'].forEach((g, i) => { o += T(w * .5 + (i - 1.5) * h * 1.1, g, h * .55, g === ECU.gear ? c : '#475569', 'middle', 700); });
        o += T(w * .97, hdName(ECU.hd) + '  ' + Math.round(ECU.hd) + '°', h * .4, '#CBD5E1', 'end'); }
      else { const d = new Date(), hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); o += T(w * .03, hh, h * .5, '#fff', 'start', 700) + T(w * .5, ECU.mode, h * .42, c, 'middle', 700) + T(w * .5 + w * .06, 'DRIVER ASSIST', h * .3, '#64748B', 'start');
        o += T(w * .97 - h * 3.4, Math.round(ECU.ambient) + '°C', h * .4, '#CBD5E1', 'end') + T(w * .97 - h * 2.6, 'GPS', h * .3, '#34d399'); for (let i = 0; i < 4; i++) o += `<rect x="${w * .97 - h * 1.9 + i * h * .2}" y="${m + h * .2 - (i + 1) * h * .1}" width="${h * .13}" height="${(i + 1) * h * .1}" fill="${i < 3 ? '#CBD5E1' : '#475569'}"/>`; o += T(w * .97, 'LTE', h * .3, '#CBD5E1', 'end'); }
      return o; } },
  sign2d: { name: 'Placa de velocidade (2D)', w: 90, h: 90, d: { text: '60', ecu: 0, fill: '#ffffff', ring: '#d92d20', tc: '#111111' },
    f: [['text', 'Número / texto', 'text'], ['ecu', 'Usar o limite do Simulador ECU', 'chk'], F.color('fill', 'Fundo'), F.color('ring', 'Borda'), F.color('tc', 'Texto')],
    r: e => { const r = Math.min(e.w, e.h) / 2, t = e.ecu ? ECU.limit : e.text; return `<circle cx="${e.w / 2}" cy="${e.h / 2}" r="${r - r * .09}" fill="${e.fill}" stroke="${e.ring}" stroke-width="${r * .18}"/>` + TXT(e.w / 2, e.h / 2, t, r * (String(t).length > 2 ? .72 : .9), e.tc, 'middle', 800); } },
  tri: { name: 'Alerta (triângulo)', w: 90, h: 80, d: { text: '!', fill: '#ffb020', stroke: '#111111', tc: '#111111' },
    f: [['text', 'Texto', 'text'], F.color('fill', 'Preenchimento'), F.color('stroke', 'Contorno'), F.color('tc', 'Texto')],
    r: e => `<path d="M${e.w / 2} 3 L${e.w - 3} ${e.h - 3} H3Z" fill="${e.fill}" stroke="${e.stroke}" stroke-width="3" stroke-linejoin="round"/>` + TXT(e.w / 2, e.h * .64, e.text, e.h * .42, e.tc, 'middle', 800) },
  step: { name: 'Card do passo atual', w: 520, h: 130, d: { accent: '#00e5ff', fill: '#0b1018', fo: .88, fs: 22 },
    f: [F.color('accent', 'Destaque'), F.color('fill', 'Fundo'), F.op('fo', 'Opacidade do fundo'), F.num('fs', 'Tamanho do título', 10, 60)],
    r: (e, exp) => { const i = curStepIdx(state.t), s = state.steps[i];
      if (!s) return exp ? '' : `<rect width="${e.w}" height="${e.h}" rx="14" fill="${e.fill}" fill-opacity=".4" stroke="#475569" stroke-dasharray="6 5"/>` + TXT(e.w / 2, e.h / 2, 'Card do passo (crie passos no painel da direita)', 16, '#64748b', 'middle', 600);
      const fs = e.fs, ls = wrapText(s.text, Math.max(10, Math.floor((e.w - 40) / (fs * .5)))).slice(0, 5);
      let o = `<rect width="${e.w}" height="${e.h}" rx="14" fill="${e.fill}" fill-opacity="${e.fo}" stroke="${e.accent}" stroke-opacity=".5"/><rect x="0" y="14" width="5" height="${e.h - 28}" rx="2.5" fill="${e.accent}"/>`;
      o += TXT(22, 24, `PASSO ${i + 1} DE ${state.steps.length}`, fs * .55, e.accent, 'start', 700, 'letter-spacing="2"') + TXT(22, 24 + fs * 1.15, s.title, fs, '#ffffff', 'start', 700);
      ls.forEach((l, k) => { o += TXT(22, 24 + fs * 2.25 + k * fs * .8, l, fs * .66, '#cbd5e1', 'start', 500); });
      return o; } }
};
const HUD_ORDER = ['title', 'speedbig', 'text', 'screen', 'rect', 'alert', 'step', 'telltale', 'nav', 'gauge', 'speedo', 'infobar', 'sign2d', 'tri'];

function hudAnim(e){
  const a = { o: 1, sc: 1 };
  if (e.t === 'alert' && e.kind === 'auto'){ const t = (performance.now() - NT.t0) / 1000; if (t < .3){ a.sc = .9 + .1 * bk(t / .3); a.o = Math.min(1, t / .25); } if (!NT.hold && t > 3.2){ const q = Math.max(0, (3.6 - t) / .4); a.o = q; a.sc = .95 + .05 * q; } return a; }
  if (e.t === 'alert' && e.show !== 'always'){ const s0 = NT.since[e.kind]; if (s0){ const t = (performance.now() - s0) / 1000; if (t < .3){ a.sc = .9 + .1 * bk(t / .3); a.o = Math.min(1, t / .25); } } return a; }
  const lt = state.t - (e.from || 0);
  if (e.anim === 'pop' && lt >= 0 && lt < .3 && (e.from || 0) > 0){ a.sc = .9 + .1 * bk(lt / .3); a.o = Math.min(1, lt / .25); }
  if (e.anim === 'fade' && lt >= 0 && lt < .6 && (e.from || 0) > 0) a.o = lt / .6;
  if (e.anim === 'blink') a.o = Math.sin(state.t * Math.PI * 2.4) > -0.2 ? 1 : 0.25;
  return a;
}
function renderHud(exp){
  let s = '';
  for (const e of state.hud){
    const D = HUDT[e.t]; if (!D) continue;
    if (D.size) D.size(e);
    const vis = !e.hidden && visibleAt(e, state.t);
    let inner = vis ? D.r(e, exp) : null;
    if (inner == null || inner === ''){
      if (exp || state.preview || e.hidden) continue;
      const why = e.t === 'alert' ? (e.kind === 'auto' ? 'Notificações ADAS (automático)' : 'Aguarda: ' + (ALWHY[e.kind] || '')) : D.name + ' (fora do tempo)';
      s += `<g data-h="${e.id}" transform="translate(${e.x} ${e.y})" opacity=".7"><rect width="${e.w}" height="${e.h}" rx="10" fill="#0b1018" fill-opacity=".35" stroke="#64748b" stroke-dasharray="6 5"/>${TXT(e.w / 2, e.h / 2, why, Math.min(e.h * .2, e.w / Math.max(8, why.length) * 1.7), '#94a3b8', 'middle', 600)}</g>`;
      continue;
    }
    const a = hudAnim(e), op = (e.op ?? 1) * a.o;
    const tf = `translate(${e.x} ${e.y})` + (a.sc !== 1 ? ` translate(${e.w / 2} ${e.h / 2}) scale(${a.sc.toFixed(3)}) translate(${-e.w / 2} ${-e.h / 2})` : '');
    s += `<g data-h="${e.id}" transform="${tf}" opacity="${op.toFixed(3)}"><rect width="${e.w}" height="${e.h}" fill="transparent" stroke="none"/>${inner}</g>`;
  }
  return s;
}
function hudOverlay(){
  const e = hudById(state.hudSel); if (!e || state.preview) return '';
  return `<g transform="translate(${e.x} ${e.y})" pointer-events="none"><rect width="${e.w}" height="${e.h}" fill="none" stroke="#ffb020" stroke-width="1.5" stroke-dasharray="6 4"/></g>` +
    (e.t === 'text' ? '' : `<rect data-rs="1" x="${e.x + e.w - 9}" y="${e.y + e.h - 9}" width="18" height="18" fill="#ffb020" stroke="#111"/>`);
}
let lastHudDom = '';
function updateHudDom(){
  const s = renderHud(false) + hudOverlay();
  if (s !== lastHudDom){ lastHudDom = s; hudEl.innerHTML = HUD_DEFS + s; }
}
/* rasterização do HUD para foto, vídeo e GIF */
let hudImg = null, hudImgStr = '', hudBusy = false, hudWant = '';
const hudDoc = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${HW} ${HH}" font-family="Segoe UI, Arial, sans-serif">${HUD_DEFS}${renderHud(true)}</svg>`;
async function rasterHud(str){ const im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str); await im.decode(); return im; }
function requestHud(str){
  hudWant = str; if (hudBusy || str === hudImgStr) return;
  hudBusy = true;
  rasterHud(str).then(im => { hudImg = im; hudImgStr = str; }).catch(() => {}).finally(() => { hudBusy = false; if (hudWant !== hudImgStr) requestHud(hudWant); });
}
function hudThumb(t){
  const D = HUDT[t], e = { id: 0, t, x: 0, y: 0, w: D.w, h: D.h, ...D.d, op: 1, show: 'always', kind: t === 'alert' ? 'forward_collision' : D.d.kind };
  if (t === 'step') return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -20 560 170"><rect x="-20" y="-20" width="560" height="170" fill="#1d2129"/><rect width="520" height="130" rx="14" fill="#0b1018" stroke="#00e5ff"/><rect y="14" width="5" height="102" fill="#00e5ff"/><text x="22" y="30" font-size="14" fill="#00e5ff" font-family="Arial" font-weight="700">PASSO 1 DE 3</text><text x="22" y="62" font-size="24" fill="#fff" font-family="Arial" font-weight="700">O radar detecta</text><text x="22" y="92" font-size="16" fill="#cbd5e1" font-family="Arial">o veículo à frente…</text></svg>`);
  if (D.size) D.size(e);
  const pad = Math.max(e.w, e.h) * .12, inner = D.r(e, true) || '';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${e.w + pad * 2} ${e.h + pad * 2 + (t === 'nav' ? 30 : 0)}" font-family="Segoe UI, Arial, sans-serif">${HUD_DEFS}<rect x="${-pad}" y="${-pad}" width="${e.w + pad * 2}" height="${e.h + pad * 2 + 30}" fill="#1d2129"/>${inner}</svg>`);
}
function addHud(t){
  const D = HUDT[t]; pushHistory();
  const e = { id: nextUid++, t, w: D.w, h: D.h, op: 1, from: 0, to: 0, anim: 'none', ...JSON.parse(JSON.stringify(D.d)) };
  e.x = Math.round(HW / 2 - e.w / 2); e.y = Math.round(HH / 2 - e.h / 2);
  if (t === 'alert'){ e.x = HW - e.w - 20; e.y = 20; }
  if (t === 'pip'){ e.x = HW - e.w - 20; e.y = 120; }
  if (t === 'title'){ e.x = 32; e.y = 24; }
  if (t === 'infobar'){ e.x = 0; e.w = HW; e.y = e.kind === 'bottom' ? HH - e.h : 0; }
  if (t === 'step'){ e.x = 32; e.y = HH - e.h - 32; }
  if (t === 'speedbig'){ e.x = 40; e.y = HH / 2 - 60; }
  state.hud.push(e); selectHud(e.id); hudDirty = true; renderLayers(); scheduleSave();
}
function selectHud(id){
  state.hudSel = id; if (id != null){ state.selected = null; state.markerIdx = null; tc.detach(); refreshRoutes(); }
  hudDirty = true; renderProps(); renderLayers();
}
/* arrastar itens do HUD */
let hudDrag = null;
const hudPt = ev => { const p = hudEl.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; return p.matrixTransform(hudEl.getScreenCTM().inverse()); };
hudEl.addEventListener('pointerdown', ev => {
  if (state.preview || state.recording || state.mode !== 'select') return;
  const rs = ev.target.closest('[data-rs]'), g = ev.target.closest('[data-h]');
  if (!rs && !g) return;
  ev.preventDefault(); ev.stopPropagation();
  const id = rs ? state.hudSel : +g.dataset.h;
  if (id !== state.hudSel) selectHud(id);
  const e = hudById(id); if (!e) return;
  hudDrag = { mode: rs ? 'size' : 'move', p: hudPt(ev), o: { ...e }, pushed: false };
});
addEventListener('pointermove', ev => {
  if (!hudDrag) return;
  const e = hudById(state.hudSel); if (!e) return;
  if (!hudDrag.pushed){ pushHistory(); hudDrag.pushed = true; }
  const p = hudPt(ev), dx = p.x - hudDrag.p.x, dy = p.y - hudDrag.p.y, o = hudDrag.o, sn = v => state.snap && !ev.altKey ? Math.round(v / 8) * 8 : Math.round(v);
  if (hudDrag.mode === 'move'){ e.x = sn(o.x + dx); e.y = sn(o.y + dy); }
  else if (e.t === 'text') e.fs = Math.max(8, Math.round(o.fs * (o.w + dx) / o.w));
  else { e.w = Math.max(12, sn(o.w + dx)); e.h = Math.max(12, sn(o.h + dy)); }
  hudDirty = true; updatePropValues();
});
addEventListener('pointerup', () => { if (hudDrag){ hudDrag = null; scheduleSave(); } });
