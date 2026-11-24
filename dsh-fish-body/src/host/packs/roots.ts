/**
 * 素材的「扩展根链」：包内之外，还允许从用户目录与已安装资源包取文件。
 *
 * 顺序固定为**用户显式放的优先，资源包其次，包内最后**（包内的兜底由调用方拼在链尾）：
 * - `<数据根>/<subdir>/`：用户自己丢进来的（例如已购字体、从 Live2D 官方下载的 Core）；
 * - `<数据根>/packs/<id>/<subdir>/`：按约定目录组织的包；
 * - `<数据根>/packs/<id>/`：包解压后直接平铺（打 zip 的人常常不带外层目录）。
 *
 * 只解析、不建目录、不读清单：入口是「装了哪些包」这一事实（`listInstalled`），
 * 因此半装目录不会被当成可用来源。
 * @module dsh-fish-body/src/host/packs/roots
 */
import { join } from 'node:path';
import { resolveExisting } from '../http.ts';
import { listInstalled } from './state.ts';

/** 扩展根链需要的两处位置。 */
export interface ExtraRootDeps {
  /** 用户数据根（`<数据根>/fonts`、`<数据根>/cubism` 就在它下面）。 */
  readonly userRoot?: string;
  /** 资源包安装根（`<数据根>/packs`）。 */
  readonly packsRoot?: string;
}

/**
 * 列出某个子目录的候选根（按优先级）。
 *
 * 缺 `userRoot` / `packsRoot` 的调用方（多为单测桩）会自然退化成空链，不抛异常。
 * @param deps - 扩展根依赖。
 * @param subdir - 子目录名（`fonts` / `cubism`）。
 * @returns 候选根绝对路径（可能为空数组）。
 */
export function extraAssetRoots(deps: ExtraRootDeps, subdir: string): string[] {
  const roots: string[] = [];
  if (typeof deps.userRoot === 'string' && deps.userRoot !== '') roots.push(join(deps.userRoot, subdir));
  if (typeof deps.packsRoot === 'string' && deps.packsRoot !== '') {
    for (const pack of listInstalled(deps.packsRoot)) {
      roots.push(join(deps.packsRoot, pack.id, subdir));
      roots.push(join(deps.packsRoot, pack.id));
    }
  }
  return roots;
}

/**
 * 在扩展根链里找一个文件。
 *
 * 每个根都经 {@link resolveExisting}：路径穿越与「不存在」都返回 undefined，与包内取文件同一套守卫。
 * @param deps - 扩展根依赖。
 * @param subdir - 子目录名。
 * @param rel - 相对路径（URL 里 `<scope>/` 之后的部分）。
 * @returns 命中的绝对路径；都没命中为 undefined。
 */
export function resolveExtraAsset(deps: ExtraRootDeps, subdir: string, rel: string): string | undefined {
  for (const root of extraAssetRoots(deps, subdir)) {
    const hit = resolveExisting(root, rel);
    if (hit !== undefined) return hit;
  }
  return undefined;
}
