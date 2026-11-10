/**
 * 渲染后端契约：一张宠物卡的「怎么显示 + 怎么播动作」抽象。
 * 三种实现（webm / layered / live2d）互斥，运行时按 pets[].renderer 选一个挂载。
 * 交互与运动（拖拽 / 走位 / 抛掷 / 挤压）不属于渲染，留在卡片层；本接口只管视觉与动作播放。
 * 卡片把「该播什么、播完做什么」这类决策以 {@link AnimationSource} 注入，渲染器只管执行。
 * @module dsh-pet/src/client/pet/render/types
 */
import type { RendererKind } from '../../../shared/types.ts';
import type { Animations } from '../../../shared/types.ts';
import type { WorkStatusSnapshot } from '../../../shared/work-status.ts';
import type { ReportableStatus } from '../../../shared/playback.ts';
import type { EndedCue, FreezeCue } from '../animation/cues.ts';
import type { PlaybackProgress } from '../../progress.ts';

/** 渲染器播放所需的配置投影：素材根、宠物 id 与动画池。 */
export interface RendererCfg {
  /** 宠物 id（素材根缺失时的兜底）。 */
  readonly id: string;
  /** 素材根（= 配置文件前缀）。 */
  readonly assetRoot?: string;
  /** 动画池。 */
  readonly animations: Animations;
}

/**
 * 动画源：卡片层注入给渲染器的取值函数与回调，渲染器据此决定「取哪段素材、如何上报、播完通知谁」。
 * 全部用取值函数，避免捕获渲染期的快照；播完与就位的决策留在卡片层，渲染器只回调不判断。
 */
export interface AnimationSource {
  /** 该宠物成品配置的最新值。 */
  cfg(): RendererCfg;
  /** 当前动画名（可能是一段绝对地址）。 */
  currentAnim(): string;
  /** 工作状态叶子；未启用联动时为空。 */
  workStatus(): WorkStatusSnapshot | null | undefined;
  /** 当前朝向，决定镜像。 */
  facing(): 'left' | 'right';
  /** 上报第三方点播的真实状态。 */
  report(playbackId: string, status: ReportableStatus, reason?: string): void;
  /** 消费掉点播编号（清 React 状态，避免 effect 再跑一趟）。 */
  clearCuePlayback(): void;
  /** 新视觉已就位：卡片在这里补 Q 弹与走位驱动。 */
  onFrontReady(el: HTMLElement): void;
  /** 用户是否正按着宠物（拖拽期间不推进动画链）。 */
  isDragging(): boolean;
  /** 挂载那一刻是否已被锁冻住（只读一次）。 */
  readonly initiallyFrozen: boolean;
}

/** 挂载参数：渲染器据此确定元素/画布尺寸、素材根与动画源。 */
export interface RendererMountOptions {
  /** 宠物画框宽度（px）。 */
  readonly size: number;
  /** 素材根（webm 用 /thumb/<root>/；layered / live2d 用扫描目录）。 */
  readonly assetRoot: string;
  /** 动画源：播放所需的配置、状态与回调。 */
  readonly source: AnimationSource;
}

/** 一次动作播放的参数。 */
export interface PlayActionOptions {
  /** 只播一次；false = 循环（等同 {@link Renderer.setIdle}）。缺省 true。 */
  readonly once?: boolean;
  /** 点播编号（第三方点播）；自播为 null。 */
  readonly playbackId?: string | null;
}

/** 一个渲染后端实例：每张宠物卡一个，生命周期 = 卡挂载期。 */
export interface Renderer {
  /** 后端标识（与 RendererKind 对齐）。 */
  readonly kind: RendererKind;
  /** 挂载到 stage；就绪后 `ready` 置 true。 */
  mount(stage: HTMLElement, opts: RendererMountOptions): void | Promise<void>;
  /** 卸载并释放资源（视频/blob/canvas/pixi app）。 */
  destroy(): void;
  /** 播一个动作（一次播完）；`once:false` 等同 {@link setIdle}。 */
  playAction(name: string, opts?: PlayActionOptions): void;
  /** 设待机动作（循环播放）。 */
  setIdle(name: string): void;
  /** 注册「一次动作播完」的回调；传 null 摘除。回调入参是播完判定，由卡片决定下一段。 */
  setEndedHandler(cb: ((cue: EndedCue) => void) | null): void;
  /** 把当前前台循环关掉、播完即停（工作状态回空闲时用）。 */
  stopLooping(): void;
  /** 冻结/解冻播放；返回这次翻转（没翻转回 null）。 */
  setFrozen(frozen: boolean): FreezeCue | null;
  /** 当前是否冻结。 */
  isFrozen(): boolean;
  /** 当前前台视觉元素（Q 弹 / 走位读它）；无元素时返回 null。 */
  frontElement(): HTMLElement | null;
  /** 当前播放进度（进度服务 readProgress 读它）。 */
  progress(): PlaybackProgress;
  /** 口型 0~1（TTS 时用）；不支持的可不实现。 */
  setMouth?(open: number): void;
  /** 视线（-1~1 相对画框中心）；不支持的可不实现。 */
  setGaze?(x: number, y: number): void;
  /** 心情（后续接入）：webm 换动画文件、layered / live2d 做动作；不支持的可不实现。 */
  setMood?(mood: string): void;
  /** 命中检测（画布内坐标 → 命中区 id）；不支持返回 undefined。 */
  hitTest?(x: number, y: number): string | undefined;
  /** 是否已就绪（首帧/首张图层已挂上）。 */
  readonly ready: boolean;
}

/** 渲染后端工厂：每张宠物卡挂载时调一次，造一个独立实例。 */
export type RendererFactory = () => Renderer;
