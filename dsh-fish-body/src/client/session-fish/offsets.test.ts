/**
 * 会话鱼偏移存储：读写、按会话保留、超量裁剪与「重置」广播（含旧版本键的清理）。
 * @module dsh-fish-body/src/client/session-fish/offsets.test
 */
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { clearFishOffsets, readOffsets, writeFishOffset, SESSION_FISH_POSITIONS_RESET_EVENT } from './offsets.ts';

/** 最小 localStorage 替身。 */
function makeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  } as Storage;
}

let savedStorage: PropertyDescriptor | undefined;

beforeEach(() => {
  savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: makeStorage() });
});

afterEach(() => {
  if (savedStorage) Object.defineProperty(globalThis, 'localStorage', savedStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('offsets', () => {
  test('写入后读回同一个会话的偏移；不同会话各存各的', () => {
    writeFishOffset('a', { dx: 10, dy: -20 });
    writeFishOffset('b', { dx: 30, dy: 40 });
    assert.deepEqual(readOffsets(), { b: { dx: 30, dy: 40 }, a: { dx: 10, dy: -20 } });
  });

  test('脏数据/非对象：读成空表，不抛错', () => {
    localStorage.setItem('dsh-pet:session-fish-offsets', '{not json');
    assert.deepEqual(readOffsets(), {});
    localStorage.setItem('dsh-pet:session-fish-offsets', JSON.stringify({ a: { dx: 'no' }, b: { dx: 1, dy: 2 } }));
    assert.deepEqual(readOffsets(), { b: { dx: 1, dy: 2 } });
  });

  test('最多保留 60 条：新写入的留下，旧键被裁掉', () => {
    for (let index = 0; index < 70; index += 1) writeFishOffset('s' + String(index), { dx: index, dy: 0 });
    const all = readOffsets();
    assert.equal(Object.keys(all).length, 60);
    assert.ok(all.s69, '最新写入的必须在');
    assert.equal(all.s0, undefined, '最早的被裁掉');
  });

  test('重置：清掉两个键并广播一次', () => {
    writeFishOffset('a', { dx: 1, dy: 2 });
    localStorage.setItem('dsh-pet:session-fish-positions', '{"a":{"x":1,"y":2}}');
    let events = 0;
    const listener = (): void => {
      events += 1;
    };
    const scope = globalThis as { window?: unknown };
    const savedWindow = scope.window;
    const fakeWindow = new EventTarget();
    scope.window = fakeWindow;
    try {
      fakeWindow.addEventListener(SESSION_FISH_POSITIONS_RESET_EVENT, listener);
      clearFishOffsets();
      assert.equal(events, 1);
      assert.deepEqual(readOffsets(), {});
      assert.equal(localStorage.getItem('dsh-pet:session-fish-positions'), null, '旧版本的绝对坐标一并清掉');
    } finally {
      if (savedWindow === undefined) Reflect.deleteProperty(scope, 'window');
      else scope.window = savedWindow;
    }
  });

  test('存储不可用：读写都不抛错', () => {
    Reflect.deleteProperty(globalThis, 'localStorage');
    assert.deepEqual(readOffsets(), {});
    writeFishOffset('a', { dx: 1, dy: 2 });
  });
});
