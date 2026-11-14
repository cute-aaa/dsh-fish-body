/**
 * 十三个看屏幕 / 避让键的**写盘校验**（严格：越界即整包拒绝，绝不夹取）。
 *
 * 为什么与 `shared/screen-config.ts` 的归一化不共用一条规则：运行期读到越界值要能继续跑
 * （夹到边界、告警一次），写盘时却不能替用户猜——把 5000 秒的间隔悄悄改成 3600，
 * 用户下次打开设置页会看到一个自己没填过的值。
 *
 * `save.ts` 只负责「传了就校验、校验过就进白名单」，字段规则全在本文件：加一个键改一处。
 * @module dsh-fish-body/src/host/config/screen-keys
 */
import {
  AVOID_APP_MAX_CHARS,
  AVOID_APPS_MAX,
  AVOID_DELAY_MAX,
  AVOID_DELAY_MIN,
  AVOID_POLL_MAX,
  AVOID_POLL_MIN,
  AVOID_RESTORE_MAX,
  AVOID_RESTORE_MIN,
  SCREEN_CONFIG_KEYS,
  SCREEN_IDLE_MAX,
  SCREEN_IDLE_MIN,
  SCREEN_INTERVAL_MAX,
  SCREEN_INTERVAL_MIN,
  formatClock,
  normalizeAvoidApps,
  parseClockMinutes,
  type ScreenConfigKey,
} from '../../shared/screen-config.ts';

/** 校验结论：通过时给出落盘值与本批「由请求体拥有」的键。 */
export type ScreenPatch =
  | { readonly ok: true; readonly value: Record<string, unknown>; readonly owned: ScreenConfigKey[] }
  | { readonly ok: false; readonly message: string };

/** 布尔键：只有真布尔算合法（"true" / 1 是写错了，不是「差不多」）。 */
const BOOL_KEYS: readonly ScreenConfigKey[] = [
  'screenReadEnabled',
  'screenReadIdleOnly',
  'avoidFullscreenEnabled',
  'avoidMaximizeEnabled',
  'avoidAppsEnabled',
];

/** 数值键 → [下限, 上限]。 */
const NUM_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  screenReadIntervalSec: [SCREEN_INTERVAL_MIN, SCREEN_INTERVAL_MAX],
  screenReadIdleSec: [SCREEN_IDLE_MIN, SCREEN_IDLE_MAX],
  avoidDelayMs: [AVOID_DELAY_MIN, AVOID_DELAY_MAX],
  avoidRestoreDelayMs: [AVOID_RESTORE_MIN, AVOID_RESTORE_MAX],
  avoidPollMs: [AVOID_POLL_MIN, AVOID_POLL_MAX],
};

/** 数值键的中文名（错误文案用它，比字段名好认）。 */
const LABELS: Readonly<Record<string, string>> = {
  screenReadIntervalSec: '识屏间隔',
  screenReadIdleSec: '空闲判定阈值',
  avoidDelayMs: '躲开延迟',
  avoidRestoreDelayMs: '恢复延迟',
  avoidPollMs: '轮询节拍',
};

/**
 * 校验一个数值键：接受 `"120"` 这种字符串写法（与 `chatMemoryRounds` 同口径），
 * 但必须是整数且落在区间内。
 *
 * @param key - 键名（用于文案）。
 * @param raw - 请求体里的原始值。
 * @returns 归一化后的数字；不合法时给一句文案。
 */
function checkNumber(key: string, raw: unknown): { ok: true; value: number } | { ok: false; message: string } {
  const [min, max] = NUM_RANGES[key];
  const n = Number(raw);
  const label = LABELS[key] ?? key;
  if (!Number.isFinite(n)) return { ok: false, message: `${label}必须是数字` };
  if (!Number.isInteger(n)) return { ok: false, message: `${label}必须是整数` };
  if (n < min || n > max) return { ok: false, message: `${label}必须在 ${min}–${max} 之间` };
  return { ok: true, value: n };
}

/**
 * 校验 `HH:MM` 时段：空串 = 不设；其余必须能解析成真实时刻。
 *
 * @param key - 键名（用于文案）。
 * @param raw - 请求体里的原始值。
 * @returns 规范化后的 `HH:MM`（`9:5` → `09:05`）；不合法时给一句文案。
 */
function checkClock(key: string, raw: unknown): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof raw !== 'string') return { ok: false, message: `${key} 必须是 HH:MM 字符串` };
  const text = raw.trim();
  if (text === '') return { ok: true, value: '' };
  const minutes = parseClockMinutes(text);
  if (minutes === null) return { ok: false, message: `${key} 必须是 HH:MM（00:00–23:59）` };
  return { ok: true, value: formatClock(minutes) };
}

/**
 * 校验白名单：字符串数组，逐项 trim 后非空、不超长，去重后不超过上限。
 *
 * 超限**拒绝**而不是截断：用户把 60 条粘进来，静默丢掉 10 条等于悄悄改了规则。
 *
 * @param raw - 请求体里的原始值。
 * @returns 归一化后的白名单；不合法时给一句文案。
 */
function checkApps(raw: unknown): { ok: true; value: string[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) return { ok: false, message: '白名单必须是字符串数组' };
  // 条数按**去重后**的条数判：重复项本来就会被归一化吃掉，用户粘两遍不该报错。
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') return { ok: false, message: '白名单里只能放字符串' };
    const text = item.trim();
    if (text === '') return { ok: false, message: '白名单里有空项' };
    if (text.length > AVOID_APP_MAX_CHARS) {
      return { ok: false, message: `白名单单项不能超过 ${AVOID_APP_MAX_CHARS} 字符` };
    }
    seen.add(text.toLowerCase());
    if (seen.size > AVOID_APPS_MAX) return { ok: false, message: `白名单最多 ${AVOID_APPS_MAX} 条` };
  }
  return { ok: true, value: normalizeAvoidApps(raw) };
}

/**
 * 从请求体里挑出本批要写的看屏幕 / 避让键并逐个校验。
 *
 * @param body - `PUT /config` 的请求体（顶层对象）。
 * @returns 落盘值（键名与配置文件一致）+ 本批 owned 键；任一键非法即整体拒绝。
 */
export function screenPatchOf(body: Record<string, unknown>): ScreenPatch {
  const value: Record<string, unknown> = {};
  const owned: ScreenConfigKey[] = [];
  for (const key of SCREEN_CONFIG_KEYS) {
    const raw = body[key];
    if (raw === undefined) continue;
    if (BOOL_KEYS.includes(key)) {
      if (typeof raw !== 'boolean') return { ok: false, message: `${key} 必须是布尔值` };
      value[key] = raw;
      owned.push(key);
      continue;
    }
    if (key in NUM_RANGES) {
      const checked = checkNumber(key, raw);
      if (!checked.ok) return checked;
      value[key] = checked.value;
      owned.push(key);
      continue;
    }
    if (key === 'avoidApps') {
      const checked = checkApps(raw);
      if (!checked.ok) return checked;
      value[key] = checked.value;
      owned.push(key);
      continue;
    }
    const checked = checkClock(key, raw);
    if (!checked.ok) return checked;
    value[key] = checked.value;
    owned.push(key);
  }
  return { ok: true, value, owned };
}
