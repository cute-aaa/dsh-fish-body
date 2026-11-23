/**
 * 音效层序（src/host/sfx/order.ts）的契约：池三层在最前、webm 平铺先于它的 sound/、
 * 旧布局按 皮肤 → -sound → 用户共享 → 动画 → 包内 的顺序收尾。
 * 纯数据断言：输入是目录集，不读盘。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join, sep } from 'node:path';

import { SOUND_ORIGIN_ORDER, soundCandidateDirs, soundLayerDirs } from './order.ts';
import type { SfxDirs } from './scan.ts';

const ROOT = join(sep, 'u', 'dsh-pet');

/** 一套「全都有」的目录集（main 链）。 */
const dirs = (patch: Partial<SfxDirs> = {}): SfxDirs => ({
  animationDirs: [join(ROOT, 'main-animation', 'webm'), join(ROOT, 'pkg', 'webm')],
  packageSoundDir: join(ROOT, 'pkg', 'sound'),
  skinDir: join(ROOT, 'pet', 'main-skin'),
  soundDir: join(ROOT, 'pet', 'main-sound'),
  userSoundDir: join(ROOT, 'main-sound'),
  ...patch,
});

describe('soundLayerDirs —— 层序', () => {
  test('池三层（资源目录 → 渲染兜底 → 全局）排在旧布局之前', () => {
    const layers = soundLayerDirs(
      dirs({
        poolGlobalSoundDir: join(ROOT, 'skin', 'sound'),
        poolRendererSoundDir: join(ROOT, 'skin', 'layered', 'sound'),
        poolSkinDir: join(ROOT, 'skin', 'layered', 'character1'),
      }),
      'character1',
    );
    assert.deepEqual(
      layers.map((layer) => layer.origin),
      [
        'pool-skin',
        'pool-renderer',
        'pool-global',
        'skin',
        'skin',
        'sound',
        'user',
        'animation',
        'animation',
        'package-default',
      ],
    );
    assert.equal(layers[0].dir, join(ROOT, 'skin', 'layered', 'character1'));
    assert.equal(layers[3].dir, join(ROOT, 'pet', 'main-skin', 'character1'), '旧皮肤目录先查具体皮肤');
    assert.equal(layers[4].dir, join(ROOT, 'pet', 'main-skin'), '再查皮肤根');
  });

  test('webm：平铺目录先于它的 sound/ 子目录', () => {
    const layers = soundLayerDirs(
      dirs({
        poolRendererSoundDir: join(ROOT, 'skin', 'webm', 'sound'),
        poolWebmDir: join(ROOT, 'skin', 'webm'),
      }),
      '',
    );
    assert.deepEqual(
      layers.slice(0, 2).map((layer) => layer.dir),
      [join(ROOT, 'skin', 'webm'), join(ROOT, 'skin', 'webm', 'sound')],
    );
    assert.deepEqual(
      layers.slice(0, 2).map((layer) => layer.origin),
      ['pool-renderer', 'pool-renderer'],
    );
  });

  test('没有池（老配置）时层序退化成旧链', () => {
    assert.deepEqual(
      soundLayerDirs(dirs(), 'beiluoye').map((layer) => layer.origin),
      ['skin', 'skin', 'sound', 'user', 'animation', 'animation', 'package-default'],
    );
  });

  test('model 为空串时不追加皮肤子目录', () => {
    assert.deepEqual(
      soundLayerDirs(dirs(), '')
        .map((layer) => layer.dir)
        .slice(0, 2),
      [join(ROOT, 'pet', 'main-skin'), join(ROOT, 'pet', 'main-sound')],
    );
  });

  test('层序与 SOUND_ORIGIN_ORDER 的标签集合一致（新增层必须两处一起改）', () => {
    const actual = new Set(
      soundLayerDirs(
        dirs({
          poolGlobalSoundDir: join(ROOT, 'skin', 'sound'),
          poolRendererSoundDir: join(ROOT, 'skin', 'layered', 'sound'),
          poolSkinDir: join(ROOT, 'skin', 'layered', 'c1'),
        }),
        'c1',
      ).map((layer) => layer.origin),
    );
    assert.deepEqual([...actual].sort(), [...SOUND_ORIGIN_ORDER].sort());
  });
});

describe('soundCandidateDirs', () => {
  test('与 soundLayerDirs 同序（取文件与建索引不能各写一套）', () => {
    const input = dirs({ poolGlobalSoundDir: join(ROOT, 'skin', 'sound') });
    assert.deepEqual(
      soundCandidateDirs(input, 'x'),
      soundLayerDirs(input, 'x').map((layer) => layer.dir),
    );
  });
});
