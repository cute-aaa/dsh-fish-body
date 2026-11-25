/**
 * 共存：检测「还有谁在驱动同一只宠物」，并提供一个显式的「只做身体」开关。
 *
 * 为什么需要：surfcore 自带 `pet/{chat,voice}`（它自己也有宠物聊天），Coopanion 自带窗口与 Habits
 * （响应模式 + 每日闹钟）。装在同一台机器上时，两边都会让宠物说话——这不是 bug，是职责重叠。
 * 本插件的定位是「身体」，所以提供一条**显式**的让位路径，而不是自己猜对方想怎么分工：
 *
 * - `auto`（缺省）：只报告检测结果，**不改变任何行为**。自动静音会让用户莫名其妙（"宠物怎么不说话了"），
 *   比多一个可见提示更糟。
 * - `body-only`：停用**周期**碎碎念（自动来源），手动触发、对话、点击回应照常。
 * - `full`：忽略检测结果，全部功能照用。
 *
 * 模式是进程内状态、不落盘：这是「这次调试/共存期间」的开关，不是配置项。重启回到 `auto`。
 * @module dsh-fish-body/src/host/coexist
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** 共存模式。 */
export type CoexistMode = 'auto' | 'full' | 'body-only';

/** 检测到的同伴。 */
export interface CoexistPartner {
  readonly id: string;
  readonly label: string;
  /** 命中的证据（相对 DSH 根或家目录，便于用户核对）。 */
  readonly evidence: string;
  /** 重叠程度：`high` = 它自己也有宠物窗口/语音；`medium` = 只共享记忆或人格目录。 */
  readonly risk: 'high' | 'medium';
}

/** 检测输入。 */
export interface CoexistDetectInput {
  readonly dshHome: string;
  readonly home: string;
  readonly appData: string;
}

/**
 * 探测已知会与本插件职责重叠的项目。
 *
 * **只认硬证据**：`surfcore/pet/host.json` 说明它真的在跑自己的宠物宿主；
 * Coopanion 认它的工作区里有 `PARTNER.md`（装过并且初始化过）。目录存在但没这些文件的不算——
 * 否则每个残留目录都会变成一条告警。
 *
 * @param input - DSH 根 / 家目录 / AppData。
 * @returns 命中的同伴（顺序固定）；没有时为空数组。
 */
export function detectCoexistPartners(input: CoexistDetectInput): CoexistPartner[] {
  const out: CoexistPartner[] = [];
  const surfcorePet = join(input.dshHome, 'surfcore', 'pet', 'host.json');
  if (existsSync(surfcorePet)) {
    out.push({
      id: 'surfcore',
      label: 'surfcore（自带宠物聊天与语音）',
      evidence: 'surfcore/pet/host.json',
      risk: 'high',
    });
  }
  const coopanionRoots = [
    join(input.dshHome, 'coopanion'),
    join(input.home, '.coopanion'),
    join(input.appData, 'Coopanion'),
    join(input.appData, 'coopanion'),
  ];
  const coopanion = coopanionRoots.find(
    (root) => existsSync(join(root, 'PARTNER.md')) || existsSync(join(root, 'memory', 'PARTNER.md')),
  );
  if (coopanion !== undefined) {
    out.push({
      id: 'coopanion',
      label: 'Coopanion（自带窗口、Habits 与每日闹钟）',
      evidence: coopanion.replace(/\\/g, '/'),
      risk: 'high',
    });
  }
  return out;
}

/** `GET /coexist` 的视图。 */
export interface CoexistView {
  readonly mode: CoexistMode;
  readonly partners: readonly CoexistPartner[];
  /** 周期碎碎念是否被让位（`body-only` 时为 true）。 */
  readonly autoWhisperPaused: boolean;
}

/** 共存状态。 */
export class CoexistStore {
  declare private mode_: CoexistMode;
  declare private readonly partners: readonly CoexistPartner[];

  /**
   * @param partners - 启动时探测到的同伴（探测只做一次：这是环境事实，不是每次请求都要 stat 的东西）。
   * @param mode - 初始模式，缺省 `auto`。
   */
  constructor(partners: readonly CoexistPartner[] = [], mode: CoexistMode = 'auto') {
    this.partners = partners;
    this.mode_ = mode;
  }

  /** 当前模式。 */
  mode(): CoexistMode {
    return this.mode_;
  }

  /**
   * 切换模式。
   * @param next - 目标模式；非法值抛 {@link TypeError}（路由层已先校验）。
   * @returns 是否真的变了。
   */
  set(next: CoexistMode): boolean {
    if (next !== 'auto' && next !== 'full' && next !== 'body-only') {
      throw new TypeError('coexist mode 只能是 auto / full / body-only');
    }
    if (this.mode_ === next) return false;
    this.mode_ = next;
    return true;
  }

  /**
   * 周期碎碎念能不能跑。
   *
   * 只挡**自动来源**：手动触发、对话、点击回应一律照常——用户主动点的东西不该被共存设置吞掉。
   */
  allowAutoWhisper(): boolean {
    return this.mode_ !== 'body-only';
  }

  /** 读视图。 */
  view(): CoexistView {
    return { mode: this.mode_, partners: this.partners, autoWhisperPaused: !this.allowAutoWhisper() };
  }
}
