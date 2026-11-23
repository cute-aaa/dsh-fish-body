/**
 * Electron 定位、下载与运行时状态：找已安装的二进制，缺失时自动下载并解压。
 *
 * 不负责启动进程（归 ./child）；下载失败记日志并留下提示，由调用方降级为仅浏览器模式。
 * 必须始终成立：解析结果只来自显式候选、`DSH_PET_ELECTRON_PATH`、用户指定的目录与
 * `<数据根>/runtime/electron`；不借用宿主安装目录里的 electron npm 包（#297：那是 pnpm 重排依赖时要替换的目录）。
 * 运行时**不在 cache 里**：删 cache 不该逼用户重下 350 MB，删 runtime 才应该。
 *
 * 下载默认走国内镜像链（见 {@link electronMirrors}）：官方 GitHub releases 在国内经常连不上，
 * 而「桌面窗口打不开」是用户最难自查的故障之一。
 * @module dsh-fish-body/src/host/helper/electron
 */
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { type LoggerLike } from '../log-file.ts';
import { PACKAGE_ROOT } from '../paths.ts';
import { ROOT_DIR_NAME } from '../user-root.ts';
import type { HelperOptions } from './child.ts';

/** 包根：与宿主其它模块共用同一个锚点（见 ../paths.ts），不得按本文件目录另算一份。 */
export const packageRoot = PACKAGE_ROOT;

/** 默认的 Helper 入口（runtime/electron-helper/main.js）。 */
export const defaultHelperMain = resolve(packageRoot, 'runtime', 'electron-helper', 'main.js');

/** 桌面 Helper 的远程调试端口：0 = 不开。排障时本地改成 9222，重启 Helper 后用 chrome://inspect 连。 */
export const DESKTOP_DEBUG_PORT = 0;

/** 强制 XWayland 的 Chromium 开关：Wayland 原生下小窗的定位/置顶/穿透都不可用。 */
const OZONE_X11_SWITCH = '--ozone-platform=x11';

/**
 * Linux Wayland 会话是否应强制走 XWayland。
 *
 * 只在有 XWayland（`DISPLAY` 存在）时可强制；纯 Wayland 只能提示用户切 X11 会话。
 * @param env - 读取显示环境变量；默认进程环境。
 * @param platform - 运行平台；默认 `process.platform`。
 * @returns 需要且能够强制 XWayland 时为 true。
 */
export function shouldForceXWayland(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'linux' && Boolean(env.WAYLAND_DISPLAY) && Boolean(env.DISPLAY);
}

/**
 * 桌面 Helper 的启动参数。
 *
 * 开关必须排在 Helper 入口脚本之前：Electron 把脚本路径之后的参数当作应用参数。
 * @param helperPath - Helper 入口脚本的绝对路径。
 * @param options - `debugPort` 远程调试端口（0 关闭）；`forceX11` 是否加 `--ozone-platform=x11`。
 * @returns 可直接交给 spawn 的参数数组。
 */
export function helperLaunchArgs(
  helperPath: string,
  options: { debugPort?: number; forceX11?: boolean } = {},
): string[] {
  const debugPort = options.debugPort ?? DESKTOP_DEBUG_PORT;
  const switches: string[] = [];
  if (options.forceX11 === true) switches.push(OZONE_X11_SWITCH);
  if (debugPort > 0) switches.push('--remote-debugging-port=' + debugPort);
  return [...switches, helperPath];
}

/** 只做基本文件校验：不验证二进制格式，也不实际启动候选。 */
function isNonEmptyFile(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

/**
 * 解析 Electron 可执行文件，按优先级取第一个存在且非空的候选：显式候选 → DSH_PET_ELECTRON_PATH
 * → $DSH_HOME/electron（下载落地路径）。
 * 只认自己的落地路径：不探测 npm 全局目录 / Program Files / /usr/bin，也不借用宿主安装目录里的
 * electron npm 包——运行中的 Helper 会锁住它，pnpm 重排依赖时无法整体替换（#297）。
 * 都不存在时由 ensureElectronDownload() 在进程内异步下载（不 spawn 子进程，避免 process.execPath
 * 在 Electron 宿主里指向宿主 exe 而崩溃）。
 */
export function resolveElectronPath(candidates: Array<string | undefined> = []): string | undefined {
  const seen = new Set<string>();
  const list: string[] = [];
  const push = (value: string | undefined | null): void => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    list.push(value);
  };
  for (const value of candidates) push(value);
  if (process.env.DSH_PET_ELECTRON_PATH) push(process.env.DSH_PET_ELECTRON_PATH);
  push(defaultElectronExe());
  return list.find(isNonEmptyFile);
}

/**
 * 判断当前环境能否真的跑起 Electron 图形窗口。
 *
 * Linux 无显示环境（服务器 / 容器 / 纯 CLI）下 Electron 能被下载并 spawn，却在初始化图形栈时崩溃；
 * 配合守护循环就变成每秒「拉起 → 崩溃 → 重启」，每个 core dump 约 14MB，几小时能堆到数十 GB 打满
 * 磁盘，所以必须在拉起之前判断。只拦「明确跑不起来」的：win32 / darwin 放行（macOS 无 DISPLAY 也走
 * WindowServer），linux 需要 DISPLAY 或 WAYLAND_DISPLAY 其一。逃生口 DSH_PET_DESKTOP_FORCE=1 强制
 * 跳过，供 Xvfb / 远程桌面等「环境变量没设但其实能显示」的场景使用。
 */
export function hasGraphicalDisplay(): boolean {
  if (process.platform !== 'linux') return true;
  if (process.env.DSH_PET_DESKTOP_FORCE === '1') return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

/** $DSH_HOME（默认 ~/.dsh）；测试与独立模式共用这一处推导。 */
export function dshHomeDir(): string {
  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  return process.env.DSH_HOME || join(userProfile, '.dsh');
}

// Electron 官方发布包按平台/架构不同：win32 解压出 electron.exe + 散文件，darwin 是 Electron.app
// （可执行文件在 Contents/MacOS/Electron），linux 是 electron 单文件。

/** 当前平台标识（win32 / darwin / linux）。 */
const PLAT = process.platform;

/** $DSH_HOME/electron 落地目录下，可执行文件的相对路径（按平台）。 */
const ELECTRON_REL =
  PLAT === 'win32'
    ? 'electron.exe'
    : PLAT === 'darwin'
      ? join('Electron.app', 'Contents', 'MacOS', 'Electron')
      : 'electron';

/**
 * 实际生效的数据根（由装配期 `setUserRoot` 注入）。
 *
 * 为什么要这一层：选根可能落到旧根上（换名与复制都失败时），而 Electron 运行时、下载缓存、
 * 桌面窗口 profile 都必须跟着**同一个根**走——否则数据在 `dsh-pet/`、运行时在 `fish-body/`，
 * 「一个目录装下所有东西」当场破产。缺省值仍是 `<DSH_HOME>/fish-body`（独立模式与早期调用）。
 */
let resolvedUserRoot: string | undefined;

/**
 * 用户指定的运行时目录（`config/locations.json` 的 `runtime`，由装配期注入）。
 *
 * 存在的理由：用户可能早就下过一份 Electron（别的插件、别的机器拷来的），或者把 `runtime/`
 * 挪到了更大的盘上。写死 `<根>/runtime/electron` 会逼他再下 350 MB。
 */
let resolvedRuntimeDir: string | undefined;

/**
 * 记下装配期选定的数据根（只由 `createHostSetup` 调一次）。
 *
 * @param root - 数据根绝对路径。
 */
export function setUserRoot(root: string): void {
  resolvedUserRoot = root;
}

/**
 * 记下用户指定的运行时目录（装配期与「设置页选了目录」时各调一次）。
 *
 * @param dir - 目录绝对路径；`undefined` 表示回到默认位置。
 */
export function setRuntimeDir(dir: string | undefined): void {
  resolvedRuntimeDir = dir;
}

/**
 * 当前生效的数据根。
 *
 * @param dshHome - `$DSH_HOME`（缺省按环境推导）。
 * @returns 绝对路径。
 */
export function currentUserRoot(dshHome: string = dshHomeDir()): string {
  return resolvedUserRoot ?? join(dshHome, ROOT_DIR_NAME);
}

/**
 * Electron 运行时落地目录：用户指定的目录优先，否则 `<数据根>/runtime/electron`。
 *
 * 下载解压的目标与设置页那行「运行时」显示的都是它。解析与下载必须走这里：同一个目录字面量
 * 在别处再写一遍，改了一处另一处没改，设置页就会显示一个永远不存在的路径。
 *
 * @param dshHome - `$DSH_HOME`；缺省按 `dshHomeDir()` 推导。
 * @returns 绝对路径（不判断存在性）。
 */
export function electronRuntimeDir(dshHome: string = dshHomeDir()): string {
  return resolvedRuntimeDir ?? join(currentUserRoot(dshHome), 'runtime', 'electron');
}

/**
 * 历史位置（`$DSH_HOME/electron`）：dsh-pet 时代所有插件共用的落地目录，只用于一次性迁移与回落。
 *
 * @param dshHome - `$DSH_HOME`。
 * @returns 绝对路径。
 */
export function legacyElectronDir(dshHome: string = dshHomeDir()): string {
  return join(dshHome, 'electron');
}

/**
 * 当前实际可用的运行时目录：新位置优先；新位置还没东西而旧位置有 → 继续用旧的。
 *
 * 回落的意义是**不让升级变成一次 350 MB 的重下**：迁移失败（进程占用 / 权限）时旧目录还在，
 * 直接继续用，日志里已经说明可以手动搬。
 *
 * @param dshHome - `$DSH_HOME`。
 * @returns 绝对路径。
 */
export function electronLandingDir(dshHome: string = dshHomeDir()): string {
  const next = electronRuntimeDir(dshHome);
  if (existsSync(next)) return next;
  // 用户指定过目录就不再回落旧位置：那是另外两个目录，回落会让人以为设置没生效。
  if (resolvedRuntimeDir !== undefined) return next;
  const legacy = legacyElectronDir(dshHome);
  if (existsSync(legacy)) return legacy;
  return next;
}

/**
 * Electron 安装包的下载缓存目录（`<数据根>/cache/download`，作为 `@electron/get` 的 cacheRoot）。
 *
 * 与运行时分开是为了「删 cache 不重下、删 runtime 才重下」：cache 存的只是 zip，runtime 是解压后的可执行文件。
 *
 * @param dshHome - `$DSH_HOME`。
 * @returns 绝对路径（不判断存在性，@electron/get 自己会建）。
 */
export function electronDownloadCacheDir(dshHome: string = dshHomeDir()): string {
  return join(currentUserRoot(dshHome), 'cache', 'download');
}

/** Electron 落地路径：当前运行时目录下按平台的可执行文件名。 */
export function defaultElectronExe(): string {
  return join(electronLandingDir(), ELECTRON_REL);
}

/**
 * 读 Electron 安装目录里的版本号。
 *
 * 官方压缩包自带与可执行文件同级的 `version` 文件（如 `43.3.0`），读它比再 spawn 一次 `--version`
 * 便宜得多。崩溃排障时「哪个版本」是退出码看不出来的唯一关键信息，所以日志必须带上。
 * @param electronExe - Electron 可执行文件绝对路径。
 * @returns 版本号；文件缺失或内容不像版本号时 undefined（调用方省略这一段，不编造）。
 */
export function readElectronVersion(electronExe: string): string | undefined {
  try {
    const version = readFileSync(join(dirname(electronExe), 'version'), 'utf8').trim();
    return /^\d+\.\d+\.\d+/.test(version) ? version : undefined;
  } catch {
    return undefined;
  }
}

/** 进程内下载 Electron 的选项。 */
export interface EnsureElectronOptions {
  /** Electron 版本号（默认 43.3.0，可被 DSH_PET_ELECTRON_VERSION 覆盖）。 */
  version?: string;
  /** 下载镜像链覆盖（缺省见 {@link electronMirrors}）。 */
  mirrors?: readonly string[];
  /** 单次下载超时（默认 10 分钟）。 */
  timeoutMs?: number;
  /**
   * 面向用户的日志出口（进桌宠工作气泡）。与 console 分开：console 留英文原文给终端 / CLI 排障，
   * 这里产出给「没有控制台的 DSH 桌面版用户」看的一句短话。本函数只产出文本，不认识 state。
   */
  onLog?: (event: ElectronDownloadLog) => void;
  /** 落盘日志出口（宿主注入的统一日志器，见 ./log-file）；不传则退回 console。 */
  logger?: LoggerLike;
}

/** 一条下载日志：`text` 给用户看；`level='warn'` = 失败路径；`done` = 本次下载已收尾（成功或失败）。 */
export interface ElectronDownloadLog {
  text: string;
  level: 'info' | 'warn';
  done: boolean;
}

/**
 * 默认镜像链（按顺序尝试）。
 *
 * 为什么不是只有一个官方地址：官方 releases 走 GitHub，国内直连经常超时；而「下不下来」这件事
 * 用户几乎无法自查（日志里只有一句 ETIMEDOUT）。链上三个国内源都是整包镜像，校验文件与官方同源：
 * - `cdn.npmmirror.com/binaries/electron/`：直连 CDN，不经过 302，是首选；
 * - `npmmirror.com/mirrors/electron/`：官方文档写的那个别名，会 302 到上面那条；
 * - GitHub releases：海外网络与「国内镜像同步失败」时的兜底。
 *
 * `ELECTRON_MIRROR` / `DSH_PET_ELECTRON_MIRROR` 给了就**只用它**（用户显式指定优先于我们猜）；
 * `DSH_PET_ELECTRON_MIRRORS` 用逗号分隔可以整套替换。
 *
 * @param env - 环境变量（测试注入）。
 * @returns 镜像基址列表（末尾带 `/`）。
 */
export function electronMirrors(env: NodeJS.ProcessEnv = process.env): string[] {
  const list = (env.DSH_PET_ELECTRON_MIRRORS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  if (list.length > 0) return list.map(withSlash);
  const single = (env.DSH_PET_ELECTRON_MIRROR ?? env.ELECTRON_MIRROR ?? '').trim();
  if (single !== '') return [withSlash(single)];
  return [
    'https://cdn.npmmirror.com/binaries/electron/',
    'https://npmmirror.com/mirrors/electron/',
    'https://github.com/electron/electron/releases/download/',
  ];
}

/** 补齐末尾斜杠：`@electron/get` 的拼接是 `mirror + customDir + '/' + name`，少一个斜杠就少一层。 */
function withSlash(value: string): string {
  return value.endsWith('/') ? value : value + '/';
}

/** 一次下载的实时进度（给设置页与弹窗用；宿主内只有一份，跟着 in-flight 下载走）。 */
export interface ElectronDownloadProgress {
  /** 是否正在下载。 */
  readonly active: boolean;
  /** 已传字节。 */
  readonly doneBytes: number;
  /** 总字节（服务端没给 Content-Length 时为 0）。 */
  readonly totalBytes: number;
  /** 当前镜像。 */
  readonly mirror?: string;
  /** 失败原因（`active=false` 且非空表示上一次失败了）。 */
  readonly error?: string;
}

/** 当前/最近一次下载的进度。 */
let downloadProgress: ElectronDownloadProgress = { active: false, doneBytes: 0, totalBytes: 0 };

/**
 * 读当前下载进度。
 *
 * @returns 进度快照。
 */
export function electronDownloadProgress(): ElectronDownloadProgress {
  return downloadProgress;
}

/** 缺失提示：运行时不见了（首次使用 / 用户手删 / 下载失败）时置位，弹窗据它决定要不要出现。 */
export interface RuntimePrompt {
  /** 是否需要让用户知道。 */
  readonly needed: boolean;
  /** 置位原因。 */
  readonly reason?: 'missing' | 'deleted' | 'failed';
  /** 置位时间（ms；客户端据此判「这条提示是不是新的」）。 */
  readonly since?: number;
}

/** 当前提示状态。 */
let runtimePrompt: RuntimePrompt = { needed: false };

/** 上一次读到的「装没装」，用来发现「装过又没了」（用户手删）。 */
let lastKnownInstalled: boolean | undefined;

/** 桌面模式是否需要运行时（由 desktop/spawn 注入：无桌面宠物且无托盘时不该下载 350 MB）。 */
let runtimeWanted = false;

/**
 * 告诉本模块「当前有没有人在等桌面窗口」。
 *
 * @param wanted - true = 桌面宠物或托盘需要窗口。
 */
export function setRuntimeWanted(wanted: boolean): void {
  runtimeWanted = wanted;
}

/**
 * 置位「需要运行时」的提示。
 *
 * @param reason - 置位原因。
 */
export function requestRuntimePrompt(reason: NonNullable<RuntimePrompt['reason']>): void {
  runtimePrompt = { needed: true, reason, since: Date.now() };
}

/** 清掉提示（下载成功 / 用户指定了已有目录）。 */
export function clearRuntimePrompt(): void {
  runtimePrompt = { needed: false };
}

/**
 * 读当前提示。
 *
 * @returns 提示快照。
 */
export function readRuntimePrompt(): RuntimePrompt {
  return runtimePrompt;
}

/**
 * 进程内下载并解压 Electron 到运行时目录。
 *
 * 不 spawn 子进程：CLI node 与 Electron 宿主（DSH Desktop）里都可用，也避开了 process.execPath 在
 * 宿主里指向宿主 exe 而崩溃。已存在则原样返回；失败返回 undefined（不影响 DSH 与浏览器 overlay）。
 *
 * 镜像按 {@link electronMirrors} 的顺序逐个试：一个源连不上（国内最常见）就换下一个，
 * 全部失败才报错——报错里带上「试过哪些源」，用户拿去搜或换环境变量才有依据。
 */
export async function ensureElectronDownload(options: EnsureElectronOptions = {}): Promise<string | undefined> {
  const version = options.version || process.env.DSH_PET_ELECTRON_VERSION || '43.3.0';
  const mirrors = options.mirrors ?? electronMirrors();
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const targetDir = electronLandingDir();
  const exe = join(targetDir, ELECTRON_REL);
  if (isNonEmptyFile(exe)) return exe;

  // 下载日志默认走 console；宿主会把它自己的统一日志器传进来——桌面版没有控制台，console 直出
  // 等于丢失（ctx.logger 在部分宿主也不映射到终端）。
  const sink = options.logger ?? console;
  const log = (message: string): void => sink.info?.(`[fish-body] ${message}`);
  const warn = (message: string): void => sink.warn?.(`[fish-body] ${message}`);
  // 同一件事两个出口（见 EnsureElectronOptions.onLog）：console 原文 + 给用户看的一句。
  // 文案刻意分成两套——版本号 / 路径 / 耗时对开发者有用，对用户是噪音，不合并成同一句。
  const info = (consoleText: string, text: string, done = false): void => {
    log(consoleText);
    options.onLog?.({ text, level: 'info', done });
  };
  const fail = (consoleText: string, text: string): void => {
    warn(consoleText);
    options.onLog?.({ text, level: 'warn', done: true });
  };
  const startedAt = Date.now();

  if (existsSync(exe)) {
    info(`Electron cache is empty or not a regular file: ${exe}`, 'Electron 缓存无效，准备重新下载');
  }
  info(`Electron not found, downloading v${version} (${PLAT}-${process.arch}) ...`, `正在下载 Electron ${version}`);
  downloadProgress = {
    active: true,
    doneBytes: 0,
    totalBytes: 0,
    ...(mirrors[0] === undefined ? {} : { mirror: mirrors[0] }),
  };

  const attempts: string[] = [];
  try {
    // 目录创建也可能失败（权限不足、同名文件等），与下载失败一样降级到浏览器宠物。
    mkdirSync(targetDir, { recursive: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    downloadProgress = { active: false, doneBytes: 0, totalBytes: 0, error: reason };
    fail(`cannot create ${targetDir}: ${reason}`, `无法创建运行时目录：${reason}`);
    warn('desktop pet unavailable. Set DSH_PET_ELECTRON_PATH to an existing Electron, or retry later.');
    return undefined;
  }

  // 按需加载：静态 import 会把它连同 got/fs-extra 一串依赖钉进每个产物的启动路径，
  // 而独立应用模式下这条路径不执行。
  let downloadArtifact: typeof import('@electron/get').downloadArtifact | undefined;
  let extract: typeof import('@electron-internal/extract-zip').default | undefined;
  try {
    ({ downloadArtifact } = await import('@electron/get'));
    ({ default: extract } = await import('@electron-internal/extract-zip'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    downloadProgress = { active: false, doneBytes: 0, totalBytes: 0, error: reason };
    fail(`cannot load download dependencies: ${reason}`, `下载组件不可用：${reason}`);
    return undefined;
  }

  for (const mirror of mirrors) {
    // 每个镜像一个独立的超时：一个源卡住不该把整条链拖死。
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`Electron download timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    timer.unref?.();
    let nextLogAt = Date.now() + 3000;
    try {
      info(`downloading from ${mirror} ...`, `正在从 ${mirror} 下载`);
      const zipPath = await downloadArtifact({
        version: `v${version}`,
        artifactName: 'electron',
        // 安装包缓存落进数据根的 cache/：删 cache 只会多下一次，不会丢已经解压好的运行时。
        // 不传则用 @electron/get 的默认位置（LOCALAPPDATA/electron/Cache），那份是全局共享的，不在我们管辖内。
        cacheRoot: electronDownloadCacheDir(),
        // platform/arch 不传：@electron/get 用宿主平台与架构自动推断
        // （getHostArch 还处理 arm → armv7l 特例，比显式传 process.arch 更准）
        mirrorOptions: { mirror },
        downloadOptions: {
          signal: controller.signal,
          quiet: true, // 关掉 @electron/get 自己的进度条（stdout 走宿主日志，不进 bridge 协议）
          getProgressCallback: async (progress: { transferred: number; total: number | null }) => {
            // 进度态每拍都更新（设置页/弹窗直接读它），日志仍按 3s 节流。
            downloadProgress = {
              active: true,
              doneBytes: progress.transferred,
              totalBytes: progress.total ?? 0,
              mirror,
            };
            if (!progress.total) return;
            const now = Date.now();
            if (now < nextLogAt) return;
            nextLogAt = now + 3000;
            const doneMb = (progress.transferred / 1024 / 1024).toFixed(1);
            const totalMb = (progress.total / 1024 / 1024).toFixed(1);
            const percent = Math.min(100, Math.floor((progress.transferred / progress.total) * 100));
            info(`downloading ${doneMb}MB / ${totalMb}MB`, `Electron 下载 ${percent}% · ${doneMb}/${totalMb}MB`);
          },
        },
      });
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      info(`download complete (${seconds}s), extracting to ${targetDir} ...`, `下载完成（${seconds}s），正在解压`);
      downloadProgress = {
        active: true,
        doneBytes: downloadProgress.doneBytes,
        totalBytes: downloadProgress.totalBytes,
        mirror,
      };
      // 解压用官方 extract-zip（electron 43 官方安装同款）：纯 Node + native binding，跨平台一致，
      // 正确处理 symlink 与文件权限，不需要系统 unzip/tar/powershell。
      await extract(zipPath, { dir: targetDir });
      if (!isNonEmptyFile(exe)) {
        throw new Error(`Electron zip extracted, but ${ELECTRON_REL} is missing, empty or not a regular file`);
      }
      const readySeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      downloadProgress = {
        active: false,
        doneBytes: downloadProgress.doneBytes,
        totalBytes: downloadProgress.totalBytes,
        mirror,
      };
      info(`ready in ${readySeconds}s: ${exe}`, `Electron 就绪（${readySeconds}s），正在启动桌宠`, true);
      return exe;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      attempts.push(`${mirror} → ${reason}`);
      warn(`download failed from ${mirror}: ${reason}`);
      options.onLog?.({ text: `镜像 ${mirror} 下载失败，换下一个`, level: 'info', done: false });
    } finally {
      clearTimeout(timer);
    }
  }

  const reason = attempts.length === 0 ? '没有可用的下载镜像' : attempts.join('；');
  downloadProgress = { active: false, doneBytes: 0, totalBytes: 0, error: reason };
  fail(`ensure failed: ${reason}`, 'Electron 下载失败：所有镜像都没成功');
  warn('desktop pet unavailable. Set DSH_PET_ELECTRON_PATH to an existing Electron, or retry later.');
  return undefined;
}

/**
 * 运行时状态：给设置页那行「运行时」用的只读快照（有没有装、装在哪、什么版本）。
 *
 * @returns 目录、可执行文件路径、是否已装、版本号（读不到就不给）。
 */
export interface ElectronRuntimeStatus {
  /** 当前生效的运行时目录。 */
  readonly dir: string;
  /** 可执行文件期望路径。 */
  readonly exe: string;
  /** 是否已装（存在且非空）。 */
  readonly installed: boolean;
  /** 版本号（读 `<exe 同级>/version`；读不到时省略）。 */
  readonly version?: string;
  /** 目录来源：默认位置（`<根>/runtime/electron`）还是用户指定的目录。 */
  readonly source?: 'default' | 'custom';
}

/**
 * 读一次运行时状态。
 *
 * @returns 状态快照。
 */
export function electronRuntimeStatus(): ElectronRuntimeStatus {
  const dir = electronLandingDir();
  const exe = join(dir, ELECTRON_REL);
  const installed = isNonEmptyFile(exe);
  const version = installed ? readElectronVersion(exe) : undefined;
  const source: 'default' | 'custom' = resolvedRuntimeDir === undefined ? 'default' : 'custom';
  return { dir, exe, installed, source, ...(version === undefined ? {} : { version }) };
}

/** 设置页与弹窗一起用的完整快照：状态 + 下载进度 + 缺失提示。 */
export interface RuntimeSnapshot {
  /** 有没有装、装在哪。 */
  readonly runtime: ElectronRuntimeStatus;
  /** 当前/最近一次下载的进度。 */
  readonly download: ElectronDownloadProgress;
  /** 缺不缺东西（客户端据此决定弹不弹窗）。 */
  readonly prompt: RuntimePrompt;
  /** 桌面模式是否正等着运行时（false 时下载与提示都不该发生）。 */
  readonly wanted: boolean;
}

/**
 * 读一次完整快照，并在读的时候发现「装过又没了」。
 *
 * 为什么检测放在读里：用户删掉 `runtime/electron` 时宿主没有任何事件可监听（那是一次文件系统操作），
 * 唯一会被周期性调用的入口就是这里——设置页与弹窗都会轮询它，于是「缺失」这件事在下一次读时浮现。
 *
 * @returns 快照。
 */
export function runtimeSnapshot(): RuntimeSnapshot {
  const runtime = electronRuntimeStatus();
  if (lastKnownInstalled === true && !runtime.installed && runtimeWanted) {
    // 从「装过」到「没了」：九成是用户手删了 runtime/ 目录。给一次提示，别让桌面窗口静悄悄消失。
    requestRuntimePrompt('deleted');
  }
  lastKnownInstalled = runtime.installed;
  if (runtime.installed && runtimePrompt.needed) clearRuntimePrompt();
  return { runtime, download: downloadProgress, prompt: runtimePrompt, wanted: runtimeWanted };
}

/**
 * 这个目录里是否有一份可用的 Electron（用户「选已下载的目录」时校验）。
 *
 * 只认本平台的可执行文件，不做「大概像」的猜测：指错目录比拒绝更贵——桌面窗口会一直起不来，
 * 而用户以为设置成功了。
 *
 * @param dir - 候选目录。
 * @returns 目录里有本平台 Electron 可执行文件时为 true。
 */
export function isElectronDir(dir: string): boolean {
  return isNonEmptyFile(join(dir, ELECTRON_REL));
}

/** 进程内正在进行的下载（设置页「下载运行时」、弹窗与桌面模式启动会撞车，共用同一份）。 */
let inflightDownload: Promise<string | undefined> | undefined;
/**
 * 启动一次后台下载（已在下载则复用同一个 promise）。
 *
 * 设置页的「下载运行时」与缺失弹窗都走这里，桌面模式首次开窗也走 ensureElectronDownload，
 * 三者共用 in-flight 状态，不会下两份。
 *
 * @param options - 与 {@link ensureElectronDownload} 相同。
 * @returns `started=false` 表示已经有一个下载在跑（本次没有新起）。
 */
export function downloadElectronInBackground(options: EnsureElectronOptions = {}): { readonly started: boolean } {
  if (inflightDownload !== undefined) return { started: false };
  inflightDownload = ensureElectronDownload(options)
    .then((exe) => {
      if (exe !== undefined) clearRuntimePrompt();
      else requestRuntimePrompt('failed');
      return exe;
    })
    .finally(() => {
      inflightDownload = undefined;
    });
  return { started: true };
}

/**
 * 是否已经有一个下载在跑。
 *
 * @returns 正在下载时为 true。
 */
export function isElectronDownloading(): boolean {
  return inflightDownload !== undefined;
}

/**
 * 默认启动方式：Electron 可执行文件 + Helper 入口脚本。
 * @throws Electron 解析不到时抛错（调用方据此降级到浏览器宠物）。
 */
export function defaultLaunch(options: HelperOptions = {}): { command: string; args: string[] } {
  const electronPath = resolveElectronPath([options.electronPath]);
  if (!electronPath) {
    throw new Error('fish-body: cannot resolve Electron executable. Set DSH_PET_ELECTRON_PATH or install electron.');
  }
  const helperPath = options.helperPath || defaultHelperMain;
  return { command: electronPath, args: helperLaunchArgs(helperPath, { forceX11: shouldForceXWayland() }) };
}
