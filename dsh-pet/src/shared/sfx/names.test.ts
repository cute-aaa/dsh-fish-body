/**
 * 文件名解析（src/shared/sfx/names.ts）与撞击增益（impact.ts）的契约：
 * 谁归哪个槽、皮肤前缀什么时候剥、`bump` 怎么兜底，以及碰撞响度的边界。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { BUMP_SLOT, DEFAULT_EVENT_FILES, canonicalSlotOf } from './defaults.ts';
import { impactGain, IMPACT_MIN_SPEED } from './impact.ts';
import { parseSfxFileName, stripAudioExt, withSkinPrefix } from './names.ts';

describe('parseSfxFileName', () => {
  test('槽名即文件名：不分皮肤、带扩展名也认', () => {
    const hit = parseSfxFileName('click.wav');
    assert.deepEqual(hit, { kind: 'slot', skin: '', slot: 'click' });
    assert.equal(parseSfxFileName('sleep-start.ogg')?.slot, 'sleepStart');
    assert.equal(parseSfxFileName('sleepEnd.wav')?.slot, 'sleepEnd');
  });

  test('皮肤前缀：命中已知皮肤才剥，长的优先', () => {
    const skins = ['beiluoye', 'beiluoye-x'];
    assert.deepEqual(parseSfxFileName('beiluoye-x-click.wav', skins), {
      kind: 'slot',
      skin: 'beiluoye-x',
      slot: 'click',
    });
    assert.deepEqual(parseSfxFileName('beiluoye-click.wav', skins), {
      kind: 'slot',
      skin: 'beiluoye',
      slot: 'click',
    });
    // 不在清单里的前缀不剥：整串当动画名，避免把动画名误切成「皮肤 + 槽名」。
    assert.equal(parseSfxFileName('unknown-click.wav', skins)?.kind, 'anim');
    assert.equal(parseSfxFileName('unknown-click.wav', skins)?.name, 'unknown-click');
  });

  test('非槽名当动作音；hook- 前缀归 hook', () => {
    assert.deepEqual(parseSfxFileName('写代码.wav'), { kind: 'anim', name: '写代码', skin: '' });
    assert.deepEqual(parseSfxFileName('hook-ding.wav'), { kind: 'hook', name: 'ding', skin: '' });
    assert.deepEqual(parseSfxFileName('beiluoye-hook-ding.wav', ['beiluoye']), {
      kind: 'hook',
      name: 'ding',
      skin: 'beiluoye',
    });
  });

  test('bump 是碰撞三槽的兜底名', () => {
    assert.equal(parseSfxFileName('bump.wav')?.kind, 'bump');
    assert.equal(parseSfxFileName(BUMP_SLOT + '.mp3')?.kind, 'bump');
  });

  test('空名与只有皮肤前缀的名字都不成立', () => {
    assert.equal(parseSfxFileName(''), null);
    assert.equal(parseSfxFileName('.wav'), null);
    assert.equal(parseSfxFileName('beiluoye-.wav', ['beiluoye']), null);
  });

  test('stripAudioExt / withSkinPrefix 与解析同口径', () => {
    assert.equal(stripAudioExt('Click.WAV'), 'Click');
    assert.equal(stripAudioExt('写代码'), '写代码');
    assert.equal(withSkinPrefix('beiluoye', 'click', '.wav'), 'beiluoye-click.wav');
    assert.equal(withSkinPrefix('', 'click', '.wav'), 'click.wav');
  });
});

describe('canonicalSlotOf / DEFAULT_EVENT_FILES', () => {
  test('槽名别名与默认文件覆盖九个事件槽（睡眠两段故意没有默认）', () => {
    assert.equal(canonicalSlotOf('SLEEP_START'), 'sleepStart');
    assert.equal(canonicalSlotOf('bump'), undefined, 'bump 不是槽位，由 parseSfxFileName 单独判');
    assert.equal(canonicalSlotOf('写代码'), undefined);
    assert.equal(DEFAULT_EVENT_FILES.click, 'click-duck.wav');
    assert.equal(DEFAULT_EVENT_FILES.floor, DEFAULT_EVENT_FILES.wall);
    assert.equal(DEFAULT_EVENT_FILES.sleepStart, undefined);
  });
});

describe('impactGain', () => {
  test('轻碰与静置不响，硬砸满响，中间线性', () => {
    assert.equal(impactGain(IMPACT_MIN_SPEED - 1), null);
    assert.equal(impactGain(0), null);
    assert.equal(impactGain(Number.NaN), null);
    const soft = impactGain(300);
    const mid = impactGain(900);
    const hard = impactGain(1500);
    assert.ok(soft !== null && mid !== null && hard !== null);
    assert.ok(soft < mid && mid < hard, '速度越大越响');
    assert.equal(hard, 1, '硬砸到顶就是满响');
    assert.ok((impactGain(200) ?? 0) <= soft, '刚过阈值时不会比软碰更响（两者都在起始档）');
    assert.equal(impactGain(5000), 1, '超过硬砸锚点仍按满响夹住');
  });
});
