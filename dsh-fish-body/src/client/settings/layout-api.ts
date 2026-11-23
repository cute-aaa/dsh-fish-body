/**
 * 位置变更的客户端接口：读搬迁进度、启动一次搬迁、调原生选目录框。
 *
 * 三个函数都不抛：拿不到就回判别联合或 `undefined`，卡片据此决定显示什么。
 * 搬迁是后台任务（几十秒到几分钟），这里只负责起步与轮询。
 * @module dsh-fish-body/src/client/settings/layout-api
 */
import { ROUTE_PATH } from '../../shared/constants.ts';

/** 可改位置的两项：数据根 / 用户皮肤目录。 */
export type MovableLocation = 'root' | 'skin';

/** 一次搬迁的对外状态。 */
export interface MoveStatus {
  /** 是否正在搬。 */
  readonly busy: boolean;
  /** 正在搬哪一项。 */
  readonly which?: MovableLocation;
  /** 复制中 / 收尾。 */
  readonly phase: 'copying' | 'cleaning';
  readonly copiedBytes: number;
  readonly totalBytes: number;
  readonly copiedFiles: number;
  readonly totalFiles: number;
  readonly current: string;
  readonly error?: string;
  /** 搬成功但需要重启插件才生效。 */
  readonly needsRestart: boolean;
  /** 上次成功的目标路径。 */
  readonly movedTo?: string;
  /** 当前生效的数据根。 */
  readonly root?: string;
  /** 当前生效的皮肤目录。 */
  readonly skin?: string;
}

/** 选目录的结论。 */
export type PickOutcome =
  | { readonly kind: 'picked'; readonly path: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unsupported'; readonly message: string };

/** 数字字段：非法一律按 0。 */
function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * 收一份搬迁状态。
 *
 * @param value - 任意值。
 * @returns 状态；连 `busy` 都不合法时 undefined。
 */
export function asMoveStatus(value: unknown): MoveStatus | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.busy !== 'boolean') return undefined;
  const which = raw.which === 'root' || raw.which === 'skin' ? raw.which : undefined;
  const phase = raw.phase === 'cleaning' ? 'cleaning' : 'copying';
  return {
    busy: raw.busy,
    phase,
    copiedBytes: num(raw.copiedBytes),
    totalBytes: num(raw.totalBytes),
    copiedFiles: num(raw.copiedFiles),
    totalFiles: num(raw.totalFiles),
    current: typeof raw.current === 'string' ? raw.current : '',
    needsRestart: raw.needsRestart === true,
    ...(which === undefined ? {} : { which }),
    ...(typeof raw.error === 'string' && raw.error !== '' ? { error: raw.error } : {}),
    ...(typeof raw.movedTo === 'string' && raw.movedTo !== '' ? { movedTo: raw.movedTo } : {}),
    ...(typeof raw.root === 'string' ? { root: raw.root } : {}),
    ...(typeof raw.skin === 'string' ? { skin: raw.skin } : {}),
  };
}

/**
 * 读搬迁状态。
 *
 * @returns 状态；请求失败时 undefined。
 */
export async function fetchMoveStatus(): Promise<MoveStatus | undefined> {
  try {
    const response = await fetch(ROUTE_PATH + '/layout/location');
    return asMoveStatus(await response.json().catch(() => null));
  } catch {
    return undefined;
  }
}

/** 启动搬迁的结论。 */
export type MoveStartOutcome =
  { readonly kind: 'started' } | { readonly kind: 'busy' } | { readonly kind: 'rejected'; readonly message: string };

/** 一个位置的体积统计（`GET /layout/size` 的响应）。 */
export interface DirSize {
  /** 文件数（符号链接算一个）。 */
  readonly files: number;
  /** 总字节数。 */
  readonly bytes: number;
}

/**
 * 数一个位置现在有多少东西。
 *
 * 进「更改位置」的说明步时问一次：用户得先知道这次要搬多少，再决定搬到哪。
 *
 * @param which - 数哪一项。
 * @returns 统计；请求失败或响应形状不对时 undefined（界面隐藏数量那一行，不挡流程）。
 */
export async function fetchDirSize(which: MovableLocation): Promise<DirSize | undefined> {
  try {
    const response = await fetch(ROUTE_PATH + '/layout/size?which=' + which);
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (payload?.ok === false) return undefined;
    return { files: num(payload?.files), bytes: num(payload?.bytes) };
  } catch {
    return undefined;
  }
}

/**
 * 启动一次搬迁。
 *
 * @param which - 搬哪一项。
 * @param path - 目标绝对路径。
 * @returns 结论（`rejected` 带宿主给的原因）。
 */
export async function startMove(which: MovableLocation, path: string): Promise<MoveStartOutcome> {
  try {
    const response = await fetch(ROUTE_PATH + '/layout/location', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ which, path }),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (payload?.ok === false) {
      const message = typeof payload.message === 'string' ? payload.message : '';
      return payload.reason === 'busy' ? { kind: 'busy' } : { kind: 'rejected', message };
    }
    if (payload?.started === true) return { kind: 'started' };
    return { kind: 'rejected', message: '' };
  } catch {
    return { kind: 'rejected', message: '' };
  }
}

/**
 * 调原生选目录框。
 *
 * @param title - 对话框标题。
 * @param start - 初始目录（可不给）。
 * @returns 结论；`unsupported` 带原因（界面据此展开手输框）。
 */
export async function pickFolder(title: string, start?: string): Promise<PickOutcome> {
  try {
    const response = await fetch(ROUTE_PATH + '/pick-folder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, ...(start === undefined ? {} : { start }) }),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (payload?.ok === true && typeof payload.path === 'string') return { kind: 'picked', path: payload.path };
    if (payload?.reason === 'cancelled') return { kind: 'cancelled' };
    return {
      kind: 'unsupported',
      message: typeof payload?.message === 'string' ? payload.message : '',
    };
  } catch {
    return { kind: 'unsupported', message: '' };
  }
}

/**
 * 调原生选文件框（权重 / 参考音频 / 文本）。
 *
 * @param title - 对话框标题。
 * @param extensions - 允许的扩展名（含点），只影响系统过滤项。
 * @param start - 初始目录（可不给）。
 * @returns 结论；`unsupported` 带原因（界面据此展开手输框）。
 */
export async function pickFile(title: string, extensions: readonly string[], start?: string): Promise<PickOutcome> {
  try {
    const response = await fetch(ROUTE_PATH + '/pick-file', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title,
        extensions,
        ...(start === undefined ? {} : { start }),
      }),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (payload?.ok === true && typeof payload.path === 'string') return { kind: 'picked', path: payload.path };
    if (payload?.reason === 'cancelled') return { kind: 'cancelled' };
    return {
      kind: 'unsupported',
      message: typeof payload?.message === 'string' ? payload.message : '',
    };
  } catch {
    return { kind: 'unsupported', message: '' };
  }
}
