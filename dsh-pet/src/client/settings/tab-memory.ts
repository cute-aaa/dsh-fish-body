/**
 * 分区记忆：把上次停留的分区记在 `localStorage`，下次打开设置页直接回到那一页。
 *
 * 只记分区 id，不记任何配置值——配置的唯一真源在宿主的配置文件里，这里丢了不影响任何行为。
 * 读到的 id 必须先在分区表里校验：旧版本记下的分区被删掉后要回落默认，否则整页会渲染成空白。
 * 存储访问一律吞错：隐私模式、被策略禁用、没有 DOM 时都退化成「不记忆」，不阻塞设置页。
 * @module dsh-pet/src/client/settings/tab-memory
 */
import { SETTINGS_TABS, type SettingsTabId } from './tabs.ts';

/** 记住分区用的存储键。 */
export const TAB_STORAGE_KEY = 'dsh-pet/settings-tab';

/** 读写用的最小存储口（`localStorage` 的读写子集），便于单测注入。 */
export interface TabStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 取浏览器存储。
 *
 * @returns `localStorage`；没有 DOM、隐私模式或访问器本身抛错时 `null`（调用方按「不记忆」处理）。
 */
export function settingsTabStorage(): TabStorage | null {
  try {
    // 隐私模式下访问 localStorage 这个属性本身就可能抛，所以连取值都包在 try 里。
    return (globalThis as { localStorage?: TabStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * 把存下来的字符串校验成分区 id。
 *
 * @param raw - 存储里的原始值。
 * @returns 表里存在的分区 id；未知值、空串、`null` 一律 `null`。
 */
export function parseTabId(raw: string | null): SettingsTabId | null {
  if (raw === null || raw === '') return null;
  const known = SETTINGS_TABS.find((tab) => tab.id === raw);
  return known === undefined ? null : known.id;
}

/**
 * 读上次停留的分区。
 *
 * @param storage - 存储口；`null` 表示没有可用存储。
 * @returns 合法的分区 id；没记过、记的值已失效或读失败时 `null`（调用方回落默认分区）。
 */
export function readSavedTab(storage: TabStorage | null): SettingsTabId | null {
  if (storage === null) return null;
  try {
    return parseTabId(storage.getItem(TAB_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * 记住当前分区。
 *
 * @param storage - 存储口；`null` 表示没有可用存储。
 * @param id - 当前分区。
 */
export function saveTab(storage: TabStorage | null, id: SettingsTabId): void {
  if (storage === null) return;
  try {
    storage.setItem(TAB_STORAGE_KEY, id);
  } catch {
    // 写不进（配额满 / 隐私模式）：记不住下一次而已，不该让切换分区失败。
  }
}
