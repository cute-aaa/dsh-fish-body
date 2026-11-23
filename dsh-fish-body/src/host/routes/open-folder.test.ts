/**
 * 「打开素材文件夹」的两层契约（src/host/open-folder.ts 与 routes/open-folder.ts）：
 * 类别 → 目录的映射、非法类别、目录不存在时不假装成功，以及成功时真的把路径交给 openDir。
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { handleOpenFolderRoutes } from './open-folder.ts';
import { parseFolderTarget, resolveFolderTarget, resolveGlobalFolder } from '../open-folder.ts';
import { userPaths } from '../user-layout.ts';
import type { PetRouteDeps } from './types.ts';
import type { RouteResult } from '../http.ts';

let dir = '';
let soundDir = '';
let skinDir = '';
let animationDir = '';
/** 被真正打开的目录（按调用顺序）。 */
const opened: string[] = [];

/** 路由依赖：requirePet 直给命中，soundDirsFor 指向临时目录。 */
const deps = (entry = 'main', pet: Record<string, unknown> = { model: 'beiluoye' }): PetRouteDeps =>
  ({
    configPaths: {
      defaultFile: fileURLToPath(new URL('../../../assets/config.jsonc', import.meta.url)),
      userFile: join(dir, 'main-config.jsonc'),
      petDir: join(dir, 'pet'),
    },
    requirePet: (params: URLSearchParams) =>
      params.get('pet') === 'main'
        ? { ok: true, petId: 'main', entry, conf: {}, pet }
        : { ok: false, res: { kind: 'json', status: 200, obj: { ok: false, reason: 'unknown-pet' } } },
    soundDirsFor: () => ({
      animationDirs: [animationDir],
      packageSoundDir: join(dir, 'package-sound'),
      ...(entry === 'main' ? { userSoundDir: join(dir, 'user-sound') } : {}),
      skinDir,
      soundDir,
      poolGlobalSoundDir: join(dir, 'skin', 'sound'),
      poolRendererSoundDir: join(dir, 'skin', 'layered', 'sound'),
      poolSkinDir: join(dir, 'skin', 'layered', 'beiluoye'),
      poolSkinLayerDir: join(dir, 'skin', 'layered'),
      poolSkinName: 'beiluoye',
      poolWebmDir: join(dir, 'skin', 'webm'),
    }),
    openDir: (path: string) => opened.push(path),
    // 全局类别（pool-root / animations / memes / root / config / data / cache / runtime / pets / assets）
    // 直接取数据根的路径表，池根随配置单独传。
    paths: userPaths(dir),
    poolRoot: () => join(dir, 'assets', 'skin'),
  }) as unknown as PetRouteDeps;

/** 调一次路由。 */
function call(query: string, method = 'POST', pet?: Record<string, unknown>): Promise<RouteResult | undefined> {
  const rest = 'open-folder';
  return handleOpenFolderRoutes(deps('main', pet), { url: new URL('http://localhost/' + rest + query), rest, method });
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-open-folder-'));
  soundDir = join(dir, 'main-sound');
  skinDir = join(dir, 'main-skin');
  animationDir = join(dir, 'main-animation', 'webm');
  mkdirSync(join(dir, 'pet'), { recursive: true });
  mkdirSync(soundDir, { recursive: true });
  mkdirSync(animationDir, { recursive: true });
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('resolveFolderTarget —— 类别到目录', () => {
  const dirs = {
    animationDirs: ['/a/webm'],
    packageSoundDir: '/pkg/sound',
    soundDir: '/root-sound',
    skinDir: '/root-skin',
    userSoundDir: '/user-sound',
  };

  test('五类各自落到对应目录，皮肤在皮肤根下再拼一层', () => {
    assert.equal(resolveFolderTarget(dirs, 'sound', ''), '/root-sound');
    assert.equal(resolveFolderTarget(dirs, 'skin', 'beiluoye'), join('/root-skin', 'beiluoye'));
    assert.equal(resolveFolderTarget(dirs, 'skin', ''), '/root-skin', '根布局没有皮肤层');
    assert.equal(resolveFolderTarget(dirs, 'animation', ''), '/a/webm');
    assert.equal(resolveFolderTarget(dirs, 'user', ''), '/user-sound');
    assert.equal(resolveFolderTarget(dirs, 'package', ''), '/pkg/sound');
  });

  test('该素材根没有这一类目录时给 null', () => {
    const bare = { animationDirs: [], packageSoundDir: '/pkg/sound' };
    assert.equal(resolveFolderTarget(bare, 'sound', ''), null);
    assert.equal(resolveFolderTarget(bare, 'skin', ''), null);
    assert.equal(resolveFolderTarget(bare, 'user', ''), null);
    assert.equal(resolveFolderTarget(bare, 'animation', ''), null);
  });

  test('parseFolderTarget：只收白名单里的词', () => {
    assert.equal(parseFolderTarget('sound'), 'sound');
    assert.equal(parseFolderTarget(' sound '), 'sound');
    assert.equal(parseFolderTarget('skin'), 'skin');
    assert.equal(parseFolderTarget('C:/Windows'), null);
    assert.equal(parseFolderTarget(null), null);
  });
});

describe('handleOpenFolderRoutes', () => {
  test('目录存在：回 ok 并把路径交给 openDir', async () => {
    opened.length = 0;
    const result = await call('?pet=main&which=sound');
    assert.ok(result !== undefined && result.kind === 'json');
    assert.deepEqual(result.obj, { ok: true, which: 'sound', path: soundDir });
    assert.deepEqual(opened, [soundDir]);
  });

  test('目录不存在：not-found，不打开任何东西', async () => {
    opened.length = 0;
    const result = await call('?pet=main&which=skin');
    assert.ok(result !== undefined && result.kind === 'json');
    const obj = result.obj as { ok: boolean; reason: string; message: string; path: string };
    assert.equal(obj.ok, false);
    assert.equal(obj.reason, 'not-found');
    assert.match(obj.message, /main-skin/, '说明里要带上算出来的路径');
    assert.equal(obj.path, join(skinDir, 'beiluoye'), '失败体也要带出路径，设置页的气泡才知道建哪个');
    assert.deepEqual(opened, []);
  });

  test('create=1：先建目录再打开，并回 created', async () => {
    opened.length = 0;
    const result = await call('?pet=main&which=skin&create=1');
    assert.ok(result !== undefined && result.kind === 'json');
    const obj = result.obj as { ok: boolean; which: string; path: string; created: boolean };
    assert.equal(obj.ok, true);
    assert.equal(obj.which, 'skin');
    assert.equal(obj.created, true);
    assert.equal(obj.path, join(skinDir, 'beiluoye'));
    assert.deepEqual(opened, [join(skinDir, 'beiluoye')], '建完要真的打开');
    const again = await call('?pet=main&which=skin');
    assert.ok(again !== undefined && again.kind === 'json', '再点一次应该直接打开，不再问创建');
    assert.equal((again.obj as { ok: boolean }).ok, true);
  });

  test('which 非法 / 方法不对 / 未知宠物：各自回对应 reason', async () => {
    opened.length = 0;
    const bad = (await call('?pet=main&which=C%3A%2FWindows')) as { obj: { reason: string } };
    assert.equal(bad.obj.reason, 'bad-request');
    const wrongMethod = await call('?pet=main&which=sound', 'GET');
    assert.ok(wrongMethod !== undefined);
    const unknown = (await call('?pet=nope&which=sound')) as { obj: { reason: string } };
    assert.equal(unknown.obj.reason, 'unknown-pet');
    assert.deepEqual(opened, [], '这些分支都不该打开目录');
  });

  test('pet pack 没有用户共享目录：回 not-found 而不是回落到 main 的', async () => {
    const rest = 'open-folder';
    const result = await handleOpenFolderRoutes(deps('duck'), {
      url: new URL('http://localhost/' + rest + '?pet=main&which=user'),
      rest,
      method: 'POST',
    });
    assert.ok(result !== undefined && result.kind === 'json');
    assert.equal((result.obj as { reason: string }).reason, 'not-found');
  });
});

describe('资源池目录（which=pool-*）', () => {
  const poolLayered = join(dir, 'skin', 'layered', 'beiluoye');

  test('resolveFolderTarget：池的五个类别各落到对应目录', () => {
    const dirs = {
      animationDirs: [],
      packageSoundDir: '/pkg/sound',
      poolGlobalSoundDir: '/skin/sound',
      poolRendererSoundDir: '/skin/layered/sound',
      poolSkinDir: '/skin/layered/beiluoye',
      poolSkinLayerDir: '/skin/layered',
      poolWebmDir: '/skin/webm',
    };
    assert.equal(resolveFolderTarget(dirs, 'pool-layered', '', 'layered'), '/skin/layered/beiluoye');
    assert.equal(resolveFolderTarget(dirs, 'pool-live2d', '', 'layered'), null, '渲染方式不匹配');
    assert.equal(resolveFolderTarget(dirs, 'pool-webm', '', 'layered'), null);
    assert.equal(resolveFolderTarget(dirs, 'pool-sound', '', 'layered'), '/skin/layered/sound');
    assert.equal(resolveFolderTarget(dirs, 'pool-global-sound', '', 'layered'), '/skin/sound');
  });

  test('layered 宠物：pool-layered 不存在时回 not-found 并带出算好的路径', async () => {
    opened.length = 0;
    const result = await call('?pet=main&which=pool-layered', 'POST', { model: 'beiluoye', renderer: 'layered' });
    assert.ok(result !== undefined && result.kind === 'json');
    const obj = result.obj as { ok: boolean; reason: string; path: string };
    assert.equal(obj.ok, false);
    assert.equal(obj.reason, 'not-found');
    assert.equal(obj.path, poolLayered);
    assert.deepEqual(opened, []);
  });

  test('create=1：把池的资源目录建出来再打开', async () => {
    opened.length = 0;
    const result = await call('?pet=main&which=pool-layered&create=1', 'POST', {
      model: 'beiluoye',
      renderer: 'layered',
    });
    assert.ok(result !== undefined && result.kind === 'json');
    const obj = result.obj as { ok: boolean; path: string; created: boolean };
    assert.equal(obj.ok, true);
    assert.equal(obj.created, true);
    assert.equal(obj.path, poolLayered);
    assert.deepEqual(opened, [poolLayered]);
  });

  test('webm 宠物：pool-webm 指向平铺目录', async () => {
    opened.length = 0;
    const result = await call('?pet=main&which=pool-webm&create=1', 'POST', { renderer: 'webm' });
    assert.ok(result !== undefined && result.kind === 'json');
    assert.equal((result.obj as { path: string }).path, join(dir, 'skin', 'webm'));
  });

  test('webm 宠物：pool-layered 不适用 → not-found', async () => {
    const result = await call('?pet=main&which=pool-layered', 'POST', { renderer: 'webm' });
    assert.ok(result !== undefined && result.kind === 'json');
    assert.equal((result.obj as { reason: string }).reason, 'not-found');
  });
});

describe('全局目录（which=pool-root / animations / memes / user-root）', () => {
  /** 造全局类别请求：**不带** pet。 */
  const callGlobal = (which: string, create = false, method = 'POST') => {
    const rest = 'open-folder';
    const query = '?which=' + which + (create ? '&create=1' : '');
    return handleOpenFolderRoutes(deps(), { url: new URL('http://localhost/' + rest + query), rest, method });
  };

  test('resolveGlobalFolder：数据根的新旧类别各落到对应目录', () => {
    const paths = userPaths(join('C:', 'u', 'fish-body'));
    const dirs = { paths, pool: '/p' };
    // 池根随配置变，单独传；其余全部来自路径表
    assert.equal(resolveGlobalFolder('pool-root', dirs), '/p');
    assert.equal(resolveGlobalFolder('root', dirs), paths.root);
    assert.equal(resolveGlobalFolder('config', dirs), paths.configDir);
    assert.equal(resolveGlobalFolder('data', dirs), paths.dataDir);
    assert.equal(resolveGlobalFolder('cache', dirs), paths.cacheDir);
    assert.equal(resolveGlobalFolder('runtime', dirs), paths.runtimeDir);
    assert.equal(resolveGlobalFolder('skin-root', dirs), paths.skinsDir);
    // pets 是旧前端的类别名，仍指向同一个（改名后的）目录
    assert.equal(resolveGlobalFolder('pets', dirs), paths.skinsDir);
    assert.equal(resolveGlobalFolder('assets', dirs), paths.assetsDir);
    // 旧类别仍然可用，值指向新布局里的位置
    assert.equal(resolveGlobalFolder('user-root', dirs), paths.root);
    assert.equal(resolveGlobalFolder('animations', dirs), paths.animationDir);
    assert.equal(resolveGlobalFolder('memes', dirs), paths.memesDir);
    assert.equal(resolveGlobalFolder('fish-skin', dirs), paths.fishSkinDir);
  });

  test('不需要 pet：目录不存在时回 not-found 并带出算好的路径', async () => {
    opened.length = 0;
    const rest = 'open-folder';
    const fresh = join(dir, 'fresh-pool');
    const base = deps() as unknown as Record<string, unknown>;
    const target = { ...base, poolRoot: () => fresh } as unknown as PetRouteDeps;
    const result = await handleOpenFolderRoutes(target, {
      url: new URL('http://localhost/' + rest + '?which=pool-root'),
      rest,
      method: 'POST',
    });
    assert.ok(result !== undefined && result.kind === 'json');
    const obj = result.obj as { ok: boolean; reason: string; path: string };
    assert.equal(obj.ok, false);
    assert.equal(obj.reason, 'not-found');
    assert.equal(obj.path, fresh);
    assert.deepEqual(opened, []);
  });

  test('create=1：建出来再打开，回 created', async () => {
    opened.length = 0;
    const result = await callGlobal('memes', true);
    assert.ok(result !== undefined && result.kind === 'json');
    const obj = result.obj as { ok: boolean; which: string; path: string; created: boolean };
    assert.equal(obj.ok, true);
    assert.equal(obj.which, 'memes');
    assert.equal(obj.created, true);
    assert.equal(obj.path, userPaths(dir).memesDir);
    assert.deepEqual(opened, [userPaths(dir).memesDir]);
  });

  test('pool-root 用 deps.poolRoot() 的解析结果（不是写死的 skin）', async () => {
    const rest = 'open-folder';
    const custom = (path: string) => {
      const base = deps() as unknown as Record<string, unknown>;
      return { ...base, poolRoot: () => path } as unknown as PetRouteDeps;
    };
    const target = join(dir, 'elsewhere');
    const result = await handleOpenFolderRoutes(custom(target), {
      url: new URL('http://localhost/' + rest + '?which=pool-root&create=1'),
      rest,
      method: 'POST',
    });
    assert.ok(result !== undefined && result.kind === 'json');
    assert.equal((result.obj as { path: string }).path, target);
  });

  test('未知类别 / 方法不对：分别 400 与 405', async () => {
    const bad = await callGlobal('C%3A%2FWindows');
    assert.ok(bad !== undefined && bad.kind === 'json');
    assert.equal((bad.obj as { reason: string }).reason, 'bad-request');
    const wrongMethod = await callGlobal('pool-root', false, 'GET');
    assert.ok(wrongMethod !== undefined && wrongMethod.kind === 'json');
    assert.equal((wrongMethod.obj as { reason: string }).reason, 'method-not-allowed');
  });
});

test('三个皮肤桶类别：回用户皮肤目录 <根>/skin/<渲染方式>（内置池是回落，不作为打开目标）', () => {
  const paths = userPaths(join('C:', 'u', 'fish-body'));
  const pool = join('D:', 'skin', 'shared');
  const dirs = { paths, pool };
  assert.equal(resolveGlobalFolder('pool-bucket-layered', dirs), join(paths.skinsDir, 'layered'));
  assert.equal(resolveGlobalFolder('pool-bucket-live2d', dirs), join(paths.skinsDir, 'live2d'));
  assert.equal(resolveGlobalFolder('pool-bucket-webm', dirs), join(paths.skinsDir, 'webm'));
});
