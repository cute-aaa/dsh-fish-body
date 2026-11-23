/**
 * 音效两个口径（src/client/settings/sfx-view.ts）的契约测试。
 *
 * 三条契约：
 *   1. `switchesIgnored` 只抹 `enabled`，其余字段（file / volume / lane…）一个不动；
 *   2. 抹掉开关之后，解析器仍然能算出「这一槽有文件」——这是试听在开关关着时仍可用的前提；
 *   3. `slotSwitchOn` 直接读配置：没写过覆盖算开，变体数组按「每一项都开着」算。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveSfx } from '../../shared/sfx/resolve.ts';
import { slotSwitchOn, switchesIgnored } from './sfx-view.ts';

describe('switchesIgnored —— 只抹开关', () => {
  test('事件 / 动画 / hook 三段都抹掉 enabled，其余字段保留', () => {
    const stripped = switchesIgnored({
      events: { click: { enabled: true, file: 'a.wav', volume: 0.4 }, throw: [{ enabled: false, file: 'b.wav' }] },
      animations: { idle: [{ enabled: false, file: 'c.wav', at: 200 }] },
      hooks: { ding: { enabled: false, volume: 0.2 } },
    });
    assert.deepEqual(stripped.events?.click, { file: 'a.wav', volume: 0.4 });
    assert.deepEqual(stripped.events?.throw, [{ file: 'b.wav' }]);
    assert.deepEqual(stripped.animations?.idle, [{ file: 'c.wav', at: 200 }]);
    assert.deepEqual(stripped.hooks?.ding, { volume: 0.2 });
  });

  test('本来就是空的段不凭空造出来', () => {
    assert.deepEqual(switchesIgnored({}), {});
  });
});

describe('开关关着时的解析口径', () => {
  const layer = { events: { click: { enabled: false, file: 'click-duck.wav' } } };

  test('运行时口径：关掉的槽位解析为 null（不出声）', () => {
    assert.equal(resolveSfx({ layers: [layer], lane: 'web' }).slot('click'), null);
  });

  test('预览口径：同一个槽位仍然能解析出文件（可试听）', () => {
    const cue = resolveSfx({ layers: [switchesIgnored(layer)], lane: 'web' }).slot('click');
    assert.ok(cue, '关掉开关不该抹掉「有没有文件」');
    assert.equal(cue.file, 'click-duck.wav');
  });

  test('没有文件的槽位两个口径都是 null（此时试听才该禁用）', () => {
    // 睡眠两段没有内置默认音（见 shared/sfx/defaults），没放文件就是真的没有。
    assert.equal(resolveSfx({ layers: [switchesIgnored({})], lane: 'web' }).slot('sleepStart'), null);
  });
});

describe('slotSwitchOn —— 直接读配置的开关', () => {
  test('没写过覆盖：默认开', () => {
    assert.equal(slotSwitchOn(undefined, 'click'), true);
    assert.equal(slotSwitchOn({}, 'click'), true);
  });

  test('单条 cue：只有明确 false 才算关', () => {
    assert.equal(slotSwitchOn({ click: { enabled: false } }, 'click'), false);
    assert.equal(slotSwitchOn({ click: { enabled: true } }, 'click'), true);
    assert.equal(slotSwitchOn({ click: { file: 'x.wav' } }, 'click'), true);
  });

  test('变体数组：任一项关掉就算关（设置页会把 enabled 落到每一项上）', () => {
    assert.equal(slotSwitchOn({ click: [{ enabled: false }, { enabled: false }] }, 'click'), false);
    assert.equal(slotSwitchOn({ click: [{ enabled: true }, { enabled: false }] }, 'click'), false);
    assert.equal(slotSwitchOn({ click: [{ enabled: true }, { enabled: true }] }, 'click'), true);
  });
});
