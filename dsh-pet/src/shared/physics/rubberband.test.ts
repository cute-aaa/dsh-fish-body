/**
 * 边界阻力曲线（src/shared/physics/rubberband.ts）的契约测试。
 *
 * 要钉住的不是某几个具体数值，而是四条性质：区间内恒等（不改变合法落点）、越界单调（拖得越远越沉但一直跟手）、
 * 有上界（不会一步跨到下一屏）、起步有重量（越出 1px 不会原样跟 1px）。
 * 外加减速退化：区间反向与非有限输入必须原值返回，由调用方决定回落。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { RUBBER_C, rubberband } from './rubberband.ts';

const LO = 0;
const HI = 1000;
const DIM = HI - LO;

describe('rubberband —— 区间内', () => {
  test('两端点与区间内任意值都恒等（合法落点一个像素都不改）', () => {
    for (const value of [LO, 1, 250, 500, 999, HI]) assert.equal(rubberband(value, LO, HI), value);
  });

  test('默认阻力系数就是导出的常量', () => {
    assert.equal(rubberband(HI + 100, LO, HI), rubberband(HI + 100, LO, HI, RUBBER_C));
  });
});

describe('rubberband —— 越界', () => {
  test('跨 hi 单调递增：拖得越远走得越远，但永远小于原始越界量', () => {
    let previous = HI;
    for (const over of [10, 50, 200, 500, 2000]) {
      const moved = rubberband(HI + over, LO, HI);
      assert.ok(moved > previous, `over=${over} 应比上一档更远：${moved}`);
      assert.ok(moved < HI + over, `over=${over} 必须被收窄：${moved} < ${HI + over}`);
      previous = moved;
    }
  });

  test('跨 lo 与跨 hi 对称', () => {
    for (const over of [10, 120, 900]) {
      const right = rubberband(HI + over, LO, HI) - HI;
      const left = LO - rubberband(LO - over, LO, HI);
      assert.ok(Math.abs(right - left) < 1e-9, `两侧位移应相等：right=${right} left=${left}`);
    }
  });

  test('渐近上界：越界量再大也走不过一个区间长度', () => {
    for (const over of [10, 1e3, 1e6]) {
      assert.ok(rubberband(HI + over, LO, HI) - HI < DIM, `over=${over} 的位移必须小于 dim=${DIM}`);
    }
  });

  test('起步有重量：越界 1px 只走不到 1px', () => {
    const moved = rubberband(HI + 1, LO, HI) - HI;
    assert.ok(moved > 0 && moved < 1, `越界 1px 应走 (0,1)：${moved}`);
  });

  test('系数越小越沉', () => {
    const soft = rubberband(HI + 200, LO, HI, 0.9) - HI;
    const stiff = rubberband(HI + 200, LO, HI, 0.2) - HI;
    assert.ok(stiff < soft, `c=0.2 应比 c=0.9 沉：${stiff} < ${soft}`);
  });
});

describe('rubberband —— 退化', () => {
  test('区间反向或零长：原值返回，交给调用方的夹取决定', () => {
    assert.equal(rubberband(50, 100, 0), 50);
    assert.equal(rubberband(50, 10, 10), 50);
  });

  test('非有限输入：原值返回，绝不产出 NaN', () => {
    assert.ok(Number.isNaN(rubberband(Number.NaN, LO, HI)));
    assert.equal(rubberband(Number.POSITIVE_INFINITY, LO, HI), Number.POSITIVE_INFINITY);
    assert.equal(rubberband(HI + 10, Number.NaN, HI), HI + 10);
    assert.equal(rubberband(HI + 10, LO, HI, Number.POSITIVE_INFINITY), HI + 10);
  });

  test('系数非正：退化为原值（调用方显式关掉阻力）', () => {
    assert.equal(rubberband(HI + 10, LO, HI, 0), HI + 10);
  });
});
