/**
 * 像素探测的契约测试：纯计算部分可脱 canvas 断言（DOM 探测只在挂载时跑一次，不在这里测）。
 *
 * 三条契约：
 *   1. 包围盒 = alpha ≥ 阈值的**最小**矩形；整幅透明返回 null（调用方据此退回整幅绘制）；
 *   2. 探测坐标换算回源像素时按各自缩放还原，并按需外扩、夹进源尺寸；
 *   3. 外扩量按缩放的倒数放大——探测图缩得越小，一个探测像素代表的源像素越多。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { alphaBoxOf, boxToSource, BOX_PAD_PROBE_PX } from './probe.ts';

/** 造一张 `w×h` 的全透明 RGBA 缓冲。 */
function blank(w: number, h: number): Uint8ClampedArray {
  return new Uint8ClampedArray(w * h * 4);
}

/** 把 (x,y) 涂成给定 alpha（其余通道给 255，模拟正常素材）。 */
function paint(data: Uint8ClampedArray, w: number, x: number, y: number, alpha: number): void {
  const i = (y * w + x) * 4;
  data[i] = 255;
  data[i + 1] = 255;
  data[i + 2] = 255;
  data[i + 3] = alpha;
}

describe('alphaBoxOf —— 不透明包围盒', () => {
  test('取最小矩形：只覆盖 alpha ≥ 阈值的像素', () => {
    const data = blank(8, 6);
    paint(data, 8, 3, 2, 255);
    paint(data, 8, 5, 4, 200);
    assert.deepEqual(alphaBoxOf(data, 8, 6, 24), { x: 3, y: 2, w: 3, h: 3 });
  });

  test('低于阈值的像素不算内容（羽化边缘不撑大包围盒）', () => {
    const data = blank(4, 4);
    paint(data, 4, 0, 0, 10); // 低于 24
    paint(data, 4, 2, 2, 255);
    assert.deepEqual(alphaBoxOf(data, 4, 4, 24), { x: 2, y: 2, w: 1, h: 1 });
  });

  test('整幅透明 → null（渲染侧退回整幅绘制）', () => {
    assert.equal(alphaBoxOf(blank(4, 4), 4, 4, 24), null);
  });

  test('非法尺寸 → null，不越界读', () => {
    for (const [w, h] of [
      [0, 4],
      [4, 0],
      [-1, 4],
      [Number.NaN, 4],
    ]) {
      assert.equal(alphaBoxOf(blank(4, 4), w, h, 24), null, w + '×' + h);
    }
  });

  test('像素贴边：包围盒贴到画布边缘', () => {
    const data = blank(6, 5);
    paint(data, 6, 0, 0, 255);
    paint(data, 6, 5, 4, 255);
    assert.deepEqual(alphaBoxOf(data, 6, 5, 24), { x: 0, y: 0, w: 6, h: 5 });
  });
});

describe('boxToSource —— 探测坐标还原成源像素', () => {
  test('等比缩放：坐标与尺寸按 1/scale 还原', () => {
    // 1024 源图缩到 256 探测（xScale = 0.25）：探测 (10,20) 8×4 → 源 (40,80) 32×16，再按外扩放大
    const box = boxToSource({ x: 10, y: 20, w: 8, h: 4 }, 0.25, 0.25, 1024, 1024, BOX_PAD_PROBE_PX);
    // pad = ceil(2 / 0.25) = 8
    assert.deepEqual(box, { x: 40 - 8, y: 80 - 8, w: 32 + 16, h: 16 + 16 });
  });

  test('外扩量随缩放变化：缩得越小，一个探测像素代表的源像素越多', () => {
    const half = boxToSource({ x: 100, y: 100, w: 10, h: 10 }, 0.5, 0.5, 512, 512, 2);
    const quarter = boxToSource({ x: 50, y: 50, w: 5, h: 5 }, 0.25, 0.25, 512, 512, 2);
    // 两者覆盖的源区域相同：x=200,y=200,w=20,h=20；外扩分别是 4 与 8
    assert.deepEqual(half, { x: 196, y: 196, w: 28, h: 28 });
    assert.deepEqual(quarter, { x: 192, y: 192, w: 36, h: 36 });
  });

  test('夹进源尺寸：贴边层不会出现负坐标或超出画布的矩形', () => {
    const box = boxToSource({ x: 0, y: 0, w: 256, h: 256 }, 0.25, 0.25, 1024, 1024, 2);
    assert.deepEqual(box, { x: 0, y: 0, w: 1024, h: 1024 });
    const tiny = boxToSource({ x: 255, y: 255, w: 1, h: 1 }, 0.25, 0.25, 1024, 1024, 2);
    assert.ok(tiny.x + tiny.w <= 1024 && tiny.y + tiny.h <= 1024);
    assert.ok(tiny.w >= 1 && tiny.h >= 1, '至少一像素：宽高不能归零');
  });
});
