/**
 * layered 皮肤清单解析与装配数学的契约测试：纯函数，无 DOM / 无图片解码。
 * 覆盖：容错解析、张嘴素材插入、眨眼/视线/尾巴/嘴的姿态折出、命中判定。
 * @module dsh-fish-body/src/client/pet/render/layered/layered.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseSkinManifest, type SkinManifest } from './types.ts';
import { computePoses, drawPoses, hitTest, type LoadedLayer, type RigState } from './rig.ts';
import type { LayerPose } from './rig.ts';

/** 一张假图（只作占位，不进 drawPoses）。 */
const IMG = {} as CanvasImageSource;

/** 最小皮肤清单（含一只眼、一张嘴、一条尾巴）。 */
function skinOf(): SkinManifest {
  const parsed = parseSkinManifest({
    canvas: { w: 1024, h: 1024 },
    display: { scale: 0.44 },
    hitbox: { x: 205, y: 95, w: 630, h: 929 },
    rigOptions: {
      headPivot: [556, 512],
      gazeCenter: [586, 392],
      eyeCenters: { l: [648, 411], r: [524, 374] },
      tailPivot: [720, 660],
      tailAmp: 0.13,
      blinkLash: { l: [0, 10], r: [0, 12] },
      motion: { breath: 0.011, sway: 0.008, gazeMax: [6, 4.5] },
      mouth: { rest: 'closed', open: 'art/11_mouth_open.png', openOffset: [-3, -4], openRotation: 15, hideBase: true },
    },
    interaction: {
      regions: [
        { id: 'head', shape: { type: 'ellipse', cx: 596, cy: 320, rx: 200, ry: 200 } },
        { id: 'body', shape: { type: 'rect', x: 240, y: 480, w: 560, h: 544 } },
      ],
      menu: ['mouth', 'blink'],
    },
    layers: [
      { id: 'hair.back', file: 'art/02_back_hair.png', group: 'body', role: 'hair.back' },
      { id: 'tail', file: 'art/03_tail.png', group: 'body', role: 'tail' },
      { id: 'mouth', file: 'art/11_mouth.png', group: 'head', role: 'mouth' },
      { id: 'eye.iris.l', file: 'art/14_irides-l.png', group: 'head', role: 'eye.iris.l' },
      { id: 'eye.lash.l', file: 'art/16_eyelash-l.png', group: 'head', role: 'eye.lash.l' },
      { id: 'hair.front', file: 'art/20_front_hair.png', group: 'head', role: 'hair.front' },
    ],
  });
  assert.ok(parsed, '最小清单应可解析');
  return parsed!;
}

/** 造一层。 */
function layer(role: string, group: 'body' | 'head' = 'body'): LoadedLayer {
  return { role, group, image: IMG };
}

/** 全零姿态。 */
const REST: RigState = { breath: 0, sway: 0, blink: 0, gazeX: 0, gazeY: 0, mouth: 0, tail: 0, hop: 0, jelly: 0 };

describe('parseSkinManifest —— 容错解析', () => {
  test('最小清单：画布 / 层 / 命中框 / 装配参数都解析出来', () => {
    const s = skinOf();
    assert.deepEqual(s.canvas, { w: 1024, h: 1024 });
    assert.equal(s.layers.length, 6);
    assert.deepEqual(s.hitbox, { x: 205, y: 95, w: 630, h: 929 });
    assert.equal(s.rig.mouth?.rest, 'closed');
    assert.deepEqual(s.rig.mouth?.openOffset, [-3, -4]);
    assert.equal(s.interaction.regions?.length, 2);
  });

  test('坏输入：非对象 / 缺 canvas / 缺 layers → null', () => {
    assert.equal(parseSkinManifest(null), null);
    assert.equal(parseSkinManifest({}), null);
    assert.equal(parseSkinManifest({ canvas: { w: 1, h: 1 } }), null);
    assert.equal(parseSkinManifest({ layers: [{ id: 'a', file: 'a.png' }] }), null);
  });
});

describe('computePoses —— 姿态折出', () => {
  test('姿态数与层数一致；张嘴素材在嘴层之后插入', () => {
    const s = skinOf();
    const layers = [layer('tail'), layer('mouth', 'head'), layer('hair.front', 'head')];
    const poses = computePoses(s, layers, { image: IMG }, { ...REST, mouth: 1 });
    // 3 层 + 1 张嘴 = 4；张嘴排在基础嘴之后、hair.front 之前。
    assert.equal(poses.length, 4);
    assert.ok(poses[1].alpha <= 0.003, '基础嘴在张嘴时应淡出');
    assert.ok(poses[2].alpha > 0.5, '张嘴素材应可见');
  });

  test('眨眼：睫毛层下移；视线：虹膜层平移', () => {
    const s = skinOf();
    const poses = computePoses(s, [layer('eye.iris.l', 'head'), layer('eye.lash.l', 'head')], null, {
      ...REST,
      blink: 1,
      gazeX: 1,
      gazeY: 1,
    });
    const iris = poses.find((p) => p === poses[0])!;
    const lash = poses[1];
    assert.ok(iris.dx > 0, '虹膜应随视线右移');
    assert.ok(iris.dy > 0, '虹膜应随视线下移');
    assert.equal(lash.dy, 10, '左眼睫毛下移 10px');
  });

  test('尾巴：绕尾枢旋转', () => {
    const s = skinOf();
    const poses = computePoses(s, [layer('tail')], null, { ...REST, tail: 1 });
    assert.ok(poses[0].rot > 0, '尾巴应旋转');
    assert.equal(poses[0].pivotX, 720);
    assert.equal(poses[0].pivotY, 660);
  });
});

describe('drawPoses —— 只画有效子矩形，清屏在设备空间', () => {
  /** 一次调用记录。 */
  interface Call {
    readonly op: string;
    readonly args: readonly unknown[];
  }

  /** 假 ctx：只实现 drawPoses / drawPose 用到的接口，把每次调用记下来供断言。 */
  function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
    const calls: Call[] = [];
    const record =
      (op: string) =>
      (...args: unknown[]): void => {
        calls.push({ op, args });
      };
    const raw = {
      canvas: { width: 462, height: 462 },
      save: record('save'),
      restore: record('restore'),
      setTransform: record('setTransform'),
      clearRect: record('clearRect'),
      translate: record('translate'),
      rotate: record('rotate'),
      scale: record('scale'),
      drawImage: record('drawImage'),
      globalAlpha: 1,
    };
    return { ctx: raw as unknown as CanvasRenderingContext2D, calls };
  }

  /** 一层姿态：只有 box 与绘图相关的字段有意义。 */
  const pose = (over: Partial<LayerPose> = {}): LayerPose => ({
    image: IMG,
    pivotX: 0,
    pivotY: 0,
    dx: 0,
    dy: 0,
    rot: 0,
    sx: 1,
    sy: 1,
    alpha: 1,
    ...over,
  });

  test('有包围盒：drawImage 走 9 参子矩形，源矩形与目标矩形同坐标', () => {
    const { ctx, calls } = fakeCtx();
    drawPoses(ctx, [pose({ pivotX: 512, pivotY: 1024, box: { x: 100, y: 200, w: 30, h: 40 } })]);
    const draws = calls.filter((c) => c.op === 'drawImage');
    assert.equal(draws.length, 1);
    assert.deepEqual(draws[0]?.args, [IMG, 100, 200, 30, 40, 100, 200, 30, 40]);
  });

  test('没有包围盒：退回整幅（3 参 drawImage），视觉零回归', () => {
    const { ctx, calls } = fakeCtx();
    drawPoses(ctx, [pose()]);
    const draws = calls.filter((c) => c.op === 'drawImage');
    assert.deepEqual(draws[0]?.args, [IMG, 0, 0]);
  });

  test('清屏前把变换重置成单位矩阵：渲染侧的缩放变换不会把 clearRect 也放大', () => {
    const { ctx, calls } = fakeCtx();
    drawPoses(ctx, []);
    assert.deepEqual(
      calls.map((c) => c.op),
      ['save', 'setTransform', 'clearRect', 'restore'],
    );
    assert.deepEqual(calls[1]?.args, [1, 0, 0, 1, 0, 0]);
    assert.deepEqual(calls[2]?.args, [0, 0, 462, 462]);
  });
});

describe('layered-core.js —— 产物与源码同步（桌面 Helper 的守卫）', () => {
  /** 经典 script 产物：运行时由 index.html 加载成 window.PetLayered（.gitignore 内的构建产物）。 */
  const corePath = fileURLToPath(new URL('../../../../../runtime/electron-helper/layered-core.js', import.meta.url));

  test(
    '构建产物必须导出桌面端用到的全部入口（改完 layered/ 记得重跑 build:desktop-core）',
    { skip: existsSync(corePath) ? false : '尚未构建（npm run build:desktop-core）' },
    () => {
      const code = readFileSync(corePath, 'utf8');
      // 桌面端 backend.js 直接读这些全局：产物比源码旧时少一个，运行期就是「宠物窗在、画面全透明」。
      for (const name of [
        'parseSkinManifest',
        'computePoses',
        'drawPoses',
        'hitTest',
        'assemblyActionOf',
        'alphaBoxOf',
        'boxToSource',
        'measureLayerBox',
        'measureVisualTopRatio',
      ]) {
        assert.ok(
          code.includes('exports.' + name + ' ='),
          '产物缺少导出 ' + name + '：请重跑 npm run build:desktop-core',
        );
      }
    },
  );
});

describe('hitTest —— 命中判定', () => {
  test('椭圆与矩形命中区', () => {
    const s = skinOf();
    assert.equal(hitTest(s, 596, 320), 'head');
    assert.equal(hitTest(s, 400, 600), 'body');
    assert.equal(hitTest(s, 10, 10), undefined);
  });
});
