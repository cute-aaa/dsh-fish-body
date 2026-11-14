/**
 * 「需重启插件后生效」判定（src/client/settings/restart-hint.ts）的契约测试。
 *
 * 这张表是唯一真源：设置页的字段提示靠它决定哪一格下面多一行字。所以测试钉的是**边界**——
 * 哪些路径必须命中（漏了就是「改完没提示」），哪些必须不命中（多了就是每页都在喊重启）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { needsRestart, restartHintCount } from './restart-hint.ts';

describe('needsRestart —— 需重建桌面窗口 / 重启插件才生效的改动', () => {
  test('扁平全局开关：锁定屏幕 / 托盘 / 系统通知', () => {
    for (const path of ['global.confineToScreen', 'global.trayEnabled', 'global.notificationsEnabled']) {
      assert.equal(needsRestart(path), true, path);
    }
  });

  test('增删宠物只有聚合路径：`pets` 也算一处', () => {
    assert.equal(needsRestart('pets'), true);
  });

  test('逐只宠物的窗口字段：渲染方式 / 皮肤模型 / 显示位置 / 大小 / 固定', () => {
    for (const field of ['renderer', 'model', 'display', 'size', 'sizePercent', 'fixedEnabled']) {
      assert.equal(needsRestart('pets.0.' + field), true, field);
      assert.equal(needsRestart('pets.12.' + field), true, field + '（下标不影响判定）');
    }
  });

  test('按渲染方式覆盖的宽度：`sizes` 与它的子键都算', () => {
    assert.equal(needsRestart('pets.0.sizes'), true);
    assert.equal(needsRestart('pets.0.sizes.webm'), true);
    assert.equal(needsRestart('pets.3.sizes.live2d'), true);
  });

  test('不重建窗口的改动不命中：名字 / 位置边距 / 物理 / 字体 / 对话开关', () => {
    for (const path of [
      'pets.0.name',
      'pets.0.position.corner',
      'pets.0.position.marginX',
      'pets.0.whisperEnabled',
      'look.physics.gravity',
      'look.font.size',
      'model.chatImageEnabled',
      'global.sfxVolume',
      'hotkeys.chat',
    ]) {
      assert.equal(needsRestart(path), false, path);
    }
  });

  test('前缀相近但不该命中的写法：别的数组、缺下标、别的字段名', () => {
    assert.equal(needsRestart('pet'), false);
    assert.equal(needsRestart('petsx.0.renderer'), false);
    assert.equal(needsRestart('pets.0x.renderer'), false);
    assert.equal(needsRestart('pets..renderer'), false);
    assert.equal(needsRestart('pets.0.renderers'), false);
    assert.equal(needsRestart('specs.0.size'), false);
  });

  test('计数：命中几条算几条，空集为 0', () => {
    assert.equal(restartHintCount(new Set()), 0);
    assert.equal(restartHintCount(new Set(['pets.0.name', 'look.physics.gravity'])), 0);
    assert.equal(restartHintCount(new Set(['pets.0.renderer', 'global.trayEnabled', 'pets.0.name'])), 2);
    assert.equal(restartHintCount(new Set(['pets', 'pets.0.sizes.webm'])), 2);
  });
});
