/**
 * 覆盖层解析（src/shared/sfx/resolve.ts）的契约：
 * 索引给文件、覆盖层给参数、后写的层压前面的层、关掉的槽不响、lane 与动画时间线各走各的。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeLayer, resolveSfx } from './resolve.ts';
import type { SfxIndex, SfxLayer } from '../types.ts';

/** 一份「磁盘上什么都没有」的索引。 */
const emptyIndex: SfxIndex = { animations: {}, events: {}, hooks: {}, origin: {} };

/** 一份「皮肤目录里有 click、动画目录里有写代码」的索引。 */
const skinIndex: SfxIndex = {
  animations: { 写代码: '写代码.wav' },
  events: { click: 'beiluoye-click.wav' },
  hooks: { ding: 'hook-ding.wav' },
  origin: { click: 'skin' },
};

describe('resolveSfx —— 事件槽', () => {
  test('没有索引也没有配置：走内置默认并标注来源', () => {
    const cue = resolveSfx({ index: emptyIndex, lane: 'web' }).slot('click');
    assert.equal(cue?.file, 'click-duck.wav');
    assert.equal(cue?.origin, 'package-default');
    assert.equal(cue?.throttleMs, 100, '点击的缺省节流是 100ms');
  });

  test('睡眠两段没有内置默认：什么都不配就不响', () => {
    assert.equal(resolveSfx({ index: emptyIndex, lane: 'web' }).slot('sleepStart'), null);
  });

  test('索引优先于内置默认；配置的 file 又压过索引', () => {
    const indexCue = resolveSfx({ index: skinIndex, lane: 'web' }).slot('click');
    assert.equal(indexCue?.file, 'beiluoye-click.wav');
    assert.equal(indexCue?.origin, 'skin');
    const configCue = resolveSfx({
      index: skinIndex,
      layers: [{ events: { click: { file: 'mine.wav' } } }],
      lane: 'web',
    }).slot('click');
    assert.equal(configCue?.file, 'mine.wav');
    assert.equal(configCue?.origin, 'config');
  });

  test('只写音量不写文件：文件仍来自索引', () => {
    const cue = resolveSfx({ index: skinIndex, layers: [{ events: { click: { volume: 0.2 } } }], lane: 'web' }).slot(
      'click',
    );
    assert.equal(cue?.file, 'beiluoye-click.wav');
    assert.equal(cue?.volume, 0.2);
  });

  test('enabled:false 关掉整槽，连索引里的文件也不播', () => {
    const cue = resolveSfx({ index: skinIndex, layers: [{ events: { click: { enabled: false } } }], lane: 'web' }).slot(
      'click',
    );
    assert.equal(cue, null);
  });

  test('lane 不合就不播；both 与缺省都两端播', () => {
    const layers: SfxLayer[] = [{ events: { click: { lane: 'desktop' }, throw: { lane: 'both' } } }];
    assert.equal(resolveSfx({ index: skinIndex, layers, lane: 'web' }).slot('click'), null);
    assert.ok(resolveSfx({ index: skinIndex, layers, lane: 'desktop' }).slot('click') !== null);
    assert.ok(resolveSfx({ index: skinIndex, layers, lane: 'web' }).slot('throw') !== null);
  });

  test('后写的层压前面的层：按渲染方式与按皮肤的覆盖生效', () => {
    const layers: SfxLayer[] = [
      { events: { throw: { volume: 0.1 } } },
      { events: { throw: { volume: 0.6 } } },
      { events: { throw: { volume: 0.9 } } },
    ];
    assert.equal(resolveSfx({ index: emptyIndex, layers, lane: 'web' }).slot('throw')?.volume, 0.9);
  });

  test('数组是变体：每次都落在给定的某一条上', () => {
    const layers: SfxLayer[] = [{ events: { click: [{ volume: 0 }, { volume: 1 }] } }];
    const plan = resolveSfx({ index: skinIndex, layers, lane: 'web' });
    for (let index = 0; index < 20; index += 1) {
      const cue = plan.slot('click');
      assert.ok(cue !== null);
      assert.ok(cue.volume === 0 || cue.volume === 1, '只可能是两个变体之一');
    }
  });
});

describe('resolveSfx —— 动作音与 hook', () => {
  test('动画名命中索引：一条 at=0 的 cue，不节流', () => {
    const cues = resolveSfx({ index: skinIndex, lane: 'web' }).anim('写代码');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].file, '写代码.wav');
    assert.equal(cues[0].at, 0);
    assert.equal(cues[0].throttleMs, 0, '同一段动画里的多个点不该互相吃掉');
  });

  test('数组是时间线：每一项保留自己的 at / everyMs', () => {
    const layers: SfxLayer[] = [
      {
        animations: {
          写代码: [
            { file: 'a.wav', at: 0 },
            { file: 'b.wav', at: 1200, everyMs: 400 },
          ],
        },
      },
    ];
    const cues = resolveSfx({ index: emptyIndex, layers, lane: 'web' }).anim('写代码');
    assert.deepEqual(
      cues.map((cue) => [cue.file, cue.at, cue.everyMs]),
      [
        ['a.wav', 0, null],
        ['b.wav', 1200, 400],
      ],
    );
  });

  test('没有绑定的动画不响', () => {
    assert.deepEqual(resolveSfx({ index: skinIndex, lane: 'web' }).anim('放烟花'), []);
  });

  test('hook：索引与配置都认，配置优先', () => {
    assert.equal(resolveSfx({ index: skinIndex, lane: 'web' }).hook('ding')?.file, 'hook-ding.wav');
    const overridden = resolveSfx({ index: skinIndex, layers: [{ hooks: { ding: { file: 'x.wav' } } }], lane: 'web' });
    assert.equal(overridden.hook('ding')?.file, 'x.wav');
    assert.equal(overridden.hook('nope'), null);
  });
});

describe('normalizeLayer', () => {
  test('丢掉未知段与非法项，保留合法项', () => {
    const warnings: string[] = [];
    const layer = normalizeLayer(
      {
        events: { click: { volume: 0.5 }, nope: { volume: 1 } },
        nope: {},
        animations: { 写代码: { file: 'k.wav' } },
      },
      (message) => warnings.push(message),
    );
    assert.deepEqual(layer?.events, { click: { volume: 0.5 } });
    assert.deepEqual(layer?.animations, { 写代码: { file: 'k.wav' } });
    assert.ok(
      warnings.some((message) => message.includes('nope')),
      '未知段与未知槽都要告警',
    );
  });

  test('非法 cue 值只丢字段、不整段作废', () => {
    const layer = normalizeLayer({ events: { click: { volume: 3, lane: 'up', file: 'c.wav' } } });
    assert.deepEqual(layer?.events?.click, { file: 'c.wav' });
  });

  test('不是对象就返回 undefined', () => {
    assert.equal(normalizeLayer(null), undefined);
    assert.equal(normalizeLayer([]), undefined);
    assert.equal(normalizeLayer({}), undefined);
  });
});
