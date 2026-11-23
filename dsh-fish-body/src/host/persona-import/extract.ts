/**
 * 文档抽取：把用户选的 `md / txt / json / png 卡 / docx` 变成「文件名 + 正文（+ 可能的 8 字段）」。
 *
 * 只读入参、不写盘、不调 LLM；类型判定按「扩展名 + 魔数」双判，二进制当文本是最贵的一类错误，
 * 所以 `.doc`、无 `chara` 块的 PNG、其它未知后缀一律 `unsupported` 并给可读原因。
 * `mammoth` 只在本模块出现（纯 JS，无原生模块）。
 * @module dsh-fish-body/src/host/persona-import/extract
 */
import mammoth from 'mammoth';
import { parseCardBytes, type CharaCardData } from '../persona-source/card-reader.ts';

/** 一次导入最多几个文件。 */
export const MAX_IMPORT_FILES = 5;
/** 单文件解码后上限（与头像上传同一口径：768 KiB）。 */
export const MAX_IMPORT_FILE_BYTES = 768 * 1024;
/** 全部文件解码后合计上限（与客户端同值：768 KiB − 4 KiB，给 base64 与 JSON 包装留余量）。 */
export const MAX_IMPORT_TOTAL_BYTES = 768 * 1024 - 4096;
/** docx 解压闸门：条目数与解压后总量（mammoth 之前先看，超大包直接拒）。 */
export const DOCX_MAX_ENTRIES = 512;
export const DOCX_MAX_UNCOMPRESSED_BYTES = 8 * 1024 * 1024;

/** 请求里的一个文件（base64 文本；宿主请求体统一按 utf8 解码，二进制走 base64）。 */
export interface ImportFileInput {
  readonly name: string;
  readonly base64: string;
}

/** 支持的来源类型。 */
export type ImportFileKind = 'md' | 'txt' | 'json' | 'png' | 'docx';

/** 抽取出来的一个文件。 */
export interface ExtractedFile {
  readonly name: string;
  readonly kind: ImportFileKind;
  /** 已去 BOM / 折叠空行的正文。 */
  readonly text: string;
  /** 直接命中 `chara_card_v2` 时的 8 字段（命中即跳过 LLM）。 */
  readonly card?: CharaCardData;
  readonly chars: number;
}

/** 抽取结果。 */
export type ExtractOutcome =
  | { ok: true; files: ExtractedFile[] }
  | {
      ok: false;
      reason: 'bad-request' | 'too-many-items' | 'payload-too-large' | 'unsupported' | 'extract-failed';
      message: string;
    };

/** `.doc` 与未知后缀共用的可读提示。 */
const UNSUPPORTED_HINT = '老式 .doc 不支持，请另存为 .docx 或直接粘贴文本';

/** PNG 8 字节签名。 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** 判定 PNG（8 字节签名）。 */
function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/** 判定 ZIP（docx 的容器魔数）。 */
function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** 取小写扩展名（不含点）。 */
function extOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match === null ? '' : match[1].toLowerCase();
}

/** UTF-8 解码并清掉 BOM 与 3+ 连续空行（多份文档拼在一起时不至于中间空一大片）。 */
function cleanText(text: string): string {
  return text
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/** base64 → 字节；空串或不规范输入返回 undefined。 */
function decodeBase64(value: string): Uint8Array | undefined {
  if (value === '') return undefined;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0) return undefined;
  return bytes;
}

/** PNG 卡：只认 `tEXt` 的 `chara` 块（不做 OCR）。 */
function extractPng(name: string, bytes: Uint8Array): ExtractOutcome {
  const card = parseCardBytes(bytes);
  if (card === undefined) {
    return {
      ok: false,
      reason: 'unsupported',
      message: `${name}：这张图片里没有人设卡数据（只认 SillyTavern 的 chara 块）`,
    };
  }
  const text = cleanText(card.description);
  return { ok: true, files: [{ name, kind: 'png', text, card, chars: text.length }] };
}

/** JSON：v2 卡直接用字段，其它 JSON 按纯文本喂后续结构化。 */
function extractJson(name: string, bytes: Uint8Array): ExtractOutcome {
  const raw = cleanText(new TextDecoder().decode(bytes));
  const card = parseCardBytes(bytes);
  if (card !== undefined) {
    return { ok: true, files: [{ name, kind: 'json', text: raw, card, chars: raw.length }] };
  }
  return { ok: true, files: [{ name, kind: 'json', text: raw, chars: raw.length }] };
}

/** 纯文本（md / txt）。 */
function extractText(name: string, kind: 'md' | 'txt', bytes: Uint8Array): ExtractOutcome {
  const text = cleanText(new TextDecoder().decode(bytes));
  return { ok: true, files: [{ name, kind, text, chars: text.length }] };
}

/**
 * 读 ZIP 的中央目录，返回条目数与「解压后总大小」。
 *
 * 只读目录，不解压：mammoth 之前就能判断一个包是不是炸弹。EOCD 里出现 ZIP64 标记
 * （0xFFFF / 0xFFFFFFFF）时按「超限」处理——真实 docx 用不到 ZIP64。
 *
 * @param bytes - 整个 zip 字节。
 * @returns 统计；结构不合法返回 null。
 */
export function zipStats(bytes: Uint8Array): { entries: number; uncompressedBytes: number; zip64: boolean } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocd = 22;
  if (bytes.length < minEocd) return null;
  let eocd = -1;
  const stop = Math.max(0, bytes.length - minEocd - 0xffff);
  for (let i = bytes.length - minEocd; i >= stop; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  const offset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    return { entries: 0xffff, uncompressedBytes: 0xffffffff, zip64: true };
  }
  let cursor = offset;
  let total = 0;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) return null;
    const uncompressed = view.getUint32(cursor + 24, true);
    if (uncompressed === 0xffffffff) return { entries, uncompressedBytes: 0xffffffff, zip64: true };
    total += uncompressed;
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, uncompressedBytes: total, zip64: false };
}

/** docx：mammoth 取纯文本（不含样式、表格按行拼接）。 */
async function extractDocx(name: string, bytes: Uint8Array): Promise<ExtractOutcome> {
  if (!isZip(bytes)) {
    return { ok: false, reason: 'unsupported', message: `${name}：不是有效的 .docx（zip 容器）文件` };
  }
  // 解压闸门：mammoth 之前先看目录。超过条目数或解压总量直接拒，不做任何解压。
  const stats = zipStats(bytes);
  if (stats === null) {
    return { ok: false, reason: 'extract-failed', message: `${name}：zip 目录读不出来（文件可能已损坏）` };
  }
  if (stats.zip64 || stats.entries > DOCX_MAX_ENTRIES || stats.uncompressedBytes > DOCX_MAX_UNCOMPRESSED_BYTES) {
    return {
      ok: false,
      reason: 'extract-failed',
      message: `${name}：解压后超过上限（条目 ${stats.entries} / 上限 ${DOCX_MAX_ENTRIES}，解压后 ${stats.uncompressedBytes} 字节 / 上限 ${DOCX_MAX_UNCOMPRESSED_BYTES}）`,
    };
  }
  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    const text = cleanText(result.value);
    return { ok: true, files: [{ name, kind: 'docx', text, chars: text.length }] };
  } catch (e) {
    return {
      ok: false,
      reason: 'extract-failed',
      message: `${name}：解析失败（${e instanceof Error ? e.message : String(e)}）`,
    };
  }
}

/**
 * 抽取一份文件。
 *
 * @param file - 文件名与 base64 内容。
 * @returns 抽取结果；不支持的格式给 `unsupported`，内容为空给 `extract-failed`。
 */
async function extractOne(file: ImportFileInput): Promise<ExtractOutcome> {
  const name = file.name.trim() || '未命名文件';
  const bytes = decodeBase64(file.base64);
  if (bytes === undefined) return { ok: false, reason: 'bad-request', message: `${name}：内容不是合法的 base64` };
  if (bytes.length > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, reason: 'payload-too-large', message: `${name} 超过 768 KiB（解码后）` };
  }
  const ext = extOf(name);
  let outcome: ExtractOutcome;
  if (ext === 'doc') return { ok: false, reason: 'unsupported', message: `${name}：${UNSUPPORTED_HINT}` };
  if (ext === 'docx') return extractDocx(name, bytes);
  if (ext === 'png' || isPng(bytes)) outcome = extractPng(name, bytes);
  else if (ext === 'json') outcome = extractJson(name, bytes);
  else if (ext === 'md' || ext === 'txt') outcome = extractText(name, ext, bytes);
  else {
    return {
      ok: false,
      reason: 'unsupported',
      message: `${name}：不支持的文件类型${ext === '' ? '' : '（.' + ext + '）'}`,
    };
  }
  if (!outcome.ok) return outcome;
  if (outcome.files.every((item) => item.text.trim() === '' && item.card === undefined)) {
    return { ok: false, reason: 'extract-failed', message: `${name}：没有读到任何文本` };
  }
  return outcome;
}

/**
 * 抽取一批文件（≤5 个、单文件 ≤768 KiB、合计 ≤768 KiB）。
 *
 * @param files - 请求里的文件列表。
 * @returns 全部文件的抽取结果；任一文件失败即整体失败（给可读原因，不静默丢）。
 */
export async function extractDocuments(files: readonly ImportFileInput[]): Promise<ExtractOutcome> {
  if (files.length === 0) return { ok: false, reason: 'bad-request', message: '至少选择一个文件' };
  if (files.length > MAX_IMPORT_FILES) {
    return { ok: false, reason: 'too-many-items', message: `一次最多 ${MAX_IMPORT_FILES} 个文件` };
  }
  const out: ExtractedFile[] = [];
  let total = 0;
  for (const file of files) {
    const bytes = decodeBase64(file.base64);
    total += bytes?.length ?? 0;
    if (total > MAX_IMPORT_TOTAL_BYTES) {
      return {
        ok: false,
        reason: 'payload-too-large',
        message: `全部文件合计超过 768 KiB − 4 KiB（解码后；4 KiB 是 base64 与 JSON 包装的预留）`,
      };
    }
    const one = await extractOne(file);
    if (!one.ok) return one;
    out.push(...one.files);
  }
  return { ok: true, files: out };
}
