/**
 * 运行时（Electron）的客户端接口：读状态、触发下载。
 *
 * 与设置页其它请求一样「不抛」：拿不到就回 `null`，由卡片决定显示什么，不把网络异常塞进渲染树。
 * 下载是分钟级操作，这里只负责起步与轮询，进度交给宿主日志（设置页只看「已装 / 未装」与版本号）。
 * @module dsh-fish-body/src/client/settings/runtime-api
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { RuntimeStatus } from './config/http.ts';

/** 触发下载的结论。 */
export interface RuntimeDownloadOutcome {
  /** 本次是否真的起了下载（false = 已经在下了，或本来就装好了）。 */
  readonly started: boolean;
  /** 此刻是否已装。 */
  readonly installed: boolean;
  /** 最新状态（宿主读不到时为 undefined）。 */
  readonly runtime?: RuntimeStatus;
}

/**
 * 把宿主回的那段 JSON 收成状态对象；形状不对就当没读到。
 *
 * @param value - 任意值。
 * @returns 状态；不合法时 undefined。
 */
function asStatus(value: unknown): RuntimeStatus | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.dir !== 'string' || typeof raw.installed !== 'boolean') return undefined;
  return {
    dir: raw.dir,
    exe: typeof raw.exe === 'string' ? raw.exe : '',
    installed: raw.installed,
    ...(typeof raw.version === 'string' ? { version: raw.version } : {}),
  };
}

/**
 * 读运行时状态。
 *
 * @returns 状态；请求失败或形状不对时 undefined。
 */
export async function fetchRuntime(): Promise<RuntimeStatus | undefined> {
  try {
    const response = await fetch(ROUTE_PATH + '/desktop/runtime');
    const payload = (await response.json().catch(() => null)) as { runtime?: unknown } | null;
    return asStatus(payload?.runtime);
  } catch {
    return undefined;
  }
}

/**
 * 触发一次下载（幂等：已在下载时宿主回 `started: false`）。
 *
 * @returns 结论；请求失败时回 `{ started: false, installed: false }`。
 */
export async function startRuntimeDownload(): Promise<RuntimeDownloadOutcome> {
  try {
    const response = await fetch(ROUTE_PATH + '/desktop/runtime', { method: 'POST' });
    const payload = (await response.json().catch(() => null)) as {
      started?: unknown;
      installed?: unknown;
      runtime?: unknown;
    } | null;
    const runtime = asStatus(payload?.runtime);
    return {
      started: payload?.started === true,
      installed: payload?.installed === true || runtime?.installed === true,
      ...(runtime === undefined ? {} : { runtime }),
    };
  } catch {
    return { started: false, installed: false };
  }
}
