/**
 * live2d 动作时长的契约测试：宿主注入的 Duration 优先，缺字段按兜底秒数，收尾留白只加一次。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  motionDurationsOf,
  motionHoldMs,
  hasIdleMotion,
  DEFAULT_MOTION_SECONDS,
  MOTION_TAIL_SECONDS,
} from './live2d-motions.ts';

/** 一份带两个 motion 组的模型清单。 */
const settings = {
  FileReferences: {
    Motions: {
      Animation: [
        { File: 'Animation/a.motion3.json', Name: 'a', Duration: 1.133 },
        { File: 'Animation/b.motion3.json' },
      ],
      Idle: [{ File: 'Animation/idle.motion3.json', Duration: 3 }],
    },
  },
};

describe('motionDurationsOf —— 从清单抠时长', () => {
  test('按「组:序号」建表，缺 Duration 的条目不入表', () => {
    assert.deepEqual(motionDurationsOf(settings), { 'Animation:0': 1.133, 'Idle:0': 3 });
  });

  test('没有 Motions 或结构不对 → 空表', () => {
    assert.deepEqual(motionDurationsOf({}), {});
    assert.deepEqual(motionDurationsOf(null), {});
    assert.deepEqual(motionDurationsOf({ FileReferences: { Motions: [] } }), {});
  });
});

describe('motionHoldMs —— 起播到复位等多久', () => {
  test('表里有值就用它，再加收尾留白', () => {
    const durations = motionDurationsOf(settings);
    assert.equal(motionHoldMs(durations, 'Animation', 0), Math.round((1.133 + MOTION_TAIL_SECONDS) * 1000));
  });

  test('表里没有就用兜底秒数，越界序号不抛错', () => {
    const durations = motionDurationsOf(settings);
    assert.equal(
      motionHoldMs(durations, 'Animation', 9),
      Math.round((DEFAULT_MOTION_SECONDS + MOTION_TAIL_SECONDS) * 1000),
    );
  });
});

describe('hasIdleMotion —— 收尾后要不要接回待机', () => {
  test('有 Idle 组才接回', () => {
    assert.equal(hasIdleMotion(motionDurationsOf(settings)), true);
    assert.equal(hasIdleMotion({ 'Animation:0': 1 }), false);
    assert.equal(hasIdleMotion({}), false);
  });
});
