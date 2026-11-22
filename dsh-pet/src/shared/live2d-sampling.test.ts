/**
 * Live2D 采样口径的契约测试。
 *
 * 盯住三件直接决定「桌宠比 VTube Studio 糊」的事：
 *   1) 模型贴图必须**关 mipmap**（PIXI 默认 MIPMAP_MODES.POW2 会把线稿低通掉）；
 *   2) 画布分辨率**不低于设备像素比**，超采样只是往上加的一档；
 *   3) 裁剪掩膜缓冲区要按画布实际像素放大（官方默认 256² 会让掩膜边缘糊）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyLive2dMaskBuffer,
  applyLive2dTextureSampling,
  live2dMaskBufferSide,
  live2dRenderResolution,
  LIVE2D_MASK_SIDE_MAX,
  LIVE2D_MASK_SIDE_MIN,
  LIVE2D_RENDER_SIDE_MAX,
  LIVE2D_SUPERSAMPLE,
  type Live2dPixiFace,
  type Live2dRendererFace,
  type Live2dTextureFace,
} from './live2d-sampling.ts';

/** PIXI v6 的枚举值（与 pixi.js 一致）：OFF=0、ON=1、POW2=2；LINEAR=1。 */
function pixiFace(): Live2dPixiFace {
  return { MIPMAP_MODES: { OFF: 0 }, SCALE_MODES: { LINEAR: 1 }, settings: { MIPMAP_TEXTURES: 2 } };
}

function tex(mipmap: number, scaleMode = 0): Live2dTextureFace {
  return { baseTexture: { mipmap, scaleMode } };
}

function renderer(
  size = 256,
): Live2dRendererFace & { _clippingManager: { _clippingMaskBufferSize: number; _maskTexture?: unknown } } {
  return { _clippingManager: { _clippingMaskBufferSize: size, _maskTexture: { texture: 1, frameNo: 7 } } };
}

describe('live2dRenderResolution —— 画布分辨率', () => {
  test('设备像素比 × 超采样倍数，预算够时就是这一档', () => {
    assert.equal(live2dRenderResolution(1), LIVE2D_SUPERSAMPLE);
    assert.equal(live2dRenderResolution(1.25), 2.5);
    assert.equal(live2dRenderResolution(1.5, 490), 3);
  });

  test('绝不低于设备像素比：分辨率是设备与用户的事，我们只往上加', () => {
    for (const dpr of [1, 1.25, 1.5, 2, 3, 4]) {
      for (const frame of [undefined, 120, 490, 2048]) {
        assert.ok(
          live2dRenderResolution(dpr, frame) >= dpr,
          `dpr=${String(dpr)} frame=${String(frame)} 时分辨率被压到设备像素比之下`,
        );
      }
    }
  });

  test('画框太大时只削超采样那一档，削不到设备像素比', () => {
    // 预算 2048 / 画框 2048 = 1，超采样被削到 1，但下限仍是 dpr。
    assert.equal(live2dRenderResolution(2, 2048), 2);
    assert.equal(live2dRenderResolution(1, 2048), 1);
    assert.equal(live2dRenderResolution(1.5, 1600), 1.5);
  });

  test('预算按画框边长算：小画框用满超采样，大画框被夹到预算边', () => {
    assert.equal(live2dRenderResolution(2, 400), Math.min(4, LIVE2D_RENDER_SIDE_MAX / 400));
    assert.equal(live2dRenderResolution(2, 100), 4);
  });

  test('设备像素比缺失或非法时按 1 算，不返回 NaN', () => {
    for (const bad of [undefined, 0, Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const got = live2dRenderResolution(bad);
      assert.ok(Number.isFinite(got) && got > 0, `${String(bad)} 应回落到 1 的倍数`);
      assert.equal(got, LIVE2D_SUPERSAMPLE);
    }
  });
});

describe('live2dMaskBufferSide —— 裁剪掩膜缓冲区', () => {
  test('跟着画布实际像素走，向上取 2 的幂', () => {
    assert.equal(live2dMaskBufferSide(300, 2), 1024);
    assert.equal(live2dMaskBufferSide(260, 2), 1024);
  });

  test('夹在上下限之间（小画布不至于更糊，大画布别烧满帧耗时）', () => {
    assert.equal(live2dMaskBufferSide(100, 2), LIVE2D_MASK_SIDE_MIN);
    assert.equal(live2dMaskBufferSide(10, 1), LIVE2D_MASK_SIDE_MIN);
    assert.equal(live2dMaskBufferSide(490, 3), LIVE2D_MASK_SIDE_MAX);
    assert.equal(live2dMaskBufferSide(4096, 4), LIVE2D_MASK_SIDE_MAX);
    assert.equal(live2dMaskBufferSide(Number.NaN, Number.NaN), LIVE2D_MASK_SIDE_MIN);
  });
});

describe('applyLive2dTextureSampling —— 贴图采样', () => {
  test('mipmap 关掉、过滤保持双线性', () => {
    const textures = [tex(2), tex(2)];
    const changed = applyLive2dTextureSampling(textures, pixiFace());
    assert.equal(changed, 2);
    for (const t of textures) {
      assert.equal(t.baseTexture.mipmap, 0);
      assert.equal(t.baseTexture.scaleMode, 1);
    }
  });

  test('连 PIXI 的全局开关一起关（之后才创建的贴图也不生 mip 链）', () => {
    const pixi = pixiFace();
    applyLive2dTextureSampling([], pixi);
    assert.equal(pixi.settings?.MIPMAP_TEXTURES, 0);
  });

  test('没有 settings 时只走逐张贴图，不抛错', () => {
    const pixi: Live2dPixiFace = { MIPMAP_MODES: { OFF: 0 }, SCALE_MODES: { LINEAR: 1 } };
    const textures = [tex(2)];
    assert.equal(applyLive2dTextureSampling(textures, pixi), 1);
    assert.equal(textures[0].baseTexture.mipmap, 0);
  });

  test('本来就是 OFF 的不动它（避免无谓地让 PIXI 重传贴图）', () => {
    const textures = [tex(0, 1)];
    assert.equal(applyLive2dTextureSampling(textures, pixiFace()), 0);
    assert.equal(textures[0].baseTexture.mipmap, 0);
  });

  test('贴图数组缺失时安静返回 0（不炸渲染）', () => {
    assert.equal(applyLive2dTextureSampling(undefined, pixiFace()), 0);
    assert.equal(applyLive2dTextureSampling([], pixiFace()), 0);
  });
});

describe('applyLive2dMaskBuffer —— 掩膜缓冲区', () => {
  test('改尺寸并丢掉缓存贴图（否则会沿用旧尺寸）', () => {
    const face = renderer(256);
    assert.equal(applyLive2dMaskBuffer(face, 2048), true);
    assert.equal(face._clippingManager._clippingMaskBufferSize, 2048);
    assert.equal(face._clippingManager._maskTexture, undefined);
  });

  test('尺寸没变时不动、不清缓存', () => {
    const face = renderer(2048);
    assert.equal(applyLive2dMaskBuffer(face, 2048), false);
    assert.notEqual(face._clippingManager._maskTexture, undefined);
  });

  test('渲染器不是预期形状时安静返回 false（绝不半改）', () => {
    assert.equal(applyLive2dMaskBuffer(undefined, 2048), false);
    assert.equal(applyLive2dMaskBuffer({} as Live2dRendererFace, 2048), false);
    assert.equal(applyLive2dMaskBuffer({ _clippingManager: {} } as Live2dRendererFace, 2048), false);
  });
});
