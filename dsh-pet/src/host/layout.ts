/**
 * 用户目录的初始化结构：插件启动时把「设置页高级配置里的那几个目录」先建出来。
 *
 * 存在意义是让「打开文件夹」永远不用先问「要不要创建」，也顺带把池的目录约定（`layered` / `live2d` /
 * `webm` / `sound`）摆在用户眼前——目录本身就是自解释的说明书，比在文档里找树状图便宜。
 * 只建目录、不写占位文件：空目录不参与任何扫描（池对空目录与不存在同义），删了下次启动会再建。
 * 任何一步失败都只记录、不抛：数据根落在只读盘或没有权限时，插件本身照常可用。
 * @module dsh-pet/src/host/layout
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { POOL_LAYER_DIR, POOL_SOUND_DIR } from '../shared/pool.ts';
import { POOL_RENDERERS } from './pool/resolve.ts';

/** 初始化需要知道的几个用户级目录。 */
export interface LayoutInput {
  /** 本插件的数据根（`<DSH_HOME>/dsh-pet`）。 */
  readonly userRoot: string;
  /** 用户动画目录（`main-animation`，下面按扩展名再分子目录）。 */
  readonly animations: string;
  /** 用户表情包目录（`memes`）。 */
  readonly memes: string;
  /** 共享资源池的根（`assets.pool` 的解析结果，默认 `<用户根>/skin`）。 */
  readonly poolRoot: string;
  /** 会话鱼的皮肤目录（`<用户根>/session-fish-skin`）；缺省不建。 */
  readonly fishSkin?: string;
  /** 动画子目录名；缺省 `webm` 与 `mov`（宿主按扩展名各用一条，见 `animSubdirFor`）。 */
  readonly animSubdirs?: readonly string[];
}

/** 初始化的结果：建了哪些、哪些没建成。 */
export interface LayoutResult {
  /** 全部候选目录（按创建顺序，已去重）。 */
  readonly dirs: readonly string[];
  /** 本次真正新建出来的目录。 */
  readonly created: readonly string[];
  /** 建不出来的目录与原因（已经存在的目录不在此列）。 */
  readonly failed: readonly { readonly dir: string; readonly error: string }[];
}

/** 缺省动画子目录：与 `animSubdirFor` 的两个返回值一致。 */
const DEFAULT_ANIM_SUBDIRS: readonly string[] = ['webm', 'mov'];

/**
 * 算出初始化该有的全部目录。
 *
 * 顺序是「浅层在前」：`<用户根>` → 各用户目录 → 池根 → 池的四个约定目录 → 各渲染方式的兜底音效目录。
 * 池根的四个约定目录固定为 `layered` / `live2d` / `webm` / `sound`（与 `docs/CONFIG.md` 的树状图同源）。
 *
 * @param input - 用户级目录。
 * @returns 目录绝对路径，去重后按创建顺序排列。
 */
export function userLayoutDirs(input: LayoutInput): string[] {
  const animSubdirs = input.animSubdirs ?? DEFAULT_ANIM_SUBDIRS;
  const out: string[] = [input.userRoot];
  for (const sub of animSubdirs) out.push(join(input.animations, sub));
  out.push(input.animations, input.memes, input.poolRoot);
  if (input.fishSkin !== undefined) out.push(input.fishSkin);
  for (const renderer of POOL_RENDERERS) {
    const layer = join(input.poolRoot, POOL_LAYER_DIR[renderer]);
    out.push(layer, join(layer, POOL_SOUND_DIR));
  }
  out.push(join(input.poolRoot, POOL_SOUND_DIR));
  return [...new Set(out)];
}

/**
 * 建出初始化的目录结构。
 *
 * @param input - 用户级目录。
 * @returns 建了哪些、哪些没建成。目录本来就存在时 `created` 里不会出现它。
 */
export function ensureUserLayout(input: LayoutInput): LayoutResult {
  const dirs = userLayoutDirs(input);
  const created: string[] = [];
  const failed: { dir: string; error: string }[] = [];
  for (const dir of dirs) {
    if (existsSync(dir)) continue;
    try {
      mkdirSync(dir, { recursive: true });
      created.push(dir);
    } catch (error) {
      failed.push({ dir, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { created, dirs, failed };
}
