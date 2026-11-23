/**
 * 设置备份的 wire 形状与形状校验（两端共用）。
 *
 * 备份 = 三份**原文**：用户主配置（JSONC，带注释）、会话鱼设置、以及每个文件宠物的种类配置。
 * 存原文而不是解析后的对象，是为了让「导出 → 恢复」不丢注释与字段顺序——用户手写的精调配置
 * 在恢复后仍然是同一份文件。内容是否合法（能否解析）由宿主判定，这里只看形状与体积。
 * 纯数据模块：不读盘、不发请求、不碰 DOM。
 * @module dsh-fish-body/src/shared/settings-backup
 */
import { isReservedAssetRoot } from './pool.ts';

/** 快照的类型标记：导入时先认这个字符串，认不出就不是本插件的备份。 */
export const SETTINGS_BACKUP_KIND = 'dsh-pet/settings-backup';

/** 当前快照版本；宿主拒绝比它更新的版本（旧插件读不懂新字段）。 */
export const SETTINGS_BACKUP_VERSION = 1;

/** 全部原文的字符数上限：宿主请求体上限 1 MiB，留足 JSON 转义与包装的余量。 */
export const SETTINGS_BACKUP_MAX_CHARS = 512 * 1024;

/** 文件宠物条目数上限：超出的多半不是设置备份，而是一份被拼坏的文件。 */
export const SETTINGS_BACKUP_MAX_PETS = 64;

/** 条目名（= 文件名前缀）长度上限，与宿主 config 的标识符上限同一口径。 */
const MAX_ENTRY_LENGTH = 64;

/** 条目名里不能出现的字符：路径分隔符与 Windows 保留符（防写盘逃出 pet/ 目录）。 */
// eslint-disable-next-line no-control-regex -- 拦的就是控制字符，去掉匹配等于放行
const UNSAFE_ENTRY = /[\\/:*?"<>|\x00-\x1f]/;

/** 三份原文。 */
export interface SettingsBackupFiles {
  /** 用户主配置原文；空串 = 这份快照拍摄时没有用户层（恢复时清掉用户配置，回落到内置默认）。 */
  readonly main: string;
  /** 会话鱼设置原文；空串 = 没有自定义（恢复时删除该文件，回落到默认设置）。 */
  readonly sessionFish: string;
  /** 文件宠物：条目名（文件名前缀）→ 该种类配置文件原文。 */
  readonly pets: Readonly<Record<string, string>>;
}

/** 一份设置备份。 */
export interface SettingsBackup {
  readonly kind: typeof SETTINGS_BACKUP_KIND;
  readonly version: typeof SETTINGS_BACKUP_VERSION;
  /** 导出时刻（ISO 字符串，仅用于展示与排障）。 */
  readonly createdAt: string;
  /** 导出方的插件版本（提示「备份比插件新」时用得到）。 */
  readonly pluginVersion: string;
  readonly files: SettingsBackupFiles;
}

/** 形状不合法时的机读原因：调用方各自翻成人话（宿主回英文，设置页回当前语言）。 */
export type BackupParseFailure =
  | { readonly reason: 'not-backup' }
  | { readonly reason: 'unsupported-version'; readonly version: number }
  | { readonly reason: 'too-large' }
  | { readonly reason: 'invalid-entry'; readonly entry: string };

/** 形状校验结果。 */
export type BackupParse =
  { readonly ok: true; readonly backup: SettingsBackup } | { readonly ok: false; readonly failure: BackupParseFailure };

/** 取对象；非对象返回 undefined。 */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * 条目名能不能当文件名前缀用。
 *
 * @param entry - 备份里的键。
 * @returns 合法时 true；空、超长、含路径字符、`.`/`..` 与资源池保留字 `pool` 都是 false。
 */
export function isBackupEntryName(entry: string): boolean {
  if (entry === '' || entry.length > MAX_ENTRY_LENGTH) return false;
  if (entry === '.' || entry === '..') return false;
  if (UNSAFE_ENTRY.test(entry)) return false;
  return !isReservedAssetRoot(entry);
}

/**
 * 校验一份备份的形状与体积。
 *
 * 只检查「能不能安全地写回磁盘」：类型标记、版本、三份原文是字符串、条目名可当路径片段用、总字符数有上限。
 * 原文本身能不能解析成配置由宿主判定——这里不解 JSONC（客户端不该带一份 JSONC 解析器）。
 *
 * @param raw - `JSON.parse` 之后的任意值（导入文件、请求体都走这里）。
 * @returns 通过时给出规范化后的备份；否则给出机读原因。
 */
export function parseSettingsBackup(raw: unknown): BackupParse {
  const body = recordOf(raw);
  if (!body || body.kind !== SETTINGS_BACKUP_KIND) return { ok: false, failure: { reason: 'not-backup' } };
  const version = body.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, failure: { reason: 'not-backup' } };
  }
  if (version > SETTINGS_BACKUP_VERSION) return { ok: false, failure: { reason: 'unsupported-version', version } };
  const files = recordOf(body.files);
  if (!files) return { ok: false, failure: { reason: 'not-backup' } };
  const main = files.main;
  const sessionFish = files.sessionFish;
  const pets = recordOf(files.pets);
  if (typeof main !== 'string' || typeof sessionFish !== 'string' || !pets) {
    return { ok: false, failure: { reason: 'not-backup' } };
  }
  const entries = Object.keys(pets);
  if (entries.length > SETTINGS_BACKUP_MAX_PETS) return { ok: false, failure: { reason: 'too-large' } };
  let total = main.length + sessionFish.length;
  if (total > SETTINGS_BACKUP_MAX_CHARS) return { ok: false, failure: { reason: 'too-large' } };
  const cleanPets: Record<string, string> = {};
  for (const entry of entries) {
    if (!isBackupEntryName(entry)) return { ok: false, failure: { reason: 'invalid-entry', entry } };
    const text = pets[entry];
    if (typeof text !== 'string') return { ok: false, failure: { reason: 'not-backup' } };
    total += text.length;
    if (total > SETTINGS_BACKUP_MAX_CHARS) return { ok: false, failure: { reason: 'too-large' } };
    cleanPets[entry] = text;
  }
  return {
    ok: true,
    backup: {
      kind: SETTINGS_BACKUP_KIND,
      version: SETTINGS_BACKUP_VERSION,
      createdAt: typeof body.createdAt === 'string' ? body.createdAt : '',
      pluginVersion: typeof body.pluginVersion === 'string' ? body.pluginVersion : '',
      files: { main, sessionFish, pets: cleanPets },
    },
  };
}
