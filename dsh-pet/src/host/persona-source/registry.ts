/**
 * 人格来源注册表：多来源并存、按 id 查找。
 * 与语音注册表不同，这里是 Map 不是单槽——多个人格项目可同时注册，由同步器选一个使用。
 * 模块单例：注册返回 disposer，测试用 {@link resetPersonaSources} 复位。
 * 只登记与查找，不读卡、不投影、不写盘。
 * @module dsh-fish-body/src/host/persona-source/registry
 */
import type { PersonaSource } from './types.ts';

const sources = new Map<string, PersonaSource>();

/**
 * 注册一个人格来源。
 *
 * @param def - 来源定义；id 必须唯一，`resolve` 必须是函数。
 * @returns 注销函数；只在「仍是这一份」时才删除，迟到的注销不会顶掉后来者。
 * @throws {TypeError} 定义非法或 id 重复时。
 */
export function registerPersonaSource(def: PersonaSource): () => void {
  if (!def || typeof def !== 'object') throw new TypeError('persona source 定义必须是对象');
  if (typeof def.id !== 'string' || def.id.length === 0) throw new TypeError('id 必须是非空字符串');
  if (typeof def.name !== 'string' || def.name.length === 0) throw new TypeError('name 必须是非空字符串');
  if (typeof def.resolve !== 'function') throw new TypeError('resolve 必须是函数');
  if (sources.has(def.id)) throw new TypeError('人格来源 id 重复: ' + def.id);
  sources.set(def.id, def);
  return () => {
    if (sources.get(def.id) === def) sources.delete(def.id);
  };
}

/** 列出已注册来源（id + 展示名），供排障与设置页枚举。 */
export function listPersonaSources(): { id: string; name: string }[] {
  return [...sources.values()].map((source) => ({ id: source.id, name: source.name }));
}

/** 按 id 取来源；未注册返回 undefined。 */
export function personaSource(id: string): PersonaSource | undefined {
  return sources.get(id);
}

/** 清空注册，供测试隔离用例。@internal */
export function resetPersonaSources(): void {
  sources.clear();
}
