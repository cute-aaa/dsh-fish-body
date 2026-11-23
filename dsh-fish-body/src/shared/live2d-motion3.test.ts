/**
 * `.motion3.json` 末帧解析的单元测试：定格姿态全靠它才算得准。
 *
 * 段格式容易记错（贝塞尔段跟 6 个数、其余跟 2 个），这里用三种段各钉一例，
 * 再钉住「结构不对时给空结果而不是抛异常」——素材来自用户目录，坏文件不该炸掉渲染。
 * 跑法：node --experimental-strip-types --test src/shared/live2d-motion3.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseMotion3 } from './live2d-motion3.ts';

/** 造一份只有一个参数曲线的动作文件。 */
const motionOf = (segments: number[], target = 'Parameter'): unknown => ({
  Meta: { Duration: 1.25 },
  Curves: [{ Target: target, Id: 'ParamArmL', Segments: segments }],
});

describe('parseMotion3 —— 时长', () => {
  test('取 Meta.Duration；缺失或非法时为 0', () => {
    assert.equal(parseMotion3({ Meta: { Duration: 2 } }).duration, 2);
    assert.equal(parseMotion3({ Meta: {} }).duration, 0);
    assert.equal(parseMotion3({ Meta: { Duration: -1 } }).duration, 0);
    assert.equal(parseMotion3({}).duration, 0);
    assert.equal(parseMotion3(null).duration, 0);
  });
});

describe('parseMotion3 —— 末帧取值', () => {
  test('线性段：末点取最后一段的终点', () => {
    // 起点 (0,0) → 线性到 (0.5,0.4) → 线性到 (1.133,1)
    const parsed = parseMotion3(motionOf([0, 0, 0, 0.5, 0.4, 0, 1.133, 1]));
    assert.deepEqual(parsed.finals, [{ id: 'ParamArmL', target: 'Parameter', value: 1 }]);
  });

  test('贝塞尔段：末点取第 6、7 个数（终点），不是控制点', () => {
    // 起点 (0,0) → 贝塞尔 控制点(0.2,0.1)(0.6,0.9) 终点(1,0.35)
    const parsed = parseMotion3(motionOf([0, 0, 1, 0.2, 0.1, 0.6, 0.9, 1, 0.35]));
    assert.equal(parsed.finals[0]?.value, 0.35);
  });

  test('阶跃段（2 / 3）走 3 个数的长度', () => {
    // 起点 (0,0) → 阶跃到 (0.5,0.7) → 反向阶跃到 (1,0.2)
    const parsed = parseMotion3(motionOf([0, 0, 2, 0.5, 0.7, 3, 1, 0.2]));
    assert.equal(parsed.finals[0]?.value, 0.2);
  });

  test('PartOpacity 目标被保留（部件显隐与参数写回位置不同）', () => {
    const parsed = parseMotion3(motionOf([0, 0, 0, 1, 1], 'PartOpacity'));
    assert.deepEqual(parsed.finals, [{ id: 'ParamArmL', target: 'PartOpacity', value: 1 }]);
  });
});

describe('parseMotion3 —— 坏数据', () => {
  test('缺 Id / 段太短 / 非数组都不产出条目', () => {
    assert.deepEqual(parseMotion3({ Curves: [{ Target: 'Parameter', Segments: [0, 0] }] }).finals, []);
    assert.deepEqual(parseMotion3({ Curves: [{ Id: 'X', Segments: [] }] }).finals, []);
    assert.deepEqual(parseMotion3({ Curves: 'nope' }).finals, []);
    assert.deepEqual(parseMotion3({ Curves: [null, 3] }).finals, []);
  });

  test('多条曲线各取各的末点', () => {
    const parsed = parseMotion3({
      Meta: { Duration: 1 },
      Curves: [
        { Target: 'Parameter', Id: 'A', Segments: [0, 0, 0, 1, 1] },
        { Target: 'Parameter', Id: 'B', Segments: [0, 1, 0, 1, 0] },
      ],
    });
    assert.deepEqual(
      parsed.finals.map((item) => [item.id, item.value]),
      [
        ['A', 1],
        ['B', 0],
      ],
    );
  });
});
