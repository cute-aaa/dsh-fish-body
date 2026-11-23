/**
 * 待办面板的悬停快捷键：鼠标停在宠物上时按配置的键开关面板。
 * 按键规则归 shared/hotkey，本模块只绑定「哪个动作」；键位来自 `hotkeys` 配置（见 shared/hotkeys）。
 * @module dsh-fish-body/src/shared/todo/hotkey
 */
import { hotkeyOf, type HotkeyMap } from '../hotkeys.ts';
import { isBareKey } from '../hotkey.ts';
import type { HotkeyEvent } from '../hotkey.ts';

/**
 * 这次按键该不该开关待办面板。
 *
 * @param e - 键盘事件。
 * @param hotkeys - 当前键位表；缺省走出厂键。
 * @returns 裸按配置的「待办」键（含大写）时为 true，输入框里打字则为 false。
 */
export function isTodoHotkey(e: HotkeyEvent, hotkeys?: HotkeyMap): boolean {
  return isBareKey(e, hotkeyOf(hotkeys, 'todo'));
}
