// 开发用：验证 lib/desktop.js 的三级窗口落地（会短暂打开一个真实窗口）。
// 用法：node tools/desktop-probe.mjs [url]
import * as desktop from '../lib/desktop.js';

const url = process.argv[2] || 'http://127.0.0.1:3199/?model=layered&skin=feiyu-05&size=320';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('[probe] electron =', desktop.resolveElectron());
console.log('[probe] chromium =', desktop.resolveChromium());
console.log('[probe] windowSize =', desktop.windowSizeFor(320, 1));
console.log('[probe] status(before) =', JSON.stringify(desktop.status()));

const launched = await desktop.launchStandalone(url, { size: 320, scale: 1 });
console.log('[probe] launched =', JSON.stringify(launched));

await sleep(3500);
const running = desktop.status();
console.log('[probe] status(after) =', JSON.stringify(running));

const again = await desktop.launchStandalone(url, { size: 320, scale: 1 });
console.log('[probe] relaunch(reuse) =', JSON.stringify(again));

const stopped = desktop.stopStandalone();
console.log('[probe] stopped =', JSON.stringify(stopped));

await sleep(1200);
console.log('[probe] status(end) =', JSON.stringify(desktop.status()));
process.exit(0);
