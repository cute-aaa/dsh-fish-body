// 验收 5：第三方来源（kind=custom）能不能真的在设置页被选中、扫描并应用。
// 上一轮只有「注册即可扫描」的单测；这里补 UI 闭环：下拉可选（不是置灰）→ 选中 → 扫描请求带对来源
// 且只发一次 → 扫描只读不写盘 → 角色列表出现扫描结果 → 应用请求带对角色。
// 夹具自带极小页面与路由拦截，不读写任何真实 DSH 配置。
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { rolldown } from 'rolldown';

const pet = () => ({
  id: 'a',
  name: 'Alpha',
  size: 240,
  display: 'web',
  renderer: 'layered',
  position: { corner: 'top-right', marginX: 20, marginY: 20 },
  whisperPrompt: '手写人设',
});

/** 第三方来源的假目录（夹具内部路径，只用于文案断言，不会真的读盘）。 */
const THIRD_PARTY_DIR = '/t/thirdparty/persona.json';

/** 扫描前角色库里已有的角色（内置 soul-card 来源）。 */
const SEED_CHARACTER = {
  id: '鱼生',
  name: '鱼生',
  text: '人设：鱼生正文',
  source: { kind: 'soul-card', id: 'fish-soul', path: '/t/fish-soul/persona.json' },
  importedAt: '2026-11-19T00:00:00.000Z',
  chars: 7,
};

/** 扫描从第三方来源导入的角色。 */
const SCANNED_CHARACTER = {
  id: '外援',
  name: '外援',
  text: '人设：外援正文',
  source: { kind: 'custom', id: 'thirdparty', path: THIRD_PARTY_DIR },
  importedAt: '2026-11-19T01:00:00.000Z',
  chars: 7,
};

/** 六个来源：第一个才是默认选中的 scannable 来源，第三方来源排在第二，必须手动切过去。 */
const sources = () => [
  {
    id: 'fish-soul',
    name: 'dsh-fish-soul',
    kind: 'soul-card',
    installed: true,
    expectedPath: '/t/fish-soul/persona.json',
    path: '/t/fish-soul/persona.json',
    scannable: true,
    lastScan: null,
  },
  {
    id: 'thirdparty',
    name: 'Third-party kit',
    kind: 'custom',
    installed: true,
    expectedPath: THIRD_PARTY_DIR,
    path: THIRD_PARTY_DIR,
    scannable: true,
    lastScan: null,
  },
  {
    id: 'editor',
    name: 'Built-in editor',
    kind: 'editor',
    installed: true,
    expectedPath: null,
    path: null,
    scannable: false,
    lastScan: null,
  },
  {
    id: 'absent',
    name: 'Not installed kit',
    kind: 'soul-card',
    installed: false,
    expectedPath: '/t/absent/persona.json',
    path: null,
    scannable: false,
    lastScan: null,
  },
  {
    id: 'broken-kit',
    name: 'Broken kit',
    kind: 'custom',
    installed: true,
    expectedPath: '/t/broken/persona.json',
    path: '/t/broken/persona.json',
    scannable: false,
    lastScan: null,
  },
  {
    id: 'fish-soul-2',
    name: 'dsh-fish-soul (extra)',
    kind: 'soul-card',
    installed: true,
    expectedPath: '/t/fish-soul-2/persona.json',
    path: '/t/fish-soul-2/persona.json',
    scannable: true,
    lastScan: null,
  },
];

let server;
let browser;
let url;

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
      `<html><head><style>:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;--dsw-alias-label-primary:#202020;--dsw-alias-label-secondary:#444;--dsw-alias-label-tertiary:#666;--dsw-alias-border-l1:#ccc;--dsw-alias-border-l2:#bbb;--dsw-alias-state-business-primary:#245eea;--dsw-alias-button-info-fill:#245eea;--dsw-alias-button-info-hover:#1c4bd0;--dsw-alias-interactive-bg-hover:#eee;--dsw-alias-interactive-bg-active:#e5ecff;--dsw-alias-state-error-primary:#c22;--dsw-alias-state-success-primary:#2a7}body{margin:16px;font-family:sans-serif}</style></head><body><div id="root"></div><script>window.initialConfig=${JSON.stringify({ main: { pets: [pet()] } })};</script><script src="/fixture.js"></script></body></html>`,
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

/**
 * 开一页并装夹具：扫描只改夹具内存里的角色库，应用只改夹具内存里的宠物。
 *
 * @param t - 当前测试（用于注册清理与页面错误断言）。
 * @returns 页面、请求账本与配置读取函数。
 */
async function open(t) {
  const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));

  const state = { main: { pets: [pet()], notificationsEnabled: true, confineToScreen: false, trayEnabled: true } };
  /** 扫描过的来源：只用来决定角色库多出哪一条。 */
  let scanned = false;
  const scanBodies = [];
  const applyBodies = [];
  const saveBodies = [];

  const characterViews = () =>
    [SEED_CHARACTER, ...(scanned ? [SCANNED_CHARACTER] : [])].map((character) => ({
      id: character.id,
      name: character.name,
      source: character.source,
      importedAt: character.importedAt,
      chars: character.chars,
      appliedTo: state.main.pets.filter((item) => item.personaCharacter === character.id).map((item) => item.id),
    }));

  await page.route('**/dsh-pet-7340/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const query = new URL(request.url()).searchParams;
    if (path === '/dsh-pet-7340/config') {
      if (request.method() === 'PUT') {
        const body = request.postDataJSON() ?? {};
        saveBodies.push(body);
        state.main = { ...state.main, ...body, pets: body.pets ?? state.main.pets };
        return route.fulfill({ json: state });
      }
      return route.fulfill({ json: state });
    }
    if (path === '/dsh-pet-7340/persona/sources') {
      return route.fulfill({
        json: {
          ok: true,
          sources: sources(),
          characters: { total: scanned ? 2 : 1, skipped: [] },
          pet: { id: query.get('pet') ?? '', entry: 'main', writable: true, character: null },
        },
      });
    }
    if (path === '/dsh-pet-7340/persona/characters') {
      return route.fulfill({ json: { ok: true, characters: characterViews(), skipped: [] } });
    }
    if (path === '/dsh-pet-7340/persona/scan') {
      const body = request.postDataJSON() ?? {};
      scanBodies.push(body);
      if (body.source !== 'thirdparty') {
        // 选错来源要立刻暴露：默认来源是 fish-soul，扫描第三方必须显式切换下拉。
        return route.fulfill({ json: { ok: false, reason: 'unexpected-source', message: 'x' } });
      }
      scanned = true;
      return route.fulfill({
        json: { ok: true, scanned: 1, imported: [{ id: '外援', reused: false }], skipped: [] },
      });
    }
    if (path === '/dsh-pet-7340/persona/characters/apply') {
      const body = request.postDataJSON() ?? {};
      applyBodies.push(body);
      const target = state.main.pets.find((item) => item.id === body.pet);
      const character = [SEED_CHARACTER, SCANNED_CHARACTER].find((item) => item.id === body.characterId);
      if (target === undefined || character === undefined) {
        return route.fulfill({ json: { ok: false, reason: 'unknown-character', message: 'x' } });
      }
      target.whisperPrompt = character.text;
      target.personaCharacter = character.id;
      return route.fulfill({
        json: { ok: true, pet: body.pet, characterId: body.characterId, chars: character.chars, wroteName: false },
      });
    }
    if (path === '/dsh-pet-7340/session-fish') {
      return route.fulfill({
        json: {
          settings: {
            enabled: false,
            sizePx: 96,
            maxCount: 6,
            bubbleMs: 12000,
            skin: '',
            followPet: true,
            speakEnabled: false,
            speakProgress: false,
            speakTurnEnd: false,
            speakWaiting: false,
            progressGapMs: 15000,
          },
        },
      });
    }
    if (path === '/dsh-pet-7340/session-fish/skins') return route.fulfill({ json: { items: [] } });
    if (path === '/dsh-pet-7340/config/meta') {
      return route.fulfill({
        json: {
          root: '/t',
          rootSource: 'default',
          skin: '/t/skin',
          layout: [],
          readonly: [],
          runtime: { dir: '/t/runtime', exe: '/t/runtime/electron.exe', installed: false },
          profile: 'fish',
          user: '/t/config/main-config.jsonc',
          default: '/t/assets/config.jsonc',
          animations: '/t/assets/animation',
          logs: '/t/logs.txt',
        },
      });
    }
    if (path.startsWith('/dsh-pet-7340/skin/') && path.endsWith('/resources')) {
      const bucket = (status, dir, count, items, expect, missingFiles) => ({
        status,
        dir,
        count,
        items,
        expect,
        missingFiles,
      });
      return route.fulfill({
        json: {
          root: 'main',
          renderers: {
            layered: bucket(
              'ok',
              '/t/assets/pet/layered',
              1,
              [{ id: 'pa15', label: 'pa15', source: 'pool' }],
              ['manifest.json'],
              [],
            ),
            live2d: bucket('missing', '/t/assets/pet/live2d', 0, [], ['*.model3.json'], ['*.model3.json']),
            webm: bucket('ok', '/t/assets/pet/webm', 1, [], ['*.webm'], []),
          },
        },
      });
    }
    return route.fulfill({
      json: { providers: [{ id: 'test', name: 'Test', models: [{ id: 'model', name: 'Model' }] }] },
    });
  });

  await page.goto(`${url}/?lang=en`);
  await page.locator('.dsh-pet-cfg').waitFor();
  return { page, scanBodies, applyBodies, saveBodies, state: () => state };
}

const tab = (page, name) => page.getByRole('tab', { name: new RegExp('^' + name) });
const sourceTrigger = (page) => page.locator('.dsh-pet-sel__trigger[aria-label="Source"]');
const characterTrigger = (page) => page.locator('.dsh-pet-sel__trigger[aria-label="Character"]');
const personaArea = (page) => page.locator('textarea.dsh-pet-cfg__area');
const button = (page, name) => page.getByRole('button', { name, exact: true });

test('third-party source: selectable in the source dropdown, scanned once, applied by id', async (t) => {
  const { page, scanBodies, applyBodies, saveBodies } = await open(t);
  await tab(page, 'Pet').click();
  await page.getByText('Character · Applies to Alpha').waitFor();

  // 1) 默认来源是黑名单之外的第一个 scannable 来源（fish-soul），第三方来源此时没被选中——
  //    这样后面「切到第三方并生效」才有意义，不是碰巧默认值就等于目标。
  assert.equal(await sourceTrigger(page).locator('.dsh-pet-sel__label').innerText(), 'dsh-fish-soul');

  // 2) 打开来源下拉：六个来源都在，第三方来源是一行**可点的选项**（不是置灰的占位）。
  await sourceTrigger(page).click();
  const thirdPartyOption = page.getByRole('option', { name: /Third-party kit/ });
  await thirdPartyOption.waitFor();
  assert.equal(await thirdPartyOption.isDisabled(), false, '第三方来源必须可选');
  assert.equal(await page.getByRole('option').count(), 6, '六个来源都要列出来');
  // 未安装来源的期望路径只作为提示出现在卡片正文里（不在下拉里置灰它）。
  await thirdPartyOption.click();
  await page.waitForFunction(
    () =>
      document.querySelector('.dsh-pet-sel__trigger[aria-label="Source"] .dsh-pet-sel__label')?.textContent ===
      'Third-party kit',
  );

  // 3) 点「扫描并导入」：请求体带 source=thirdparty，且只发一次。
  await button(page, 'Scan & import').click();

  // 4) 扫描回执 → 角色库出现「外援」（等下拉选项本身就是等扫描完成，不用睡固定时长）。
  //    这时**没有任何写盘请求**：扫描只读角色库 + 写全局库，配置 PUT 计数必须是 0。
  const characterOptions = page.getByRole('option', { name: /外援/ });
  await characterTrigger(page).click();
  await characterOptions.waitFor();
  const thirdPartyScans = scanBodies.filter((body) => body.source === 'thirdparty');
  assert.equal(thirdPartyScans.length, 1, '选中第三方来源后只发一次扫描');
  assert.equal(scanBodies.length, 1, '不该顺带扫描别的来源');
  assert.deepEqual(saveBodies, [], '扫描只读角色库，不得触发 PUT /config');
  await characterOptions.click();

  // 5) 应用：请求带 characterId=外援；正文回填成该角色的正文。
  await button(page, 'Apply to this pet').click();
  await page.waitForFunction(() => document.querySelector('textarea.dsh-pet-cfg__area')?.value === '人设：外援正文');
  assert.equal(applyBodies.length, 1);
  assert.equal(applyBodies[0].characterId, '外援');
  assert.equal(applyBodies[0].pet, 'a', '应用的作用域是当前 chip 选中的实例');
  assert.equal(await personaArea(page).inputValue(), '人设：外援正文');
  assert.deepEqual(saveBodies, [], '应用只改草稿，落盘仍要等底部栏的「应用」');
});
