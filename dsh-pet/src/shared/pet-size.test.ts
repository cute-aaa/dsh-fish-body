/**
 * 百分比尺寸解析的单元测试：钉住「size 是上限、百分比只收口」与缺省回落的边界。
 *
 * 跑法：node --experimental-strip-types --test src/shared/pet-size.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidSize,
  isValidSizePercent,
  renderPixelSide,
  renderSizeOf,
  resolvePetSizePx,
  SIZE_MAX,
  SIZE_MIN,
  SIZE_PERCENT_MIN,
  SIZE_STEP,
} from './pet-size.ts';

describe('isValidSizePercent —— 不小于 1 的有限数（不设上限）', () => {
  test('合法：包含超过 100 的值', () => {
    for (const value of [SIZE_PERCENT_MIN, 40, 99.5, 100, 150, 400]) {
      assert.equal(isValidSizePercent(value), true, `${value} 应合法`);
    }
  });

  test('非数字与小于下限的值都不合法', () => {
    for (const value of [0, 0.5, -1, Number.NaN, Number.POSITIVE_INFINITY, '40', null, undefined, true, { a: 1 }]) {
      assert.equal(isValidSizePercent(value), false, `${String(value)} 应非法`);
    }
  });
});

describe('resolvePetSizePx —— 百分比按人物本体换算成画框宽度', () => {
  test('没配百分比 → 按默认 20：宽窗口等于 px，窄窗口被屏宽夹住', () => {
    assert.equal(resolvePetSizePx(400, undefined, 1920), 400);
    assert.equal(resolvePetSizePx(400, undefined, 375), 200);
  });

  test('窄屏：20% 人物 → 画框 200px（本体 75px = 屏宽 20%）', () => {
    assert.equal(resolvePetSizePx(462, 20, 375), 200);
  });

  test('宽屏：百分比算出的画框超过 size → 仍取 px（桌面观感不变）', () => {
    assert.equal(resolvePetSizePx(400, 40, 1920), 400);
  });

  test('刚好卡在 size 上时取该值', () => {
    // 375 × 40% = 150 本体 → 画框 400，正好等于 size
    assert.equal(resolvePetSizePx(400, 40, 375), 400);
  });

  test('视口拿不到（0 / 负数 / 非数）→ 回落到 px', () => {
    for (const width of [0, -100, Number.NaN]) {
      assert.equal(resolvePetSizePx(400, 40, width), 400, `${width} 应回落`);
    }
  });

  test('百分比非法 → 回落到 px（配置脏值不进渲染）', () => {
    for (const value of [0, 101, Number.NaN]) {
      assert.equal(resolvePetSizePx(400, value, 375), 400, `${value} 应回落`);
    }
  });

  test('平板竖屏：15% 人物 → 画框 307.2（本体 115.2 = 768 的 15%）', () => {
    assert.equal(resolvePetSizePx(462, 15, 768), 307.2);
  });

  test('方形画布：人物占框 84%，同一百分比算出的画框更小', () => {
    // webm 0.375 → 375×20% / 0.375 = 200；画布 0.84 → 375×20% / 0.84 ≈ 89.3
    assert.equal(resolvePetSizePx(462, 20, 375, 'webm'), 200);
    const canvas = resolvePetSizePx(462, 20, 375, 'live2d');
    assert.ok(Math.abs(canvas - (375 * 0.2) / 0.84) < 1e-9, `画布应收得更紧，实际 ${canvas}`);
    assert.ok(canvas < 200);
  });
});

describe('renderSizeOf —— 按渲染方式取画框宽度', () => {
  test('没写 sizes → 回落 size', () => {
    assert.equal(renderSizeOf({ size: 462 }), 462);
    assert.equal(renderSizeOf({ size: 462, renderer: 'live2d' }), 462);
  });

  test('写了当前渲染方式就取它，其它渲染方式仍看 size', () => {
    const pet = { size: 462, renderer: 'layered', sizes: { layered: 520 } };
    assert.equal(renderSizeOf(pet), 520);
    assert.equal(renderSizeOf({ ...pet, renderer: 'live2d' }), 462);
  });

  test('非法覆盖值被忽略（NaN / 越界 / 非数字）', () => {
    for (const bad of [Number.NaN, SIZE_MAX + 1, 10, '520', null]) {
      const pet = { size: 462, renderer: 'webm', sizes: { webm: bad } };
      assert.equal(renderSizeOf(pet), 462, `${String(bad)} 应被忽略`);
    }
  });

  test('入参是配置原始对象（Record<string, unknown>）也不炸', () => {
    assert.equal(renderSizeOf({ size: '480' }), 480);
    assert.equal(renderSizeOf({}), SIZE_MIN);
    assert.equal(renderSizeOf(null), SIZE_MIN);
    assert.equal(renderSizeOf({ size: 462, renderer: 'webm', sizes: '坏值' }), 462);
  });
});

describe('isValidSize —— 画框宽度的区间', () => {
  test('闭区间内合法，边界也算合法', () => {
    for (const value of [SIZE_MIN, 462, SIZE_MAX]) assert.equal(isValidSize(value), true);
  });

  test('越界与非数字非法', () => {
    for (const value of [0, SIZE_MIN - 1, SIZE_MAX + 1, Number.NaN, '462', null, {}]) {
      assert.equal(isValidSize(value), false, `${String(value)} 应非法`);
    }
  });

  test('滑块的步长是 1：462 这类非整十数必须能精确落到区间里', () => {
    assert.equal(SIZE_STEP, 1);
  });
});

describe('renderPixelSide —— 画布后备分辨率', () => {
  test('跟随显示尺寸与 DPR：462@DPR1 = 462，462@DPR2 = 924', () => {
    assert.equal(renderPixelSide(462, 1024, 1), 462);
    assert.equal(renderPixelSide(462, 1024, 2), 924);
  });

  test('不超过素材原生边：2000@DPR1 与 2000@DPR2 都夹到 1024（放大没有新增细节）', () => {
    assert.equal(renderPixelSide(2000, 1024, 1), 1024);
    assert.equal(renderPixelSide(2000, 1024, 2), 1024);
  });

  test('DPR 不设上限：3 倍屏按 3 倍算（封顶到 2 等于把画布压到设备像素之下）', () => {
    assert.equal(renderPixelSide(400, 2048, 3), 1200);
    assert.equal(renderPixelSide(400, 2048, 4), 1600);
  });

  test('高 DPR 也不会超过素材原生边', () => {
    assert.equal(renderPixelSide(400, 1024, 4), 1024);
    assert.equal(renderPixelSide(279, 1024, 3), 837);
  });

  test('极小尺寸与非法 DPR：至少 1 像素，不产生 NaN/0', () => {
    assert.equal(renderPixelSide(10, 1024, 1), 10);
    assert.equal(renderPixelSide(SIZE_MIN, 1024, Number.NaN), SIZE_MIN);
    assert.equal(renderPixelSide(0, 1024, 1), SIZE_MIN, '非法 css 尺寸回落到下限');
    assert.equal(renderPixelSide(-5, 1024, 1), SIZE_MIN);
  });
});
