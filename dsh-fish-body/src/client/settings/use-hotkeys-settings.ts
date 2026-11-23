/**
 * 设置页的快捷键状态：九个可改绑的裸键（对话 / 按住说话 / 截图 / 待办 / 睡觉 / 四个显示位置），
 * 外加一条**系统级**组合键「全局隐藏 / 暂停」。
 *
 * 两类键放一起是因为它们在同一张卡上编辑、随同一次「保存」落盘，且都要重建桌面 Helper 才生效；
 * 差别只在形状：九个裸键是一张表（互换语义由 `assignHotkey` 保证），组合键是一个字符串（空串 = 关掉）。
 * owns only 这张键位表与那一个字符串，never 保存、加载与其它分区字段。
 * @module dsh-fish-body/src/client/settings/use-hotkeys-settings
 */
import {
  assignHotkey,
  DEFAULT_HIDE_ALL_HOTKEY,
  DEFAULT_HOTKEYS,
  normalizeGlobalHotkey,
  normalizeHotkeys,
  type HotkeyAction,
  type HotkeyMap,
} from '../../shared/hotkeys.ts';
import type { MainConfigPatch } from './config/index.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 悬停键的状态与回调。 */
export interface HotkeysSettings {
  /** 九个键的当前值（永远齐全、互不相同）。 */
  readonly values: HotkeyMap;
  /** 全局隐藏 / 暂停的组合键（已归一；空串 = 关掉）。 */
  readonly hideAll: string;
  /** 改一个键；这个键原本属于别的动作时两者互换。 */
  setKey(action: HotkeyAction, key: string): void;
  /** 九个键整体恢复出厂。 */
  reset(): void;
  /** 改「全局隐藏 / 暂停」的组合键（输入框原文，落盘前由宿主再校验一次）。 */
  setHideAll(value: string): void;
  /** 这条组合键恢复出厂值。 */
  resetHideAll(): void;
  /** 用成品配置覆盖（缺失时回到出厂键位）。 */
  apply(patch: MainConfigPatch): void;
}

/**
 * 管理九个悬停键与一条系统级组合键。
 *
 * @param rt - 只用到 `useState` 与 `useCallback`。
 * @returns 当前键位表、组合键与四个改值入口。
 */
export function useHotkeysSettings(rt: Pick<SettingsRuntime, 'useState' | 'useCallback'>): HotkeysSettings {
  const { useState, useCallback } = rt;
  // 初值是出厂键位：加载成功后由成品值覆盖，未就绪期间整页只读，存不出去。
  const [values, setValues] = useState<HotkeyMap>(DEFAULT_HOTKEYS);
  const [hideAll, setHideAllValue] = useState(DEFAULT_HIDE_ALL_HOTKEY);

  const setKey = useCallback((action: HotkeyAction, key: string): void => {
    setValues((current) => assignHotkey(current, action, key));
  }, []);

  const reset = useCallback((): void => setValues(DEFAULT_HOTKEYS), []);

  // 输入框允许写到一半（`Control+Alt+`）：这里只存原文，合法性由输入框旁边的提示与宿主校验负责。
  const setHideAll = useCallback((value: string): void => setHideAllValue(value), []);
  const resetHideAll = useCallback((): void => setHideAllValue(DEFAULT_HIDE_ALL_HOTKEY), []);

  // 只有 setState，跨渲染稳定：放进设置页 applyConfig 的依赖里不会让配置反复重拉。
  const apply = useCallback((patch: MainConfigPatch): void => {
    setValues(normalizeHotkeys(patch.hotkeys));
    if (patch.hideAllHotkey !== undefined) setHideAllValue(normalizeGlobalHotkey(patch.hideAllHotkey));
  }, []);

  return { values, hideAll, setKey, reset, setHideAll, resetHideAll, apply };
}
