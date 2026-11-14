/**
 * 设置页的悬停键状态：九个可改绑的裸键（对话 / 按住说话 / 截图 / 待办 / 睡觉 / 四个显示位置）。
 *
 * 只改本地状态、随「保存」整包写入——与全局开关同一条理由：即时写盘会重启桌面 Helper。
 * 改绑与互换的规则不在卡片里，而在 `shared/hotkeys`（`assignHotkey` / `normalizeHotkeys`）：
 * 界面只管把「哪个动作、按了什么键」回传，键位表的合法性与唯一性由那一份纯函数保证。
 * owns only 这张键位表，never 保存、加载与其它分区字段。
 * @module dsh-fish-body/src/client/settings/use-hotkeys-settings
 */
import {
  assignHotkey,
  DEFAULT_HOTKEYS,
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
  /** 改一个键；这个键原本属于别的动作时两者互换。 */
  setKey(action: HotkeyAction, key: string): void;
  /** 九个键整体恢复出厂。 */
  reset(): void;
  /** 用成品配置覆盖（缺失时回到出厂键位）。 */
  apply(patch: MainConfigPatch): void;
}

/**
 * 管理九个悬停键。
 *
 * @param rt - 只用到 `useState` 与 `useCallback`。
 * @returns 当前键位表与两个改值入口。
 */
export function useHotkeysSettings(rt: Pick<SettingsRuntime, 'useState' | 'useCallback'>): HotkeysSettings {
  const { useState, useCallback } = rt;
  // 初值是出厂键位：加载成功后由成品值覆盖，未就绪期间整页只读，存不出去。
  const [values, setValues] = useState<HotkeyMap>(DEFAULT_HOTKEYS);

  const setKey = useCallback((action: HotkeyAction, key: string): void => {
    setValues((current) => assignHotkey(current, action, key));
  }, []);

  const reset = useCallback((): void => setValues(DEFAULT_HOTKEYS), []);

  // 只有 setState，跨渲染稳定：放进设置页 applyConfig 的依赖里不会让配置反复重拉。
  const apply = useCallback((patch: MainConfigPatch): void => {
    setValues(normalizeHotkeys(patch.hotkeys));
  }, []);

  return { values, setKey, reset, apply };
}
