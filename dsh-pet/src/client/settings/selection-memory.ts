/**
 * 实例选择记忆：把设置页「桌宠」里选中的那只记在 `localStorage`，刷新后仍停在它上面。
 *
 * 与分区记忆（`tab-memory.ts`）同一套取存储口与吞错口径：存储不可用 / 读抛错 / 值已失效
 * 一律退化成「不记忆」，绝不阻塞设置页。存的是**裸 petId**，不存 `{kind, petId}`——种类可由
 * petId 反查，存两份迟早会因为「实例被移到别的种类」而互相矛盾。
 *
 * 持久化的值只是**候选**，不是真相：它只能在没有更好信息时占位，任何一次权威列表到达都要用
 * {@link resolveSelection} 重新校验（首次渲染与 `replace()` 都走这一个函数，回落规则只有一份）。
 * @module dsh-fish-body/src/client/settings/selection-memory
 */
import type { Pet } from '../../shared/types.ts';
import { settingsTabStorage, type TabStorage } from './tab-memory.ts';

/** 记住选中的实例用的存储键（与 `dsh-pet/settings-tab` 同一命名族）。 */
export const PET_STORAGE_KEY = 'dsh-pet/settings-pet';

/** 一次「选中了哪只」的结论：宠物 id 与它所属的种类条目。 */
export interface PetSelection {
  /** 选中的实例 id；空串 = 没有可选的实例。 */
  readonly petId: string;
  /** 该实例所属的种类条目（`main` 或包前缀）。 */
  readonly kind: string;
}

/**
 * 读上次选中的实例。
 *
 * @param storage - 存储口；`null` 表示没有可用存储。
 * @returns 记过的 petId；没记过、空串、读失败时 `null`（调用方按「不记忆」处理）。
 */
export function readPetSelection(storage: TabStorage | null): string | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(PET_STORAGE_KEY);
    return raw === null || raw === '' ? null : raw;
  } catch {
    return null;
  }
}

/**
 * 记住当前选中的实例。
 *
 * @param storage - 存储口；`null` 表示没有可用存储。
 * @param petId - 选中的实例 id；空串表示「当前没有选中」。
 */
export function savePetSelection(storage: TabStorage | null, petId: string): void {
  if (storage === null) return;
  try {
    storage.setItem(PET_STORAGE_KEY, petId);
  } catch {
    // 写不进（隐私模式 / 配额满）：记不住下一次而已，不该让切换实例失败。
  }
}

/**
 * 把「上次记住的 id」+「当前权威列表」解析成一次有效的选择。
 *
 * 三条回落规则（顺序固定，`replace()` 与首次渲染共用这一个函数）：
 *   1. 记着的 id 还在列表里 → 用它，并把**种类**一并纠正成它自己的 `assetRoot`
 *      （否则会出现「选中的 chip 不在当前种类里」：卡片显示一只、chip 行是另一个种类）；
 *   2. 不在了 → 取 `fallbackKind` 的第一只；
 *   3. 该种类一只都不剩 → 退回列表里的第一只；列表本身为空才交出空选择。
 *
 * @param saved - {@link readPetSelection} 的结果。
 * @param pets - 当前权威实例列表（全条目拍平）。
 * @param fallbackKind - 没有可用记忆时该停在哪个种类（通常是当前种类或第一个条目）。
 * @returns 宠物 id 与种类；两者永远自洽（`kind` 一定是 `petId` 所属的种类）。
 */
export function resolveSelection(saved: string | null, pets: readonly Pet[], fallbackKind: string): PetSelection {
  const remembered = saved === null ? undefined : pets.find((pet) => pet.id === saved);
  if (remembered !== undefined) return { petId: remembered.id, kind: remembered.assetRoot ?? 'main' };
  const inKind = pets.find((pet) => (pet.assetRoot ?? 'main') === fallbackKind);
  if (inKind !== undefined) return { petId: inKind.id, kind: fallbackKind };
  const first = pets[0];
  if (first !== undefined) return { petId: first.id, kind: first.assetRoot ?? 'main' };
  return { petId: '', kind: fallbackKind };
}

/** 便捷组合：直接从浏览器存储读记忆（调用方只想「记住的那只」时用）。 */
export function readPetSelectionFromBrowser(): string | null {
  return readPetSelection(settingsTabStorage());
}
