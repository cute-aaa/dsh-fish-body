/**
 * GSV 音色扫描：只认一处来源——`<voicesDir>/<id>/`，一个子目录一个音色。
 *
 * 目录里放三样东西就够了：
 * - `ref.wav`（或 `ref.mp3` / 目录里唯一的那个音频）——参考音频；
 * - `ref.txt`（也可 `<id>.txt` / 与参考音频同名）——参考文本，缺了就是零样本；
 * - `*.ckpt` + `*.pth`（顶层，或一层 `v2/` 这样的子目录）——两侧权重，必须是真文件。
 *
 * 为什么砍到只剩这一处：旧版有参考音频目录、两个权重目录、旧音色包 `voice.json` 四个来源，
 * 「这个音色为什么是灰的」于是有四五种答案，排障时得挨个目录看。现在答案是唯一的：
 * 去那个目录看少哪个文件。导入流程（`./voice-pack.ts`）负责把目录造出来。
 *
 * 三条硬规则：
 * 1. **认出来的目录都列出来**，缺什么写进 `reason`（缺参考 / 缺 GPT / 缺 SoVITS），
 *    设置页与右键菜单据此置灰——「列不出来」和「列出来但用不了」是两种完全不同的排障体验。
 * 2. **不再有「服务预加载权重」这种免校验模式**：两侧权重是音色的组成部分，缺一侧就是缺。
 * 3. 纯函数式读取：不缓存、不联网，缓存留给 provider（它知道何时该失效）。
 * @module dsh-fish-body/src/host/voice/gsv/voices
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { toPosixPath, type GsvSettings } from './settings.ts';

/** 一个可识别（不一定可用）的 GSV 音色（本模块的产物，路由、provider 与菜单共用）。 */
export interface GsvVoice {
  /** 音色 id（= 音色包子目录名）。 */
  readonly id: string;
  /** 参考音频绝对路径（正斜杠形式，直接进 `/tts`）；缺参考音频时 undefined。 */
  readonly refAudioPath?: string;
  /** 参考音频逐字对应的文本；空串 = 零样本（api_v2 的 `prompt_text` 可选）。 */
  readonly refText: string;
  /** 没有参考文本：能念，但音质会明显掉一档。 */
  readonly zeroShot: boolean;
  /** 参考音频语种（全局配置；不再有逐音色覆盖）。 */
  readonly promptLang: string;
  /** 该音色的 GPT / SoVITS 权重绝对路径；缺那一侧时 undefined。 */
  readonly gptWeights?: string;
  readonly sovitsWeights?: string;
  /** 权重对应的版本（`v2` / `v5turbo`…），用来发现 GPT 与 SoVITS 的错配。 */
  readonly gptVersion?: string;
  readonly sovitsVersion?: string;
  /** 能不能真的交给 `/tts`（缺任一侧权重或参考音频时为 false，仍会列出来并置灰）。 */
  readonly available: boolean;
  /** 不可用原因（缺什么、期望的文件名），直接显示给用户。 */
  readonly reason?: string;
  /** 这个音色自己的一句话提示（版本错配 / 零样本）。 */
  readonly notes: readonly string[];
}

/** 一次扫描：全部音色候选 + 给设置页看的全局诊断。 */
export interface GsvVoiceScan {
  /** 识别到的音色，按 id 排序（含不可用的）。 */
  readonly voices: readonly GsvVoice[];
  /** 全局诊断（目录计数、目录不存在、版本错配…）。 */
  readonly notes: readonly string[];
}

/** 一对权重的配对结论（`./voice-pack.ts` 的导入提案也用它，排序规则只有这一处）。 */
export interface WeightPair {
  readonly gpt?: string;
  readonly sovits?: string;
  readonly gptVersion?: string;
  readonly sovitsVersion?: string;
  /** 两侧版本都已知且不同：服务端加载大概率失败。 */
  readonly mismatch: boolean;
}

/** 参考音频认的扩展名（api_v2 自己用音色库读，wav/mp3/flac 都行）。 */
const AUDIO_EXTENSIONS: readonly string[] = ['.wav', '.mp3', '.flac', '.ogg', '.m4a'];

/** 两类权重认的扩展名。 */
const WEIGHT_EXTENSIONS: readonly string[] = ['.ckpt', '.pth'];

/** 版本目录名的识别：`GPT_weights_v2` / `SoVITS_weights_v5turbo`；没写版本就是 v1。 */
const VERSION_IN_DIR = /_v([0-9a-z]+)$/i;

/** 文件名尾部的训练标记：`_e8` / `-e10` / `_s232` / `_l32` / `_lora32`（会反复剥）。 */
const RANK_TOKEN = /[-_](?:e|s|l|lora)\d+$/i;

/** 已知的版本标记（`myvoice-v2.ckpt` 这种文件名会把版本写在 id 后面）。 */
const VERSION_TOKEN = /[-_](?:v1|v2|v3|v4|v5dev|v5turbo|v2pro|v2proplus)$/i;

/** 从文件名取版本时用的带捕获版本正则（宽松：`-v2` / `_v5turbo` 都认）。 */
const VERSION_IN_NAME = /[-_]v([0-9a-z]+)$/i;

/** 列目录项；目录不存在返回空数组。 */
function listEntries(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** 列目录里的子目录名；软链（junction）也算——Windows 上 `isDirectory()` 对 junction 为 false。 */
function listDirs(dir: string): string[] {
  return listEntries(dir)
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name);
}

/** 列目录里的文件名（只看扩展名）；目录不存在返回空数组。 */
function listFiles(dir: string, ext: string): string[] {
  return listEntries(dir)
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ext)
    .map((entry) => entry.name);
}

/** 是不是音频扩展名。 */
function isAudioName(name: string): boolean {
  return AUDIO_EXTENSIONS.includes(extname(name).toLowerCase());
}

/** 文件名去扩展名。 */
function stemOf(name: string): string {
  return name.slice(0, name.length - extname(name).length);
}

/** 从 `GPT_weights_v2` 这类目录名取版本标记；取不到当 v1。 */
function versionOfRoot(root: string): string {
  const name = basename(root.replace(/[\\/]+$/, ''));
  const matched = VERSION_IN_DIR.exec(name);
  return matched ? `v${(matched[1] ?? '').toLowerCase()}` : 'v1';
}

/** 从文件名尾部取 `[epoch, step]`（取不到当 0，0 相当于「没写 epoch 的那一组」）。 */
function rankOf(stem: string): [number, number] {
  const epoch = /[-_]e(\d+)/i.exec(stem);
  const step = /[-_]s(\d+)/i.exec(stem);
  return [epoch ? Number(epoch[1]) : 0, step ? Number(step[1]) : 0];
}

/** 剥掉尾部训练标记，得到「严格 id」（可能还带 `-gsv`）。 */
function strictIdOf(stem: string): string {
  let current = stem;
  for (;;) {
    const next = current.replace(RANK_TOKEN, '');
    if (next === current) return current;
    current = next;
  }
}

/**
 * 文件名 → 音色 id（宽松口径）：去掉训练标记、`-gsv` 后缀与尾部版本标记。
 *
 * 例：`klee-gsv-e10` → `klee`；`hutao-gsv_e8_s3464_l32` → `hutao`；`norma-v5turbo-e10` → `norma`。
 * 导入时用它把权重文件名变成一个可当目录名的 id。
 */
export function voiceIdOfStem(stem: string): string {
  const strict = strictIdOf(stem).replace(/[-_]+$/, '');
  return strict
    .replace(/[-_]gsv$/i, '')
    .replace(VERSION_TOKEN, '')
    .replace(/[-_]+$/, '');
}

/** 从文件名尾部的版本标记取版本；取不到返回空串（未知）。 */
function versionOfWeightName(name: string): string {
  const matched = VERSION_IN_NAME.exec(stemOf(name));
  if (!matched) return '';
  const token = (matched[1] ?? '').toLowerCase();
  return token === '' ? '' : `v${token}`;
}

/**
 * 从任意权重路径推版本：文件名标记优先，其次父目录名（`*_weights*` 或 `v2/` 这类显式版本目录）。
 * @param file - 权重文件绝对/相对路径。
 * @returns 版本标记（`v2` / `v5turbo`…）；两边都看不出来时空串（配对被当作「未知、兼容」）。
 */
export function versionOfWeightPath(file: string): string {
  const named = versionOfWeightName(basename(file));
  if (named !== '') return named;
  const parent = basename(dirname(file));
  if (/^(?:gpt|sovits|vits)_weights/i.test(parent)) return versionOfRoot(dirname(file));
  // 音色包里的 `v2/` 子目录：与训练目录名同一个意思（`GPT_weights_v2` 的简写）。
  const explicit = /^v([0-9a-z]+)$/i.exec(parent);
  return explicit ? `v${(explicit[1] ?? '').toLowerCase()}` : '';
}

/** rank 比较：epoch 优先、再看 step。 */
function newerThan(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
}

/** 一个待配对的权重文件。 */
interface RankedWeight {
  readonly path: string;
  readonly version: string;
  readonly rank: readonly [number, number];
}

/** 路径 → 带版本与 epoch 排序键的条目。 */
function rankedOf(path: string): RankedWeight {
  return { path, version: versionOfWeightPath(path), rank: rankOf(stemOf(basename(path))) };
}

/** 新到旧、再按路径稳定排序。 */
function compareRanked(a: RankedWeight, b: RankedWeight): number {
  if (newerThan(a.rank, b.rank)) return -1;
  if (newerThan(b.rank, a.rank)) return 1;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/**
 * 给一组文件配对：同版本优先，其次「版本未知」，最后才接受已知版本不一致。
 *
 * 为什么要配对：`init_t2s_weights`/`init_vits_weights` 会按路径自动切版本，GPT 与 SoVITS 版本不一致
 * 时服务端加载会失败；而同一个音色常常同时留着 v2 与 v5turbo 两套。
 *
 * @param gptFiles - `.ckpt` 文件清单（绝对或相对路径均可）。
 * @param sovitsFiles - `.pth` 文件清单。
 * @returns 选中的一对（缺哪侧就没有那侧的键）与版本；两侧版本都已知且不同时 `mismatch` 为真。
 */
export function pairWeightsOf(gptFiles: readonly string[], sovitsFiles: readonly string[]): WeightPair {
  const gpt = gptFiles.map(rankedOf).sort(compareRanked);
  const sovits = sovitsFiles.map(rankedOf).sort(compareRanked);
  const newest = (list: readonly RankedWeight[]): RankedWeight | undefined => list[0];
  if (gpt.length === 0 && sovits.length === 0) return { mismatch: false };
  if (gpt.length === 0) {
    const only = newest(sovits);
    return only ? { sovits: only.path, sovitsVersion: only.version, mismatch: false } : { mismatch: false };
  }
  if (sovits.length === 0) {
    const only = newest(gpt);
    return only ? { gpt: only.path, gptVersion: only.version, mismatch: false } : { mismatch: false };
  }

  /** 组合内比较：先看 GPT 的新旧，再看 SoVITS，最后按路径稳定排序。 */
  const comparePair = (a: { gpt: RankedWeight; sovits: RankedWeight }, b: typeof a): number =>
    compareRanked(a.gpt, b.gpt) || compareRanked(a.sovits, b.sovits);

  // 0 = 同版本；1 = 至少一侧版本未知（兼容）；2 = 已知版本不一致
  const tiers: { gpt: RankedWeight; sovits: RankedWeight }[][] = [[], [], []];
  for (const left of gpt) {
    for (const right of sovits) {
      const tier = left.version !== '' && right.version !== '' ? (left.version === right.version ? 0 : 2) : 1;
      tiers[tier]?.push({ gpt: left, sovits: right });
    }
  }
  for (const tier of tiers) {
    if (tier.length === 0) continue;
    tier.sort(comparePair);
    const best = tier[0];
    if (!best) continue;
    const mismatch = best.gpt.version !== '' && best.sovits.version !== '' && best.gpt.version !== best.sovits.version;
    return {
      gpt: best.gpt.path,
      sovits: best.sovits.path,
      gptVersion: best.gpt.version,
      sovitsVersion: best.sovits.version,
      mismatch,
    };
  }
  return { mismatch: false };
}

/**
 * 在一个音色目录里挑参考音频：`ref.*` 优先，其次与目录同名的 `<id>.*`，最后「目录里唯一的那个音频」。
 *
 * 三步都认是为了手建的音色包（有人习惯直接叫 `纳西妲.wav`）；多个音频且都不叫 `ref` 时**不猜**——
 * 猜错一句参考文案，音色质感就全变了，不如让他自己重命名成 `ref.wav`。
 *
 * @param dir - 音色目录。
 * @param id - 音色 id（目录名）。
 * @returns 参考音频绝对路径（正斜杠）；没有合格文件时 undefined。
 */
function pickRefAudio(dir: string, id: string): string | undefined {
  const audios = listEntries(dir).filter((entry) => entry.isFile() && isAudioName(entry.name));
  const exact = (test: (stem: string) => boolean): string | undefined => {
    const hit = audios.find((entry) => test(stemOf(entry.name)));
    return hit ? toPosixPath(join(dir, hit.name)) : undefined;
  };
  return (
    exact((stem) => /^ref$/i.test(stem)) ??
    exact((stem) => stem === id) ??
    (audios.length === 1 && audios[0] ? toPosixPath(join(dir, audios[0].name)) : undefined)
  );
}

/**
 * 读一个文本文件（UTF-8，去 BOM，取第一段非空行）。
 * @param file - 文件路径。
 * @returns 文本；读不到返回空串。
 */
function readTextFile(file: string): string {
  try {
    const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    for (const line of raw.split(/\r?\n/)) {
      const text = line.trim();
      if (text !== '') return text;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * 取参考文本：`ref.txt` → `<id>.txt` → 与参考音频同名的 `.txt` → 目录里唯一的那个 `.txt`。
 *
 * 最后一条是为手建的音色包准备的（`参考.txt` 这种命名）；一个音色目录本来就只该有一句话，
 * 目录里只有一个 `.txt` 时它就是参考文本，比「悄悄按零样本合成」更接近用户的本意。
 *
 * @param dir - 音色目录。
 * @param id - 音色 id（目录名）。
 * @param refAudioPath - 参考音频（可为空）。
 * @returns 第一段非空文本；都没有返回空串（零样本）。
 */
function readRefText(dir: string, id: string, refAudioPath: string | undefined): string {
  const candidates: string[] = [join(dir, 'ref.txt'), join(dir, `${id}.txt`)];
  if (refAudioPath !== undefined) {
    const stem = basename(refAudioPath, extname(refAudioPath));
    if (stem !== 'ref' && stem !== id) candidates.push(join(dir, `${stem}.txt`));
  }
  for (const file of candidates) {
    const text = readTextFile(file);
    if (text !== '') return text;
  }
  const onlyText = listFiles(dir, '.txt');
  if (onlyText.length === 1 && onlyText[0] !== undefined) return readTextFile(join(dir, onlyText[0]));
  return '';
}

/**
 * 一个音色目录里的权重：顶层 + 一层子目录（`v2/` 这种显式版本的写法）。
 * @param dir - 音色目录。
 * @param ext - `.ckpt` / `.pth`。
 * @returns 权重文件绝对路径（正斜杠）。
 */
function weightsOfDir(dir: string, ext: string): string[] {
  const found = listFiles(dir, ext).map((name) => toPosixPath(join(dir, name)));
  for (const sub of listDirs(dir)) {
    const subDir = join(dir, sub);
    for (const name of listFiles(subDir, ext)) found.push(toPosixPath(join(subDir, name)));
  }
  return found;
}

/** 缺参考音频时给用户的期望路径。 */
function missingRefReason(id: string): string {
  return `缺少参考音频：${id}/ref.wav`;
}

/** 缺权重时给用户的期望文件名。 */
function missingWeightReason(kind: 'gpt' | 'sovits', id: string): string {
  return kind === 'gpt' ? `缺少 GPT 权重：${id}/*.ckpt` : `缺少 SoVITS 权重：${id}/*.pth`;
}

/**
 * 扫一遍音色包目录。
 *
 * @param settings - 连接配置（只用 `voicesDir` 与语种）。
 * @returns 全部音色候选（含不可用）与全局诊断；目录没配或不存在时是空清单 + 一句诊断。
 */
export function scanGsvVoiceLibrary(settings: GsvSettings): GsvVoiceScan {
  const notes: string[] = [];
  const voicesDir = settings.voicesDir;
  if (voicesDir === '') {
    return { voices: [], notes: ['没有配置音色包目录：GSV 没有音色来源（用「导入音色」建一个）'] };
  }
  if (!existsSync(voicesDir)) {
    return { voices: [], notes: [`音色包目录不存在：${voicesDir}`] };
  }

  const dirs = listDirs(voicesDir).sort();
  const voices: GsvVoice[] = [];
  for (const id of dirs) {
    const dir = join(voicesDir, id);
    const refAudioPath = pickRefAudio(dir, id);
    const refText = readRefText(dir, id, refAudioPath);
    const gptFiles = weightsOfDir(dir, '.ckpt');
    const sovitsFiles = weightsOfDir(dir, '.pth');
    // 空目录（导入中途失败、或用户手建了个空壳）不列：它连「缺什么」都说不出来。
    if (refAudioPath === undefined && gptFiles.length === 0 && sovitsFiles.length === 0) continue;

    const pair = pairWeightsOf(gptFiles, sovitsFiles);
    const zeroShot = refText === '';
    const perVoiceNotes: string[] = [];
    if (pair.mismatch) {
      perVoiceNotes.push(
        `GPT 与 SoVITS 版本不一致（${pair.gptVersion ?? ''} / ${pair.sovitsVersion ?? ''}），加载可能失败`,
      );
    }
    if (zeroShot && refAudioPath !== undefined) perVoiceNotes.push('没有参考文本：按零样本合成，音质会降一档');

    const missing: string[] = [];
    if (refAudioPath === undefined) missing.push(missingRefReason(id));
    if (pair.gpt === undefined) missing.push(missingWeightReason('gpt', id));
    if (pair.sovits === undefined) missing.push(missingWeightReason('sovits', id));
    const reason = missing.length > 0 ? missing.join('；') : undefined;

    voices.push({
      id,
      ...(refAudioPath === undefined ? {} : { refAudioPath }),
      refText,
      zeroShot,
      promptLang: settings.promptLang,
      ...(pair.gpt === undefined ? {} : { gptWeights: pair.gpt }),
      ...(pair.sovits === undefined ? {} : { sovitsWeights: pair.sovits }),
      ...(pair.gptVersion === undefined ? {} : { gptVersion: pair.gptVersion }),
      ...(pair.sovitsVersion === undefined ? {} : { sovitsVersion: pair.sovitsVersion }),
      available: reason === undefined,
      ...(reason === undefined ? {} : { reason }),
      notes: perVoiceNotes,
    });
  }

  const available = voices.filter((voice) => voice.available).length;
  notes.push(`音色包目录：${dirs.length} 个目录，列出 ${voices.length} 个音色，可合成 ${available} 个`);
  if (voices.length === 0) notes.push('音色包目录是空的：用「导入音色」把训练好的权重接进来');
  for (const voice of voices.filter((item) => item.notes.some((note) => note.includes('版本不一致'))).slice(0, 5)) {
    notes.push(`${voice.id}：${voice.notes.find((note) => note.includes('版本不一致')) ?? ''}`);
  }
  return { voices, notes };
}

/**
 * 扫一遍音色包目录，只留能合成的。
 *
 * @param settings - 连接配置。
 * @returns **可合成**的音色（缺权重/缺参考的候选不在里面，它们在 {@link scanGsvVoiceLibrary} 里）。
 */
export function scanGsvVoices(settings: GsvSettings): GsvVoice[] {
  return scanGsvVoiceLibrary(settings).voices.filter((voice) => voice.available);
}

/**
 * 当前选中的音色。
 *
 * @param voices - 音色清单。
 * @param id - 配置里的音色 id。
 * @returns 命中的音色（可能不可用）；没有同 id 时 undefined。
 */
export function voiceById(voices: readonly GsvVoice[], id: string): GsvVoice | undefined {
  return voices.find((voice) => voice.id === id);
}

/** 32 位文本指纹（FNV-1a，够短且稳定）：参考文本改了，缓存键要跟着变。 */
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * 音色指纹：换音色、换 epoch、换参考音频或改参考文本时缓存键都要变。
 *
 * 为什么连参考文本也算进去：它只存在 `ref.txt` 里，改文本不会改文件名；
 * 漏了它，同一句话会用旧文本合成的音频顶上来，听起来像「改了没生效」。
 *
 * @param voice - 扫描出的音色；undefined 时返回空串。
 * @returns `id|gpt|sovits|ref|refTextHash[|zero]`。
 */
export function weightsTag(voice: GsvVoice | undefined): string {
  if (!voice) return '';
  const gpt = voice.gptWeights ? basename(voice.gptWeights) : '';
  const sovits = voice.sovitsWeights ? basename(voice.sovitsWeights) : '';
  const ref = voice.refAudioPath ? basename(voice.refAudioPath) : '';
  const text = voice.refText ? hashText(voice.refText) : '';
  return [voice.id, gpt, sovits, ref, text].join('|') + (voice.zeroShot ? '|zero' : '');
}

/**
 * 音色的一句话标签（权重版本 / 零样本）。
 * @param voice - 扫描出的音色。
 * @returns 用 ` · ` 连起来的一句；没有可说的就是空串。
 */
export function voiceTag(voice: GsvVoice): string {
  const parts: string[] = [];
  if (voice.gptVersion) parts.push(`权重 ${voice.gptVersion}`);
  if (voice.zeroShot) parts.push('零样本');
  return parts.join(' · ');
}

/** 权重扩展名清单（导入流程与扫描器共用同一份判定）。 */
export function isWeightName(name: string): boolean {
  return WEIGHT_EXTENSIONS.includes(extname(name).toLowerCase());
}
