/**
 * 悬停键真源（src/shared/hotkeys.ts）的契约：
 *   1. 出厂键位就是改绑功能出现之前的那九个，老用户升级后手感不变；
 *   2. `normalizeHotkeys` 永远给出「齐全、合法、互不相同」的一份——脏值、重复、缺项都有人兜；
 *   3. `assignHotkey` 把同一个键给了两项时**互换**，而不是拒绝或静默丢弃；
 *   4. `hotkeysValid` 只判原始值：大写与缺项合法，未知动作、非法键、重复键整包拒绝。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assignHotkey,
  DEFAULT_HOTKEYS,
  HOTKEY_ACTIONS,
  hotkeyHint,
  hotkeyOf,
  hotkeysValid,
  isHotkeyAction,
  isHotkeyKey,
  normalizeHotkeys,
} from './hotkeys.ts';

describe('出厂键位', () => {
  test('九个动作都在，值就是改绑功能之前的那九个键', () => {
    assert.deepEqual(HOTKEY_ACTIONS, [
      'chat',
      'hear',
      'capture',
      'todo',
      'sleep',
      'display.web',
      'display.desktop',
      'display.both',
      'display.none',
    ]);
    assert.deepEqual(DEFAULT_HOTKEYS, {
      chat: 'l',
      hear: 'm',
      capture: 's',
      todo: 'd',
      sleep: 'z',
      'display.web': '1',
      'display.desktop': '2',
      'display.both': '3',
      'display.none': '4',
    });
  });

  test('出厂键位本身合法且互不相同（合法性的自证）', () => {
    assert.equal(hotkeysValid(DEFAULT_HOTKEYS), true);
    assert.equal(new Set(Object.values(DEFAULT_HOTKEYS)).size, HOTKEY_ACTIONS.length);
  });
});

describe('isHotkeyKey / isHotkeyAction', () => {
  test('只认单个小写字母或数字', () => {
    for (const ok of ['a', 'z', '0', '9']) assert.equal(isHotkeyKey(ok), true, ok);
    for (const bad of ['A', 'ab', '', ' ', '!', 'ctrl+k', 'F1', 'Enter', null, 7]) {
      assert.equal(isHotkeyKey(bad), false, String(bad));
    }
  });

  test('动作名白名单', () => {
    assert.equal(isHotkeyAction('display.none'), true);
    assert.equal(isHotkeyAction('display'), false);
    assert.equal(isHotkeyAction('chat'), true);
    assert.equal(isHotkeyAction('nope'), false);
  });
});

describe('normalizeHotkeys —— 永远给出齐全、合法、唯一的一份', () => {
  test('缺项补出厂值', () => {
    const map = normalizeHotkeys({ chat: 'k' });
    assert.equal(map.chat, 'k');
    assert.equal(map.hear, 'm');
    assert.equal(Object.keys(map).length, HOTKEY_ACTIONS.length);
  });

  test('大写收成小写、空白 trim 掉', () => {
    const map = normalizeHotkeys({ chat: ' K ' });
    assert.equal(map.chat, 'k');
  });

  test('脏值忽略（非字符串 / 多字符 / 非键字符）', () => {
    const map = normalizeHotkeys({ chat: 42, hear: 'kk', capture: '!', sleep: null });
    assert.equal(map.chat, DEFAULT_HOTKEYS.chat);
    assert.equal(map.hear, DEFAULT_HOTKEYS.hear);
    assert.equal(map.capture, DEFAULT_HOTKEYS.capture);
    assert.equal(map.sleep, DEFAULT_HOTKEYS.sleep);
  });

  test('重复键：先到的那项占住，后来者回落到自己的出厂键', () => {
    // chat 与 sleep 都写 k：chat 先出现（HOTKEY_ACTIONS 顺序），sleep 拿回它的 z。
    const map = normalizeHotkeys({ chat: 'k', sleep: 'k' });
    assert.equal(map.chat, 'k');
    assert.equal(map.sleep, 'z');
  });

  test('出厂键被占用时顺延到下一个空位，结果仍然唯一', () => {
    // chat 抢了 z（出厂属于 sleep）：sleep 的 z 已被占 → 顺延到候选池里第一个空位。
    const map = normalizeHotkeys({ chat: 'z' });
    assert.equal(map.chat, 'z');
    assert.notEqual(map.sleep, 'z');
    assert.notEqual(map.sleep, 'l');
    assert.equal(new Set(Object.values(map)).size, HOTKEY_ACTIONS.length);
  });

  test('构造与校验对不上时也不抛（输入完全不是对象）', () => {
    for (const bad of [undefined, null, 'nope', 42, []]) {
      assert.deepEqual(normalizeHotkeys(bad), DEFAULT_HOTKEYS);
    }
  });
});

describe('hotkeysValid —— 只判原始值', () => {
  test('缺项合法、大写合法', () => {
    assert.equal(hotkeysValid({}), true);
    assert.equal(hotkeysValid({ chat: 'K' }), true);
  });

  test('未知动作 / 非法键 / 重复键（含大小写不同的同键）都拒', () => {
    assert.equal(hotkeysValid({ nope: 'k' }), false);
    assert.equal(hotkeysValid({ chat: 'kk' }), false);
    assert.equal(hotkeysValid({ chat: 'ctrl+k' }), false);
    assert.equal(hotkeysValid({ chat: 'k', hear: 'k' }), false);
    assert.equal(hotkeysValid({ chat: 'k', hear: 'K' }), false);
  });

  test('非对象一律不收', () => {
    for (const bad of [undefined, null, 'nope', 42, []]) assert.equal(hotkeysValid(bad), false, String(bad));
  });
});

describe('assignHotkey —— 改绑即互换', () => {
  test('把一个键给某个动作，原本占用它的动作拿到旧键', () => {
    const next = assignHotkey(DEFAULT_HOTKEYS, 'chat', 'z');
    assert.equal(next.chat, 'z');
    assert.equal(next.sleep, 'l', '睡觉拿到对话原来的 l');
    assert.equal(new Set(Object.values(next)).size, HOTKEY_ACTIONS.length);
  });

  test('没被占用的键：只改这一项', () => {
    const next = assignHotkey(DEFAULT_HOTKEYS, 'chat', 'k');
    assert.equal(next.chat, 'k');
    assert.equal(next.sleep, 'z');
  });

  test('非法键原样返回（界面不会拿它写盘）', () => {
    assert.deepEqual(assignHotkey(DEFAULT_HOTKEYS, 'chat', 'KK'), DEFAULT_HOTKEYS);
    assert.deepEqual(assignHotkey(DEFAULT_HOTKEYS, 'chat', '!'), DEFAULT_HOTKEYS);
  });

  test('大写输入也收成小写', () => {
    assert.equal(assignHotkey(DEFAULT_HOTKEYS, 'chat', 'K').chat, 'k');
  });
});

describe('hotkeyHint / hotkeyOf', () => {
  test('键帽文案与判定用同一个字符', () => {
    assert.equal(hotkeyHint(DEFAULT_HOTKEYS, 'sleep'), 'Z 键');
    assert.equal(hotkeyHint({ ...DEFAULT_HOTKEYS, sleep: 'q' }, 'sleep'), 'Q 键');
    assert.equal(hotkeyHint(undefined, 'capture'), 'S 键');
  });

  test('键位表缺失时回落到出厂键', () => {
    assert.equal(hotkeyOf(undefined, 'todo'), 'd');
    assert.equal(hotkeyOf({ ...DEFAULT_HOTKEYS }, 'todo'), 'd');
  });
});
