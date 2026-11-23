// T22：文档导入的浏览器闭环——多选 md + txt → 预览可编辑 → 一次 commit → 列表出现新项；
// 再拿 .bin 走一遍：可读原因、零写盘（不 PUT /config、不进角色库）。
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
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
  whisperPrompt: 'A-原始',
});

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

async function open(t) {
  const context = await browser.newContext({ viewport: { width: 900, height: 1100 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));

  const counts = { importCalls: 0, commitCalls: 0, configPuts: 0 };
  const commits = [];
  let characters = [];
  let state = { main: { pets: [pet()], notificationsEnabled: true, confineToScreen: false, trayEnabled: true } };

  await page.route('**/dsh-pet-7340/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/dsh-pet-7340/config') {
      if (request.method() === 'PUT') {
        counts.configPuts += 1;
        return route.fulfill({ json: state });
      }
      return route.fulfill({ json: state });
    }
    if (path === '/dsh-pet-7340/persona/sources') {
      return route.fulfill({
        json: {
          ok: true,
          sources: [
            {
              id: 'fish-soul',
              name: 'dsh-fish-soul',
              kind: 'soul-card',
              installed: true,
              expectedPath: '/t/persona.json',
              path: '/t/persona.json',
              scannable: true,
              lastScan: null,
            },
          ],
          characters: { total: characters.length, skipped: [] },
          pet: { id: 'a', entry: 'main', writable: true, character: null },
        },
      });
    }
    if (path === '/dsh-pet-7340/persona/characters') {
      return route.fulfill({ json: { ok: true, characters, skipped: [] } });
    }
    if (path === '/dsh-pet-7340/persona/import') {
      counts.importCalls += 1;
      const body = request.postDataJSON() ?? {};
      const files = Array.isArray(body.files) ? body.files : [];
      const bad = files.find((file) => String(file.name).endsWith('.bin'));
      if (bad !== undefined) {
        return route.fulfill({
          json: {
            ok: false,
            reason: 'unsupported',
            message: 'Unsupported file type: .bin',
            files: files.map((f) => f.name),
          },
        });
      }
      return route.fulfill({
        json: {
          ok: true,
          usedLlm: false,
          retried: false,
          files: files.map((file) => file.name),
          preview: {
            name: '导入的角色',
            description: '来自两份文档',
            personality: '稳',
            scenario: '',
            first_mes: '',
            mes_example: '',
            system_prompt: '',
            post_history_instructions: '',
            text: '导入的角色的一段正文',
            chars: 12,
          },
        },
      });
    }
    if (path === '/dsh-pet-7340/persona/characters/import') {
      counts.commitCalls += 1;
      const body = request.postDataJSON() ?? {};
      commits.push(body);
      const character = {
        id: String(body.character?.name ?? 'unnamed'),
        name: String(body.character?.name ?? 'unnamed'),
        source: { kind: 'document', id: 'import', path: 'a.md, b.txt' },
        importedAt: '2026-11-19T00:00:00.000Z',
        chars: 12,
        appliedTo: [],
      };
      characters = [...characters, character];
      return route.fulfill({ json: { ok: true, character, reused: false } });
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
            live2d: bucket(
              'ok',
              '/t/assets/pet/live2d',
              1,
              [{ id: 'm1', label: 'm1', source: 'pool' }],
              ['*.model3.json'],
              [],
            ),
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
  return { page, counts, commits, characters: () => characters };
}

const tab = (page, name) => page.getByRole('tab', { name: new RegExp('^' + name) });
const fileInput = (page) => page.locator('.dsh-pet-cfg__importBox input[type=file]');
const button = (page, name) => page.getByRole('button', { name, exact: true });

test('import: md + txt preview, editable, single commit, new library entry', async (t) => {
  const { page, counts, commits } = await open(t);
  await tab(page, 'Pet').click();
  await page.getByText('Character · Applies to Alpha').waitFor();

  await button(page, 'Import documents…').click();
  await fileInput(page).setInputFiles([
    { name: 'a.md', mimeType: 'text/markdown', buffer: Buffer.from('# 角色\n名字：导入的角色') },
    { name: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from('性格：稳') },
  ]);
  await page.locator('.dsh-pet-cfg__importBox input[type=text]').waitFor();
  assert.equal(counts.importCalls, 1, '多选两个文件只发一次预览请求');

  // 预览可编辑：改名字后 commit 的请求体要带新值
  await page.locator('.dsh-pet-cfg__importBox input[type=text]').fill('改过的名字');

  if (process.env.DSH_PET_UI_ARTIFACTS) {
    mkdirSync(process.env.DSH_PET_UI_ARTIFACTS, { recursive: true });
    await page.screenshot({
      path: join(process.env.DSH_PET_UI_ARTIFACTS, 't22-import.png'),
      fullPage: true,
      animations: 'disabled',
    });
  }

  await button(page, 'Import to library').click();
  await page.waitForFunction(() => document.querySelectorAll('.dsh-pet-cfg__importBox input[type=text]').length === 0);
  assert.equal(counts.commitCalls, 1, '确认只落库一次');
  assert.equal(commits[0].character.name, '改过的名字', '提交体用的是编辑后的名字');

  // 列表出现新项：打开角色下拉能看到它
  await page.locator('.dsh-pet-sel__trigger[aria-label="Character"]').click();
  const options = page.getByRole('option');
  await options.first().waitFor();
  assert.ok(
    (await options.allInnerTexts()).some((label) => label.includes('改过的名字')),
    '导入后角色列表要出现新项',
  );
});

test('import: .bin is rejected with a readable reason and writes nothing', async (t) => {
  const { page, counts } = await open(t);
  await tab(page, 'Pet').click();
  await page.getByText('Character · Applies to Alpha').waitFor();

  await button(page, 'Import documents…').click();
  await fileInput(page).setInputFiles([
    { name: 'bad.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 1, 2]) },
  ]);
  await page.getByText(/Unsupported file type: \.bin/).waitFor();
  assert.equal(await page.locator('.dsh-pet-cfg__importBox input[type=text]').count(), 0, '不该进入预览态');
  assert.equal(counts.importCalls, 1, '只发了一次预览请求');
  assert.equal(counts.commitCalls, 0, '不该落库');
  assert.equal(counts.configPuts, 0, '预览失败不该写配置');

  await page.locator('.dsh-pet-sel__trigger[aria-label="Character"]').click();
  await page.getByRole('option').first().waitFor();
  assert.ok(
    (await page.getByRole('option').allInnerTexts()).every((label) => !label.includes('bad.bin')),
    '角色库不该出现任何新项',
  );
});
