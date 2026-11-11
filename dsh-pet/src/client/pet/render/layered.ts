/**
 * layered 渲染后端：把 surfcore `manifest.json` + 分层 PNG 合成到画布，跑呼吸/摇摆/眨眼/嘴/尾巴装配。
 * 与 webm 不同：没有 video、没有 A/B 缓冲，「动作」就是装配动画（blink/wag/hop/talk/mouth），
 * 播放进度恒为零；运动与交互仍留在卡片层，本模块只提供视觉 + 动作 + 命中判定。
 * 皮肤从 `pet/<素材根>-skin/` 扫描，经宿主 `/skin/<素材根>/<file>` 路由取。
 * @module dsh-pet/src/client/pet/render/layered
 */
import { ROUTE_PATH } from '../../../shared/constants.ts';
import { bubbleAnchorY } from '../../../shared/bubble-anchor.ts';
import { LAYERED_MANIFEST_PATHS, layeredBaseOf } from '../../../shared/layered-paths.ts';
import { skinMenuGroups } from '../../../shared/menu/renderer-actions.ts';
import type { RendererActionGroup } from '../../../shared/menu/renderer-actions.ts';
import type { Renderer, RendererMountOptions } from './types.ts';
import { measureVisualTopRatio } from './visual-top.ts';
import { assemblyActionOf, type AssemblyAction } from './layered/gestures.ts';
import { gestureAtPoint } from './layered/hit.ts';
import { parseSkinManifest, type SkinManifest } from './layered/types.ts';
import { computePoses, drawPoses, hitTest as skinHitTest, type LoadedLayer, type RigState } from './layered/rig.ts';

/** 呼吸周期（ms）。 */
const BREATH_MS = 3200;
/** 摇摆周期（ms）。 */
const SWAY_MS = 5200;
/** 自动眨眼间隔范围（ms）。 */
const BLINK_GAP_MIN_MS = 2600;
const BLINK_GAP_MAX_MS = 5200;
/** 眨眼闭合时长（ms）。 */
const BLINK_MS = 130;
/** 弹跳时长（ms）。 */
const HOP_MS = 460;
/** 张嘴动作时长（ms）。 */
const MOUTH_MS = 760;
/** 尾巴/挤压的衰减系数（每秒）。 */
const DECAY = 3;

/** 拼一个皮肤资源地址。 */
function skinUrl(root: string, rel: string): string {
  return ROUTE_PATH + '/skin/' + encodeURIComponent(root) + '/' + rel;
}

/** 取图：优先 createImageBitmap（零拷贝），退回 Image。 */
async function loadImage(url: string): Promise<CanvasImageSource> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('skin image HTTP ' + res.status + ' ' + url);
  const blob = await res.blob();
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('skin image decode failed ' + url));
    img.src = URL.createObjectURL(blob);
  });
}

/** 装配动作名 → 触发哪种装配：词表在 layered/gestures.ts，与桌面 Helper 共用同一份。 */

/**
 * 找皮肤清单：先根布局后子目录布局（见 shared/layered-paths）。
 *
 * @param root - 素材根。
 * @returns 清单本体与它在素材根下的地址前缀；两种布局都没有时抛错。
 */
async function loadManifest(root: string): Promise<{ parsed: SkinManifest; base: string }> {
  let lastStatus = 0;
  for (const path of LAYERED_MANIFEST_PATHS) {
    const res = await fetch(skinUrl(root, path));
    if (!res.ok) {
      lastStatus = res.status;
      continue;
    }
    const parsed = parseSkinManifest((await res.json()) as unknown);
    if (parsed === null) throw new Error('皮肤 manifest 解析失败：' + root + '/' + path);
    return { parsed, base: layeredBaseOf(path) };
  }
  throw new Error('skin manifest HTTP ' + String(lastStatus) + ' ' + root);
}

/**
 * 造 layered 渲染实例（工厂语义：每张宠物卡一个，互不共享画布与装配状态）。
 *
 * @returns 实现 {@link Renderer} 的 layered 渲染实例。
 */
export function createLayeredRenderer(): Renderer {
  let stage: HTMLElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let skin: SkinManifest | null = null;
  let layers: LoadedLayer[] = [];
  let openMouth: CanvasImageSource | null = null;
  /** 清单声明的可播手势：右键「动作」树读它（layered 不用 webm 动画池）。 */
  let actionGroups: readonly RendererActionGroup[] = [];
  let raf = 0;
  let ready = false;
  let destroyed = false;

  // 运行时姿态。
  let tMs = 0;
  let lastMs = 0;
  let mouth = 0;
  let gazeX = 0;
  let gazeY = 0;
  let tail = 0;
  let hopActive = false;
  let hopT = 0;
  let jelly = 0;
  let blinkT = 0;
  let nextBlinkAt = BLINK_GAP_MIN_MS;
  // 张嘴 / 说话计时。
  let mouthAction = false;
  let mouthActionT = 0;
  let talk = false;

  const mount = async (el: HTMLElement, opts: RendererMountOptions): Promise<void> => {
    if (stage !== null) destroy();
    stage = el;
    const root = opts.assetRoot;
    const { parsed, base } = await loadManifest(root);
    if (destroyed) return; // 加载期间被卸载：丢弃。

    skin = parsed;
    actionGroups = skinMenuGroups(parsed.interaction.menu ?? []);
    layers = await Promise.all(
      parsed.layers.map(async (layer): Promise<LoadedLayer> => ({
        role: layer.role,
        group: layer.group,
        image: await loadImage(skinUrl(root, base + layer.file)),
      })),
    );
    openMouth = parsed.rig.mouth?.open ? await loadImage(skinUrl(root, base + parsed.rig.mouth.open)) : null;
    if (destroyed) return;

    canvas = document.createElement('canvas');
    canvas.width = parsed.canvas.w;
    canvas.height = parsed.canvas.h;
    // 方形皮肤按 size 等宽高渲染，底部对齐 stage（脚底垫高由 stage 位移兜住）。
    canvas.style.cssText =
      'position:absolute;left:50%;bottom:0;transform:translateX(-50%);' +
      `width:${opts.size}px;height:${opts.size}px;` +
      'pointer-events:none;image-rendering:auto;';
    el.appendChild(canvas);
    ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('canvas 2d context 不可用');
    ready = true;
    // 量一次内容顶：方形画布的头顶在舞台顶以上，卡片按它挪气泡（见 shared/bubble-anchor）。
    const topRatio = measureVisualTopRatio((probe, w, h) => {
      for (const layer of layers) probe.drawImage(layer.image as CanvasImageSource, 0, 0, w, h);
    });
    if (topRatio !== null) opts.source.onVisualAnchor?.(bubbleAnchorY(topRatio, opts.size));
    lastMs = performance.now();
    nextBlinkAt = lastMs + BLINK_GAP_MIN_MS;
    loop();
  };

  const destroy = (): void => {
    destroyed = true;
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
    canvas?.remove();
    canvas = null;
    ctx = null;
    skin = null;
    layers = [];
    openMouth = null;
    actionGroups = [];
    stage = null;
    ready = false;
  };

  /** 单帧：推进时间、折姿态、画一帧。 */
  const loop = (): void => {
    if (destroyed || skin === null || ctx === null) return;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - lastMs) / 1000));
    lastMs = now;
    tMs += dt * 1000;

    // 自动眨眼：到点闭合，按闭合时长衰减回睁。
    if (now >= nextBlinkAt) {
      blinkT = 1;
      nextBlinkAt = now + BLINK_MS + BLINK_GAP_MIN_MS + Math.random() * (BLINK_GAP_MAX_MS - BLINK_GAP_MIN_MS);
    }
    blinkT = Math.max(0, blinkT - dt * (1000 / BLINK_MS));

    // 弹跳：一次性的 0→1 推进。
    if (hopActive) {
      hopT += dt * (1000 / HOP_MS);
      if (hopT >= 1) {
        hopT = 0;
        hopActive = false;
      }
    }

    // 张嘴动作：0→1→0。
    if (mouthAction) {
      mouthActionT += dt * (2000 / MOUTH_MS);
      mouth = Math.sin(Math.min(mouthActionT, 1) * Math.PI);
      if (mouthActionT >= 2) {
        mouthAction = false;
        mouth = 0;
      }
    }

    // 说话：嘴随正弦开合。
    if (talk) mouth = 0.5 + 0.5 * Math.sin((tMs / 140) * 0.5);

    // 尾巴 / 挤压：衰减回 0。
    tail *= Math.max(0, 1 - dt * DECAY);
    jelly = Math.max(0, jelly - dt * DECAY);

    const s: RigState = {
      breath: (tMs / BREATH_MS) * Math.PI * 2,
      sway: (tMs / SWAY_MS) * Math.PI * 2,
      blink: blinkT,
      gazeX,
      gazeY,
      mouth,
      tail,
      hop: hopActive ? hopT : 0,
      jelly,
    };
    drawPoses(ctx, computePoses(skin, layers, openMouth, s));
    raf = requestAnimationFrame(loop);
  };

  return {
    kind: 'layered',
    mount,
    destroy,
    playAction: (name) => {
      const kind: AssemblyAction | null = assemblyActionOf(name);
      if (kind === null) return;
      if (kind === 'blink') blinkT = 1;
      else if (kind === 'wag') tail = 1;
      else if (kind === 'hop') {
        hopActive = true;
        hopT = 0;
      } else if (kind === 'talk') {
        talk = true;
        mouthAction = false;
        window.setTimeout(() => {
          talk = false;
          mouth = 0;
        }, 1600);
      } else if (kind === 'mouth') {
        mouthAction = true;
        mouthActionT = 0;
      } else if (kind === 'jelly') {
        jelly = 1;
      }
    },
    setIdle: () => {
      // 待机：回到连续呼吸/摇摆/眨眼，清掉一次性动作；name 由卡片层按 webm 池给，这里忽略。
      mouthAction = false;
      talk = false;
      hopActive = false;
      mouth = 0;
    },
    setEndedHandler: () => {},
    stopLooping: () => {},
    setFrozen: () => null,
    isFrozen: () => false,
    frontElement: () => null, // layered 没有「前台视频」，运动驱动（走位/挤压）读它得到 null 自然跳过。
    progress: () => ({ playbackId: null, anim: '', currentTime: 0, duration: 0, paused: true, buffering: false }),
    setMouth: (open) => {
      if (!mouthAction && !talk) mouth = Math.max(0, Math.min(1, open));
    },
    setGaze: (x, y) => {
      gazeX = Math.max(-1, Math.min(1, x));
      gazeY = Math.max(-1, Math.min(1, y));
    },
    hitTest: (x, y) => (skin === null ? undefined : skinHitTest(skin, x, y)),
    listActionGroups: () => actionGroups,
    /** 视口坐标 → 皮肤清单声明的命中手势；画布未挂载或没命中返回 undefined。 */
    gestureAt: (clientX, clientY) =>
      skin === null || canvas === null
        ? undefined
        : gestureAtPoint(skin, canvas.getBoundingClientRect(), clientX, clientY),
    get ready() {
      return ready;
    },
  };
}
