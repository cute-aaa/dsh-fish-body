/**
 * 用户目录的初始化：启动时把布局里约定的目录建出来，并给每个目录写一句备注。
 *
 * 存在意义是让「打开文件夹」永远不用先问「要不要创建」，也顺带把目录约定（`skin/` 怎么放、
 * 内置池根 `assets/pet` 是扁平存放）摆在用户眼前——目录本身就是自解释的说明书，比在文档里找树状图便宜。
 * 只建目录、写备注，不写占位文件：空目录不参与任何扫描（池对空目录与不存在同义），删了下次启动会再建。
 * 任何一步失败都只记录、不抛：数据根落在只读盘或没有权限时，插件本身照常可用。
 * @module dsh-fish-body/src/host/layout
 */
import { existsSync, mkdirSync } from 'node:fs';
import { writeFolderNotes, type FolderNoteResult, type NoteFs } from './folder-note.ts';
import { layoutDirs, layoutNotes, type UserPaths } from './user-layout.ts';

/** 初始化需要知道的目录与可选项。 */
export interface LayoutInput {
  /** `userPaths()` 的结果：本插件数据根的完整路径表。 */
  readonly paths: UserPaths;
  /** 动画子目录名；缺省 `webm` 与 `mov`（宿主按扩展名各用一条，见 `animSubdirFor`）。 */
  readonly animSubdirs?: readonly string[];
  /** 用户皮肤目录下的渲染方式子目录名；缺省 `layered` / `live2d` / `webm`。 */
  readonly skinLayerDirs?: readonly string[];
  /** 用户皮肤目录下的音效子目录名（缺省 `sound`）。 */
  readonly skinSoundDir?: string;
  /** 是否写文件夹备注；缺省 `true`（测试与特殊环境可关）。 */
  readonly notes?: boolean;
  /** 平台与替身（测试注入）。 */
  readonly platform?: NodeJS.Platform;
  readonly noteFs?: NoteFs;
  readonly runAttrib?: (args: readonly string[]) => void;
}

/** 初始化的结果：建了哪些、哪些没建成、备注写得怎样。 */
export interface LayoutResult {
  /** 全部候选目录（按创建顺序，已去重）。 */
  readonly dirs: readonly string[];
  /** 本次真正新建出来的目录。 */
  readonly created: readonly string[];
  /** 建不出来的目录与原因（已经存在的目录不在此列）。 */
  readonly failed: readonly { readonly dir: string; readonly error: string }[];
  /** 备注的写入结果（按目录；`notes: false` 时为空对象）。 */
  readonly notes: Readonly<Record<string, FolderNoteResult>>;
}

/**
 * 算出初始化该有的全部目录。
 *
 * 顺序是「浅层在前」：根 → 六个分组 → 各自的约定子目录，见 `user-layout.layoutDirs`。
 *
 * @param input - 路径表与可选子目录名。
 * @returns 目录绝对路径，去重后按创建顺序排列。
 */
export function userLayoutDirs(input: LayoutInput): string[] {
  return layoutDirs({
    paths: input.paths,
    ...(input.animSubdirs === undefined ? {} : { animSubdirs: input.animSubdirs }),
    ...(input.skinLayerDirs === undefined ? {} : { skinLayerDirs: input.skinLayerDirs }),
    ...(input.skinSoundDir === undefined ? {} : { skinSoundDir: input.skinSoundDir }),
  });
}

/**
 * 建出初始化的目录结构并写备注。
 *
 * 备注只在目录**确实存在**之后写（刚建失败就没有可写的地方）。
 *
 * @param input - 路径表与可选项。
 * @returns 建了哪些、哪些没建成、备注结果。
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

  if (input.notes === false) return { created, dirs, failed, notes: {} };
  const wanted = layoutNotes(input.paths);
  const existing = new Map<string, string>();
  for (const [dir, note] of wanted) if (existsSync(dir)) existing.set(dir, note);
  const notes = writeFolderNotes(existing, {
    ...(input.platform === undefined ? {} : { platform: input.platform }),
    ...(input.noteFs === undefined ? {} : { fs: input.noteFs }),
    ...(input.runAttrib === undefined ? {} : { runAttrib: input.runAttrib }),
  });
  return { created, dirs, failed, notes };
}
