/**
 * `/voice/voice-pack` 与 `/voice/text-lines` 的客户端视图：把宿主返回的网络数据解析成
 * 「界面要显示的形状」。
 *
 * 为什么单独一份：客户端产物不该 import 宿主模块；而这是**网络数据**，字段可能缺席或类型不对，
 * 必须先按「可能不存在」解析再用。只做解析，不发请求、不缓存。
 * @module dsh-fish-body/src/shared/voice-pack
 */

/** 配对状态。 */
export type PairStatusView = 'matched' | 'missing' | 'unpaired';

/** 权重进音色目录的方式（与宿主同名同义）。 */
export type PlacementView = 'hardlink' | 'copy';

/** 一个权重候选。 */
export interface WeightCandidateView {
  readonly path: string;
  readonly version: string;
}

/** 配对结论。 */
export interface PairView {
  readonly status: PairStatusView;
  readonly path?: string;
  readonly version?: string;
  readonly candidates: readonly WeightCandidateView[];
}

/** 一份权重的去向。 */
export interface WeightPlanView {
  readonly kind: 'gpt' | 'sovits';
  readonly source: string;
  readonly target: string;
  readonly action: 'inside' | 'hardlink' | 'copy';
  readonly bytes?: number;
}

/** 预览结果（界面显示用）。 */
export interface VoicePackPreviewView {
  readonly suggestedId: string;
  readonly id: string;
  readonly kind: 'gpt' | 'sovits';
  readonly pair: PairView;
  readonly versions: { readonly gpt?: string; readonly sovits?: string };
  readonly warnings: readonly string[];
  readonly targetDir: string;
  readonly targetAudioPath: string;
  readonly targetTextPath: string;
  readonly weights: readonly WeightPlanView[];
  readonly placement: PlacementView;
  /** 有没有要写的东西；`false` 时导入按钮应当禁用。 */
  readonly pending: boolean;
  readonly status: 'new' | 'overwrite' | 'skip';
}

/** 落地结果。 */
export interface VoicePackApplyView {
  readonly status: 'written' | 'skipped';
  readonly id: string;
  readonly targetDir: string;
  readonly audioPath?: string;
  readonly textPath?: string;
  readonly placed: readonly string[];
  readonly notes: readonly string[];
  readonly backups: readonly string[];
}

/** 逐条失败（批量预检 / 批量落地的 `errors`）。 */
export interface PackErrorView {
  readonly index: number;
  readonly id?: string;
  readonly message: string;
}

/** 一条待导入的音色（`mode: 'weights'` 的一行）。 */
export interface WeightImportCandidateView {
  readonly id: string;
  /** GPT 侧全部候选（新到旧）。 */
  readonly gptFiles: readonly string[];
  readonly sovitsFiles: readonly string[];
  readonly gptPath?: string;
  readonly sovitsPath?: string;
  readonly bytes: number;
  /** 与音色包目录同盘（决定「引用」能不能选）。 */
  readonly linkable: boolean;
  readonly installed: boolean;
  readonly warnings: readonly string[];
}

/** 一次导入提案。 */
export interface WeightImportScanView {
  readonly root: string;
  readonly gptDirs: readonly string[];
  readonly sovitsDirs: readonly string[];
  readonly voicesDir: string;
  readonly candidates: readonly WeightImportCandidateView[];
  readonly adopted: number;
  readonly notes: readonly string[];
}

/** 文本文件里的一行候选。 */
export interface TextLineView {
  readonly index: number;
  readonly text: string;
}

/** 取对象；非对象返回 undefined。 */
function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** 取字符串；非字符串返回空串。 */
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 取有限数字；否则 0。 */
function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** 取字符串数组（丢掉空项）。 */
function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => str(item)).filter((item) => item !== '') : [];
}

/** 解析候选权重。 */
function parseCandidate(raw: unknown): WeightCandidateView | undefined {
  const entry = obj(raw);
  if (!entry) return undefined;
  const path = str(entry.path);
  if (path === '') return undefined;
  return { path, version: str(entry.version) };
}

/** 解析配对结论。 */
function parsePair(raw: unknown): PairView {
  const entry = obj(raw);
  const status = str(entry?.status);
  const pairStatus: PairStatusView = status === 'matched' || status === 'unpaired' ? status : 'missing';
  const candidates = Array.isArray(entry?.candidates)
    ? entry.candidates.map(parseCandidate).filter((item): item is WeightCandidateView => item !== undefined)
    : [];
  return {
    status: pairStatus,
    ...(str(entry?.path) === '' ? {} : { path: str(entry?.path) }),
    ...(str(entry?.version) === '' ? {} : { version: str(entry?.version) }),
    candidates,
  };
}

/** 解析权重去向。 */
function parsePlan(raw: unknown): WeightPlanView | undefined {
  const entry = obj(raw);
  if (!entry) return undefined;
  const source = str(entry.source);
  const target = str(entry.target);
  if (source === '' || target === '') return undefined;
  const action = str(entry.action);
  const planAction = action === 'inside' || action === 'copy' ? action : 'hardlink';
  const bytes = typeof entry.bytes === 'number' && Number.isFinite(entry.bytes) ? entry.bytes : undefined;
  return {
    kind: str(entry.kind) === 'sovits' ? 'sovits' : 'gpt',
    source,
    target,
    action: planAction,
    ...(bytes === undefined ? {} : { bytes }),
  };
}

/** 解析错误清单。 */
function parseErrors(raw: unknown): PackErrorView[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): PackErrorView[] => {
    const entry = obj(item);
    const message = str(entry?.message);
    if (!entry || message === '') return [];
    return [{ index: num(entry.index), ...(str(entry.id) === '' ? {} : { id: str(entry.id) }), message }];
  });
}

/**
 * 解析预览响应里的 `previews` + `errors`（`mode: 'plan'`）。
 *
 * @param raw - 网络响应体。
 * @returns 与 `items` 同序的预览（不合法或该条报错时是 `null`）与逐条错误。
 */
export function readVoicePackPreviews(raw: unknown): {
  previews: (VoicePackPreviewView | null)[];
  errors: PackErrorView[];
} {
  const entry = obj(raw);
  if (!entry) return { previews: [], errors: [] };
  const previews = Array.isArray(entry.previews) ? entry.previews.map((item) => readVoicePackPreview(item)) : [];
  return { previews, errors: parseErrors(entry.errors) };
}

/**
 * 解析单条预览。导出是因为落单条时也会用到同一份形状。
 *
 * @param raw - 网络值（任意）。
 * @returns 合法视图；不是对象或缺关键字段时 `null`（界面保留上一次结果并显示错误）。
 */
export function readVoicePackPreview(raw: unknown): VoicePackPreviewView | null {
  const entry = obj(raw);
  if (!entry) return null;
  const id = str(entry.id);
  const targetDir = str(entry.targetDir);
  if (id === '' || targetDir === '') return null;
  const versions = obj(entry.versions) ?? {};
  const status = str(entry.status);
  const placement = str(entry.placement);
  const weights = Array.isArray(entry.weights)
    ? entry.weights.map(parsePlan).filter((item): item is WeightPlanView => item !== undefined)
    : [];
  return {
    suggestedId: str(entry.suggestedId) || id,
    id,
    kind: str(entry.kind) === 'sovits' ? 'sovits' : 'gpt',
    pair: parsePair(entry.pair),
    versions: {
      ...(str(versions.gpt) === '' ? {} : { gpt: str(versions.gpt) }),
      ...(str(versions.sovits) === '' ? {} : { sovits: str(versions.sovits) }),
    },
    warnings: strList(entry.warnings),
    targetDir,
    targetAudioPath: str(entry.targetAudioPath),
    targetTextPath: str(entry.targetTextPath),
    weights,
    placement: placement === 'copy' ? 'copy' : 'hardlink',
    pending: entry.pending !== false,
    status: status === 'overwrite' || status === 'skip' ? status : 'new',
  };
}

/**
 * 解析落地结果。
 *
 * @param raw - 网络值。
 * @returns 结果视图；不是对象或缺关键字段时 `null`。
 */
export function readVoicePackApply(raw: unknown): VoicePackApplyView | null {
  const entry = obj(raw);
  if (!entry) return null;
  const status = str(entry.status);
  const id = str(entry.id);
  if (id === '' || (status !== 'written' && status !== 'skipped')) return null;
  return {
    status,
    id,
    targetDir: str(entry.targetDir),
    ...(str(entry.audioPath) === '' ? {} : { audioPath: str(entry.audioPath) }),
    ...(str(entry.textPath) === '' ? {} : { textPath: str(entry.textPath) }),
    placed: strList(entry.placed),
    notes: strList(entry.notes),
    backups: strList(entry.backups),
  };
}

/**
 * 解析批量落地响应（`mode: 'apply'`）。
 *
 * @param raw - 网络响应体。
 * @returns 与 `items` 同序的结果（失败那条是 `null`）与逐条错误。
 */
export function readVoicePackBatch(raw: unknown): {
  results: (VoicePackApplyView | null)[];
  errors: PackErrorView[];
} {
  const entry = obj(raw);
  if (!entry) return { results: [], errors: [] };
  const results = Array.isArray(entry.results) ? entry.results.map((item) => readVoicePackApply(item)) : [];
  return { results, errors: parseErrors(entry.errors) };
}

/**
 * 解析一条导入候选。
 *
 * @param raw - 网络值。
 * @returns 合法候选；缺 id 时 undefined。
 */
function parseImportCandidate(raw: unknown): WeightImportCandidateView | undefined {
  const entry = obj(raw);
  if (!entry) return undefined;
  const id = str(entry.id);
  if (id === '') return undefined;
  return {
    id,
    gptFiles: strList(entry.gptFiles),
    sovitsFiles: strList(entry.sovitsFiles),
    ...(str(entry.gptPath) === '' ? {} : { gptPath: str(entry.gptPath) }),
    ...(str(entry.sovitsPath) === '' ? {} : { sovitsPath: str(entry.sovitsPath) }),
    bytes: num(entry.bytes),
    linkable: entry.linkable === true,
    installed: entry.installed === true,
    warnings: strList(entry.warnings),
  };
}

/**
 * 解析导入提案（`mode: 'weights'`）。
 *
 * @param raw - 响应体的 `scan` 字段。
 * @returns 视图；不是对象时 `null`。
 */
export function readWeightImportScan(raw: unknown): WeightImportScanView | null {
  const entry = obj(raw);
  if (!entry) return null;
  const candidates = Array.isArray(entry.candidates)
    ? entry.candidates.map(parseImportCandidate).filter((item): item is WeightImportCandidateView => item !== undefined)
    : [];
  return {
    root: str(entry.root),
    gptDirs: strList(entry.gptDirs),
    sovitsDirs: strList(entry.sovitsDirs),
    voicesDir: str(entry.voicesDir),
    candidates,
    adopted: num(entry.adopted),
    notes: strList(entry.notes),
  };
}

/**
 * 解析文本行响应。
 *
 * @param raw - 网络值。
 * @returns 行清单；不是数组时为空。
 */
export function readTextLines(raw: unknown): TextLineView[] {
  const entry = obj(raw);
  const lines = entry?.lines;
  if (!Array.isArray(lines)) return [];
  return lines.flatMap((item) => {
    const line = obj(item);
    const text = str(line?.text);
    if (!line || text === '') return [];
    return [{ index: num(line.index) || 0, text }];
  });
}
