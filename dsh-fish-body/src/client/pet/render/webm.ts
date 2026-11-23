/**
 * webm 渲染后端：把「视频 A/B 双缓冲 + 交叉淡入淡出 + 动作/待机切换 + 播放进度」包成 Renderer。
 * 引擎仍是 pet/animation 的 {@link createOwnAnimation}——这里只做元素装配与契约适配，
 * 不重复实现换源、世代号、blob 生命周期与播完判定。交互与运动不属于本模块，由卡片层经 source 驱动。
 * @module dsh-fish-body/src/client/pet/render/webm
 */
import { createOwnAnimation, type OwnAnimation } from '../animation/animation.ts';
import type { AssetLoader } from '../animation/asset-loader.ts';
import type { EndedCue, FreezeCue } from '../animation/cues.ts';
import type { Renderer, RendererMountOptions, AnimationSource } from './types.ts';

/** 两路视频的共同属性：静音、内联播放并自动播放（DOM 属性名，非 JSX prop）。 */
const VIDEO_PROPS = { muted: true, playsInline: true, autoplay: true } as const;

/** 测试注入点：生产用 document.createElement，测试用假元素。 */
export interface WebmRendererInternals {
  /** 造一个 video 元素。 */
  readonly createVideo?: () => HTMLVideoElement;
  /** 素材加载器；缺省用带超时的默认实现。 */
  readonly loader?: AssetLoader;
}

/** 生产用的默认元素工厂；测试注入假元素后不会走到这里。 */
function defaultCreateVideo(): HTMLVideoElement {
  return document.createElement('video');
}

/** 是否绝对地址（宿主点播给 http/https）；webm 渲染器据此决定用完整地址还是拼素材路由。 */
const isAbsoluteUrl = (value: string): boolean => /^https?:\/\//i.test(value);

/**
 * 造 webm 渲染实例（工厂语义：每次挂载造一个，互不共享元素与引擎）。
 *
 * @param internals - 测试注入点；生产调用方不传。
 * @returns 实现 {@link Renderer} 的 webm 渲染实例。
 */
export function createWebmRenderer(internals?: WebmRendererInternals): Renderer {
  const createVideo = internals?.createVideo ?? defaultCreateVideo;
  /** 挂载的 stage 节点。 */
  let stage: HTMLElement | null = null;
  /** A/B 双缓冲元素。 */
  let videoA: HTMLVideoElement | null = null;
  let videoB: HTMLVideoElement | null = null;
  /** 引擎实例；挂载后构造，卸载后置空。 */
  let ownAnim: OwnAnimation | null = null;
  /** 卡片注册的播完回调。 */
  let endedHandler: ((cue: EndedCue) => void) | null = null;
  /** 动画源（挂载时注入；引擎构造后所有取值都经它）。 */
  let source: AnimationSource | null = null;
  let ready = false;

  /** 组装一个 video 元素并交给 stage。 */
  const createVideoElement = (): HTMLVideoElement => {
    const el = createVideo();
    Object.assign(el, VIDEO_PROPS);
    el.className = 'dsh-pet-video';
    return el;
  };

  const mount = (el: HTMLElement, opts: RendererMountOptions): void => {
    if (stage !== null) destroy(); // 重复挂载先清旧实例（切换渲染方式时同样复用这条路径）。
    stage = el;
    source = opts.source;
    videoA = createVideoElement();
    videoB = createVideoElement();
    el.appendChild(videoA);
    el.appendChild(videoB);
    ownAnim = createOwnAnimation({
      videoA: () => videoA,
      videoB: () => videoB,
      cfg: () => source!.cfg(),
      currentAnim: () => source!.currentAnim(),
      workStatus: () => source!.workStatus(),
      facing: () => source!.facing(),
      report: (id, status, reason) => source!.report(id, status, reason),
      clearCuePlayback: () => source!.clearCuePlayback(),
      onFrontReady: (frontEl) => source!.onFrontReady(frontEl),
      onEnded: (cue) => endedHandler?.(cue),
      isDragging: () => source!.isDragging(),
      initiallyFrozen: source!.initiallyFrozen,
      ...(internals?.loader === undefined ? {} : { loader: internals.loader }),
    });
    ready = true;
  };

  const destroy = (): void => {
    ownAnim?.dispose();
    ownAnim = null;
    videoA?.remove();
    videoB?.remove();
    videoA = null;
    videoB = null;
    stage = null;
    source = null;
    ready = false;
  };

  return {
    kind: 'webm',
    mount,
    destroy,
    playAction: (name, opts) => {
      if (ownAnim === null) return;
      // 绝对地址插播：先把 url 交给引擎（一次性交接），再换源；否则按素材路由拼装。
      if (isAbsoluteUrl(name)) ownAnim.setCueUrl(name);
      ownAnim.switchTo(name, opts?.once !== false, opts?.playbackId ?? null);
    },
    setIdle: (name) => {
      ownAnim?.switchTo(name, false, null);
    },
    setEndedHandler: (cb) => {
      endedHandler = cb;
    },
    stopLooping: () => {
      ownAnim?.stopLoopingFront();
    },
    setFrozen: (frozen): FreezeCue | null => ownAnim?.setFrozen(frozen) ?? null,
    isFrozen: () => ownAnim?.isFrozen() ?? false,
    frontElement: () => ownAnim?.frontVideo() ?? null,
    progress: () => {
      const el = ownAnim?.frontVideo() ?? null;
      const playbackId = ownAnim?.playingPlayback() ?? null;
      const anim = source?.currentAnim() ?? '';
      if (el === null) {
        return { playbackId, anim, currentTime: 0, duration: 0, paused: true, buffering: false };
      }
      const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
      return {
        playbackId,
        anim,
        currentTime: el.currentTime,
        duration,
        paused: el.paused,
        buffering: el.readyState < 3 || el.seeking,
      };
    },
    get ready() {
      return ready;
    },
  };
}
