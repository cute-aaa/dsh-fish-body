/**
 * live2d 渲染后端：`pixi-live2d-display`（cubism4 框架）+ Live2D Cubism Core（wasm 内嵌单文件）。
 * 与 layered 类似没有 video：模型在 PIXI 画布上跑自然运动（呼吸/眨眼/物理），
 * 口型 / 视线走标准参数（ParamMouthOpenY / ParamEyeBallX/Y）；动作（motion）/表情（expression）
 * 依赖 model3.json 声明（本机 DeepSeek 公皮未声明，故静默降级为自然运动）。
 * 皮肤目录 `pet/<素材根>-skin/` 下可放多个 `.model3.json`，按 pets[].model 选择，缺省取第一个。
 * 两个依赖一律走 `/vendor` 的 UMD 脚本 + 全局 PIXI：按 ESM 打进 client bundle 会带出 node 的
 * url/punycode 垫片与顶层 import，经典脚本下必然加载失败（详见 docs/交接-P3.md 踩坑 11）。
 * @module dsh-pet/src/client/pet/render/live2d
 */
import type * as PIXI from 'pixi.js';
import type { Live2DModel } from 'pixi-live2d-display/cubism4';
import { ROUTE_PATH } from '../../../shared/constants.ts';
import type { Renderer, RendererMountOptions } from './types.ts';

/** cubism4 UMD 注册到 `PIXI.live2d` 上的面（只取用到的两项）。 */
interface Live2dNamespace {
  Live2DModel: typeof Live2DModel;
  MotionPriority: { IDLE: number };
}

/** 浏览器全局：pixi UMD 的导出面（pixi-live2d-display UMD 再挂一个 live2d 命名空间）。 */
interface Live2dWindow {
  PIXI?: typeof PIXI & { live2d?: Live2dNamespace };
  Live2DCubismCore?: unknown;
}

/** 拼一个皮肤资源地址。 */
function skinUrl(root: string, rel: string): string {
  return ROUTE_PATH + '/skin/' + encodeURIComponent(root) + '/' + rel;
}

/**
 * 注入一个经典脚本并等它把全局挂好（幂等：已就绪直接返回）。
 *
 * @param src - 脚本地址。
 * @param ready - 全局就绪判定；onload 后仍不就绪按失败处理，不留下一个空等。
 * @param label - 失败文案里的名字。
 */
async function ensureScript(src: string, ready: () => boolean, label: string): Promise<void> {
  if (ready()) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => (ready() ? resolve() : reject(new Error(label + ' 未就绪')));
    script.onerror = () => reject(new Error(label + ' 脚本加载失败'));
    document.head.appendChild(script);
  });
}

/** 依次加载 Cubism Core、pixi、pixi-live2d-display 的 UMD（顺序即依赖：后两者读前者挂的全局）。 */
async function ensureLive2dRuntime(): Promise<Live2dNamespace> {
  const win = window as unknown as Live2dWindow;
  await ensureScript(
    ROUTE_PATH + '/cubism/live2dcubismcore.min.js',
    () => win.Live2DCubismCore !== undefined,
    'Cubism Core',
  );
  await ensureScript(ROUTE_PATH + '/vendor/pixi.min.js', () => win.PIXI !== undefined, 'pixi');
  await ensureScript(
    ROUTE_PATH + '/vendor/live2d-cubism4.min.js',
    () => win.PIXI?.live2d !== undefined,
    'pixi-live2d-display',
  );
  // 上一行已经保证 live2d 命名空间存在；这里只为收窄类型。
  const namespace = win.PIXI?.live2d;
  if (namespace === undefined) throw new Error('pixi-live2d-display 未注册 PIXI.live2d');
  return namespace;
}

/** 拿 pixi 全局（ensureLive2dRuntime 之后一定存在）。 */
function pixiGlobal(): typeof PIXI {
  const pixi = (window as unknown as Live2dWindow).PIXI;
  if (pixi === undefined) throw new Error('pixi 未加载');
  return pixi;
}

/** 拉取皮肤目录下全部 `.model3.json` 相对路径。 */
async function listModels(root: string): Promise<string[]> {
  try {
    const res = await fetch(skinUrl(root, 'models'));
    if (!res.ok) return [];
    const body = (await res.json()) as { models?: unknown };
    return Array.isArray(body.models) ? body.models.filter((m): m is string => typeof m === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 造 live2d 渲染实例（工厂语义：每张宠物卡一个，互不共享 PIXI app 与模型）。
 *
 * @returns 实现 {@link Renderer} 的 live2d 渲染实例。
 */
export function createLive2dRenderer(): Renderer {
  let stage: HTMLElement | null = null;
  let app: PIXI.Application | null = null;
  let model: Live2DModel | null = null;
  /** cubism4 命名空间（mount 时加载）：模型工厂与动作优先级都从这里取。 */
  let cubism: Live2dNamespace | null = null;
  let ready = false;
  let destroyed = false;
  let size = 0;

  const mount = async (el: HTMLElement, opts: RendererMountOptions): Promise<void> => {
    if (stage !== null) destroy();
    stage = el;
    size = opts.size;
    const root = opts.assetRoot;
    cubism = await ensureLive2dRuntime();
    if (destroyed) return;
    const pixi = pixiGlobal();

    // 列出可用模型，选中配置指定的那份，缺省第一个。
    const models = await listModels(root);
    const configured = opts.source.cfg().model;
    const chosen = configured !== undefined && models.includes(configured) ? configured : models[0];
    if (chosen === undefined) throw new Error('皮肤目录没有 .model3.json：' + root);
    if (destroyed) return;

    app = new pixi.Application({
      width: size,
      height: size,
      transparent: true,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    cubism.Live2DModel.registerTicker(pixi.Ticker);
    app.view.style.cssText = 'position:absolute;left:50%;bottom:0;transform:translateX(-50%);pointer-events:none;';
    el.appendChild(app.view);

    model = await cubism.Live2DModel.from(skinUrl(root, chosen), { autoInteract: false });
    if (destroyed) {
      model.destroy();
      model = null;
      return;
    }
    app.stage.addChild(model);
    // 居中 + 按画布大边适配 size。
    const mw = model.internalModel.originalWidth;
    const mh = model.internalModel.originalHeight;
    const scale = size / Math.max(mw, mh);
    model.anchor.set(0.5, 0.5);
    model.scale.set(scale);
    model.x = size / 2;
    model.y = size / 2;
    ready = true;
  };

  const destroy = (): void => {
    destroyed = true;
    model?.destroy();
    model = null;
    if (app !== null) {
      app.destroy(true, { children: true, texture: true, baseTexture: true });
      app = null;
    }
    stage = null;
    ready = false;
  };

  /** 设一个标准参数（缺失参数静默忽略）。 */
  const setParam = (id: string, value: number): void => {
    if (model === null) return;
    const core = model.internalModel.coreModel as {
      setParameterValueById?(id: string, value: number, weight?: number): void;
    };
    core.setParameterValueById?.(id, value);
  };

  return {
    kind: 'live2d',
    mount,
    destroy,
    playAction: (name) => {
      // 动作名来自 webm 池，live2d 用不上；有「Idle」组时尝试播一段，其余静默。
      if (model === null || cubism === null) return;
      if (/tap|click|摸|戳/i.test(name)) {
        model.tap(size / 2, size / 2);
        return;
      }
      void model.motion('Idle', undefined, cubism.MotionPriority.IDLE);
    },
    setIdle: () => {
      void model?.motion('Idle', undefined, cubism?.MotionPriority.IDLE);
    },
    setEndedHandler: () => {},
    stopLooping: () => {},
    setFrozen: () => null,
    isFrozen: () => false,
    frontElement: () => null, // live2d 没有「前台视频」，走位/挤压自然跳过。
    progress: () => ({ playbackId: null, anim: '', currentTime: 0, duration: 0, paused: true, buffering: false }),
    setMouth: (open) => setParam('ParamMouthOpenY', Math.max(0, Math.min(1, open))),
    setGaze: (x, y) => {
      setParam('ParamEyeBallX', Math.max(-1, Math.min(1, x)));
      setParam('ParamEyeBallY', Math.max(-1, Math.min(1, y)));
    },
    hitTest: () => undefined, // model3.json 未声明 HitAreas 时无命中区。
    get ready() {
      return ready;
    },
  };
}
