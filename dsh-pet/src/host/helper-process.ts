/**
 * 桌面 Helper 进程的公开出口：定位、启动、管道协议与重启策略。
 *
 * 只做再导出，不含逻辑；子模块按变化原因分居 ./helper/。
 * 必须始终成立：模块外只经本文件使用 Helper 能力，不得旁路拉起进程。
 * @module dsh-fish-body/src/host/helper-process
 */
export {
  clearRuntimePrompt,
  currentUserRoot,
  defaultElectronExe,
  defaultHelperMain,
  defaultLaunch,
  downloadElectronInBackground,
  dshHomeDir,
  electronDownloadCacheDir,
  electronDownloadProgress,
  electronLandingDir,
  electronMirrors,
  electronRuntimeDir,
  electronRuntimeStatus,
  ensureElectronDownload,
  hasGraphicalDisplay,
  isElectronDir,
  isElectronDownloading,
  legacyElectronDir,
  packageRoot,
  readElectronVersion,
  readRuntimePrompt,
  requestRuntimePrompt,
  resolveElectronPath,
  runtimeSnapshot,
  setRuntimeDir,
  setRuntimeWanted,
  setUserRoot,
} from './helper/electron.ts';
export type {
  ElectronDownloadLog,
  ElectronDownloadProgress,
  ElectronRuntimeStatus,
  EnsureElectronOptions,
  RuntimePrompt,
  RuntimeSnapshot,
} from './helper/electron.ts';
export { BRIDGE_PREFIX } from './helper/bridge.ts';
export type { BridgeHandler, BridgeRequest, BridgeResponse } from './helper/bridge.ts';
export {
  HELPER_STABLE_MS,
  HELPER_STOP_GRACE_MS,
  HELPER_STOP_TIMEOUT_MS,
  crashLoopAdvice,
  describeExit,
  helperRunIsStable,
  restartBackoffDelayMs,
  shouldCircuitBreak,
  shouldFallbackToNoSandbox,
} from './helper/restart.ts';
export { HelperProcess, helperLaunchArgs, helperSpawnEnv } from './helper/child.ts';
