/**
 * `/voice/voices` 里 `providers` 段的客户端视图：谁在念、能不能用、有哪些音色可切、当前选的是谁。
 *
 * 单独一份而不是从宿主类型导入：客户端产物是浏览器侧脚本，不该把宿主模块拉进来；
 * 而且这是**网络数据**，字段可能缺席或类型不对，必须先按「可能不存在」解析再用。
 * 只做解析，不请求也不缓存——拉取归调用点（设置页 / 右键入口）。
 * @module dsh-fish-body/src/shared/voice-providers
 */

/** 一个可切音色（展示用字段）。 */
export interface VoiceChoice {
  readonly id: string;
  readonly name: string;
  readonly tag?: string;
}

/** 一个接入配置项（宿主声明，设置页据此生成控件）。 */
export interface VoiceFieldView {
  readonly key: string;
  readonly label: string;
  readonly kind: 'text' | 'password' | 'number' | 'select';
  readonly required: boolean;
  readonly placeholder?: string;
  readonly description?: string;
}

/** 一个语音实现的状态视图。 */
export interface VoiceProviderView {
  readonly id: string;
  readonly name: string;
  /** 内置实现在客户端不参与音色切换（它的音色走 `voiceName` 配置）。 */
  readonly builtin: boolean;
  readonly available: boolean;
  /** 不可用原因（服务没起、没配音色目录…），直接显示给用户。 */
  readonly reason?: string;
  /**
   * 最近一次合成失败的原因（服务通着却念不出来）。
   *
   * 与 `reason` 分开：`reason` 是「这一环现在能不能用」，这一项是「刚才念失败了」。
   * 回退链会静默换到 edge，所以这是用户唯一能看到「本地音色其实没用上」的地方。
   */
  readonly lastError?: string;
  readonly voices: readonly VoiceChoice[];
  /** 当前选中的音色 id；空串 = 没选。 */
  readonly voice: string;
  /** 接入配置项（服务地址 / 目录 / 语种…）：设置页按它生成表单。 */
  readonly fields: readonly VoiceFieldView[];
}

/** 取对象；非对象返回 undefined。 */
function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** 取字符串；非字符串返回空串。 */
function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 解析一个音色条目。
 * @param raw - 网络来的任意值。
 * @returns 合法的音色；缺 id/name 时 undefined（坏条目静默丢弃，不能让一条数据让菜单崩掉）。
 */
function parseChoice(raw: unknown): VoiceChoice | undefined {
  const entry = obj(raw);
  if (!entry) return undefined;
  const id = str(entry.id).trim();
  if (!id) return undefined;
  const name = str(entry.name).trim() || id;
  const tag = str(entry.tag).trim();
  return { id, name, ...(tag ? { tag } : {}) };
}

/**
 * 解析一个接入配置项。
 * @param raw - 网络来的任意值。
 * @returns 合法项；缺 key/label 或 kind 不认识时 undefined（不认识的控件渲染不出来，宁可不显示）。
 */
function parseField(raw: unknown): VoiceFieldView | undefined {
  const entry = obj(raw);
  if (!entry) return undefined;
  const key = str(entry.key).trim();
  if (!key) return undefined;
  const kind = str(entry.kind).trim();
  if (kind !== 'text' && kind !== 'password' && kind !== 'number' && kind !== 'select') return undefined;
  const placeholder = str(entry.placeholder).trim();
  const description = str(entry.description).trim();
  return {
    key,
    label: str(entry.label).trim() || key,
    kind,
    required: entry.required === true,
    ...(placeholder ? { placeholder } : {}),
    ...(description ? { description } : {}),
  };
}

/**
 * 解析一个实现的状态。
 * @param raw - 网络来的任意值。
 * @returns 合法的实现；缺 id 时 undefined。
 */
function parseProvider(raw: unknown): VoiceProviderView | undefined {
  const entry = obj(raw);
  if (!entry) return undefined;
  const id = str(entry.id).trim();
  if (!id) return undefined;
  const voices = Array.isArray(entry.voices)
    ? entry.voices.map(parseChoice).filter((item): item is VoiceChoice => item !== undefined)
    : [];
  const fields = Array.isArray(entry.fields)
    ? entry.fields.map(parseField).filter((item): item is VoiceFieldView => item !== undefined)
    : [];
  const reason = str(entry.reason).trim();
  const lastError = str(entry.lastError).trim();
  return {
    id,
    name: str(entry.name).trim() || id,
    builtin: entry.builtin === true,
    // 老宿主没有 available 字段：按可用处理（那时也还没有 provider，等于不会用到）
    available: entry.available !== false,
    ...(reason ? { reason } : {}),
    ...(lastError ? { lastError } : {}),
    voices,
    voice: str(entry.voice).trim(),
    fields,
  };
}

/**
 * 解析 `/voice/voices` 的 `providers` 段。
 *
 * @param raw - 响应体的 `providers` 字段（可能是任意值）。
 * @returns 合法的实现列表；不是数组时返回空数组。
 */
export function readVoiceProviders(raw: unknown): VoiceProviderView[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseProvider).filter((item): item is VoiceProviderView => item !== undefined);
}

/**
 * 能切音色的实现（内置实现除外，没有音色时也不列）。
 *
 * @param providers - {@link readVoiceProviders} 的结果。
 * @returns 过滤后的列表；空数组 = 右键菜单不出现「音色」。
 */
export function switchableProviders(providers: readonly VoiceProviderView[]): VoiceProviderView[] {
  return providers.filter((provider) => !provider.builtin && provider.voices.length > 0);
}
