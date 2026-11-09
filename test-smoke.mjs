// 冒烟测试：模拟最小宿主 ctx，验证 apply() 装配、路由构建、状态中枢无运行时错误。
import { apply, inject, Config, name } from './lib/index.js';
import { resolveConfig, DEFAULTS } from './lib/config.js';
import { buildRoutes, sseRoute } from './lib/routes.js';

console.log('[smoke] exports:', { name, inject, hasConfig: !!Config });

const routes = [];
const effects = [];
const disposers = [];
const mockCtx = {
  webServer: {
    register(route) { routes.push(route); return () => disposers.push('route'); },
    getOrigin() { return 'http://127.0.0.1:3099'; },
  },
  on(event, fn) { return () => {}; },
  effect(fn, label) { effects.push(label ?? 'effect'); const r = fn(); return () => (typeof r === 'function' ? r() : undefined); },
  interval(fn, ms) { return () => {}; },
  setTimeout: setTimeout,
  setInterval: setInterval,
  settings: { configure() {}, describe() { return []; }, async mutate() {} },
  get(name) { return undefined; },
  agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }) },
  llm: { stream: async function* () {} },
};

const config = resolveConfig({});
console.log('[smoke] resolved config keys:', Object.keys(config).join(','));
console.log('[smoke] defaults:', { form: config.form, modelType: config.modelType, personaSource: config.personaSource });

// apply() 返回清理函数
let cleanup = null;
try {
  const result = apply(mockCtx, config);
  cleanup = (typeof result?.then === 'function') ? null : result;
  console.log('[smoke] apply() returned:', typeof result);
} catch (e) {
  console.error('[smoke] apply() THREW:', e);
  process.exit(1);
}

// apply 是 async，等它完成
await new Promise((r) => setTimeout(r, 300));

// 校验路由
const paths = routes.map((r) => r.path).sort();
console.log('[smoke] routes registered:', routes.length);
for (const p of paths) console.log('  -', p);

const has = (p) => paths.some((x) => x === p || x.startsWith(p));
for (const expected of ['/api/fish-body/state', '/api/fish-body/events', '/api/fish-body/chat', '/api/fish-body/persona', '/api/fish-body/assets', '/api/fish-body/skins', '/api/fish-body/desktop', '/fish-body/standalone', '/fish-body-assets/layered.js', '/fish-body-assets']) {
  if (!has(expected)) { console.error(`[smoke] MISSING route: ${expected}`); process.exit(1); }
}

// 宿主对重复 (kind, path) 会直接抛错：注册前先自检
const seenKeys = new Set();
for (const r of routes) {
  const key = `${r.kind}:${r.path}`;
  if (seenKeys.has(key)) { console.error(`[smoke] DUPLICATE route: ${key}`); process.exit(1); }
  seenKeys.add(key);
}

// 直接测 buildRoutes（脱离 ctx.webServer，纯构建）
const deps = {
  ctx: mockCtx,
  store: { snapshot: { workStatus: { state: 'idle' } }, onChange() { return () => {}; }, patch() {}, setWorkStatus() {} },
  persona: { list: () => [], readCurrent: async () => null, readCached: async () => null, detect: async () => null },
  assets: { manifest: { webm: [], sounds: [], live2d: [], skins: [] }, resolve: () => null, entry: () => null, scan: () => ({ webm: [], sounds: [], live2d: [], skins: [] }), resolveWithin: () => null },
  voice: { synthesize: async () => null },
  interaction: { generatePersonaReply: async () => ({ ok: false, text: '' }) },
  screen: { captureScreen: async () => null, describeScreen: async () => ({ ok: false }), cleanupCapture() {} },
  avoidance: { foregroundInfo: async () => null, decideAvoidance: () => ({ active: false, reasons: [] }) },
  desktop: { launchStandalone: async () => ({}), stopStandalone: () => ({}), status: () => ({ running: false, engine: {} }) },
  packageRoot: new URL('.', import.meta.url).pathname.replace(/\/$/, ''),
  resolveConfig: () => config,
  env: async () => ({ dshHome: 'D:/NodeJS/DSH', profile: 'fish' }),
  publishAssets() {},
  standaloneUrl: () => 'http://127.0.0.1:3099/fish-body/standalone',
  electronMainUrl: () => 'http://127.0.0.1:3099/fish-body-assets/electron-main.cjs',
  standaloneHtml: () => '<html></html>',
};
try {
  const r = buildRoutes(deps);
  const sse = sseRoute({ snapshot: {}, onChange: () => () => {} });
  console.log('[smoke] buildRoutes:', r.length, 'routes +', 1, 'sse route');
} catch (e) {
  console.error('[smoke] buildRoutes THREW:', e);
  process.exit(1);
}

if (cleanup) { try { cleanup(); } catch { /* 忽略 */ } }
console.log('[smoke] ALL PASS');
process.exit(0);
