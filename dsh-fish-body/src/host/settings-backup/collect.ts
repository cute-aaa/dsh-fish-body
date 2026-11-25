/**
 * 设置备份的采集：把三份用户可编辑的配置原文读成一份快照。
 *
 * 三份东西分别是：用户主配置（`main-config.jsonc`，JSONC 带注释）、会话鱼设置
 * （`session-fish.json`）、以及每个文件宠物的种类配置（`skin/<名>-config.json(c)`）。
 * 只读原文，不解析、不校验、不做合并——备份的意义就是「原样」，任何加工都会在恢复时丢东西。
 * 文件不存在时对应位置是空串（含义：拍摄这份快照时没有这一层，恢复时清掉）。
 * @module dsh-fish-body/src/host/settings-backup/collect
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listPetConfigFiles } from '../config/read.ts';
import { effectiveUserFile } from '../config/jsonc.ts';
import { sessionFishSettingsPath } from '../session-fish/settings.ts';
import { PACKAGE_ROOT } from '../paths.ts';
import { SETTINGS_BACKUP_KIND, SETTINGS_BACKUP_VERSION, type SettingsBackup } from '../../shared/settings-backup.ts';
import type { ConfigPaths } from '../config/constants.ts';

/** 插件版本缓存：备份里带一份，出问题时能对上导出方。 */
let cachedVersion: string | undefined;

/** 读本包版本号；读不到就回空串（备份本身仍然可用）。 */
function pluginVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    const raw = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version?: unknown };
    cachedVersion = typeof raw.version === 'string' ? raw.version : '';
  } catch {
    cachedVersion = '';
  }
  return cachedVersion;
}

/** 读一份文件原文；不存在或读不动都算「这一层没有」。 */
function readText(file: string | undefined): string {
  if (file === undefined) return '';
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** 采集所需的两条路径。 */
export interface BackupSources {
  /** 配置路径集（主配置 + skin/ 目录）。 */
  readonly configPaths: ConfigPaths;
  /** 用户数据根（会话鱼设置与其它用户级文件都在这里）。 */
  readonly userRoot: string;
}

/**
 * 采一份设置备份。
 *
 * @param sources - 配置路径与用户根。
 * @param now - 导出时刻（注入以便测试固定时间）。
 * @returns 可直接序列化下发的快照。
 */
export function collectSettingsBackup(sources: BackupSources, now: Date = new Date()): SettingsBackup {
  const { configPaths, userRoot } = sources;
  const pets: Record<string, string> = {};
  for (const file of listPetConfigFiles(configPaths)) {
    const text = readText(file.path);
    // 读不动的种类文件不放进去：空串在恢复语义里是「删掉这一层」，会误删用户文件。
    if (text !== '') pets[file.entry] = text;
  }
  return {
    kind: SETTINGS_BACKUP_KIND,
    version: SETTINGS_BACKUP_VERSION,
    createdAt: now.toISOString(),
    pluginVersion: pluginVersion(),
    files: {
      main: readText(effectiveUserFile(configPaths)),
      sessionFish: readText(sessionFishSettingsPath(userRoot)),
      pets,
    },
  };
}
