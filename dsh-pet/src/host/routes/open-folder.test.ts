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
import { parseFolderTarget, resolveFolderTarget } from '../open-folder.ts';
import type { PetRouteDeps } from './types.ts';
import type { RouteResult } from '../http.ts';

let dir = '';
let soundDir = '';
let skinDir = '';
let animationDir = '';
/** 被真正打开的目录（按调用顺序）。 */
const opened: string[] = [];

/** 路由依赖：requirePet 直给命中，soundDirsFor 指向临时目录。 */
const deps = (entry = 'main'): PetRouteDeps =>
  ({
    configPaths: {
      defaultFile: fileURLToPath(new URL('../../../assets/config.jsonc', import.meta.url)),
      userFile: join(dir, 'main-config.jsonc'),
      petDir: join(dir, 'pet'),
    },
    requirePet: (params: URLSearchParams) =>
      params.get('pet') === 'main'
        ? { ok: true, petId: 'main', entry, conf: {}, pet: { model: 'beiluoye' } }
        : { ok: false, res: { kind: 'json', status: 200, obj: { ok: false, reason: 'unknown-pet' } } },
    soundDirsFor: () => ({
      animationDirs: [animationDir],
      packageSoundDir: join(dir, 'package-sound'),
      ...(entry === 'main' ? { userSoundDir: join(dir, 'user-sound') } : {}),
      skinDir,
      soundDir,
    }),
    openDir: (path: string) => opened.push(path),
  }) as unknown as PetRouteDeps;

/** 调一次路由。 */
function call(query: string, method = 'POST'): Promise<RouteResult | undefined> {
  const rest = 'open-folder';
  return handleOpenFolderRoutes(deps(), { url: new URL('http://localhost/' + rest + query), rest, method });
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
