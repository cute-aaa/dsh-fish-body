/**
 * 截屏链路的几何与黑图判定（runtime/electron-helper/main/capture.js）。
 *
 * 这个模块被 `pet:capture-screen`（对话截图）与 `pet:screen-frame`（识屏）共用，
 * 所以只钉三件与 Electron 无关的事：等比缩放、黑图采样、按屏取图的选择。
 * 「4K/150% 出黑图」这条老毛病靠黑图判定兜住——判黑不上传，交给渲染端走 getDisplayMedia 兜底。
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

const require = createRequire(import.meta.url);
const capture = require('../../runtime/electron-helper/main/capture.js') as {
  BLACK_LIT_MIN_RATIO: number;
  fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } | null;
  isMostlyBlack(image: unknown): boolean;
  grabScreen(deps: Record<string, unknown>): Promise<{
    mediaType: string;
    data: string;
    width: number;
    height: number;
    bytes: number;
    scaleFactor: number;
    black: boolean;
  } | null>;
};

/** 造一张假 NativeImage：BGRA 位图 + 可观察的 resize/toJPEG 调用。 */
function fakeImage(width: number, height: number, lit: boolean) {
  const bitmap = Buffer.alloc(width * height * 4);
  if (lit) {
    // 竖条纹（约 1/8 的列是白的）：远高于黑图阈值，代表「桌面上有内容」
    for (let x = 0; x < width; x += 8) {
      for (let y = 0; y < height; y += 1) {
        const i = (y * width + x) * 4;
        bitmap[i] = 255;
        bitmap[i + 1] = 255;
        bitmap[i + 2] = 255;
      }
    }
  }
  const calls: { resized?: { width: number; height: number }; quality?: number } = {};
  return {
    calls,
    image: {
      getSize: () => ({ width, height }),
      toBitmap: () => bitmap,
      isEmpty: () => false,
      resize: (opts: { width: number; height: number }) => {
        calls.resized = { width: opts.width, height: opts.height };
        return {
          getSize: () => ({ width: opts.width, height: opts.height }),
          toJPEG: (quality: number) => {
            calls.quality = quality;
            return Buffer.alloc(1234, 7);
          },
        };
      },
      toJPEG: (quality: number) => {
        calls.quality = quality;
        return Buffer.alloc(4096, 9);
      },
    },
  };
}

/** 造一份 Electron 依赖：主屏 3840×2160 @1.5（4K / 150% 就是这条路径出问题）。 */
function fakeElectron(opts: { lit: boolean; empty?: boolean; scale?: number }) {
  const scale = opts.scale ?? 1.5;
  const primary = { id: 7, size: { width: 2560, height: 1440 }, scaleFactor: scale, bounds: {} };
  const { image, calls } = fakeImage(3840, 2160, opts.lit);
  if (opts.empty) image.isEmpty = () => true;
  const requested: { width: number; height: number }[] = [];
  return {
    calls,
    requested,
    deps: {
      screen: { getDisplayMatching: () => primary, getPrimaryDisplay: () => primary },
      desktopCapturer: {
        getSources: async (args: { thumbnailSize: { width: number; height: number } }) => {
          requested.push(args.thumbnailSize);
          return [{ display_id: '7', thumbnail: image }];
        },
      },
      win: undefined,
    },
  };
}

describe('fitWithin', () => {
  test('长边不超上限时不动', () => {
    assert.equal(capture.fitWithin(1280, 720, 1280), null);
    assert.equal(capture.fitWithin(640, 480, 1280), null);
  });

  test('4K 等比缩到 1280×720', () => {
    assert.deepEqual(capture.fitWithin(3840, 2160, 1280), { width: 1280, height: 720 });
    assert.deepEqual(capture.fitWithin(2160, 3840, 1280), { width: 720, height: 1280 });
  });

  test('上限非法 = 不缩', () => {
    assert.equal(capture.fitWithin(3840, 2160, 0), null);
    assert.equal(capture.fitWithin(3840, 2160, Number.NaN), null);
  });
});

describe('isMostlyBlack', () => {
  test('全黑位图判黑', () => {
    const { image } = fakeImage(64, 64, false);
    assert.equal(capture.isMostlyBlack(image), true);
  });

  test('有内容的位图不判黑', () => {
    const { image } = fakeImage(64, 64, true);
    assert.equal(capture.isMostlyBlack(image), false);
  });

  test('形状不对不抛错：缺能力按「判不了 = 不算黑」处理（宁可多上传一次，也别静默丢掉画面）', () => {
    assert.equal(capture.isMostlyBlack(null), false);
    assert.equal(capture.isMostlyBlack({}), false);
    assert.equal(
      capture.isMostlyBlack({ getSize: () => ({ width: 0, height: 0 }), toBitmap: () => Buffer.alloc(0) }),
      true,
    );
  });

  test('阈值是「非黑占比」——一个亮点远不够', () => {
    const image = {
      getSize: () => ({ width: 100, height: 100 }),
      toBitmap: () => {
        const buf = Buffer.alloc(100 * 100 * 4);
        buf[0] = 255; // 只有一个采样点附近是亮的
        return buf;
      },
    };
    assert.equal(capture.isMostlyBlack(image), true);
    assert.ok(capture.BLACK_LIT_MIN_RATIO > 0);
  });
});

describe('grabScreen', () => {
  test('识屏路径：按物理像素请求、缩到长边 1280、判黑、质量 80', async () => {
    const fake = fakeElectron({ lit: true });
    const shot = await capture.grabScreen({ ...fake.deps, maxEdge: 1280, quality: 80, checkBlack: true });
    assert.ok(shot);
    assert.equal(shot?.width, 1280);
    assert.equal(shot?.height, 720);
    assert.equal(shot?.black, false);
    assert.equal(shot?.mediaType, 'image/jpeg');
    assert.equal(shot?.scaleFactor, 1.5);
    // 请求尺寸是「DIP × scaleFactor」= 物理像素
    assert.deepEqual(fake.requested[0], { width: 3840, height: 2160 });
    assert.deepEqual(fake.calls.resized, { width: 1280, height: 720 });
    assert.equal(fake.calls.quality, 80);
    assert.equal(shot?.bytes, 1234);
  });

  test('对话截图路径：不缩、质量 85、不判黑', async () => {
    const fake = fakeElectron({ lit: false });
    const shot = await capture.grabScreen({ ...fake.deps, quality: 85, checkBlack: false });
    assert.ok(shot);
    assert.equal(fake.calls.resized, undefined);
    assert.equal(fake.calls.quality, 85);
    assert.equal(shot?.black, false);
    assert.equal(shot?.bytes, 4096);
  });

  test('黑图结论要透出（渲染端据此走 getDisplayMedia 兜底）', async () => {
    const fake = fakeElectron({ lit: false });
    const shot = await capture.grabScreen({ ...fake.deps, maxEdge: 1280, checkBlack: true });
    assert.equal(shot?.black, true);
  });

  test('取不到画面 → null', async () => {
    const fake = fakeElectron({ lit: true, empty: true });
    assert.equal(await capture.grabScreen(fake.deps), null);
    assert.equal(await capture.grabScreen({}), null);
  });
});
