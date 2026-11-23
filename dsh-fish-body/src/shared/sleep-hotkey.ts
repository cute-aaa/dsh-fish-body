/**
 * 睡觉的悬停快捷键：鼠标停在宠物上时按配置的键切换睡 / 醒。
 *
 * 按键规则归 shared/hotkey，本模块只绑定「哪个动作 + 菜单文案」；键位来自 `hotkeys` 配置（见 shared/hotkeys）。
 * 语义是切换而不是单向睡觉：醒着按 = 睡下，睡着按 = 叫醒——与右键那一项完全同一件事。
 * @module dsh-fish-body/src/shared/sleep-hotkey
 */
import { hotkeyOf, type HotkeyMap } from './hotkeys.ts';
import { isBareKey } from './hotkey.ts';
import type { HotkeyEvent } from './hotkey.ts';

/**
 * 这次按键该不该切换睡觉状态。
 *
 * @param e - 键盘事件。
 * @param hotkeys - 当前键位表；缺省走出厂键。
 * @returns 裸按配置的「睡觉」键（含大写）时为 true，输入框里打字则为 false。
 */
export function isSleepHotkey(e: HotkeyEvent, hotkeys?: HotkeyMap): boolean {
  return isBareKey(e, hotkeyOf(hotkeys, 'sleep'));
}
