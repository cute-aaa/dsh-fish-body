// 真实 DSH Web 主机上的资源导入验收：通过页面同源 fetch 调插件路由。
// 源目录来自临时根；不接触真实数据根。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const token = process.env.LIVE_TOKEN;
const port = process.env.LIVE_PORT;
const source = process.env.LIVE_IMPORT_SOURCE;
if (!token || !port || !source) throw new Error('缺少 LIVE_* 环境变量');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
await page.goto(`http://127.0.0.1:${port}/?token=${token}`, {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
});
await page.waitForTimeout(3500);
await page.keyboard.press('Escape');

const result = await page.evaluate(async (sourceDir) => {
  const post = async (body) => {
    const response = await fetch('/dsh-pet-7340/assets/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const skin = await post({
    kind: 'skin',
    renderer: 'layered',
    sourcePath: sourceDir + '\\layered\\demo-skin',
  });
  const sound = await post({ kind: 'sfx', target: 'shared', sourcePath: sourceDir + '\\click.wav' });
  const fish = await post({ kind: 'session-fish', sourcePath: sourceDir + '\\fish.png' });
  const resources = await fetch('/dsh-pet-7340/skin/main/resources').then((response) => response.json());
  return { skin, sound, fish, resources };
}, source);

assert.equal(result.skin.body.ok, true, JSON.stringify(result.skin));
assert.equal(result.sound.body.ok, true, JSON.stringify(result.sound));
assert.equal(result.fish.body.ok, true, JSON.stringify(result.fish));
assert.ok(
  result.resources.renderers.layered.available.some((item) => item.id === 'demo-skin'),
  '导入的 layered 皮肤必须出现在真实资源清单里',
);
console.log('LIVE_ASSETS_ACCEPTANCE_OK');
await browser.close();
