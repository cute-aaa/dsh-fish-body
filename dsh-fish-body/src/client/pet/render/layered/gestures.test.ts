/**
 * 装配动作词表的契约测试：手势 id 优先、动画名关键词回落、无对应语义不打断待机。
 *
 * 两端（浏览器 layered.ts / 桌面 Helper 的 layered-core.js）共用这一份映射，所以它一旦漂移，
 * 「点同一只宠物，一端有反应、另一端没有」。用 Node 内置 test runner，不引入依赖。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { assemblyActionOf } from './gestures.ts';

describe('assemblyActionOf —— 动作名 → 装配动作', () => {
  test('皮肤清单手势 id 直接命中（pat / poke / tailpet）', () => {
    assert.equal(assemblyActionOf('pat'), 'jelly');
    assert.equal(assemblyActionOf('poke'), 'hop');
    assert.equal(assemblyActionOf('tailpet'), 'wag');
  });

  test('手势 id 大小写与空白容错', () => {
    assert.equal(assemblyActionOf('  PAT '), 'jelly');
  });

  test('webm 点击池动作名回落成挤压；名字里带「跃」的按跳跃处理', () => {
    assert.equal(assemblyActionOf('点击回应-害羞惊讶'), 'jelly');
    assert.equal(assemblyActionOf('点击回应-开心跃动'), 'hop');
  });

  test('碎碎念 / 吃 / 余额 / 工作状态各有对应装配', () => {
    assert.equal(assemblyActionOf('碎碎念-擦桌碎碎念'), 'talk');
    assert.equal(assemblyActionOf('吃早餐'), 'mouth');
    assert.equal(assemblyActionOf('余额-钱袋满溢'), 'jelly');
    assert.equal(assemblyActionOf('工作状态-忙碌点按'), 'blink');
  });

  test('没有对应语义的名字返回 null（保持待机，不打断呼吸循环）', () => {
    assert.equal(assemblyActionOf('东张西望'), null);
    assert.equal(assemblyActionOf('待机呼吸休闲'), null);
    assert.equal(assemblyActionOf(''), null);
  });
});
