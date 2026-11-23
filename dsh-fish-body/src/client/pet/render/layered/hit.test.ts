/**
 * 命中区手势换算的契约测试：画布矩形 → 画布坐标 → 区域 → gesture。
 *
 * 这里测的是「看着点头、别判到身」那条换算：画布是正方形且按 CSS 缩放的，
 * 视口坐标与画布像素之间差一个比例与偏移，算错方向不变、区域却全错。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { gestureAtPoint } from './hit.ts';
import type { SkinManifest } from './types.ts';

/** 一份最小清单：1024² 画布，三个区域（头椭圆 / 身矩形 / 尾矩形）。 */
const SKIN: SkinManifest = {
  id: 'test',
  name: 'test',
  canvas: { w: 1024, h: 1024 },
  displayScale: 1,
  hitbox: null,
  rig: {},
  interaction: {
    regions: [
      { id: 'head', gesture: 'pat', shape: { type: 'ellipse', cx: 512, cy: 200, rx: 200, ry: 160 } },
      { id: 'body', gesture: 'poke', shape: { type: 'rect', x: 300, y: 400, w: 400, h: 500 } },
      { id: 'tail', gesture: 'tailpet', shape: { type: 'rect', x: 700, y: 500, w: 300, h: 300 } },
    ],
    menu: [],
  },
  layers: [],
};

/** 画布在视口里的 462×462 盒子，左上角 (100, 50)。 */
const RECT = { left: 100, top: 50, width: 462, height: 462 };

/** 画布坐标 → 视口坐标（按 RECT 等比换算），用来构造「点在某个区域中心」。 */
const toClient = (cx: number, cy: number): { x: number; y: number } => ({
  x: RECT.left + (cx / SKIN.canvas.w) * RECT.width,
  y: RECT.top + (cy / SKIN.canvas.h) * RECT.height,
});

describe('gestureAtPoint —— 视口坐标 → 命中手势', () => {
  test('点头部椭圆中心 → pat', () => {
    const p = toClient(512, 200);
    assert.equal(gestureAtPoint(SKIN, RECT, p.x, p.y), 'pat');
  });

  test('点身体 → poke（缩放后的坐标仍落在矩形内）', () => {
    const p = toClient(500, 700);
    assert.equal(gestureAtPoint(SKIN, RECT, p.x, p.y), 'poke');
  });

  test('点尾巴 → tailpet', () => {
    const p = toClient(850, 650);
    assert.equal(gestureAtPoint(SKIN, RECT, p.x, p.y), 'tailpet');
  });

  test('区域外 → undefined', () => {
    const p = toClient(20, 20);
    assert.equal(gestureAtPoint(SKIN, RECT, p.x, p.y), undefined);
  });

  test('矩形为 0（未挂载/被隐藏）→ undefined，不做除零换算', () => {
    assert.equal(gestureAtPoint(SKIN, { left: 0, top: 0, width: 0, height: 462 }, 10, 10), undefined);
  });
});
