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
import type { SfxDirs } from './sfx/scan.ts';
import type { SfxFolderTarget } from '../shared/types.ts';

/** 合法的目录类别：与设置页上的按钮一一对应。 */
export const FOLDER_TARGETS: readonly SfxFolderTarget[] = ['sound', 'skin', 'animation', 'user', 'package'];

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
 * 类别 → 目录。
 *
 * @param dirs - 该素材根的搜索目录集。
 * @param which - 类别。
 * @param skinId - 皮肤 id（`skinIdOfModel` 的结果；空串 = 根布局）。
 * @returns 目录路径；该素材根没有这一类目录时返回 `null`。
 */
export function resolveFolderTarget(dirs: SfxDirs, which: SfxFolderTarget, skinId: string): string | null {
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
  }
}

/**
 * 用平台自带的文件管理器打开一个目录。
 *
 * 子进程 detach + 忽略 stdio：不等它退出，也不把它的输出接进宿主日志
 * （explorer 会常驻，接了输出反而多一条永不结束的管道）。
 *
 * @param path - 目录的绝对路径。
 */
export function openDirectory(path: string): void {
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(command, [path], { detached: true, stdio: 'ignore' });
  child.unref();
}
