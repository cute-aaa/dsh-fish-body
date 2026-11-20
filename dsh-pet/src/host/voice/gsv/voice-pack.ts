/**
 * 音色导入：选一个权重根目录 → 展开两侧权重 → 按文件名配对 → 逐条写进音色包目录。
 *
 * 只有一条写路径：`<voicesDir>/<id>/`（`ref.<ext>` + `ref.txt` + 真权重文件）。
 * 没有「只写指针」、没有「写到参考音频目录」、没有 `voice.json`——音色包目录是唯一真源，
 * 里面的权重必须是真文件，这样「这个目录能不能独立搬走/复制到另一台机器」只有一个答案。
 *
 * 权重的两种放法：
 * - `hardlink`（界面叫「引用」）：同一分区硬链接成真文件，不占双份空间；跨盘必然失败，直接报错；
 * - `copy`：复制一份，目录自足，代价是每套权重约 230 MB。
 *
 * 纯计算与文件读写分成两层：`previewVoicePack` 只读，`applyVoicePack` 才写盘；覆盖前一律备份。
 * 配对排序只有一处真源（`voices.ts` 的 `pairWeightsOf`），导入与扫描不会得出不同的结论。
 * @module dsh-fish-body/src/host/voice/gsv/voice-pack
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { copyFile, link, mkdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, parse } from 'node:path';
import { toPosixPath, type GsvSettings } from './settings.ts';
import { pairWeightsOf, versionOfWeightPath, voiceIdOfStem } from './voices.ts';

/** 权重文件的两种角色。 */
export type WeightKind = 'gpt' | 'sovits';

/** 参考音频认的扩展名（与扫描器一致）。 */
const AUDIO_EXTENSIONS: readonly string[] = ['.wav', '.mp3', '.flac', '.ogg', '.m4a'];

/** 扩展名 → 角色。 */
const KIND_OF_EXT: Readonly<Record<string, WeightKind>> = { '.ckpt': 'gpt', '.pth': 'sovits' };

/** 扩展名 → 另一侧扩展名。 */
const OTHER_EXT: Readonly<Record<WeightKind, string>> = { gpt: '.pth', sovits: '.ckpt' };

/** 权重子目录的识别：`GPT_weights_v2` / `SoVITS_weights_v5turbo`。 */
const GPT_DIR_PATTERN = /^GPT_weights/i;
const SOVITS_DIR_PATTERN = /^SoVITS_weights/i;
const WEIGHT_DIR_PATTERN = /^(?:gpt|sovits|vits)_weights/i;

/** 参考文本上限：一句话，超了基本是粘错内容。 */
export const MAX_REF_TEXT_CHARS = 300;
/** 参考音频上限（字节）：切片一般 0.3–1 MB。 */
export const MAX_REF_AUDIO_BYTES = 20 * 1024 * 1024;
/** 文本文件上限（字节）。 */
export const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;
/** 一次返回的最大候选行数。 */
export const MAX_TEXT_LINES = 200;
/** 一次导入最多提交多少条（防手滑与超长请求；正常一个人一次导十个八个）。 */
export const MAX_IMPORT_ITEMS = 50;

/** 音色 id 允许的字符：防路径穿越（id 会变成目录名/文件名）。 */
const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** 一个权重候选（配对结论里附带的备选）。 */
export interface WeightCandidate {
  readonly path: string;
  readonly version: string;
}

/** 配对结论。 */
export type PairStatus = 'matched' | 'missing' | 'unpaired';

/** 一次配对的结论（`missing` 表示另一侧根本没找到）。 */
export interface PairOutcome {
  readonly status: PairStatus;
  readonly path?: string;
  readonly version?: string;
  readonly candidates: readonly WeightCandidate[];
}

/**
 * 权重进音色目录的方式。
 *
 * - `hardlink`（界面叫「引用」）：同一分区硬链接成真文件（不占双份空间；跨盘会失败）；
 * - `copy`：复制一份（目录自足、可整个搬走；每套权重实测 230 MB 上下）。
 */
export type VoicePackPlacement = 'hardlink' | 'copy';

/** 一个权重在本次导入里的去向（预览显示、落地照此执行）。 */
export interface WeightPlan {
  readonly kind: WeightKind;
  /** 源文件（用户选中的权重根本里的那一份）。 */
  readonly source: string;
  /** 落地后的路径（`inside` 时等于源文件）。 */
  readonly target: string;
  /** 实际动作：`inside` = 权重本来就在这个目录里；`hardlink` / `copy` = 造真文件。 */
  readonly action: 'inside' | 'hardlink' | 'copy';
  /** 源文件字节数（读不到时 undefined）。 */
  readonly bytes?: number;
}

/** 导入表单的输入（预览与落地共用；一条 = 一个音色）。 */
export interface VoicePackInput {
  /** 这一侧权重（哪一侧都行，另一侧放 `counterpartPath`）。 */
  readonly weightPath: string;
  /** 另一侧权重；空串 = 只有一侧（导入后该音色置灰，直到补上）。 */
  readonly counterpartPath: string;
  readonly refAudioPath: string;
  readonly refText: string;
  /** 音色 id（目录名）；空串 = 从权重文件名推。 */
  readonly id: string;
  readonly placement: VoicePackPlacement;
  readonly overwrite: boolean;
}

/** 写盘要用的根（从 `voice-providers.json` 解析）。 */
export interface VoicePackRoots {
  readonly voicesDir: string;
  readonly promptLang: string;
}

/** 预览结果：只读，帮助界面显示「将成为什么」。 */
export interface VoicePackPreview {
  readonly suggestedId: string;
  readonly id: string;
  readonly kind: WeightKind;
  readonly pair: PairOutcome;
  readonly versions: { readonly gpt?: string; readonly sovits?: string };
  readonly warnings: readonly string[];
  readonly targetDir: string;
  readonly targetAudioPath: string;
  readonly targetTextPath: string;
  /** 权重的去向（按 gpt / sovits 各一条；缺的那侧没有条目）。 */
  readonly weights: readonly WeightPlan[];
  readonly placement: VoicePackPlacement;
  /** 本次有没有要写的东西：`false` 时「导入」按钮应当禁用（重复点只会得到 skip）。 */
  readonly pending: boolean;
  readonly status: 'new' | 'overwrite' | 'skip';
}

/** 落地结果。 */
export interface VoicePackApplyResult {
  readonly status: 'written' | 'skipped';
  readonly id: string;
  readonly targetDir: string;
  readonly audioPath?: string;
  readonly textPath?: string;
  /** 真的在目录里造出来的权重文件。 */
  readonly placed: readonly string[];
  /** 落地过程中的非致命说明（沿用现有文件、备份名等）。 */
  readonly notes: readonly string[];
  readonly backups: readonly string[];
}

/** 业务错误：路由原样映射成 `bad-request`。 */
export class VoicePackError extends Error {}

/** 列目录里的子目录；不存在返回空数组。 */ function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** 列目录里的文件名；不存在返回空数组。 */
function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** 文件存在且是普通文件。 */
function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** 目录存在且是目录。 */
function isDir(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** 文件是否在某个目录里（本身等于该目录时为 false）。 */
function isInside(file: string, dir: string): boolean {
  if (!dir) return false;
  const normalizedFile = toPosixPath(file).toLowerCase();
  const normalizedDir = toPosixPath(dir).replace(/\/+$/, '').toLowerCase();
  return normalizedFile.startsWith(normalizedDir + '/');
}

/** 取文件大小；读不到返回 undefined。 */
function sizeOf(file: string): number | undefined {
  try {
    return statSync(file).size;
  } catch {
    return undefined;
  }
}

/** 字节数 → 人看的大小。 */
function humanSize(bytes: number | undefined): string {
  if (bytes === undefined) return '?';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * 归一的音色 id：先剥 `vocal_`/`voice_`/`speaker_` 前缀，再复用扫描器那套（剥 `-gsv`/epoch/版本）。
 * @param raw - 目录名、文件名或用户输入。
 * @returns 归一后的 id；为空串表示不可用。
 */
export function normalizeVoicePackId(raw: string): string {
  const stripped = raw.trim().replace(/^(?:vocal|voice|speaker|spk)[-_]+/i, '');
  return voiceIdOfStem(stripped);
}

/** 权重文件 → 角色；不是权重扩展名时 undefined。 */
export function kindOfWeightPath(file: string): WeightKind | undefined {
  return KIND_OF_EXT[extname(file).toLowerCase()];
}

/** 从权重文件名归一 id。 */
export function idOfWeightPath(file: string): string {
  return normalizeVoicePackId(basename(file, extname(file)));
}

/**
 * 两个路径是不是同一个分区（硬链接能不能用就看它）。
 *
 * 判据是路径的卷根（Windows 是盘符，POSIX 恒为 `/`）——不碰磁盘，因此在文件被删掉之后
 * 仍然能回答「这里能不能硬链接」。
 *
 * @param a - 任意绝对路径。
 * @param b - 任意绝对路径。
 * @returns 同卷为 `true`；拿不到卷根（相对路径）时 `false`。
 */
export function sameVolumeOf(a: string, b: string): boolean {
  // 两侧路径的来源不同（配置里是用户手写的反斜杠，候选是扫描器转过的正斜杠），
  // 所以卷根必须先统一分隔符再比——否则同盘也会被判成跨盘，界面上「引用」会无故置灰。
  const volumeOf = (path: string): string => parse(path).root.replace(/\\/g, '/').toLowerCase();
  const left = volumeOf(a);
  const right = volumeOf(b);
  if (left === '' || right === '') return false;
  return left === right;
}

/**
 * 把配置解析成写盘用的根。
 * @param settings - `voice-providers.json` 的 `gsv` 段。
 * @returns 音色包目录与参考文本语种。
 */
export function voicePackRootsOf(settings: GsvSettings): VoicePackRoots {
  return { voicesDir: settings.voicesDir, promptLang: settings.promptLang };
}

/**
 * 找另一侧权重（同目录）。
 *
 * 只有一种查找：**同一个目录里**。旧的「配置里的权重根」「往上 1–2 层找兄弟权重目录」都删了——
 * 那两个搜索范围会让人怀疑「它凭什么把别处的权重配进来」。另一侧由导入流程显式给出。
 *
 * @param weightPath - 已校验的权重文件。
 * @param manualPath - 另一侧（非空时直接用它，只做校验）。
 * @returns 配对结论；`ambiguous` 语义已废弃，只会有 `matched` / `missing` / `unpaired`。
 * @throws {VoicePackError} 手动给的另一侧不存在或类型不对。
 */
export function findCounterpart(weightPath: string, manualPath = ''): PairOutcome {
  const kind = kindOfWeightPath(weightPath);
  if (!kind) return { status: 'missing', candidates: [] };
  if (manualPath === '') return { status: 'unpaired', candidates: [] };
  if (!isFile(manualPath)) throw new VoicePackError(`另一侧权重不存在：${manualPath}`);
  const manualKind = kindOfWeightPath(manualPath);
  if (!manualKind || manualKind === kind) {
    throw new VoicePackError(`另一侧权重必须是 ${OTHER_EXT[kind]} 文件：${manualPath}`);
  }
  return { status: 'matched', path: toPosixPath(manualPath), version: versionOfWeightPath(manualPath), candidates: [] };
}

/**
 * 读文本文件里的候选行。
 *
 * `.list`（含 `|`）取第 4 列（`wav|speaker|lang|text`），其它文本取整行；
 * 只读不改，供「从文本文件选一行」使用。
 *
 * @param file - 文本文件路径。
 * @param max - 最多返回多少行（默认 {@link MAX_TEXT_LINES}）。
 * @returns 候选行（带行号）。
 * @throws {VoicePackError} 文件不存在 / 太大 / 不是文本。
 */
export function readTextLines(file: string, max = MAX_TEXT_LINES): { index: number; text: string }[] {
  if (!isFile(file)) throw new VoicePackError(`文本文件不存在：${file}`);
  const size = sizeOf(file);
  if (size !== undefined && size > MAX_TEXT_FILE_BYTES) {
    throw new VoicePackError(`文本文件太大（上限 ${MAX_TEXT_FILE_BYTES / 1024 / 1024} MB）`);
  }
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch (error) {
    throw new VoicePackError(`读不了文本文件：${error instanceof Error ? error.message : String(error)}`);
  }
  const lines: { index: number; text: string }[] = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    const text = listTextOf(line);
    if (text !== '') lines.push({ index: index + 1, text });
    if (lines.length >= max) break;
  }
  return lines;
}

/** 一行 `.list`/文本 → 参考文本（`.list` 取第 4 列；其余整行）。 */
function listTextOf(line: string): string {
  const trimmed = line.trim();
  if (trimmed === '') return '';
  if (!trimmed.includes('|')) return trimmed;
  const parts = trimmed.split('|');
  return (parts.length >= 4 ? parts.slice(3).join('|') : (parts[parts.length - 1] ?? '')).trim();
}

/** 解析并校验输入；不合法时抛 {@link VoicePackError}。 */
function validateInput(
  input: VoicePackInput,
  roots: VoicePackRoots,
): {
  weightPath: string;
  kind: WeightKind;
  id: string;
  refAudioPath: string;
  text: string;
} {
  const weightPath = input.weightPath.trim();
  if (weightPath === '') throw new VoicePackError('请先选一个权重文件（.ckpt 或 .pth）');
  if (!isFile(weightPath)) throw new VoicePackError(`权重文件不存在：${weightPath}`);
  const kind = kindOfWeightPath(weightPath);
  if (!kind) throw new VoicePackError(`权重文件必须是 .ckpt 或 .pth：${weightPath}`);

  if (input.placement !== 'hardlink' && input.placement !== 'copy') {
    throw new VoicePackError('placement 只能是 hardlink（引用）或 copy（复制）');
  }

  const refAudioPath = input.refAudioPath.trim();
  if (refAudioPath === '') throw new VoicePackError('请选一个参考音频文件');
  if (!isFile(refAudioPath)) throw new VoicePackError(`参考音频不存在：${refAudioPath}`);
  if (!AUDIO_EXTENSIONS.includes(extname(refAudioPath).toLowerCase())) {
    throw new VoicePackError(`参考音频只支持 ${AUDIO_EXTENSIONS.join(' / ')}`);
  }
  const audioSize = sizeOf(refAudioPath);
  if (audioSize !== undefined && audioSize > MAX_REF_AUDIO_BYTES) {
    throw new VoicePackError(`参考音频太大（上限 ${MAX_REF_AUDIO_BYTES / 1024 / 1024} MB）`);
  }

  const text = input.refText.trim();
  if (text.length > MAX_REF_TEXT_CHARS) {
    throw new VoicePackError(`参考文本太长（上限 ${MAX_REF_TEXT_CHARS} 字）`);
  }

  const id = (input.id.trim() || idOfWeightPath(weightPath)).trim();
  if (!ID_PATTERN.test(id))
    throw new VoicePackError(`音色 id 只能用字母、数字、点、下划线、连字符（≤64）：${id || '(空)'}`);

  if (roots.voicesDir === '') {
    throw new VoicePackError('没有配置「音色包目录」：先在接入卡里填一个并保存，再来导入');
  }
  if (!isDir(roots.voicesDir)) throw new VoicePackError(`音色包目录不存在：${roots.voicesDir}`);
  return { weightPath, kind, id, refAudioPath, text };
}

/** 目标路径计算。 */
function targetsOf(
  roots: VoicePackRoots,
  id: string,
  refAudio: string,
): { targetDir: string; targetAudioPath: string; targetTextPath: string } {
  const targetDir = join(roots.voicesDir, id);
  const ext = extname(refAudio).toLowerCase();
  return {
    targetDir: toPosixPath(targetDir),
    targetAudioPath: toPosixPath(join(targetDir, `ref${ext}`)),
    targetTextPath: toPosixPath(join(targetDir, 'ref.txt')),
  };
}

/** 版本比较：两边都已知且不同才算错配。 */
function versionWarning(gpt?: string, sovits?: string): string | undefined {
  if (!gpt || !sovits) return undefined;
  if (gpt === sovits) return undefined;
  return `GPT 与 SoVITS 版本不一致（${gpt} / ${sovits}），服务端加载可能失败`;
}

/**
 * 算权重去向：按「怎么放」决定每份权重是硬链接、复制，还是本来就在目录里。
 *
 * @param input - 表单输入（只用 `placement`）。
 * @param weightPath - 用户选的权重。
 * @param kind - 它的角色。
 * @param counterpart - 另一侧权重（可能没有）。
 * @param targetDir - 音色目录。
 * @returns 至多两条计划（gpt / sovits）。
 */
function weightPlansOf(
  input: VoicePackInput,
  weightPath: string,
  kind: WeightKind,
  counterpart: string | undefined,
  targetDir: string,
): WeightPlan[] {
  const gpt = kind === 'gpt' ? weightPath : counterpart;
  const sovits = kind === 'sovits' ? weightPath : counterpart;
  const plans: WeightPlan[] = [];
  for (const [side, path] of [
    ['gpt', gpt],
    ['sovits', sovits],
  ] as const) {
    if (path === undefined || path === '') continue;
    const bytes = sizeOf(path);
    const extra = bytes === undefined ? {} : { bytes };
    // 权重本来就在这个音色目录里（重复导入同一批文件）：不用再造一份。
    if (isInside(path, targetDir)) {
      plans.push({ kind: side, source: toPosixPath(path), target: toPosixPath(path), action: 'inside', ...extra });
      continue;
    }
    plans.push({
      kind: side,
      source: toPosixPath(path),
      target: toPosixPath(join(targetDir, basename(path))),
      action: input.placement,
      ...extra,
    });
  }
  return plans;
}

/**
 * 预览：只读，给出 id、配对结论、目标路径与状态。
 *
 * @param input - 表单输入。
 * @param roots - 写盘根。
 * @returns 界面要显示的一切；不合法时抛 {@link VoicePackError}。
 */
export function previewVoicePack(input: VoicePackInput, roots: VoicePackRoots): VoicePackPreview {
  const checked = validateInput(input, roots);
  const suggestedId = idOfWeightPath(checked.weightPath);
  const pair = findCounterpart(checked.weightPath, input.counterpartPath.trim());
  const versions: { gpt?: string; sovits?: string } = {};
  if (checked.kind === 'gpt') {
    versions.gpt = versionOfWeightPath(checked.weightPath);
    if (pair.path) versions.sovits = pair.version ?? versionOfWeightPath(pair.path);
  } else {
    versions.sovits = versionOfWeightPath(checked.weightPath);
    if (pair.path) versions.gpt = pair.version ?? versionOfWeightPath(pair.path);
  }

  const warnings: string[] = [];
  if (pair.status === 'unpaired') {
    warnings.push(
      `只有一侧权重（${checked.kind === 'gpt' ? 'GPT' : 'SoVITS'}）：导入后这个音色会置灰，补齐另一侧再导一次`,
    );
  }
  const mismatch = versionWarning(versions.gpt, versions.sovits);
  if (mismatch) warnings.push(mismatch);
  if (checked.id !== suggestedId) warnings.push(`音色 id「${checked.id}」与权重文件名推出的「${suggestedId}」不同`);
  if (pair.path !== undefined && idOfWeightPath(pair.path) !== checked.id) {
    warnings.push(`另一侧权重的文件名 id「${idOfWeightPath(pair.path)}」与音色 id 不同，请确认选对了文件`);
  }
  if (checked.text === '') warnings.push('参考文本为空：按零样本合成，音质会降一档');

  const targets = targetsOf(roots, checked.id, checked.refAudioPath);
  const weights = weightPlansOf(input, checked.weightPath, checked.kind, pair.path, targets.targetDir);
  if (input.placement === 'copy') {
    const total = weights.reduce((sum, plan) => sum + (plan.bytes ?? 0), 0);
    warnings.push(`复制会把权重再存一份（约 ${humanSize(total)}），原文件不会删`);
  }
  for (const plan of weights) {
    if (plan.action !== 'hardlink' && plan.action !== 'copy') continue;
    if (existsSync(plan.target) && !input.overwrite)
      warnings.push(`目录里已有 ${basename(plan.target)}：不会覆盖，沿用现有文件`);
    // 权重被改名/换 id 时最容易被扫成「另一个音色」，先提醒一次。
    if (idOfWeightPath(plan.target) !== checked.id) {
      warnings.push('权重文件名推出来的 id 与音色 id 不同：放进目录后可能被扫成另一个音色');
    }
  }

  // 「已存在」不能只看新扩展名：目录里可能已经有 ref.mp3，换个格式再导入会变成两套参考。
  const existingAudio = listFiles(targets.targetDir).filter(
    (name) => AUDIO_EXTENSIONS.includes(extname(name).toLowerCase()) && /^ref\b/i.test(name),
  );
  const audioExists = existingAudio.length > 0 || existsSync(targets.targetAudioPath);
  const textExists = existsSync(targets.targetTextPath);
  const exists = audioExists || textExists;
  const status = !exists ? 'new' : input.overwrite ? 'overwrite' : 'skip';
  // 参考已存在也允许「只补权重」（硬链接/复制是增量动作）；真的无事可做才关掉导入按钮。
  const weightsPending = weights.some(
    (plan) => (plan.action === 'hardlink' || plan.action === 'copy') && (input.overwrite || !existsSync(plan.target)),
  );
  const pending = status !== 'skip' || weightsPending;
  return {
    suggestedId,
    id: checked.id,
    kind: checked.kind,
    pair,
    versions,
    warnings,
    ...targets,
    weights,
    placement: input.placement,
    pending,
    status,
  };
}

/** 把已存在的文件改名备份；返回备份路径（不存在时 undefined）。 */
async function backupIfExists(file: string, stamp: string): Promise<string | undefined> {
  if (!existsSync(file)) return undefined;
  const backup = `${file}.bak-${stamp}`;
  await rename(file, backup);
  return toPosixPath(backup);
}

/** 写参考文本：空文本不落文件（扫描器按零样本处理）。 */
async function writeRefText(file: string, text: string): Promise<void> {
  if (text === '') return;
  await writeFile(file, text + '\n', 'utf8');
}

/**
 * 落地一个音色：复制参考音频与文本，按 {@link VoicePackPlacement} 放权重，覆盖前备份。
 *
 * 参考音频已存在且没允许覆盖时，**只补权重**不碰参考——硬链接/复制是增量动作，
 * 用户常常只是想把「还不完整」的音色补齐，不该被一条「已存在」拦下来。
 *
 * @param input - 表单输入。
 * @param roots - 写盘根。
 * @param now - 时间戳（测试注入）；默认当前时间。
 * @returns 写入结果；无事可做时 `skipped` 且不写盘。
 * @throws {VoicePackError} 校验失败，或复制/硬链接权重失败。
 */
export async function applyVoicePack(
  input: VoicePackInput,
  roots: VoicePackRoots,
  now = new Date(),
): Promise<VoicePackApplyResult> {
  const preview = previewVoicePack(input, roots);
  if (!preview.pending) {
    return { status: 'skipped', id: preview.id, targetDir: preview.targetDir, placed: [], notes: [], backups: [] };
  }
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const backups: string[] = [];
  const notes: string[] = [];
  const placed: string[] = [];
  const checked = validateInput(input, roots);
  const targets = targetsOf(roots, checked.id, checked.refAudioPath);
  await mkdir(targets.targetDir, { recursive: true });

  // 覆盖：把目标目录里已有的参考（含别的扩展名的 ref.*）与文本备份，避免扫描器命中旧嗓子
  if (input.overwrite) {
    const existing = listFiles(targets.targetDir).filter(
      (name) => /^ref\.[^.]+$/i.test(name) && AUDIO_EXTENSIONS.includes(extname(name).toLowerCase()),
    );
    for (const name of existing) {
      const backup = await backupIfExists(join(targets.targetDir, name), stamp);
      if (backup) backups.push(backup);
    }
    const textBackup = await backupIfExists(targets.targetTextPath, stamp);
    if (textBackup) backups.push(textBackup);
  }

  if (preview.status !== 'skip') {
    await copyFile(checked.refAudioPath, targets.targetAudioPath);
    await writeRefText(targets.targetTextPath, checked.text);
  }

  /**
   * 权重摆放。目录里已经有同名文件时：允许覆盖就备份后重放，否则沿用现有那份（不悄悄换掉用户的文件）。
   * 硬链接跨盘会失败——这里**直接报错**而不是退回指针：指针那套已经不做了，糊过去只会让人以为搬成功了。
   */
  for (const plan of preview.weights) {
    if (plan.action !== 'hardlink' && plan.action !== 'copy') continue;
    if (existsSync(plan.target) && !input.overwrite) {
      notes.push(`目录里已有 ${basename(plan.target)}：沿用现有文件（勾「覆盖」可换成这次选的那份）`);
      continue;
    }
    if (existsSync(plan.target)) {
      const backup = await backupIfExists(plan.target, stamp);
      if (backup) backups.push(backup);
    }
    try {
      if (plan.action === 'hardlink') await link(plan.source, plan.target);
      else await copyFile(plan.source, plan.target);
      placed.push(plan.target);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new VoicePackError(
        plan.action === 'copy'
          ? `复制权重失败：${reason}`
          : `硬链接失败（${reason}）：跨盘或文件系统不支持硬链接，改用「复制」`,
      );
    }
  }

  return {
    status: 'written',
    id: checked.id,
    targetDir: targets.targetDir,
    audioPath: targets.targetAudioPath,
    ...(checked.text === '' ? {} : { textPath: targets.targetTextPath }),
    placed,
    notes,
    backups,
  };
}

// ───────────────────────────── 导入流程：发现 → 提案 → 批量落地 ─────────────────────────────

/** 一次「选根」的发现结果：两侧权重目录清单。 */
export interface WeightDiscovery {
  /** 归一后的根（选了 `GPT_weights_v2` 这种子目录时，是它的父目录）。 */
  readonly root: string;
  readonly gptDirs: readonly string[];
  readonly sovitsDirs: readonly string[];
  readonly notes: readonly string[];
}

/**
 * 选来的目录 → 两侧权重目录清单。
 *
 * 规则：选了父目录就展开 `GPT_weights*` / `SoVITS_weights*` 子目录；选中的本身就是那种子目录时先上提一级
 * （用户点进 `GPT_weights_v2` 才想起该选外面，不该逼他退回去）。一个子目录都没有、但所选目录里直接放着
 * 权重时，把该目录同时当两侧来源——手检出来的零散权重也能导。
 *
 * @param root - 用户选中的目录（绝对路径）。
 * @returns 两侧目录与说明；一份权重都没发现时两侧都是空数组。
 * @throws {VoicePackError} 目录不存在。
 */
export function discoverWeightRoots(root: string): WeightDiscovery {
  const given = root.trim();
  if (given === '') throw new VoicePackError('请先选一个目录（GPT_weights 与 SoVITS_weights 所在的那一层）');
  if (!isDir(given)) throw new VoicePackError(`目录不存在：${given}`);
  const notes: string[] = [];
  const base = WEIGHT_DIR_PATTERN.test(basename(given.replace(/[\\/]+$/, ''))) ? dirname(given) : given;
  if (base !== given) notes.push(`已按 ${basename(base)} 这一层展开（选中项是权重子目录本身）`);

  const subs = listDirs(base);
  const gptDirs = subs.filter((name) => GPT_DIR_PATTERN.test(name)).map((name) => toPosixPath(join(base, name)));
  const sovitsDirs = subs.filter((name) => SOVITS_DIR_PATTERN.test(name)).map((name) => toPosixPath(join(base, name)));

  const direct = listFiles(base).map((name) => extname(name).toLowerCase());
  const directGpt = direct.filter((ext) => ext === '.ckpt').length;
  const directSovits = direct.filter((ext) => ext === '.pth').length;
  if (gptDirs.length === 0 && directGpt > 0) {
    gptDirs.push(toPosixPath(base));
    notes.push('没有 GPT_weights* 子目录：直接用所选目录里的 .ckpt');
  }
  if (sovitsDirs.length === 0 && directSovits > 0) {
    sovitsDirs.push(toPosixPath(base));
    notes.push('没有 SoVITS_weights* 子目录：直接用所选目录里的 .pth');
  }
  if (gptDirs.length === 0 && sovitsDirs.length === 0) {
    notes.push('这个目录下没有 GPT_weights* / SoVITS_weights* 子目录，也没有 .ckpt / .pth 文件');
  }
  return { root: toPosixPath(base), gptDirs, sovitsDirs, notes };
}

/** 一条待导入的音色（导入弹窗的一行）。 */
export interface WeightImportCandidate {
  /** 建议的 id（权重文件名推出；也可能是归一后与目录名不同的那个）。 */
  readonly id: string;
  /** GPT 侧全部候选（新到旧）：默认选第一个。 */
  readonly gptFiles: readonly string[];
  /** SoVITS 侧全部候选（新到旧）。 */
  readonly sovitsFiles: readonly string[];
  /** 默认选中的 GPT（没有就是 undefined）。 */
  readonly gptPath?: string;
  readonly sovitsPath?: string;
  /** 两侧权重合计字节（复制提示用）。 */
  readonly bytes: number;
  /** 与音色包目录是否同盘（决定「引用」能不能选）。 */
  readonly linkable: boolean;
  /** 音色包目录里已经有这个 id 的文件夹。 */
  readonly installed: boolean;
  readonly warnings: readonly string[];
}

/** 一次导入提案（`mode: 'weights'` 的结果）。 */
export interface WeightImportScan {
  readonly root: string;
  readonly gptDirs: readonly string[];
  readonly sovitsDirs: readonly string[];
  readonly voicesDir: string;
  readonly candidates: readonly WeightImportCandidate[];
  /** 音色包目录里已经有的（= `installed` 的条数）。 */
  readonly adopted: number;
  readonly notes: readonly string[];
}

/**
 * 把两侧目录里的权重按 id 配对成一组待导入项。
 *
 * id 从文件名推（`klee-gsv-e10.ckpt` → `klee`）；同一 id 的多份文件按 `pairWeightsOf` 排序，
 * 默认取最优那一对，其余作为候选带回界面（多 epoch 时用户可能想挑早一点的那份）。
 *
 * @param dirs - {@link discoverWeightRoots} 的结果。
 * @param settings - 连接配置（只用 `voicesDir`）。
 * @returns 逐行候选、已存在数量与诊断。
 */
export function proposeImports(dirs: WeightDiscovery, settings: GsvSettings): WeightImportScan {
  const notes = [...dirs.notes];
  const voicesDir = settings.voicesDir;
  const gptById = new Map<string, string[]>();
  const sovitsById = new Map<string, string[]>();
  /** 文件名推不出合法 id 的一律跳过：它会变成目录名，不能带路径分隔符。 */
  const push = (table: Map<string, string[]>, file: string): void => {
    const id = idOfWeightPath(file);
    if (!ID_PATTERN.test(id)) {
      notes.push(`跳过文件名认不出音色的权重：${basename(file)}`);
      return;
    }
    const bucket = table.get(id);
    if (bucket) bucket.push(toPosixPath(file));
    else table.set(id, [toPosixPath(file)]);
  };
  for (const dir of dirs.gptDirs) {
    for (const name of listFiles(dir)) if (extname(name).toLowerCase() === '.ckpt') push(gptById, join(dir, name));
  }
  for (const dir of dirs.sovitsDirs) {
    for (const name of listFiles(dir)) if (extname(name).toLowerCase() === '.pth') push(sovitsById, join(dir, name));
  }

  const ids = [...new Set([...gptById.keys(), ...sovitsById.keys()])].sort();
  const candidates: WeightImportCandidate[] = [];
  for (const id of ids) {
    const gptFiles = gptById.get(id) ?? [];
    const sovitsFiles = sovitsById.get(id) ?? [];
    const pair = pairWeightsOf(gptFiles, sovitsFiles);
    const paths = [pair.gpt, pair.sovits].filter((path): path is string => path !== undefined);
    if (paths.length === 0) continue;
    const warnings: string[] = [];
    if (pair.mismatch)
      warnings.push(`GPT 与 SoVITS 版本不一致（${pair.gptVersion ?? ''} / ${pair.sovitsVersion ?? ''}），加载可能失败`);
    const bytes = paths.reduce((sum, path) => sum + (sizeOf(path) ?? 0), 0);
    const installed = voicesDir !== '' && isDir(join(voicesDir, id));
    // 引用（硬链接）要求两侧权重都与音色包目录同盘。
    const linkable = voicesDir !== '' && paths.every((path) => sameVolumeOf(path, voicesDir));
    if (!linkable && voicesDir !== '') {
      warnings.push(`权重与音色包目录不在同一个分区：不能「引用」，只能复制（约 ${humanSize(bytes)}）`);
    }
    if (installed) warnings.push('音色包目录里已有同名文件夹：不勾「覆盖」时只会补缺的文件');
    candidates.push({
      id,
      gptFiles: gptFiles.sort(),
      sovitsFiles: sovitsFiles.sort(),
      ...(pair.gpt === undefined ? {} : { gptPath: pair.gpt }),
      ...(pair.sovits === undefined ? {} : { sovitsPath: pair.sovits }),
      bytes,
      linkable,
      installed,
      warnings,
    });
  }

  const adopted = candidates.filter((candidate) => candidate.installed).length;
  notes.push(`找到 ${ids.length} 个音色（${candidates.length} 个可导入），其中 ${adopted} 个已在音色包目录里`);
  return {
    root: dirs.root,
    gptDirs: dirs.gptDirs,
    sovitsDirs: dirs.sovitsDirs,
    voicesDir,
    candidates,
    adopted,
    notes,
  };
}

/** 批量落地结果：`results` 与输入同序（某条直接抛错时那一位是 undefined，原因在 `errors` 里）。 */
export interface VoicePackBatchResult {
  readonly results: readonly (VoicePackApplyResult | undefined)[];
  readonly errors: readonly { readonly index: number; readonly id?: string; readonly message: string }[];
}

/**
 * 批量落地：逐条执行，单条失败不中断其它条。
 *
 * 为什么串行：两条同时往同一个 `<id>/` 里造硬链接会互相抢 `mkdir`/备份名，而导入本来就是
 * 一个人点一次的低频动作，快慢不在这一点上。
 *
 * @param inputs - 逐条输入（顺序即结果顺序）。
 * @param roots - 写盘根。
 * @param now - 时间戳（所有条共用，备份名才一致）；默认当前时间。
 * @returns 结果数组与错误清单。
 */
export async function applyVoicePacks(
  inputs: readonly VoicePackInput[],
  roots: VoicePackRoots,
  now = new Date(),
): Promise<VoicePackBatchResult> {
  const results: (VoicePackApplyResult | undefined)[] = [];
  const errors: { index: number; id?: string; message: string }[] = [];
  for (const [index, input] of inputs.entries()) {
    try {
      results.push(await applyVoicePack(input, roots, now));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const id = input.id.trim();
      errors.push({ index, ...(id === '' ? {} : { id }), message });
      results.push(undefined);
    }
  }
  return { results, errors };
}
