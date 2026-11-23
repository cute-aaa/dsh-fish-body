/**
 * `sfx` 段的校验、收敛与旧键迁移。
 *
 * 校验只回答「这份音效配置能不能用」；收敛把不认识/越界的项丢掉并返回可落盘的干净结构。
 * 旧键（clickSoundEnabled / clickSoundKeepAlive / clickSoundVolume）在**读取时**映射成新三键，
 * 写入只出新键——用户层里残留的旧键因此不会与新的总闸打架。
 * @module dsh-fish-body/src/host/config/sfx
 */
import { RENDERERS } from '../../shared/config.ts';
import type { SfxCue, SfxLayer } from '../../shared/types.ts';

/** 事件槽白名单（与 shared/types 的 SfxEventSlot 一一对应）。 */
const SLOT_SET = new Set(['click', 'throw', 'floor', 'wall', 'ceiling', 'pet', 'sleepStart', 'sleepEnd']);

/**
 * 已废弃的事件槽：`drag` 因为和点击/甩出声叠在一起像破音而取消。
 *
 * 校验放行（旧配置写了它不会让整段 `sfx` 失效），{@link cleanSfxConfig} 落盘时丢掉。
 */
const DEPRECATED_SLOT_SET = new Set(['drag']);

/** 单条 cue 的合法性：认识的字段都合乎类型，未知字段忽略（不算非法）。 */
function cueValid(raw: unknown, depth: number): boolean {
  const list = Array.isArray(raw) ? raw : [raw];
  if (list.length === 0) return false;
  // 时间线的嵌套层数没有意义，超过两层直接判非法，避免配置写成无底洞。
  if (depth > 2) return false;
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const o = item as Record<string, unknown>;
    if (o.file !== undefined && (typeof o.file !== 'string' || o.file.trim() === '')) return false;
    for (const key of ['volume', 'throttleMs', 'at', 'everyMs'] as const) {
      if (o[key] === undefined) continue;
      const n = Number(o[key]);
      if (!Number.isFinite(n) || n < 0) return false;
      if (key === 'volume' && n > 1) return false;
    }
    if (o.lane !== undefined && o.lane !== 'both' && o.lane !== 'web' && o.lane !== 'desktop') return false;
    if (o.enabled !== undefined && typeof o.enabled !== 'boolean') return false;
  }
  return true;
}

/** 一层覆盖的合法性：三个可选桶，桶里每项都要过 {@link cueValid}。`events` 的键必须在槽位白名单内。 */
function layerValid(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (key !== 'events' && key !== 'animations' && key !== 'hooks') return false;
  }
  for (const bucket of ['events', 'animations', 'hooks'] as const) {
    const value = o[bucket];
    if (value === undefined) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    for (const [name, cue] of Object.entries(value as Record<string, unknown>)) {
      if (bucket === 'events' && !SLOT_SET.has(name) && !DEPRECATED_SLOT_SET.has(name)) return false;
      if (name === '') return false;
      if (!cueValid(cue, 0)) return false;
    }
  }
  return true;
}

/**
 * 条目级 `sfx` 段的合法性：覆盖层 + 按渲染方式 + 按皮肤。
 *
 * 与 physics / font 同一口径：整段校验，任一子键非法即整段非法（读取侧回落默认、写入侧 400）。
 * 空对象合法（= 没有任何覆盖，全部走自动匹配）。
 */
export function sfxValid(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (key !== 'events' && key !== 'animations' && key !== 'hooks' && key !== 'renderers' && key !== 'skins') {
      return false;
    }
  }
  if (!layerValid({ events: o.events, animations: o.animations, hooks: o.hooks })) return false;
  if (o.renderers !== undefined) {
    if (!o.renderers || typeof o.renderers !== 'object' || Array.isArray(o.renderers)) return false;
    for (const [renderer, layer] of Object.entries(o.renderers as Record<string, unknown>)) {
      if (!RENDERERS.includes(renderer as (typeof RENDERERS)[number])) return false;
      if (!layerValid(layer)) return false;
    }
  }
  if (o.skins !== undefined) {
    if (!o.skins || typeof o.skins !== 'object' || Array.isArray(o.skins)) return false;
    for (const [skin, layer] of Object.entries(o.skins as Record<string, unknown>)) {
      if (skin === '' || !layerValid(layer)) return false;
    }
  }
  return true;
}

/** 只留认识的字段，供写入侧落盘。 */
function cleanCue(raw: unknown): SfxCue | SfxCue[] {
  const list = (Array.isArray(raw) ? raw : [raw]) as Array<Record<string, unknown>>;
  const out = list.map((o): SfxCue => {
    const cue: {
      file?: string;
      volume?: number;
      throttleMs?: number;
      at?: number;
      everyMs?: number;
      lane?: 'both' | 'web' | 'desktop';
      enabled?: boolean;
    } = {};
    if (typeof o.file === 'string' && o.file.trim() !== '') cue.file = o.file.trim();
    if (o.volume !== undefined) cue.volume = Number(o.volume);
    if (o.throttleMs !== undefined) cue.throttleMs = Number(o.throttleMs);
    if (o.at !== undefined) cue.at = Number(o.at);
    if (o.everyMs !== undefined) cue.everyMs = Number(o.everyMs);
    if (o.lane === 'both' || o.lane === 'web' || o.lane === 'desktop') cue.lane = o.lane;
    if (typeof o.enabled === 'boolean') cue.enabled = o.enabled;
    return cue;
  });
  return Array.isArray(raw) ? out : out[0];
}

/** 一层覆盖的干净副本。 */
function cleanLayer(raw: unknown): SfxLayer {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out: { events?: SfxLayer['events']; animations?: SfxLayer['animations']; hooks?: SfxLayer['hooks'] } = {};
  for (const bucket of ['events', 'animations', 'hooks'] as const) {
    const value = o[bucket];
    if (!value || typeof value !== 'object') continue;
    const result: Record<string, SfxCue | SfxCue[]> = {};
    for (const [name, cue] of Object.entries(value as Record<string, unknown>)) {
      // 废弃槽只在校验时放行，不落盘：下次保存就把它从用户层里清掉。
      if (bucket === 'events' && DEPRECATED_SLOT_SET.has(name)) continue;
      result[name] = cleanCue(cue);
    }
    out[bucket] = result;
  }
  return out;
}

/**
 * 归一化成可落盘的 `sfx` 段（调用前必须已过 {@link sfxValid}）。
 *
 * @param raw - 请求体里的 sfx。
 * @returns 只含白名单字段与子键的新对象；空输入返回 `{}`。
 */
export function cleanSfxConfig(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const base = cleanLayer(raw);
  const out: Record<string, unknown> = { ...base };
  if (o.renderers && typeof o.renderers === 'object') {
    const renderers: Record<string, unknown> = {};
    for (const [renderer, layer] of Object.entries(o.renderers as Record<string, unknown>)) {
      renderers[renderer] = cleanLayer(layer);
    }
    out.renderers = renderers;
  }
  if (o.skins && typeof o.skins === 'object') {
    const skins: Record<string, unknown> = {};
    for (const [skin, layer] of Object.entries(o.skins as Record<string, unknown>)) skins[skin] = cleanLayer(layer);
    out.skins = skins;
  }
  return out;
}

/** 旧键 → 新键的别名表：值搬过去、旧键留在原处（合并器只认内置默认里有的键，旧键自然被丢掉）。 */
const LEGACY_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['clickSoundEnabled', 'sfxEnabled'],
  ['clickSoundKeepAlive', 'sfxKeepAlive'],
  ['clickSoundVolume', 'sfxVolume'],
];

/**
 * 把用户层里的旧点击音效三键搬到新三键上（读取时做一次，幂等）。
 *
 * 新键已存在时旧键不生效：用户显式写了新键，说明他要的就是新语义。
 *
 * @param overlay - 用户层原对象（可能为 undefined）。
 * @returns 补好新键的对象；没有旧键时原样返回（不复制）。
 */
export function migrateLegacySfxKeys(
  overlay: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (overlay === undefined) return undefined;
  let out: Record<string, unknown> | undefined;
  for (const [legacy, next] of LEGACY_ALIASES) {
    if (overlay[next] !== undefined) continue;
    const value = overlay[legacy];
    if (value === undefined) continue;
    out ??= { ...overlay };
    out[next] = value;
  }
  return out ?? overlay;
}
