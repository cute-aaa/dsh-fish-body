/**
 * 外部记忆的候选探测与运行状态：让「装了的记忆插件到底有没有被接上」变成可查询的事实。
 *
 * 为什么需要这一层：记忆后端是**单槽**（`chat-memory-provider.ts`：两个 recall 同时改内容会互相冲突），
 * 所以同时装了 rofm 与 suzu 时只有一个会生效。没有可观测出口的话，用户看到的是
 * 「我装了 suzu，为什么它不记得」——而真相是另一份把槽占了。
 *
 * 只做探测与记账，不注册、不读文件内容（读取在 `./external.ts`）。
 * @module dsh-fish-body/src/host/memory/status
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 一个候选记忆来源。 */
export interface MemoryCandidate {
  /** 来源 id（也是注册进单槽时用的 id）。 */
  readonly id: string;
  /** 展示名。 */
  readonly label: string;
  /** 要读的目录（绝对路径）。 */
  readonly dir: string;
  /** 目录存在且至少有一个人可读的记忆文件。 */
  readonly installed: boolean;
  /** 命中的原因：目录或文件的形式（排障用）。 */
  readonly evidence: string;
}

/** 当前生效的 provider 状态。 */
export interface MemoryProviderStatus {
  readonly id: string;
  readonly dir: string;
  /** 注册时刻（ISO 8601）。 */
  readonly registeredAt: string;
  /** 最近一次成功读到多少条记忆。 */
  readonly notes: number;
  /** 最近一次读时跳过的文件数。 */
  readonly skipped: number;
  /** 最近一次读取时刻（ISO 8601）；没读过为空串。 */
  readonly lastReadAt: string;
}

/** `GET /memory` 的完整视图。 */
export interface MemoryView {
  /** 生效的 provider；没接上时为 null。 */
  readonly provider: MemoryProviderStatus | null;
  /** 探测到的全部候选（含未安装的，让用户看到「为什么没生效」）。 */
  readonly candidates: readonly MemoryCandidate[];
  /** 单槽是否被别的实现占着（第三方插件抢先注册时为 true）。 */
  readonly slotTakenByOther: boolean;
}

/** 认作记忆文件的扩展名。 */
const MEMORY_EXTS = ['.md', '.txt', '.json'];

/** 候选来源的定义：id → 展示名 + 相对 DSH 根的目录名。 */
const SOURCES: readonly { id: string; label: string }[] = [
  { id: 'dsh-rofm', label: 'dsh-rofm（长期记忆归档）' },
  { id: 'dsh-suzu-memory', label: 'dsh-suzu-memory（会话记忆）' },
];

/** 目录里是否有至少一个记忆文件（只看一层，够判断「装没装」）。 */
function hasMemoryFile(dir: string): boolean {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return false;
  }
  for (const name of names) {
    if (name.startsWith('.')) continue;
    if (!MEMORY_EXTS.some((ext) => name.toLowerCase().endsWith(ext))) continue;
    try {
      if (statSync(join(dir, name)).isFile()) return true;
    } catch {
      // 读不到就当没有：探测不该因为一个坏项而整体失败
    }
  }
  return false;
}

/**
 * 探测候选记忆来源。
 *
 * 每个来源看两个位置：它自己的目录（`<DSH_HOME>/<id>/`）与它惯用的归档子目录
 * （`<DSH_HOME>/<id>/memory/`，rofm 的形态）。**只看一层**——深层递归会把
 * `backups/` 里成百上千个快照也算成记忆。
 *
 * @param dshHome - DSH 数据根。
 * @returns 候选列表（顺序固定：rofm 在前，与注册优先级一致）。
 */
export function detectMemoryCandidates(dshHome: string): MemoryCandidate[] {
  const out: MemoryCandidate[] = [];
  for (const source of SOURCES) {
    const root = join(dshHome, source.id);
    const archive = join(root, 'memory');
    // 归档子目录优先：它才是「记忆」所在，根目录里通常还混着插件自己的设置
    const dir = hasMemoryFile(archive) ? archive : root;
    const installed = hasMemoryFile(dir);
    out.push({
      id: source.id,
      label: source.label,
      dir,
      installed,
      evidence: installed ? (dir === archive ? 'memory/ 归档目录' : '插件根目录') : '没有记忆文件',
    });
  }
  return out;
}

/** 当前生效的 provider 状态；null = 没接上。 */
let providerStatus: MemoryProviderStatus | null = null;
/** 最近一次探测到的候选。 */
let candidates: readonly MemoryCandidate[] = [];
/** 单槽是否被别人占着。 */
let slotTaken = false;

/** 写入生效状态（接线时调用一次；读到记忆后刷新计数）。 */
export function setMemoryProviderStatus(status: MemoryProviderStatus | null): void {
  providerStatus = status;
}

/** 刷新生效状态里的读结果（保持 id / dir / registeredAt 不变）。 */
export function updateMemoryReadResult(notes: number, skipped: number, at: string): void {
  if (providerStatus === null) return;
  providerStatus = { ...providerStatus, notes, skipped, lastReadAt: at };
}

/** 写入候选列表（接线时调用一次）。 */
export function setMemoryCandidates(list: readonly MemoryCandidate[]): void {
  candidates = list;
}

/** 标记单槽被别的实现占着。 */
export function setMemorySlotTaken(taken: boolean): void {
  slotTaken = taken;
}

/**
 * 读当前视图。
 * @returns provider / 候选 / 占槽状态；从没接线时 provider 为 null、候选为空。
 */
export function memoryView(): MemoryView {
  return { provider: providerStatus, candidates, slotTakenByOther: slotTaken };
}

/**
 * 清空全部状态（测试隔离用；卸载时也调一次，避免重载后残留上一份的记账）。
 * @internal
 */
export function resetMemoryStatus(): void {
  providerStatus = null;
  candidates = [];
  slotTaken = false;
}
