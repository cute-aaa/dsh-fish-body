/**
 * 第三方语音实现的注册表：**多 provider + 回退链**，内置 edge 永远是最后一环。
 *
 * 与余额注册表不同，语音没有「按服务商名匹配」的键——一句话念出来就完事，谁合成的用户并不关心；
 * 所以这里按注册顺序排成一条链：前面的先试，不可用或失败就落到下一环，最后是内置 edge（不会缺席）。
 * 声明式 `fields` 只描述「这实现需要哪些配置项」，设置页据此生成控件（T3.6），本模块不读配置。
 * 模块单例：注册返回 disposer；测试用 {@link resetVoiceProviders} 复位。
 * 只登记、排序与探测可用性，不合成、不缓存。
 * @module dsh-fish-body/src/host/voice/registry
 */
import type { AudioClip } from './audio.ts';

/** 内置实现的名字；缓存键与排障都用它，第三方不能占用。 */
export const BUILTIN_VOICE_ID = 'edge';

/** 声明式配置项的类型：设置页按它选控件。 */
export type VoiceFieldKind = 'text' | 'password' | 'number' | 'select';

/** 一个实现需要的配置项（只描述形状，值由调用方从配置/凭据里取）。 */
export interface VoiceField {
  /** 配置键（写进 `voiceProviderConfig[<providerId>][key]`）。 */
  readonly key: string;
  /** 控件标签。 */
  readonly label: string;
  /** 控件类型；`password` 的值走 DSH credentials，不进普通配置。 */
  readonly kind: VoiceFieldKind;
  /** 是否必填（缺它就不可用）。 */
  readonly required?: boolean;
  /** 输入框占位或选择框缺省提示。 */
  readonly placeholder?: string;
  /** `select` 的候选值。 */
  readonly options?: readonly string[];
  /** 一句说明，设置页显示在控件下方。 */
  readonly description?: string;
}

/** 可用性结论：不可用时给一句人话，直接显示在设置页上。 */
export type VoiceProviderAvailability = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** 一个实现能念的音色（设置页与右键菜单里可切的选项）。 */
export interface ProviderVoiceInfo {
  /** 音色 id（写进 `voiceProviders.<providerId>.voice`）。 */
  readonly id: string;
  /** 展示名。 */
  readonly name: string;
  /** 补充说明（如音色包的一行描述）。 */
  readonly tag?: string;
}

/** 第三方语音实现：给一段文本，返回音频字节与格式。 */
export interface VoiceProvider {
  /** 唯一标识；参与缓存键，换实现不会命中旧音频。 */
  readonly id: string;
  /** 展示名。 */
  readonly name: string;
  /** 需要哪些配置项（声明式，设置页据此生成控件）。 */
  readonly fields?: readonly VoiceField[];
  /**
   * 现在能不能用（服务没起、没配 key、音色没加载…）。
   *
   * 缺省视为可用；必须同步返回——每次合成都会现查一次，异步探测要自己缓存结论。
   * 不可用**不是错误**：链会跳过它落到下一环，用户只会更难听到声音，不会看到失败。
   */
  availability?(): VoiceProviderAvailability;
  /**
   * 能念的音色清单；不声明 = 这个实现没有可切换音色的概念。
   *
   * 同步返回（设置页与 `/voice/voices` 现取）：实现自己缓存扫描结果。
   */
  listVoices?(): readonly ProviderVoiceInfo[];
  /**
   * 当前选中的音色 id；不声明 = 没有「当前音色」这个概念（内置 edge 看请求里的 `voiceName`）。
   *
   * 设置页与右键菜单靠它打勾，避免把「配置里写的」和「正在用的」混成一个概念。
   */
  activeVoice?(): string;
  /**
   * 当前嗓子的指纹，进缓存键；不声明 = 音色不影响缓存（内置 edge 走请求里的 `voiceName`）。
   *
   * 换音色/换权重后指纹必须变，否则同一句话会命中旧嗓子合成的音频，听起来像「切了没生效」。
   */
  cacheTag?(): string;
  /**
   * 立刻重探一次可用性（可选）。
   *
   * 存在的意义：启停脚本刚跑完，缓存结论还停在旧值上——不主动探，设置页要等一轮 20s 的重探
   * 才看到按钮状态翻牌。实现可以不声明（那就只能等下一轮）。
   */
  refresh?(): Promise<boolean>;
  /**
   * 最近一次合成失败的原因（可选）。
   *
   * 与 `availability` 分开：可用性只管「连不连得通」，而这一项记的是「通着却念不出来」
   * （参考音频坏了、服务端 stdout 失效导致 `/tts` 400…）。链会一直重试，用户只听到换了嗓子，
   * 所以必须有一处能看见这句话——设置页的接入卡把它当警告显示。
   * 合成成功即清空；同步返回。
   */
  lastError?(): string | undefined;
  /**
   * 把一段文本合成为音频。
   *
   * 失败必须抛错——宿主会记日志并落到下一环；自己吞掉会让上层以为成功。
   * 不接收音色：`voiceName` 是内置实现的白名单，第三方的嗓子由它自己决定。
   * MIME 决定缓存扩展名与 `/voice/speak` 的 Content-Type（见 voice/audio.ts）。
   */
  synthesize(input: { readonly text: string; readonly rate: string }): Promise<AudioClip>;
}

/** 注册表里的一环：实现 + 当下可用性（探测后的快照，供排序与排障）。 */
export interface VoiceProviderEntry {
  readonly provider: VoiceProvider;
  readonly available: boolean;
  /** 不可用时的原因；可用时为空。 */
  readonly reason?: string;
}

/** 注册顺序表：Map 保持插入顺序，同 id 重注册就地替换（位置不变，避免链序跳动）。 */
const providers = new Map<string, VoiceProvider>();

/**
 * 注册一个第三方语音实现（同 id 覆盖）。
 *
 * @param def - 实现定义；`id` 不能与内置实现同名（那会让缓存键撞在一起）。
 * @returns 注销函数；只在「当前仍是这一份」时才移除，迟到的注销不会顶掉后来者。
 * @throws {TypeError} 定义非法、`synthesize` 不是函数或 id 与内置同名时。
 */
export function registerVoiceProvider(def: VoiceProvider): () => void {
  if (!def || typeof def !== 'object') throw new TypeError('voice provider 定义必须是对象');
  if (typeof def.id !== 'string' || def.id.length === 0) throw new TypeError('id 必须是非空字符串');
  if (def.id === BUILTIN_VOICE_ID) throw new TypeError('不能与内置实现同名: ' + BUILTIN_VOICE_ID);
  if (typeof def.synthesize !== 'function') throw new TypeError('synthesize 必须是函数');
  if (def.availability !== undefined && typeof def.availability !== 'function') {
    throw new TypeError('availability 必须是函数');
  }

  providers.set(def.id, def);
  return () => {
    if (providers.get(def.id) === def) providers.delete(def.id);
  };
}

/** 探一次可用性；实现没声明 `availability` 一律当可用。 */
function probe(provider: VoiceProvider): VoiceProviderAvailability {
  try {
    return provider.availability?.() ?? { ok: true };
  } catch (error) {
    // 探测自己炸了：当作不可用，别让它把整条链带走
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 当前注册链（按注册顺序，带可用性快照）。
 *
 * @returns 每一环的实现与可用性；没注册任何实现时为空数组。
 */
export function voiceProviderEntries(): VoiceProviderEntry[] {
  return [...providers.values()].map((provider) => {
    const verdict = probe(provider);
    return verdict.ok ? { provider, available: true } : { provider, available: false, reason: verdict.reason };
  });
}

/**
 * 当前可用的一环（链上第一个可用的）。
 *
 * @returns 可用实现；都不可以用或没注册时返回 `null`，调用方据此落到内置 edge。
 */
export function activeVoiceProvider(): VoiceProvider | null {
  return voiceProviderEntries().find((entry) => entry.available)?.provider ?? null;
}

/**
 * 列出可用实现，用于排障「为什么没走我注册的那个」。
 *
 * @returns `builtin` 恒为内置实现；`external` 是注册顺序的全部第三方 id（含当下不可用的）。
 */
export function listVoiceProviders(): { builtin: string[]; external: string[] } {
  return { builtin: [BUILTIN_VOICE_ID], external: [...providers.keys()] };
}

/** 设置页/排障用的一环状态。 */
export interface VoiceProviderStatus {
  readonly id: string;
  readonly name: string;
  /** 是否内置（edge 恒可用、不可注册、不看 `fields`）。 */
  readonly builtin: boolean;
  readonly available: boolean;
  /** 不可用原因（含「没配必填项」）。 */
  readonly reason?: string;
  /** 最近一次合成失败的原因（服务通着但念不出来）；合成成功即消失。 */
  readonly lastError?: string;
  /** 声明式配置项（内置实现为空数组）。 */
  readonly fields: readonly VoiceField[];
  /** 能念的音色（内置实现为空数组：它的音色走请求里的 `voiceName` 白名单）。 */
  readonly voices: readonly ProviderVoiceInfo[];
  /** 当前选中的音色 id；没有这个概念（内置实现）时为空串。 */
  readonly voice: string;
}

/**
 * 全部实现的状态（内置 + 第三方），给 `/voice/voices` 与设置页用。
 *
 * @returns 第三方按注册顺序在前，内置 edge 收尾。
 */
export function voiceProviderStatuses(): VoiceProviderStatus[] {
  const external = voiceProviderEntries().map((entry) => {
    const lastError = safelyOptional(() => entry.provider.lastError?.());
    return {
      id: entry.provider.id,
      name: entry.provider.name,
      builtin: false,
      available: entry.available,
      ...(entry.reason === undefined ? {} : { reason: entry.reason }),
      ...(lastError === undefined || lastError === '' ? {} : { lastError }),
      fields: entry.provider.fields ?? [],
      // 音色扫描失败（目录没配、磁盘抽风）不该让整条链不可用：空数组就是「暂时列不出音色」
      voices: safely(() => entry.provider.listVoices?.() ?? []),
      voice: safelyText(() => entry.provider.activeVoice?.() ?? ''),
    };
  });
  return [
    ...external,
    {
      id: BUILTIN_VOICE_ID,
      name: 'edge 在线语音',
      builtin: true,
      available: true,
      fields: [],
      voices: [],
      voice: '',
    },
  ];
}

/** 取音色清单时的兜底：实现自己抛错只当「列不出来」。 */
function safely(read: () => readonly ProviderVoiceInfo[]): readonly ProviderVoiceInfo[] {
  try {
    return read();
  } catch {
    return [];
  }
}

/** 取「当前音色」时的兜底：实现自己抛错只当「没选」。 */
function safelyText(read: () => string): string {
  try {
    return read();
  } catch {
    return '';
  }
}

/** 取可选文本（最近合成失败原因）时的兜底：实现自己抛错只当「没有」。 */
function safelyOptional(read: () => string | undefined): string | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/**
 * 按 id 取当前注册的实现（路由要拿它做「立刻重探」这类动作）。
 *
 * @param id - 实现 id。
 * @returns 实现本体；没注册时 undefined（内置实现不在这个表里）。
 */
export function voiceProviderOf(id: string): VoiceProvider | undefined {
  return providers.get(id);
}

/**
 * 清空注册，供测试隔离用例。
 * @internal
 */
export function resetVoiceProviders(): void {
  providers.clear();
}
