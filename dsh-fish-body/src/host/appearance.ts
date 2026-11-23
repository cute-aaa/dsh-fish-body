/**
 * 外观与动作的当前状态：渲染端上报的**真值**，对话提示词里「你现在挂着什么」的唯一来源。
 *
 * 为什么不在宿主侧自己记账：外观有两个入口——对话（host 下发 `expression-set:`）与右键菜单
 * （渲染端本地切换，宿主看不见），再加上临时外观到点自动摘，宿主怎么记都会与画面漂移。
 * 唯一真的知道画面挂着什么的只有渲染端，所以由它上报（`POST /appearance/report`），这里只缓存。
 *
 * 不落盘、不带定时器（重启即空，符合「进程内会话状态」的既有口径）；不依赖配置与 IO。
 * 与 ./pose 同构：都是渲染端上报、宿主只读的快照表。
 * @module dsh-fish-body/src/host/appearance
 */

/** 一份上报的内容（校验后的形状）。 */
export interface AppearanceInput {
  /** 当前挂着的外观名（顺序即挂载顺序）。 */
  readonly expressions: readonly string[];
  /** 最近一次表演的动作名；没演过时缺省。 */
  readonly action?: string;
}

/** 快照 = 上报内容 + 时刻（排障用：确认这个值是不是刚上报的）。 */
export interface AppearanceSnapshot extends AppearanceInput {
  /** 上报时刻（ms）。 */
  readonly updatedAt: number;
}

/** 单条名字的长度上限（字符）：模型名与外观名都远短于此，超了说明是坏数据。 */
const MAX_NAME_LEN = 60;

/** 一次上报最多记几个外观：与对话侧的 {@link MAX_NAMES} 同量级，多了就是坏数据。 */
const MAX_EXPRESSIONS = 16;

/**
 * 校验并归一化一次上报（拒绝整包丢弃，只保留合法项）。
 *
 * 形状不对直接拒（调用方回 bad-request）：静默改写成空会让「什么都没戴」被当成真值，
 * 那比报错更难查。
 *
 * @param value - 请求体解析结果。
 * @returns 合法上报；`expressions` 必须是字符串数组（缺省当空）。
 */
export function normalizeAppearance(
  value: unknown,
): { ok: true; value: AppearanceInput } | { ok: false; reason: 'bad-request'; message: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      reason: 'bad-request',
      message: '请求体必须是对象：{ expressions?: string[], action?: string }',
    };
  }
  const o = value as { expressions?: unknown; action?: unknown };
  if (o.expressions !== undefined && !Array.isArray(o.expressions)) {
    return { ok: false, reason: 'bad-request', message: 'expressions 必须是字符串数组' };
  }
  if (o.action !== undefined && typeof o.action !== 'string') {
    return { ok: false, reason: 'bad-request', message: 'action 必须是字符串' };
  }
  const expressions: string[] = [];
  for (const item of (o.expressions ?? []) as unknown[]) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (name === '' || name.length > MAX_NAME_LEN || expressions.includes(name)) continue;
    if (expressions.length >= MAX_EXPRESSIONS) break;
    expressions.push(name);
  }
  const action = typeof o.action === 'string' ? o.action.trim() : '';
  return {
    ok: true,
    value: {
      expressions,
      ...(action === '' ? {} : { action: action.slice(0, MAX_NAME_LEN) }),
    },
  };
}

/** 上报快照表（一个插件实例一个；进程内内存态）。 */
export class AppearanceStore {
  // 与 ./pose 同因：类字段初始化器会降级出未声明的外部 helper，被 prepack 门禁拦下。
  declare private readonly byPet: Map<string, AppearanceSnapshot>;
  declare private readonly now: () => number;

  /**
   * @param opts.now - 时钟（测试注入；缺省用 Date.now）。
   */
  constructor(opts: { now?: () => number } = {}) {
    this.byPet = new Map();
    this.now = opts.now ?? Date.now;
  }

  /**
   * 记一次上报。
   *
   * @param petId - 宠物 id。
   * @param report - 已校验的上报内容。
   * @returns 刚存下的快照（含时刻）。
   */
  set(petId: string, report: AppearanceInput): AppearanceSnapshot {
    const snapshot: AppearanceSnapshot = {
      expressions: [...report.expressions],
      ...(report.action === undefined ? {} : { action: report.action }),
      updatedAt: this.now(),
    };
    this.byPet.set(petId, snapshot);
    return snapshot;
  }

  /**
   * 读最近一次上报。
   *
   * @param petId - 宠物 id。
   * @returns 快照；从没上报过时为 undefined（调用方回落成「什么都没戴」）。
   */
  get(petId: string): AppearanceSnapshot | undefined {
    return this.byPet.get(petId);
  }

  /** 忘掉一只宠物的上报（宠物被删 / 重载配置时清，避免把旧画面当成真值）。 */
  clear(petId: string): void {
    this.byPet.delete(petId);
  }
}
