/**
 * 落地信息（src/host/sfx/paths.ts）的契约：命中路径必须是真实存在的那一份，
 * 命中池就不给建议，没命中池就给出「建议放这里」的类别、相对路径与绝对路径。
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { sfxPathsOf } from './paths.ts';
import type { SfxDirs } from './scan.ts';
import type { SfxIndex } from '../../shared/types.ts';

let userRoot = '';
let poolRoot = '';

const put = (path: string): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, Buffer.alloc(8));
};

/** 只有池的目录集（layered）。 */
const layeredDirs = (): SfxDirs => ({
  animationDirs: [join(userRoot, 'main-animation', 'webm')],
  packageSoundDir: join(userRoot, 'pkg-sound'),
  poolGlobalSoundDir: join(poolRoot, 'sound'),
  poolRendererSoundDir: join(poolRoot, 'layered', 'sound'),
  poolSkinDir: join(poolRoot, 'layered', 'character1'),
  poolSkinLayerDir: join(poolRoot, 'layered'),
  poolSkinName: 'character1',
  poolSkinStructures: ['xxx'],
});

/** 造一份只关心 events/origin/hooks 的索引。 */
const index = (patch: Partial<SfxIndex>): SfxIndex => ({
  animations: {},
  events: {},
  hooks: {},
  origin: {},
  ...patch,
});

before(() => {
  userRoot = mkdtempSync(join(tmpdir(), 'dsh-pet-sfx-paths-'));
  poolRoot = join(userRoot, 'skin');
});

beforeEach(() => {
  rmSync(userRoot, { recursive: true, force: true });
  mkdirSync(poolRoot, { recursive: true });
});

after(() => {
  rmSync(userRoot, { recursive: true, force: true });
});

describe('sfxPathsOf —— 命中路径', () => {
  test('事件槽命中池资源目录：paths 给绝对路径，且不再给建议', () => {
    const file = join(poolRoot, 'layered', 'character1', 'character1-click.wav');
    put(file);
    const landed = sfxPathsOf({
      dirs: layeredDirs(),
      index: index({ events: { click: 'character1-click.wav' }, origin: { click: 'pool-skin' } }),
      model: 'character1',
      renderer: 'layered',
      userRoot,
    });
    assert.equal(landed.paths.click, file);
    assert.equal(landed.suggestions.click, undefined, '已经在池里了，不必再提示');
  });

  test('命中内置默认（包内目录不存在）：paths 空，suggestions 给出池里的建议落点', () => {
    const landed = sfxPathsOf({
      dirs: layeredDirs(),
      index: index({ events: { click: 'click-duck.wav' }, origin: { click: 'package-default' } }),
      model: 'character1',
      renderer: 'layered',
      userRoot,
    });
    assert.equal(landed.paths.click, undefined);
    assert.deepEqual(landed.suggestions.click, {
      absolute: join(poolRoot, 'layered', 'character1', 'character1-click.wav'),
      relative: 'skin/layered/character1/character1-click.wav',
      which: 'pool-layered',
    });
  });

  test('live2d 建议落到池的 live2d 目录，类别随之变化', () => {
    const dirs: SfxDirs = {
      ...layeredDirs(),
      poolRendererSoundDir: join(poolRoot, 'live2d', 'sound'),
      poolSkinDir: join(poolRoot, 'live2d', 'model1'),
      poolSkinLayerDir: join(poolRoot, 'live2d'),
      poolSkinName: 'model1',
      poolSkinStructures: ['xx'],
    };
    const landed = sfxPathsOf({
      dirs,
      index: index({ events: { click: 'click-duck.wav' }, origin: { click: 'package-default' } }),
      model: 'model1/xx.model3.json',
      renderer: 'live2d',
      userRoot,
    });
    assert.equal(landed.suggestions.click?.which, 'pool-live2d');
    assert.equal(landed.suggestions.click?.relative, 'skin/live2d/model1/model1-click.wav');
  });

  test('webm 建议落在平铺目录，文件名带 webm- 前缀（第 3 级命名）', () => {
    const dirs: SfxDirs = {
      animationDirs: [],
      packageSoundDir: join(userRoot, 'pkg-sound'),
      poolGlobalSoundDir: join(poolRoot, 'sound'),
      poolRendererSoundDir: join(poolRoot, 'webm', 'sound'),
      poolSkinLayerDir: join(poolRoot, 'webm'),
      poolWebmDir: join(poolRoot, 'webm'),
    };
    const landed = sfxPathsOf({
      dirs,
      index: index({ events: { click: 'click-duck.wav' }, origin: { click: 'package-default' } }),
      model: '',
      renderer: 'webm',
      userRoot,
    });
    assert.deepEqual(landed.suggestions.click, {
      absolute: join(poolRoot, 'webm', 'webm-click.wav'),
      relative: 'skin/webm/webm-click.wav',
      which: 'pool-webm',
    });
  });

  test('hook 命中路径同样回查', () => {
    const file = join(poolRoot, 'sound', 'hook-ding.wav');
    put(file);
    const landed = sfxPathsOf({
      dirs: layeredDirs(),
      index: index({ hooks: { ding: 'hook-ding.wav' } }),
      model: 'character1',
      renderer: 'layered',
      userRoot,
    });
    assert.equal(landed.hookPaths.ding, file);
  });
});
