/**
 * 设置页的「未保存改动」判定：把表单快照与基线快照做深度 diff，得到一串点分路径。
 *
 * 路径就是快照里的位置（`look.physics.gravity`、`fish.sizePx`、`pets.0.size`）：卡片把同一串路径交给
 * 圆点组件，标签条按前缀把路径归到分区——「哪些字段算改动」不再另维护一张表，改名即同步。
 * 数组按位置下钻，所以宠物卡能逐项标出「改的是大小还是名字」；长度一变就退回整条聚合路径。
 * 基线里缺省的字段表示服务端没给可信值：任一侧 undefined 的路径跳过，不误报。
 * 纯函数，不读状态、不发请求、不碰时钟。
 * @module dsh-fish-body/src/client/settings/dirty
 */
import type { HotkeyMap } from '../../shared/hotkeys.ts';
import type { SessionFishSettings } from '../../shared/session-fish.ts';
import type { ScreenConfig } from '../../shared/screen-config.ts';
import type { FontConfig, ModelSelection, Pet, PhysicsParams, SfxConfig, Weights } from '../../shared/types.ts';
import type { ConfigEntry, MainConfigPatch } from './config/index.ts';
import type { GlobalFlags } from './global-flags.ts';
import { SETTINGS_TABS, type SettingsTabId } from './tabs.ts';

/** 全局开关段（含音效总音量）：键名与 `PUT /config` 字段同名。 */
export interface GlobalSnapshot extends GlobalFlags {
  /** 音效总音量系数（0–1）。 */
  readonly sfxVolume: number;
}

/** 随「保存」写入的六个语音字段。 */
export interface VoiceSnapshot {
  readonly enabled: boolean;
  readonly name: string;
  readonly volume: number;
  readonly whisper: boolean;
  readonly todo: boolean;
  readonly notify: boolean;
  readonly stripEmoji: boolean;
}

/** 对话分区的模型、上下文上限与三个开关。 */
export interface ModelSnapshot {
  readonly whisperModel: ModelSelection;
  readonly chatModel: ModelSelection;
  readonly chatMemory: number;
  readonly chatImageLimit: number;
  readonly whisperImageEnabled: boolean;
  readonly chatImageEnabled: boolean;
  readonly chatAnimationEnabled: boolean;
}

/** 外观与手感：物理、动作权重、字体。 */
export interface LookSnapshot {
  readonly physics: PhysicsParams;
  readonly weights: Weights;
  readonly font: FontConfig;
}

/**
 * 表单快照。
 *
 * 字段全部可选：基线由服务端权威值构造，`MainConfigPatch` 没给的字段保持 undefined，
 * diff 时整条路径跳过；会话鱼未加载时为 `null`（整块不参与比较）。
 */
export interface FormSnapshot {
  readonly pets?: readonly Pet[];
  readonly global?: Partial<GlobalSnapshot>;
  readonly hotkeys?: HotkeyMap;
  readonly sfx?: SfxConfig;
  readonly voice?: Partial<VoiceSnapshot>;
  readonly model?: Partial<ModelSnapshot>;
  readonly look?: Partial<LookSnapshot>;
  readonly fish?: SessionFishSettings | null;
  /** 看屏幕与避让的十三项（嵌套形状，与 shared/screen-config 一致）。 */
  readonly screen?: ScreenConfig;
}

/**
 * 从服务端权威值构造基线快照。
 *
 * `MainConfigPatch` 只带「这次响应里有可信值」的字段，缺的保持 undefined——diff 会跳过那些路径，
 * 因此不会因为一次响应没给某个字段就把所有控件标成改动。会话鱼不在成品配置里，由外壳单独补。
 *
 * @param entries - 拍平后的条目列表（主配置 + 各 pet pack），用于宠物那条聚合路径。
 * @param patch - 主配置补丁。
 * @returns 基线快照；`fish` 留空，等会话鱼自己的权威值到达再补。
 */
export function baselineFromConfig(entries: readonly ConfigEntry[], patch: MainConfigPatch): FormSnapshot {
  return {
    pets: entries.flatMap((entry) => entry.pets),
    global: {
      notificationsEnabled: patch.notificationsEnabled,
      trayEnabled: patch.trayEnabled,
      confineToScreen: patch.confineToScreen,
      sfxEnabled: patch.sfxEnabled,
      sfxKeepAlive: patch.sfxKeepAlive,
      sfxVolume: patch.sfxVolume,
    },
    hotkeys: patch.hotkeys,
    sfx: patch.sfx,
    voice: {
      enabled: patch.voiceEnabled,
      name: patch.voiceName,
      volume: patch.voiceVolume,
      whisper: patch.voiceWhisperEnabled,
      todo: patch.voiceTodoEnabled,
      notify: patch.voiceNotifyEnabled,
      stripEmoji: patch.speakStripEmoji,
    },
    model: {
      whisperModel: patch.whisperModel,
      chatModel: patch.chatModel,
      chatMemory: patch.chatMemoryRounds,
      chatImageLimit: patch.chatImageLimit,
      whisperImageEnabled: patch.whisperImageEnabled,
      chatImageEnabled: patch.chatImageEnabled,
      chatAnimationEnabled: patch.chatAnimationEnabled,
    },
    look: { physics: patch.physics, weights: patch.animationWeights, font: patch.font },
    screen: patch.screen,
  };
}

/** 一个路径前缀属于哪个分区；最长前缀优先。 */
const TAB_PREFIXES: ReadonlyArray<readonly [string, SettingsTabId]> = [
  ['pets', 'pet'],
  ['fish', 'fish'],
  // 物理 / 动作频率 / 字体同属「外观与手感」：合并分区后三条前缀归到同一页。
  ['look.physics', 'feel'],
  ['look.weights', 'feel'],
  ['look.font', 'feel'],
  ['sfx', 'audio'],
  ['voice', 'audio'],
  ['global.sfxEnabled', 'audio'],
  ['global.sfxKeepAlive', 'audio'],
  ['global.sfxVolume', 'audio'],
  ['model', 'chat'],
  ['global.notificationsEnabled', 'system'],
  ['global.trayEnabled', 'system'],
  ['global.confineToScreen', 'system'],
  // 九个悬停键在「系统」分区的快捷键卡里改。
  ['hotkeys', 'system'],
  // 看屏幕与避让整段都在「系统」分区的同一张卡里。
  ['screen', 'system'],
];

/** 普通对象判定：数组与 null 都不算。 */
function isBag(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 深比较：对象逐键递归，数组逐项比较；其余按 `Object.is`。 */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => sameValue(item, right[index]));
  }
  if (isBag(left) && isBag(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) if (!sameValue(left[key], right[key])) return false;
    return true;
  }
  return false;
}

/** 收集改动路径：对象下钻到单键，数组按位置下钻（`pets.0.size`），长度一变就整条算一处。 */
function collect(base: unknown, current: unknown, path: string, out: Set<string>): void {
  if (base === undefined || current === undefined) return;
  if (sameValue(base, current)) return;
  if (Array.isArray(base) && Array.isArray(current)) {
    // 加/删一条就对不上位置了（`pets.0` 会整体错位），这种情况只报聚合路径。
    if (base.length !== current.length) {
      out.add(path);
      return;
    }
    base.forEach((item, index) => collect(item, current[index], path + '.' + index, out));
    return;
  }
  if (isBag(base) && isBag(current)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(current)]);
    for (const key of keys) collect(base[key], current[key], path === '' ? key : path + '.' + key, out);
    return;
  }
  out.add(path);
}

/**
 * 比较两份快照。
 *
 * @param baseline - 最近一次服务端权威值（加载 / 保存 / 重置之后）。
 * @param current - 此刻的表单值。
 * @returns 改动路径集合；没有改动时为空集。
 */
export function diffSnapshot(baseline: FormSnapshot, current: FormSnapshot): ReadonlySet<string> {
  const out = new Set<string>();
  collect(baseline.pets, current.pets, 'pets', out);
  collect(baseline.global, current.global, 'global', out);
  collect(baseline.hotkeys, current.hotkeys, 'hotkeys', out);
  collect(baseline.sfx, current.sfx, 'sfx', out);
  collect(baseline.voice, current.voice, 'voice', out);
  collect(baseline.model, current.model, 'model', out);
  collect(baseline.look, current.look, 'look', out);
  collect(baseline.fish, current.fish ?? undefined, 'fish', out);
  return out;
}

/** 圆点查询口：卡片只问「我这一条/这一块有没有改动」。 */
export interface DirtyQuery {
  /** 改动路径条数。 */
  readonly count: number;
  /** 该路径本身或它的子路径有改动。 */
  has(prefix: string): boolean;
}

/** 一条都没有的查询口：不传 `dirty` 时的默认值，卡片一律不画点。 */
export const NO_DIRTY: DirtyQuery = { count: 0, has: () => false };

/**
 * 把路径集合包成查询口。
 *
 * @param paths - {@link diffSnapshot} 的结果。
 * @returns 查询口；`has` 同时命中子路径，卡片可以拿卡片级前缀一次问整块。
 */
export function makeDirtyQuery(paths: ReadonlySet<string>): DirtyQuery {
  return {
    count: paths.size,
    has: (prefix: string): boolean => {
      if (paths.has(prefix)) return true;
      const head = prefix + '.';
      for (const path of paths) if (path.startsWith(head)) return true;
      return false;
    },
  };
}

/** 一条路径归属的分区；没有匹配（例如未来新增的路径忘了登记）返回 undefined。 */
function tabOfPath(path: string): SettingsTabId | undefined {
  let best: SettingsTabId | undefined;
  let bestLength = -1;
  for (const [prefix, tab] of TAB_PREFIXES) {
    if (path !== prefix && !path.startsWith(prefix + '.')) continue;
    if (prefix.length > bestLength) {
      best = tab;
      bestLength = prefix.length;
    }
  }
  return best;
}

/**
 * 哪些分区有改动（标签条的小圆点）。
 *
 * @param paths - {@link diffSnapshot} 的结果。
 * @returns 每个分区一项，未改动为 false。
 */
export function dirtyTabs(paths: ReadonlySet<string>): Record<SettingsTabId, boolean> {
  const out = Object.fromEntries(SETTINGS_TABS.map((tab) => [tab.id, false])) as Record<SettingsTabId, boolean>;
  for (const path of paths) {
    const tab = tabOfPath(path);
    if (tab !== undefined) out[tab] = true;
  }
  return out;
}
