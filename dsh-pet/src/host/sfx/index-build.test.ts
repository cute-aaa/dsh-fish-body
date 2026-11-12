/**
 * 音效索引（src/host/sfx/index-build.ts）的契约：优先级顺序、皮肤归属、
 * 动作音只认动画名、碰撞 bump 兜底、内置默认补齐。
 * 纯函数：输入是伪造的文件清单，不碰磁盘。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSfxIndex } from './index-build.ts';
import { skinIdOfModel, isValidModelPath, EMPTY_SOURCES, type SfxSources } from './scan.ts';

/** 造一份清单：只写关心的字段。 */
const sources = (patch: Partial<SfxSources>): SfxSources => ({ ...EMPTY_SOURCES, ...patch });

describe('buildSfxIndex —— 事件槽优先级', () => {
  test('皮肤目录内的文件最高：位置即身份，不需要前缀', () => {
    const index = buildSfxIndex({
      model: 'beiluoye',
      sources: sources({
        bySkin: { beiluoye: ['click.wav', '写代码.wav'] },
        sound: ['click.wav'],
      }),
    });
    assert.equal(index.events.click, 'click.wav');
    // 同名的 -sound 目录文件只作为其他皮肤的回退，不得覆盖皮肤自带的那个。
    assert.equal(index.origin.click, 'skin');
    assert.equal(index.animations['写代码'], '写代码.wav');
  });

  test('-sound 目录：带皮肤前缀的压过通用的', () => {
    const index = buildSfxIndex({
      model: 'beiluoye',
      sources: sources({ skins: ['beiluoye', 'other'], sound: ['click.wav', 'beiluoye-click.wav', 'other-click.wav'] }),
    });
    assert.equal(index.events.click, 'beiluoye-click.wav');
    assert.equal(index.origin.click, 'sound');
  });

  test('没有皮肤时只认不带前缀的文件', () => {
    const index = buildSfxIndex({
      model: '',
      sources: sources({ skins: ['beiluoye'], sound: ['beiluoye-click.wav'] }),
    });
    assert.equal(index.events.click, 'click-duck.wav', '别人的皮肤文件不该串到无皮肤素材根上');
    assert.equal(index.origin.click, 'package-default');
  });

  test('动画同目录只当动作音：槽名在那里不认', () => {
    const index = buildSfxIndex({
      model: '',
      sources: sources({ animation: ['click.wav', '放烟花.wav'] }),
    });
    assert.equal(index.events.click, 'click-duck.wav');
    assert.equal(index.animations['放烟花'], '放烟花.wav');
    assert.equal(index.animations.click, undefined, '动画目录里的 click.wav 不该被当成一段动画');
  });

  test('用户共享目录排在包内默认之前，排在素材根目录之后', () => {
    const index = buildSfxIndex({
      model: '',
      sources: sources({ sound: ['throw.wav'], user: ['throw.mp3', 'wall.wav'], packaged: ['wall.wav'] }),
    });
    assert.equal(index.events.throw, 'throw.wav', '素材根目录 > 用户共享');
    assert.equal(index.events.wall, 'wall.wav', '用户共享 > 包内默认');
    assert.equal(index.origin.wall, 'user');
  });

  test('碰撞 bump 兜底：三个槽一起填，已有的具体文件不动', () => {
    const index = buildSfxIndex({
      model: '',
      sources: sources({ sound: ['bump.wav', 'floor.wav'] }),
    });
    assert.equal(index.events.floor, 'floor.wav');
    assert.equal(index.events.wall, 'bump.wav');
    assert.equal(index.events.ceiling, 'bump.wav');
  });

  test('事件槽恒完整：没文件的槽填内置默认，睡眠两段保持空', () => {
    const index = buildSfxIndex({ model: '', sources: EMPTY_SOURCES });
    assert.equal(index.events.click, 'click-duck.wav');
    assert.equal(index.events.pet, 'pet-bump.wav');
    assert.equal(index.events.sleepStart, undefined);
    assert.equal(index.events.sleepEnd, undefined);
  });
});

describe('buildSfxIndex —— 动作音与 hook', () => {
  test('hook-<名字> 收进 hooks；皮肤前缀也会被剥掉', () => {
    const index = buildSfxIndex({
      model: 'beiluoye',
      sources: sources({ skins: ['beiluoye'], sound: ['hook-ding.wav', 'beiluoye-hook-poke.wav'] }),
    });
    assert.equal(index.hooks.ding, 'hook-ding.wav');
    assert.equal(index.hooks.poke, 'beiluoye-hook-poke.wav');
  });

  test('同名动画只认第一个命中（优先级靠前的目录赢）', () => {
    const index = buildSfxIndex({
      model: 'beiluoye',
      sources: sources({ bySkin: { beiluoye: ['写代码.ogg'] }, sound: ['写代码.wav'] }),
    });
    assert.equal(index.animations['写代码'], '写代码.ogg');
  });
});

describe('scan 辅助', () => {
  test('skinIdOfModel：layered 直接用，live2d 取模型所在目录', () => {
    assert.equal(skinIdOfModel('beiluoye'), 'beiluoye');
    assert.equal(skinIdOfModel('a/b/model.model3.json'), 'a/b');
    assert.equal(skinIdOfModel('model.model3.json'), '');
    assert.equal(skinIdOfModel(undefined), '');
  });

  test('isValidModelPath：拦绝对路径、反斜杠与 ..', () => {
    assert.equal(isValidModelPath(''), true);
    assert.equal(isValidModelPath('a/b/model.model3.json'), true);
    assert.equal(isValidModelPath('/etc/passwd'), false);
    assert.equal(isValidModelPath('a\\b'), false);
    assert.equal(isValidModelPath('../x'), false);
    assert.equal(isValidModelPath('a//b'), false);
  });
});
