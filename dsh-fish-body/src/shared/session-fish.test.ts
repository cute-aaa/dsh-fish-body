/**
 * 会话鱼 wire 解析与展示判定：形状容错、气泡窗口、播报去重、上限排序。
 * @module dsh-fish-body/src/shared/session-fish.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveSessionFishSkin,
  isSessionFishBubbleVisible,
  isSessionFishSkinName,
  ownsSessionFishSpeech,
  readSessionFish,
  selectSessionFishes,
  sessionFishSkinKindOf,
  sessionFishSpeechOf,
  SESSION_FISH_SKIN_DEFAULT,
  type SessionFishEntry,
} from './session-fish.ts';

/** 一条合法鱼（可覆盖字段）。 */
function entry(over: Partial<SessionFishEntry> = {}): SessionFishEntry {
  return {
    sessionId: 's1',
    state: 'working',
    task: '改 index.ts',
    line: '正在改 index.ts',
    lineKind: 'progress',
    lineSeq: 3,
    lineAt: 1_000,
    done: false,
    planPending: false,
    createdAt: 500,
    updatedAt: 900,
    ...over,
  };
}

describe('readSessionFish', () => {
  test('合法快照：字段完整保留', () => {
    const snap = readSessionFish({ enabled: true, sizePx: 72, maxCount: 4, bubbleMs: 8000, fishes: [entry()] });
    assert.ok(snap);
    assert.equal(snap.enabled, true);
    assert.equal(snap.sizePx, 72);
    assert.equal(snap.fishes.length, 1);
    assert.equal(snap.fishes[0]?.line, '正在改 index.ts');
  });

  test('顶层形状非法：返回 null（整拍跳过）', () => {
    assert.equal(readSessionFish(null), null);
    assert.equal(readSessionFish({ fishes: [] }), null);
    assert.equal(readSessionFish({ enabled: 'yes', fishes: [] }), null);
  });

  test('单条鱼脏数据：只丢那一条，不拖垮整份快照', () => {
    const snap = readSessionFish({ enabled: true, fishes: [{ sessionId: 'bad', state: 'nope' }, entry()] });
    assert.ok(snap);
    assert.equal(snap.fishes.length, 1);
    assert.equal(snap.fishes[0]?.sessionId, 's1');
  });

  test('缺省显示参数：回落默认值而不是 NaN', () => {
    const snap = readSessionFish({ enabled: false, fishes: [] });
    assert.ok(snap);
    assert.equal(snap.sizePx, 96);
    assert.equal(snap.maxCount, 6);
    assert.equal(snap.bubbleMs, 12_000);
    assert.equal(snap.speakProgress, true);
  });

  test('皮肤与跟随：缺省用默认皮肤并跟着桌宠', () => {
    const snap = readSessionFish({ enabled: true, fishes: [] });
    assert.ok(snap);
    assert.equal(snap.skin, SESSION_FISH_SKIN_DEFAULT);
    assert.equal(snap.skinKind, 'video');
    assert.equal(snap.followPet, true);
  });

  test('皮肤渲染方式跟着扩展名走，脏名字退回默认皮肤', () => {
    const image = readSessionFish({ enabled: true, skin: '我的鱼.gif', skinKind: 'video', fishes: [] });
    assert.ok(image);
    assert.equal(image.skin, '我的鱼.gif');
    assert.equal(image.skinKind, 'image', '以 id 为准，不信宿主写错的 skinKind');
    const dirty = readSessionFish({ enabled: true, skin: '../package.json', fishes: [] });
    assert.ok(dirty);
    assert.equal(dirty.skin, SESSION_FISH_SKIN_DEFAULT);
    assert.equal(dirty.followPet, true);
    assert.equal(readSessionFish({ enabled: true, followPet: false, fishes: [] })?.followPet, false);
  });
});

describe('skin 判定', () => {
  test('扩展名 → 渲染方式', () => {
    assert.equal(sessionFishSkinKindOf('写代码.webm'), 'video');
    assert.equal(sessionFishSkinKindOf('clip.MP4'), 'video');
    assert.equal(sessionFishSkinKindOf('cat.gif'), 'image');
    assert.equal(sessionFishSkinKindOf('cat.JPEG'), 'image');
    assert.equal(sessionFishSkinKindOf('cat.webp'), 'image');
    assert.equal(sessionFishSkinKindOf('note.txt'), null);
    assert.equal(sessionFishSkinKindOf('noext'), null);
    assert.equal(sessionFishSkinKindOf(null), null);
  });

  test('皮肤名只允许一个文件名：路径、点开头、控制字符、超长都拒', () => {
    assert.equal(isSessionFishSkinName(''), true, '空串 = 用默认皮肤');
    assert.equal(isSessionFishSkinName('我的鱼.gif'), true);
    assert.equal(isSessionFishSkinName('a/b.png'), false);
    assert.equal(isSessionFishSkinName('a\\b.png'), false);
    assert.equal(isSessionFishSkinName('../x.png'), false);
    assert.equal(isSessionFishSkinName('.hidden.png'), false);
    assert.equal(isSessionFishSkinName('a\u0000.png'), false);
    assert.equal(isSessionFishSkinName('x'.repeat(200) + '.png'), false);
    assert.equal(isSessionFishSkinName('readme.md'), false);
  });

  test('生效皮肤：空串/脏值换默认名', () => {
    assert.equal(effectiveSessionFishSkin(''), SESSION_FISH_SKIN_DEFAULT);
    assert.equal(effectiveSessionFishSkin(undefined), SESSION_FISH_SKIN_DEFAULT);
    assert.equal(effectiveSessionFishSkin('../x.png'), SESSION_FISH_SKIN_DEFAULT);
    assert.equal(effectiveSessionFishSkin('我的鱼.gif'), '我的鱼.gif');
  });
});

describe('ownsSessionFishSpeech', () => {
  test('有鱼且两个开关都开着才接管', () => {
    assert.equal(ownsSessionFishSpeech({ enabled: true, speakEnabled: true, fishes: [entry()] }), true);
    assert.equal(ownsSessionFishSpeech({ enabled: true, speakEnabled: false, fishes: [entry()] }), false);
    assert.equal(ownsSessionFishSpeech({ enabled: false, speakEnabled: true, fishes: [entry()] }), false);
    assert.equal(ownsSessionFishSpeech({ enabled: true, speakEnabled: true, fishes: [] }), false);
    assert.equal(ownsSessionFishSpeech(null), false);
  });
});

describe('isSessionFishBubbleVisible', () => {
  test('完成态常驻：即使播报早已过期也显示', () => {
    const fish = entry({ done: true, lineAt: 0 });
    assert.equal(isSessionFishBubbleVisible(fish, 10_000_000, 12_000), true);
  });

  test('进行中：只有停留窗口内显示', () => {
    const fish = entry({ done: false, lineAt: 1_000 });
    assert.equal(isSessionFishBubbleVisible(fish, 5_000, 12_000), true);
    assert.equal(isSessionFishBubbleVisible(fish, 13_001, 12_000), false);
  });

  test('没有播报：不显示空气泡', () => {
    assert.equal(isSessionFishBubbleVisible(entry({ line: null }), 1_100, 12_000), false);
  });
});

describe('sessionFishSpeechOf', () => {
  const settings = { speakEnabled: true, speakProgress: true, speakTurnEnd: true, speakWaiting: true };

  test('首见（undefined）只记基线不念', () => {
    assert.equal(sessionFishSpeechOf(entry(), undefined, settings), undefined);
  });

  test('同一序号不重复念', () => {
    assert.equal(sessionFishSpeechOf(entry({ lineSeq: 3 }), 3, settings), undefined);
  });

  test('新序号按类型开关决定', () => {
    assert.equal(sessionFishSpeechOf(entry({ lineSeq: 4 }), 3, settings), '正在改 index.ts');
    assert.equal(sessionFishSpeechOf(entry({ lineSeq: 4 }), 3, { ...settings, speakProgress: false }), undefined);
    assert.equal(
      sessionFishSpeechOf(entry({ lineSeq: 4, lineKind: 'turnEnd' }), 3, { ...settings, speakTurnEnd: false }),
      undefined,
    );
    assert.equal(sessionFishSpeechOf(entry({ lineSeq: 4, lineKind: 'done' }), 3, settings), '正在改 index.ts');
    assert.equal(sessionFishSpeechOf(entry({ lineSeq: 4, lineKind: 'idle' }), 3, settings), undefined);
  });

  test('总开关关掉：哪一类都不念（气泡照常）', () => {
    assert.equal(sessionFishSpeechOf(entry({ lineSeq: 4 }), 3, { ...settings, speakEnabled: false }), undefined);
    assert.equal(
      sessionFishSpeechOf(entry({ lineSeq: 4, lineKind: 'turnEnd' }), 3, { ...settings, speakEnabled: false }),
      undefined,
    );
  });

  test('等待态归 speakWaiting：即使 speakProgress 关掉也能念', () => {
    const waiting = entry({ lineSeq: 4, state: 'waiting', line: '等你确认：计划' });
    assert.equal(
      sessionFishSpeechOf(waiting, 3, { ...settings, speakProgress: false, speakWaiting: true }),
      '等你确认：计划',
    );
    assert.equal(sessionFishSpeechOf(waiting, 3, { ...settings, speakProgress: true, speakWaiting: false }), undefined);
  });
});

describe('selectSessionFishes', () => {
  test('先按最近活动截到上限', () => {
    const old = entry({ sessionId: 'old', updatedAt: 100 });
    const mid = entry({ sessionId: 'mid', updatedAt: 200 });
    const fresh = entry({ sessionId: 'fresh', updatedAt: 300 });
    assert.deepEqual(
      selectSessionFishes([old, fresh, mid], 2)
        .map((f) => f.sessionId)
        .sort(),
      ['fresh', 'mid'],
    );
  });

  test('截断后按创建先后排稳定位置：别的鱼活动不会让默认堆叠换位', () => {
    const first = entry({ sessionId: 'first', createdAt: 100, updatedAt: 900 });
    const second = entry({ sessionId: 'second', createdAt: 200, updatedAt: 100 });
    assert.deepEqual(
      selectSessionFishes([second, first], 6).map((f) => f.sessionId),
      ['first', 'second'],
    );
  });

  test('上限非法时至少保留一条', () => {
    assert.equal(selectSessionFishes([entry()], 0).length, 1);
  });
});
