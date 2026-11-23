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

describe('buildSfxIndex —— 资源池三层', () => {
  test('第 1/2 级：结构文件基名与目录名前缀都能命中，来源标 pool-skin', () => {
    const index = buildSfxIndex({
      model: 'character1',
      poolSkinName: 'character1',
      poolSkinStructures: ['xxx'],
      renderer: 'layered',
      sources: sources({ poolSkin: ['xxx-click.wav', 'character1-throw.wav'] }),
    });
    assert.equal(index.events.click, 'xxx-click.wav');
    assert.equal(index.events.throw, 'character1-throw.wav');
    assert.equal(index.origin.click, 'pool-skin');
  });

  test('池资源目录里不认裸文件名（池是共享的，裸名会串到别的宠物）', () => {
    const index = buildSfxIndex({
      model: 'character1',
      poolSkinName: 'character1',
      renderer: 'layered',
      sources: sources({ poolSkin: ['click.wav'] }),
    });
    assert.equal(index.origin.click, 'package-default');
  });

  test('第 3 级：<渲染方式>-<事件> 命中，来源标 pool-renderer', () => {
    const layeredIndex = buildSfxIndex({
      model: 'character1',
      poolSkinName: 'character1',
      renderer: 'layered',
      sources: sources({ poolRenderer: ['layered-wall.wav'] }),
    });
    assert.equal(layeredIndex.events.wall, 'layered-wall.wav');
    assert.equal(layeredIndex.origin.wall, 'pool-renderer');

    const webmIndex = buildSfxIndex({
      model: '',
      renderer: 'webm',
      sources: sources({ poolRenderer: ['webm-click.wav'] }),
    });
    assert.equal(webmIndex.events.click, 'webm-click.wav');
  });

  test('第 4 级：全局音效无前缀优先；带前缀多份时取排序第一并告警一次', () => {
    const warnings: string[] = [];
    const index = buildSfxIndex({
      model: '',
      renderer: 'webm',
      sources: sources({ poolGlobal: ['bbb-click.wav', 'aaa-click.wav', 'pet.wav', 'zzz-pet.wav'] }),
      warn: (message) => warnings.push(message),
    });
    assert.equal(index.events.click, 'aaa-click.wav', '无前缀的没有，带前缀的按文件名排序取第一');
    assert.equal(index.events.pet, 'pet.wav', '无前缀压过任何带前缀的');
    assert.equal(index.origin.click, 'pool-global');
    assert.equal(warnings.length, 1, '只有一个槽出现多份候选，只告警一次');
    assert.match(warnings[0], /click/);
  });

  test('池整体优先于旧皮肤目录与用户共享目录', () => {
    const index = buildSfxIndex({
      model: 'beiluoye',
      poolSkinName: 'beiluoye',
      renderer: 'layered',
      sources: sources({
        bySkin: { beiluoye: ['click.wav'] },
        poolGlobal: ['click.wav'],
        user: ['floor.wav'],
      }),
    });
    assert.equal(index.origin.click, 'pool-global', '池全局的裸 click 压过旧皮肤目录里的同名文件');
    assert.equal(index.events.floor, 'floor.wav', '池没有 floor 时才用用户共享');
    assert.equal(index.origin.floor, 'user');
  });

  test('bump 兜底：池的具体槽已填时不被池里/旧目录的 bump 覆盖', () => {
    const index = buildSfxIndex({
      model: '',
      renderer: 'webm',
      sources: sources({ poolGlobal: ['floor.wav', 'bump.wav'], sound: ['wall.wav'] }),
    });
    assert.equal(index.events.floor, 'floor.wav', '同层内具体槽压过 bump');
    assert.equal(index.events.wall, 'bump.wav', 'bump 填掉剩下的碰撞槽');
    assert.equal(index.events.ceiling, 'bump.wav');
  });

  test('hook：池资源目录 / 渲染兜底 / 池全局都能命中', () => {
    const index = buildSfxIndex({
      model: 'character1',
      poolSkinName: 'character1',
      renderer: 'layered',
      sources: sources({
        poolGlobal: ['hook-global.wav'],
        poolRenderer: ['layered-hook-render.wav'],
        poolSkin: ['character1-hook-skin.wav'],
      }),
    });
    assert.equal(index.hooks.skin, 'character1-hook-skin.wav');
    assert.equal(index.hooks.render, 'layered-hook-render.wav');
    assert.equal(index.hooks.global, 'hook-global.wav');
  });
});
