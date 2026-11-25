// 真实宿主用户旅程：构建产物 + 临时 DSH_HOME + 随机回环端口。
// 只读写本轮创建的临时根；不启动 DSH，不碰真实 fish profile。
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = fileURLToPath(new URL('../../..', import.meta.url));
const STANDALONE = join(PACKAGE_DIR, 'lib', 'standalone.js');
const ROUTE = '/dsh-pet-7340';

let home = '';
let dataRoot = '';
let external = '';
let child;
let base = '';
let token = '';
let stderr = '';

/** 选一个已经释放的回环端口；真正的绑定仍由 standalone 自己做。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

/** 条件轮询；测试禁止用固定 sleep 判失败。 */
async function waitFor(run, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await run();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('等待超时；stderr=' + stderr.slice(-2000));
}

/** 发一次带本进程令牌的请求。 */
async function api(path, init = {}) {
  const response = await fetch(base + ROUTE + path, {
    ...init,
    headers: {
      'x-dsh-pet-token': token,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body, text };
}

/** 写一份最小主配置，display=web 避免测试拉起桌面 Helper。 */
function writeMainConfig() {
  mkdirSync(join(dataRoot, 'config'), { recursive: true });
  writeFileSync(
    join(dataRoot, 'config', 'main-config.jsonc'),
    JSON.stringify(
      {
        pets: [
          {
            id: 'main',
            name: 'Fish',
            size: 240,
            balanceEnabled: false,
            display: 'web',
            position: { corner: 'top-right', marginX: 20, marginY: 20 },
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
}

/** 造 soul、memory、可导入皮肤与音效，全部在临时根或临时外部根。 */
function seedFixtures() {
  mkdirSync(join(home, 'fish-soul'), { recursive: true });
  writeFileSync(
    join(home, 'fish-soul', 'persona.json'),
    JSON.stringify({
      spec: 'chara_card_v2',
      data: { name: '鱼生', description: '一条住在桌面上的鱼', personality: '爱吃', scenario: '' },
    }),
    'utf8',
  );
  mkdirSync(join(home, 'dsh-rofm', 'memory'), { recursive: true });
  writeFileSync(join(home, 'dsh-rofm', 'memory', '2026-11-26.md'), '用户今天在测试记忆接入。', 'utf8');

  const layered = join(external, 'layered', 'demo-skin');
  mkdirSync(join(layered, 'art'), { recursive: true });
  writeFileSync(join(layered, 'manifest.json'), '{"layers":[]}', 'utf8');
  writeFileSync(join(layered, 'art', 'body.png'), Buffer.from([1, 2, 3, 4]));
  writeFileSync(join(external, 'click.wav'), Buffer.from('RIFFtestWAVE', 'ascii'));
  writeFileSync(join(external, 'fish.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
}

before(async () => {
  assert.equal(existsSync(STANDALONE), true, '缺少 lib/standalone.js：先运行 npm run build');
  home = mkdtempSync(join(tmpdir(), 'dsh-fish-e2e-home-'));
  dataRoot = join(home, 'fish-body');
  external = mkdtempSync(join(tmpdir(), 'dsh-fish-e2e-external-'));
  writeMainConfig();
  seedFixtures();

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [STANDALONE, '--port', String(port)], {
    cwd: PACKAGE_DIR,
    env: {
      ...process.env,
      DSH_HOME: home,
      DSH_PET_USER_ROOT: dataRoot,
      DSH_PET_ELECTRON_PATH: process.execPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const runtimeFile = join(home, 'dsh-pet', 'standalone-runtime.json');
  const runtime = await waitFor(() => {
    if (!existsSync(runtimeFile)) return undefined;
    try {
      const parsed = JSON.parse(readFileSync(runtimeFile, 'utf8'));
      return typeof parsed.token === 'string' && parsed.port === port ? parsed : undefined;
    } catch {
      return undefined;
    }
  });
  token = runtime.token;
});

after(async () => {
  if (child && child.exitCode === null) {
    try {
      await fetch(base + ROUTE + '/shutdown', { method: 'POST', headers: { 'x-dsh-pet-token': token } });
    } catch {
      // 服务可能已经自行退出；清理阶段不再制造第二个错误。
    }
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (child.exitCode === null) child.kill();
  }
  rmSync(home, { recursive: true, force: true });
  rmSync(external, { recursive: true, force: true });
});

test('用户旅程：配置、soul、memory、资源包、皮肤/音效导入都能在真实宿主里走通', async () => {
  const config = await api('/config');
  assert.equal(config.status, 200);
  assert.notEqual(config.body.ok, false, '构建产物应能读到包内默认配置');

  const sources = await api('/persona/sources?pet=main');
  assert.equal(sources.status, 200);
  assert.equal(sources.body.ok, true);
  assert.ok(sources.body.sources.some((item) => item.id === 'fish-soul' && item.installed));

  const scan = await api('/persona/scan', { method: 'POST', body: JSON.stringify({ source: 'fish-soul' }) });
  assert.equal(scan.status, 200);
  assert.equal(scan.body.ok, true);
  assert.ok(scan.body.imported.length >= 1);
  const characterId = scan.body.imported[0].id;
  const apply = await api('/persona/characters/apply', {
    method: 'POST',
    body: JSON.stringify({ pet: 'main', characterId, writeName: false }),
  });
  assert.equal(apply.body.ok, true);

  const memory = await api('/memory');
  assert.equal(memory.status, 200);
  assert.equal(memory.body.provider?.id, 'dsh-rofm');
  assert.ok(memory.body.provider.notes >= 1);

  const customMemory = join(external, 'memory');
  mkdirSync(customMemory, { recursive: true });
  writeFileSync(join(customMemory, '2026-11-26.md'), '自定义记忆。', 'utf8');
  const memorySave = await api('/integrations', {
    method: 'PUT',
    body: JSON.stringify({ memory: { mode: 'custom', customDir: customMemory, approvedExternal: true } }),
  });
  assert.equal(memorySave.body.ok, true);
  const customStatus = await api('/memory');
  assert.equal(customStatus.body.provider?.id, 'custom-memory');

  const customPersona = join(external, 'persona.md');
  writeFileSync(customPersona, '# 自定义角色\n\n喜欢在桌面上发呆。', 'utf8');
  const personaSave = await api('/integrations', {
    method: 'PUT',
    body: JSON.stringify({ persona: { customPath: customPersona, approvedExternal: true } }),
  });
  assert.equal(personaSave.body.ok, true);
  const customScan = await api('/persona/scan', {
    method: 'POST',
    body: JSON.stringify({ source: 'custom' }),
  });
  assert.equal(customScan.body.ok, true);
  assert.ok(customScan.body.imported.some((item) => item.name === '自定义角色'));

  const skin = await api('/assets/import', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'skin',
      renderer: 'layered',
      sourcePath: join(external, 'layered', 'demo-skin'),
    }),
  });
  assert.equal(skin.body.ok, true);
  const resources = await api('/skin/main/resources');
  assert.ok(
    resources.body.renderers.layered.available.some((item) => item.id === 'demo-skin'),
    '导入的 layered 皮肤必须被真实扫描到',
  );

  const sound = await api('/assets/import', {
    method: 'POST',
    body: JSON.stringify({ kind: 'sfx', target: 'shared', sourcePath: join(external, 'click.wav') }),
  });
  assert.equal(sound.body.ok, true);
  assert.equal(existsSync(join(dataRoot, 'assets', 'sound', 'click.wav')), true);

  const sessionFish = await api('/assets/import', {
    method: 'POST',
    body: JSON.stringify({ kind: 'session-fish', sourcePath: join(external, 'fish.png') }),
  });
  assert.equal(sessionFish.body.ok, true);
  assert.equal(existsSync(join(dataRoot, 'assets', 'session-fish', 'fish.png')), true);

  const packs = await api('/packs');
  assert.equal(packs.body.ok, true);
  assert.ok(packs.body.packs.length > 0);
  const pack = packs.body.packs[0];
  const packSource = join(external, 'pack-dir');
  mkdirSync(packSource, { recursive: true });
  writeFileSync(join(packSource, 'demo.ttf'), 'font', 'utf8');
  const installed = await api('/packs/install', {
    method: 'POST',
    body: JSON.stringify({ id: pack.id, dir: packSource }),
  });
  assert.equal(installed.body.ok, true);
  assert.equal(existsSync(join(dataRoot, 'packs', pack.id, 'demo.ttf')), true);

  const integrationView = await api('/integrations');
  assert.equal(integrationView.body.ok, true);
  assert.equal(integrationView.body.integrations.memory.mode, 'custom');
});
