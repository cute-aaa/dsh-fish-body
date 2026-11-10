/**
 * live2d 渲染后端：`pixi-live2d-display`（cubism4 框架）+ Live2D Cubism Core（wasm 内嵌单文件）。
 * 与 layered 类似没有 video：模型在 PIXI 画布上跑自然运动（呼吸/眨眼/物理），
 * 口型 / 视线走标准参数（ParamMouthOpenY / ParamEyeBallX/Y）；动作（motion）/表情（expression）
 * 依赖 model3.json 声明（本机 DeepSeek 公皮未声明，故静默降级为自然运动）。
 * 皮肤目录 `pet/<素材根>-skin/` 下可放多个 `.model3.json`，按 pets[].model 选择，缺省取第一个。
 * pixi 与 cubism4 一律**动态 import**：cubism4 在被求值时就要求 `window.Live2DCubismCore` 已存在，
 * 静态 import 会让整份客户端 bundle 一加载就抛错，桌宠与设置页一起挂掉。
 * @module dsh-pet/src/client/pet/render/live2d
 */
import type * as PIXI from 'pixi.js';
import type { Live2DModel } from 'pixi-live2d-display/cubism4';
import { ROUTE_PATH } from '../../../shared/constants.ts';
import type { Renderer, RendererMountOptions } from './types.ts';

/** Cubism Core 全局（由 live2dcubismcore.min.js 注入）。 */
interface CubismCoreWindow {
  Live2DCubismCore?: unknown;
}

/** 拼一个皮肤资源地址。 */
function skinUrl(root: string, rel: string): string {
  return ROUTE_PATH + '/skin/' + encodeURIComponent(root) + '/' + rel;
}

/** 注入 Cubism Core 脚本并等待全局就绪（幂等）。 */
async function ensureCubismCore(): Promise<void> {
  const win = window as unknown as CubismCoreWindow;
  if (win.Live2DCubismCore !== undefined) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = ROUTE_PATH + '/cubism/live2dcubismcore.min.js';
    script.onload = () => (win.Live2DCubismCore !== undefined ? resolve() : reject(new Error('Cubism Core 未就绪')));
    script.onerror = () => reject(new Error('Cubism Core 脚本加载失败'));
    document.head.appendChild(script);
  });
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
  /** cubism4 模块（mount 时动态 import）：模型工厂与动作优先级都从这里取。 */
  let cubism: typeof import('pixi-live2d-display/cubism4') | null = null;
  let ready = false;
  let destroyed = false;
  let size = 0;

  const mount = async (el: HTMLElement, opts: RendererMountOptions): Promise<void> => {
    if (stage !== null) destroy();
    stage = el;
    size = opts.size;
    const root = opts.assetRoot;
    await ensureCubismCore();
    if (destroyed) return;

    const [pixi, cubismModule] = await Promise.all([import('pixi.js'), import('pixi-live2d-display/cubism4')]);
    if (destroyed) return;
    cubism = cubismModule;

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
    cubismModule.Live2DModel.registerTicker(pixi.Ticker);
    app.view.style.cssText = 'position:absolute;left:50%;bottom:0;transform:translateX(-50%);pointer-events:none;';
    el.appendChild(app.view);

    model = await cubismModule.Live2DModel.from(skinUrl(root, chosen), { autoInteract: false });
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
