/**
 * 渲染资源清单（readRenderResources）的单元测试：三个桶的存在性、目录、数量与缺文件。
 *
 * 只构造临时目录，不碰真实素材；判定口径与 `/skin/<root>/skins|models` 同一份（见 routes/assets）。
 * @module dsh-fish-body/src/host/pool/inventory.test
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readRenderResources } from './inventory.ts';

/** 建一个临时池根（`<dir>/assets/pet`）。 */
function tempPool(): { dir: string; pool: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pool-inventory-'));
  const pool = join(dir, 'assets', 'pet');
  mkdirSync(pool, { recursive: true });
  return { dir, pool };
}

/** 写一个文件（自动建父目录）。 */
function put(path: string, body = '{}'): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

test('三桶：有清单 / 目录空 / 目录不存在', () => {
  const { dir, pool } = tempPool();
  try {
    put(join(pool, 'layered', 'character1', 'manifest.json'), '{"canvas":{"w":1,"h":1}}');
    put(join(pool, 'webm', 'wave.webm'), 'x');

    const resources = readRenderResources({ poolRoot: pool });
    assert.equal(resources.layered.status, 'ok');
    assert.equal(resources.layered.count, 1);
    assert.deepEqual(
      resources.layered.items.map((item) => [item.id, item.source]),
      [['character1', 'pool']],
    );
    assert.equal(resources.layered.dir, join(pool, 'layered'), '没有皮肤目录时给池桶目录');
    assert.deepEqual(resources.layered.missingFiles, []);

    assert.equal(resources.live2d.status, 'missing');
    assert.equal(resources.live2d.count, 0);
    assert.deepEqual(resources.live2d.missingFiles, ['*.model3.json']);
    assert.equal(resources.live2d.dir, join(pool, 'live2d'));

    assert.equal(resources.webm.status, 'ok');
    assert.deepEqual(
      resources.webm.items.map((item) => item.id),
      ['wave'],
    );

    // 目录在但没有 manifest：empty（而不是 missing），仍要报缺哪个文件。
    const onlyEmptyPool = join(dir, 'only-empty');
    mkdirSync(join(onlyEmptyPool, 'layered'), { recursive: true });
    const emptyLayer = readRenderResources({ poolRoot: onlyEmptyPool });
    assert.equal(emptyLayer.layered.status, 'empty');
    assert.deepEqual(emptyLayer.layered.missingFiles, ['manifest.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('皮肤目录存在时 dir 指向皮肤目录，items 先 pack 后池', () => {
  const { dir, pool } = tempPool();
  try {
    const packSkin = join(dir, 'fish-skin');
    mkdirSync(join(packSkin, 'winter'), { recursive: true });
    writeFileSync(join(packSkin, 'winter', 'manifest.json'), '{}');
    writeFileSync(join(packSkin, 'fish.model3.json'), '{"Version":3}');
    put(join(pool, 'layered', 'character1', 'manifest.json'));

    const resources = readRenderResources({ poolRoot: pool, packSkinDir: packSkin });
    assert.equal(resources.layered.dir, packSkin);
    assert.deepEqual(
      resources.layered.items.map((item) => [item.id, item.source]),
      [
        ['winter', 'pack'],
        ['character1', 'pool'],
      ],
    );
    assert.deepEqual(
      resources.live2d.items.map((item) => [item.id, item.source]),
      [['fish.model3.json', 'pack']],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('webm：多个候选目录合并去重，dir 取第一个存在的目录', () => {
  const { dir, pool } = tempPool();
  try {
    const packAnim = join(dir, 'fish-animation');
    mkdirSync(packAnim, { recursive: true });
    writeFileSync(join(packAnim, 'wave.webm'), 'x');
    put(join(pool, 'webm', 'wave.webm'), 'x');
    put(join(pool, 'webm', 'idle.webm'), 'x');

    const resources = readRenderResources({
      poolRoot: pool,
      animDirs: [
        { dir: packAnim, source: 'pack' },
        { dir: join(pool, 'webm'), source: 'pool' },
      ],
    });
    assert.equal(resources.webm.dir, packAnim);
    assert.deepEqual(
      resources.webm.items.map((item) => [item.id, item.source]),
      [
        ['wave', 'pack'],
        ['idle', 'pool'],
      ],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
