/**
 * 文件名 → 语义的纯解析：`<皮肤名>-click.wav`、`写代码.wav`、`hook-ding.wav` 各归哪一类。
 *
 * 皮肤身份优先由**所在目录**给出（皮肤根目录里的文件名不需要前缀）；本模块只负责
 * 「目录之外的扁平目录（`-sound/`）里用前缀表达归属」这一种写法，以及槽名/动作名/hook 的判别。
 * 只做字符串处理，不读盘、不知道目录结构。
 * @module dsh-pet/src/shared/sfx/names
 */

import { BUMP_SLOT, canonicalSlotOf } from './defaults.ts';
import type { SfxEventSlot } from '../types.ts';

/** 解析结果：归属皮肤 + 语义类别 + 名字。 */
export interface ParsedSfxName {
  /** 归属皮肤；`''` = 不分皮肤（所有皮肤共用）。 */
  readonly skin: string;
  /** 语义类别；`bump` 是三个碰撞槽的通用兜底。 */
  readonly kind: 'slot' | 'anim' | 'hook' | 'bump';
  /** `kind === 'slot'` 时的槽位。 */
  readonly slot?: SfxEventSlot;
  /** `kind === 'anim'` / `'hook'` 时的名字。 */
  readonly name?: string;
}

/** hook 文件名的前缀：`hook-ding.wav` / `<皮肤>-hook-ding.wav`。 */
const HOOK_PREFIX = 'hook-';

/** 去掉音频扩展名（大小写不敏感）；没有扩展名时原样返回。 */
export function stripAudioExt(file: string): string {
  return file.replace(/\.(wav|ogg|mp3|m4a)$/i, '');
}

/**
 * 解析一个音频文件的基名。
 *
 * @param file - 文件名（可带扩展名，可带 `<皮肤名>-` 前缀）。
 * @param skins - 已知皮肤清单；用于剥前缀，长的优先（避免 `a` 抢走 `a-b` 的文件）。
 * @returns 解析结果；基名为空时返回 `null`。
 */
export function parseSfxFileName(file: string, skins: readonly string[] = []): ParsedSfxName | null {
  const base = stripAudioExt(file).trim();
  if (base === '') return null;
  const ordered = skins.filter((skin) => skin !== '').sort((a, b) => b.length - a.length);
  let skin = '';
  let rest = base;
  for (const candidate of ordered) {
    if (base.length > candidate.length && base.startsWith(candidate + '-')) {
      skin = candidate;
      rest = base.slice(candidate.length + 1);
      break;
    }
  }
  if (rest === '') return null;
  const lower = rest.toLowerCase();
  // 槽名先判：它是封闭集合，不会被任意动画名误伤（动画名是中文，槽名是英文短词）。
  const slot = canonicalSlotOf(rest);
  if (slot !== undefined) return { skin, kind: 'slot', slot };
  if (lower === BUMP_SLOT) return { skin, kind: 'bump' };
  if (lower.startsWith(HOOK_PREFIX)) {
    const name = rest.slice(HOOK_PREFIX.length);
    return name === '' ? null : { skin, kind: 'hook', name };
  }
  return { skin, kind: 'anim', name: rest };
}

/**
 * 给一个文件名补上皮肤前缀（宿主扫描扁平目录时构造 `beiluoye-click.wav` 用）。
 *
 * @param skin - 皮肤名；空串表示不加前缀。
 * @param name - 基名（不含扩展名）。
 * @param ext - 扩展名（含点）。
 * @returns 文件名。
 */
export function withSkinPrefix(skin: string, name: string, ext: string): string {
  return (skin === '' ? name : skin + '-' + name) + ext;
}

/**
 * 槽名 → 文件名基名（`sleepStart` → `sleep-start`）。
 *
 * 扫描侧对驼峰与连字符两种写法等价（见 {@link parseSfxFileName}），设置页的命名提示统一展示连字符形式。
 *
 * @param slot - 事件槽。
 * @returns 可直接拼进文件名提示的基名。
 */
export function slotFileStem(slot: SfxEventSlot): string {
  return slot.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
