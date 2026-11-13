/**
 * 初始化目录结构（src/host/layout.ts）的契约：目录清单的顺序与去重、按需创建、失败只记录不抛。
 * 用 mkdtemp 的临时目录，不碰真实用户根。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ensureUserLayout, userLayoutDirs } from './layout.ts';

/** 造一份临时用户根下的输入。 */
function layoutOf(root: string, poolRoot = join(root, 'skin')) {
  return {
    animations: join(root, 'main-animation'),
    memes: join(root, 'memes'),
    poolRoot,
    userRoot: root,
  };
}

describe('userLayoutDirs', () => {
  test('用户根、动画子目录、表情包、池的四个约定目录都算上', () => {
    const root = join('C:', 'u', 'dsh-pet');
    const dirs = userLayoutDirs(layoutOf(root));
    assert.equal(dirs[0], root);
    assert.ok(dirs.includes(join(root, 'main-animation')));
    assert.ok(dirs.includes(join(root, 'main-animation', 'webm')));
    assert.ok(dirs.includes(join(root, 'main-animation', 'mov')));
    assert.ok(dirs.includes(join(root, 'memes')));
    assert.ok(dirs.includes(join(root, 'skin')));
    for (const sub of ['layered', 'live2d', 'webm', 'sound']) {
      assert.ok(dirs.includes(join(root, 'skin', sub)), '缺 ' + sub);
    }
    // 渲染方式的兜底音效目录（`<池>/<渲染方式>/sound`）：文档 §3 第 3 级的位置。
    assert.ok(dirs.includes(join(root, 'skin', 'layered', 'sound')));
    assert.ok(dirs.includes(join(root, 'skin', 'live2d', 'sound')));
    assert.ok(dirs.includes(join(root, 'skin', 'webm', 'sound')));
  });

  test('去重：动画子目录与池根重合时不重复', () => {
    const root = join('C:', 'u');
    const dirs = userLayoutDirs({ ...layoutOf(root), animSubdirs: [] });
    assert.equal(new Set(dirs).size, dirs.length);
    assert.equal(dirs.includes(join(root, 'main-animation', 'webm')), false);
  });

  test('池根配到绝对路径时按那份路径建', () => {
    const root = join('C:', 'u');
    const pool = join('D:', 'pets', 'shared');
    const dirs = userLayoutDirs({ ...layoutOf(root), poolRoot: pool });
    assert.ok(dirs.includes(join(pool, 'layered')));
    assert.ok(dirs.includes(join(pool, 'sound')));
    assert.equal(
      dirs.some((dir) => dir.startsWith(join(root, 'skin'))),
      false,
    );
  });
});

describe('ensureUserLayout', () => {
  test('建出全部目录，第二次调用不再重复创建', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-pet-layout-'));
    try {
      const input = layoutOf(root);
      const first = ensureUserLayout(input);
      assert.ok(first.created.length > 0);
      assert.deepEqual(first.failed, []);
      for (const dir of first.dirs) assert.ok(existsSync(dir), '没建出来：' + dir);
      const second = ensureUserLayout(input);
      assert.deepEqual(second.created, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('建不出来的目录只记录原因，不抛', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-pet-layout-bad-'));
    try {
      // 拿一个普通文件当目录：递归创建必然失败（EEXIST / ENOTDIR），必须落到 failed 里。
      const blocker = join(root, 'blocked');
      writeFileSync(blocker, 'x');
      const result = ensureUserLayout({ ...layoutOf(root), memes: join(blocker, 'memes') });
      assert.equal(result.created.length >= 0, true);
      assert.equal(result.failed.length > 0, true);
      assert.ok(result.failed.some((item) => item.dir.includes('blocked')));
      assert.ok(result.failed.every((item) => item.error !== ''));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
