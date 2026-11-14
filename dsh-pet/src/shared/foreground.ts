/**
 * 前台窗口快照的解析：把一条轮询输出行变成可判定的结构。
 *
 * 采集端是 `runtime/electron-helper/main/foreground.js` 里那个长驻 PowerShell（Windows 没有
 * 能问前台窗口的 Electron API）。它每拍打一行 JSON；本模块只做**形状校验**，不碰进程、
 * 不碰显示器：坏行一律丢弃（返回 null），让上层当作「这一拍不知道」而不是拿半截数据去躲。
 *
 * 必须始终成立：坐标与尺寸必须是有限数且宽高为正——`GetWindowRect` 对某些窗口会给出
 * 0×0 或负值（最小化、被销毁、UWP 壳），那种行不可用。
 * @module dsh-fish-body/src/shared/foreground
 */

/** 一个矩形（DIP/逻辑像素，与 Electron `screen` 的坐标系一致）。 */
export interface FgRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 一帧前台窗口快照。 */
export interface ForegroundSnapshot {
  /** 进程 id（用于排除自己的窗口）。 */
  readonly pid: number;
  /** 进程名（不含 `.exe`；取不到时为空串）。 */
  readonly app: string;
  /** 窗口标题（可能为空串）。 */
  readonly title: string;
  /** 窗口矩形（屏幕坐标）。 */
  readonly rect: FgRect;
}

/** 读一个有限数；不是数就给 NaN。 */
function numOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * 解析一条前台快照行。
 *
 * @param line - 一行 JSON（`{pid,app,title,x,y,w,h}`，键名由采集端定，允许 `rect` 嵌套写法）。
 * @returns 快照；坏行返回 null。
 */
export function parseForegroundLine(line: unknown): ForegroundSnapshot | null {
  if (typeof line !== 'string' || line.trim() === '') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const pid = numOf(o.pid);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const nested = o.rect && typeof o.rect === 'object' ? (o.rect as Record<string, unknown>) : null;
  const x = numOf(nested ? nested.x : o.x);
  const y = numOf(nested ? nested.y : o.y);
  const width = numOf(nested ? nested.width : o.w);
  const height = numOf(nested ? nested.height : o.h);
  if ([x, y, width, height].some((v) => Number.isNaN(v))) return null;
  if (!(width > 0) || !(height > 0)) return null;
  const app = typeof o.app === 'string' ? o.app.trim() : '';
  const title = typeof o.title === 'string' ? o.title : '';
  return { pid, app, title, rect: { x, y, width, height } };
}

/**
 * 进程名归一：去扩展名、去空白、小写。
 *
 * @param app - 采集端给的进程名（可能带 `.exe`，也可能为空）。
 * @returns 归一后的名字（可能为空串）。
 */
export function normalizeAppName(app: unknown): string {
  if (typeof app !== 'string') return '';
  return app.trim().replace(/\.exe$/i, '').toLowerCase();
}
