/**
 * 索引的「落地信息」：每个槽位实际命中的绝对路径，以及没命中池时「建议放这里」的位置。
 *
 * 设置页只展示、不解析路径（它拿不到用户根，也不该自己拼目录）；宿主在这里按
 * host/sfx/order 的同一条层序回查，保证展示的路径就是真正会播的那一份。
 * 只读盘（`existsSync`）与拼字符串，不判定优先级——优先级已在 index-build 里定了。
 * @module dsh-pet/src/host/sfx/paths
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { slotFileStem } from '../../shared/sfx/names.ts';
import { SFX_EVENT_SLOTS } from '../../shared/sfx/types.ts';
import { displayPathOf } from '../pool/resolve.ts';
import { soundLayerDirs } from './order.ts';
import type { SfxDirs } from './scan.ts';
import type { RendererKind, SfxEventSlot, SfxFolderTarget, SfxIndex, SfxSuggestion } from '../../shared/types.ts';

/** 回查所需的输入。 */
export interface SfxPathsInput {
  /** 该宠物的音效目录集。 */
  readonly dirs: SfxDirs;
  /** 皮肤 id（`skinIdOfModel` 的结果；空串 = 根布局）。 */
  readonly model: string;
  /** 渲染方式（决定建议落到哪个池目录）。 */
  readonly renderer: RendererKind;
  /** 用户数据根（把绝对路径折成可读的相对路径）。 */
  readonly userRoot: string;
  /** 已建好的索引。 */
  readonly index: SfxIndex;
}

/** 回查结果：与 {@link SfxIndex} 同形的附加字段。 */
export interface SfxPaths {
  readonly paths: Partial<Record<SfxEventSlot, string>>;
  readonly hookPaths: Record<string, string>;
  readonly suggestions: Partial<Record<SfxEventSlot, SfxSuggestion>>;
}

/** 池的三个来源：命中它们就说明用户已经按新布局放好了，不必再提示。 */
function isPoolOrigin(origin: string | undefined): boolean {
  return origin === 'pool-skin' || origin === 'pool-renderer' || origin === 'pool-global';
}

/** 在层序里回查一个文件名，返回第一个真实存在的绝对路径。 */
function locate(layers: readonly { dir: string }[], file: string): string | undefined {
  for (const layer of layers) {
    const candidate = join(layer.dir, file);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** 建议落点：渲染方式 → 池目录、「打开文件夹」类别与建议文件名。 */
function suggestFor(
  dirs: SfxDirs,
  renderer: RendererKind,
  slot: SfxEventSlot,
): { dir: string; which: SfxFolderTarget; name: string } | undefined {
  const stem = slotFileStem(slot) + '.wav';
  if (renderer === 'webm') {
    if (dirs.poolWebmDir === undefined) return undefined;
    return { dir: dirs.poolWebmDir, name: 'webm-' + stem, which: 'pool-webm' };
  }
  // 没有独立的池资源目录（model 为空 = 根布局）时不给建议：池里没有对应的落点，
  // 写了文件名也不会被第 1/2 级命中，提示「放这里」只会误导。
  if (dirs.poolSkinDir === undefined) return undefined;
  const owner = dirs.poolSkinName ?? '';
  const name = owner === '' ? stem : owner + '-' + stem;
  return { dir: dirs.poolSkinDir, name, which: renderer === 'layered' ? 'pool-layered' : 'pool-live2d' };
}

/**
 * 算出落地信息。
 *
 * @param input - 目录集、皮肤、渲染方式、用户根与索引。
 * @returns 命中路径、hook 路径与「建议放这里」。
 */
export function sfxPathsOf(input: SfxPathsInput): SfxPaths {
  const { dirs, index, model, renderer, userRoot } = input;
  const layers = soundLayerDirs(dirs, model);
  const paths: Partial<Record<SfxEventSlot, string>> = {};
  const suggestions: Partial<Record<SfxEventSlot, SfxSuggestion>> = {};

  for (const slot of SFX_EVENT_SLOTS) {
    const file = index.events[slot];
    if (file !== undefined && file !== '') {
      const hit = locate(layers, file);
      if (hit !== undefined) paths[slot] = hit;
    }
    if (isPoolOrigin(index.origin[slot])) continue;
    const suggestion = suggestFor(dirs, renderer, slot);
    if (suggestion === undefined) continue;
    const absolute = join(suggestion.dir, suggestion.name);
    suggestions[slot] = {
      absolute,
      relative: displayPathOf(userRoot, absolute),
      which: suggestion.which,
    };
  }

  const hookPaths: Record<string, string> = {};
  for (const [name, file] of Object.entries(index.hooks)) {
    if (file === '') continue;
    const hit = locate(layers, file);
    if (hit !== undefined) hookPaths[name] = hit;
  }

  return { hookPaths, paths, suggestions };
}
