/**
 * live2d 叠加层的单元测试：叠队列、定格、开关与上限。
 *
 * 这一段是「动作能叠、外观能多选」的全部逻辑，两端（网页 TS / 桌面 JS）同构实现，
 * 而真跑一条 pixi + Cubism 模型太重——所以这里用替身的 cubism 入口把状态机单独钉住：
 * 每条叠加物是否独立成队、播完是丢弃还是定格、同 key 再点是否重播。
 * 跑法：node --experimental-strip-types --test src/client/pet/render/live2d/overlay.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createOverlay, type OverlayApi, type OverlayMotion, type OverlayQueue } from './overlay.ts';

/** 替身动作对象：记录淡入与循环设置（字段可变，便于断言实际被设成什么）。 */
interface FakeMotion {
  loop: boolean | undefined;
  fadeIn: number | undefined;
  fadeOut: number | undefined;
}

/** 替身队列：按「推进几次算播完」模拟结束，其它与 Cubism 的队列同形。 */
class FakeQueue implements OverlayQueue {
  readonly motions: OverlayMotion[] = [];
  ticks = 0;
  finishedAfter = 1;
  stopped = false;
  callback: (() => void) | undefined;

  setEventCallback(callback: () => void): void {
    this.callback = callback;
  }

  startMotion(motion: OverlayMotion): unknown {
    this.motions.push(motion);
    this.ticks = 0;
    return this.motions.length;
  }

  doUpdateMotion(): boolean {
    this.ticks += 1;
    return true;
  }

  isFinished(): boolean {
    return this.stopped || this.ticks >= this.finishedAfter;
  }

  stopAllMotions(): void {
    this.stopped = true;
    this.motions.length = 0;
  }
}

/** 造一个替身动作：字段挂在对象上，设置方法写回同一份字段。 */
function makeFakeMotion(): FakeMotion & {
  setIsLoop(loop: boolean): void;
  setFadeInTime(seconds: number): void;
  setFadeOutTime(seconds: number): void;
} {
  const motion = {
    loop: undefined as boolean | undefined,
    fadeIn: undefined as number | undefined,
    fadeOut: undefined as number | undefined,
    setIsLoop(loop: boolean) {
      motion.loop = loop;
    },
    setFadeInTime(seconds: number) {
      motion.fadeIn = seconds;
    },
    setFadeOutTime(seconds: number) {
      motion.fadeOut = seconds;
    },
  };
  return motion;
}

/** 造一套替身 cubism 入口，并把造出来的队列按创建顺序存起来供断言。 */
function makeApi() {
  const queues: FakeQueue[] = [];
  const api: OverlayApi = {
    CubismMotion: {
      create: () => makeFakeMotion(),
    },
    CubismExpressionMotion: {
      create: () => ({
        setFadeInTime: () => {},
        setFadeOutTime: () => {},
      }),
    },
    CubismMotionQueueManager: class {
      constructor() {
        const queue = new FakeQueue();
        queues.push(queue);
        return queue;
      }
    } as unknown as OverlayApi['CubismMotionQueueManager'],
  };
  return { api, queues };
}

/** 替身 coreModel：记录写回的参数。 */
function makeCore() {
  const writes: Array<[string, number]> = [];
  const opacities: Array<[string, number]> = [];
  return {
    writes,
    opacities,
    model: {
      setParameterValueById: (id: string, value: number) => writes.push([id, value]),
      setPartOpacityById: (id: string, value: number) => opacities.push([id, value]),
    },
  };
}

/** 一份带两条曲线的动作文件（末帧 = 最后一段的终点）。 */
const motionJson = {
  Meta: { Duration: 1 },
  Curves: [
    { Target: 'Parameter', Id: 'ParamArmL', Segments: [0, 0, 0, 1, 1] },
    { Target: 'PartOpacity', Id: 'PartArmR', Segments: [0, 1, 0, 1, 1] },
  ],
};

describe('createOverlay —— 动作叠加', () => {
  test('每条一个独立队列；非定格动作播完自动出队', () => {
    const { api, queues } = makeApi();
    const core = makeCore();
    const overlay = createOverlay(
      api,
      () => core.model,
      () => 1000,
    );
    overlay.play('motion:A:0', 'motion', motionJson);
    overlay.play('motion:A:1', 'motion', motionJson);
    assert.equal(queues.length, 2, '两条动作各有自己的队列（否则后一条会掐掉前一条）');
    assert.deepEqual(overlay.active('motion'), ['motion:A:0', 'motion:A:1']);
    overlay.tick();
    overlay.tick();
    assert.deepEqual(overlay.active('motion'), [], '没定格标记的播完就摘掉');
  });

  test('定格动作：播完后每帧写末帧姿态（参数与部件显隐分开写）', () => {
    const { api } = makeApi();
    const core = makeCore();
    const overlay = createOverlay(
      api,
      () => core.model,
      () => 1000,
    );
    overlay.play('motion:A:0', 'motion', motionJson, { hold: true, raw: motionJson });
    overlay.tick(); // 本次推进即播完 → 标记定格
    overlay.tick(); // 之后只写定格
    assert.deepEqual(overlay.active('motion'), ['motion:A:0'], '定格的动作留在层里');
    assert.ok(
      core.writes.some(([id, value]) => id === 'ParamArmL' && value === 1),
      '参数末帧写回',
    );
    assert.ok(
      core.opacities.some(([id, value]) => id === 'PartArmR' && value === 1),
      '部件显隐走 setPartOpacityById',
    );
  });

  test('同一条重复点 = 重播：先停旧队列再起新的', () => {
    const { api, queues } = makeApi();
    const core = makeCore();
    const overlay = createOverlay(
      api,
      () => core.model,
      () => 1000,
    );
    overlay.play('motion:A:0', 'motion', motionJson);
    overlay.play('motion:A:0', 'motion', motionJson);
    assert.equal(queues.length, 2);
    assert.equal(queues[0]?.stopped, true, '旧队列必须被停掉');
    assert.equal(overlay.active('motion').length, 1);
  });

  test('淡入随 FadeSecondsAmount 下发；动作一律 setIsLoop(false)', () => {
    const { api, queues } = makeApi();
    const core = makeCore();
    const overlay = createOverlay(
      api,
      () => core.model,
      () => 1000,
    );
    overlay.play('motion:A:0', 'motion', motionJson, { fadeSeconds: 0.2 });
    // 队列里存的是替身动作对象本身（makeFakeMotion 的字段挂在它上面）
    const motion = queues[0]?.motions[0] as FakeMotion | undefined;
    assert.equal(motion?.loop, false, '文件里的 Loop 是待机用的，热键动作必须只播一遍');
    assert.equal(motion?.fadeIn, 0.2);
    assert.equal(motion?.fadeOut, 0.2);
  });
});

describe('createOverlay —— 外观开关与上限', () => {
  test('toggle 同一 key 先挂后摘', () => {
    const { api } = makeApi();
    const core = makeCore();
    const overlay = createOverlay(
      api,
      () => core.model,
      () => 1000,
    );
    assert.equal(overlay.toggle('黑框眼镜', 'expression', {}), 'on');
    assert.deepEqual(overlay.active('expression'), ['黑框眼镜']);
    assert.equal(overlay.toggle('黑框眼镜', 'expression', {}), 'off');
    assert.deepEqual(overlay.active('expression'), []);
  });

  test('外观与动作分开计数：stopKind 只清一类', () => {
    const { api } = makeApi();
    const core = makeCore();
    const overlay = createOverlay(
      api,
      () => core.model,
      () => 1000,
    );
    overlay.play('motion:A:0', 'motion', motionJson, { hold: true, raw: motionJson });
    overlay.play('脸红', 'expression', {});
    overlay.stopKind('expression');
    assert.deepEqual(overlay.active('expression'), []);
    assert.deepEqual(overlay.active('motion'), ['motion:A:0']);
    overlay.stopKind('motion');
    assert.deepEqual(overlay.active('motion'), []);
  });

  test('超过上限淘汰同类最早的一条（另一类不受影响）', () => {
    const { api } = makeApi();
    const core = makeCore();
    const overlay = createOverlay(
      api,
      () => core.model,
      () => 1000,
    );
    overlay.play('脸红', 'expression', {});
    for (let i = 0; i < 9; i++)
      overlay.play('motion:A:' + String(i), 'motion', motionJson, { hold: true, raw: motionJson });
    const motions = overlay.active('motion');
    const total = motions.length + overlay.active('expression').length;
    assert.equal(total, 8, '层数上限 8（含另一类）');
    assert.deepEqual(
      [motions[0], motions[motions.length - 1]],
      ['motion:A:2', 'motion:A:8'],
      '最早的两条同类被淘汰，留下最新的 7 条',
    );
    assert.deepEqual(overlay.active('expression'), ['脸红'], '淘汰只发生在同类');
  });

  test('模型还没就绪（core 为 null）时 tick 什么都不做', () => {
    const { api } = makeApi();
    const overlay = createOverlay(
      api,
      () => null,
      () => 1000,
    );
    overlay.play('motion:A:0', 'motion', motionJson, { hold: true, raw: motionJson });
    assert.doesNotThrow(() => overlay.tick());
    assert.equal(overlay.active('motion').length, 1);
  });

  test('destroy 把全部队列停掉', () => {
    const { api, queues } = makeApi();
    const core = makeCore();
    const overlay = createOverlay(
      api,
      () => core.model,
      () => 1000,
    );
    overlay.play('motion:A:0', 'motion', motionJson);
    overlay.play('脸红', 'expression', {});
    overlay.destroy();
    assert.deepEqual(overlay.active('motion'), []);
    assert.deepEqual(overlay.active('expression'), []);
    assert.ok(
      queues.every((queue) => queue.stopped),
      '每条队列都要停',
    );
  });
});
