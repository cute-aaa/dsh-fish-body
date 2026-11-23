/**
 * 设置页「看屏幕与避让」的字段状态：十三个可配项一个都不写死在卡片里。
 *
 * 为什么整段用一个对象而不是十三个 `useState`：这十三项在快照、基线与保存体里都是**一条**
 * 嵌套值（`screen`），拆成十三个状态只会让「apply / 保存 / diff」三处各写十三行。
 * 数值在写状态时就夹到区间（宿主仍会权威校验），界面因此不会先接受一个存不进去的数。
 *
 * owns only 这十三项草稿与夹取，never 加载、保存与其它分区字段。
 * @module dsh-fish-body/src/client/settings/use-screen-settings
 */
import {
  AVOID_APPS_MAX,
  AVOID_APP_MAX_CHARS,
  AVOID_DELAY_MAX,
  AVOID_DELAY_MIN,
  AVOID_POLL_MAX,
  AVOID_POLL_MIN,
  AVOID_RESTORE_MAX,
  AVOID_RESTORE_MIN,
  SCREEN_DEFAULTS,
  SCREEN_IDLE_MAX,
  SCREEN_IDLE_MIN,
  SCREEN_INTERVAL_MAX,
  SCREEN_INTERVAL_MIN,
  formatClock,
  parseClockMinutes,
  type ScreenConfig,
} from '../../shared/screen-config.ts';
import type { MainConfigPatch } from './config/index.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 四个开关的字段名。 */
export type ScreenFlagField = 'readEnabled' | 'idleOnly' | 'avoidFullscreen' | 'avoidMaximize' | 'avoidAppsEnabled';

/** 五个数字字段名。 */
export type ScreenNumberField = 'intervalSec' | 'idleSec' | 'avoidDelayMs' | 'avoidRestoreMs' | 'avoidPollMs';

/** 两个时段字段名。 */
export type ScreenClockField = 'quietFrom' | 'quietTo';

/** 数字字段 → 区间与小节（卡片据此渲染，不再各写一份 range）。 */
export const SCREEN_NUMBER_RANGE: Readonly<Record<ScreenNumberField, readonly [number, number]>> = {
  intervalSec: [SCREEN_INTERVAL_MIN, SCREEN_INTERVAL_MAX],
  idleSec: [SCREEN_IDLE_MIN, SCREEN_IDLE_MAX],
  avoidDelayMs: [AVOID_DELAY_MIN, AVOID_DELAY_MAX],
  avoidRestoreMs: [AVOID_RESTORE_MIN, AVOID_RESTORE_MAX],
  avoidPollMs: [AVOID_POLL_MIN, AVOID_POLL_MAX],
};

/** 「看屏幕与避让」的状态与回调。 */
export interface ScreenSettings {
  /** 即时的十三项（快照 / 保存体直接用它）。 */
  readonly values: ScreenConfig;
  /** 白名单输入框的原文（`null` = 还没动过，显示由 `values.avoidApps` 拼出）。 */
  readonly appsText: string;
  setFlag(field: ScreenFlagField, value: boolean): void;
  /** 改一个数字；越界夹到区间，非数字忽略。 */
  setNumber(field: ScreenNumberField, value: number): void;
  /** 改一个 `HH:MM` 时段；空串 = 不设，非法写法忽略（保留上一个正确值）。 */
  setClock(field: ScreenClockField, text: string): void;
  /** 改白名单原文（逗号 / 顿号 / 换行分隔）。 */
  setAppsText(text: string): void;
  /** 用成品配置覆盖能信的字段。 */
  apply(patch: MainConfigPatch): void;
}

/**
 * 把白名单原文切成条目：逗号（中英）、顿号、换行、分号都算分隔符。
 *
 * 去空、去重（大小写不敏感）、截断到上限。用户手打时多一个逗号是常态，不该报错。
 *
 * @param text - 输入框原文。
 * @returns 归一化后的白名单。
 */
export function parseAppsText(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of String(text).split(/[,，、;；\n\r]+/)) {
    const item = piece.trim();
    if (item === '' || item.length > AVOID_APP_MAX_CHARS) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= AVOID_APPS_MAX) break;
  }
  return out;
}

/**
 * 管理「看屏幕与避让」的十三项。
 *
 * @param rt - 只用到 `useState` 与 `useCallback`。
 * @returns 当前值与改值入口。
 */
export function useScreenSettings(rt: Pick<SettingsRuntime, 'useState' | 'useCallback'>): ScreenSettings {
  const { useState, useCallback } = rt;
  // 初值就是出厂默认：加载成功后由成品值覆盖，未就绪期间整页只读，存不出去。
  const [values, setValues] = useState<ScreenConfig>(SCREEN_DEFAULTS);
  const [appsTextRaw, setAppsTextRaw] = useState<string | null>(null);

  const setFlag = useCallback((field: ScreenFlagField, value: boolean): void => {
    setValues((current) => ({ ...current, [field]: value }));
  }, []);

  const setNumber = useCallback((field: ScreenNumberField, value: number): void => {
    const [min, max] = SCREEN_NUMBER_RANGE[field];
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(max, Math.max(min, Math.round(n)));
    setValues((current) => ({ ...current, [field]: clamped }));
  }, []);

  const setClock = useCallback((field: ScreenClockField, text: string): void => {
    const trimmed = String(text).trim();
    if (trimmed === '') {
      setValues((current) => ({ ...current, [field]: '' }));
      return;
    }
    const minutes = parseClockMinutes(trimmed);
    // 只输入了「9」或「9:」这种半截内容时先不动：等用户敲完，别把光标里的字吃掉
    if (minutes === null) return;
    setValues((current) => ({ ...current, [field]: formatClock(minutes) }));
  }, []);

  const setAppsText = useCallback((text: string): void => {
    setAppsTextRaw(text);
    setValues((current) => ({ ...current, avoidApps: parseAppsText(text) }));
  }, []);

  // 只有 setState，跨渲染稳定：放进设置页 applyConfig 的依赖里不会让配置反复重拉。
  const apply = useCallback((patch: MainConfigPatch): void => {
    if (patch.screen !== undefined) setValues(patch.screen);
    setAppsTextRaw(null);
  }, []);

  return {
    values,
    appsText: appsTextRaw ?? values.avoidApps.join(', '),
    setFlag,
    setNumber,
    setClock,
    setAppsText,
    apply,
  };
}
