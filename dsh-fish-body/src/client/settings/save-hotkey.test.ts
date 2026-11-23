/**
 * Ctrl+S / Cmd+S 判定（src/client/settings/save-hotkey.ts）的契约测试。
 *
 * 三条契约：
 *   1. 只认 Ctrl+S / Cmd+S：多按 Shift / Alt 一律不接管；
 *   2. 本页不可见（未挂载、已卸载、量不到盒子）时不接管——否则会把别的设置页的快捷键抢走；
 *   3. 其余按键不接管，浏览器的「保存网页」才不会被打断。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { isSaveHotkey, type HotkeyRoot, type SaveHotkeyEvent } from './save-hotkey.ts';

/** 一次默认的 Ctrl+S；只覆盖与判定相关的字段。 */
const key = (patch: Partial<SaveHotkeyEvent> = {}): SaveHotkeyEvent => ({
  key: 's',
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...patch,
});

/** 一个可见的根节点替身。 */
const visibleRoot = (patch: Partial<HotkeyRoot> = {}): HotkeyRoot => ({
  isConnected: true,
  getClientRects: () => ({ length: 1 }),
  ...patch,
});

describe('isSaveHotkey —— 保存快捷键的判定', () => {
  test('Ctrl+S 与 Cmd+S 都算保存', () => {
    assert.equal(isSaveHotkey(key(), visibleRoot()), true);
    assert.equal(isSaveHotkey(key({ ctrlKey: false, metaKey: true }), visibleRoot()), true);
    assert.equal(isSaveHotkey(key({ key: 'S' }), visibleRoot()), true, '大写键名同样算');
  });

  test('多按 Shift / Alt 不接管', () => {
    assert.equal(isSaveHotkey(key({ shiftKey: true }), visibleRoot()), false);
    assert.equal(isSaveHotkey(key({ altKey: true }), visibleRoot()), false);
    assert.equal(isSaveHotkey(key({ ctrlKey: false, metaKey: false }), visibleRoot()), false, '无修饰键不接管');
  });

  test('其它按键不接管：不打断浏览器的「保存网页」等快捷键', () => {
    assert.equal(isSaveHotkey(key({ key: 'p' }), visibleRoot()), false);
  });

  test('本页不可见时不接管', () => {
    assert.equal(isSaveHotkey(key(), null), false, '还没挂载');
    assert.equal(isSaveHotkey(key(), visibleRoot({ isConnected: false })), false, '已卸载');
    assert.equal(isSaveHotkey(key(), visibleRoot({ getClientRects: () => ({ length: 0 }) })), false, '被隐藏');
  });
});
