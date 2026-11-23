/**
 * 设置备份的浏览器侧客户端：读文件、下载快照、提交恢复。
 *
 * 一律「失败不抛」：调用方是 UI，把网络与格式错误变成可显示的结果，比让异常冒到 React 边界更有用。
 * 形状校验复用 `shared/settings-backup`（与宿主同一份规则），所以「明显不是备份的文件」在
 * 选中的那一刻就能被拒，不必先上传再等宿主回一句 no。
 * @module dsh-fish-body/src/client/settings/backup-api
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { SessionFishSettings } from '../../shared/session-fish.ts';
import { parseSettingsBackup, type BackupParseFailure, type SettingsBackup } from '../../shared/settings-backup.ts';
import type { MergedConfig } from './config/index.ts';

/** 读一份备份文件的结论。 */
export type BackupRead =
  { readonly ok: true; readonly backup: SettingsBackup } | { readonly ok: false; readonly failure: BackupParseFailure };

/**
 * 把文件文本解析成备份。
 *
 * @param text - `File.text()` 或任何来源的 JSON 文本。
 * @returns 通过时给出规范化备份；否则给出机读原因（文案在调用方）。
 */
export function readBackupJson(text: string): BackupRead {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, failure: { reason: 'not-backup' } };
  }
  return parseSettingsBackup(raw);
}

/**
 * 备份文件名：`dsh-pet-settings-<yyyyMMdd-HHmm>.json`。
 *
 * @param now - 生成时刻（注入以便测试）。
 * @returns 可直接放进 `<a download>` 的文件名。
 */
export function backupFileName(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const day = String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate());
  const time = pad(now.getHours()) + pad(now.getMinutes());
  return 'dsh-pet-settings-' + day + '-' + time + '.json';
}

/**
 * 触发一次浏览器下载。
 *
 * @param name - 文件名。
 * @param text - 文件内容。
 * @returns 真的点了下载为 true；没有 DOM（SSR / 单测）时 false。
 */
export function saveTextFile(name: string, text: string): boolean {
  if (typeof document === 'undefined') return false;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 立刻 revoke 会让部分浏览器取消下载：推到下一拍再释放。
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

/**
 * 向宿主取一份快照并格式化成待下载的文本。
 *
 * @returns 美化后的 JSON 文本；请求失败或响应不是对象时 `null`。
 */
export async function fetchBackupText(): Promise<string | null> {
  try {
    const response = await fetch(ROUTE_PATH + '/settings-backup', { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    if (!body || typeof body !== 'object') return null;
    return JSON.stringify(body, null, 2) + '\n';
  } catch {
    return null;
  }
}

/** 恢复结论。 */
export type RestoreOutcome =
  | { readonly ok: true; readonly merged: MergedConfig; readonly settings: SessionFishSettings }
  | { readonly ok: false; readonly message: string };

/**
 * 提交一份备份，让宿主覆盖当前设置。
 *
 * @param backup - 已通过形状校验的备份。
 * @returns 写后的成品与会话鱼设置，或宿主给的人话原因。
 */
export async function restoreBackup(backup: SettingsBackup): Promise<RestoreOutcome> {
  try {
    const response = await fetch(ROUTE_PATH + '/settings-backup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(backup),
    });
    const body = (await response.json().catch(() => null)) as {
      ok?: unknown;
      message?: unknown;
      merged?: unknown;
      settings?: unknown;
      reason?: unknown;
    } | null;
    if (!response.ok || !body || body.ok === false) {
      const reason =
        typeof body?.message === 'string' && body.message !== ''
          ? body.message
          : typeof body?.reason === 'string' && body.reason !== ''
            ? body.reason
            : 'HTTP ' + response.status;
      return { ok: false, message: reason };
    }
    const merged = body.merged;
    const settings = body.settings;
    if (!merged || typeof merged !== 'object' || !settings || typeof settings !== 'object') {
      return { ok: false, message: 'invalid restore response' };
    }
    return { ok: true, merged: merged as MergedConfig, settings: settings as SessionFishSettings };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
