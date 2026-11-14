/**
 * 会话鱼设置：独立文件 `session-fish.json` 的读取、校验与落盘。
 *
 * 为什么不进 `main-config.jsonc`：那一份是带大量注释的 JSONC，设置页整份重写会把用户的注释与排版
 * 一起丢掉；而会话鱼是一组独立的小偏好，单独一份普通 JSON 也能被「改坏了就回落默认」兜住。
 * 读侧逐字段宽容（坏一个字段只回默认），写侧严格（未知键、类型错、越界一律拒绝），写成功后才换内存值。
 * @module dsh-fish-body/src/host/session-fish/settings
 */
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { userPaths } from '../user-layout.ts';
import {
  DEFAULT_SESSION_FISH_SETTINGS,
  isSessionFishSkinName,
  SESSION_FISH_BUBBLE_MS_MAX,
  SESSION_FISH_BUBBLE_MS_MIN,
  SESSION_FISH_MAX_COUNT_MAX,
  SESSION_FISH_MAX_COUNT_MIN,
  SESSION_FISH_PROGRESS_GAP_MS_MAX,
  SESSION_FISH_PROGRESS_GAP_MS_MIN,
  SESSION_FISH_SIZE_MAX,
  SESSION_FISH_SIZE_MIN,
  SESSION_FISH_SKIN_MAX_LEN,
  type SessionFishSettings,
} from '../../shared/session-fish.ts';

/** 文件名（放在插件数据根下，与 voice-providers.json / logs.txt 同级）。 */
export const SESSION_FISH_FILE = 'session-fish.json';

/** 设置更新结果：写入成功才换内存；失败保留旧值。 */
export type SessionFishUpdate =
  | { readonly ok: true; readonly settings: SessionFishSettings }
  | { readonly ok: false; readonly kind: 'invalid' | 'io'; readonly message: string };

/** 设置字段的规格：类型与取值范围都写在一处，校验与 UI 文案不各写一份。 */
type FieldSpec =
  | { readonly kind: 'bool' }
  | { readonly kind: 'int'; readonly min: number; readonly max: number }
  | { readonly kind: 'string'; readonly maxLen: number; readonly accept: (value: string) => boolean };

/** 每个字段的规格；键集即白名单（未知键在写路径被拒）。 */
const FIELD_SPECS: Record<keyof SessionFishSettings, FieldSpec> = {
  enabled: { kind: 'bool' },
  sizePx: { kind: 'int', min: SESSION_FISH_SIZE_MIN, max: SESSION_FISH_SIZE_MAX },
  maxCount: { kind: 'int', min: SESSION_FISH_MAX_COUNT_MIN, max: SESSION_FISH_MAX_COUNT_MAX },
  bubbleMs: { kind: 'int', min: SESSION_FISH_BUBBLE_MS_MIN, max: SESSION_FISH_BUBBLE_MS_MAX },
  // 皮肤 id 是「一个文件名」：范围与字符规则在 shared 的 isSessionFishSkinName，写侧不另写一套。
  skin: { kind: 'string', maxLen: SESSION_FISH_SKIN_MAX_LEN, accept: isSessionFishSkinName },
  followPet: { kind: 'bool' },
  speakEnabled: { kind: 'bool' },
  speakProgress: { kind: 'bool' },
  speakTurnEnd: { kind: 'bool' },
  speakWaiting: { kind: 'bool' },
  progressGapMs: { kind: 'int', min: SESSION_FISH_PROGRESS_GAP_MS_MIN, max: SESSION_FISH_PROGRESS_GAP_MS_MAX },
};

/** 字段名清单（稳定顺序，读侧与写侧共用）。 */
const FIELD_KEYS = Object.keys(FIELD_SPECS) as Array<keyof SessionFishSettings>;

/** 一个值是否符合该字段的规格。 */
function fieldValid(spec: FieldSpec, value: unknown): value is boolean | number | string {
  if (spec.kind === 'bool') return typeof value === 'boolean';
  if (spec.kind === 'string') {
    return typeof value === 'string' && value.length <= spec.maxLen && spec.accept(value);
  }
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= spec.min &&
    value <= spec.max
  );
}

/** 取对象；非对象当空对象。 */
function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * 读侧解析：逐字段校验，非法/缺失回默认；文件损坏只影响它自己那一项，不整体报错。
 *
 * @param raw - 已解析的 JSON 值（可能来自损坏文件，故接受 unknown）。
 * @returns 填满的设置在。
 */
export function parseSessionFishSettings(raw: unknown): SessionFishSettings {
  const conf = recordOf(raw);
  const out: Record<string, unknown> = { ...DEFAULT_SESSION_FISH_SETTINGS };
  for (const key of FIELD_KEYS) {
    const value = conf[key];
    if (value !== undefined && fieldValid(FIELD_SPECS[key], value)) out[key] = value;
  }
  return out as unknown as SessionFishSettings;
}

/** 写侧校验结果：全量合法值，或第一条错误。 */
export type SessionFishPatchCheck =
  | { readonly ok: true; readonly patch: Partial<SessionFishSettings> }
  | { readonly ok: false; readonly message: string };

/**
 * 写侧校验：只接受已知字段且全部合法；空对象合法（等价「不改」）。
 *
 * @param raw - 请求体（外部输入，按 unknown 逐字段收窄）。
 * @returns 校验后的 patch；未知键、非对象、类型错、越界都给出人话原因。
 */
export function checkSessionFishPatch(raw: unknown): SessionFishPatchCheck {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: 'session-fish settings must be a JSON object' };
  }
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!(FIELD_KEYS as readonly string[]).includes(key)) {
      return { ok: false, message: `unknown session-fish setting: ${key}` };
    }
  }
  const patch: Record<string, unknown> = {};
  for (const key of FIELD_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    if (!fieldValid(FIELD_SPECS[key], value)) {
      const spec = FIELD_SPECS[key];
      const range =
        spec.kind === 'int'
          ? ` (integer ${spec.min}..${spec.max})`
          : spec.kind === 'string'
            ? ` (skin name, max ${spec.maxLen} chars)`
            : ' (boolean)';
      return { ok: false, message: `invalid session-fish setting ${key}${range}` };
    }
    patch[key] = value;
  }
  return { ok: true, patch: patch as Partial<SessionFishSettings> };
}

/** 配置文件绝对路径。 */
export function sessionFishSettingsPath(userRoot: string): string {
  return userPaths(userRoot).sessionFish;
}

/**
 * 设置存储器：内存缓存 + 文件读写。
 *
 * 字段一律 declare + 构造器赋值：带初始化器的类字段在 target es2020 下会降级出
 * `@oxc-project/runtime` helper，prepack 门禁会拦下。
 */
export class SessionFishSettingsStore {
  declare private readonly file: string;
  declare private readonly log: ((message: string) => void) | undefined;
  declare private current: SessionFishSettings;
  declare private warned: boolean;

  /**
   * @param file - 配置文件路径（通常是 `<userRoot>/session-fish.json`）。
   * @param log - 可选日志出口；文件损坏时只告警一次。
   */
  constructor(file: string, log?: (message: string) => void) {
    this.file = file;
    this.log = log;
    this.current = this.readFile();
    this.warned = false;
  }

  /** 当前生效设置（内存引用稳定）。 */
  get(): SessionFishSettings {
    return this.current;
  }

  /** 重新读盘（测试 / 手工改文件后重载插件时用）。 */
  reload(): SessionFishSettings {
    this.current = this.readFile();
    return this.current;
  }

  /**
   * 校验并落盘一组 patch：写成功才更新内存，失败保持旧值。
   *
   * @param rawPatch - 请求体片段。
   * @returns 新设置，或人话失败原因。
   */
  async update(rawPatch: unknown): Promise<SessionFishUpdate> {
    const checked = checkSessionFishPatch(rawPatch);
    if (!checked.ok) return { ok: false, kind: 'invalid', message: checked.message };
    const next: SessionFishSettings = { ...this.current, ...checked.patch };
    try {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(this.file, JSON.stringify(next, null, 2) + '\n', 'utf8');
    } catch (error) {
      return { ok: false, kind: 'io', message: error instanceof Error ? error.message : String(error) };
    }
    this.current = next;
    return { ok: true, settings: next };
  }

  /** 读文件；不存在/损坏/字段非法都走默认值，并只告警一次。 */
  private readFile(): SessionFishSettings {
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      return DEFAULT_SESSION_FISH_SETTINGS; // 没写过 = 默认，不是异常
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      const conf = recordOf(parsed);
      const settings = parseSessionFishSettings(parsed);
      // 缺字段是常态（用户只写关心的几项），只有「显式写错」或「未知键」才值得告警一次。
      const hasUnknown = Object.keys(conf).some((key) => !(FIELD_KEYS as readonly string[]).includes(key));
      const hasInvalid = FIELD_KEYS.some((key) => conf[key] !== undefined && !fieldValid(FIELD_SPECS[key], conf[key]));
      if (!this.warned && (hasUnknown || hasInvalid)) {
        this.warned = true;
        this.log?.('[fish-body] session-fish.json 有未知或非法字段，已按默认值处理：' + this.file);
      }
      return settings;
    } catch {
      if (!this.warned) {
        this.warned = true;
        this.log?.('[fish-body] session-fish.json 解析失败，已按默认值处理：' + this.file);
      }
      return DEFAULT_SESSION_FISH_SETTINGS;
    }
  }
}
