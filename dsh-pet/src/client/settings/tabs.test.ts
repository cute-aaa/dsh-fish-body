/**
 * 分区表（src/client/settings/tabs.ts）的契约测试。
 *
 * 三条契约：
 *   1. id 唯一且默认分区在表里——面板表按 id 展开，重复 id 会让两个分区抢同一个面板；
 *   2. 每个分区的 `titleKey` 都在 zh 字典里——漏翻译会直接印出键名；
 *   3. 两种 DOM id 各不相同——按钮与面板的 `aria-controls` / `aria-labelledby` 靠它们配对。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS_TAB, SETTINGS_TABS, tabButtonId, tabPanelId } from './tabs.ts';
import { zh } from './locales/index.ts';

describe('SETTINGS_TABS —— 设置页分区表', () => {
  test('id 唯一，且顺序即展示顺序', () => {
    const ids = SETTINGS_TABS.map((tab) => tab.id);
    assert.equal(new Set(ids).size, ids.length, '分区 id 必须唯一');
    assert.deepEqual(ids, ['pet', 'fish', 'behavior', 'look', 'audio', 'chat', 'system']);
  });

  test('默认分区在表里', () => {
    assert.ok(
      SETTINGS_TABS.some((tab) => tab.id === DEFAULT_SETTINGS_TAB),
      '默认分区必须存在，否则首屏找不到面板',
    );
  });

  test('每个分区的标题键都在字典里', () => {
    const keys = new Set(Object.keys(zh));
    for (const tab of SETTINGS_TABS) {
      assert.ok(keys.has(tab.titleKey), `分区 ${tab.id} 的标题键 ${tab.titleKey} 不在字典里`);
    }
  });

  test('按钮 id 与面板 id 不重复', () => {
    const all = SETTINGS_TABS.flatMap((tab) => [tabButtonId(tab.id), tabPanelId(tab.id)]);
    assert.equal(new Set(all).size, all.length, '分区之间的 DOM id 不能撞');
  });
});
