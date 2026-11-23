/**
 * 「打开素材文件夹」的落地：把设置页的目录类别换成真实路径，再交平台自带的文件管理器打开。
 *
 * 目录只从 {@link SfxDirs} 里取，请求方给的是**类别名**而不是路径——设置页拿不到任意路径，
 * 也不需要知道某个素材根到底用 `-sound` 还是 `-skin` 布局。
 * 打开动作与「路径存在性」分开：不存在也返回路径，让调用方提示「先创建/放个文件」。
 * 平台命令本身的取舍（为什么 Windows 上不是 `Start-Process`）见 {@link openCommandOf}。
 * @module dsh-fish-body/src/host/open-folder
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { isGlobalFolderTarget, PET_FOLDER_TARGETS, type GlobalFolderTarget } from '../shared/folders.ts';
import { POOL_LAYER_DIR } from '../shared/pool.ts';
import type { SfxDirs } from './sfx/scan.ts';
import type { UserPaths } from './user-layout.ts';
import type { RendererKind, SfxFolderTarget } from '../shared/types.ts';

/**
 * 合法的素材目录类别：与设置页上的按钮一一对应。
 *
 * 五个是旧布局与包内默认；`pool-*` 五个指向内置皮肤池（池根 `assets/pet/`）：
 * 资源目录（按渲染方式）、渲染方式兜底音效、全局音效、webm 平铺动画。
 */
export const FOLDER_TARGETS: readonly SfxFolderTarget[] = PET_FOLDER_TARGETS;

/**
 * 判断请求里的类别是否合法。
 *
 * @param raw - 查询参数原值。
 * @returns 合法的类别；否则 `null`。
 */
export function parseFolderTarget(raw: string | null | undefined): SfxFolderTarget | null {
  const value = (raw ?? '').trim();
  return (FOLDER_TARGETS as readonly string[]).includes(value) ? (value as SfxFolderTarget) : null;
}

/**
 * 判断请求里的类别是不是「与宠物无关的全局目录」。
 *
 * @param raw - 查询参数原值。
 * @returns 全局类别；否则 `null`。
 */
export function parseGlobalFolderTarget(raw: string | null | undefined): GlobalFolderTarget | null {
  const value = (raw ?? '').trim();
  return isGlobalFolderTarget(value) ? value : null;
}

/**
 * 全局类别 → 目录。
 *
 * @param kind - 全局类别。
 * @param dirs - 数据根路径表与当前池根（池根随配置变，所以单独传）。
 * @returns 目录绝对路径。
 */
export function resolveGlobalFolder(
  kind: GlobalFolderTarget,
  dirs: { readonly paths: UserPaths; readonly pool: string },
): string {
  const { paths } = dirs;
  switch (kind) {
    case 'root':
    case 'user-root':
      return paths.root;
    case 'config':
      return paths.configDir;
    case 'data':
      return paths.dataDir;
    case 'cache':
      return paths.cacheDir;
    case 'runtime':
      return paths.runtimeDir;
    // `pets` 是旧前端的类别名（那时用户皮肤目录叫 pets/）：留作别名，别让旧页面上的按钮变成 400。
    case 'skin-root':
    case 'pets':
      return paths.skinsDir;
    case 'assets':
      return paths.assetsDir;
    case 'pool-root':
      return dirs.pool;
    case 'animations':
      return paths.animationDir;
    case 'memes':
      return paths.memesDir;
    case 'fish-skin':
      return paths.fishSkinDir;
    // 三个池桶：直接回 <池>/<渲染方式>，不需要宠物（三行里总有两行不匹配当前渲染方式）。
    // 设置页「皮肤目录」三行：开的是**用户**皮肤目录（`<根>/skin/<渲染方式>`），
    // 内置池 `assets/pet/<渲染方式>` 只是渲染回落，用户往里放东西没意义。
    case 'pool-bucket-layered':
      return join(paths.skinsDir, POOL_LAYER_DIR.layered);
    case 'pool-bucket-live2d':
      return join(paths.skinsDir, POOL_LAYER_DIR.live2d);
    case 'pool-bucket-webm':
      return join(paths.skinsDir, POOL_LAYER_DIR.webm);
  }
}

/**
 * 类别 → 目录。
 *
 * @param dirs - 该素材根的搜索目录集。
 * @param which - 类别。
 * @param skinId - 皮肤 id（`skinIdOfModel` 的结果；空串 = 根布局）。
 * @param renderer - 该宠物的渲染方式；`pool-<渲染方式>` 类只在自己的渲染方式下有效。
 * @returns 目录路径；该素材根没有这一类目录时返回 `null`。
 */
export function resolveFolderTarget(
  dirs: SfxDirs,
  which: SfxFolderTarget,
  skinId: string,
  renderer?: RendererKind,
): string | null {
  /** 池的资源目录：没有独立资源目录（layered 根布局 / webm）时回落到该渲染方式的目录本身。 */
  const poolEntry = (wanted: RendererKind): string | null => {
    if (renderer !== undefined && renderer !== wanted) return null;
    const dir = dirs.poolSkinDir ?? dirs.poolSkinLayerDir ?? null;
    return dir;
  };
  switch (which) {
    case 'sound':
      return dirs.soundDir ?? null;
    case 'skin':
      return dirs.skinDir === undefined ? null : skinId === '' ? dirs.skinDir : join(dirs.skinDir, skinId);
    case 'animation':
      return dirs.animationDirs[0] ?? null;
    case 'user':
      return dirs.userSoundDir ?? null;
    case 'package':
      return dirs.packageSoundDir;
    case 'pool-layered':
      return poolEntry('layered');
    case 'pool-live2d':
      return poolEntry('live2d');
    case 'pool-webm':
      return renderer === 'webm' || renderer === undefined ? (dirs.poolWebmDir ?? null) : null;
    case 'pool-sound':
      return dirs.poolRendererSoundDir ?? null;
    case 'pool-global-sound':
      return dirs.poolGlobalSoundDir ?? null;
  }
}

/**
 * 用系统的「默认处理程序」打开一个目录。
 *
 * 不是写死 `explorer.exe`：Windows 上直接拉 explorer 等于绕开 ShellExecute，用户把默认文件管理器
 * 换成第三方（Directory Opus、Files 之类）时按钮会装作没生效。这里走平台的 shell：
 *
 * - Windows：`rundll32.exe url.dll,FileProtocolHandler <目录>`——它就是一发 ShellExecute。
 * - macOS：`open`（LaunchServices，跟随系统默认）。
 * - 其它：`xdg-open`（跟随 xdg-mime 默认）。
 *
 * 子进程 detach + 忽略 stdio：不等它退出，也不把它的输出接进宿主日志。
 *
 * @param path - 目录的绝对路径。
 */
export function openDirectory(path: string): void {
  const spec = openCommandOf(path);
  if (spec === undefined) return;
  spawnDetached(spec, () => {
    // rundll32 被策略拦掉时退回 explorer.exe：宁可绕开默认处理程序，也别让按钮彻底没反应。
    // 这一步的 windowsHide 必须是 false（见 {@link OpenCommand.windowsHide}），否则窗口永远隐藏。
    if (process.platform === 'win32') {
      spawnDetached({ args: [path], command: 'explorer.exe', windowsHide: false });
    }
  });
}

/** 一次「交给系统打开」的命令描述（把平台差异收敛成一个可断言的值，测试不必真的弹窗口）。 */
export interface OpenCommand {
  /** 可执行文件名。 */
  readonly command: string;
  /** 命令行参数（不含可执行文件本身）。 */
  readonly args: readonly string[];
  /**
   * 是否隐藏子进程的控制台窗口；缺省 `true`。
   *
   * **只对 GUI 子系统程序安全**（`rundll32` / `explorer` 都没有控制台可闪）。
   * 给控制台程序（`powershell` / `cmd`）设 `true` 时，libuv 会用
   * `STARTUPINFO{STARTF_USESHOWWINDOW, SW_HIDE}` + `CREATE_NO_WINDOW` 拉起它，
   * 而被它再拉起的进程会**继承这个隐藏显示状态**：目录确实打开了，窗口却永远是隐藏的。
   * 线上「点了打开文件夹没反应」就是这么来的——所以凡是可能被继承显示状态的路径一律给 `false`。
   */
  readonly windowsHide?: boolean;
}

/**
 * 平台 → 打开命令。
 *
 * Windows 用 `rundll32 url.dll,FileProtocolHandler`：FileProtocolHandler 就是 ShellExecute 的壳，
 * 跟随用户默认的文件管理器（换过 Directory Opus / Files 也照样生效）。
 *
 * 这里**不用 `powershell -Command Start-Process`**：宿主是以隐藏窗口 + detach 的方式拉起子进程的，
 * `Start-Process` 会把继承来的 `SW_HIDE` 继续传给目标进程——实测目录打开了、窗口始终不出现。
 * rundll32 是 GUI 子系统，没有控制台可闪，也就没有这个继承问题。
 *
 * @param target - 目录绝对路径。
 * @param platform - 平台（测试可指定）。
 * @returns 命令描述；平台未知时返回 `undefined`（调用方静默跳过，不猜）。
 */
export function openCommandOf(target: string, platform: NodeJS.Platform = process.platform): OpenCommand | undefined {
  if (platform === 'win32') return { args: ['url.dll,FileProtocolHandler', target], command: 'rundll32.exe' };
  if (platform === 'darwin') return { args: [target], command: 'open' };
  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd' || platform === 'sunos') {
    return { args: [target], command: 'xdg-open' };
  }
  return undefined;
}

/**
 * 拉起一个 detach 的子进程。
 *
 * 必须挂 `error` 监听：`spawn` 失败是异步事件，没有监听器就是未捕获异常，会把宿主进程带走。
 *
 * @param spec - 命令描述。
 * @param onError - 启动失败时的兜底动作。
 */
function spawnDetached(spec: OpenCommand, onError?: () => void): void {
  const child = spawn(spec.command, [...spec.args], {
    detached: true,
    // 缺省隐藏：GUI 子进程本来就没有控制台窗口可闪，true 只是别让系统先闪一下再隐藏。
    windowsHide: spec.windowsHide ?? true,
    stdio: 'ignore',
  });
  child.on('error', () => onError?.());
  child.unref();
}
