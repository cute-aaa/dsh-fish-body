/**
 * live2d 渲染后端：`pixi-live2d-display`（cubism4 框架）+ Live2D Cubism Core（wasm 内嵌单文件）。
 * 与 layered 类似没有 video：模型在 PIXI 画布上跑自然运动（呼吸/眨眼/物理），
 * 口型 / 视线走标准参数（ParamMouthOpenY / ParamEyeBallX/Y）。
 *
 * 动作与外观**不用运行库的 motion/expression API**：那套实现同一时刻只能一条（见
 * render/live2d/overlay 的说明）。热键动作走叠加层，待机仍交给运行库（它自己循环 Idle、处理眨眼）。
 * 逐模型的图层修正（如勿画纯黑遮罩源）在 `shared/live2d-fixes`，桌面 `sprite/backend.js` 读同一张表。
 * 两个依赖一律走 `/vendor` 的 UMD 脚本 + 全局 PIXI：按 ESM 打进 client bundle 会带出 node 的
 * url/punycode 垫片与顶层 import，经典脚本下必然加载失败（详见 docs/交接-P3.md 踩坑 11）。
 * @module dsh-fish-body/src/client/pet/render/live2d
 */
import type * as PIXI from 'pixi.js';
import type { Live2DModel } from 'pixi-live2d-display/cubism4';
import { ROUTE_PATH } from '../../../shared/constants.ts';
import { bubbleAnchorY } from '../../../shared/bubble-anchor.ts';
import { hiddenDrawableIndexesOf } from '../../../shared/live2d-fixes.ts';
import {
  model3ActionGroups,
  model3ExpressionRefs,
  model3ExpressionReset,
  model3Motions,
  resolveModelFile,
  type Model3Expression,
  type Model3Motion,
  type RendererActionGroup,
} from '../../../shared/menu/renderer-actions.ts';
import { EXPRESSION_RESET, MOTION_RESET } from '../../../shared/menu/tree.ts';
import { createOverlay, type Overlay, type OverlayApi, type OverlayCoreModel } from './live2d/overlay.ts';
import type { Renderer, RendererMountOptions } from './types.ts';
import { measureVisualTopRatio } from './visual-top.ts';

/** cubism4 UMD 注册到 `PIXI.live2d` 上的面（模型工厂、动作优先级与叠加层要的三个构造入口）。 */
interface Live2dNamespace extends OverlayApi {
  readonly Live2DModel: typeof Live2DModel;
  readonly MotionPriority: { readonly IDLE: number; readonly NORMAL: number };
}

/** 菜单动作名 → motion 组与序号（`motion:<组>:<序号>`，见 shared/menu/renderer-actions）。 */
const MOTION_ID = /^motion:(.+):(\d+)$/;
/** 菜单动作名 → 外观（`expression:<名>`）。 */
const EXPRESSION_PREFIX = 'expression:';
/**
 * 人设下发的外观切换：`expression-only:<名>`，覆盖语义（先摘光再挂）。
 *
 * 为什么不用第二个状态叶子：人设这条链路要「先动作后外观」两拍，复用 `anim` 叶子最省，
 * 用一个前缀区分语义即可（菜单仍走上面的可叠加 `expression:`）。
 */
const EXPRESSION_ONLY_PREFIX = 'expression-only:';

/** 点击回应的兜底名字（模型没声明动作时退回自然运动）。 */
const TAP_HINT = /tap|click|点击|回应|摸|戳/i;

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
 * 读模型清单（原始 JSON）：动作组、外观名与「哪个动作对应哪份文件」都从这一份里来。
 *
 * @param root - 素材根。
 * @param rel - 选定的 `.model3.json` 相对路径。
 * @returns 原始清单；取不到时为 null（菜单少几组、动作点不动，画面照常）。
 */
async function loadModelJson(root: string, rel: string): Promise<unknown> {
  try {
    const res = await fetch(skinUrl(root, rel));
    return res.ok ? ((await res.json()) as unknown) : null;
  } catch {
    return null;
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
  let cubism: Live2dNamespace | null = null;
  let root = '';
  /** 模型声明的动作组：右键「动作」树读它（网页端不把 webm 动画池混进来）。 */
  let actionGroups: readonly RendererActionGroup[] = [];
  /** 动作表：菜单动作名 → 文件与定格/淡入参数。 */
  let motions = new Map<string, Model3Motion>();
  /** 外观表：外观名 → exp3 文件。 */
  let expressions = new Map<string, Model3Expression>();
  /** 复位外观那一项的文案（来自 VTS 的 RemoveAllExpressions 热键）；模型没声明时为 null。 */
  let expressionReset: string | null = null;
  /** 当前模型的相对路径（`<池>/models` 的返回值）；动作/外观的 File 靠它定目录。 */
  let modelPath = '';
  /** 动作/外观文件缓存：同一条点第二次不必再发请求（键是相对素材根的完整路径）。 */
  const files = new Map<string, unknown>();
  /** 叠加层（mount 后就绪）：动作与外观各成一层，可同时挂多个。 */
  let overlay: Overlay | null = null;
  /** 每帧推进叠加层的钩子（卸载时要摘掉）。 */
  let ticker: (() => void) | null = null;
  /** 气泡锚点回写通道：改尺寸后要按新尺寸重报。 */
  let anchorSink: ((y: number) => void) | null = null;
  let ready = false;
  let destroyed = false;
  let size = 0;

  /** 取一份动作/外观 JSON（带缓存）。 */
  const fetchJson = async (rel: string): Promise<unknown> => {
    // 清单里的 `File` 是**相对模型目录**的（`Animation/x.motion3.json`），不是相对素材根：
    // 池里的模型在 `<根>/live2d/<模型目录>/`，直接拿 rel 拼会 404（点了菜单什么都不播）。
    const full = resolveModelFile(modelPath, rel);
    const hit = files.get(full);
    if (hit !== undefined) return hit;
    try {
      const res = await fetch(skinUrl(root, full));
      if (!res.ok) return null;
      const json = (await res.json()) as unknown;
      files.set(full, json);
      return json;
    } catch {
      return null;
    }
  };

  /** 按文件地址量内容顶并回写气泡锚点（挂载与改尺寸共用）。 */
  const reanchor = (): void => {
    if (app === null) return;
    // 先取出来：回调里再读 app 会丢掉上面的空值收窄。
    const view = app.view as HTMLCanvasElement;
    app.renderer.render(app.stage);
    const ratio = measureVisualTopRatio((probe, w, h) => probe.drawImage(view, 0, 0, w, h));
    if (ratio !== null) anchorSink?.(bubbleAnchorY(ratio, size));
  };

  /** 起一条叠加动作（同一条重复点 = 重播）。 */
  const playMotion = async (motion: Model3Motion): Promise<void> => {
    const json = await fetchJson(motion.file);
    if (json === null || overlay === null) return;
    overlay.play(motion.action, 'motion', json, {
      hold: motion.hold,
      ...(motion.fadeSeconds === undefined ? {} : { fadeSeconds: motion.fadeSeconds }),
      raw: json,
    });
  };

  /** 切换一条外观（挂着就摘，没挂就挂）。 */
  const toggleExpression = async (name: string): Promise<void> => {
    const expression = expressions.get(name);
    if (expression === undefined || overlay === null) return;
    const json = await fetchJson(expression.file);
    if (json === null || overlay === null) return;
    overlay.toggle(name, 'expression', json, {
      // VTS 的 FadeSecondsAmount：外观是硬切还是淡入就看这一个数。
      ...(expression.fadeSeconds === undefined ? {} : { fadeSeconds: expression.fadeSeconds }),
    });
  };

  /**
   * 覆盖式切换外观：先摘掉当前挂着的全部，再挂这一个（人设那条路径用）。
   *
   * 与 {@link toggleExpression} 的区别只在语义：菜单要「眼镜 + 兔牙同时开」，人设不能一次挂满
   * 二十多个外观，所以它走覆盖。两条路径共用同一份 overlay 与淡入参数。
   */
  const replaceExpression = async (name: string): Promise<void> => {
    overlay?.stopKind('expression');
    const expression = expressions.get(name);
    if (expression === undefined || overlay === null) return;
    const json = await fetchJson(expression.file);
    if (json === null || overlay === null) return;
    overlay.play(name, 'expression', json, {
      ...(expression.fadeSeconds === undefined ? {} : { fadeSeconds: expression.fadeSeconds }),
    });
  };

  const mount = async (el: HTMLElement, opts: RendererMountOptions): Promise<void> => {
    if (stage !== null) destroy();
    stage = el;
    size = opts.size;
    root = opts.assetRoot;
    anchorSink = opts.source.onVisualAnchor ?? null;
    cubism = await ensureLive2dRuntime();
    if (destroyed) return;

    // 列出可用模型，选中配置指定的那份，缺省第一个。
    const models = await listModels(root);
    const configured = opts.source.cfg().model;
    const chosen = configured !== undefined && models.includes(configured) ? configured : models[0];
    if (chosen === undefined) throw new Error('皮肤目录没有 .model3.json：' + root);
    if (destroyed) return;
    // 动作/外观的 File 相对模型目录解析（池里模型在 `<根>/live2d/<目录>/`）。
    modelPath = chosen;
    const raw = await loadModelJson(root, chosen);
    actionGroups = model3ActionGroups(raw);
    motions = new Map(model3Motions(raw).map((motion) => [motion.action, motion]));
    expressions = new Map(model3ExpressionRefs(raw).map((expression) => [expression.name, expression]));
    expressionReset = model3ExpressionReset(raw);
    if (destroyed) return;

    const pixi = pixiGlobal();
    const created = new pixi.Application({
      width: size,
      height: size,
      transparent: true,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      // 内容顶探测要在一帧画完之后读回像素（见 render/visual-top）：不保帧缓冲读到的会是空画面。
      preserveDrawingBuffer: true,
    });
    app = created;
    cubism.Live2DModel.registerTicker(pixi.Ticker);
    created.view.style.cssText = 'position:absolute;left:50%;bottom:0;transform:translateX(-50%);pointer-events:none;';
    el.appendChild(created.view);

    model = await cubism.Live2DModel.from(skinUrl(root, chosen), { autoInteract: false });
    if (destroyed) {
      model.destroy();
      model = null;
      return;
    }
    created.stage.addChild(model);
    // 逐模型修正：把「纯黑遮罩源」从可见绘制里去掉（见 shared/live2d-fixes）。
    const hidden = hiddenDrawableIndexesOf(chosen);
    const core = model.internalModel.coreModel as unknown as OverlayCoreModel & {
      getDrawableOpacity?(i: number): number;
    };
    if (hidden.length > 0) {
      const original = core.getDrawableOpacity?.bind(core);
      const skip = new Set(hidden);
      if (original !== undefined) core.getDrawableOpacity = (index) => (skip.has(index) ? 0 : original(index));
    }
    // 居中 + 按画布大边适配 size。
    const scale = size / Math.max(model.internalModel.originalWidth, model.internalModel.originalHeight);
    model.anchor.set(0.5, 0.5);
    model.scale.set(scale);
    model.x = size / 2;
    model.y = size / 2;
    // 叠加层：每条动作/外观一对独立队列，挂在 model.update() 之前写入参数。
    overlay = createOverlay(cubism, () => core);
    ticker = () => overlay?.tick();
    model.internalModel.on('beforeModelUpdate', ticker);
    if (destroyed) return;
    reanchor();
    ready = true;
  };

  const destroy = (): void => {
    destroyed = true;
    if (model !== null && ticker !== null) model.internalModel.off('beforeModelUpdate', ticker);
    ticker = null;
    overlay?.destroy();
    overlay = null;
    model?.destroy();
    model = null;
    actionGroups = [];
    motions = new Map();
    expressions = new Map();
    files.clear();
    modelPath = '';
    if (app !== null) {
      app.destroy(true, { children: true, texture: true, baseTexture: true });
      app = null;
    }
    stage = null;
    anchorSink = null;
    ready = false;
  };

  /** 设一个标准参数（缺失参数静默忽略）。 */
  const setParam = (id: string, value: number): void => {
    if (model === null) return;
    const core = model.internalModel.coreModel as unknown as {
      setParameterValueById?(id: string, value: number, weight?: number): void;
    };
    core.setParameterValueById?.(id, value);
  };

  return {
    kind: 'live2d',
    mount,
    destroy,
    playAction: (name) => {
      if (model === null || cubism === null) return;
      // 人设这条路径下发的是「覆盖语义」的外观切换：先清空再挂一个（菜单那条仍是可叠加的 toggle）。
      if (name.startsWith(EXPRESSION_ONLY_PREFIX)) {
        void replaceExpression(name.slice(EXPRESSION_ONLY_PREFIX.length));
        return;
      }
      // 菜单来自模型声明：motion / expression 的标识由 shared/menu/renderer-actions 生成，这里只拆解。
      const motion = MOTION_ID.exec(name);
      if (motion !== null) {
        const declared = motions.get(name);
        if (declared !== undefined) void playMotion(declared);
        return;
      }
      // 对话联动下发的是菜单文案（label，如「抚胸手打开」）：按 label 找回 `motion:<组>:<序号>`。
      // 这样换 VTS 工程、改热键名之后仍按键名解析，历史里存的 label 不会因为序号漂移而失效。
      for (const declared of motions.values()) {
        if (declared.label === name) {
          void playMotion(declared);
          return;
        }
      }
      if (name === MOTION_RESET) {
        overlay?.stopKind('motion');
        return;
      }
      if (name === EXPRESSION_RESET) {
        overlay?.stopKind('expression');
        return;
      }
      if (name.startsWith(EXPRESSION_PREFIX)) {
        void toggleExpression(name.slice(EXPRESSION_PREFIX.length));
        return;
      }
      // 其余名字来自 webm 池（点击回应 / 摸头等）：模型没声明动作时退回自然运动。
      if (TAP_HINT.test(name)) {
        model.tap(size / 2, size / 2);
        return;
      }
      void model.motion('Idle', undefined, cubism.MotionPriority.IDLE);
    },
    setIdle: () => {
      void model?.motion('Idle', undefined, cubism?.MotionPriority.IDLE);
    },
    resize: (next) => {
      if (next <= 0 || app === null || model === null) return;
      size = next;
      app.renderer.resize(next, next);
      const scale = next / Math.max(model.internalModel.originalWidth, model.internalModel.originalHeight);
      model.scale.set(scale);
      model.x = next / 2;
      model.y = next / 2;
      reanchor();
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
    listActionGroups: () => actionGroups,
    listExpressions: () => [...expressions.keys()],
    expressionResetLabel: () => (expressionReset === null ? undefined : expressionReset),
    activeExpressions: () => overlay?.active('expression') ?? [],
    get ready() {
      return ready;
    },
  };
}
