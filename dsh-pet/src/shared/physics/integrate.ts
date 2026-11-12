/**
 * 抛掷的逐帧细分积分：一帧拆成若干子步，避免高速时整帧跨过落地与反弹。
 *
 * 不碰 DOM、rAF 与宠物互撞，只把状态往前积一帧；子步数由 throwSubsteps 决定。
 * 两个入口只差边界来源：`integrateFlight` 用单屏 AABB，`integrateRegion` 用多屏空间（可锁屏）。
 *
 * 必须始终成立：一帧的撞击取**所有子步里最重的那次**。只留末步的话，高速甩出时
 * 撞墙落在中间某一步、末步已经不撞，整帧的碰撞音/触觉就会静默丢掉——慢速一帧一步，
 * 所以这个缺陷只在「甩得很快」时出现，正是两端都必须走这一份实现的原因。
 * @module dsh-pet/src/shared/physics/integrate
 */
import { throwBounds, throwStep, throwStepRegion, throwSubsteps } from './throw.ts';
import type { GravityVector, ThrowBounds, ThrowSpace, ThrowState } from './throw.ts';
import type { PhysicsParams } from '../types.ts';

/** 单屏一帧积分的产出：状态加两个标志。 */
export type FlightStep = ReturnType<typeof throwStep>;

/** 多屏一帧积分的产出：同上再加当前所在屏。 */
export type RegionFlightStep = ReturnType<typeof throwStepRegion>;

/** 单屏边界：由视口与宠物尺寸算出。 */
export type FlightBounds = ReturnType<typeof throwBounds>;

/**
 * 一帧的细分积分（单屏）。
 *
 * 一帧可能跨过上百 px，不拆会跳过落地与反弹帧，漏掉落地挤压与落定判定。
 *
 * @param state - 本帧起点的飞行状态。
 * @param dt - 本帧时长（秒）。
 * @param bounds - 碰撞边界。
 * @param physics - 物理参数。
 * @param gravity - 本帧重力；缺省竖直向下。
 * @returns 本帧终点的状态，附带是否碰边、是否落定与最重的一次撞击。
 */
export function integrateFlight(
  state: ThrowState,
  dt: number,
  bounds: ThrowBounds,
  physics: PhysicsParams,
  gravity?: GravityVector,
): FlightStep {
  const substeps = throwSubsteps(state.vx, state.vy, dt);
  const first = throwStep(state, dt / substeps, bounds, physics, gravity);
  let res = first;
  let hit = first.hit;
  for (let i = 1; i < substeps && !res.atRest; i++) {
    res = throwStep(res, dt / substeps, bounds, physics, gravity);
    if (res.hit !== null && (hit === null || res.hit.speed > hit.speed)) hit = res.hit;
  }
  return { ...res, hit };
}

/**
 * 一帧的细分积分（多屏）。
 *
 * @param state - 本帧起点的飞行状态。
 * @param dt - 本帧时长（秒）。
 * @param space - 逐屏 AABB 与工作区。
 * @param physics - 物理参数。
 * @param lockScreen - 锁定屏索引；`-1` = 按身体中心所在屏。
 * @param gravity - 本帧重力；缺省竖直向下。
 * @returns 本帧终点的状态，附带屏幕、是否碰边与最重的一次撞击。
 */
export function integrateRegion(
  state: ThrowState,
  dt: number,
  space: ThrowSpace,
  physics: PhysicsParams,
  lockScreen = -1,
  gravity?: GravityVector,
): RegionFlightStep {
  const substeps = throwSubsteps(state.vx, state.vy, dt);
  const first = throwStepRegion(state, dt / substeps, space, physics, lockScreen, gravity);
  let res = first;
  let hit = first.hit;
  for (let i = 1; i < substeps && !res.atRest; i++) {
    res = throwStepRegion(res, dt / substeps, space, physics, lockScreen, gravity);
    if (res.hit !== null && (hit === null || res.hit.speed > hit.speed)) hit = res.hit;
  }
  return { ...res, hit };
}
