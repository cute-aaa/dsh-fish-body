/**
 * 人格来源注册表：多来源并存、按 id 查找。
 * 与语音注册表不同，这里是 Map 不是单槽——多个人格项目可同时注册，由角色库的扫描编排选一个使用。
 * 模块单例：注册返回 disposer，测试用 {@link resetPersonaSources} 复位。
 * 只登记、查找与探测可用性，不读卡、不投影、不写盘。
 * @module dsh-fish-body/src/host/persona-source/registry
 */
import { existsSync } from 'node:fs';
import type { PersonaSource, PersonaSourceKind, PersonaSourceOptions } from './types.ts';

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

/** 一个来源的可用性描述（设置页「来源」下拉的全部数据）。 */
export interface PersonaSourceDescription {
  readonly id: string;
  readonly name: string;
  readonly kind: PersonaSourceKind;
  /** 约定产物在不在（未安装 → 下拉置灰）。 */
  readonly installed: boolean;
  /** 期望放素材的位置；没有约定目录的来源为 null。 */
  readonly expectedPath: string | null;
  /** 已安装时的实际命中路径；未安装为 null（与 `expectedPath` 分开，前端不必自己判分支）。 */
  readonly path: string | null;
  /** 能不能「扫描并导入」（没有 `scan` 的来源不进扫描下拉）。 */
  readonly scannable: boolean;
}

/**
 * 描述全部已注册来源。
 *
 * 逐个调 `probe(options)`；老实现（没有 probe）按 `watchPath` 存在与否判定，
 * 连 watchPath 都没有的来源视为「常驻可用」。probe 抛错一律收敛成「未安装 + 约定路径」——
 * 探测失败是配置问题，不该让设置页整块报错。
 *
 * @param options - 调用方显式路径（`custom` 来源用它探路）；不传给不读路径的 source 也无妨。
 * @returns 按注册顺序排列的来源描述。
 */
export async function describePersonaSources(options?: PersonaSourceOptions): Promise<PersonaSourceDescription[]> {
  const out: PersonaSourceDescription[] = [];
  for (const source of sources.values()) {
    const scannable = typeof source.scan === 'function';
    let installed: boolean;
    let path = '';
    if (typeof source.probe === 'function') {
      try {
        const availability = await source.probe(options);
        installed = availability.installed;
        path = availability.path;
      } catch {
        installed = false;
        path = source.watchPath ?? '';
      }
    } else if (source.watchPath !== undefined) {
      installed = existsSync(source.watchPath);
      path = source.watchPath;
    } else {
      // 没有任何可探测产物（纯运行期来源）：没有「未安装」这回事。
      installed = true;
    }
    out.push({
      id: source.id,
      name: source.name,
      kind: source.kind ?? 'soul-card',
      installed,
      expectedPath: path === '' ? null : path,
      path: installed && path !== '' ? path : null,
      scannable,
    });
  }
  return out;
}

/** 清空注册，供测试隔离用例。@internal */
export function resetPersonaSources(): void {
  sources.clear();
}
