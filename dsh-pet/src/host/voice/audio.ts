/**
 * 音频片段与它的格式：合成实现统一回 `{ data, mime }`，缓存与路由按 mime 走。
 *
 * 为什么不是「一个 mp3 文件」：GSV 这类本地 TTS 直接出 wav，强制转 mp3 要多带一个编码器；
 * 客户端 `<audio>` 对 wav / ogg / mp3 都认。于是下行的格式由**合成实现**决定，
 * 缓存扩展名与 `/voice/speak` 的 Content-Type 都从这一份表推出来。
 * 表外的 MIME 一律拒绝：写进缓存也没人放得出来，不如当一次合成失败报出去。
 * @module dsh-pet/src/host/voice/audio
 */

/** 一次合成的产出：字节 + MIME。 */
export interface AudioClip {
  /** 完整音频字节（非空）。 */
  readonly data: Uint8Array;
  /** 形如 `audio/mpeg` / `audio/wav`。 */
  readonly mime: string;
}

/** 内置实现的格式；也是缓存键里缺省的落盘扩展名。 */
export const DEFAULT_AUDIO_MIME = 'audio/mpeg';

/** MIME → 落盘扩展名（录制方与读回方共用同一张表）。 */
const MIME_TO_EXT: Readonly<Record<string, string>> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
};

/** 全部已知扩展名；缓存查找与淘汰都按它扫。 */
export const AUDIO_EXTENSIONS: readonly string[] = [...new Set(Object.values(MIME_TO_EXT))];

/**
 * 归一化 MIME：去参数、转小写、把 `audio/mp3` 收成 `audio/mpeg`。
 *
 * @param raw - 合成实现回的 MIME（可能带 `; charset=` 之类）。
 * @returns 归一后的 MIME；空串原样返回空串。
 */
export function normalizeAudioMime(raw: string): string {
  const base = raw.split(';')[0]?.trim().toLowerCase() ?? '';
  return base === 'audio/mp3' ? DEFAULT_AUDIO_MIME : base;
}

/**
 * MIME → 落盘扩展名。
 *
 * @param mime - 任意写法的 MIME。
 * @returns 扩展名（不含点）；表外的格式返回 undefined。
 */
export function audioExtOf(mime: string): string | undefined {
  return MIME_TO_EXT[normalizeAudioMime(mime)];
}

/**
 * 落盘扩展名 → MIME（命中旧缓存文件时要按它回 Content-Type）。
 *
 * @param ext - 不带点的扩展名。
 * @returns 归一后的 MIME；未知扩展名返回 undefined。
 */
export function audioMimeOfExt(ext: string): string | undefined {
  const lower = ext.toLowerCase();
  return AUDIO_EXTENSIONS.includes(lower) ? normalizeAudioMime(`audio/${lower === 'mp3' ? 'mpeg' : lower}`) : undefined;
}
