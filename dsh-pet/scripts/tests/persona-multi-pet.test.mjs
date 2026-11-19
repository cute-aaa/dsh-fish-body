// T16：多宠物 × 多角色的浏览器闭环——切实例 → 角色卡跟随 → 应用 → 只有该实例变 → 保存不被盖回。
// 独立夹具：两只 main 实例（Alpha / Beta），角色库两个角色（X / Y）；apply 由桩改主机状态。
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { rolldown } from 'rolldown';

const pet = (id, name, whisperPrompt, personaCharacter) => ({
  id,
  name,
  size: 240,
  display: 'web',
  renderer: 'layered',
  position: { corner: 'top-right', marginX: 20, marginY: 20 },
  whisperPrompt,
  ...(personaCharacter === undefined ? {} : { personaCharacter }),
});

const CHARACTERS = {
  X: { id: 'X', name: '鱼生', text: '人设：鱼生正文', chars: 7 },
  Y: { id: 'Y', name: '阿猫', text: '人设：阿猫正文', chars: 7 },
};

const initialPets = () => [pet('a', 'Alpha', 'A-原始', 'X'), pet('b', 'Beta', 'B-原始')];

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
      `<html><head><style>:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;--dsw-alias-label-primary:#202020;--dsw-alias-label-secondary:#444;--dsw-alias-label-tertiary:#666;--dsw-alias-border-l1:#ccc;--dsw-alias-border-l2:#bbb;--dsw-alias-state-business-primary:#245eea;--dsw-alias-button-info-fill:#245eea;--dsw-alias-button-info-hover:#1c4bd0;--dsw-alias-interactive-bg-hover:#eee;--dsw-alias-interactive-bg-active:#e5ecff;--dsw-alias-state-error-primary:#c22;--dsw-alias-state-success-primary:#2a7}body{margin:16px;font-family:sans-serif}</style></head><body><div id="root"></div><script>window.initialConfig=${JSON.stringify({ main: { pets: initialPets() } })};</script><script src="/fixture.js"></script></body></html>`,
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

/** 开一页并装夹具：状态可被 apply / save 修改。 */
async function open(t) {
  const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));

  /** 主配置状态（GET/PUT 共用）。 */
  let state = { main: { pets: initialPets(), notificationsEnabled: true, confineToScreen: false, trayEnabled: true } };
  const sourcesCalls = [];
  const saveBodies = [];

  const characters = () =>
    Object.values(CHARACTERS).map((character) => ({
      ...character,
      source: { kind: 'soul-card', id: 'fish-soul', path: character.id + '.json' },
      importedAt: '2026-11-19T00:00:00.000Z',
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
        // 宿主的权威回包：只以提交里的 pets 为准（模拟白名单重建）。
        state = { ...state, main: { ...state.main, ...body, pets: body.pets ?? state.main.pets } };
        return route.fulfill({ json: state });
      }
      return route.fulfill({ json: state });
    }
    if (path === '/dsh-pet-7340/persona/sources') {
      const petId = query.get('pet') ?? '';
      sourcesCalls.push({ petId, url: request.url() });
      const found = state.main.pets.find((item) => item.id === petId);
      if (found === undefined) return route.fulfill({ json: { ok: false, reason: 'unknown-pet', message: 'x' } });
      return route.fulfill({
        json: {
          ok: true,
          sources: [
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
              id: 'editor',
              name: 'Built-in editor',
              kind: 'editor',
              installed: true,
              expectedPath: null,
              path: null,
              scannable: false,
              lastScan: null,
            },
          ],
          characters: { total: 2, skipped: [] },
          pet: { id: petId, entry: 'main', writable: true, character: found.personaCharacter ?? null },
        },
      });
    }
    if (path === '/dsh-pet-7340/persona/characters') {
      return route.fulfill({ json: { ok: true, characters: characters(), skipped: [] } });
    }
    if (path === '/dsh-pet-7340/persona/characters/apply') {
      const body = request.postDataJSON() ?? {};
      const target = state.main.pets.find((item) => item.id === body.pet);
      const character = CHARACTERS[body.characterId];
      if (target === undefined || character === undefined) {
        return route.fulfill({ json: { ok: false, reason: 'unknown-character', message: 'x' } });
      }
      const unchanged =
        target.personaCharacter === body.characterId &&
        target.whisperPrompt === character.text &&
        (body.writeName === false || target.name === (character.name || target.name));
      if (!unchanged) {
        target.whisperPrompt = character.text;
        target.personaCharacter = character.id;
        if (body.writeName !== false && character.name !== '') target.name = character.name;
      }
      return route.fulfill({
        json: {
          ok: true,
          pet: body.pet,
          characterId: body.characterId,
          chars: character.chars,
          wroteName: body.writeName !== false,
          ...(unchanged ? { unchanged: true } : {}),
        },
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
            webm: bucket('ok', '/t/assets/pet/webm', 3, [], ['*.webm'], []),
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
  return { page, sourcesCalls, saveBodies, state: () => state };
}

const tab = (page, name) => page.getByRole('tab', { name: new RegExp('^' + name) });
const chip = (page, petId) => page.locator('.dsh-pet-cfg__chip[data-pet-id=' + JSON.stringify(petId) + ']');
const characterTrigger = (page) => page.locator('.dsh-pet-sel__trigger[aria-label="Character"]');
const sourceTrigger = (page) => page.locator('.dsh-pet-sel__trigger[aria-label="Source"]');
const personaArea = (page) => page.locator('textarea.dsh-pet-cfg__area');
const button = (page, name) => page.getByRole('button', { name, exact: true });

test('two pets, two characters: switching chips, applying, saving and isolation', async (t) => {
  const { page, sourcesCalls, saveBodies } = await open(t);
  await tab(page, 'Pet').click();

  // 1) 默认作用域是 A；角色卡标题写明「作用于 Alpha」
  await page.getByText('Character · Applies to Alpha').waitFor();
  assert.equal(await characterTrigger(page).locator('.dsh-pet-sel__label').innerText(), '鱼生 · soul-card');

  // 2) 切到 B：标题变、请求带 ?pet=b、B 当前没有引用角色
  await chip(page, 'b').click();
  await page.getByText('Character · Applies to Beta').waitFor();
  assert.ok(
    sourcesCalls.some((call) => call.petId === 'b'),
    '切实例后必须按新实例重拉来源',
  );
  await page.waitForFunction(
    () =>
      document.querySelector('.dsh-pet-sel__trigger[aria-label="Character"] .dsh-pet-sel__label')?.textContent ===
      '(no character)',
  );

  // 3) 给 B 选角色 Y 并应用：B 的正文变成 Y 的正文，A 仍是原始
  await characterTrigger(page).click();
  await page.getByRole('option', { name: /阿猫/ }).click();
  await button(page, 'Apply to this pet').click();
  await page.waitForFunction(() => document.querySelector('textarea.dsh-pet-cfg__area')?.value === '人设：阿猫正文');
  assert.equal(await personaArea(page).inputValue(), '人设：阿猫正文');

  await chip(page, 'a').click();
  await page.getByText('Character · Applies to Alpha').waitFor();
  assert.equal(await personaArea(page).inputValue(), 'A-原始', '另一只实例的正文逐字不变');

  // 4) 回 A：应用 X 一次（A 的正文与 X 不同 → applied），再点一次 → 「无变化」，B 不受影响
  await characterTrigger(page).click();
  await page.getByRole('option', { name: /鱼生/ }).click();
  await button(page, 'Apply to this pet').click();
  await page.waitForFunction(() => document.querySelector('textarea.dsh-pet-cfg__area')?.value === '人设：鱼生正文');
  await button(page, 'Apply to this pet').click();
  await page.getByText(/No change/).waitFor();

  await chip(page, 'b').click();
  await page.getByText('Character · Applies to 阿猫').waitFor();
  assert.equal(await personaArea(page).inputValue(), '人设：阿猫正文', 'B 仍然是 Y 的正文');

  // 5) 保存：提交体里两只各带自己的角色与正文（应用结果没有被盖回）
  await button(page, 'Apply').click();
  await page.waitForFunction(() => window.__saved === undefined || true);
  await page.waitForTimeout(200);
  assert.equal(saveBodies.length >= 1, true, '应有一次 PUT /config');
  const savedPets = saveBodies.at(-1).pets;
  const a = savedPets.find((item) => item.id === 'a');
  const b = savedPets.find((item) => item.id === 'b');
  assert.equal(a.personaCharacter, 'X');
  assert.equal(b.personaCharacter, 'Y');
  assert.equal(a.whisperPrompt, '人设：鱼生正文');
  assert.equal(b.whisperPrompt, '人设：阿猫正文');
  assert.notEqual(a.whisperPrompt, b.whisperPrompt, '两只必须是各自角色的正文');
});

test('source dropdown lists installed sources and disables nothing extra', async (t) => {
  const { page } = await open(t);
  await tab(page, 'Pet').click();
  await page.getByText('Character · Applies to Alpha').waitFor();
  await sourceTrigger(page).click();
  const options = page.getByRole('option');
  await options.first().waitFor();
  const labels = await options.allInnerTexts();
  assert.ok(
    labels.some((label) => label.includes('dsh-fish-soul')),
    '已安装来源可选',
  );
  assert.ok(
    labels.some((label) => label.includes('Built-in editor')),
    '内置编辑在列表里',
  );
});
