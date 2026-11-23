/**
 * 悬停快捷键的判据：鼠标停在某只宠物上时，按配置里的键打开对话 / 截图。
 * 按键规则归 shared/hotkey，本模块只绑定「哪个动作 + 菜单文案」；具体是哪个键由 `hotkeys` 配置决定
 * （见 shared/hotkeys），键帽文案也从那里出，判定与显示永远是同一个字符。
 * @module dsh-fish-body/src/shared/chat/hotkey
 */
import { hotkeyOf, type HotkeyMap } from '../hotkeys.ts';
import { isBareKey } from '../hotkey.ts';
import type { HotkeyEvent } from '../hotkey.ts';

export { isTypingTarget } from '../hotkey.ts';
export type { HotkeyEvent } from '../hotkey.ts';

/**
 * 这次按键该不该打开对话。
 *
 * @param e - 键盘事件。
 * @param hotkeys - 当前键位表；缺省走出厂键。
 * @returns 裸按配置的「对话」键（含大写）时为 true，输入框里打字则为 false。
 */
export function isChatHotkey(e: HotkeyEvent, hotkeys?: HotkeyMap): boolean {
  return isBareKey(e, hotkeyOf(hotkeys, 'chat'));
}

/**
 * 这次按键该不该截图。
 *
 * @param e - 键盘事件。
 * @param hotkeys - 当前键位表；缺省走出厂键。
 * @returns 裸按配置的「截图」键（含大写）时为 true，输入框里打字则为 false。
 */
export function isCaptureHotkey(e: HotkeyEvent, hotkeys?: HotkeyMap): boolean {
  return isBareKey(e, hotkeyOf(hotkeys, 'capture'));
}
