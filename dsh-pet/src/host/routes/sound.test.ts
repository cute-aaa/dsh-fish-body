/**
 * 音效索引与音效文件路由（src/host/routes/sound.ts + assets 的 /sound 分支）：
 * 目录链优先级、皮肤归属、扩展名白名单与路径守卫。
 * 用临时目录搭出「皮肤根 / -sound / 动画目录 / 包内默认」四层，不依赖真实素材。
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { handleSoundRoutes } from './sound.ts';
import { handleAssetsRoutes } from './assets.ts';
import type { PetRouteDeps } from './types.ts';
import type { RouteResult } from '../http.ts';

let dir = '';
let skinDir = '';
let soundDir = '';
let animDir = '';
let packageDir = '';

/** 依赖：soundDirsFor 指向临时目录，其余字段本领域不读。 */
const deps = (): PetRouteDeps =>
  ({
    soundDirsFor: () => ({
      skinDir,
      soundDir,
      packageSoundDir: packageDir,
      animationDirs: [animDir],
    }),
    petConfigDir: dir,
  }) as unknown as PetRouteDeps;

/** 写一个空文件（内容无关，路由只看路径与扩展名）。 */
const touch = (path: string): void => writeFileSync(path, Buffer.alloc(8));

/** 调一次索引。 */
function index(rest = 'sound/main/index', query = '?renderer=webm'): Promise<RouteResult | undefined> {
  return handleSoundRoutes(deps(), {
    url: new URL('http://localhost/' + rest + query),
    rest,
    method: 'GET',
  });
}

/** 调一次素材读取。 */
function asset(rest: string, query = ''): Promise<RouteResult | undefined> {
  return handleAssetsRoutes(deps(), { url: new URL('http://localhost/' + rest + query), rest, method: 'GET' });
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-sound-'));
});

beforeEach(() => {
  rmSync(dir, { recursive: true, force: true });
  skinDir = join(dir, 'main-skin');
  soundDir = join(dir, 'main-sound');
  animDir = join(dir, 'main-animation');
  packageDir = join(dir, 'package-sound');
  for (const path of [skinDir, soundDir, animDir, packageDir]) mkdirSync(path, { recursive: true });
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('handleSoundRoutes —— 索引', () => {
  test('按搜索链解析：皮肤目录 > -sound > 动画同目录 > 包内默认', async () => {
    mkdirSync(join(skinDir, 'beiluoye'), { recursive: true });
    touch(join(skinDir, 'beiluoye', 'click.wav'));
    touch(join(soundDir, 'click.mp3'));
    touch(join(animDir, '写代码.wav'));
    touch(join(packageDir, 'throw.wav'));
    const result = await index('sound/main/index', '?renderer=layered&model=beiluoye');
    assert.ok(result !== undefined && result.kind === 'json');
    const body = result.obj as { ok: boolean; events: Record<string, string>; animations: Record<string, string> };
    assert.equal(body.ok, true);
    assert.equal(body.events.click, 'click.wav', '皮肤目录里的文件赢');
    assert.equal(body.animations['写代码'], '写代码.wav');
    assert.equal(body.events.throw, 'throw.wav');
    // 没匹配到的槽回落到内置默认
    assert.equal(body.events.pet, 'pet-bump.wav');
  });

  test('未知渲染方式与非法素材根：400 级失败实体', async () => {
    const bad = await index('sound/main/index', '?renderer=canvas');
    assert.ok(bad !== undefined && bad.kind === 'json');
    assert.equal((bad.obj as { reason: string }).reason, 'bad-request');
    const root = await index('sound/evil\\root/index');
    assert.ok(root !== undefined && root.kind === 'json');
    assert.equal((root.obj as { reason: string }).reason, 'bad-request');
  });

  test('非索引的 sound 路径不由本处理器接管', async () => {
    assert.equal(await index('sound/main/click.wav'), undefined);
  });
});

describe('handleAssetsRoutes —— /sound 文件', () => {
  test('带 model：先查该皮肤目录，再回落 -sound 与包内', async () => {
    mkdirSync(join(skinDir, 'beiluoye'), { recursive: true });
    touch(join(skinDir, 'beiluoye', 'click.wav'));
    touch(join(soundDir, 'drag.wav'));
    touch(join(packageDir, 'throw.wav'));
    const skin = await asset('sound/main/click.wav', '?model=beiluoye');
    assert.ok(skin !== undefined && skin.kind === 'file');
    assert.equal(skin.file, join(skinDir, 'beiluoye', 'click.wav'));
    const shared = await asset('sound/main/drag.wav');
    assert.ok(shared !== undefined && shared.kind === 'file');
    assert.equal(shared.file, join(soundDir, 'drag.wav'));
    const fallback = await asset('sound/main/throw.wav');
    assert.ok(fallback !== undefined && fallback.kind === 'file');
    assert.equal(fallback.file, join(packageDir, 'throw.wav'));
  });

  test('旧形式 /sound/<file> 等价于 main 的包内默认', async () => {
    touch(join(packageDir, 'click-duck.wav'));
    const result = await asset('sound/click-duck.wav');
    assert.ok(result !== undefined && result.kind === 'file');
    assert.equal(result.file, join(packageDir, 'click-duck.wav'));
  });

  test('白名单外扩展名 400；不存在 404；非法 model 400', async () => {
    touch(join(packageDir, 'note.txt'));
    const bad = await asset('sound/main/note.txt');
    assert.ok(bad !== undefined && bad.kind === 'text');
    assert.equal(bad.status, 400);
    const missing = await asset('sound/main/nope.wav');
    assert.ok(missing !== undefined && missing.kind === 'text');
    assert.equal(missing.status, 404);
    const evil = await asset('sound/main/click.wav', '?model=' + encodeURIComponent('../x'));
    assert.ok(evil !== undefined && evil.kind === 'text');
    assert.equal(evil.status, 400);
  });
});

describe('索引与文件路由的口径一致', () => {
  test('索引里点名的文件一定能被 /sound 取到', async () => {
    mkdirSync(join(skinDir, 'a'), { recursive: true });
    touch(join(skinDir, 'a', 'drag.wav'));
    const result = await index('sound/main/index', '?renderer=layered&model=a');
    assert.ok(result !== undefined && result.kind === 'json');
    const events = (result.obj as { events: Record<string, string> }).events;
    for (const file of Object.values(events)) {
      if (file === undefined) continue;
      const served = await asset('sound/main/' + encodeURIComponent(file), '?model=a');
      // 内置默认只在包内目录真实存在时才 200；临时目录里没铺这些文件，这里只断言「白名单通过」。
      assert.ok(served !== undefined && served.kind !== 'json', file + ' 应被路由接受');
      if (served.kind === 'text') assert.notEqual(served.status, 400, file + ' 不该被判成格式非法');
    }
  });
});
