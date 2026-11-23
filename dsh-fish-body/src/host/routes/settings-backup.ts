/**
 * 设置备份路由（`/settings-backup`）：GET 导出一份快照，POST 用快照覆盖当前设置。
 *
 * 只做协议与编排：读盘的规则在 `../settings-backup/collect`，预检/留底/回滚在 `../settings-backup/apply`。
 * 备份体可能不小，但服务端的请求体总闸是 1 MiB；这里再按快照上限单独挡一次，让「文件太大」
 * 在解析之前就以 413 结束，而不是先读出半个 JSON 再报语法错。
 * @module dsh-fish-body/src/host/routes/settings-backup
 */
import { collectSettingsBackup } from '../settings-backup/collect.ts';
import { applySettingsBackup } from '../settings-backup/apply.ts';
import { SETTINGS_BACKUP_MAX_CHARS } from '../../shared/settings-backup.ts';
import { type RouteResult } from '../http.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import { failResult, invalidJson, methodNotAllowed, okResult, payloadTooLarge } from './result.ts';

/** 请求体上限（字节）：按快照字符上限留出 JSON 转义与包装的余量。 */
const MAX_BODY_BYTES = SETTINGS_BACKUP_MAX_CHARS * 1.4;

/**
 * 设置备份领域：未命中返回 undefined，命中返回应答。
 *
 * @param deps - 路由依赖（配置路径、用户根、会话鱼存储器与广播入口）。
 * @param input - 已解析的请求。
 * @returns GET 返回快照；POST 返回写后的成品与会话鱼设置；其它方法 405。
 */
export async function handleSettingsBackupRoutes(
  deps: PetRouteDeps,
  input: RouteInput,
): Promise<RouteResult | undefined> {
  // 正向匹配（而不是反向排除）：check-openapi 按「rest 与字符串字面量正向比较」扫实现与文档是否对齐。
  const isBackupRoute = input.rest === 'settings-backup';
  if (!isBackupRoute) return undefined;
  if (input.method === 'GET') {
    const backup = collectSettingsBackup({ configPaths: deps.configPaths, userRoot: deps.userRoot });
    return okResult(backup, { 'cache-control': 'no-store' });
  }
  if (input.method !== 'POST') return methodNotAllowed();
  if (Buffer.byteLength(input.body ?? '', 'utf8') > MAX_BODY_BYTES) {
    return payloadTooLarge('settings backup body too large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body ?? '');
  } catch {
    return invalidJson();
  }
  const result = applySettingsBackup(
    {
      configPaths: deps.configPaths,
      userRoot: deps.userRoot,
      sessionFishSettings: deps.sessionFishSettings,
      sessionFish: deps.sessionFish,
      publishSessionFish: deps.publishSessionFish,
      state: deps.state,
      requestRestart: deps.requestRestart,
    },
    parsed,
  );
  if (!result.ok) return failResult(result.reason, result.message);
  return okResult({ ok: true, merged: result.merged, settings: result.settings });
}
