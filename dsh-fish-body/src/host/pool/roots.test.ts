/**
 * 多素材根（src/host/pool/roots.ts）的契约：合并顺序、同 id 先到先得、一次请求内复用、
 * 「这个 model 落在哪个根」的定位。
 *
 * 这些行为决定两件用户能看见的事：清单里出现的是哪一套皮肤、点下去会不会 404。
 * 用临时目录搭真实布局，不依赖仓库素材。
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createPoolReader, poolEntryDirAcross, readPoolRootsOf } from './roots.ts';
import { readPool } from './scan.ts';

const roots: string[] = [];

/** 造一个临时池根。 */
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pet-pool-root-'));
  roots.push(root);
  return root;
}

/** 在某个根下写一个文件（自动建目录）。 */
function put(root: string, rel: string, body = '{}'): string {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('readPoolRootsOf —— 多根合并', () => {
  test('主根优先：同 id 资源先到先得，条目带来源根', () => {
    const primary = makeRoot();
    const extra = makeRoot();
    put(primary, join('layered', 'character1', 'manifest.json'));
    put(primary, join('webm', 'idle.webm'), 'x');
    put(extra, join('layered', 'character1', 'manifest.json'));
    put(extra, join('layered', 'character2', 'manifest.json'));
    put(extra, join('webm', 'extra.webm'), 'x');

    const scan = readPoolRootsOf([primary, extra]);
    assert.deepEqual(scan.roots, [primary, extra]);
    assert.equal(scan.root, primary, 'root 保持主根（回归字段）');
    // character1 两个根都有：用主根那份
    const winner = scan.layered.find((entry) => entry.id === 'character1');
    assert.equal(winner?.root, primary);
    assert.deepEqual(scan.layered.map((entry) => entry.id).sort(), ['character1', 'character2']);
    assert.deepEqual(scan.webm.map((entry) => entry.id).sort(), ['extra', 'idle']);
    assert.equal(scan.exists, true);
  });

  test('主根不存在但外部根有资源：照常可用（exists 是真）', () => {
    const primary = makeRoot();
    const extra = makeRoot();
    put(extra, join('layered', 'x', 'manifest.json'));
    const scan = readPoolRootsOf([join(primary, 'nope'), extra]);
    assert.equal(scan.layered.map((entry) => entry.id).join(','), 'x');
  });

  test('单根：退化成 readPool（roots 只有一项）', () => {
    const primary = makeRoot();
    put(primary, join('webm', 'a.webm'), 'x');
    const scan = readPoolRootsOf([primary]);
    assert.deepEqual(scan, readPool(primary));
  });

  test('空数组 = 空池，不抛', () => {
    const scan = readPoolRootsOf([]);
    assert.deepEqual(scan.layered, []);
    assert.deepEqual(scan.webm, []);
    assert.equal(scan.exists, false);
  });
});

describe('createPoolReader —— 一次请求内复用', () => {
  test('同一实例只扫一次（后续新增文件不改变结果）', () => {
    const primary = makeRoot();
    put(primary, join('webm', 'a.webm'), 'x');
    const reader = createPoolReader([primary]);
    assert.equal(reader.scan().webm.length, 1);
    put(primary, join('webm', 'b.webm'), 'x');
    assert.equal(reader.scan().webm.length, 1, '同实例复用扫描结果');
    assert.equal(readPool(primary).webm.length, 2, '新的一次扫描能看到新文件');
  });

  test('也接受单个根（老调用方传字符串）', () => {
    const primary = makeRoot();
    put(primary, join('webm', 'a.webm'), 'x');
    assert.equal(createPoolReader(primary).scan().webm.length, 1);
  });
});

describe('poolEntryDirAcross —— 这个 model 落在哪个根', () => {
  test('按根序找第一个存在的目录', () => {
    const primary = makeRoot();
    const extra = makeRoot();
    put(extra, join('layered', 'external', 'manifest.json'));
    assert.equal(poolEntryDirAcross([primary, extra], 'layered', 'external'), join(extra, 'layered', 'external'));
  });

  test('主根有同名资源时不会去外部根找', () => {
    const primary = makeRoot();
    const extra = makeRoot();
    put(primary, join('layered', 'same', 'manifest.json'));
    put(extra, join('layered', 'same', 'manifest.json'));
    assert.equal(poolEntryDirAcross([primary, extra], 'layered', 'same'), join(primary, 'layered', 'same'));
  });

  test('哪个根都没有 / 渲染方式不适用：返回 undefined', () => {
    const primary = makeRoot();
    assert.equal(poolEntryDirAcross([primary], 'layered', 'ghost'), undefined);
    assert.equal(poolEntryDirAcross([primary], 'webm', 'movie1'), undefined);
    assert.equal(poolEntryDirAcross([primary], 'layered', ''), undefined);
    assert.equal(poolEntryDirAcross([''], 'layered', 'x'), undefined);
  });
});

describe('外部根的两种布局', () => {
  test('皮肤集合目录（bare）：一级子目录就是一套皮肤', () => {
    const primary = makeRoot();
    const extra = makeRoot();
    put(extra, join('feiyu-01', 'manifest.json'));
    const scan = readPoolRootsOf([primary, extra]);
    assert.deepEqual(
      scan.layered.map((entry) => entry.id),
      ['feiyu-01'],
    );
    assert.equal(scan.layered[0]?.root, extra);
  });

  test('外部根自带 layered/：仍按标准池布局，不会把 layered 当皮肤名', () => {
    const primary = makeRoot();
    const extra = makeRoot();
    put(extra, join('layered', 'skin-a', 'manifest.json'));
    const scan = readPoolRootsOf([primary, extra]);
    assert.deepEqual(
      scan.layered.map((entry) => entry.id),
      ['skin-a'],
    );
  });

  test('bare 根里的皮肤目录按 <根>/<model> 定位（音效第 1 级因此能命中）', () => {
    const primary = makeRoot();
    const extra = makeRoot();
    put(extra, join('feiyu-01', 'manifest.json'));
    assert.equal(poolEntryDirAcross([primary, extra], 'layered', 'feiyu-01'), join(extra, 'feiyu-01'));
  });
});
