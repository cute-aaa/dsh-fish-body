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

/** 用户皮肤目录下的三个渲染方式子目录（生产装配期传 `POOL_LAYER_DIR` 的值，这里只钉名字）。 */
const SKIN_LAYERS = ['layered', 'live2d', 'webm'] as const;

/** 造一份临时用户根下的输入（`paths` 是唯一真源）。 */
function layoutOf(root: string, pool?: string) {
  return { paths: userPaths(root, pool === undefined ? {} : { pool }) };
}

/** 断言清单里包含某个目录。 */
function assertHas(dirs: readonly string[], dir: string): void {
  assert.ok(dirs.includes(dir), '缺 ' + dir);
}

describe('userLayoutDirs', () => {
  test('六个分组、Electron 运行时、素材子目录、用户皮肤的分类目录都算上', () => {
    const root = join('C:', 'u', 'fish-body');
    const paths = userPaths(root);
    const dirs = userLayoutDirs({ paths, skinLayerDirs: SKIN_LAYERS });

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
      // 用户皮肤按渲染方式分类：三类目录 + 共享音效层都在 `skin/` 下
      join(paths.skinsDir, 'layered'),
      join(paths.skinsDir, 'live2d'),
      join(paths.skinsDir, 'webm'),
      join(paths.skinsDir, 'sound'),
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

  test('内置池根（assets/pet）只建自己：不替用户分 layered / live2d / webm / sound', () => {
    const root = join('C:', 'u');
    const paths = userPaths(root);
    const dirs = userLayoutDirs({ paths, skinLayerDirs: SKIN_LAYERS });
    // 它必须是**扁平**的：建出分类子目录会让 pool/roots 的 layoutOf 把这个根判成池布局，
    // 反过来让用户直接平铺在 `assets/pet/<皮肤名>/` 的皮肤扫不到。
    for (const name of ['layered', 'live2d', 'webm', 'sound']) {
      assert.equal(
        dirs.includes(join(paths.poolDir, name)),
        false,
        '不该建 ' + name + '：' + join(paths.poolDir, name),
      );
    }
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
    const dirs = userLayoutDirs({ ...layoutOf(root, pool), skinLayerDirs: SKIN_LAYERS });
    assertHas(dirs, pool);
    assertHas(dirs, join(root, 'skin', 'layered'));
    // 池根只建自己（扁平）：分类目录永远在用户皮肤目录下，跟在不在数据根里无关。
    assert.equal(dirs.includes(join(pool, 'layered')), false);
    assert.equal(dirs.includes(join(pool, 'sound')), false);
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
      const input = { ...layoutOf(root), skinLayerDirs: SKIN_LAYERS, notes: false };
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
