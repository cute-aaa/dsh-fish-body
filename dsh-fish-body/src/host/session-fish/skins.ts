/**
 * 会话鱼的皮肤池：用户目录优先、包内动画兜底，列出可选项并按 id 取文件。
 *
 * 为什么不做上传：宿主请求体的总上限是 1 MiB（`MAX_BODY_BYTES`），而包内 webm 普遍 300–1300 KB，
 * 走 base64 上传必然一半失败。皮肤和桌宠动画走同一条路——文件放进目录，设置页只认名字。
 * 只读：列目录与解析路径，不建目录、不写文件（建目录归 `/open-folder?create=1`）。
 * 必须始终成立：任何用户输入都先过 `isSessionFishSkinName`，再用 `resolveExisting` 兜一次越界，
 * 两道都不放行就当作不存在——皮肤名是 URL 段，绝不能凭它拼出池外的路径。
 * @module dsh-fish-body/src/host/session-fish/skins
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../paths.ts';
import { userPaths } from '../user-layout.ts';
import { resolveExisting } from '../http.ts';
import {
  isSessionFishSkinName,
  sessionFishSkinKindOf,
  SESSION_FISH_SKIN_EXTS,
  type SessionFishSkinKind,
} from '../../shared/session-fish.ts';

/** 用户皮肤目录名（放在插件数据根下，与 `session-fish.json` 同级）。 */
export const SESSION_FISH_SKIN_DIR = 'assets/session-fish';

/** 一次皮肤列举的结果条目。 */
export interface SessionFishSkinItem {
  /** 皮肤 id（= 文件名，也是设置的取值）。 */
  readonly id: string;
  /** 设置页显示的标签：去掉扩展名。 */
  readonly label: string;
  /** 渲染方式。 */
  readonly kind: SessionFishSkinKind;
  /** 来源：用户目录 / 包内。 */
  readonly source: 'user' | 'pack';
}

/** 皮肤池的两个目录（都存在时才参与列举；不存在只是空池，不报错）。 */
export interface FishSkinDirs {
  /** 用户目录：`<数据根>/assets/session-fish`。 */
  readonly user: string;
  /** 包内目录：`assets/webm`（现成的一百多段小动作）。 */
  readonly pack: string;
}

/**
 * 用户皮肤目录的绝对路径。
 *
 * @param userRoot - 插件数据根。
 * @returns `<数据根>/assets/session-fish`。
 */
export function fishSkinUserDir(userRoot: string): string {
  return userPaths(userRoot).fishSkinDir;
}

/**
 * 皮肤池目录。
 *
 * @param userRoot - 插件数据根。
 * @returns 用户目录（优先）与包内目录。
 */
export function fishSkinDirs(userRoot: string): FishSkinDirs {
  return { user: fishSkinUserDir(userRoot), pack: join(PACKAGE_ROOT, 'assets', 'webm') };
}

/** 标签：去掉扩展名；空名回退原 id。 */
function labelOf(id: string): string {
  const dot = id.lastIndexOf('.');
  const base = dot > 0 ? id.slice(0, dot) : id;
  return base === '' ? id : base;
}

/** 文件名按 UTF-16 code unit 排序，避免不同系统的 ICU 语言排序产生不同清单。 */
function compareSkinNames(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 列一个目录里扩展名白名单内的文件；读不到就当空目录。 */
function readDirSkins(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((name) => sessionFishSkinKindOf(name) !== null).sort(compareSkinNames);
}

/**
 * 列举全部可选皮肤：用户目录在前（同名的包内条目被它盖掉），各自按名字排序。
 *
 * @param dirs - 皮肤池目录。
 * @returns 去重后的条目；两个目录都不存在时为空数组。
 */
export function listFishSkins(dirs: FishSkinDirs): SessionFishSkinItem[] {
  const out: SessionFishSkinItem[] = [];
  const seen = new Set<string>();
  for (const [source, dir] of [
    ['user', dirs.user],
    ['pack', dirs.pack],
  ] as const) {
    for (const id of readDirSkins(dir)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const kind = sessionFishSkinKindOf(id);
      if (kind === null) continue;
      out.push({ id, kind, label: labelOf(id), source });
    }
  }
  return out;
}

/**
 * 皮肤 id → 磁盘文件。
 *
 * @param dirs - 皮肤池目录。
 * @param id - 皮肤 id（URL/设置里的原始值）。
 * @returns 绝对路径；名字非法、扩展名不认或文件不存在时 `undefined`。
 */
export function resolveFishSkin(dirs: FishSkinDirs, id: string): string | undefined {
  if (!isSessionFishSkinName(id) || id === '') return undefined;
  for (const dir of [dirs.user, dirs.pack]) {
    const hit = resolveExisting(dir, id);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** 扩展名白名单（宿主侧校验失败时的提示文案用）。 */
export const SESSION_FISH_SKIN_EXT_HINT = SESSION_FISH_SKIN_EXTS.join(' / ');
