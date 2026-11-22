/**
 * layered 装配的桌面端出口：桌面 Helper 的 `layered-core.js` 从这里打包成经典 script（全局 PetLayered）。
 * 只做再导出，不含逻辑——装配数学、清单解析、动作词表与像素探测的唯一实现仍在 rig / types / gestures / probe，
 * 浏览器端与桌面端共用同一份；两端各写一套的话，点同一只宠物会一端有反应、另一端没有，
 * 探测各写一套则会出现「一端气泡贴头、一端盖脸」。
 * @module dsh-fish-body/src/client/pet/render/layered
 */
export { assemblyActionOf } from './gestures.ts';
export { computePoses, drawPoses, hitTest } from './rig.ts';
export { parseSkinManifest } from './types.ts';
export { alphaBoxOf, boxToSource, measureLayerBox, measureVisualBox, measureVisualTopRatio } from './probe.ts';
