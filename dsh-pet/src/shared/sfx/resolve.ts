/**
 * 覆盖层解析：把「索引里的自动匹配结果 + 若干显式覆盖层」收成一份可直接播出的计划。
 *
 * 层级从基到具体传入（条目 → 渲染方式 → 皮肤清单 → 皮肤覆盖），**后面的覆盖前面的**；
 * 只决定「放哪个文件、多响、多密、什么偏移」，不拼 URL、不碰音频设备。
 * 事件槽数组含义是变体随机抽一，`animations` 数组含义是时间线，两者不要混用。
 * @module dsh-pet/src/shared/sfx/resolve
 */
import { DEFAULT_EVENT_FILES } from './defaults.ts';
import { DEFAULT_CUE_VOLUME, SFX_EVENT_SLOTS, SLOT_DEFAULT_THROTTLE_MS } from './types.ts';
import type { ResolvedSfxCue, SfxCue, SfxEventSlot, SfxIndex, SfxLane, SfxLayer, SfxOrigin } from '../types.ts';

/** 解析输入。 */
export interface SfxResolveInput {
  /** 宿主下发的自动匹配索引；缺省按「只有内置默认」处理。 */
  readonly index?: SfxIndex | null;
  /** 显式覆盖层，从基到具体。 */
  readonly layers?: readonly (SfxLayer | undefined | null)[];
  /** 当前播放面：与 cue 的 `lane` 不符就不播。 */
  readonly lane: SfxLane;
}

/** 解析结果：按槽位 / 动画名 / hook 名取生效 cue。 */
export interface SfxPlan {
  /** 事件槽；关掉或没有文件时返回 `null`。 */
  slot(slot: SfxEventSlot): ResolvedSfxCue | null;
  /** 动画名对应的时间线；没有绑定返回空数组。 */
  anim(name: string): readonly ResolvedSfxCue[];
  /** 自定义 hook；没有定义返回 `null`。 */
  hook(name: string): ResolvedSfxCue | null;
}

/**
 * 造发音计划。
 *
 * @param input - 索引、覆盖层与当前播放面。
 * @returns 三类查询入口；同一份输入结果稳定。
 */
export function resolveSfx(input: SfxResolveInput): SfxPlan {
  const { index, lane } = input;
  const layers = (input.layers ?? []).filter((layer): layer is SfxLayer => layer !== undefined && layer !== null);
  /** 从具体到基找第一个定义。 */
  const lastDefined = <T>(pick: (layer: SfxLayer) => T | undefined): T | undefined => {
    for (let index2 = layers.length - 1; index2 >= 0; index2 -= 1) {
      const hit = pick(layers[index2]);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };

  const autoFile = (slot: SfxEventSlot): { file: string; origin: SfxOrigin } | null => {
    const found = index?.events?.[slot];
    if (found !== undefined && found !== '') {
      const origin = index?.origin?.[slot] ?? 'package-default';
      return { file: found, origin };
    }
    const file = DEFAULT_EVENT_FILES[slot];
    return file === undefined ? null : { file, origin: 'package-default' };
  };

  const cueOf = (raw: SfxCue, auto: { file: string; origin: SfxOrigin } | null, fallbackThrottle: number) => {
    const isEnabled = raw.enabled !== false;
    if (!isEnabled) return null;
    const file = raw.file ?? auto?.file;
    if (file === undefined || file === '') return null;
    if (raw.lane !== undefined && raw.lane !== 'both' && raw.lane !== lane) return null;
    const volume =
      typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1 ? raw.volume : DEFAULT_CUE_VOLUME;
    const throttleMs = typeof raw.throttleMs === 'number' && raw.throttleMs >= 0 ? raw.throttleMs : fallbackThrottle;
    const at = typeof raw.at === 'number' && raw.at >= 0 ? raw.at : 0;
    const everyMs = typeof raw.everyMs === 'number' && raw.everyMs > 0 ? raw.everyMs : null;
    const origin: SfxOrigin = raw.file !== undefined ? 'config' : (auto?.origin ?? 'package-default');
    const cue: ResolvedSfxCue = { file, volume, throttleMs, at, everyMs, origin };
    return cue;
  };

  const slot = (name: SfxEventSlot): ResolvedSfxCue | null => {
    const throttle = SLOT_DEFAULT_THROTTLE_MS[name];
    const raw = lastDefined((layer) => layer.events?.[name]);
    const auto = autoFile(name);
    if (raw === undefined) {
      if (auto === null) return null;
      return {
        file: auto.file,
        volume: DEFAULT_CUE_VOLUME,
        throttleMs: throttle,
        at: 0,
        everyMs: null,
        origin: auto.origin,
      };
    }
    const list = Array.isArray(raw) ? raw : [raw as SfxCue];
    if (list.length === 0) return null;
    // 事件槽数组 = 变体：随机抽一个，避免每下都一模一样。
    const picked = list[Math.floor(Math.random() * list.length)];
    return cueOf(picked, auto, throttle);
  };

  const anim = (name: string): readonly ResolvedSfxCue[] => {
    const raw = lastDefined((layer) => layer.animations?.[name]);
    if (raw === undefined) {
      const autoFile0 = index?.animations?.[name];
      if (autoFile0 === undefined || autoFile0 === '') return [];
      return [
        { file: autoFile0, volume: DEFAULT_CUE_VOLUME, throttleMs: 0, at: 0, everyMs: null, origin: 'animation' },
      ];
    }
    const list = Array.isArray(raw) ? raw : [raw as SfxCue];
    const auto = index?.animations?.[name];
    const out: ResolvedSfxCue[] = [];
    for (const cue of list) {
      // 时间线：每一项各按自己的 at 起播，节流默认不开（同一动画内的多点音效不该互相吃掉）。
      const resolved = cueOf(cue, auto === undefined ? null : { file: auto, origin: 'animation' }, 0);
      if (resolved !== null) out.push(resolved);
    }
    return out;
  };

  const hook = (name: string): ResolvedSfxCue | null => {
    const raw = lastDefined((layer) => layer.hooks?.[name]);
    const auto = index?.hooks?.[name];
    if (raw === undefined) {
      if (auto === undefined || auto === '') return null;
      return { file: auto, volume: DEFAULT_CUE_VOLUME, throttleMs: 0, at: 0, everyMs: null, origin: 'sound' };
    }
    const list = Array.isArray(raw) ? raw : [raw as SfxCue];
    if (list.length === 0) return null;
    const picked = list[Math.floor(Math.random() * list.length)];
    return cueOf(picked, auto === undefined ? null : { file: auto, origin: 'sound' }, 0);
  };

  return { anim, hook, slot };
}

/** 已知槽位集合：配置里出现别的键就是拼错了。 */
const SLOT_SET: ReadonlySet<string> = new Set(SFX_EVENT_SLOTS);

/** 覆盖层允许出现的键。 */
const LAYER_KEYS = new Set(['events', 'animations', 'hooks']);

/**
 * 把外部给的覆盖层（配置或皮肤清单）收敛成合规的 {@link SfxLayer}。
 *
 * 只丢非法项、不抛错：一份写坏的皮肤清单不该让整套音效消失。
 *
 * @param raw - 原始值（unknown）。
 * @param warn - 丢弃时的告警出口；同一处只在调用方去重。
 * @returns 合规层；没有任何有效项时返回 `undefined`。
 */
export function normalizeLayer(raw: unknown, warn?: (message: string) => void): SfxLayer | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const root = raw as Record<string, unknown>;
  const out: {
    events?: Record<string, SfxCue | SfxCue[]>;
    animations?: Record<string, SfxCue | SfxCue[]>;
    hooks?: Record<string, SfxCue | SfxCue[]>;
  } = {};
  for (const key of Object.keys(root)) {
    if (!LAYER_KEYS.has(key)) warn?.('未知音效段「' + key + '」（只认 events / animations / hooks），已忽略');
  }
  const bucket = (value: unknown, name: string): Record<string, SfxCue | SfxCue[]> | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'object' || Array.isArray(value)) {
      warn?.('音效段「' + name + '」应为对象，已忽略');
      return undefined;
    }
    const result: Record<string, SfxCue | SfxCue[]> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (name === 'events' && !SLOT_SET.has(key)) {
        warn?.('未知事件槽「' + key + '」，已忽略');
        continue;
      }
      const cue = normalizeCue(entry, warn, name + '.' + key);
      if (cue !== undefined) result[key] = cue;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  };
  const events = bucket(root.events, 'events');
  const animations = bucket(root.animations, 'animations');
  const hooks = bucket(root.hooks, 'hooks');
  if (events !== undefined) out.events = events;
  if (animations !== undefined) out.animations = animations;
  if (hooks !== undefined) out.hooks = hooks;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 单条 cue：只保留认识的字段，非法值丢掉并告警。 */
function normalizeCue(
  raw: unknown,
  warn: ((message: string) => void) | undefined,
  where: string,
): SfxCue | SfxCue[] | undefined {
  if (Array.isArray(raw)) {
    const list: SfxCue[] = [];
    for (const item of raw) {
      const one = normalizeOne(item, warn, where);
      if (one !== undefined) list.push(one);
    }
    return list.length > 0 ? list : undefined;
  }
  return normalizeOne(raw, warn, where);
}

/** 单条 cue（非数组分支）。 */
function normalizeOne(raw: unknown, warn: ((message: string) => void) | undefined, where: string): SfxCue | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warn?.('音效项「' + where + '」应为对象，已忽略');
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const out: {
    file?: string;
    volume?: number;
    throttleMs?: number;
    at?: number;
    everyMs?: number;
    lane?: 'both' | 'web' | 'desktop';
    enabled?: boolean;
  } = {};
  if (o.file !== undefined) {
    if (typeof o.file !== 'string' || o.file.trim() === '') {
      warn?.('音效项「' + where + '」的 file 应为非空字符串，已忽略该字段');
    } else out.file = o.file.trim();
  }
  const num = (key: 'volume' | 'throttleMs' | 'at' | 'everyMs', max?: number): void => {
    const value = o[key];
    if (value === undefined) return;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || (max !== undefined && n > max)) {
      warn?.('音效项「' + where + '」的 ' + key + ' 非法，已忽略该字段');
      return;
    }
    out[key] = n;
  };
  num('volume', 1);
  num('throttleMs');
  num('at');
  num('everyMs');
  if (o.lane !== undefined) {
    if (o.lane === 'both' || o.lane === 'web' || o.lane === 'desktop') out.lane = o.lane;
    else warn?.('音效项「' + where + '」的 lane 非法（both / web / desktop），已忽略该字段');
  }
  if (o.enabled !== undefined) {
    if (typeof o.enabled === 'boolean') out.enabled = o.enabled;
    else warn?.('音效项「' + where + '」的 enabled 应为布尔，已忽略该字段');
  }
  return out;
}
