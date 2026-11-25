// Gera Cena3D.html: interface + código + modelos GLB + ícones, tudo num arquivo só, protegido por senha.
//
// uso:  node build.js                  -> gera ../Cena3D.html protegido com a senha de senha.txt
//       node build.js --sem-senha      -> gera sem trava (só para testes)
//       node build.js <raiz> <saída> --debug   -> versão de teste, sem senha e com atalho de depuração
//
// A senha fica em cena3d-fonte/senha.txt (uma linha). Esse arquivo NÃO vai para o git.
// Também dá para passar pela variável de ambiente CENA3D_SENHA.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const args = process.argv.slice(2), flags = args.filter(a => a.startsWith('--')), pos = args.filter(a => !a.startsWith('--'));
const debug = flags.includes('--debug'), noLock = debug || flags.includes('--sem-senha');
const root = pos[0] || path.join(__dirname, '..'), out = pos[1] || path.join(root, 'Cena3D.html');
const rd = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const packs = [
  ['kenney', 'k', 'kenney_city-kit-roads_2.2/Models/GLB format'],
  ['vehicles', 'v', 'LowPolyVehiclesPack_v1.0/LowPolyVehiclesPack_v1.0/GLB'],
  ['street', 's', 'LowPoly_CityStreet_v1.0/LowPoly_CityStreet_v1.0/GLB'],
  ['chars', 'h', 'cena3d-fonte/personagens'],
];
const models = [];
for (const [pack, pre, dir] of packs)
  for (const f of fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.glb')).sort())
    models.push({ id: `${pre}:${f.replace(/\.glb$/, '')}`, file: f.replace(/\.glb$/, ''), pack, data: fs.readFileSync(path.join(root, dir, f)).toString('base64') });
const colormap = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'kenney_city-kit-roads_2.2/Models/GLB format/Textures/colormap.png')).toString('base64');
// ícones (indicadores e setas do painel) e fundo de montanhas, extraídos do ADAS Studio
const { ast, mtn } = JSON.parse(rd('recursos/adas-icones.json'));
const data = JSON.stringify({ colormap, models, ast, mtn });
const js = ['core.js', 'procs.js', 'roads.js', 'characters.js', 'hud.js', 'features.js', 'ui.js'].map(rd).join('\n') + (debug ? '\nwindow.__dbg = { state, solids, objects, MODELS, leadOf, boxOf, select, getEntry, camera, renderer, V3 };' : '');
const app = rd('head.html')
  + `<script type="application/json" id="model-data">${data}</script>\n`
  + `<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>\n`
  + `<script type="module">\n${js}\n</script>\n</body>\n</html>\n`;

if (noLock){
  fs.writeFileSync(out, app);
  console.log(models.length, 'modelos,', (app.length / 1e6).toFixed(2), 'MB — SEM senha' + (debug ? ' (debug)' : ''));
  process.exit(0);
}

// ---------- trava com senha: o app inteiro vai criptografado (AES-256-GCM, chave PBKDF2-SHA256) ----------
const senhaFile = path.join(__dirname, 'senha.txt');
const senha = (process.env.CENA3D_SENHA || (fs.existsSync(senhaFile) ? fs.readFileSync(senhaFile, 'utf8') : '')).trim();
if (!senha){ console.error('Falta a senha: crie cena3d-fonte/senha.txt com a senha numa linha (ou use --sem-senha).'); process.exit(1); }
const ITER = 250000, salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(senha, salt, ITER, 32, 'sha256');
const c = crypto.createCipheriv('aes-256-gcm', key, iv);
const enc = Buffer.concat([c.update(Buffer.from(app, 'utf8')), c.final(), c.getAuthTag()]);   // WebCrypto espera a tag no fim
const lock = rd('lock.html')
  .replace('__SALT__', salt.toString('base64')).replace('__IV__', iv.toString('base64')).replace('__ITER__', String(ITER))
  .replace('__DATA__', () => enc.toString('base64'));
fs.writeFileSync(out, lock);
console.log(models.length, 'modelos,', (lock.length / 1e6).toFixed(2), 'MB — protegido com senha');
