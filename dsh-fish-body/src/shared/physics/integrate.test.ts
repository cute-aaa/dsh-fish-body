/**
 * 细分积分（src/shared/physics/integrate.ts）的契约：一帧内的撞击必须保留最重的那次。
 *
 * 这条契约是「快速甩出时碰撞音消失」的回归测试：慢速甩抛一帧一步，代价看不出来；
 * 速度一高、一帧拆成多步，撞击就会落在中间某一步上。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { integrateFlight, integrateRegion } from './integrate.ts';
import { throwBounds, throwSpace, throwStep, throwStepRegion, throwSubsteps } from './throw.ts';
import { DEFAULT_PHYSICS } from './constants.ts';

/** 单块屏 800×600、宠物宽 100：右边界在 700。 */
const AREA = { x: 0, y: 0, width: 800, height: 600 };
const SPACE = throwSpace({ areas: [AREA], size: 100, sideAllow: 0 });

/** 一帧 16.7ms、横向 2400px/s：位移 40px，按 8px 一步拆成 5 步。 */
const DT = 1 / 60;

describe('细分积分的撞击合并', () => {
  test('高速甩出：撞墙发生在中间子步，末步已不撞', () => {
    const start = { x: 690, y: 100, vx: 2400, vy: 0 };
    const steps = throwSubsteps(start.vx, start.vy, DT);
    assert.equal(steps, 5, '一帧 40px 应拆 5 步，否则这个用例覆盖不到合并逻辑');
    let res = throwStepRegion(start, DT / steps, SPACE, DEFAULT_PHYSICS);
    for (let index = 1; index < steps && !res.atRest; index += 1) {
      res = throwStepRegion(res, DT / steps, SPACE, DEFAULT_PHYSICS);
    }
    assert.equal(res.hit, null, '末步已经不撞——只取末步的实现会在这里丢掉整帧的撞击');
  });

  test('多屏积分保留最重撞击，速度就是撞前法向速度', () => {
    const res = integrateRegion({ x: 690, y: 100, vx: 2400, vy: 0 }, DT, SPACE, DEFAULT_PHYSICS);
    assert.ok(res.hit !== null, '整帧最重撞击不该被末步覆盖掉');
    assert.equal(res.hit.edge, 'right');
    assert.ok(Math.abs(res.hit.speed - 2400) < 1, '撞击速度应是撞前水平速度，实际 ' + res.hit.speed);
  });

  test('单屏积分同样保留最重撞击（网页端走这一条）', () => {
    const bounds = throwBounds({ W: AREA.width, H: AREA.height, size: 100, sideAllow: 0 });
    const res = integrateFlight({ x: 690, y: 100, vx: 2400, vy: 0 }, DT, bounds, DEFAULT_PHYSICS);
    assert.ok(res.hit !== null);
    assert.equal(res.hit.edge, 'right');
  });

  test('同一步撞两条边时取更重的那个（角落）', () => {
    const bounds = throwBounds({ W: AREA.width, H: AREA.height, size: 100, sideAllow: 0 });
    // 右下角、一帧一步：水平 120、竖直 300 同一步各自越界，撞地更重。
    const res = integrateFlight(
      { x: bounds.maxX - 1, y: bounds.maxY - 1, vx: 120, vy: 300 },
      DT,
      bounds,
      DEFAULT_PHYSICS,
    );
    assert.ok(res.hit !== null);
    assert.equal(res.hit.edge, 'floor');
    assert.ok(res.contacts.includes('right'), '两条边都记进 contacts');
  });

  test('慢速一帧一步：结果与单步 throwStep 逐位相同', () => {
    const bounds = throwBounds({ W: AREA.width, H: AREA.height, size: 100, sideAllow: 0 });
    const state = { x: 300, y: 200, vx: 60, vy: 0 };
    const merged = integrateFlight(state, DT, bounds, DEFAULT_PHYSICS);
    const single = throwStep(state, DT, bounds, DEFAULT_PHYSICS);
    assert.deepEqual(
      { x: merged.x, y: merged.y, vx: merged.vx, vy: merged.vy },
      { x: single.x, y: single.y, vx: single.vx, vy: single.vy },
    );
  });
});
