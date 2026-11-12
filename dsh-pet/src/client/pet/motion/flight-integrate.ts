/**
 * 抛掷的逐帧细分积分：实现已收进 shared（`shared/physics/integrate.ts`），这里只做转出。
 *
 * 保留这个模块是因为客户端各处按 `./flight-integrate` 引它；真正的积分与「取最重撞击」的
 * 口径必须与桌面 Helper 共用同一份，否则快速甩出时的碰撞音只在其中一端正常。
 * @module dsh-pet/src/client/pet/motion/flight-integrate
 */
export { integrateFlight } from '../../../shared/physics/integrate.ts';
export type { FlightBounds, FlightStep } from '../../../shared/physics/integrate.ts';
