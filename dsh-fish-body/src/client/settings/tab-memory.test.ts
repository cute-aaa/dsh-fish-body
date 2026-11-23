/**
 * 分区记忆（src/client/settings/tab-memory.ts）的契约测试。
 *
 * 三条契约：
 *   1. 只认表里存在的分区 id：旧版本记下的分区被删掉后必须回落默认，不能把整页渲染成空；
 *   2. 没有存储（隐私模式 / SSR / 被禁用）时读回 `null`、写入静默跳过，不抛；
 *   3. 存储自己的异常同样吞掉：读写失败只影响「记不住」，不能让切换分区失败。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TAB_STORAGE_KEY, parseTabId, readSavedTab, saveTab, type TabStorage } from './tab-memory.ts';

/** 内存存储替身；`fail` 为真时读写都抛（模拟隐私模式）。 */
const storage = (
  initial: Record<string, string> = {},
  options: { fail?: boolean } = {},
): TabStorage & {
  readonly data: Map<string, string>;
} => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key) {
      if (options.fail) throw new Error('storage disabled');
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (options.fail) throw new Error('storage disabled');
      data.set(key, value);
    },
  };
};

describe('parseTabId —— 存储值 → 分区 id', () => {
  test('表里的 id 原样返回', () => {
    assert.equal(parseTabId('audio'), 'audio');
    assert.equal(parseTabId('pet'), 'pet');
  });

  test('未知值、空串、null 都回落 null', () => {
    for (const raw of [null, '', 'legacy-tab', 'PET']) {
      assert.equal(parseTabId(raw), null, `${String(raw)} 不该被当作分区`);
    }
  });
});

describe('readSavedTab —— 读上次停留的分区', () => {
  test('记过就回到那一页', () => {
    assert.equal(readSavedTab(storage({ [TAB_STORAGE_KEY]: 'chat' })), 'chat');
  });

  test('没记过、值为失效 id 时都是 null', () => {
    assert.equal(readSavedTab(storage()), null);
    assert.equal(readSavedTab(storage({ [TAB_STORAGE_KEY]: 'removed-tab' })), null);
  });

  test('没有存储或存储抛错时同样 null', () => {
    assert.equal(readSavedTab(null), null);
    assert.equal(readSavedTab(storage({ [TAB_STORAGE_KEY]: 'audio' }, { fail: true })), null);
  });
});

describe('saveTab —— 记住当前分区', () => {
  test('写进约定的键', () => {
    const fake = storage();
    saveTab(fake, 'system');
    assert.equal(fake.data.get(TAB_STORAGE_KEY), 'system');
  });

  test('没有存储或写入抛错时静默跳过：切换分区不能因此失败', () => {
    assert.doesNotThrow(() => saveTab(null, 'audio'));
    assert.doesNotThrow(() => saveTab(storage({}, { fail: true }), 'audio'));
  });
});
