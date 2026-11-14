/**
 * 看屏幕与避让的配置：键名、默认值、区间、时段判定与**运行期**归一化。
 *
 * 配置文件里这十二个键是**平的**（与 `confineToScreen` 同一层，用户层写一次对所有宠物生效），
 * 消费端拿到的却是嵌套的 `ScreenConfig`：宿主读合并配置算「这一拍拍不拍」，Helper 读 `/config`
 * 拍平后的 `pet.screen` 判「现在该不该躲」。两边调同一个 `screenConfigOf`，所以不可能出现
 * 「设置页夹到 30 秒，桌面端按 5 秒跑」这种两套口径。
 *
 * 必须始终成立：本模块**只夹取、不报错**——运行期拿到越界值也要能跑下去。写盘前的严格校验
 * （越界即整包拒绝）在 `host/config/screen-keys.ts`，两处不要混用同一条规则。
 * @module dsh-fish-body/src/shared/screen-config
 */

/** 识屏最短间隔（秒）：比这更密就是在烧模型费用。 */
export const SCREEN_INTERVAL_MIN = 30;
/** 识屏最长间隔（秒）：一小时一次已是「几乎不看」。 */
export const SCREEN_INTERVAL_MAX = 3600;
/** 识屏默认间隔（秒）。 */
export const SCREEN_INTERVAL_DEFAULT = 120;
/** DSH 空闲判定阈值的区间（秒）：0 = 不设阈值（只要没在跑回合就算空闲）。 */
export const SCREEN_IDLE_MIN = 0;
export const SCREEN_IDLE_MAX = 600;
/** DSH 空闲判定默认阈值（秒）。 */
export const SCREEN_IDLE_DEFAULT = 30;
/** 避让触发延迟区间（毫秒）：0 = 立刻躲。 */
export const AVOID_DELAY_MIN = 0;
export const AVOID_DELAY_MAX = 10_000;
export const AVOID_DELAY_DEFAULT = 1500;
/** 恢复延迟区间（毫秒）。 */
export const AVOID_RESTORE_MIN = 0;
export const AVOID_RESTORE_MAX = 10_000;
export const AVOID_RESTORE_DEFAULT = 800;
/** 前台轮询节拍区间（毫秒）：太密白烧 CPU，太疏躲得慢。 */
export const AVOID_POLL_MIN = 300;
export const AVOID_POLL_MAX = 5000;
export const AVOID_POLL_DEFAULT = 800;
/** 白名单条数上限与单项长度上限（字符）：防止把整份进程清单粘进来。 */
export const AVOID_APPS_MAX = 50;
export const AVOID_APP_MAX_CHARS = 64;

/** 归一化后的看屏幕 / 避让配置（运行期唯一形状）。 */
export interface ScreenConfig {
  /** 识屏总开关。 */
  readonly readEnabled: boolean;
  /** 两句最短间隔（秒）。 */
  readonly intervalSec: number;
  /** 只在 DSH 空闲时拍。 */
  readonly idleOnly: boolean;
  /** DSH 空闲判定阈值（秒）。 */
  readonly idleSec: number;
  /** 静默时段起点（`HH:MM`，空串 = 不设）。 */
  readonly quietFrom: string;
  /** 静默时段终点（`HH:MM`，空串 = 不设）。 */
  readonly quietTo: string;
  /** 全屏程序前台时躲开。 */
  readonly avoidFullscreen: boolean;
  /** 最大化（任务栏可见）也算触发。 */
  readonly avoidMaximize: boolean;
  /** 条件持续多久才躲（毫秒）。 */
  readonly avoidDelayMs: number;
  /** 条件消失后多久回来（毫秒）。 */
  readonly avoidRestoreMs: number;
  /** 前台轮询节拍（毫秒）。 */
  readonly avoidPollMs: number;
  /** 白名单程序前台时躲开。 */
  readonly avoidAppsEnabled: boolean;
  /** 白名单（`.exe` 结尾按进程名精确比，否则按窗口标题子串）。 */
  readonly avoidApps: readonly string[];
}

/** 出厂默认：识屏与避让全关——这两件事都会看你的屏幕，默认必须由用户亲手打开。 */
export const SCREEN_DEFAULTS: ScreenConfig = {
  readEnabled: false,
  intervalSec: SCREEN_INTERVAL_DEFAULT,
  idleOnly: true,
  idleSec: SCREEN_IDLE_DEFAULT,
  quietFrom: '',
  quietTo: '',
  avoidFullscreen: false,
  avoidMaximize: false,
  avoidDelayMs: AVOID_DELAY_DEFAULT,
  avoidRestoreMs: AVOID_RESTORE_DEFAULT,
  avoidPollMs: AVOID_POLL_DEFAULT,
  avoidAppsEnabled: false,
  avoidApps: [],
};

/** 配置键名（写盘用的平键）；顺序即设置页顺序，`ScreenConfig` 的字段名按映射表对应。 */
export const SCREEN_CONFIG_KEYS = [
  'screenReadEnabled',
  'screenReadIntervalSec',
  'screenReadIdleOnly',
  'screenReadIdleSec',
  'screenReadQuietFrom',
  'screenReadQuietTo',
  'avoidFullscreenEnabled',
  'avoidMaximizeEnabled',
  'avoidDelayMs',
  'avoidRestoreDelayMs',
  'avoidPollMs',
  'avoidAppsEnabled',
  'avoidApps',
] as const;

/** 配置键名联合类型。 */
export type ScreenConfigKey = (typeof SCREEN_CONFIG_KEYS)[number];

/** 平键 → 归一化字段名的映射（唯一一份，改键名只改这里）。 */
export const SCREEN_KEY_FIELD: Readonly<Record<ScreenConfigKey, keyof ScreenConfig>> = {
  screenReadEnabled: 'readEnabled',
  screenReadIntervalSec: 'intervalSec',
  screenReadIdleOnly: 'idleOnly',
  screenReadIdleSec: 'idleSec',
  screenReadQuietFrom: 'quietFrom',
  screenReadQuietTo: 'quietTo',
  avoidFullscreenEnabled: 'avoidFullscreen',
  avoidMaximizeEnabled: 'avoidMaximize',
  avoidDelayMs: 'avoidDelayMs',
  avoidRestoreDelayMs: 'avoidRestoreMs',
  avoidPollMs: 'avoidPollMs',
  avoidAppsEnabled: 'avoidAppsEnabled',
  avoidApps: 'avoidApps',
};

/** 分钟数 → `HH:MM`（越界按 24h 取模，负数归零）。 */
export function formatClock(minutes: number): string {
  const total = Math.max(0, Math.round(Number(minutes) || 0)) % (24 * 60);
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return hh + ':' + mm;
}

/**
 * `HH:MM` → 当天第几分钟。
 *
 * 宽松接受 `9:05` / `09:5`（手写配置里的常态），但拒绝 `24:00` / `12:60` / 空串 / 非字符串：
 * 越界时间不是「差一点」，它根本不存在，硬换算只会让静默时段落到用户没想过的位置。
 *
 * @param raw - 配置里的原始值。
 * @returns 0–1439 的分钟数；不合法时 null。
 */
export function parseClockMinutes(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(raw.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * 现在是否落在静默时段内。
 *
 * 跨午夜（22:00 → 06:00）是常态，所以「起点大于终点」按跨天处理，而不是当成空区间。
 * 两端都配了、但解析不出来 → 视为没设时段（宁可不静默，也别整天不出声）。
 * 起止相同 → 视为不设（用户多半是想关掉，不是想要 24 小时静默）。
 *
 * @param from - 起点 `HH:MM`（空串 = 不设）。
 * @param to - 终点 `HH:MM`（空串 = 不设）。
 * @param nowMinute - 当前时刻换算的当天第几分钟。
 * @returns 是否在静默时段内。
 */
export function inQuietWindow(from: string, to: string, nowMinute: number): boolean {
  const start = parseClockMinutes(from);
  const end = parseClockMinutes(to);
  if (start === null || end === null || start === end) return false;
  const now = ((Math.round(Number(nowMinute) || 0) % 1440) + 1440) % 1440;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/** 夹取一个数字：非有限数 → 回落值；越界 → 边界。 */
function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 严格布尔：只有 `true` 才为真（配置里写 "true" / 1 不算——那是写错了，按默认处理）。 */
function boolOf(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * 白名单归一化：trim、去空、去重（大小写不敏感）、截断到上限。
 *
 * 去重按小写比、保留用户写的原样：`Chrome.exe` 与 `chrome.exe` 是同一条规则，
 * 但界面上显示用户自己写的那一份。
 *
 * @param raw - 配置里的原始值。
 * @returns 归一化后的白名单（可能是空数组）。
 */
export function normalizeAvoidApps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    if (text === '' || text.length > AVOID_APP_MAX_CHARS) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= AVOID_APPS_MAX) break;
  }
  return out;
}

/**
 * 把一份配置（条目顶层）读成 `ScreenConfig`：缺键与非法值一律回到默认，数值越界夹到边界。
 *
 * @param conf - 成品配置里某个条目的顶层对象（`readAllConfig` 的 `cfg[entry]`）。
 * @returns 归一化后的配置；`conf` 缺失时就是 {@link SCREEN_DEFAULTS}。
 */
export function screenConfigOf(conf: unknown): ScreenConfig {
  const o = conf && typeof conf === 'object' && !Array.isArray(conf) ? (conf as Record<string, unknown>) : {};
  const quietFrom =
    parseClockMinutes(o.screenReadQuietFrom) === null
      ? ''
      : formatClock(parseClockMinutes(o.screenReadQuietFrom) as number);
  const quietTo =
    parseClockMinutes(o.screenReadQuietTo) === null
      ? ''
      : formatClock(parseClockMinutes(o.screenReadQuietTo) as number);
  return {
    readEnabled: boolOf(o.screenReadEnabled, SCREEN_DEFAULTS.readEnabled),
    intervalSec: clampNum(o.screenReadIntervalSec, SCREEN_INTERVAL_MIN, SCREEN_INTERVAL_MAX, SCREEN_INTERVAL_DEFAULT),
    idleOnly: boolOf(o.screenReadIdleOnly, SCREEN_DEFAULTS.idleOnly),
    idleSec: clampNum(o.screenReadIdleSec, SCREEN_IDLE_MIN, SCREEN_IDLE_MAX, SCREEN_IDLE_DEFAULT),
    quietFrom,
    quietTo,
    avoidFullscreen: boolOf(o.avoidFullscreenEnabled, SCREEN_DEFAULTS.avoidFullscreen),
    avoidMaximize: boolOf(o.avoidMaximizeEnabled, SCREEN_DEFAULTS.avoidMaximize),
    avoidDelayMs: clampNum(o.avoidDelayMs, AVOID_DELAY_MIN, AVOID_DELAY_MAX, AVOID_DELAY_DEFAULT),
    avoidRestoreMs: clampNum(o.avoidRestoreDelayMs, AVOID_RESTORE_MIN, AVOID_RESTORE_MAX, AVOID_RESTORE_DEFAULT),
    avoidPollMs: clampNum(o.avoidPollMs, AVOID_POLL_MIN, AVOID_POLL_MAX, AVOID_POLL_DEFAULT),
    avoidAppsEnabled: boolOf(o.avoidAppsEnabled, SCREEN_DEFAULTS.avoidAppsEnabled),
    avoidApps: normalizeAvoidApps(o.avoidApps),
  };
}
