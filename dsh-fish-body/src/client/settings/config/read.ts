/**
 * 成品配置的读取：把宿主 `GET /config` 的聚合响应解析成「表单补丁」与「条目实例列表」。
 * 只认成品里合法性说得清的字段：缺字段或类型不对就跳过，让表单保留自己手里的值，不拿坏数据覆盖。
 * 与写方向（`http.ts`）分开：这里纯解析，不发请求、不碰状态。
 * @module dsh-fish-body/src/client/settings/config/read
 */
import { DEFAULT_FONT } from '../../../shared/fonts.ts';
import { normalizeHotkeys, type HotkeyMap } from '../../../shared/hotkeys.ts';
import { DEFAULT_PHYSICS } from '../../../shared/physics.ts';
import { screenConfigOf, type ScreenConfig } from '../../../shared/screen-config.ts';
import type { FontConfig, ModelSelection, Pet, PhysicsParams, SfxConfig, Weights } from '../../../shared/types.ts';
import { parseWeights } from '../../../shared/weights.ts';

/** 宿主返回的成品聚合：`main` 是大配置条目，其余键是文件定义的其他宠物条目。 */
export type MergedConfig = Record<string, Record<string, unknown>>;

/** 表单要吃的补丁；字段缺省表示「这次响应里没有可信值」。
 *
 *  注意 `pets[]` 里还有**实例字段**（`whisperPrompt` / `personaCharacter` / `clickThrough` / `sizes` 等）：
 *  它们没有顶层键，靠下面的 `{...pet}` 展开自然带出，这里**不加过滤代码**——过滤一处就等于
 *  「设置页能改、保存后消失」。人设角色（`personaCharacter`）尤其如此：缺键表示不引用角色。 */
export interface MainConfigPatch {
  /** main 条目的宠物列表（已深拷贝位置，可直接进编辑列表）。 */
  pets?: Pet[];
  /** 条目级人设正文，作为实例人设「留空时跟随什么」的预览。 */
  entryPrompt?: string;
  notificationsEnabled?: boolean;
  /** 音效总开关；缺省表示这次响应里没有可信值。 */
  sfxEnabled?: boolean;
  /** 音效常驻预热；缺省表示这次响应里没有可信值。 */
  sfxKeepAlive?: boolean;
  /** 音效总音量系数（0–1）；缺省表示这次响应里没有可信值。 */
  sfxVolume?: number;
  /** 条目级音效覆盖；缺省表示这次响应里没有可信值。 */
  sfx?: SfxConfig;
  whisperImageEnabled?: boolean;
  chatImageEnabled?: boolean;
  /** 对话动作联动开关；缺省表示这次响应里没有可信值。 */
  chatAnimationEnabled?: boolean;
  confineToScreen?: boolean;
  trayEnabled?: boolean;
  /** 桌宠总开关；缺省表示这次响应里没有可信值（消费端按开处理）。 */
  petEnabled?: boolean;
  /** 全局隐藏 / 暂停的系统级组合键；缺省表示这次响应里没有可信值（消费端按出厂值）。 */
  hideAllHotkey?: string;
  /** 看屏幕与避让的十三项（已归一化：缺键与越界都按运行期口径夹过）。 */
  screen?: ScreenConfig;
  /** 手动播报开关：手动触发的碎碎念与对话回复；缺省表示这次响应里没有可信值。 */
  voiceEnabled?: boolean;
  /** 语音音色 id（宿主已按白名单校验，客户端原样展示）。 */
  voiceName?: string;
  /** 播放音量系数（0–1）；缺省表示这次响应里没有可信值。 */
  voiceVolume?: number;
  /** 周期碎碎念的语音开关；缺省表示这次响应里没有可信值。 */
  voiceWhisperEnabled?: boolean;
  /** 待办提醒的语音开关；缺省表示这次响应里没有可信值。 */
  voiceTodoEnabled?: boolean;
  /** 工作状态播报开关；缺省表示这次响应里没有可信值。 */
  voiceNotifyEnabled?: boolean;
  /** 播报去表情开关；缺省表示这次响应里没有可信值（消费端按开处理）。 */
  speakStripEmoji?: boolean;
  /** 物理参数：成品已按「内置默认 ← 用户层」填满，缺子键再用内置默认兜底一次。 */
  physics?: PhysicsParams;
  /** 字体：同物理参数。 */
  font?: FontConfig;
  /** 动作频率权重（main 条目）：缺省表示这次响应里没有可信值。 */
  animationWeights?: Weights;
  whisperModel?: ModelSelection;
  chatModel?: ModelSelection;
  chatMemoryRounds?: number;
  chatImageLimit?: number;
  /** 九个悬停键（main 顶层 hotkeys，已归一成完整且唯一的键位表）。 */
  hotkeys?: HotkeyMap;
}

/** 非负有限数才算合法；其余（`NaN`、负数、字符串）一律当作没写。 */
const nonNegative = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** 一对模型选择：两项都是字符串才算写全，只写一半视为没写（宿主会按非法拒绝）。 */
const readModel = (value: unknown): ModelSelection | undefined => {
  const model = value as Partial<ModelSelection> | undefined;
  if (!model || typeof model.provider !== 'string' || typeof model.model !== 'string') return undefined;
  return { provider: model.provider, model: model.model };
};

/**
 * 从成品聚合里读出 main 条目的表单补丁。
 *
 * @param merged - `GET /config` 的响应体。
 * @returns 表单补丁；`main.pets` 缺失或不是数组时返回 `null`（响应本身坏了，调用方应报错）。
 */
export function readMainConfig(merged: MergedConfig): MainConfigPatch | null {
  const main = merged.main;
  if (!main || !Array.isArray(main.pets)) return null;
  const pets = main.pets as Pet[];
  const patch: MainConfigPatch = {
    // 位置深拷贝：编辑列表与容器手里的成品列表必须是两份数据。
    pets: pets.map((pet) => ({ ...pet, position: { ...pet.position } })),
  };
  if (typeof main.whisperPrompt === 'string') patch.entryPrompt = main.whisperPrompt;
  if (typeof main.notificationsEnabled === 'boolean') patch.notificationsEnabled = main.notificationsEnabled;
  if (typeof main.sfxEnabled === 'boolean') patch.sfxEnabled = main.sfxEnabled;
  if (typeof main.sfxKeepAlive === 'boolean') patch.sfxKeepAlive = main.sfxKeepAlive;
  if (main.sfx && typeof main.sfx === 'object' && !Array.isArray(main.sfx)) patch.sfx = main.sfx as SfxConfig;
  if (typeof main.whisperImageEnabled === 'boolean') patch.whisperImageEnabled = main.whisperImageEnabled;
  if (typeof main.chatImageEnabled === 'boolean') patch.chatImageEnabled = main.chatImageEnabled;
  if (typeof main.chatAnimationEnabled === 'boolean') patch.chatAnimationEnabled = main.chatAnimationEnabled;
  if (typeof main.confineToScreen === 'boolean') patch.confineToScreen = main.confineToScreen;
  if (typeof main.trayEnabled === 'boolean') patch.trayEnabled = main.trayEnabled;
  // 桌宠总开关：成品里一定存在（内置默认 true），所以这里按布尔直取即可。
  if (typeof main.petEnabled === 'boolean') patch.petEnabled = main.petEnabled;
  // 全局隐藏 / 暂停的快捷键：成品里一定存在（内置默认值），字符串直取；空串 = 用户关掉了这条。
  if (typeof main.hideAllHotkey === 'string') patch.hideAllHotkey = main.hideAllHotkey;
  // 看屏幕 / 避让：十三个平键收成一个嵌套值，归一化与宿主读配置时同一份函数。
  patch.screen = screenConfigOf(main);
  if (typeof main.voiceEnabled === 'boolean') patch.voiceEnabled = main.voiceEnabled;
  if (typeof main.voiceName === 'string') patch.voiceName = main.voiceName;
  if (typeof main.voiceWhisperEnabled === 'boolean') patch.voiceWhisperEnabled = main.voiceWhisperEnabled;
  if (typeof main.voiceTodoEnabled === 'boolean') patch.voiceTodoEnabled = main.voiceTodoEnabled;
  if (typeof main.voiceNotifyEnabled === 'boolean') patch.voiceNotifyEnabled = main.voiceNotifyEnabled;
  if (typeof main.speakStripEmoji === 'boolean') patch.speakStripEmoji = main.speakStripEmoji;
  if (main.physics && typeof main.physics === 'object') {
    patch.physics = { ...DEFAULT_PHYSICS, ...(main.physics as PhysicsParams) };
  }
  if (main.font && typeof main.font === 'object') {
    patch.font = { ...DEFAULT_FONT, ...(main.font as FontConfig) };
  }
  const weights = parseWeights(main.animationWeights);
  if (weights) patch.animationWeights = weights;
  const whisperModel = readModel(main.whisperModel);
  if (whisperModel) patch.whisperModel = whisperModel;
  const chatModel = readModel(main.chatModel);
  if (chatModel) patch.chatModel = chatModel;
  const rounds = nonNegative(main.chatMemoryRounds);
  if (rounds !== undefined) patch.chatMemoryRounds = rounds;
  const limit = nonNegative(main.chatImageLimit);
  if (limit !== undefined) patch.chatImageLimit = limit;
  // 上界在宿主侧已经把关，这里补一次跨进程读回的判定：脏值只影响显示，不让它流到播放端
  const volume = nonNegative(main.voiceVolume);
  if (volume !== undefined && volume <= 1) patch.voiceVolume = volume;
  const sfxVolume = nonNegative(main.sfxVolume);
  if (sfxVolume !== undefined && sfxVolume <= 1) patch.sfxVolume = sfxVolume;
  // 悬停键：成品里可能整段缺失（老配置），一律收成完整键位表，界面不必再判空。
  patch.hotkeys = normalizeHotkeys(main.hotkeys);
  return patch;
}

/** 一个条目（种类）与它的全部实例；`key` 即素材根。 */
export interface ConfigEntry {
  /** 条目名：`main`，或 `pet/<前缀>-config.json(c)` 的前缀。 */
  readonly key: string;
  /** `main` 由设置页连同全局字段整包写；`pack` 单独写回自己的配置文件。 */
  readonly kind: 'main' | 'pack';
  /** 条目级人设正文：实例人设留空时跟随的就是它（pack 各自一份，不共用 main 的）。 */
  readonly entryPrompt?: string;
  /** 该条目的实例；位置已深拷贝，`assetRoot` 即条目名。 */
  readonly pets: Pet[];
}

/**
 * 从成品聚合里读出全部条目及其实例（`main` 在前，其余按文件名顺序）。
 *
 * 只带实例字段：条目级的动画池、人设等大对象不挂到每只宠物上——设置页的提交体会被整包
 * 序列化，挂上去等于把动画池复制 N 份。
 *
 * @param merged - `GET /config` 的响应体。
 * @returns 条目列表；`main.pets` 缺失或不是数组时返回 `null`（响应本身坏了，调用方应报错）。
 */
export function readConfigEntries(merged: MergedConfig): ConfigEntry[] | null {
  const main = merged.main;
  if (!main || !Array.isArray(main.pets)) return null;
  const out: ConfigEntry[] = [];
  for (const [key, conf] of Object.entries(merged)) {
    const pets = Array.isArray(conf?.pets) ? (conf.pets as Pet[]) : [];
    out.push({
      key,
      kind: key === 'main' ? 'main' : 'pack',
      ...(typeof conf?.whisperPrompt === 'string' ? { entryPrompt: conf.whisperPrompt } : {}),
      pets: pets.map((pet) => ({ ...pet, position: { ...pet.position }, assetRoot: key })),
    });
  }
  return out;
}
