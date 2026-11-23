/**
 * 整棵目录搬迁（src/host/move-tree.ts）的契约：
 * 复制 → 核对 → 才删源；目标在源内部 / 目标非空 / 源不存在一律拒绝；
 * 核对对不上时**两份都留**（这是这个模块存在的全部理由，必须钉死）。
 * 用真实临时目录：这份代码的价值就在真实的文件复制与删除。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkMoveTarget, moveTree, type MoveProgress } from './move-tree.ts';

/** 一个隔离的目录。 */
function tempDir(prefix = 'fish-body-move-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** 造一棵小树：两层目录 + 两个文件。 */
function seed(dir: string): void {
  mkdirSync(join(dir, 'config'), { recursive: true });
  mkdirSync(join(dir, 'cache', 'voice'), { recursive: true });
  writeFileSync(join(dir, 'config', 'main-config.jsonc'), 'x'.repeat(64), 'utf8');
  writeFileSync(join(dir, 'cache', 'voice', 'a.mp3'), 'y'.repeat(32), 'utf8');
  writeFileSync(join(dir, 'logs.txt'), 'z', 'utf8');
}

describe('checkMoveTarget', () => {
  test('相同路径 / 目标在源内部 / 源在目标内部 都被拒', () => {
    assert.match(String(checkMoveTarget('D:/u/a', 'D:/u/a')), /相同/);
    assert.match(String(checkMoveTarget('D:/u/a', 'D:/u/a/b')), /内部/);
    assert.match(String(checkMoveTarget('D:/u/a/b', 'D:/u/a')), /内部/);
    assert.equal(checkMoveTarget('D:/u/a', 'E:/b'), undefined);
  });
});

describe('moveTree', () => {
  test('成功：内容搬到新位置，源目录消失，进度回调报出总量', () => {
    const base = tempDir();
    try {
      const from = join(base, 'fish-body');
      const to = join(base, 'moved');
      mkdirSync(from, { recursive: true });
      seed(from);
      const progress: MoveProgress[] = [];

      const result = moveTree(from, to, { onProgress: (p) => progress.push(p), progressIntervalMs: 0 });

      assert.equal(result.ok, true);
      assert.equal(readFileSync(join(to, 'config', 'main-config.jsonc'), 'utf8').length, 64);
      assert.equal(readFileSync(join(to, 'cache', 'voice', 'a.mp3'), 'utf8').length, 32);
      assert.equal(existsSync(from), false, '核对通过后源目录应当消失');
      const last = progress[progress.length - 1];
      assert.ok(last, '至少要报一次进度');
      assert.equal(last.totalFiles, 3);
      assert.equal(last.totalBytes, 64 + 32 + 1);
      assert.equal(last.copiedFiles, 3);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test('源不存在 / 目标已有内容：拒绝，且一个字节都不动', () => {
    const base = tempDir();
    try {
      const from = join(base, 'fish-body');
      const occupied = join(base, 'occupied');
      mkdirSync(from, { recursive: true });
      seed(from);
      mkdirSync(occupied, { recursive: true });
      writeFileSync(join(occupied, 'keep.txt'), 'keep', 'utf8');

      const missing = moveTree(join(base, 'nope'), join(base, 'target'));
      assert.equal(missing.ok, false);
      assert.equal(missing.ok === false && missing.reason, 'bad-request');

      const busy = moveTree(from, occupied);
      assert.equal(busy.ok, false);
      assert.equal(busy.ok === false && busy.reason, 'bad-request');
      assert.equal(readFileSync(join(occupied, 'keep.txt'), 'utf8'), 'keep');
      assert.equal(existsSync(join(from, 'config', 'main-config.jsonc')), true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test('目标在源内部：拒绝（否则复制会把自己写进自己的子树）', () => {
    const base = tempDir();
    try {
      const from = join(base, 'fish-body');
      mkdirSync(from, { recursive: true });
      seed(from);
      const result = moveTree(from, join(from, 'inner'));
      assert.equal(result.ok, false);
      assert.equal(result.ok === false && result.reason, 'bad-request');
      assert.equal(existsSync(join(from, 'inner')), false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test('空目录也能搬（不报错、不留下源）', () => {
    const base = tempDir();
    try {
      const from = join(base, 'empty');
      const to = join(base, 'empty-moved');
      mkdirSync(from, { recursive: true });
      const result = moveTree(from, to);
      assert.equal(result.ok, true);
      assert.equal(existsSync(to), true);
      assert.equal(existsSync(from), false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
