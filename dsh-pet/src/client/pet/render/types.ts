/**
 * 渲染后端契约：一张宠物卡的「怎么显示 + 怎么播动作」抽象。
 * 三种实现（webm / layered / live2d）互斥，运行时按 pets[].renderer 选一个挂载。
 * 交互与运动（拖拽 / 走位 / 抛掷 / 挤压）不属于渲染，留在卡片层；本接口只管视觉与动作。
 * @module dsh-pet/src/client/pet/render/types
 */
import type { RendererKind } from '../../../shared/types.ts';

/** 挂载参数：渲染器据此确定元素/画布尺寸与素材根。 */
export interface RendererMountOptions {
  /** 宠物画框宽度（px）。 */
  readonly size: number;
  /** 素材根（webm 用 /thumb/<root>/；layered / live2d 用扫描目录）。 */
  readonly assetRoot: string;
}

/** 一个渲染后端实例：每张宠物卡一个，生命周期 = 卡挂载期。 */
export interface Renderer {
  /** 后端标识（与 RendererKind 对齐）。 */
  readonly kind: RendererKind;
  /** 挂载到 stage；就绪后 `ready` 置 true。 */
  mount(stage: HTMLElement, opts: RendererMountOptions): void | Promise<void>;
  /** 卸载并释放资源（视频/blob/canvas/pixi app）。 */
  destroy(): void;
  /** 播一个动作（一次播完；`once` 缺省按后端自身语义）。 */
  playAction(name: string, opts?: { once?: boolean }): void;
  /** 设待机动作。 */
  setIdle(name: string): void;
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
