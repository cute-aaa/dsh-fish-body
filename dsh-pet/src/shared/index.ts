/**
 * 共享层出口：浏览器半侧 bundle 与桌面 shared-core 共用同一份纯逻辑。
 * 不负责配置的读取、合并与校验：成品配置由宿主半侧的 readAllConfig 给出，本层只把它拍平。
 * 宿主半侧不得 import 本目录（DSH 单文件加载约束会拆 chunk），其实现自包含、改动须与本层同步。
 * menu / chat / score-popup / todo / tooltip 导出 DOM 样式与挂载：数据与判据仍是纯函数，渲染两端共用同一份。
 * 本文件是打包入口：scripts/build-desktop-core.mjs 把它打成 shared-core.js，产物以 window.PetShared
 * 暴露全部符号供桌面 JS 取用（那一侧没有类型检查）。
 * @module dsh-fish-body/src/shared/index
 */
export * from './types.ts';
export * from './constants.ts';
export * from './pickers.ts';
export * from './displays.ts';
export * from './motion.ts';
export * from './balance/index.ts';
export * from './whisper.ts';
export * from './config.ts';
export * from './fonts.ts';
export * from './notify.ts';
export * from './menu.ts';
export * from './live2d-fixes.ts';
export * from './live2d-motion3.ts';
export * from './bubble-anchor.ts';
export * from './body-box.ts';
export * from './pet-size.ts';
export * from './layered-paths.ts';
export * from './chat/index.ts';
export * from './physics.ts';
export * from './score.ts';
export * from './score-popup.ts';
export * from './work-status.ts';
export * from './state.ts';
export * from './bubble-hold.ts';
export * from './display-hotkey.ts';
export * from './sleep-hotkey.ts';
export * from './todo/index.ts';
export * from './tooltip.ts';
export * from './voice.ts';
export * from './voice-providers.ts';
export * from './sfx/index.ts';
export * from './pet-config-actions.ts';

// 会话鱼：显式列名而不是 `export *`——几何与 wire 两头都有 `Slot` / `Rect` 一类短名，
// 隐式再导出会与 motion/types 的既有符号撞名（撞名在 `export *` 里是静默丢弃，很难查）。
export {
  SESSION_FISH_SIZE_MIN,
  SESSION_FISH_SIZE_MAX,
  SESSION_FISH_SIZE_DEFAULT,
  SESSION_FISH_MAX_COUNT_MIN,
  SESSION_FISH_MAX_COUNT_MAX,
  SESSION_FISH_MAX_COUNT_DEFAULT,
  SESSION_FISH_BUBBLE_MS_MIN,
  SESSION_FISH_BUBBLE_MS_MAX,
  SESSION_FISH_BUBBLE_MS_DEFAULT,
  SESSION_FISH_PROGRESS_GAP_MS_MIN,
  SESSION_FISH_PROGRESS_GAP_MS_MAX,
  SESSION_FISH_PROGRESS_GAP_MS_DEFAULT,
  SESSION_FISH_SKIN_DEFAULT,
  SESSION_FISH_SKIN_EXTS,
  SESSION_FISH_SKIN_MAX_LEN,
  SESSION_FISH_STATES,
  SESSION_FISH_LINE_KINDS,
  DEFAULT_SESSION_FISH_SETTINGS,
  sessionFishSkinKindOf,
  isSessionFishSkinName,
  effectiveSessionFishSkin,
  ownsSessionFishSpeech,
  isSessionFishState,
  isSessionFishLineKind,
  readSessionFish,
  isSessionFishBubbleVisible,
  sessionFishSpeechOf,
  selectSessionFishes,
} from './session-fish.ts';
export type {
  SessionFishSkinKind,
  SessionFishState,
  SessionFishLineKind,
  SessionFishSettings,
  SessionFishEntry,
  SessionFishSnapshot,
} from './session-fish.ts';
export {
  SESSION_FISH_ASPECT,
  sessionFishAspectOf,
  rememberSessionFishAspect,
  sessionFishHeightOf,
} from './session-fish/aspect.ts';
export {
  ROAM_EDGE_PX,
  OFFSET_LIMIT_RATIO,
  resolveFishSlots,
  pushOutOfBody,
  placeFish,
  clampOffset,
  ringRadiiOf,
  offsetLimitOf,
  fishWindowPad,
  createRoam,
} from './session-fish/roam.ts';
export type {
  FishBox,
  FishOffset,
  FishPlacement,
  PetAnchor,
  RoamViewport,
  SlotRequest,
  Slot,
  FishBody,
  FishImpact,
  RoamDeps,
  Roam,
} from './session-fish/roam.ts';
