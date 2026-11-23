/**
 * 运行时（Electron）的客户端接口：读状态与下载进度、触发下载、指定本地目录。
 *
 * 与设置页其它请求一样「不抛」：拿不到就回 `undefined` / 判别联合，由卡片决定显示什么，
 * 不把网络异常塞进渲染树。
 * @module dsh-fish-body/src/client/settings/runtime-api
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { RuntimeDownload, RuntimePromptState, RuntimeSnapshot, RuntimeStatus } from './config/http.ts';

/** 触发下载的结论。 */
export interface RuntimeDownloadOutcome {
  /** 本次是否真的起了下载（false = 已经在下了，或本来就装好了）。 */
  readonly started: boolean;
  /** 此刻是否已装。 */
  readonly installed: boolean;
  /** 最新快照（宿主读不到时为 undefined）。 */
  readonly snapshot?: RuntimeSnapshot;
}

/** 指定本地目录的结论。 */
export type RuntimeDirOutcome =
  | { readonly kind: 'ok'; readonly snapshot?: RuntimeSnapshot }
  | { readonly kind: 'no-electron'; readonly message: string }
  | { readonly kind: 'failed' };

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
    ...(raw.source === 'custom' || raw.source === 'default' ? { source: raw.source } : {}),
  };
}

/** 下载进度：只认数字字段，其余按 0 处理。 */
function asDownload(value: unknown): RuntimeDownload | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  return {
    active: raw.active === true,
    doneBytes: num(raw.doneBytes),
    totalBytes: num(raw.totalBytes),
    ...(typeof raw.mirror === 'string' ? { mirror: raw.mirror } : {}),
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
  };
}

/** 提示：只认 `needed === true`。 */
function asPrompt(value: unknown): RuntimePromptState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const reason =
    raw.reason === 'missing' || raw.reason === 'deleted' || raw.reason === 'failed' ? raw.reason : undefined;
  return {
    needed: raw.needed === true,
    ...(reason === undefined ? {} : { reason }),
    ...(typeof raw.since === 'number' ? { since: raw.since } : {}),
  };
}

/**
 * 收整份快照（宿主两种响应形状都兼容：`{runtime,...}` 与 `{ ...snapshot }`）。
 *
 * @param value - 任意值。
 * @returns 快照；连 runtime 都不合法时 undefined。
 */
export function asSnapshot(value: unknown): RuntimeSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const runtime = asStatus(raw.runtime);
  if (runtime === undefined) return undefined;
  const download = asDownload(raw.download);
  const prompt = asPrompt(raw.prompt);
  return {
    runtime,
    ...(download === undefined ? {} : { download }),
    ...(prompt === undefined ? {} : { prompt }),
    ...(typeof raw.wanted === 'boolean' ? { wanted: raw.wanted } : {}),
  };
}

/**
 * 读运行时快照。
 *
 * @returns 快照；请求失败或形状不对时 undefined。
 */
export async function fetchRuntime(): Promise<RuntimeSnapshot | undefined> {
  try {
    const response = await fetch(ROUTE_PATH + '/desktop/runtime');
    return asSnapshot(await response.json().catch(() => null));
  } catch {
    return undefined;
  }
}

/** POST 一次 `/desktop/runtime` 并回原样 JSON（三条 action 共用）。 */
async function postRuntime(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(ROUTE_PATH + '/desktop/runtime', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * 触发一次下载（幂等：已在下载时宿主回 `started: false`）。
 *
 * @returns 结论；请求失败时回 `{ started: false, installed: false }`。
 */
export async function startRuntimeDownload(): Promise<RuntimeDownloadOutcome> {
  const payload = await postRuntime({ action: 'download' });
  const snapshot = asSnapshot(payload);
  return {
    started: payload?.started === true,
    installed: payload?.installed === true || snapshot?.runtime?.installed === true,
    ...(snapshot === undefined ? {} : { snapshot }),
  };
}

/**
 * 把运行时指向用户已经下好的目录。
 *
 * @param dir - 目录绝对路径（宿主要求里面确实有本平台的 Electron 可执行文件）。
 * @returns 结论；`no-electron` 带宿主给的原因（界面直接显示，不自己编文案）。
 */
export async function saveRuntimeDir(dir: string): Promise<RuntimeDirOutcome> {
  const payload = await postRuntime({ action: 'dir', dir });
  if (payload === null) return { kind: 'failed' };
  if (payload.ok === false) {
    const message = typeof payload.message === 'string' ? payload.message : '';
    return payload.reason === 'no-electron' ? { kind: 'no-electron', message } : { kind: 'failed' };
  }
  const snapshot = asSnapshot(payload);
  return { kind: 'ok', ...(snapshot === undefined ? {} : { snapshot }) };
}

/**
 * 取消「指定目录」，回到默认位置。
 *
 * @returns 结论。
 */
export async function resetRuntimeDir(): Promise<RuntimeDirOutcome> {
  const payload = await postRuntime({ action: 'reset' });
  if (payload === null) return { kind: 'failed' };
  if (payload.ok === false) return { kind: 'failed' };
  const snapshot = asSnapshot(payload);
  return { kind: 'ok', ...(snapshot === undefined ? {} : { snapshot }) };
}
