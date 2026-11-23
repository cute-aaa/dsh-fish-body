/**
 * 命中框比例的单元测试：钉住「webm 与今天逐位一致」和「画布后端覆盖到舞台顶以上」。
 *
 * 这是两端共用的几何唯一来源（网页端命中层 CSS、拖拽夹取、碰撞框、桌面 `hitRect` 与穿透判定），
 * 任何一处回退成写死的 HIT_BOX 都会让「看得见、点不到」复发。
 * 跑法：node --experimental-strip-types --test src/shared/body-box.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  bodyBoxPercent,
  bodyBoxPx,
  bodyUnitBox,
  bodyWidthRatio,
  contentUnitBox,
  intersectUnitBox,
  unitBoxPercent,
  unitBoxPx,
} from './body-box.ts';
import { STAGE_ASPECT } from './bubble-anchor.ts';
import { CANVAS_H, HIT_BOX } from './constants.ts';
import type { RendererKind } from './types.ts';

describe('bodyUnitBox —— webm 与 640×360 命中框一致', () => {
  test('四边等于 HIT_BOX 换算值（缺省 / 未知渲染方式都走 webm）', () => {
    const expected = {
      x0: HIT_BOX.x0 / 640,
      y0: (HIT_BOX.y0 / CANVAS_H) * STAGE_ASPECT,
      x1: HIT_BOX.x1 / 640,
      y1: (HIT_BOX.y1 / CANVAS_H) * STAGE_ASPECT,
    };
    // 配置里可能写着白名单外的值（旧版本 / 手改）：运行时按 webm 处理。
    const unknownKind = 'something-else' as RendererKind;
    for (const renderer of ['webm', undefined, unknownKind] as const) {
      assert.deepEqual(bodyUnitBox(renderer), expected);
    }
  });
});

describe('bodyUnitBox —— 画布后端覆盖方形画布', () => {
  test('横向内缩 8%，纵向从舞台顶以上一直到舞台底', () => {
    const box = bodyUnitBox('live2d');
    assert.ok(Math.abs(box.x0 - 0.08) < 1e-12);
    assert.ok(Math.abs(box.x1 - 0.92) < 1e-12);
    // 方形画布高 = 宠物宽度，舞台高只有 9/16，所以 y0 必然是负的
    assert.ok(Math.abs(box.y0 - (-(1 - STAGE_ASPECT) + 0.08)) < 1e-12, 'y0 应落在舞台顶以上');
    assert.ok(Math.abs(box.y1 - STAGE_ASPECT) < 1e-12, '底边应与舞台底对齐');
  });

  test('layered 与 live2d 共用同一套（两种画布实现口径一致）', () => {
    assert.deepEqual(bodyUnitBox('layered'), bodyUnitBox('live2d'));
  });
});

describe('bodyBoxPx —— 换算到像素', () => {
  test('webm：命中框就是今天那几个像素值', () => {
    const size = 462;
    const box = bodyBoxPx('webm', size);
    assert.equal(box.x, (HIT_BOX.x0 / 640) * size);
    assert.equal(box.w, ((HIT_BOX.x1 - HIT_BOX.x0) / 640) * size);
    assert.equal(box.h, ((HIT_BOX.y1 - HIT_BOX.y0) / 360) * (size * (9 / 16)));
  });

  test('画布：宽 = 84% × size、高 = 92% × size，且 y 为负', () => {
    const size = 500;
    const box = bodyBoxPx('live2d', size);
    assert.ok(Math.abs(box.w - size * 0.84) < 1e-9);
    assert.ok(Math.abs(box.h - size * 0.92) < 1e-9);
    assert.ok(box.y < 0, '头顶在舞台顶以上');
  });
});

describe('bodyBoxPercent —— CSS 百分比（两轴分别归一）', () => {
  test('webm：与旧 `PET_HIT_STYLE` 的四个百分比一致', () => {
    const box = bodyBoxPercent('webm');
    assert.ok(Math.abs(box.left - HIT_BOX.x0 / 640) < 1e-12);
    assert.ok(Math.abs(box.top - HIT_BOX.y0 / 360) < 1e-12);
    assert.ok(Math.abs(box.width - (HIT_BOX.x1 - HIT_BOX.x0) / 640) < 1e-12);
    assert.ok(Math.abs(box.height - (HIT_BOX.y1 - HIT_BOX.y0) / 360) < 1e-12);
  });

  test('画布：top 为负、height 大于 1，底边正好等于 100%', () => {
    const box = bodyBoxPercent('live2d');
    assert.ok(box.top < 0);
    assert.ok(box.height > 1);
    assert.ok(Math.abs(box.top + box.height - 1) < 1e-12, '底边落在舞台底边');
  });

  test('百分比与像素自洽：乘回舞台尺寸得到同一矩形', () => {
    const size = 400;
    const stageH = size * STAGE_ASPECT;
    for (const renderer of ['webm', 'layered', 'live2d'] as const) {
      const px = bodyBoxPx(renderer, size);
      const pct = bodyBoxPercent(renderer);
      assert.ok(Math.abs(pct.left * size - px.x) < 1e-9, renderer);
      assert.ok(Math.abs(pct.top * stageH - px.y) < 1e-9, renderer);
      assert.ok(Math.abs(pct.width * size - px.w) < 1e-9, renderer);
      assert.ok(Math.abs(pct.height * stageH - px.h) < 1e-9, renderer);
    }
  });
});

describe('bodyWidthRatio —— 人物占框宽度', () => {
  test('webm 37.5%，画布 84%', () => {
    assert.ok(Math.abs(bodyWidthRatio('webm') - 0.375) < 1e-12);
    assert.ok(Math.abs(bodyWidthRatio('live2d') - 0.84) < 1e-12);
  });
});

describe('contentUnitBox —— 实测内容框换到舞台坐标', () => {
  test('画布底边对齐舞台底边、x 直接照搬', () => {
    const box = contentUnitBox('live2d', { x0: 0.3, y0: 0.1, x1: 0.7, y1: 1 });
    assert.ok(box !== null);
    assert.ok(Math.abs(box.x0 - (0.3 - 0.015)) < 1e-12, '横向带一点外扩');
    assert.ok(Math.abs(box.y1 - STAGE_ASPECT) < 1e-12, 'y1=1 就是画布底边 = 舞台底边');
    assert.ok(box.y0 < 0, '头顶跑到舞台顶以上');
  });

  test('webm 等非方形画布后端不参与（返回 null，保留理论框）', () => {
    assert.equal(contentUnitBox('webm', { x0: 0, y0: 0, x1: 1, y1: 1 }), null);
    assert.equal(contentUnitBox(undefined, { x0: 0, y0: 0, x1: 1, y1: 1 }), null);
  });

  test('非法值被夹进 0..1（探测拿到 NaN 也不会把框撑大）', () => {
    const box = contentUnitBox('layered', { x0: Number.NaN, y0: -5, x1: 9, y1: Number.NaN });
    assert.ok(box !== null);
    assert.ok(box.x0 >= 0 && box.x1 <= 1);
  });
});

describe('intersectUnitBox —— 实测只往理论框里收', () => {
  test('收窄到交叠部分', () => {
    const base = bodyUnitBox('live2d');
    const inner = { x0: 0.3, y0: -0.3, x1: 0.7, y1: 0.5 };
    const both = intersectUnitBox(base, inner);
    assert.ok(both !== null);
    assert.deepEqual(both, inner);
  });

  test('超出理论框的部分被裁掉（不会把命中区放大）', () => {
    const base = bodyUnitBox('live2d');
    const both = intersectUnitBox(base, { x0: -1, y0: -9, x1: 2, y1: 9 });
    assert.ok(both !== null);
    assert.deepEqual(both, base);
  });

  test('完全不相交时返回 null（调用方保留理论框，不把宠物做成点不到）', () => {
    const base = bodyUnitBox('live2d');
    assert.equal(intersectUnitBox(base, { x0: 2, y0: 2, x1: 3, y1: 3 }), null);
    assert.equal(intersectUnitBox(base, { x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.6 }), null);
  });
});

describe('unitBoxPx / unitBoxPercent —— 与 renderer 版同一口径', () => {
  test('对理论框调用时逐位等于 bodyBoxPx / bodyBoxPercent', () => {
    for (const renderer of ['webm', 'layered', 'live2d'] as const) {
      assert.deepEqual(unitBoxPx(bodyUnitBox(renderer), 462), bodyBoxPx(renderer, 462));
      assert.deepEqual(unitBoxPercent(bodyUnitBox(renderer)), bodyBoxPercent(renderer));
    }
  });
});
