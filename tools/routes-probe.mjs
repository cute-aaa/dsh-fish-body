// 开发用：不开 dsh、直接驱动路由处理器，验证 skins / desktop / 静态素材与防穿越。
// 用法：node tools/routes-probe.mjs
import { Writable } from 'node:stream';
import { resolve } from 'node:path';
import { buildRoutes } from '../lib/routes.js';
import { AssetRegistry } from '../lib/assets.js';
import * as desktop from '../lib/desktop.js';

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

function makeRes() {
  const chunks = [];
  const res = new Writable({ write(chunk, enc, cb) { chunks.push(chunk); cb(); } });
  res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers; };
  res.bodyText = () => Buffer.concat(chunks).toString('utf8');
  res.bodyLen = () => Buffer.concat(chunks).length;
  return res;
}

function call(route, method, url) {
  return new Promise((done) => {
    const res = makeRes();
    const req = {
      method,
      url,
      headers: {},
      _handlers: {},
      on(ev, fn) { (this._handlers[ev] || (this._handlers[ev] = [])).push(fn); return this; },
      once(ev, fn) { return this.on(ev, fn); },
      destroy() {},
    };
    res.on('finish', () => done({ status: res.statusCode, headers: res.headers, body: res.bodyText(), length: res.bodyLen() }));
    const handler = route.handler;
    try {
      const ret = handler(req, res);
      if (ret && typeof ret.then === 'function') ret.catch((e) => { res.statusCode = 500; res.end(String(e)); });
    } catch (e) {
      res.statusCode = 500; res.end(String(e));
    }
    // 让 readJsonBody 收到一个空 body 的 end
    setTimeout(() => { for (const fn of req._handlers.end || []) fn(); }, 0);
    setTimeout(() => { if (!res.writableEnded) res.end(); }, 3000);
  });
}

const assets = new AssetRegistry(ROOT);
assets.scan([]);

const store = {
  snapshot: {},
  patch() {},
  onChange() { return () => {}; },
};
const deps = {
  ctx: { webServer: { getOrigin: () => 'http://127.0.0.1:3099' }, settings: { describe: () => [], mutate: async () => {} } },
  store,
  persona: { list: () => [], readCurrent: async () => null },
  assets,
  voice: {},
  interaction: {},
  screen: {},
  avoidance: { foregroundInfo: async () => null, decideAvoidance: () => ({}) },
  desktop,
  packageRoot: ROOT,
  resolveConfig: () => ({ size: 200, scale: 1, resourceDirs: [], personaSource: 'fish-soul' }),
  env: async () => ({}),
  publishAssets() {},
  standaloneUrl: () => 'http://127.0.0.1:3099/fish-body/standalone',
  electronMainUrl: () => 'http://127.0.0.1:3099/fish-body-assets/electron-main.cjs',
  standaloneHtml: () => '<html></html>',
};

const routes = buildRoutes(deps);
// 宿主会对重复的 (kind, path) 直接 throw —— 这里提前兜住
const seen = new Set();
let dup = null;
for (const r of routes) {
  const key = `${r.kind}:${r.path}`;
  if (seen.has(key)) { dup = key; break; }
  seen.add(key);
}
console.log('[probe] routes:', routes.length, dup ? `DUPLICATE ${dup}` : 'no duplicate (kind,path)');
if (dup) process.exitCode = 1;

const find = (path, kind) => routes.find((r) => r.path === path && (!kind || r.kind === kind));
const exact = (p) => find(p, 'exact');
const exactPost = (p) => routes.filter((r) => r.path === p && r.kind === 'exact').pop();
const prefix = (p) => find(p, 'prefix');

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra ?? ''); }
}

console.log('[probe] assets:', assets.list('webm').length, 'webm /', assets.list('sounds').length, 'sounds /', assets.list('skins').length, 'skins');

const r1 = await call(exact('/api/fish-body/assets'), 'GET', '/api/fish-body/assets');
const assetsJson = JSON.parse(r1.body);
check('GET /assets 返回 skins', Array.isArray(assetsJson.skins) && assetsJson.skins.some((s) => s.id === 'feiyu-05'), r1.body.slice(0, 120));

const r2 = await call(exact('/api/fish-body/skins'), 'GET', '/api/fish-body/skins');
check('GET /skins 200', r2.status === 200, r2.body);

const r3 = await call(prefix('/api/fish-body/skins'), 'GET', '/api/fish-body/skins/feiyu-05');
const skinJson = JSON.parse(r3.body);
check('GET /skins/feiyu-05 有 18 层', skinJson.manifest?.layers?.length === 18, r3.body.slice(0, 200));

const r4 = await call(prefix('/api/fish-body/skins'), 'GET', '/api/fish-body/skins/nope');
check('GET /skins/nope 404', r4.status === 404, r4.body);

const r5 = await call(prefix('/fish-body-assets'), 'GET', '/fish-body-assets/skins/feiyu-05/manifest.json');
check('静态 manifest.json 200', r5.status === 200 && r5.body.includes('"layered"'), `${r5.status} ${r5.body.slice(0, 60)}`);

const r6 = await call(prefix('/fish-body-assets'), 'GET', '/fish-body-assets/skins/feiyu-05/art/02_back_hair.png');
check('静态 art 200 且是 PNG', r6.status === 200 && r6.length > 1000, `${r6.status} ${r6.length}`);

const r7 = await call(prefix('/fish-body-assets'), 'GET', '/fish-body-assets/skins/feiyu-05/..%2f..%2f..%2fpackage.json');
check('防穿越（..%2f）', r7.status === 404 || !r7.body.includes('"name": "dsh-fish-body"'), `${r7.status}`);

const r8 = await call(prefix('/fish-body-assets'), 'GET', '/fish-body-assets/skins/..%2f..%2fpackage.json');
check('防穿越（skin id 也含 ..）', r8.status === 404, `${r8.status}`);

const r9 = await call(exact('/fish-body-assets/layered.js'), 'GET', '/fish-body-assets/layered.js');
check('layered.js 200', r9.status === 200 && r9.body.includes('FishBodyLayered'), r9.status);

const r10 = await call(exact('/api/fish-body/desktop'), 'GET', '/api/fish-body/desktop');
const deskJson = JSON.parse(r10.body);
check('GET /desktop 返回引擎信息', deskJson.ok === true && 'running' in deskJson && !!deskJson.engine, r10.body.slice(0, 160));

const r11 = await call(exactPost('/api/fish-body/desktop'), 'POST', '/api/fish-body/desktop');
check('POST /desktop（未知动作被拒绝或成功）', r11.status === 200 || r11.status === 400, `${r11.status} ${r11.body.slice(0, 80)}`);

console.log(failures === 0 ? '[probe] ALL PASS' : `[probe] ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
