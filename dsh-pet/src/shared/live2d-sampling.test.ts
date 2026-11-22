/**
 * Live2D 采样设置与画布分辨率的契约测试。
 *
 * 盯住两件会直接决定「桌宠比 VTube Studio 糊」的事：
 *   1) 模型贴图必须**关 mipmap**（PIXI 默认 MIPMAP_MODES.POW2 会把线稿低通掉）；
 *   2) 画布分辨率必须**超采样**（关了 mipmap 就没有低通兜底，欠采样的锯齿要靠缩回抹平）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyLive2dTextureSampling,
  live2dRenderResolution,
  LIVE2D_RENDER_RESOLUTION_MAX,
  LIVE2D_SUPERSAMPLE,
  type Live2dPixiFace,
  type Live2dTextureFace,
} from './live2d-sampling.ts';

/** PIXI v6 的枚举值（与 pixi.js 一致）：OFF=0、ON=1、POW2=2；LINEAR=1。 */
const PIXI_FACE: Live2dPixiFace = {
  MIPMAP_MODES: { OFF: 0 },
  SCALE_MODES: { LINEAR: 1 },
};

function tex(mipmap: number, scaleMode = 0): Live2dTextureFace {
  return { baseTexture: { mipmap, scaleMode } };
}

describe('live2dRenderResolution —— 画布分辨率', () => {
  test('设备像素比 × 超采样倍数', () => {
    assert.equal(live2dRenderResolution(1), LIVE2D_SUPERSAMPLE);
    assert.equal(live2dRenderResolution(1.25), 2.5);
    assert.equal(live2dRenderResolution(1.5), 3);
  });

  test('封顶后不再涨（别把填充率烧穿）', () => {
    assert.equal(live2dRenderResolution(2), LIVE2D_RENDER_RESOLUTION_MAX);
    assert.equal(live2dRenderResolution(3), LIVE2D_RENDER_RESOLUTION_MAX);
  });

  test('设备像素比缺失或非法时按 1 算，不返回 NaN', () => {
    assert.equal(live2dRenderResolution(undefined), LIVE2D_SUPERSAMPLE);
    assert.equal(live2dRenderResolution(0), LIVE2D_SUPERSAMPLE);
    assert.equal(live2dRenderResolution(Number.NaN), LIVE2D_SUPERSAMPLE);
    assert.equal(live2dRenderResolution(-1), LIVE2D_SUPERSAMPLE);
  });

  test('不得低于设备像素比（否则比现在还糊）', () => {
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      assert.ok(live2dRenderResolution(dpr) >= dpr, `dpr=${dpr} 时分辨率反而更低`);
    }
  });
});

describe('applyLive2dTextureSampling —— 贴图采样', () => {
  test('mipmap 关掉、过滤保持双线性', () => {
    const textures = [tex(2), tex(2)];
    const changed = applyLive2dTextureSampling(textures, PIXI_FACE);
    assert.equal(changed, 2);
    for (const t of textures) {
      assert.equal(t.baseTexture.mipmap, PIXI_FACE.MIPMAP_MODES.OFF);
      assert.equal(t.baseTexture.scaleMode, PIXI_FACE.SCALE_MODES.LINEAR);
    }
  });

  test('本来就是 OFF 的不动它（避免无谓地让 PIXI 重传贴图）', () => {
    const textures = [tex(0, 1)];
    assert.equal(applyLive2dTextureSampling(textures, PIXI_FACE), 0);
    assert.equal(textures[0].baseTexture.mipmap, 0);
  });

  test('贴图数组缺失时安静返回 0（不炸渲染）', () => {
    assert.equal(applyLive2dTextureSampling(undefined, PIXI_FACE), 0);
    assert.equal(applyLive2dTextureSampling([], PIXI_FACE), 0);
  });
});
