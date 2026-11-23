/**
 * 识屏的进程级状态：待处理的手动请求、上次结论、最近一次前台快照。
 *
 * 为什么是模块级单例：这几项事实的写方（路由）与读方（同一路由、设置页的状态接口）在同一
 * 进程同一个插件实例里，而且全是**瞬时**状态——重启插件就该从零开始，落盘反而会让用户看到
 * 上一次会话的旧结论。与 `host/agent-activity` 同一套取向。
 *
 * 必须始终成立：手动请求是**一次性**的（`consumeManual` 取到即清），否则一次点击会被每一拍
 * 重放，间隔与费用控制全失效。
 * @module dsh-fish-body/src/host/screen/state
 */

/** 一次识屏的结论（成功给文本，失败给原因）。 */
export interface ScreenLastResult {
  /** 结论产生的时刻（毫秒）。 */
  readonly atMs: number;
  /** 是否成功说出一句。 */
  readonly ok: boolean;
  /** 成功时的那句话。 */
  readonly text?: string;
  /** 失败原因（wire 词汇：`generate-error` / `provider-missing` / `unsupported` …）。 */
  readonly reason?: string;
  /** 失败时的可读文案。 */
  readonly message?: string;
}

/** Helper 上报的前台快照（设置页据此显示「当前前台 …（未触发）」）。 */
export interface ScreenForeground {
  /** 前台窗口的进程名（`chrome` / `Code` …，不含 `.exe`）。 */
  readonly app: string;
  /** 窗口标题（可能为空串）。 */
  readonly title: string;
  /** 上报时刻（毫秒）。 */
  readonly atMs: number;
  /** 当次判定结论：`hide` = 正在躲，`show` = 不躲。 */
  readonly decision: 'hide' | 'show';
  /** 触发原因：`fullscreen` / `app` / 空串（没触发）。 */
  readonly reason: string;
}

/** 状态快照（只读，供 `/screen/state` 直接下发）。 */
export interface ScreenSnapshot {
  readonly manualPending: boolean;
  readonly lastMs: number;
  readonly last?: ScreenLastResult;
  readonly foreground?: ScreenForeground;
}

/** 识屏状态机：三个写入点 + 一个快照。 */
export interface ScreenState {
  /** 记一个待处理的手动请求（幂等：连点两次仍只拍一次）。 */
  requestManual(): void;
  /** 有没有待处理的手动请求（只读，判定用）。 */
  manualPending(): boolean;
  /** 取走手动请求（取到即清）。 */
  consumeManual(): boolean;
  /** 记一次成功识屏的时刻（间隔门用它）。 */
  noteCaptured(atMs: number): void;
  /** 记上次结论。 */
  noteResult(result: ScreenLastResult): void;
  /** 记 Helper 上报的前台快照。 */
  noteForeground(fg: ScreenForeground): void;
  /** 当前快照。 */
  snapshot(): ScreenSnapshot;
  /** 清空（插件卸载 / 测试用）：手动请求与两份记录一起丢。 */
  reset(): void;
}

/**
 * 造一个识屏状态机（生产是模块级单例，测试各造各的）。
 *
 * @returns 状态机。
 */
export function createScreenState(): ScreenState {
  let manualPending = false;
  let lastMs = 0;
  let last: ScreenLastResult | undefined;
  let foreground: ScreenForeground | undefined;
  return {
    requestManual(): void {
      manualPending = true;
    },
    manualPending(): boolean {
      return manualPending;
    },
    consumeManual(): boolean {
      const had = manualPending;
      manualPending = false;
      return had;
    },
    noteCaptured(atMs: number): void {
      lastMs = Math.round(Number(atMs) || 0);
    },
    noteResult(result: ScreenLastResult): void {
      last = result;
    },
    noteForeground(fg: ScreenForeground): void {
      foreground = fg;
    },
    snapshot(): ScreenSnapshot {
      return {
        manualPending,
        lastMs,
        ...(last === undefined ? {} : { last }),
        ...(foreground === undefined ? {} : { foreground }),
      };
    },
    reset(): void {
      manualPending = false;
      lastMs = 0;
      last = undefined;
      foreground = undefined;
    },
  };
}

/** 生产用的识屏状态（插件内唯一一份）。 */
export const screenState: ScreenState = createScreenState();
