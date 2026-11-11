/**
 * GSV（GPT-SoVITS 的 api_v2）连接配置：服务地址、当前音色、音色目录与两套权重目录。
 *
 * 为什么不把本机路径写成代码默认值：这几个目录是「素材」不是「插件资产」，换台机器就不存在；
 * 写死会让「不可用」的理由变成假的（目录不存在 vs 根本没配），排障时看不出该改哪一项。
 * 读的是 `<userRoot>/voice-providers.json` 的 `gsv` 段（见 ./store.ts），每次现读现用，改配置不必重启插件。
 * 只解析不校验：缺项一律空串，由 provider 用「未配置 xx」这个理由让链跳到下一环。
 * @module dsh-pet/src/host/voice/gsv/settings
 */

/** GSV 服务的默认地址：与本机 voice-local 的 gsv.bat 一致（9880 是 api_v2 的默认端口）。 */
export const GSV_DEFAULT_BASE_URL = 'http://127.0.0.1:9880';

/** 文本与参考文本的默认语种：VTube 那套热键名是中文，本机音色也都是中文韵律。 */
export const GSV_DEFAULT_LANG = 'zh';

/** 一段 GSV 配置（全是字符串：写进 JSONC 用户配置，不在代码里存对象）。 */
export interface GsvSettings {
  /** api_v2 的根地址，不带尾斜杠。 */
  readonly baseURL: string;
  /** 当前音色 id（= 音色目录名）。 */
  readonly voice: string;
  /** 音色目录：每个子目录一个音色，内含 `voice.json` + 参考音频。 */
  readonly voicesDir: string;
  /** GPT 权重目录（`*.ckpt`）；空串 = 不切权重，沿用服务启动时加载的那一套。 */
  readonly gptWeightsDir: string;
  /** SoVITS 权重目录（`*.pth`）；空串同上。 */
  readonly sovitsWeightsDir: string;
  /** 合成文本的语种（`zh` / `ja` / `en`…）。 */
  readonly textLang: string;
  /** 参考音频的语种；缺省跟随 {@link textLang}。 */
  readonly promptLang: string;
}

/** 全空配置：未配置时的初值，缺项即空串。 */
export const EMPTY_GSV_SETTINGS: GsvSettings = {
  baseURL: GSV_DEFAULT_BASE_URL,
  voice: '',
  voicesDir: '',
  gptWeightsDir: '',
  sovitsWeightsDir: '',
  textLang: GSV_DEFAULT_LANG,
  promptLang: GSV_DEFAULT_LANG,
};

/** 把一个 unknown 当对象看；不是对象就当空对象（配置被写坏时不炸，由缺项判定接手）。 */
function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** 取字符串字段并 trim；非字符串一律当空串。 */
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 从 `voice-providers.json` 的解析结果里取 GSV 设置。
 *
 * @param source - 整个 provider 配置对象（`{ gsv: {...} }`），可以是 undefined。
 * @returns 补齐默认值后的设置；`gsv` 缺席时除了 baseURL/语种都是空串。
 */
export function gsvSettingsOf(source: unknown): GsvSettings {
  const conf = recordOf(recordOf(source).gsv);
  return {
    baseURL: str(conf.baseURL) || GSV_DEFAULT_BASE_URL,
    voice: str(conf.voice),
    voicesDir: str(conf.voicesDir),
    gptWeightsDir: str(conf.gptWeightsDir),
    sovitsWeightsDir: str(conf.sovitsWeightsDir),
    textLang: str(conf.textLang) || GSV_DEFAULT_LANG,
    promptLang: str(conf.promptLang) || str(conf.textLang) || GSV_DEFAULT_LANG,
  };
}

/**
 * 还缺哪些必填项（给人话用的字段名，直接进不可用理由）。
 *
 * @param settings - {@link gsvSettingsOf} 的结果。
 * @returns 缺失字段的配置键；空数组表示可以尝试连接。
 */
export function gsvMissingFields(settings: GsvSettings): string[] {
  const missing: string[] = [];
  if (!settings.baseURL) missing.push('baseURL');
  if (!settings.voicesDir) missing.push('voicesDir');
  return missing;
}

/**
 * 把 Windows 路径转成 api_v2 认的形式（正斜杠）。
 *
 * 实测：`/set_gpt_weights?weights_path=D:\AI\...\x.ckpt` 会让 api_v2 在 `open()` 上抛
 * `[Errno 22] Invalid argument`，同一路径写成正斜杠就 200——它内部按 POSIX 语义拼路径。
 *
 * @param path - 任意平台的绝对/相对路径。
 * @returns 反斜杠全部换成正斜杠的同一路径。
 */
export function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/');
}
