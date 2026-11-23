/**
 * 气泡锚点的契约测试：方形画布的头顶在舞台顶以上，锚点必须按实测内容顶算，且任何输入都收在合理范围。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bubbleAnchorY, visualTopY, CANVAS_OVERHANG_RATIO, BUBBLE_HEAD_GAP_RATIO } from './bubble-anchor.ts';

describe('bubbleAnchorY —— 气泡底边相对舞台顶的偏移', () => {
  test('实测 10% 内容顶：头顶在舞台顶以上 34% 宽度处，气泡再高一档留缝', () => {
    const size = 462;
    const expected = (0.1 - CANVAS_OVERHANG_RATIO - BUBBLE_HEAD_GAP_RATIO) * size;
    assert.equal(bubbleAnchorY(0.1, size), expected);
    assert.ok(bubbleAnchorY(0.1, size) < 0, '方形画布的气泡应落到舞台顶以上');
  });

  test('头顶正好顶在画布上沿时只比画布上溢高一点点（留缝仍在）', () => {
    const size = 400;
    assert.equal(bubbleAnchorY(0, size), (-CANVAS_OVERHANG_RATIO - BUBBLE_HEAD_GAP_RATIO) * size);
  });

  test('坏输入退回兜底比例，不返回 NaN', () => {
    assert.equal(bubbleAnchorY(Number.NaN, 462), bubbleAnchorY(0.1, 462));
    assert.ok(Number.isFinite(bubbleAnchorY(9, 462)), '越界比例要被夹回 0~1');
  });
});

describe('visualTopY —— 头顶相对舞台顶的位置', () => {
  test('比锚点高出留缝那一段', () => {
    const gap = visualTopY(0.1, 462) - bubbleAnchorY(0.1, 462);
    assert.ok(Math.abs(gap - BUBBLE_HEAD_GAP_RATIO * 462) < 1e-9, '两式只差一个留缝');
  });
});
