/**
 * 避让判定：前台窗口是否「该躲」、以及带滞回的隐藏状态机。
 *
 * 两件事分开：
 *   1. {@link avoidWantHide} —— 这一拍**想不想**躲（全屏 / 最大化 / 白名单），纯几何与名单比较；
 *   2. {@link advanceAvoid} —— 把「想躲」变成「已躲」，带延迟与恢复延迟。
 *
 * 为什么要有滞回：全屏切来切去、视频全屏时点一下进度条，都会让「想躲」在一两拍内翻转；
 * 直接跟着翻就是宠物一闪一闪。延迟（`avoidDelayMs`）与恢复延迟（`avoidRestoreDelayMs`）
 * 由用户配，状态机只负责守时。
 *
 * 不读配置、不碰窗口：调用方把显示器矩形与当前状态传进来。
 * @module dsh-fish-body/src/shared/avoid
 */
import { normalizeAppName, type FgRect, type ForegroundSnapshot } from './foreground.ts';

/** 覆盖判定的默认容差（像素）：边框化的全屏窗口常差 1–2 px，也躲。 */
export const AVOID_TOLERANCE_PX = 2;

/** 一块显示器：整屏矩形（判定全屏用）与工作区（判定最大化用）。 */
export interface MonitorGeometry {
  readonly bounds: FgRect;
  readonly workArea: FgRect;
}

/** 躲的原因（wire 词汇；日志与设置页都用它）。 */
export type AvoidReason = 'fullscreen' | 'maximize' | 'app' | '';

/** 这一拍的意愿结论。 */
export interface AvoidWanted {
  /** 想不想躲。 */
  readonly wantHide: boolean;
  /** 触发原因；不想躲时为空串。 */
  readonly reason: AvoidReason;
}

/** 意愿判定的输入。 */
export interface AvoidInput {
  /** 前台快照；null = 这一拍不知道（不躲）。 */
  readonly snapshot: ForegroundSnapshot | null;
  /** 本进程 pid：自己的窗口永远不触发（点自己的菜单不该把宠物藏起来）。 */
  readonly ownPid: number;
  /** 这只宠物所在的那块显示器。 */
  readonly monitor: MonitorGeometry;
  /** 全屏躲开开关。 */
  readonly fullscreenEnabled: boolean;
  /** 最大化也算（默认关：最大化一般不算紧张）。 */
  readonly maximizeEnabled: boolean;
  /** 白名单开关。 */
  readonly appsEnabled: boolean;
  /** 白名单（`.exe` 结尾按进程名精确比，否则按标题子串）。 */
  readonly apps: readonly string[];
  /** 覆盖容差（像素），缺省 {@link AVOID_TOLERANCE_PX}。 */
  readonly tolerance?: number;
}

/**
 * 一个矩形是否覆盖另一个矩形（允许 `tolerance` 像素的缺口）。
 *
 * @param outer - 被检查的窗口矩形。
 * @param inner - 目标区域（整屏或工作区）。
 * @param tolerance - 容差（像素）。
 * @returns 是否覆盖。
 */
export function coversRect(outer: FgRect, inner: FgRect, tolerance: number = AVOID_TOLERANCE_PX): boolean {
  const tol = Math.max(0, Number(tolerance) || 0);
  return (
    outer.x <= inner.x + tol &&
    outer.y <= inner.y + tol &&
    outer.x + outer.width >= inner.x + inner.width - tol &&
    outer.y + outer.height >= inner.y + inner.height - tol
  );
}

/**
 * 白名单命中：`.exe` 结尾按进程名精确比（不分大小写），否则按窗口标题子串。
 *
 * 两种写法分开是因为它们的用途不同：写 `chrome.exe` 是「这个程序一在前台就躲」，
 * 写 `哔哩哔哩` 是「这个窗口标题里带它就躲」（浏览器里全屏看视频正是这种）。
 *
 * @param app - 前台进程名（可带 `.exe`）。
 * @param title - 前台窗口标题。
 * @param list - 用户写的白名单。
 * @returns 是否命中。
 */
export function matchesAppList(app: unknown, title: unknown, list: readonly string[]): boolean {
  const appName = normalizeAppName(app);
  const text = typeof title === 'string' ? title.toLowerCase() : '';
  for (const entry of list) {
    const rule = typeof entry === 'string' ? entry.trim() : '';
    if (rule === '') continue;
    if (/\.exe$/i.test(rule)) {
      if (appName !== '' && appName === normalizeAppName(rule)) return true;
      continue;
    }
    if (text !== '' && text.includes(rule.toLowerCase())) return true;
  }
  return false;
}

/**
 * 这一拍想不想躲。
 *
 * @param input - 快照、自己的 pid、显示器与三个开关。
 * @returns 意愿结论（`reason` 说明是谁触发的）。
 */
export function avoidWantHide(input: AvoidInput): AvoidWanted {
  const { snapshot, ownPid, monitor } = input;
  if (!snapshot) return { wantHide: false, reason: '' };
  // 自己的窗口不触发：宠物被点一下不该把自己藏起来（进程级排除，子进程/工具窗都算自己）
  if (Number.isFinite(ownPid) && snapshot.pid === ownPid) return { wantHide: false, reason: '' };
  if (input.appsEnabled && matchesAppList(snapshot.app, snapshot.title, input.apps)) {
    return { wantHide: true, reason: 'app' };
  }
  const tol = input.tolerance ?? AVOID_TOLERANCE_PX;
  if (input.fullscreenEnabled && coversRect(snapshot.rect, monitor.bounds, tol)) {
    return { wantHide: true, reason: 'fullscreen' };
  }
  if (
    input.maximizeEnabled &&
    !coversRect(snapshot.rect, monitor.bounds, tol) &&
    coversRect(snapshot.rect, monitor.workArea, tol)
  ) {
    return { wantHide: true, reason: 'maximize' };
  }
  return { wantHide: false, reason: '' };
}

/** 滞回状态机的四个相位。 */
export type AvoidPhase = 'idle' | 'pending-hide' | 'hidden' | 'pending-show';

/** 状态机的一次输入。 */
export interface AvoidTickInput {
  /** 当前相位。 */
  readonly phase: AvoidPhase;
  /** 进入当前相位的时刻（毫秒）。 */
  readonly sinceMs: number;
  /** 当前时刻。 */
  readonly nowMs: number;
  /** 这一拍想不想躲。 */
  readonly wantHide: boolean;
  /** 开始躲之前要先持续多久（毫秒）。 */
  readonly delayMs: number;
  /** 条件消失后多久恢复（毫秒）。 */
  readonly restoreMs: number;
}

/** 状态机的一次输出。 */
export interface AvoidTickResult {
  readonly phase: AvoidPhase;
  readonly sinceMs: number;
  /** 现在要不要把窗口藏起来。 */
  readonly hide: boolean;
}

/** 是否处于「已藏」一侧（含正在恢复的等待期：那时窗口仍是藏着的）。 */
function hiddenOf(phase: AvoidPhase): boolean {
  return phase === 'hidden' || phase === 'pending-show';
}

/**
 * 推进一拍滞回状态机。
 *
 * 相位语义：
 *   `idle` 没在躲 → 条件成立且持续到 `delayMs` 才进 `hidden`；
 *   `hidden` 躲着 → 条件消失先进 `pending-show`，再等 `restoreMs` 才真正回来；
 *   等待期间条件恢复成立就回到上一侧（不重置计时器，避免来回抖）。
 *
 * @param input - 当前相位、时刻与两个延迟。
 * @returns 新相位与「现在要不要藏」。
 */
export function advanceAvoid(input: AvoidTickInput): AvoidTickResult {
  const now = Number.isFinite(input.nowMs) ? input.nowMs : 0;
  const since = Number.isFinite(input.sinceMs) ? input.sinceMs : 0;
  const delay = Math.max(0, Number(input.delayMs) || 0);
  const restore = Math.max(0, Number(input.restoreMs) || 0);
  const elapsed = now - since;
  // 时钟回拨（elapsed < 0）按「刚进入」处理：别让一次系统时间改动把宠物永久藏起来
  const waited = elapsed >= 0 ? elapsed : 0;
  switch (input.phase) {
    case 'pending-hide':
      if (!input.wantHide) return { phase: 'idle', sinceMs: now, hide: false };
      return waited >= delay
        ? { phase: 'hidden', sinceMs: now, hide: true }
        : { phase: 'pending-hide', sinceMs: since, hide: false };
    case 'hidden':
      return input.wantHide
        ? { phase: 'hidden', sinceMs: since, hide: true }
        : { phase: 'pending-show', sinceMs: now, hide: true };
    case 'pending-show':
      if (input.wantHide) return { phase: 'hidden', sinceMs: now, hide: true };
      return waited >= restore ? { phase: 'idle', sinceMs: now, hide: false } : { phase: 'pending-show', sinceMs: since, hide: true };
    default:
      if (!input.wantHide) return { phase: 'idle', sinceMs: since, hide: false };
      // delay 为 0：这一拍就直接躲（用户显式要求「立刻」）
      return delay === 0
        ? { phase: 'hidden', sinceMs: now, hide: true }
        : { phase: 'pending-hide', sinceMs: now, hide: false };
  }
}

/** 当前相位是否让窗口处于隐藏态（给外部查询用）。 */
export function avoidHidden(phase: AvoidPhase): boolean {
  return hiddenOf(phase);
}
