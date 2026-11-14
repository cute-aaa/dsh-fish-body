/**
 * 池路径（src/host/pool/resolve.ts）的契约：池根解析、资源目录定位、逃逸守卫与可读路径。
 * 纯字符串/路径计算，不碰磁盘。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isAbsolute, join, resolve, sep } from 'node:path';

import {
  displayPathOf,
  insideRoot,
  poolEntryDir,
  poolGlobalSoundDir,
  poolLayerDir,
  poolRendererSoundDir,
  poolWebmFile,
  resolvePoolRoot,
} from './resolve.ts';

// 用带盘符的绝对路径（Windows 上 join(sep,'u') 只有根没有盘符，resolve 比对会多出盘符）。
const USER = resolve(sep, 'u', 'fish-body');

describe('resolvePoolRoot', () => {
  test('缺省 / 空串 / 非法：回落 <用户根>/assets/pet', () => {
    assert.equal(resolvePoolRoot(USER, undefined), join(USER, 'assets', 'pet'));
    assert.equal(resolvePoolRoot(USER, {}), join(USER, 'assets', 'pet'));
    assert.equal(resolvePoolRoot(USER, { pool: '   ' }), join(USER, 'assets', 'pet'));
    assert.equal(resolvePoolRoot(USER, { pool: 42 }), join(USER, 'assets', 'pet'));
    assert.equal(resolvePoolRoot(USER, 'nope'), join(USER, 'assets', 'pet'));
  });

  test('相对路径拼在用户根下；绝对路径原样使用', () => {
    assert.equal(resolvePoolRoot(USER, { pool: 'assets/pet' }), join(USER, 'assets', 'pet'));
    // 旧默认值（我们自己写进用户配置的）按默认处理，避免升级后池指向一个空目录：
    assert.equal(resolvePoolRoot(USER, { pool: 'assets/skin' }), join(USER, 'assets', 'pet'));
    assert.equal(resolvePoolRoot(USER, { pool: 'skin' }), join(USER, 'assets', 'pet'));
    assert.equal(resolvePoolRoot(USER, { pool: 'my-pool' }), join(USER, 'my-pool'));
    const abs = join(sep, 'mnt', 'pool');
    assert.equal(resolvePoolRoot(USER, { pool: abs }), abs);
    assert.equal(isAbsolute(resolvePoolRoot(USER, { pool: abs })), true);
  });
});

describe('insideRoot', () => {
  test('层内片段通过，空片段与逃逸片段被拒', () => {
    assert.equal(insideRoot(USER, 'layered/character1'), join(USER, 'layered', 'character1'));
    assert.equal(insideRoot(USER, '..'), undefined);
    assert.equal(insideRoot(USER, 'a/../../b'), undefined);
    assert.equal(insideRoot(USER, ''), undefined);
    assert.equal(insideRoot(USER, '   '), undefined);
  });

  test('绝对路径被当作根内相对片段解析，逃出去就拒', () => {
    const outside = join(sep, 'etc', 'passwd');
    assert.equal(insideRoot(USER, outside), undefined);
  });
});

describe('池目录派生', () => {
  const root = join(USER, 'assets', 'pet');

  test('渲染方式目录与音效目录', () => {
    assert.equal(poolLayerDir(root, 'layered'), join(root, 'layered'));
    assert.equal(poolLayerDir(root, 'live2d'), join(root, 'live2d'));
    assert.equal(poolLayerDir(root, 'webm'), join(root, 'webm'));
    assert.equal(poolRendererSoundDir(root, 'layered'), join(root, 'layered', 'sound'));
    assert.equal(poolGlobalSoundDir(root), join(root, 'sound'));
  });

  test('layered 资源目录 = layered/<model>', () => {
    assert.equal(poolEntryDir(root, 'layered', 'character1'), join(root, 'layered', 'character1'));
    assert.equal(poolEntryDir(root, 'layered', ''), undefined);
  });

  test('live2d 资源目录 = 模型所在目录；模型直接在层根时就是层根', () => {
    assert.equal(poolEntryDir(root, 'live2d', 'model1/xx.model3.json'), join(root, 'live2d', 'model1'));
    assert.equal(poolEntryDir(root, 'live2d', 'xx.model3.json'), join(root, 'live2d'));
    assert.equal(poolEntryDir(root, 'live2d', ''), undefined);
  });

  test('webm 没有资源目录；平铺文件按名拼', () => {
    assert.equal(poolEntryDir(root, 'webm', 'movie1'), undefined);
    assert.equal(poolWebmFile(root, 'movie1', '.webm'), join(root, 'webm', 'movie1.webm'));
    assert.equal(poolWebmFile(root, '', '.webm'), undefined);
  });

  test('反斜杠形式的 model 被规范化后再拼（不会被当成绝对路径）', () => {
    assert.equal(poolEntryDir(root, 'layered', 'a\\b'), join(root, 'layered', 'a', 'b'));
    assert.equal(poolEntryDir(root, 'layered', '..\\..\\x'), undefined);
  });
});

describe('displayPathOf', () => {
  test('用户根内折成 posix 相对路径；根外原样给绝对路径', () => {
    assert.equal(displayPathOf(USER, join(USER, 'assets', 'pet', 'sound', 'click.wav')), 'assets/pet/sound/click.wav');
    const outside = join(sep, 'mnt', 'pool', 'sound', 'click.wav');
    assert.equal(displayPathOf(USER, outside), outside.replace(/\\/g, '/'));
  });
});
