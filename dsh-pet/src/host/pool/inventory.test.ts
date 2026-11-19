/**
 * 渲染资源清单（readRenderResources）的单元测试：三个桶的存在性、目录、数量、回落与缺文件。
 *
 * 口径（QA-16 / QA-31 的共同判据）：`dir` 是本行的用户目录，`count`/`items` **只数 `dir`**；
 * 这只宠物的专用目录、其它池根与包内素材只能出现在 `fallback` 里。
 * 只构造临时目录，不碰真实素材。
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
    assert.equal(resources.layered.dir, join(pool, 'layered'), '行目录就是用户桶目录');
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

test('专用皮肤目录存在：count 仍是行目录的 0，专用目录的条目进 fallback(pack)', () => {
  const { dir, pool } = tempPool();
  try {
    const packSkin = join(dir, 'fish-skin');
    mkdirSync(join(packSkin, 'winter'), { recursive: true });
    writeFileSync(join(packSkin, 'winter', 'manifest.json'), '{}');
    writeFileSync(join(packSkin, 'fish.model3.json'), '{"Version":3}');
    put(join(pool, 'layered', 'character1', 'manifest.json'));

    const resources = readRenderResources({ poolRoot: pool, packSkinDir: packSkin });
    // 行目录仍是用户桶目录（行名 skin/layered 说的就是它）。
    assert.equal(resources.layered.dir, join(pool, 'layered'));
    assert.deepEqual(
      resources.layered.items.map((item) => [item.id, item.source]),
      [['character1', 'pool']],
      'count 只数行目录里的资源',
    );
    assert.deepEqual(resources.layered.fallback, { count: 1, source: 'pack' }, '专用目录的 winter 只能进回落');
    // 行目录里没有 live2d 模型 → count 0，模型进回落。
    assert.equal(resources.live2d.count, 0);
    assert.deepEqual(resources.live2d.fallback, { count: 1, source: 'pack' });
    // 有回落就算可用，不弹缺文件横幅。
    assert.equal(resources.live2d.status, 'ok');
    assert.deepEqual(resources.live2d.missingFiles, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('webm：fd 目录只数行目录，专属与包内动画分别进 fallback', () => {
  const { dir, pool } = tempPool();
  try {
    const packAnim = join(dir, 'fish-animation');
    mkdirSync(packAnim, { recursive: true });
    writeFileSync(join(packAnim, 'wave.webm'), 'x');
    put(join(pool, 'webm', 'wave.webm'), 'x');
    put(join(pool, 'webm', 'idle.webm'), 'x');
    const builtinAnim = join(dir, 'builtin-webm');
    mkdirSync(builtinAnim, { recursive: true });
    writeFileSync(join(builtinAnim, 'blink.webm'), 'x');

    const resources = readRenderResources({
      poolRoot: pool,
      animDirs: [
        { dir: packAnim, source: 'pack' },
        { dir: join(pool, 'webm'), source: 'pool' },
        { dir: builtinAnim, source: 'pool' },
      ],
    });
    assert.equal(resources.webm.dir, join(pool, 'webm'));
    assert.deepEqual(
      resources.webm.items.map((item) => [item.id, item.source]),
      [
        ['idle', 'pool'],
        ['wave', 'pool'],
      ],
      '只数行目录里的 webm',
    );
    // 回落：wave（专属目录，与行目录同名被去重）+ blink（包内）。
    assert.deepEqual(resources.webm.fallback, { count: 1, source: 'builtin' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('行目录空、其余来源都有货：status=ok + fallback 条数与来源', () => {
  const { dir, pool } = tempPool();
  try {
    const extraRoot = join(dir, 'builtin');
    put(join(extraRoot, 'layered', 'a', 'manifest.json'));
    put(join(extraRoot, 'layered', 'b', 'manifest.json'));
    const resources = readRenderResources({ poolRoot: pool, poolRoots: [pool, extraRoot] });
    assert.equal(resources.layered.count, 0);
    assert.equal(resources.layered.status, 'ok', '有回落就算可用');
    assert.deepEqual(resources.layered.fallback, { count: 2, source: 'builtin' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('无 manifest 的 rig 皮肤放进行目录：要被数成行目录资源，且不显示成「来自内置」', () => {
  const { dir, pool } = tempPool();
  try {
    // 行目录（用户 skin/layered）里放一个只有 rig/schema、没有 manifest 的皮肤：
    // 结构判定与池扫描同一套（pickStructure 认 rig/schema 键），只认 manifest 会数成 0。
    const rig = join(pool, 'layered', 'rig-only');
    mkdirSync(rig, { recursive: true });
    writeFileSync(join(rig, 'rig.json'), '{"rig":{"bones":[]}}');
    writeFileSync(join(rig, 'schema.json'), '{"schema":{"slots":[]}}');
    const builtin = join(dir, 'builtin');
    put(join(builtin, 'layered', 'builtin-skin', 'manifest.json'));

    const resources = readRenderResources({ poolRoot: pool, poolRoots: [pool, builtin] });
    assert.equal(resources.layered.count, 1, '行目录里的 rig 皮肤必须被数出来');
    assert.deepEqual(
      resources.layered.items.map((i) => [i.id, i.source]),
      [['rig-only', 'pool']],
    );
    assert.deepEqual(resources.layered.fallback, { count: 1, source: 'builtin' }, '只有另一个根的条目才算内置回落');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
