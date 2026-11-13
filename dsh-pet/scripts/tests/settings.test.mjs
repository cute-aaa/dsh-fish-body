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
  { get = customized, put, post, fishPut, viewport = { width: 900, height: 900 }, lang = 'en' } = {},
) {
  const context = await browser.newContext({ viewport });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const writes = [],
    fishWrites = [],
    restarts = [],
    restores = [],
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
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
      return route.fulfill({
        json: {
          user: '/test/main-config.jsonc',
          default: '/test/assets/config.jsonc',
          animations: '/test/main-animation',
        },
      });
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
    return route.fulfill({
      json: { providers: [{ id: 'test', name: 'Test', models: [{ id: 'model', name: 'Model' }] }] },
    });
  });
  await page.goto(`${url}/?lang=${lang}`);
  await page.locator('.dsh-pet-cfg').waitFor();
  return { page, writes, fishWrites, restarts, restores };
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

test('bottom bar: sticky while the page scrolls, with restart / cancel / apply / OK', async (t) => {
  const { page } = await open(t, { viewport: { width: 900, height: 520 } });
  const bar = page.locator('.dsh-pet-cfg__bar');
  await bar.waitFor();
  const names = await bar.getByRole('button').allTextContents();
  assert.deepEqual(names, ['Restart', 'Cancel', 'Apply', 'OK']);

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

test('all seven sections are reachable and render content', async (t) => {
  const { page } = await open(t);
  for (const name of ['Pet', 'Session fish', 'Behavior', 'Appearance', 'Sound', 'Chat', 'System']) {
    await tab(page, name).click();
    const panel = page.locator('.dsh-pet-cfg__panel');
    await panel.waitFor();
    assert.ok((await panel.locator('> *').count()) > 0, `${name} 分区应该有内容`);
  }
});

for (const lang of ['en', 'zh']) {
  for (const width of [360, 520, 900]) {
    test(`settings keep controls and toggle labels readable (${lang}, ${width}px)`, async (t) => {
      const { page } = await open(t, { viewport: { width, height: 800 }, lang });
      const clipped = await page
        .locator('.dsh-pet-cfg__toggle>label>span')
        .evaluateAll((labels) =>
          labels.filter((label) => label.scrollWidth > label.clientWidth).map((label) => label.textContent),
        );
      assert.deepEqual(clipped, []);
      if (process.env.DSH_PET_UI_ARTIFACTS) {
        mkdirSync(process.env.DSH_PET_UI_ARTIFACTS, { recursive: true });
        await page.screenshot({
          path: join(process.env.DSH_PET_UI_ARTIFACTS, 'settings-' + lang + '-' + width + '.png'),
          fullPage: true,
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
    ['会话鱼', 'fish'],
    ['行为', 'behavior'],
    ['外观', 'look'],
    ['声音', 'audio'],
    ['对话', 'chat'],
    ['系统', 'system'],
  ]) {
    await tab(page, name).click();
    await page.locator('.dsh-pet-cfg__bar').waitFor();
    if (process.env.DSH_PET_UI_ARTIFACTS) {
      mkdirSync(process.env.DSH_PET_UI_ARTIFACTS, { recursive: true });
      await page.screenshot({
        path: join(process.env.DSH_PET_UI_ARTIFACTS, 'tab-' + file + '.png'),
        fullPage: true,
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
