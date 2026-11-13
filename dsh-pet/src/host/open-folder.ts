/**
 * 「打开素材文件夹」的落地：把设置页的目录类别换成真实路径，再交平台自带的文件管理器打开。
 *
 * 目录只从 {@link SfxDirs} 里取，请求方给的是**类别名**而不是路径——设置页拿不到任意路径，
 * 也不需要知道某个素材根到底用 `-sound` 还是 `-skin` 布局。
 * 打开动作与「路径存在性」分开：不存在也返回路径，让调用方提示「先创建/放个文件」。
 * @module dsh-pet/src/host/open-folder
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { isGlobalFolderTarget, PET_FOLDER_TARGETS, type GlobalFolderTarget } from '../shared/folders.ts';
import type { SfxDirs } from './sfx/scan.ts';
import type { RendererKind, SfxFolderTarget } from '../shared/types.ts';

/**
 * 合法的素材目录类别：与设置页上的按钮一一对应。
 *
 * 五个是旧布局与包内默认；`pool-*` 五个指向共享资源池（A 方案的池根 `skin/`）：
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
 * @param dirs - 宿主算好的几个用户级目录。
 * @returns 目录绝对路径。
 */
export function resolveGlobalFolder(
  kind: GlobalFolderTarget,
  dirs: {
    readonly animations: string;
    readonly memes: string;
    readonly pool: string;
    readonly userRoot: string;
    /** 会话鱼的皮肤目录（`<用户根>/session-fish-skin`）。 */
    readonly fishSkin?: string;
  },
): string {
  switch (kind) {
    case 'pool-root':
      return dirs.pool;
    case 'animations':
      return dirs.animations;
    case 'memes':
      return dirs.memes;
    case 'fish-skin':
      // 缺省回落到用户根下的同名目录：调用方没传时也不能打开用户根（那会让按钮「看着生效但开错地方」）。
      return dirs.fishSkin ?? join(dirs.userRoot, 'session-fish-skin');
    case 'user-root':
      return dirs.userRoot;
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
 * - Windows：`powershell.exe -Command "Start-Process -FilePath $env:DSH_PET_OPEN_TARGET"`。
 *   `Start-Process` 内部就是 ShellExecuteEx，路径经**环境变量**传入而不是拼命令行——
 *   cmd/PowerShell 的引号与 `&`、`^`、`%` 转义规则不必在这里重写一遍，带空格与中文的目录照样开。
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
    // 拿不到 PowerShell（被策略禁掉、PATH 被改）时退回 explorer.exe：宁可绕开默认处理程序，
    // 也别让按钮彻底没反应。其它平台没有这一步——`open` / `xdg-open` 缺失是真没别的办法。
    if (process.platform === 'win32') spawnDetached({ args: [path], command: 'explorer.exe' }, undefined);
  });
}

/** 一次「交给系统打开」的命令描述（把平台差异收敛成一个可断言的值，测试不必真的弹窗口）。 */
export interface OpenCommand {
  /** 可执行文件名。 */
  readonly command: string;
  /** 命令行参数（不含可执行文件本身）。 */
  readonly args: readonly string[];
  /** 需要额外传进子进程环境变量的值（Windows 用环境变量传路径，避开命令行转义）。 */
  readonly env?: Readonly<Record<string, string>>;
}

/** Windows 上承载目标路径的环境变量名：路径不进命令行，引号与转义问题一并消失。 */
export const WINDOWS_OPEN_ENV = 'DSH_PET_OPEN_TARGET';

/**
 * 平台 → 打开命令。
 *
 * @param target - 目录绝对路径。
 * @param platform - 平台（测试可指定）。
 * @returns 命令描述；平台未知时返回 `undefined`（调用方静默跳过，不猜）。
 */
export function openCommandOf(target: string, platform: NodeJS.Platform = process.platform): OpenCommand | undefined {
  if (platform === 'win32') {
    return {
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-Command',
        'Start-Process -FilePath $env:' + WINDOWS_OPEN_ENV,
      ],
      command: 'powershell.exe',
      env: { [WINDOWS_OPEN_ENV]: target },
    };
  }
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
function spawnDetached(spec: OpenCommand, onError: (() => void) | undefined): void {
  const child = spawn(spec.command, [...spec.args], {
    detached: true,
    // Windows 上 PowerShell 不要闪控制台窗口；explorer 那一路不看这个开关。
    windowsHide: true,
    stdio: 'ignore',
    ...(spec.env === undefined ? {} : { env: { ...process.env, ...spec.env } }),
  });
  child.on('error', () => onError?.());
  child.unref();
}
