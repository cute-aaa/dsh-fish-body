/**
 * layered 装配的桌面端出口：桌面 Helper 的 `layered-core.js` 从这里打包成经典 script（全局 PetLayered）。
 * 只做再导出，不含逻辑——装配数学与清单解析的唯一实现仍在 rig / types，浏览器端与桌面端共用同一份。
 * @module dsh-pet/src/client/pet/render/layered
 */
export { computePoses, drawPoses, hitTest } from './rig.ts';
export { parseSkinManifest } from './types.ts';
