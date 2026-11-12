/**
 * hook 音效路由（src/host/routes/sfx.ts）：名字白名单、配置声明与磁盘匹配两条认可路径、
 * 未声明时回 unknown-hook、成功时写 `pets.<id>.sfx` 叶子。
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { handleSfxRoutes } from './sfx.ts';
import { fileURLToPath } from 'node:url';
import type { PetRouteDeps } from './types.ts';
import type { RouteResult } from '../http.ts';

let dir = '';
let soundDir = '';
const writes: Array<{ petId: string; leaf: string; data: unknown }> = [];

/** 一只带 hook 声明的宠物条目。 */
const conf = (hooks: Record<string, unknown>): Record<string, unknown> => ({ pets: [], sfx: { hooks } });

/** 路由依赖：requirePet 直给命中的宠物，state 只记写入。 */
const deps = (hooks: Record<string, unknown>, petId = 'main'): PetRouteDeps =>
  ({
    configPaths: {
      // 源码形态的 PACKAGE_ROOT 指向 src/，这里直接按相对路径取真实的包内默认配置。
      defaultFile: fileURLToPath(new URL('../../../assets/config.jsonc', import.meta.url)),
      userFile: join(dir, 'main-config.jsonc'),
      petDir: join(dir, 'pet'),
    },
    requirePet: (params: URLSearchParams) =>
      params.get('pet') === petId
        ? { ok: true, petId, entry: 'main', conf: conf(hooks), pet: { model: '' } }
        : { ok: false, res: { kind: 'json', status: 200, obj: { ok: false, reason: 'unknown-pet' } } },
    state: {
      writePet: (id: string, leaf: string, data: unknown) => writes.push({ petId: id, leaf, data }),
    },
    soundDirsFor: () => ({ animationDirs: [], soundDir, packageSoundDir: join(dir, 'package-sound') }),
    surfaceBlocked: () => null,
    lockBlocked: () => null,
  }) as unknown as PetRouteDeps;

/** 调一次 hook 路由。 */
function call(rest: string, query = '?pet=main', method = 'POST'): Promise<RouteResult | undefined> {
  return handleSfxRoutes(deps({ ding: { file: 'ding.wav' } }), {
    url: new URL('http://localhost/' + rest + query),
    rest,
    method,
  });
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-sfx-'));
  soundDir = join(dir, 'main-sound');
  mkdirSync(join(dir, 'pet'), { recursive: true });
  mkdirSync(soundDir, { recursive: true });
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('handleSfxRoutes —— 自定义 hook', () => {
  test('配置声明过的名字：写叶子并回 ok', async () => {
    writes.length = 0;
    const result = await call('sfx/ding');
    assert.ok(result !== undefined && result.kind === 'json');
    assert.equal((result.obj as { ok: boolean }).ok, true);
    assert.deepEqual(writes, [{ petId: 'main', leaf: 'sfx', data: { hook: 'ding' } }]);
  });

  test('磁盘上有 hook-<名字>.wav：同样认', async () => {
    writes.length = 0;
    writeFileSync(join(soundDir, 'hook-poke.wav'), Buffer.alloc(8));
    const result = await call('sfx/poke');
    assert.ok(result !== undefined && result.kind === 'json');
    assert.equal((result.obj as { ok: boolean }).ok, true);
    assert.equal(writes.length, 1);
  });

  test('既没声明也没文件：unknown-hook，不写叶子', async () => {
    writes.length = 0;
    const result = await call('sfx/nope');
    assert.ok(result !== undefined && result.kind === 'json');
    assert.equal((result.obj as { reason: string }).reason, 'unknown-hook');
    assert.equal(writes.length, 0);
  });

  test('名字非法与未知宠物：分别回 bad-request 与失败实体', async () => {
    const bad = await call('sfx/bad%20name');
    assert.ok(bad !== undefined && bad.kind === 'json');
    assert.equal((bad.obj as { reason: string }).reason, 'bad-request');
    const unknown = await call('sfx/ding', '?pet=other');
    assert.ok(unknown !== undefined && unknown.kind === 'json');
    assert.equal((unknown.obj as { reason: string }).reason, 'unknown-pet');
  });

  test('方法不对：405；非 sfx 路径不由本处理器接管', async () => {
    const wrong = await call('sfx/ding', '?pet=main', 'GET');
    assert.ok(wrong !== undefined && wrong.kind === 'json');
    assert.equal(wrong.status, 405);
    assert.equal(await call('anim'), undefined);
  });
});
