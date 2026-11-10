/**
 * 渲染后端注册表：按 kind 存工厂，宠物卡挂载时按 pets[].renderer 造一个实例。
 * 与人格来源注册表同是 Map 不是单槽——多种后端并存，运行时按配置选一个。
 * 模块单例：注册返回 disposer，测试用 {@link resetRenderers} 复位。
 * 只登记与查找，不实例化、不挂载、不读配置。
 * @module dsh-pet/src/client/pet/render/registry
 */
import type { Renderer, RendererFactory } from './types.ts';

const factories = new Map<string, RendererFactory>();

/**
 * 注册一个渲染后端。
 *
 * @param kind - 后端标识（对应 RendererKind）；重复注册抛错。
 * @param factory - 造实例的工厂；每张宠物卡挂载时各调一次。
 * @returns 注销函数；只在「仍是这一份」时才删除。
 * @throws {TypeError} kind 为空或工厂不是函数、或 kind 重复时。
 */
export function registerRenderer(kind: string, factory: RendererFactory): () => void {
  if (typeof kind !== 'string' || kind.length === 0) throw new TypeError('kind 必须是非空字符串');
  if (typeof factory !== 'function') throw new TypeError('factory 必须是函数');
  if (factories.has(kind)) throw new TypeError('渲染后端重复注册: ' + kind);
  factories.set(kind, factory);
  return () => {
    if (factories.get(kind) === factory) factories.delete(kind);
  };
}

/** 按 kind 造一个渲染实例；未注册返回 undefined（调用方回退默认 webm）。 */
export function createRenderer(kind: string): Renderer | undefined {
  const factory = factories.get(kind);
  return factory ? factory() : undefined;
}

/** 列出已注册的后端 kind，供排障与设置页枚举。 */
export function listRenderers(): string[] {
  return [...factories.keys()];
}

/** 清空注册，供测试隔离用例。@internal */
export function resetRenderers(): void {
  factories.clear();
}
