// 开发用：用真实 Chrome（非 headless）+ CDP 截图 / 点命中区，验证桌宠渲染。
// 用法：node tools/cdp-shot.mjs <url> <out.png> [--click canvasX,canvasY] [--wait ms] [--size WxH]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME = process.env.FISH_CHROME || 'D:\\Chrome\\chrome.exe';
const [url, outArg, ...rest] = process.argv.slice(2);
if (!url || !outArg) {
  console.error('usage: node tools/cdp-shot.mjs <url> <out.png> [--click x,y] [--wait ms] [--size WxH]');
  process.exit(2);
}
const out = resolve(outArg);
const opts = { click: null, wait: 1600, width: 520, height: 660, eval: null, dumpCanvas: false, reload: false };
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a === '--click') {
    const [x, y] = String(rest[++i]).split(',').map(Number);
    opts.click = { x, y };
  } else if (a === '--wait') opts.wait = Number(rest[++i]);
  else if (a === '--eval') opts.eval = String(rest[++i]);
  else if (a === '--dump-canvas') opts.dumpCanvas = true;
  else if (a === '--reload') opts.reload = true;
  else if (a === '--size') {
    const [w, h] = String(rest[++i]).split('x').map(Number);
    opts.width = w;
    opts.height = h;
  }
}

const PORT = 9000 + Math.floor(Math.random() * 500);
const ud = mkdtempSync(join(tmpdir(), 'fish-cdp-'));
const child = spawn(CHROME, [
  `--app=${url}`,
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${ud}`,
  `--window-size=${opts.width},${opts.height}`,
  '--window-position=80,60',
  '--no-first-run',
  '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  // 窗口被挡住时 Chrome 会节流 rAF（画布就一直是空的）：
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
], { stdio: 'ignore' });

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchJson(path, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
      if (res.ok) return await res.json();
    } catch { /* 还没起来 */ }
    await sleep(200);
  }
  throw new Error('cdp-not-ready');
}

function connect(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const events = [];
    let id = 0;
    const send = (method, params) => new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params?.exceptionDetails;
        events.push(`[exception] ${d?.text || ''} ${d?.exception?.description || ''}`.trim());
      } else if (msg.method === 'Log.entryAdded') {
        const e = msg.params?.entry;
        if (e && (e.level === 'error' || e.level === 'warning')) events.push(`[log:${e.level}] ${e.text}`);
      } else if (msg.method === 'Network.responseReceived') {
        const r = msg.params?.response;
        if (r && r.status >= 400) events.push(`[http ${r.status}] ${r.url}`);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        events.push(`[console.error] ${(msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')}`);
      }
    });
    ws.addEventListener('open', () => res({ send, events, close: () => ws.close() }));
    ws.addEventListener('error', (e) => rej(e));
  });
}

async function main() {
  const list = await fetchJson('/json/list');
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no-page-target');
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  if (opts.reload) {
    await cdp.send('Page.reload', { ignoreCache: true });
    await sleep(600);
  }

  // 等 core.js / layered.js 把画布挂上
  let ready = false;
  for (let i = 0; i < 100; i++) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `!!document.querySelector('[data-fish-body-layered]') || !!document.querySelector('video')`,
      returnByValue: true,
    });
    if (r?.result?.value) { ready = true; break; }
    await sleep(200);
  }
  if (!ready) throw new Error('pet-not-mounted');
  await sleep(opts.wait);

  if (opts.click) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(function(){ try { var pt = window.__fishBodyRig ? window.__fishBodyRig.clientPoint(${opts.click.x}, ${opts.click.y}) : {x:${opts.click.x},y:${opts.click.y}}; return JSON.stringify(pt); } catch(e) { return 'ERR:'+e.message; } })()`,
      returnByValue: true,
    });
    const pt = JSON.parse(r.result.value);
    if (pt && typeof pt.x === 'number') {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', {
          type, x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
        });
        await sleep(60);
      }
      console.log('[shot] clicked', JSON.stringify(pt));
      await sleep(280);
    }
  }

  if (opts.eval) {
    const r = await cdp.send('Runtime.evaluate', { expression: opts.eval, returnByValue: true, awaitPromise: true });
    console.log('[eval]', JSON.stringify(r?.result?.value ?? r?.result ?? null));
  }

  if (opts.dumpCanvas) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(function(){var c=document.querySelector('[data-fish-body-layered]'); return c ? c.toDataURL('image/png') : '';})()`,
      returnByValue: true,
    });
    const data = String(r?.result?.value || '');
    if (data.startsWith('data:image/png;base64,')) {
      const file = out.replace(/\.png$/i, '') + '.canvas.png';
      writeFileSync(file, Buffer.from(data.slice('data:image/png;base64,'.length), 'base64'));
      console.log('[canvas]', file);
    } else {
      console.log('[canvas] no canvas');
    }
  }

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('[shot]', out);
  if (cdp.events.length) console.log('[console]', cdp.events.slice(0, 12).join('\n           '));
  cdp.close();
}

main().catch((e) => { console.error('[shot] FAILED:', e.message); process.exitCode = 1; })
  .finally(async () => {
    await sleep(300);
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 忽略 */ }
    setTimeout(() => process.exit(process.exitCode ?? 0), 600);
  });
