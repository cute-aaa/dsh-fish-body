// Real React + Chromium; API fixtures never touch the user's DSH configuration.
// First run: pnpm exec playwright install chromium
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { rolldown } from 'rolldown';

const pet = {
  id: 'pet-1',
  name: 'Blue',
  size: 240,
  display: 'web',
  position: { corner: 'top-right', marginX: 20, marginY: 20 },
};
const defaults = {
  main: {
    pets: [pet],
    notificationsEnabled: true,
    whisperImageEnabled: false,
    chatImageEnabled: false,
    confineToScreen: false,
    trayEnabled: true,
    physics: {
      gravity: 2400,
      restitution: 0.6,
      groundFriction: 4,
      throwPower: 1,
      ceilingBounce: false,
      petCollision: false,
    },
    whisperModel: { provider: '', model: '' },
    chatModel: { provider: '', model: '' },
    chatMemoryRounds: 5,
    chatImageLimit: 10,
  },
};
const customized = {
  main: {
    ...defaults.main,
    notificationsEnabled: false,
    whisperImageEnabled: true,
    chatImageEnabled: true,
    confineToScreen: true,
    chatMemoryRounds: 19,
    chatImageLimit: 2,
    whisperModel: { provider: 'test', model: 'model' },
    chatModel: { provider: 'test', model: 'model' },
    physics: { ...defaults.main.physics, gravity: 1200, throwPower: 2, ceilingBounce: true, petCollision: true },
  },
};
/** 会话鱼设置（独立文件 session-fish.json）：并入本页后仍走自己的端点。 */
const fishSettings = {
  enabled: true,
  sizePx: 96,
  maxCount: 6,
  bubbleMs: 12000,
  skin: '',
  followPet: true,
  speakEnabled: true,
  speakProgress: true,
  speakTurnEnd: true,
  speakWaiting: true,
  progressGapMs: 15000,
};
const SAVED = 'Saved — the pets updated instantly.';
/** 提交体会带上内部标记 ssetRoot（条目归属），比对用户字段时要先摘掉。 */
const userPets = (pets) => pets.map(({ assetRoot, ...rest }) => rest);

/** 只断言夹具里写明的那些键：成品还会补内部默认值（如物理的三个手机关开），不该逐字相等。 */
function assertSubset(actual, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      assertSubset(actual[key], value, label + '.' + key);
      continue;
    }
    assert.deepEqual(actual[key], value, (label ? label + '.' : '') + key);
  }
}

let browser, server, url;
before(async () => {
  const bundle = await rolldown({
    input: fileURLToPath(new URL('./settings.fixture.js', import.meta.url)),
    platform: 'browser',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  });
  const { output } = await bundle.generate({ format: 'iife' });
  await bundle.close();
  server = createServer((req, res) => {
    if (req.url === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(output[0].code);
      return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(
      `<html><head><style>:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;--dsw-alias-label-primary:#202020;--dsw-alias-label-secondary:#444;--dsw-alias-label-tertiary:#666;--dsw-alias-border-l1:#ccc;--dsw-alias-border-l2:#bbb;--dsw-alias-state-business-primary:#245eea;--dsw-alias-button-info-fill:#245eea;--dsw-alias-button-info-hover:#1c4bd0;--dsw-alias-interactive-bg-hover:#eee;--dsw-alias-interactive-bg-active:#e5ecff;--dsw-alias-state-error-primary:#c22;--dsw-alias-state-success-primary:#2a7}body{margin:16px;font-family:sans-serif}</style></head><body><div id="root"></div><script>window.initialConfig=${JSON.stringify(defaults)};</script><script src="/fixture.js"></script></body></html>`,
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

/** 会话鱼写入的回执：把 patch 合并进当前设置，模拟宿主的权威回包。 */
const echoFish = (route) => {
  const patch = route.request().postDataJSON() ?? {};
  return route.fulfill({ json: { ok: true, settings: { ...fishSettings, ...patch } } });
};

async function open(
  t,
  {
    get = customized,
    put,
    post,
    fishPut,
    viewport = { width: 900, height: 900 },
    lang = 'en',
    reducedMotion,
    // 语音实现清单：给了就让「声音」分区出现对应的接入卡（默认走兜底 JSON，没有 provider）。
    voiceProviders = null,
  } = {},
) {
  const context = await browser.newContext(reducedMotion ? { reducedMotion, viewport } : { viewport });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const writes = [],
    fishWrites = [],
    restarts = [],
    restores = [],
    runtimePosts = [],
    movePosts = [],
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  // 搬迁的桩：默认「没搬过」；用例可以把它改成在搬 / 已搬完。
  let pickPath = '/test/moved-skin';
  let moveStatus = () => ({
    busy: false,
    phase: 'copying',
    copiedBytes: 0,
    totalBytes: 0,
    copiedFiles: 0,
    totalFiles: 0,
    current: '',
    needsRestart: false,
    root: '/test/fish-body',
    skin: '/test/fish-body/skin',
  });
  await page.route('**/dsh-pet-7340/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/dsh-pet-7340/config') {
      if (request.method() === 'PUT') {
        writes.push(request.postDataJSON());
        if (put) return put(route);
        return route.fulfill({ json: customized });
      }
      if (request.method() === 'POST') return post ? post(route) : route.fulfill({ json: defaults });
      if (typeof get === 'function') return get(route);
      return route.fulfill({ json: get });
    }
    if (path === '/dsh-pet-7340/config/meta') {
      // 与 host 的 GET /config/meta 同形：root + 目录树 + 只读参考 + 运行时状态。
      return route.fulfill({
        json: {
          root: '/test/fish-body',
          rootSource: 'default',
          skin: '/test/fish-body/skin',
          layout: [
            {
              key: 'root',
              rel: 'fish-body/',
              name: 'fish-body',
              path: '/test/fish-body',
              kind: 'dir',
              depth: 0,
              exists: true,
              open: 'root',
            },
            {
              key: 'config',
              rel: 'config',
              name: 'config',
              path: '/test/fish-body/config',
              kind: 'dir',
              depth: 1,
              exists: true,
              open: 'config',
            },
            {
              key: 'data',
              rel: 'data',
              name: 'data',
              path: '/test/fish-body/data',
              kind: 'dir',
              depth: 1,
              exists: true,
              open: 'data',
            },
            {
              key: 'cache',
              rel: 'cache',
              name: 'cache',
              path: '/test/fish-body/cache',
              kind: 'dir',
              depth: 1,
              exists: true,
              open: 'cache',
            },
            {
              key: 'skin',
              rel: 'skin',
              name: 'skin',
              path: '/test/fish-body/skin',
              kind: 'dir',
              depth: 1,
              exists: true,
              open: 'skin-root',
            },
            {
              key: 'assets',
              rel: 'assets',
              name: 'assets',
              path: '/test/fish-body/assets',
              kind: 'dir',
              depth: 1,
              exists: true,
              open: 'assets',
            },
            {
              key: 'logs',
              rel: 'logs.txt',
              name: 'logs.txt',
              path: '/test/fish-body/logs.txt',
              kind: 'file',
              depth: 1,
              exists: true,
            },
          ],
          readonly: [
            {
              key: 'pkg.config',
              rel: '/test/assets/config.jsonc',
              name: 'config.jsonc',
              path: '/test/assets/config.jsonc',
              kind: 'pkg',
              depth: 0,
              exists: true,
            },
          ],
          runtime: {
            dir: '/test/fish-body/runtime/electron',
            exe: '/test/fish-body/runtime/electron/electron.exe',
            installed: false,
          },
          profile: 'fish',
          user: '/test/fish-body/config/main-config.jsonc',
          default: '/test/assets/config.jsonc',
          animations: '/test/fish-body/assets/animation',
        },
      });
    }
    if (path === '/dsh-pet-7340/desktop/runtime') {
      if (request.method() === 'POST') {
        runtimePosts.push(request.postDataJSON());
        return route.fulfill({
          json: {
            started: true,
            installed: false,
            runtime: { dir: '/test/fish-body/runtime/electron', exe: '', installed: false, source: 'default' },
            download: {
              active: true,
              doneBytes: 1024,
              totalBytes: 4096,
              mirror: 'https://cdn.npmmirror.com/binaries/electron/',
            },
            prompt: { needed: true, reason: 'missing', since: 1 },
            wanted: true,
          },
        });
      }
      return route.fulfill({
        json: {
          runtime: { dir: '/test/fish-body/runtime/electron', exe: '', installed: false, source: 'default' },
          download: { active: false, doneBytes: 0, totalBytes: 0 },
          prompt: { needed: false },
          wanted: true,
        },
      });
    }
    if (path === '/dsh-pet-7340/layout/location') {
      if (request.method() === 'POST') {
        movePosts.push(request.postDataJSON());
        return route.fulfill({ json: { ok: true, started: true, busy: true, phase: 'copying', needsRestart: false } });
      }
      return route.fulfill({ json: moveStatus() });
    }
    if (path === '/dsh-pet-7340/layout/size') {
      const which = new URL(request.url()).searchParams.get('which');
      return route.fulfill({ json: { ok: true, which, path: '/test/fish-body/' + which, files: 2, bytes: 4194304 } });
    }
    if (path === '/dsh-pet-7340/pick-folder') {
      return route.fulfill({ json: { ok: true, path: pickPath } });
    }
    if (path === '/dsh-pet-7340/session-fish') {
      if (request.method() === 'PUT') {
        fishWrites.push(request.postDataJSON());
        return fishPut ? fishPut(route) : echoFish(route);
      }
      return route.fulfill({ json: { settings: fishSettings } });
    }
    if (path === '/dsh-pet-7340/session-fish/skins') return route.fulfill({ json: { items: [] } });
    if (path === '/dsh-pet-7340/settings-backup') {
      if (request.method() === 'POST') {
        restores.push(request.postDataJSON());
        return route.fulfill({ json: { ok: true, merged: customized, settings: fishSettings } });
      }
      return route.fulfill({
        json: {
          kind: 'dsh-pet/settings-backup',
          version: 1,
          createdAt: '2026-11-14T03:00:00.000Z',
          pluginVersion: '0.4.7',
          files: { main: '{ "pets": [] }', sessionFish: JSON.stringify(fishSettings), pets: {} },
        },
      });
    }
    if (path === '/dsh-pet-7340/plugin-restart') {
      restarts.push(request.method());
      // helper 模式：不触发页面刷新，测试才看得到后续断言。
      return route.fulfill({ json: { ok: true, mode: 'helper' } });
    }
    if (path === '/dsh-pet-7340/voice/voices' && voiceProviders !== null) {
      return route.fulfill({ json: { ok: true, voices: [], providers: voiceProviders } });
    }
    return route.fulfill({
      json: { providers: [{ id: 'test', name: 'Test', models: [{ id: 'model', name: 'Model' }] }] },
    });
  });
  await page.goto(`${url}/?lang=${lang}`);
  await page.locator('.dsh-pet-cfg').waitFor();
  return {
    page,
    writes,
    fishWrites,
    restarts,
    restores,
    runtimePosts,
    movePosts,
    setPickPath: (value) => {
      pickPath = value;
    },
    setMoveStatus: (fn) => {
      moveStatus = fn;
    },
  };
}

/** 点「应用」并等到「已保存」出现（两段写入都完成了）。 */
async function apply(page) {
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByText(SAVED, { exact: true }).first().waitFor();
}

const tab = (page, name) => page.getByRole('tab', { name: new RegExp('^' + name) });

test('config save errors: write failures keep edits visible and allow a retry', async (t) => {
  let attempts = 0;
  const { page, writes } = await open(t, {
    put: (route) =>
      ++attempts === 1
        ? route.fulfill({ status: 500, json: { error: 'failed to save config' } })
        : route.fulfill({ json: customized }),
  });
  const size = page.locator('input[type="number"]').first();
  await page.getByRole('button', { name: 'Apply', exact: true }).waitFor({ state: 'visible' });
  await size.fill('320');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page
    .getByText(
      'Failed to save config. Check the server connection, configuration directory write permissions and server log.',
      { exact: true },
    )
    .first()
    .waitFor();
  assert.equal(await page.getByText('Failed to load config', { exact: true }).count(), 0);
  assert.equal(await size.inputValue(), '320');
  await apply(page);
  assert.equal(writes[1].pets[0].size, 320);
});

test('config save errors: validation failures explain the rejected configuration', async (t) => {
  const { page } = await open(t, {
    // 业务失败是 200 + ok:false（与宿主一致）：只有这种形态才走「配置无效」文案。
    put: (route) => route.fulfill({ status: 200, json: { ok: false, reason: 'bad-request' } }),
  });
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page
    .getByText('Failed to save config: invalid configuration. Check the values and try again.', { exact: true })
    .first()
    .waitFor();
});

test('config save errors: network failures display a save error and release the buttons', async (t) => {
  const { page } = await open(t, { put: (route) => route.abort('failed') });
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page
    .getByText(
      'Failed to save config. Check the server connection, configuration directory write permissions and server log.',
      { exact: true },
    )
    .first()
    .waitFor();
  assert.equal(await page.getByRole('button', { name: 'Apply', exact: true }).isEnabled(), true);
});

test('reset failures use the reset message', async (t) => {
  const { page } = await open(t, { post: (route) => route.fulfill({ status: 500, json: { error: 'write failed' } }) });
  await tab(page, 'System').click();
  await page.getByRole('button', { name: 'Reset settings', exact: true }).first().click();
  await page.getByRole('button', { name: 'Reset settings', exact: true }).last().click();
  await page
    .getByText('Reset failed. Check the server connection and write permissions for the configuration directory.', {
      exact: true,
    })
    .first()
    .waitFor();
});

test('pending config prevents editing and saving placeholder defaults', async (t) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const { page, writes } = await open(t, {
    get: async (route) => {
      await pending;
      await route.fulfill({ json: customized });
    },
  });
  try {
    assert.equal(await page.getByRole('button', { name: 'Apply', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'OK', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('input[type=text]').first().isDisabled(), true);
    assert.deepEqual(writes, []);
  } finally {
    release();
  }
});

for (const failure of ['http', 'network', 'malformed', 'null']) {
  test(`failed config (${failure}) is visible, blocks Apply and can be retried`, async (t) => {
    let fail = true;
    const { page, writes } = await open(t, {
      get: (route) =>
        !fail
          ? route.fulfill({ json: customized })
          : failure === 'network'
            ? route.abort()
            : route.fulfill(
                failure === 'http' ? { status: 503, body: 'unavailable' } : { json: failure === 'null' ? null : {} },
              ),
    });
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Apply', exact: true }).isDisabled(), true);
    assert.deepEqual(writes, []);
    fail = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await apply(page);
    assert.equal(writes.length, 1);
    assertSubset({ ...writes[0], pets: userPets(writes[0].pets) }, customized.main, '');
  });
}

test('Reset writes the built-in defaults and refreshes every control', async (t) => {
  const { page, writes, fishWrites } = await open(t);
  await apply(page);
  assert.equal(writes[0].chatMemoryRounds, 19);
  await tab(page, 'System').click();
  await page.getByRole('button', { name: 'Reset settings', exact: true }).first().click();
  await page.getByRole('button', { name: 'Reset settings', exact: true }).last().click();
  await page.getByText('Reset to the built-in defaults.', { exact: true }).first().waitFor();
  assert.equal(writes.length, 1, '重置走 POST /config，不产生 PUT');
  assert.equal(fishWrites.length, 2, '一次来自上面的应用，一次来自重置');
  assert.equal(fishWrites.at(-1).sizePx, 96, '重置会写会话鱼默认值');
  await apply(page);
  assertSubset({ ...writes[1], pets: userPets(writes[1].pets) }, defaults.main, '');
});

test('fresh config refreshes the pet list instead of saving an old bridge snapshot', async (t) => {
  const fresh = { main: { ...customized.main, pets: [{ ...pet, name: 'Updated elsewhere', size: 360 }] } };
  const { page, writes } = await open(t, { get: fresh });
  await apply(page);
  assert.deepEqual(userPets(writes[0].pets), fresh.main.pets);
});

test('bottom bar: sticky while the page scrolls, with discard / cancel / apply / OK', async (t) => {
  const { page } = await open(t, { viewport: { width: 900, height: 520 } });
  const bar = page.locator('.dsh-pet-cfg__bar');
  await bar.waitFor();
  const names = await bar.getByRole('button').allTextContents();
  assert.deepEqual(names, ['Discard changes', 'Cancel', 'Apply', 'OK']);

  await page.evaluate(() => window.scrollTo(0, 0));
  const top = await bar.boundingBox();
  assert.ok(top.y + top.height <= 520 + 1, '贴底常显：滚动到顶部时仍在视口内');

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const bottom = await bar.boundingBox();
  assert.ok(bottom.y + bottom.height <= 520 + 1, '滚到底部时也在视口内');
});

test('OK writes both files and closes the settings page', async (t) => {
  const { page, writes, fishWrites } = await open(t);
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.getByText(SAVED, { exact: true }).first().waitFor();
  assert.equal(writes.length, 1);
  assert.equal(fishWrites.length, 1);
  assert.equal(await page.evaluate(() => window.__closed), 1);
});

test('Cancel closes without writing anything', async (t) => {
  const { page, writes, fishWrites, restarts } = await open(t);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__closed), 1);
  assert.deepEqual(writes, []);
  assert.deepEqual(fishWrites, []);
  assert.deepEqual(restarts, []);
});

test('Apply writes both files without closing', async (t) => {
  const { page, writes, fishWrites } = await open(t);
  await apply(page);
  assert.equal(writes.length, 1);
  assert.equal(fishWrites.length, 1);
  assert.equal(await page.evaluate(() => window.__closed), 0);
});

test('Restart saves first, then asks the host to recompose', async (t) => {
  const { page, writes, fishWrites, restarts } = await open(t);
  await tab(page, 'System').click();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await page.getByText(/HMR is unavailable/, { exact: false }).waitFor();
  assert.equal(writes.length, 1, '重启前要先保存');
  assert.equal(fishWrites.length, 1);
  assert.deepEqual(restarts, ['POST']);
});

test('unsaved dots: the changed row and its tab light up, Apply clears them', async (t) => {
  const { page } = await open(t);
  assert.equal(await page.locator('.dsh-pet-cfg__dot').count(), 0, '刚加载完不该有圆点');

  await tab(page, 'System').click();
  await page.getByRole('checkbox', { name: 'System tray' }).click();
  await page.locator('.dsh-pet-cfg__dot').first().waitFor();
  assert.equal((await page.locator('.dsh-pet-cfg__panel .dsh-pet-cfg__dot').count()) >= 1, true, '设置项上要有圆点');
  assert.equal(await tab(page, 'System').locator('.dsh-pet-cfg__dot').count(), 1, '标签页上也要有圆点');

  await apply(page);
  assert.equal(await page.locator('.dsh-pet-cfg__dot').count(), 0, '保存后圆点应消失');
});

test('session fish tab writes its own file with the edited size', async (t) => {
  const { page, fishWrites } = await open(t);
  await tab(page, 'Session fish').click();
  const size = page.locator('.dsh-pet-cfg__panel input[type="number"]').first();
  await size.fill('128');
  await size.blur();
  await apply(page);
  assert.equal(fishWrites.length, 1);
  assert.equal(fishWrites[0].sizePx, 128);
});

test('all six sections are reachable and render content', async (t) => {
  const { page } = await open(t);
  for (const name of ['Pet', 'Look & feel', 'Sound', 'Chat', 'Session fish', 'System']) {
    await tab(page, name).click();
    const panel = page.locator('.dsh-pet-cfg__panel');
    await panel.waitFor();
    assert.ok((await panel.locator('> *').count()) > 0, `${name} 分区应该有内容`);
  }
});

test('switch knob sits on the far side of the track when checked (reduced motion included)', async (t) => {
  // 圆点靠 transform 站在蓝区右侧；降级块曾经一刀切写死 `transform:none`，
  // 于是「开」和「关」在开了「减少动画」的系统上长得一模一样。这条用例把两种动效偏好都钉住。
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const { page } = await open(t, { reducedMotion });
    const box = page.locator('.dsh-pet-cfg__switch').first();
    const knobLeft = () =>
      box.evaluate((el) => {
        const track = el.querySelector('.dsh-pet-cfg__swTrack').getBoundingClientRect();
        const knob = el.querySelector('.dsh-pet-cfg__swKnob').getBoundingClientRect();
        return Math.round(knob.left - track.left);
      });
    const before = await knobLeft();
    await box.locator('label').click();
    await page.waitForTimeout(150);
    const after = await knobLeft();
    assert.ok(
      Math.abs(after - before) >= 10,
      `切换一次，圆点要换到另一侧（${reducedMotion}: ${before}px → ${after}px）`,
    );
  }
});

test('a slot keeps its source and its preview when the switch is turned off', async (t) => {
  // 开关说的是「运行时响不响」，试听问的是「有没有文件」——两者不该互相牵连。
  const { page } = await open(t);
  await tab(page, 'Sound').click();
  const row = page.locator('.dsh-pet-cfg__row').first();
  const preview = row.locator('.dsh-pet-cfg__btn.is-text');
  assert.equal(await preview.isEnabled(), true, '开关开着时能试听');
  await row.locator('.dsh-pet-cfg__switch>label').click();
  await page.waitForTimeout(150);
  assert.equal(await row.locator('input[type=checkbox]').isChecked(), false, '开关确实关掉了');
  assert.equal(await preview.isEnabled(), true, '关掉开关不该收走试听');
  assert.doesNotMatch(String(await row.locator('.dsh-pet-cfg__badge').textContent()), /unmatched/i);
});
test('a changed item marks itself, not just its card', async (t) => {
  // 卡头那颗点只说「这块改过」；改到哪个开关还得自己找。改动项自己的标签后要跟一颗点并升一档字重。
  const { page } = await open(t);
  // 系统分区第一格是「系统通知」：夹具里它的基线值有定义，改动才会算未保存。
  await tab(page, 'System').click();
  const cell = page.locator('.dsh-pet-cfg__switch').first();
  assert.equal(await cell.locator('.dsh-pet-cfg__dot').count(), 0, '改之前不该有圆点');
  await cell.locator('label').click();
  await page.waitForTimeout(150);
  assert.match(String(await cell.getAttribute('class')), /is-dirty/);
  assert.equal(await cell.locator('.dsh-pet-cfg__dot').count(), 1, '改动项自己要有圆点');
  const weight = await cell.locator('.dsh-pet-cfg__swText').evaluate((el) => getComputedStyle(el).fontWeight);
  assert.equal(weight, '500', '改动项的标签要升一档字重');
});

for (const lang of ['en', 'zh']) {
  for (const width of [360, 520, 900]) {
    test(`settings keep controls and toggle labels readable (${lang}, ${width}px)`, async (t) => {
      const { page } = await open(t, { viewport: { width, height: 800 }, lang });
      const clipped = await page
        .locator('.dsh-pet-cfg__swText')
        .evaluateAll((labels) =>
          labels.filter((label) => label.scrollWidth > label.clientWidth).map((label) => label.textContent),
        );
      assert.deepEqual(clipped, []);
      if (process.env.DSH_PET_UI_ARTIFACTS) {
        mkdirSync(process.env.DSH_PET_UI_ARTIFACTS, { recursive: true });
        await page.screenshot({
          path: join(process.env.DSH_PET_UI_ARTIFACTS, 'settings-' + lang + '-' + width + '.png'),
          fullPage: true,
          animations: 'disabled',
        });
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    });
  }
}

test('model picker remains anchored while the responsive settings panel is scrolled', async (t) => {
  const { page } = await open(t, { viewport: { width: 900, height: 700 } });
  await tab(page, 'Chat').click();
  const trigger = page.locator('.dsh-pet-mp__trigger').first();
  await trigger.click();
  const panel = page.getByRole('menu');
  await panel.waitFor();
  for (const scrollY of [0, 120]) {
    await page.evaluate((y) => window.scrollTo(0, y), scrollY);
    await page.waitForFunction(() => {
      const trigger = document.querySelector('.dsh-pet-mp__trigger').getBoundingClientRect();
      const panel = document.querySelector('.dsh-pet-mp__panel').getBoundingClientRect();
      return Math.abs(panel.left - trigger.left) < 2 && panel.top >= 0 && panel.bottom <= innerHeight;
    });
  }
  await page.getByRole('menuitemradio', { name: 'Follow current conversation' }).click();
  await apply(page);
});

test('each section is reachable and screenshots are stable', async (t) => {
  const { page } = await open(t, { viewport: { width: 900, height: 900 }, lang: 'zh' });
  for (const [name, file] of [
    ['桌宠', 'pet'],
    ['外观与手感', 'feel'],
    ['声音', 'audio'],
    ['对话', 'chat'],
    ['会话鱼', 'fish'],
    ['系统', 'system'],
  ]) {
    await tab(page, name).click();
    // 等 React 把新面板提交进 DOM（面板 id 跟随分区 id）：只等底部栏不够，它上一页也在。
    await page.waitForFunction(
      (label) => document.querySelector('.dsh-pet-cfg__segItem.is-active')?.textContent?.startsWith(label) === true,
      name,
    );
    await page.locator('.dsh-pet-cfg__bar').waitFor();
    if (process.env.DSH_PET_UI_ARTIFACTS) {
      mkdirSync(process.env.DSH_PET_UI_ARTIFACTS, { recursive: true });
      await page.screenshot({
        path: join(process.env.DSH_PET_UI_ARTIFACTS, 'tab-' + file + '.png'),
        fullPage: true,
        // 入场动画是 160ms 的透明度位移：截图时快进到终态，否则会拍到半透明的一帧。
        animations: 'disabled',
      });
    }
  }
});

test('backup: export downloads a snapshot and restore only posts after confirmation', async (t) => {
  const { page, restores } = await open(t);
  await tab(page, 'System').click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export backup', exact: true }).click(),
  ]);
  assert.match(download.suggestedFilename(), /^dsh-pet-settings-\d{8}-\d{4}\.json$/);
  await page.getByText('Backup exported.', { exact: true }).first().waitFor();

  const snapshot = {
    kind: 'dsh-pet/settings-backup',
    version: 1,
    createdAt: '2026-11-14T03:00:00.000Z',
    pluginVersion: '0.4.7',
    files: { main: '{ "pets": [] }', sessionFish: '{"enabled":true}', pets: {} },
  };
  await page.locator('input[type=file][accept*=".json"]').setInputFiles({
    name: 'mine.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(snapshot), 'utf8'),
  });
  // 选完文件只弹确认，不上传。
  await page.getByText(/Overwrite the current settings with/, { exact: false }).waitFor();
  assert.equal(restores.length, 0);

  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByText('Restored from backup; settings are live.', { exact: true }).first().waitFor();
  assert.equal(restores.length, 1);
  assert.equal(restores[0].kind, 'dsh-pet/settings-backup');
  assert.equal(restores[0].files.pets ? Object.keys(restores[0].files.pets).length : -1, 0);
});

test('backup: an unrelated JSON file is refused before any upload', async (t) => {
  const { page, restores } = await open(t);
  await tab(page, 'System').click();
  await page.locator('input[type=file][accept*=".json"]').setInputFiles({
    name: 'random.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8'),
  });
  await page.getByText('This file is not a settings backup for this plugin.', { exact: true }).first().waitFor();
  assert.equal(restores.length, 0);
});

test('system → files & folders: one card holding the data-root tree, runtime state and uninstall', async (t) => {
  // 视口拉高：卡片展开后是一棵树 + 运行时 + 卸载，900 高只看得见卡头。
  const { page } = await open(t, { viewport: { width: 900, height: 1600 } });
  await tab(page, 'System').click();
  const fold = page.getByRole('button', { name: /Files & folders/ });
  await fold.waitFor();
  await fold.click();
  // 树行 = 7 条布局节点 + 1 条包内只读参考；同一路径不该画两遍。
  await page.locator('.dsh-pet-cfg__treeRow').first().waitFor();
  assert.equal(await page.locator('.dsh-pet-cfg__treeRow').count(), 8);
  // 徽标只剩「只读」（不再有「可删」）；目录名带尾斜杠，文件名不带。
  const badges = await page.locator('.dsh-pet-cfg__treeBadge').allInnerTexts();
  assert.deepEqual(badges, ['read-only']);
  const names = await page.locator('.dsh-pet-cfg__treeName').allInnerTexts();
  assert.ok(names.includes('config/'), 'arr: ' + names.join(','));
  assert.ok(names.includes('logs.txt'));
  // 每一行后面跟着一句「这个目录存什么」。
  const descs = await page.locator('.dsh-pet-cfg__treeDesc').allInnerTexts();
  assert.ok(
    descs.some((text) => /settings|config/i.test(text)),
    'desc: ' + descs.join(' | '),
  );
  assert.equal(
    descs.some((text) => /delet|remov/i.test(text)),
    false,
    '说明里不该出现「可删」类断言',
  );
  // 数据根与皮肤目录各有一行，且都能改位置。
  assert.equal(await page.getByRole('button', { name: 'Change location…', exact: true }).count(), 2);
  // 运行时：未安装时按钮可点，文案给出状态。
  assert.equal(await page.getByText('Not installed', { exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Download runtime', exact: true }).isEnabled(), true);
  // 卸载命令用 meta 的 profile 名。
  await page.getByText('dsh plugin --profile fish remove dsh-fish-body', { exact: false }).waitFor();
  if (process.env.DSH_PET_UI_ARTIFACTS) {
    mkdirSync(process.env.DSH_PET_UI_ARTIFACTS, { recursive: true });
    // 等折叠动画（160ms）走完再截图，否则拍到的是收到一半的卡片。
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(process.env.DSH_PET_UI_ARTIFACTS, 'system-files-open.png') });
  }
});

test('system → files & folders: move the skin folder, see progress, then get a restart prompt', async (t) => {
  const harness = await open(t, { viewport: { width: 900, height: 1600 } });
  const { page } = harness;
  harness.setPickPath('/test/moved-skin');
  // 第一次 GET 说「还在搬」，之后说「搬完了，需要重启」。
  let polls = 0;
  harness.setMoveStatus(() => {
    polls += 1;
    return polls < 2
      ? {
          busy: true,
          which: 'skin',
          phase: 'copying',
          copiedBytes: 2048,
          totalBytes: 4096,
          copiedFiles: 1,
          totalFiles: 2,
          current: 'cat-config.json',
          needsRestart: false,
          root: '/test/fish-body',
          skin: '/test/fish-body/skin',
        }
      : {
          busy: false,
          which: 'skin',
          phase: 'cleaning',
          copiedBytes: 4096,
          totalBytes: 4096,
          copiedFiles: 2,
          totalFiles: 2,
          current: '',
          needsRestart: true,
          movedTo: '/test/moved-skin',
          root: '/test/fish-body',
          skin: '/test/fish-body/skin',
        };
  });

  await tab(page, 'System').click();
  const fold = page.getByRole('button', { name: /Files & folders/ });
  await fold.waitFor();
  await fold.click();

  // 皮肤那一行的「更改位置…」（两行里的第二个）。
  await page.getByRole('button', { name: 'Change location…', exact: true }).nth(1).click();
  // 第一步是说明：先把「会整体迁移、旧位置会被移除」和「当前有多少东西」讲清楚。
  await page.getByText('Where should “Skin folder” go?', { exact: true }).waitFor();
  await page.getByText('2 files · 4.0 MB', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Choose a new location…', exact: true }).click();
  // 第二步是确认弹窗：旧位置与新位置并排摆出来。
  const dialog = page.getByRole('dialog', { name: 'Migrate to a new location' });
  await dialog.waitFor();
  assert.equal(await dialog.getByText('From: /test/fish-body/skin', { exact: true }).count(), 1);
  assert.equal(await dialog.getByText('To: /test/moved-skin', { exact: true }).count(), 1);
  await dialog.getByRole('button', { name: 'Start migrating', exact: true }).click();

  // 请求体带的是 which=skin 与选中的绝对路径。
  assert.deepEqual(await page.evaluate(() => null), null);
  await page.getByText(/Moved to \/test\/moved-skin/).waitFor();
  assert.deepEqual(harness.movePosts, [{ which: 'skin', path: '/test/moved-skin' }]);
  // 结论行给出「重启插件后生效」+ 一个立即重启按钮。
  assert.equal(await page.getByText('Takes effect after a plugin restart', { exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Restart now', exact: true }).click();
  await page.waitForFunction(() => true);
  assert.ok(harness.restarts.length >= 1, '重启按钮应当真的打了 /plugin-restart');
});

test('system → shortcuts: rebind a hover key, then save writes it into hotkeys', async (t) => {
  const { page, writes } = await open(t, { viewport: { width: 900, height: 1600 } });
  await tab(page, 'System').click();
  const fold = page.getByRole('button', { name: /Shortcuts/ });
  await fold.waitFor();
  await fold.click();

  // 对话那一行的键帽：出厂是 L。
  const keycap = page.getByRole('button', { name: /^Open chat：L 键$/ });
  await keycap.waitFor();
  await keycap.click();
  // 捕获态：键帽文字换成「按一个键…」。
  await page
    .getByRole('button', { name: /^Open chat：L 键$/ })
    .getByText('Press a key…')
    .waitFor();
  await page.keyboard.press('k');
  // 改绑后键帽显示新键。
  await page.getByRole('button', { name: /^Open chat：K 键$/ }).waitFor();

  await apply(page);
  const body = writes.at(-1);
  assert.equal(body.hotkeys.chat, 'k', '改绑要随保存写进 hotkeys');
  assert.equal(body.hotkeys.sleep, 'z', '没改的键照旧带出去');
  assert.equal(Object.keys(body.hotkeys).length, 9, '九个键整段写，不留半份');
});

test('system → shortcuts: giving a key that is already taken swaps the two', async (t) => {
  const { page } = await open(t, { viewport: { width: 900, height: 1600 } });
  await tab(page, 'System').click();
  const fold = page.getByRole('button', { name: /Shortcuts/ });
  await fold.waitFor();
  await fold.click();

  // 把 Z（睡觉）给了对话：睡觉那一行应当拿到对话原来的 L。
  await page.getByRole('button', { name: /^Open chat：L 键$/ }).click();
  await page.keyboard.press('z');
  await page.getByRole('button', { name: /^Open chat：Z 键$/ }).waitFor();
  await page.getByRole('button', { name: /^Sleep \/ wake：L 键$/ }).waitFor();
});

test('system → shortcuts: Escape cancels the capture without changing anything', async (t) => {
  const { page } = await open(t, { viewport: { width: 900, height: 1600 } });
  await tab(page, 'System').click();
  const fold = page.getByRole('button', { name: /Shortcuts/ });
  await fold.waitFor();
  await fold.click();

  await page.getByRole('button', { name: /^Todo list：D 键$/ }).click();
  await page.getByText('Press a key…', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Todo list：D 键$/ }).waitFor();
});

/** 云端 TTS 骨架（T3.5）的 provider 形状：只有声明式 fields，没有音色可切。 */
const cloudProvider = {
  id: 'cloud',
  name: '云端语音（骨架）',
  builtin: false,
  available: false,
  reason: '未配置云端语音：还缺 服务地址 / 模型',
  voices: [],
  voice: '',
  fields: [
    { key: 'baseURL', label: '服务地址', kind: 'text', required: true },
    { key: 'model', label: '模型', kind: 'text', required: true },
    { key: 'apiKey', label: 'API Key', kind: 'password', required: true, placeholder: 'sk-…' },
  ],
};

test('audio → 每个语音实现一张接入卡：云端骨架按 fields 生成，密钥是 password 输入', async (t) => {
  const { page } = await open(t, {
    voiceProviders: [cloudProvider],
    viewport: { width: 900, height: 1800 },
  });
  await tab(page, 'Sound').click();
  await page.getByText('Voice connection', { exact: true }).waitFor();
  await page.getByText('云端语音（骨架）', { exact: true }).waitFor();
  // 密钥字段是 password，且带「清除」按钮的容器（未配置时按钮不出现）
  assert.equal(await page.locator('.dsh-pet-cfg__card input[type="password"]').count(), 1);
  await page.getByPlaceholder('sk-…').waitFor();
  if (process.env.DSH_PET_UI_ARTIFACTS) {
    mkdirSync(process.env.DSH_PET_UI_ARTIFACTS, { recursive: true });
    await page.screenshot({
      path: join(process.env.DSH_PET_UI_ARTIFACTS, 'voice-cloud-card.png'),
      fullPage: true,
      animations: 'disabled',
    });
  }
});

test('search: 按当前值跨分区定位，点结果切分区并高亮命中项', async (t) => {
  const { page } = await open(t, { viewport: { width: 900, height: 1600 } });
  await page.locator('.dsh-pet-cfg__panel').waitFor();
  const box = page.getByPlaceholder('Search settings, titles or current values…');

  // 值搜索：1200 是重力（外观与手感分区里的字段值，见 customized 夹具），起点在「桌宠」分区，
  // 说明索引确实把还没打开的分区也读进来了。
  await box.fill('1200');
  const row = page.locator('.dsh-pet-cfg__searchRow').first();
  await row.waitFor();
  assert.match(await row.textContent(), /Look & feel/);
  assert.match(await row.textContent(), /1200/);
  if (process.env.DSH_PET_UI_ARTIFACTS) {
    mkdirSync(process.env.DSH_PET_UI_ARTIFACTS, { recursive: true });
    await page.screenshot({ path: join(process.env.DSH_PET_UI_ARTIFACTS, 'search-results.png') });
  }

  await row.click();
  await page
    .getByRole('tab', { name: /^Look & feel/ })
    .and(page.locator('[aria-selected="true"]'))
    .waitFor();
  // 跳过去高亮：命中的字段短暂带 is-search-hit
  await page.locator('.dsh-pet-cfg__panel .is-search-hit').first().waitFor();

  // 没有匹配时给一句人话，而不是一张空列表
  await box.fill('zzz-no-such-setting');
  await page.getByText('No matching setting', { exact: true }).waitFor();
  // Esc 退出搜索态，回到分区面板
  await box.press('Escape');
  await page.locator('.dsh-pet-cfg__panel').waitFor();
});

test('system → screen: switches and timings all reach the save body', async (t) => {
  const { page, writes } = await open(t, { viewport: { width: 900, height: 2200 } });
  await tab(page, 'System').click();

  // 卡头：「看屏幕与避让」
  await page.getByText('Screen & avoidance', { exact: true }).waitFor();

  // 三个开关默认全关：全屏躲开、最大化、白名单。
  const fullscreen = page.getByRole('checkbox', { name: /Hide on fullscreen/ });
  await fullscreen.waitFor();
  assert.equal(await fullscreen.isChecked(), false, '出厂默认关着');
  await fullscreen.check();

  // 时机项：最短间隔与躲开延迟都在界面上改。
  await page.getByLabel('Minimum interval').fill('90');
  await page.getByLabel('Hide delay').fill('2000');

  // 白名单：开关打开后输入框才可用，逗号分隔会切成数组。
  const appsSwitch = page.getByRole('checkbox', { name: /Hide for listed apps/ });
  const appsInput = page.getByLabel('App list');
  assert.equal(await appsInput.isDisabled(), true, '开关关着时白名单输入不可用');
  await appsSwitch.check();
  await appsInput.fill('chrome.exe, 哔哩哔哩');

  if (process.env.DSH_PET_UI_ARTIFACTS) {
    mkdirSync(process.env.DSH_PET_UI_ARTIFACTS, { recursive: true });
    await page.screenshot({ path: join(process.env.DSH_PET_UI_ARTIFACTS, 'screen-card.png') });
  }

  await apply(page);
  const body = writes.at(-1);
  assert.equal(body.avoidFullscreenEnabled, true, '开关随保存写进配置');
  assert.equal(body.screenReadIntervalSec, 90, '最短间隔按秒写');
  assert.equal(body.avoidDelayMs, 2000, '躲开延迟按毫秒写');
  assert.equal(body.avoidAppsEnabled, true);
  assert.deepEqual(body.avoidApps, ['chrome.exe', '哔哩哔哩'], '逗号分隔切成数组，原样保留写法');
  assert.equal(body.screenReadEnabled, false, '没动的开关照旧带出去');
});
