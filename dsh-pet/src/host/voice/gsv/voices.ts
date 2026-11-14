/**
 * GSV 音色扫描：音色目录 → 可直接喂给 `/tts` 的音色清单（参考音频 + 参考文本 + 采样参数 + 权重）。
 *
 * 目录口径跟 `voice-local` 一致（一个子目录一个音色，`voice.json` 声明 ref/ref_text/采样参数），
 * 这样已有的音色包不用改一个字节就能被插件读到；权重按文件名前缀匹配 `<音色>…eN`（取最高 epoch）。
 * 纯函数式读取：不缓存、不联网，缓存留给 provider（它知道何时该失效）。
 * 扫不到的整条丢弃——没有参考音频的音色点了也出不了声，列出来只会骗人。
 * @module dsh-fish-body/src/host/voice/gsv/voices
 */
import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';
import { readJsonc } from '../../config/jsonc.ts';
import { toPosixPath, type GsvSettings } from './settings.ts';

/** 一个可合成的 Gsv 音色（本模块的产物，路由与 provider 共用）。 */
export interface GsvVoice {
  /** 音色 id = 目录名。 */
  readonly id: string;
  /** 一句说明（`voice.json.desc`），没有就空串。 */
  readonly desc: string;
  /** 参考音频绝对路径（正斜杠形式，直接进 `/tts`）。 */
  readonly refAudioPath: string;
  /** 参考音频逐字对应的文本。 */
  readonly refText: string;
  /** 参考音频语种。 */
  readonly promptLang: string;
  /** `/tts` 的 `text_split_method`（`voice.json.split` 换算而来）。 */
  readonly textSplitMethod: string;
  /** 采样参数；缺省交给 api_v2 自己的默认值。 */
  readonly temperature?: number;
  readonly topK?: number;
  readonly topP?: number;
  readonly seed?: number;
  /** 该音色的 GPT / SoVITS 权重绝对路径；空串目录或匹配不到时 undefined。 */
  readonly gptWeights?: string;
  readonly sovitsWeights?: string;
}

/** `voice.json.split` 的取值到 GSV 切句法的换算：定稿音色要整句合成，别按标点切。 */
const SPLIT_METHODS: Record<string, string> = { none: 'cut0', clause: 'cut5' };

/** 取对象；非对象当空对象（`voice.json` 写坏时不炸，靠必填项判定丢弃）。 */
function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** 取字符串并 trim。 */
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 取有限数字；不是数字返回 undefined（交给 api_v2 默认值）。 */
function num(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** 列目录里的子目录名；软链（junction）也算——Windows 上 `isDirectory()` 对 junction 为 false。 */
function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** 列目录里的文件名（只看扩展名）；目录不存在返回空数组。 */
function listFiles(dir: string, ext: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ext)
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * 为一个音色挑权重文件：文件名以音色 id 开头、紧跟分隔符，再按 epoch/step 取最大。
 *
 * 同一音色常有多组权重（e5/e10、e4/e8），取最高 epoch 是「训练更久」的直觉选择；
 * 用户想换组就把文件移走或改 `voice.json` 的 id——不在这里加一层优先级配置。
 */
function pickWeights(files: readonly string[], voiceId: string, dir: string): string | undefined {
  let best: { file: string; rank: number[] } | undefined;
  for (const file of files) {
    if (!file.startsWith(voiceId)) continue;
    const rest = file.slice(voiceId.length);
    if (rest !== '' && !/^[-_.]/.test(rest)) continue;
    const epoch = /e(\d+)/i.exec(rest);
    const step = /_s(\d+)/i.exec(rest);
    const rank = [epoch ? Number(epoch[1]) : 0, step ? Number(step[1]) : 0];
    if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && rank[1] > best.rank[1])) {
      best = { file, rank };
    }
  }
  return best ? toPosixPath(join(dir, best.file)) : undefined;
}

/** 参考音频路径解析：先音色目录、再音色根的上一级（`voice-local` 里 ref 常写成 `voicepack/xx.wav`）。 */
function resolveRef(voiceDir: string, voicesDir: string, ref: string): string | undefined {
  if (!ref) return undefined;
  const candidates = isAbsolute(ref)
    ? [ref]
    : [join(voiceDir, ref), join(dirname(voicesDir.replace(/[\\/]+$/, '')), ref), join(voicesDir, ref)];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return toPosixPath(candidate);
  }
  return undefined;
}

/**
 * 扫一遍音色目录。
 *
 * @param settings - 连接配置（只用 `voicesDir` / 两个权重目录）。
 * @returns 能合成的音色，按目录名排序；目录不存在或没有合格音色时返回空数组。
 */
export function scanGsvVoices(settings: GsvSettings): GsvVoice[] {
  const voicesDir = settings.voicesDir;
  if (!voicesDir) return [];
  const gptFiles = settings.gptWeightsDir ? listFiles(settings.gptWeightsDir, '.ckpt') : [];
  const sovitsFiles = settings.sovitsWeightsDir ? listFiles(settings.sovitsWeightsDir, '.pth') : [];
  const voices: GsvVoice[] = [];
  for (const id of listDirs(voicesDir).sort()) {
    const conf = recordOf(readJsonc(join(voicesDir, id, 'voice.json')));
    // 只认 gsv 引擎的条目：huayan 是 piper、age12-cloud 是云端复刻，接到 9880 上只会报错
    const engine = str(conf.engine).toLowerCase();
    if (engine && engine !== 'gsv') continue;
    const refAudioPath = resolveRef(join(voicesDir, id), voicesDir, str(conf.ref));
    const refText = str(conf.ref_text);
    if (!refAudioPath || !refText) continue;
    const split = str(conf.split).toLowerCase();
    const temperature = num(conf.temperature);
    const topK = num(conf.top_k);
    const topP = num(conf.top_p);
    const seed = num(conf.seed);
    const gptWeights = pickWeights(gptFiles, id, settings.gptWeightsDir);
    const sovitsWeights = pickWeights(sovitsFiles, id, settings.sovitsWeightsDir);
    voices.push({
      id,
      desc: str(conf.desc),
      refAudioPath,
      refText,
      promptLang: settings.promptLang,
      textSplitMethod: SPLIT_METHODS[split] ?? (/^cut[0-5]$/.test(split) ? split : 'cut5'),
      ...(temperature === undefined ? {} : { temperature }),
      ...(topK === undefined ? {} : { topK }),
      ...(topP === undefined ? {} : { topP }),
      ...(seed === undefined ? {} : { seed }),
      ...(gptWeights === undefined ? {} : { gptWeights }),
      ...(sovitsWeights === undefined ? {} : { sovitsWeights }),
    });
  }
  return voices;
}

/**
 * 当前选中的音色。
 *
 * @param voices - {@link scanGsvVoices} 的结果。
 * @param id - 配置里的音色 id。
 * @returns 命中的音色；没有同 id 时 undefined（provider 据此报「音色不存在」）。
 */
export function voiceById(voices: readonly GsvVoice[], id: string): GsvVoice | undefined {
  return voices.find((voice) => voice.id === id);
}

/**
 * 音色在菜单/设置页里的展示名：目录名就够用，`desc` 只作补充。
 * @param voice - 扫描出的音色。
 * @returns 展示名（`id`，有描述时附在后面）。
 */
export function voiceLabel(voice: GsvVoice): string {
  return voice.desc ? `${voice.id} · ${voice.desc}` : voice.id;
}

/** 音色权重指纹：换音色或换 epoch 时缓存键要跟着变，否则旧音频会用旧嗓子播出来。 */
export function weightsTag(voice: GsvVoice | undefined): string {
  if (!voice) return '';
  const gpt = voice.gptWeights ? basename(voice.gptWeights) : '';
  const sovits = voice.sovitsWeights ? basename(voice.sovitsWeights) : '';
  return [voice.id, gpt, sovits].join('|');
}
