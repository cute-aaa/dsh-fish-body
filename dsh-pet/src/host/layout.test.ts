/**
 * 初始化目录结构（src/host/layout.ts + src/host/user-layout.ts）的契约：
 * 目录清单的顺序与去重、按需创建、失败只记录不抛、`notes:false` 不写文件夹备注。
 * 用 mkdtemp 的临时目录，不碰真实用户根。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ensureUserLayout, userLayoutDirs } from './layout.ts';
import { userPaths, type UserPaths } from './user-layout.ts';

/** 池的三个渲染方式层（生产装配期传 `POOL_LAYER_DIR` 的值，这里只钉名字）。 */
const POOL_LAYERS = ['layered', 'live2d', 'webm'] as const;

/** 造一份临时用户根下的输入（`paths` 是唯一真源）。 */
function layoutOf(root: string, pool?: string) {
  return { paths: userPaths(root, pool === undefined ? {} : { pool }) };
}

/** 断言清单里包含某个目录。 */
function assertHas(dirs: readonly string[], dir: string): void {
  assert.ok(dirs.includes(dir), '缺 ' + dir);
}

describe('userLayoutDirs', () => {
  test('六个分组、Electron 运行时、素材子目录、池的层目录都算上', () => {
    const root = join('C:', 'u', 'fish-body');
    const paths = userPaths(root);
    const dirs = userLayoutDirs({ paths, poolLayerDirs: POOL_LAYERS });

    assert.equal(dirs[0], paths.root);
    for (const dir of [
      paths.configDir,
      paths.dataDir,
      paths.cacheDir,
      paths.voiceCacheDir,
      paths.downloadCacheDir,
      paths.desktopCacheDir,
      paths.runtimeDir,
      paths.electronDir,
      paths.skinsDir,
      paths.assetsDir,
      paths.animationDir,
      join(paths.animationDir, 'webm'),
      join(paths.animationDir, 'mov'),
      paths.soundDir,
      paths.memesDir,
      paths.fishSkinDir,
      paths.poolDir,
      join(paths.poolDir, 'layered'),
      join(paths.poolDir, 'live2d'),
      join(paths.poolDir, 'webm'),
      // 渲染方式的兜底音效目录（`<池>/<渲染方式>/sound`）与全局音效（`<池>/sound`）
      join(paths.poolDir, 'sound'),
      join(paths.poolDir, 'layered', 'sound'),
      join(paths.poolDir, 'live2d', 'sound'),
    ]) {
      assertHas(dirs, dir);
    }

    // 字面量再钉一遍：路径表与磁盘布局不能各说一套
    assert.equal(paths.configDir, join(root, 'config'));
    assert.equal(paths.mainConfig, join(root, 'config', 'main-config.jsonc'));
    assert.equal(paths.dataDir, join(root, 'data'));
    assert.equal(paths.voiceCacheDir, join(root, 'cache', 'voice'));
    assert.equal(paths.electronDir, join(root, 'runtime', 'electron'));
    assert.equal(paths.skinsDir, join(root, 'skin'));
    assert.equal(paths.animationDir, join(root, 'assets', 'animation'));
    assert.equal(paths.poolDir, join(root, 'assets', 'pet'));
    assert.equal(paths.fishSkinDir, join(root, 'assets', 'session-fish'));
  });

  test('去重：动画子目录关掉后清单里没有它，且全清单无重复', () => {
    const root = join('C:', 'u');
    const dirs = userLayoutDirs({ ...layoutOf(root), animSubdirs: [] });
    assert.equal(new Set(dirs).size, dirs.length);
    assert.equal(dirs.includes(join(root, 'assets', 'animation', 'webm')), false);
  });

  test('animSubdirs 覆盖缺省的 webm / mov', () => {
    const root = join('C:', 'u');
    const dirs = userLayoutDirs({ ...layoutOf(root), animSubdirs: ['mp4'] });
    assertHas(dirs, join(root, 'assets', 'animation', 'mp4'));
    assert.equal(dirs.includes(join(root, 'assets', 'animation', 'webm')), false);
    assert.equal(dirs.includes(join(root, 'assets', 'animation', 'mov')), false);
  });

  test('池根配到绝对路径时按那份路径建，不建数据根下的默认池', () => {
    const root = join('C:', 'u');
    const pool = join('D:', 'pets', 'shared');
    const dirs = userLayoutDirs({ ...layoutOf(root, pool), poolLayerDirs: POOL_LAYERS });
    assertHas(dirs, join(pool, 'layered'));
    assertHas(dirs, join(pool, 'sound'));
    assert.equal(
      dirs.some((dir) => dir.startsWith(join(root, 'assets', 'pet'))),
      false,
    );
  });
});

describe('ensureUserLayout', () => {
  test('建出全部目录，第二次调用不再重复创建', () => {
    const root = mkdtempSync(join(tmpdir(), 'fish-body-layout-'));
    try {
      const input = { ...layoutOf(root), poolLayerDirs: POOL_LAYERS, notes: false };
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

  test('notes: false 时一个备注都不写（结果为空，磁盘上没有 desktop.ini）', () => {
    const root = mkdtempSync(join(tmpdir(), 'fish-body-layout-notes-'));
    try {
      const paths: UserPaths = userPaths(root);
      const result = ensureUserLayout({ paths, notes: false });
      assert.deepEqual(result.notes, {});
      for (const dir of [paths.root, paths.configDir, paths.dataDir, paths.cacheDir, paths.assetsDir]) {
        assert.equal(existsSync(join(dir, 'desktop.ini')), false, '不该写备注：' + dir);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('建不出来的目录只记录原因，不抛', () => {
    const root = mkdtempSync(join(tmpdir(), 'fish-body-layout-bad-'));
    try {
      // 拿一个普通文件当数据根：它下面的每一层都建不出来（EEXIST / ENOTDIR）
      const blockedRoot = join(root, 'blocked-root');
      writeFileSync(blockedRoot, 'x');
      const result = ensureUserLayout({ paths: userPaths(blockedRoot), notes: false });
      assert.equal(result.created.length, 0);
      assert.ok(result.failed.length > 0);
      assert.ok(result.failed.every((item) => item.dir.startsWith(blockedRoot)));
      assert.ok(result.failed.every((item) => item.error !== ''));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
