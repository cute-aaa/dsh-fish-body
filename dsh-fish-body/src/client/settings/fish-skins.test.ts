/**
 * 会话鱼皮肤分组（src/client/settings/fish-skins.ts）的契约测试。
 *
 * 三条契约：
 *   1. 清单按来源分成内置 / 我的，顺序保持宿主给的顺序；
 *   2. 当前项文案取自清单，找不到时回落到皮肤 id（不能显示成空白下拉）；
 *   3. 「已失效」只在「选了具体皮肤 + 清单已到 + 清单里没有」时成立——清单没到时不能闪一句失效。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { fishSkinView } from './fish-skins.ts';

const skins = [
  { id: 'pack-a', label: '写代码', kind: 'video' as const, source: 'pack' as const },
  { id: 'mine-b', label: '我的鱼', kind: 'image' as const, source: 'user' as const },
];

describe('fishSkinView —— 皮肤清单分组', () => {
  test('按来源分组，保持原顺序', () => {
    const view = fishSkinView(skins, '', 'pack-a');
    assert.deepEqual(
      view.pack.map((item) => item.id),
      ['pack-a'],
    );
    assert.deepEqual(
      view.user.map((item) => item.id),
      ['mine-b'],
    );
  });

  test('当前项：清单里有就用 label，没有就回落到 id', () => {
    assert.equal(fishSkinView(skins, '', 'mine-b').currentLabel, '我的鱼');
    assert.equal(fishSkinView(skins, '', 'gone').currentLabel, 'gone');
  });

  test('失效判定：只认「选了具体皮肤 + 清单已到 + 不在清单里」', () => {
    assert.equal(fishSkinView(skins, 'gone', 'gone').missing, true);
    assert.equal(fishSkinView(skins, '', 'pack-a').missing, false, '空串 = 默认皮肤，不算失效');
    assert.equal(fishSkinView(null, 'gone', 'gone').missing, false, '清单还没到时不能判失效');
  });

  test('清单未到时分组为空，不抛错', () => {
    const view = fishSkinView(null, '', 'pack-a');
    assert.deepEqual(view.pack, []);
    assert.deepEqual(view.user, []);
  });
});
