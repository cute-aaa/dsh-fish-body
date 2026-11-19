// 验收 6：真放素材 → `GET /skin/<root>/resources` 三桶都是 ok → 设置页下拉能选到 → 首帧不是空白。
//
// 与其余 UI 测试的区别：这里**不拦截素材请求**，而是把真实宿主半侧（src/host/index.ts 的 apply()）
// 起在测试进程里、监听随机回环端口，数据根指到 mkdtemp 目录（DSH_PET_USER_ROOT + DSH_HOME）。
// 于是三桶清单与分层皮肤文件都由生产代码自己扫、自己发；只有页面本身的 /config 之类是与素材无关的桩。
//
// 三种素材怎么来：
//   layered：拷一份**真实皮肤**（env DSH_PET_LAYERED_SKIN / 包内 assets / 宿主池桶里第一个带
//            manifest.json 的目录）。不在这里手写 manifest——结构对了不代表渲染器认。
//   live2d ：真实 .moc3 是 Cubism 的私有二进制格式，夹具里造不出来；只造渲染器**实际会读**的
//            `*.model3.json`（Version / FileReferences.Moc / Textures）与一张 1×1 真 PNG。
//            所以 live2d 只验「扫描得到 + 下拉可选」，不挂载、不做首帧断言。
//   webm   ：直接拷仓库里随包发布的真实 VP9-alpha webm（assets/webm 里最小的那个），不调 ffmpeg。
//            设置页的模型下拉对 webm 是**故意禁用**的（webm 走动画池，没有「模型」这一维），
//            所以 webm 验「桶 ok + 渲染方式可选 + 模型下拉禁用并给出说明」，这是产品行为不是降级。
//
// 首帧只对 layered 做：它需要的全部是普通 2D canvas + PNG，能在 Chromium 里真画出来。
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { rolldown } from 'rolldown';

const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));
/** live2d 桶里的 id：相对池桶的 model3 路径（也是 pets[].model 该写的值）。 */
const LIVE2D_ID = 'mini/mini.model3.json';
/** 仓库里随包发布的最小真 webm 目录。 */
const PACKAGED_WEBM_DIR = join(PACKAGE_DIR, 'assets', 'webm');
/** 1×1 透明 PNG：live2d 纹理只需要「是一张能解码的图」，尺寸与内容对扫描/下拉都不参与判定。 */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const isDir = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * 找一个**真实的** layered 皮肤目录（含 manifest.json）。
 *
 * 顺序：显式环境变量 → 包内池桶 → 当前机器的宿主池桶（只读；DSH_HOME 有可能指到别处）。
 * 一个都找不到时返回 undefined，测试跳过并说明原因——绝不在这里伪造一份 manifest 充数。
 *
 * @returns 皮肤目录绝对路径；没有时 undefined。
 */
function findLayeredSkin() {
  const bootstrapHome = process.env.DSH_HOME ?? join(homedir(), '.dsh');
  const candidates = [];
  if (typeof process.env.DSH_PET_LAYERED_SKIN === 'string' && process.env.DSH_PET_LAYERED_SKIN !== '') {
    candidates.push(process.env.DSH_PET_LAYERED_SKIN);
  }
  candidates.push(join(PACKAGE_DIR, 'assets', 'pet', 'layered'));
  candidates.push(join(bootstrapHome, 'fish-body', 'assets', 'pet', 'layered'));
  for (const dir of candidates) {
    if (!isDir(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (existsSync(join(dir, name, 'manifest.json'))) return join(dir, name);
    }
  }
  return undefined;
}

/** 最小的 Cubism 4 模型清单：字段名按 model3.json 的真实格式写（渲染器与 pixi 都按它读）。 */
const model3 = () => ({
  Version: 3,
  FileReferences: {
    Moc: 'mini.moc3',
    Textures: ['mini.tex.png'],
    Motions: {},
    Expressions: [],
  },
  HitGroups: [],
  HitAreas: [],
});

// 跳过判定必须在注册测试之前算好（node:test 在创建 test 时就读 skip），不能等到 before()。
// 两个前提：① 本文件的 before() 要 import 生产源码（.ts），Node 必须开着类型擦除；
// ② 要有一套**真实**的 layered 皮肤可拷——没有就跳过并说清楚，不在这里伪造 manifest。
const typescriptSupport = typeof process.features?.typescript === 'string' ? process.features.typescript : '';
/** 真实皮肤目录；找不到时 undefined（测试跳过）。 */
const skinDir = findLayeredSkin();
/** 拷进临时根的 layered 皮肤 id（= 池里的目录名 = pets[].model 该写的值）。 */
const layeredId = skinDir === undefined ? '' : basename(skinDir);
/** false = 照常跑；字符串 = 跳过原因。 */
const skipReason =
  typescriptSupport === ''
    ? '当前 Node 未启用 TypeScript 类型擦除（需 22.18+ 或 --experimental-strip-types），无法 import 宿主源码'
    : skinDir === undefined
      ? '找不到真实 layered 皮肤：设 DSH_PET_LAYERED_SKIN，或在 <DSH_HOME>/fish-body/assets/pet/layered/ 放一套带 manifest.json 的皮肤'
      : false;

/** 随机端口 + 临时数据根的宿主、浏览器与页面脚本。 */
let server;
let browser;
let url;
/** apply() 注册的 effect 释放函数：不释放的话余额定时器会让测试进程跑完不退出。 */
const disposers = [];
/** 真实宿主路由处理函数（只处理 /dsh-pet-7340/*）。 */
let petHandler;
/** 夹具页面脚本（rolldown 现打）。 */
let settingsCode = '';
let layeredCode = '';
/** 临时根与数据根（after 里整棵删掉）。 */
let root = '';
let dataRoot = '';
let savedEnv = {};

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'dsh-pet-render-assets-'));
  dataRoot = join(root, 'data');
  const home = join(root, 'home');
  const pool = join(dataRoot, 'assets', 'pet');

  // —— 三种素材都摆进临时数据根的池桶 ——
  if (skinDir !== undefined) {
    mkdirSync(join(pool, 'layered'), { recursive: true });
    cpSync(skinDir, join(pool, 'layered', layeredId), { recursive: true });
    // 三桶的 `dir` 现在报**用户皮肤目录**（`<根>/skin/<渲染方式>`），所以同一份素材也摆一份
    // 到用户目录：既验合并清单，也验「用户放进去就能选到」。
    const userSkin = join(dataRoot, 'skin', 'layered');
    mkdirSync(userSkin, { recursive: true });
    cpSync(skinDir, join(userSkin, layeredId), { recursive: true });
  }

  const live2dDir = join(pool, 'live2d', 'mini');
  mkdirSync(live2dDir, { recursive: true });
  writeFileSync(join(live2dDir, 'mini.model3.json'), JSON.stringify(model3(), null, 2));
  writeFileSync(join(live2dDir, 'mini.tex.png'), ONE_PIXEL_PNG);

  const webmSource = existsSync(PACKAGED_WEBM_DIR)
    ? readdirSync(PACKAGED_WEBM_DIR)
        .filter((name) => name.toLowerCase().endsWith('.webm'))
        .map((name) => join(PACKAGED_WEBM_DIR, name))
        .sort((a, b) => statSync(a).size - statSync(b).size || a.localeCompare(b))[0]
    : undefined;
  if (webmSource === undefined) throw new Error('包内 assets/webm 里没有可用的 .webm：' + PACKAGED_WEBM_DIR);
  mkdirSync(join(pool, 'webm'), { recursive: true });
  // 换个稳定的 ASCII 名字：桶里的 id 就是文件名，断言不该跟着仓库素材改名而漂。
  cpSync(webmSource, join(pool, 'webm', 'loop.webm'));

  // —— 起真实宿主：随机端口 + 隔离数据根；绝不碰真实数据根与 3099 上的实例 ——
  savedEnv = {
    DSH_HOME: process.env.DSH_HOME,
    DSH_PET_USER_ROOT: process.env.DSH_PET_USER_ROOT,
    DSH_PET_ELECTRON_PATH: process.env.DSH_PET_ELECTRON_PATH,
  };
  process.env.DSH_HOME = home;
  process.env.DSH_PET_USER_ROOT = dataRoot;
  // 命中一个已存在的可执行文件：宿主无论如何都不会去下载 / 拉起 electron。
  process.env.DSH_PET_ELECTRON_PATH = process.execPath;

  const { apply } = await import(new URL('../../src/host/index.ts', import.meta.url).href);
  const noop = () => undefined;
  apply({
    effect: (fn) => {
      try {
        const dispose = fn();
        if (typeof dispose === 'function') disposers.push(dispose);
        return dispose;
      } catch {
        // 源码形态下包内默认配置不可达（PACKAGE_ROOT 解析到 src/），个别 effect 会抛；
        // 路由注册不依赖它们，吞掉即可——与 src/host/routes.test.ts 同一处理。
        return undefined;
      }
    },
    provide: () => noop,
    on: () => noop,
    webServer: {
      register: (spec) => {
        petHandler = spec.handler;
        return noop;
      },
    },
    commands: { register: () => noop },
    logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
    agentDefaultModel: { currentSelection: () => ({ provider: 'no-such-provider', model: 'x' }) },
    credentials: { resolve: async () => undefined },
    llm: { listProviders: () => [], listModels: async () => [] },
  });
  assert.equal(typeof petHandler, 'function', 'apply() 必须注册 /dsh-pet-7340 prefix handler');

  // —— 页面脚本：设置页复用已有夹具；首帧页只装真实的 layered 渲染后端 ——
  const settingsBundle = await rolldown({
    input: fileURLToPath(new URL('./settings.fixture.js', import.meta.url)),
    platform: 'browser',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  });
  settingsCode = (await settingsBundle.generate({ format: 'iife' })).output[0].code;
  await settingsBundle.close();

  if (skipReason === false) {
    const entry = join(root, 'layered-entry.mjs');
    writeFileSync(
      entry,
      [
        "import { createLayeredRenderer } from '" +
          PACKAGE_DIR.replace(/\\/g, '/') +
          "/src/client/pet/render/layered.ts';",
        "const stage = document.getElementById('stage');",
        'const renderer = createLayeredRenderer();',
        'const source = {',
        "  cfg: () => ({ id: 'main', assetRoot: 'main', animations: [], model: " + JSON.stringify(layeredId) + ' }),',
        "  currentAnim: () => '',",
        '  workStatus: () => null,',
        "  facing: () => 'right',",
        '  report: () => {},',
        '  clearCuePlayback: () => {},',
        '  onFrontReady: () => {},',
        '  isDragging: () => false,',
        '  initiallyFrozen: false,',
        '};',
        'renderer.mount(stage, { size: 320, assetRoot: "main", source }).then(() => {',
        '  window.__stats = () => {',
        "    const canvas = stage.querySelector('canvas');",
        "    if (canvas === null) return { error: 'no-canvas' };",
        "    const ctx = canvas.getContext('2d');",
        '    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;',
        '    let opaque = 0;',
        '    let minX = canvas.width;',
        '    let minY = canvas.height;',
        '    let maxX = -1;',
        '    let maxY = -1;',
        '    const colors = new Set();',
        '    for (let y = 0; y < canvas.height; y += 1) {',
        '      for (let x = 0; x < canvas.width; x += 1) {',
        '        const i = (y * canvas.width + x) * 4;',
        '        if (data[i + 3] <= 8) continue;',
        '        opaque += 1;',
        '        colors.add(((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4));',
        '        if (x < minX) minX = x;',
        '        if (y < minY) minY = y;',
        '        if (x > maxX) maxX = x;',
        '        if (y > maxY) maxY = y;',
        '      }',
        '    }',
        '    return {',
        '      w: canvas.width,',
        '      h: canvas.height,',
        '      opaque,',
        '      ratio: opaque / (canvas.width * canvas.height),',
        '      colors: colors.size,',
        '      boxW: maxX < 0 ? 0 : maxX - minX + 1,',
        '      boxH: maxY < 0 ? 0 : maxY - minY + 1,',
        '    };',
        '  };',
        '  window.__ready = true;',
        '}).catch((error) => { window.__error = String(error); });',
      ].join('\n'),
    );
    const layeredBundle = await rolldown({ input: entry, platform: 'browser' });
    layeredCode = (await layeredBundle.generate({ format: 'iife' })).output[0].code;
    await layeredBundle.close();
  }

  // —— 一个回环服务同时提供：夹具页面、设置页需要的桩、以及**真实的**素材路由 ——
  const config = {
    main: {
      pets: [
        {
          id: 'main',
          name: 'Fish',
          size: 240,
          display: 'web',
          renderer: 'layered',
          ...(layeredId === '' ? {} : { model: layeredId }),
          assetRoot: 'main',
          position: { corner: 'top-right', marginX: 20, marginY: 20 },
          whisperPrompt: '',
        },
      ],
      notificationsEnabled: true,
      confineToScreen: false,
      trayEnabled: true,
    },
  };
  server = createServer((req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = parsed.pathname;
    if (pathname === '/') {
      const layered = parsed.searchParams.get('fixture') === 'layered';
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(
        layered
          ? '<html><body style="margin:0"><div id="stage" style="position:relative;width:320px;height:320px"></div><script src="/layered.js"></script></body></html>'
          : `<html><head><style>:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;--dsw-alias-label-primary:#202020;--dsw-alias-label-secondary:#444;--dsw-alias-label-tertiary:#666;--dsw-alias-border-l1:#ccc;--dsw-alias-border-l2:#bbb;--dsw-alias-state-business-primary:#245eea;--dsw-alias-button-info-fill:#245eea;--dsw-alias-button-info-hover:#1c4bd0;--dsw-alias-interactive-bg-hover:#eee;--dsw-alias-interactive-bg-active:#e5ecff;--dsw-alias-state-error-primary:#c22;--dsw-alias-state-success-primary:#2a7}body{margin:16px;font-family:sans-serif}</style></head><body><div id="root"></div><script>window.initialConfig=${JSON.stringify(config)};</script><script src="/settings.js"></script></body></html>`,
      );
      return;
    }
    if (pathname === '/settings.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(settingsCode);
      return;
    }
    if (pathname === '/layered.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(layeredCode);
      return;
    }
    // 素材：交给真实宿主路由（/skin/<root>/resources 与 /skin/<root>/<file> 都在这里）。
    if (pathname.startsWith('/dsh-pet-7340/skin/')) {
      void petHandler(req, res);
      return;
    }
    // 与素材无关的设置页数据：桩掉，免得源码形态下包内默认配置不可达把整页打挂。
    if (pathname === '/dsh-pet-7340/config' || pathname === '/dsh-pet-7340/config/meta') {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify(
          pathname.endsWith('/meta')
            ? {
                root: dataRoot,
                rootSource: 'env',
                skin: join(dataRoot, 'skin'),
                layout: [],
                readonly: [],
                runtime: { dir: join(root, 'runtime'), exe: process.execPath, installed: false },
                profile: 'fish',
                user: join(dataRoot, 'config', 'main-config.jsonc'),
                default: join(PACKAGE_DIR, 'assets', 'config.jsonc'),
                animations: join(dataRoot, 'assets', 'animation'),
                logs: join(root, 'logs.txt'),
              }
            : config,
        ),
      );
      return;
    }
    if (pathname === '/dsh-pet-7340/session-fish') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ settings: { enabled: false, sizePx: 96, maxCount: 6, bubbleMs: 12000, skin: '' } }));
      return;
    }
    if (pathname === '/dsh-pet-7340/session-fish/skins') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ items: [] }));
      return;
    }
    if (pathname === '/dsh-pet-7340/persona/sources') {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          ok: true,
          sources: [
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
          characters: { total: 0, skipped: [] },
          pet: { id: 'main', entry: 'main', writable: true, character: null },
        }),
      );
      return;
    }
    if (pathname === '/dsh-pet-7340/persona/characters') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, characters: [], skipped: [] }));
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ providers: [] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const dispose of disposers.splice(0).reverse()) {
    try {
      dispose();
    } catch {
      /* 释放失败不影响其余清理 */
    }
  }
  if (savedEnv.DSH_HOME === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = savedEnv.DSH_HOME;
  if (savedEnv.DSH_PET_USER_ROOT === undefined) delete process.env.DSH_PET_USER_ROOT;
  else process.env.DSH_PET_USER_ROOT = savedEnv.DSH_PET_USER_ROOT;
  if (savedEnv.DSH_PET_ELECTRON_PATH === undefined) delete process.env.DSH_PET_ELECTRON_PATH;
  else process.env.DSH_PET_ELECTRON_PATH = savedEnv.DSH_PET_ELECTRON_PATH;
  if (root !== '') rmSync(root, { recursive: true, force: true });
});

/**
 * 打开设置页（默认 Pose/外观 tab 停在 Pet）。
 *
 * @param t - 当前测试（用于注册清理与页面错误断言）。
 * @returns 已渲染完成的页面。
 */
async function open(t) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(`${url}/?lang=en`);
  await page.locator('.dsh-pet-cfg').waitFor();
  return page;
}

/** 宿主回包里的路径是不是落在临时数据根内（防止误读真实数据根）。 */
const insideDataRoot = (path) => {
  const rel = relative(dataRoot, path);
  return rel !== '' && !rel.startsWith('..') && !rel.includes(':');
};

test('three buckets: real files in an isolated data root are scanned as ok', { skip: skipReason }, async () => {
  const response = await fetch(`${url}/dsh-pet-7340/skin/main/resources`);
  assert.equal(response.status, 200);
  const body = await response.json();
  const dump = () => JSON.stringify(body);

  for (const kind of ['layered', 'live2d', 'webm']) {
    const bucket = body.renderers[kind];
    assert.equal(bucket.status, 'ok', `${kind} 桶里有真素材，必须是 ok（实际 ${bucket.status}）`);
    assert.ok(bucket.count >= 1, `${kind} 桶至少要数出一个资源，实际 ${bucket.count}`);
    assert.deepEqual(bucket.missingFiles, [], `${kind} 桶非空时不该再报缺文件`);
    assert.ok(insideDataRoot(bucket.dir), `${kind} 桶的 dir 必须指向临时数据根，实际 ${bucket.dir}`);
  }

  assert.deepEqual(
    body.renderers.layered.items.map((item) => item.id),
    [layeredId],
    '拷进来的真实皮肤 id 必须原样出现在池清单里',
  );
  assert.deepEqual(
    body.renderers.live2d.items.map((item) => item.id),
    [LIVE2D_ID],
    'live2d 的 id 是相对池桶的 model3 路径',
  );
  assert.deepEqual(
    body.renderers.webm.items.map((item) => item.id),
    ['loop'],
    'webm 的 id 是去扩展名的文件名',
  );

  // 真文件不是空壳：webm 必须是 EBML 容器（1A 45 DF A3），否则「count>=1」只是数了个空文件。
  const webmBytes = readFileSync(join(dataRoot, 'assets', 'pet', 'webm', 'loop.webm'));
  assert.ok(webmBytes.length > 1024, '拷进来的 webm 应当是一段真动画，而不是占位文件');
  assert.deepEqual([...webmBytes.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3], 'webm 的文件头必须是 EBML');
});

test('render card: layered and live2d ids are selectable in the model dropdown', { skip: skipReason }, async (t) => {
  const page = await open(t);
  await page.getByRole('tab', { name: /^Look & feel/ }).click();

  const rendererTrigger = page.locator('.dsh-pet-sel__trigger[aria-label="Renderer"]');
  const modelTrigger = page.locator('.dsh-pet-sel__trigger[aria-label="Model / skin"]');
  await modelTrigger.waitFor();

  // 1) 当前渲染方式是 layered：模型下拉里能选到拷进来的真实皮肤，选中后触发器的文案跟着变。
  const optionName = (id) => new RegExp('^' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' · ');
  await modelTrigger.click();
  const layeredOption = page.getByRole('option', { name: optionName(layeredId) });
  await layeredOption.waitFor();
  await layeredOption.click();
  await page.waitForFunction(
    (id) =>
      document.querySelector('.dsh-pet-sel__trigger[aria-label="Model / skin"] .dsh-pet-sel__label')?.textContent ===
      id + ' · pool',
    layeredId,
  );

  // 2) 把渲染方式切到 live2d：同一个下拉换成 live2d 桶的条目，仍能选中。
  await rendererTrigger.click();
  await page.getByRole('option', { name: /live2d/ }).click();
  await modelTrigger.click();
  const live2dOption = page.getByRole('option', { name: optionName(LIVE2D_ID) });
  await live2dOption.waitFor();
  await live2dOption.click();
  await page.waitForFunction(
    (id) =>
      document.querySelector('.dsh-pet-sel__trigger[aria-label="Model / skin"] .dsh-pet-sel__label')?.textContent ===
      id + ' · pool',
    LIVE2D_ID,
  );

  // 3) webm：渲染方式本身可选，但「模型 / 皮肤」对 webm 是**故意禁用**的（走动画池，没有模型这一维），
  //    卡片给出解释文案。这是产品行为：webm 桶的 id 不经过这个下拉。
  await rendererTrigger.click();
  await page.getByRole('option', { name: /webm/ }).click();
  await page.waitForFunction(
    () => document.querySelector('.dsh-pet-sel__trigger[aria-label="Model / skin"]')?.disabled === true,
  );
  assert.equal(await modelTrigger.isDisabled(), true, 'webm 下模型下拉禁用');
  assert.equal(await modelTrigger.locator('.dsh-pet-sel__label').innerText(), '', 'webm 下模型值为空');
  // 说明文案是悬浮气泡（挂在字段标签的 `data-tip` 上），不是可见段落：按属性断言，别去正文里找。
  const hint = await page.evaluate(() => {
    const trigger = document.querySelector('.dsh-pet-sel__trigger[aria-label="Model / skin"]');
    const field = trigger?.closest('.dsh-pet-cfg__field');
    return field?.querySelector('.dsh-pet-cfg__flabel')?.getAttribute('data-tip') ?? '';
  });
  assert.match(hint, /webm plays from the animation pool/, 'webm 没有独立模型，卡片要说明它走动画池');
});

test('first frame: the real layered skin draws a non-blank canvas', { skip: skipReason }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 480, height: 480 }, deviceScaleFactor: 1 });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));

  await page.goto(`${url}/?fixture=layered`);
  // 挂载会先 fetch 清单与全部图层 PNG；失败时 __error 一定非空，别用固定 sleep 掩盖。
  await page.waitForFunction(() => window.__ready === true || typeof window.__error === 'string', null, {
    timeout: 15000,
  });
  assert.equal(await page.evaluate(() => window.__error ?? ''), '', '分层渲染器不该报错');
  const stats = await page.evaluate(() => window.__stats());

  // 判据（阈值都按本机真皮肤实测留了余量，不是「永远为真」）：
  // 同一套 feiyu-05 皮肤在 320×320 后备画布上实测不透明像素 28.1%、12-bit 量化后 262 种颜色。
  // 空白画布：0 个不透明像素 / 0 种颜色；纯色矩形：100% 不透明但只有 1 种颜色。
  // 因此 ratio ≥ 5%（实测的 1/5.6）足以放过真画，colors ≥ 32（实测的 1/8）足以否掉纯色；
  // 再要求不透明包围盒覆盖画布 ≥ 20%，防止「角落里一个小点」靠比例侥幸通过。
  assert.ok(stats.w > 0 && stats.h > 0, '画布必须有后备分辨率');
  assert.ok(stats.ratio >= 0.05, `不透明像素占比 ${stats.ratio.toFixed(3)} 低于 5%：画面接近空白`);
  assert.ok(stats.colors >= 32, `颜色种类只有 ${stats.colors}：更像纯色块而不是分层皮肤`);
  assert.ok(stats.boxW / stats.w >= 0.2, `不透明区域宽度只占 ${(stats.boxW / stats.w).toFixed(2)}`);
  assert.ok(stats.boxH / stats.h >= 0.2, `不透明区域高度只占 ${(stats.boxH / stats.h).toFixed(2)}`);
});
