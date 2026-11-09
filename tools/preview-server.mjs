// 开发用预览服务器：脱离 dsh 直接验证 assets/core.js + assets/layered.js。
// 用法：node tools/preview-server.mjs [port]
//   GET /                        → 预览页（standalone 形态挂 core.js）
//   GET /?model=layerd&skin=xxx  → 指定渲染类型
//   /api/fish-body/*             → 假状态（state / events / chat / balance）
//   /fish-body-assets/*          → 真实素材
import http from 'node:http';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssetRegistry } from '../lib/assets.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ASSETS = join(ROOT, 'assets');
const PORT = Number(process.argv[2] || 3199);
/** 额外资源目录（分号分隔），例如 D:\AI\FishChi\body\skins */
const EXTRA_DIRS = (process.env.FISH_PREVIEW_RESOURCE_DIRS || '').split(';').map((s) => s.trim()).filter(Boolean);
const registry = new AssetRegistry(ROOT);
registry.scan(EXTRA_DIRS);

const MIME = {
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
};

function sendFile(res, file) {
  try {
    const stat = statSync(file);
    if (!stat.isFile()) { res.writeHead(404); res.end('not a file'); return; }
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': String(stat.size),
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}

function within(root, rel) {
  const candidate = resolve(root, rel);
  const prefix = root.endsWith(sep) ? root : root + sep;
  return candidate === root || candidate.startsWith(prefix) ? candidate : null;
}

async function skins() {
  return registry.list('skins').map((s) => ({ id: s.id, name: s.name, layerCount: s.layerCount, path: s.path }));
}

let forced = null; // 由页面首帧 /__mode?model=…&skin=… 设置（core 的 XHR 不带页面 query）

function state(query) {
  const q = forced || query;
  const model = q.get('model') || 'layered';
  const skin = q.get('skin') || 'feiyu-05';
  const form = q.get('form') || 'browser';
  return {
    version: 1,
    enabled: true,
    form,
    desktop: { running: form === 'desktop', kind: form === 'desktop' ? 'chromium-app' : null, engine: { electron: null, chromium: 'preview' } },
    config: {
      enabled: true,
      form,
      size: Number(q.get('size') || 320),
      scale: 1,
      modelType: model,
      webmSet: q.get('set') || '',
      webmIdle: '待机呼吸休闲',
      webmClick: '点击回应-开心跃动',
      webmIdleSound: '',
      clickSound: 'click-duck',
      webmBalanceFull: '余额-钱袋满溢',
      webmBalanceNormal: '余额-钱袋如常',
      webmBalanceEmpty: '余额-袋空如洗',
      live2dModel: '',
      layeredSkin: skin,
      taskStatus: true,
    },
    workStatus: { state: 'idle' },
    avoidance: { active: false, reasons: [] },
    assets: {
      webm: registry.list('webm').map((e) => ({ id: e.id, name: e.name, set: e.set })),
      sounds: registry.list('sounds').map((e) => ({ id: e.id, name: e.name })),
      skins: registry.list('skins'),
      webmSets: registry.manifest.webmSets,
    },
    persona: { name: '鱼生' },
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = decodeURIComponent(url.pathname);

  if (path === '/' || path === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>fish-body preview</title>
<style>html,body{margin:0;padding:0;height:100%;background:#20222b;overflow:hidden}</style></head>
<body><div id="host" style="position:fixed;inset:0;pointer-events:none"></div>
<script src="/fish-body-assets/core.js"></script>
<script>
  fetch('/__mode' + location.search).then(function () {
    // host=browser 模拟「DSH 页面内挂载」（standalone=false），用于验证 form=desktop 时不重复渲染
    var standalone = location.search.indexOf('host=browser') < 0;
    var api = FishBodyCore.mount(document.getElementById('host'), { standalone: standalone });
    window.addEventListener('beforeunload', function () { api.dispose(); });
    window.__fishReady = true;
  });
</script></body></html>`);
    return;
  }

  if (path === '/__mode') {
    forced = new URLSearchParams(url.search);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, model: forced.get('model'), skin: forced.get('skin') }));
    return;
  }

  if (path === '/fish-body/standalone') {
    sendFile(res, join(ASSETS, 'standalone.html'));
    return;
  }

  if (path === '/api/fish-body/state') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(state(url.searchParams)));
    return;
  }

  if (path === '/api/fish-body/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(state(url.searchParams))}\n\n`);
    const timer = setInterval(() => res.write(': ping\n\n'), 20000);
    res.on('close', () => clearInterval(timer));
    return;
  }

  if (path === '/api/fish-body/chat') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, text: '诶嘿，戳我干嘛～（预览）' }));
    return;
  }

  if (path === '/api/fish-body/balance') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, balance: { value: [{ currency: 'CNY', balance: '12.34' }] } }));
    return;
  }

  if (path === '/api/fish-body/skins') {
    skins().then((list) => {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, skins: list }));
    }, () => { res.writeHead(500); res.end('[]'); });
    return;
  }

  if (path.startsWith('/fish-body-assets/webm/') || path.startsWith('/fish-body-assets/sound/')) {
    // 与宿主一致：URL 里是「名字」（可能带角色包前缀），由注册表解析到实际文件
    const kind = path.includes('/webm/') ? 'webm' : 'sounds';
    const prefix = path.includes('/webm/') ? '/fish-body-assets/webm/' : '/fish-body-assets/sound/';
    const name = path.slice(prefix.length);
    const file = registry.resolve(kind, name);
    if (!file) { res.writeHead(404); res.end('no such asset: ' + name); return; }
    sendFile(res, file);
    return;
  }

  if (path.startsWith('/fish-body-assets/skins/')) {
    const rest = path.slice('/fish-body-assets/skins/'.length);
    const slash = rest.indexOf('/');
    const id = slash < 0 ? rest : rest.slice(0, slash);
    const rel = slash < 0 ? '' : rest.slice(slash + 1);
    const entry = registry.entry('skins', id);
    if (!entry) { res.writeHead(404); res.end('no such skin'); return; }
    const file = rel ? within(entry.path, rel) : entry.manifestPath;
    if (!file) { res.writeHead(404); res.end(); return; }
    sendFile(res, file);
    return;
  }

  if (path.startsWith('/fish-body-assets/')) {
    const rel = path.slice('/fish-body-assets/'.length);
    const file = within(ASSETS, rel);
    if (!file) { res.writeHead(404); res.end(); return; }
    sendFile(res, file);
    return;
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[preview] http://127.0.0.1:${PORT}/`);
  console.log(`[preview] layered: http://127.0.0.1:${PORT}/?model=layered&skin=feiyu-05&size=320`);
  console.log(`[preview] webm   : http://127.0.0.1:${PORT}/?model=webm&size=320`);
});
