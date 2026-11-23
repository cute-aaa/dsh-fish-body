/**
 * 位置指针（src/host/locations.ts）的契约：
 * 读写 `config/locations.json`、解析皮肤 / 运行时目录、数据根指针的三级优先级（环境变量 > 指针 > 默认），
 * 以及「指针指向的目录不存在 → 回默认并报告」这条最容易出错的降级。
 * 用真实临时目录：这份代码的价值就在真实读写。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';

import {
  DEFAULT_ROOT_DIR_NAME,
  ROOT_POINTER_FILE,
  patchLocations,
  readLocations,
  readRootPointer,
  resolveRootDir,
  resolveRuntimeDir,
  resolveSkinDir,
  writeLocations,
  writeRootPointer,
} from './locations.ts';

/** 一个隔离的目录。 */
function tempDir(prefix = 'fish-body-loc-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('readLocations / writeLocations', () => {
  test('没有文件 → 空对象；写完能读回', () => {
    const root = tempDir();
    try {
      assert.deepEqual(readLocations(root), {});
      writeLocations(root, { skin: 'D:/skins' });
      assert.deepEqual(readLocations(root), { skin: normalize('D:/skins') });
      // 写出来的文件带 schema，方便以后加字段时判代数。
      const raw = JSON.parse(readFileSync(join(root, 'config', 'locations.json'), 'utf8')) as Record<string, unknown>;
      assert.equal(raw.schema, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('坏文件 / 非对象 / 空串字段：一律当没有，不让插件起不来', () => {
    const root = tempDir();
    try {
      mkdirSync(join(root, 'config'), { recursive: true });
      writeFileSync(join(root, 'config', 'locations.json'), '{broken', 'utf8');
      assert.deepEqual(readLocations(root), {});

      writeFileSync(join(root, 'config', 'locations.json'), '[1,2]', 'utf8');
      assert.deepEqual(readLocations(root), {});

      writeFileSync(join(root, 'config', 'locations.json'), JSON.stringify({ skin: '   ', runtime: 42 }), 'utf8');
      assert.deepEqual(readLocations(root), {});
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('patch 只改指定字段；null 表示删掉该覆盖', () => {
    const root = tempDir();
    try {
      writeLocations(root, { skin: 'D:/skins', runtime: 'E:/electron' });
      assert.deepEqual(patchLocations(root, { skin: 'F:/skins' }), {
        skin: normalize('F:/skins'),
        runtime: normalize('E:/electron'),
      });
      assert.deepEqual(patchLocations(root, { runtime: null }), { skin: normalize('F:/skins') });
      assert.deepEqual(patchLocations(root, {}), { skin: normalize('F:/skins') });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('resolve*Dir', () => {
  test('缺省回落到数据根下的约定位置', () => {
    assert.equal(resolveSkinDir('D:/u/fish-body', {}), join('D:/u/fish-body', 'skin'));
    assert.equal(resolveRuntimeDir('D:/u/fish-body', {}), join('D:/u/fish-body', 'runtime', 'electron'));
  });

  test('指针优先', () => {
    assert.equal(resolveSkinDir('D:/u/fish-body', { skin: 'E:/skins' }), 'E:/skins');
    assert.equal(resolveRuntimeDir('D:/u/fish-body', { runtime: 'F:/electron' }), 'F:/electron');
  });
});

describe('数据根指针', () => {
  test('写到 $DSH_HOME 下，能读回绝对路径', () => {
    const home = tempDir('fish-body-home-');
    try {
      writeRootPointer(home, 'E:/data/fish-body');
      assert.equal(readRootPointer(home), normalize('E:/data/fish-body'));
      assert.equal(existsSync(join(home, ROOT_POINTER_FILE)), true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('优先级：环境变量 > 指针 > 默认', () => {
    const home = tempDir('fish-body-home-');
    try {
      const custom = join(home, 'custom');
      mkdirSync(custom, { recursive: true });
      writeRootPointer(home, custom);

      assert.deepEqual(resolveRootDir({ dshHome: home, env: {} }), { root: custom, source: 'pointer' });
      assert.deepEqual(resolveRootDir({ dshHome: home, env: { DSH_PET_USER_ROOT: 'F:/env-root' } }), {
        root: normalize('F:/env-root'),
        source: 'env',
      });
      // 没指针时回默认位置
      const bare = tempDir('fish-body-home2-');
      try {
        assert.deepEqual(resolveRootDir({ dshHome: bare, env: {} }), {
          root: join(bare, DEFAULT_ROOT_DIR_NAME),
          source: 'default',
        });
      } finally {
        rmSync(bare, { recursive: true, force: true });
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('指针指向的目录不存在：回默认位置，并报告那个失效的指针', () => {
    const home = tempDir('fish-body-home-');
    try {
      writeRootPointer(home, join(home, 'gone'));
      const resolved = resolveRootDir({ dshHome: home, env: {} });
      assert.equal(resolved.root, join(home, DEFAULT_ROOT_DIR_NAME));
      assert.equal(resolved.source, 'default');
      assert.equal(resolved.stalePointer, join(home, 'gone'));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
