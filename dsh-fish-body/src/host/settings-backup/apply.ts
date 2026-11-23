/**
 * 设置备份的恢复：预检 → 留底 → 原子写回 → 广播。
 *
 * 顺序不可换：先把三份原文都验证成「能解析的配置」再动磁盘，避免写一半才发现第三份是坏的；
 * 写之前把将被覆盖的现有文件复制成 `<文件>.bak-<时间戳>`，任何一步失败都按留底回滚，
 * 绝不留下「主配置已换、会话鱼没换」这种半成品。空串表示这一层在快照拍摄时不存在：
 * 主配置/会话鱼会删掉现有文件（回落到内置默认），种类文件则**不动**（备份里没有的种类不删）。
 * 写完后重读成品、重载会话鱼设置并广播，设置页与浮层无需刷新即可看到恢复结果。
 * @module dsh-fish-body/src/host/settings-backup/apply
 */
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { readAllConfig } from '../config/read.ts';
import { effectiveUserFile, parseJsoncText } from '../config/jsonc.ts';
import { sessionFishSettingsPath, type SessionFishSettingsStore } from '../session-fish/settings.ts';
import { parseSettingsBackup, type SettingsBackup } from '../../shared/settings-backup.ts';
import type { SessionFishSettings } from '../../shared/session-fish.ts';
import type { ConfigPaths } from '../config/constants.ts';

/** 恢复要动的三处落盘位置。 */
export interface BackupTarget {
  readonly configPaths: ConfigPaths;
  readonly userRoot: string;
  /** 会话鱼设置的存储器；写完要 reload 才能让内存值与磁盘一致。 */
  readonly sessionFishSettings: SessionFishSettingsStore;
  /** 关掉总开关时把现有鱼一并撤掉（与 PUT /session-fish 同口径）。 */
  readonly sessionFish: { clearAll(): void };
  /** 把会话鱼快照写进轮询状态。 */
  readonly publishSessionFish: () => void;
  /** 配置变更信号：浏览器据此白重拉 /config。 */
  readonly state: { writeSection(name: 'config', value: Record<string, unknown>): void };
  /** 重载桌面 Helper（与其它写端点一致：让桌面窗口重读配置）。 */
  readonly requestRestart: () => Promise<void>;
}

/** 恢复结果。 */
export type BackupApplyResult =
  | {
      readonly ok: true;
      readonly merged: Record<string, Record<string, unknown>>;
      readonly settings: SessionFishSettings;
    }
  | { readonly ok: false; readonly reason: 'bad-request' | 'settings-write-failed'; readonly message: string };

/** 一份待写/待删的目标文件。 */
interface PlanItem {
  /** 目标绝对路径。 */
  readonly file: string;
  /** 要写入的原文；`null` = 删除该文件。 */
  readonly text: string | null;
  /** 拍摄时磁盘上是否有它（回滚要据此决定「恢复」还是「删掉」）。 */
  readonly hadFile: boolean;
}

/** 条目名 → 现有的种类配置文件路径（保留用户原有的 .json / .jsonc 扩展名）。 */
function petTarget(paths: ConfigPaths, entry: string): string {
  for (const ext of ['.jsonc', '.json']) {
    const file = join(paths.petDir, entry + '-config' + ext);
    if (existsSync(file)) return file;
  }
  return join(paths.petDir, entry + '-config.json');
}

/** 校验三份原文确实能解析；返回失败原因（英文，与其它路由同一口径）。 */
function checkContents(backup: SettingsBackup): string | null {
  if (backup.files.main !== '' && parseJsoncText(backup.files.main) === undefined) {
    return 'backup main config is not valid JSONC';
  }
  if (backup.files.sessionFish !== '') {
    try {
      const parsed = JSON.parse(backup.files.sessionFish) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return 'backup session-fish is not a JSON object';
    } catch {
      return 'backup session-fish is not valid JSON';
    }
  }
  for (const [entry, text] of Object.entries(backup.files.pets)) {
    if (parseJsoncText(text) === undefined) return `backup pet config is not valid JSONC: ${entry}`;
  }
  return null;
}

/** 把原文原子写到目标（同目录临时文件 + rename，避免写到一半留下截断的文件）。 */
function writeAtomic(file: string, text: string): void {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, '.' + basename(file) + '.tmp-' + String(process.pid) + '-' + String(Date.now()));
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, file);
}

/** 时间戳后缀：Windows 文件名不能带冒号。 */
function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

/**
 * 按留底回滚：写过的文件要么恢复成原样，要么删掉（原本就不存在）。
 *
 * @param planned - 本次计划写/删的文件。
 * @param backups - 目标路径 → 留底路径。
 */
function rollback(planned: readonly PlanItem[], backups: ReadonlyMap<string, string>): void {
  for (const item of planned) {
    try {
      if (item.hadFile) {
        const bak = backups.get(item.file);
        if (bak !== undefined && existsSync(bak)) copyFileSync(bak, item.file);
      } else {
        rmSync(item.file, { force: true });
      }
    } catch {
      /* 回滚尽力而为：失败也不能盖住原始错误 */
    }
  }
}

/**
 * 用一份快照覆盖当前设置。
 *
 * @param target - 落盘位置与广播入口。
 * @param raw - 未校验的备份（来自请求体）。
 * @param now - 留底时间戳（注入以便测试）。
 * @returns 写后的成品与会话鱼设置，或失败原因。
 */
export function applySettingsBackup(target: BackupTarget, raw: unknown, now: Date = new Date()): BackupApplyResult {
  const parsed = parseSettingsBackup(raw);
  if (!parsed.ok) {
    const failure = parsed.failure;
    const message =
      failure.reason === 'not-backup'
        ? 'not a dsh-pet settings backup'
        : failure.reason === 'unsupported-version'
          ? `backup version ${String(failure.version)} is newer than this plugin supports`
          : failure.reason === 'too-large'
            ? 'backup is too large'
            : `backup contains an unusable entry name: ${failure.entry}`;
    return { ok: false, reason: 'bad-request', message };
  }
  const backup = parsed.backup;
  const invalid = checkContents(backup);
  if (invalid !== null) return { ok: false, reason: 'bad-request', message: invalid };

  const { configPaths, userRoot } = target;
  const mainFile = effectiveUserFile(configPaths) ?? configPaths.userFile;
  const fishFile = sessionFishSettingsPath(userRoot);
  const planned: PlanItem[] = [
    {
      file: mainFile,
      text: backup.files.main === '' ? null : backup.files.main,
      hadFile: existsSync(mainFile),
    },
    {
      file: fishFile,
      text: backup.files.sessionFish === '' ? null : backup.files.sessionFish,
      hadFile: existsSync(fishFile),
    },
    ...Object.entries(backup.files.pets).map(([entry, text]) => {
      const file = petTarget(configPaths, entry);
      return { file, text, hadFile: existsSync(file) };
    }),
  ];

  // 留底：只给「将被覆盖或删除」且确实存在的文件复制一份，失败立即中止（不可回退就不动手）。
  const backups = new Map<string, string>();
  const suffix = '.bak-' + stamp(now);
  for (const item of planned) {
    if (!item.hadFile) continue;
    const bak = item.file + suffix;
    try {
      mkdirSync(dirname(item.file), { recursive: true });
      copyFileSync(item.file, bak);
      backups.set(item.file, bak);
    } catch (error) {
      return {
        ok: false,
        reason: 'settings-write-failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  try {
    for (const item of planned) {
      if (item.text === null) rmSync(item.file, { force: true });
      else writeAtomic(item.file, item.text);
    }
  } catch (error) {
    rollback(planned, backups);
    return {
      ok: false,
      reason: 'settings-write-failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  // 内存态与磁盘对齐：会话鱼 store 重读文件，关掉总开关时把现有鱼撤掉。
  const settings = target.sessionFishSettings.reload();
  if (!settings.enabled) target.sessionFish.clearAll();
  target.publishSessionFish();
  target.state.writeSection('config', {});
  // 不 await：发起者可能就是即将被这次重载换掉的桌面 Helper。
  void target.requestRestart();

  try {
    return { ok: true, merged: readAllConfig(configPaths), settings };
  } catch (error) {
    return {
      ok: false,
      reason: 'settings-write-failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
