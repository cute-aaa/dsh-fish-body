/**
 * 分层皮肤的清单位置：一个素材根里可以同时放分层皮肤与 live2d 模型。
 *
 * `manifest.json` 在根上是老布局（`skin/<素材根>-skin/manifest.json`）；
 * 新布局把它收进子目录，好让同一个素材根既装 `.model3.json` 又装分层美术：
 *   skin/<素材根>-skin/live2d/<模型>.model3.json
 *   skin/<素材根>-skin/layered/manifest.json
 * 清单里的图片路径相对清单自身，所以子目录里的 `art/x.png` 不用改写。
 *
 * 除了「根布局 / `layered/` 子目录」这两种**素材根级**的位置，`pets[].model` 指的那套皮肤
 * （`<皮肤 id>/manifest.json`，池里就是 `skin/layered/<皮肤 id>/`）永远先试——它才是用户当前选中的那套。
 * 候选顺序只有这一份：渲染器加载与右键「渲染方式」的可用性探测都读它，任一端自己写一套就会
 * 出现「菜单里置灰、其实点得动」或反过来（点下去空画布）。
 * @module dsh-fish-body/src/shared/layered-paths
 */

/** 分层皮肤清单的候选相对路径，按优先级排列。 */
export const LAYERED_MANIFEST_PATHS: readonly string[] = ['manifest.json', 'layered/manifest.json'];

/** 皮肤 id 归一：反斜杠转正斜杠、去掉首尾分隔符（配置里手写的 `feiyu-05/` 与 `feiyu-05` 等价）。 */
function normalizeSkinId(skin?: string | null): string {
  return (skin ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

/** 命中子目录布局时的地址前缀（拼在 `/skin/<素材根>/` 之后）；根布局为空串。 */
export function layeredBaseOf(manifestPath: string): string {
  return manifestPath === LAYERED_MANIFEST_PATHS[0] ? '' : manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1);
}

/**
 * 一套皮肤 id 对应哪份清单（相对素材根）。
 *
 * 根布局的皮肤 id 是空串（清单就在素材根上），`layered/` 子目录布局的 id 是 `layered`。
 *
 * @param skin - 皮肤 id；缺省 / 空串 = 根布局。
 * @returns 相对素材根的清单路径。
 */
export function layeredManifestPathOf(skin?: string | null): string {
  const id = normalizeSkinId(skin);
  return id === '' ? LAYERED_MANIFEST_PATHS[0]! : id + '/manifest.json';
}

/**
 * 加载清单时按什么顺序试。
 *
 * 先当前选中的皮肤，再素材根上的两种布局（根 / `layered/`）——老布局里 `pets[].model`
 * 可能指向别的东西（比如切过 live2d 留下的模型路径），那两步负责兜住。
 *
 * @param skin - `pets[].model` 指的皮肤 id；缺省 / 空串表示根布局。
 * @returns 候选相对路径（已去重、顺序即优先级）。
 */
export function layeredManifestPaths(skin?: string | null): string[] {
  const owned = layeredManifestPathOf(skin);
  return [...new Set([owned, ...LAYERED_MANIFEST_PATHS])];
}

/** 取一份清单的正文；取不到（404 / 网络失败 / 坏 JSON）返回 `undefined`。 */
export type LayeredManifestFetcher = (path: string) => Promise<unknown | undefined>;

/** 一次清单解析的结果。 */
export interface LayeredManifestHit {
  /** 真正命中的相对路径。 */
  readonly path: string;
  /** 清单正文（未解析）。 */
  readonly body: unknown;
  /** `true` = 配置的那套皮肤取不到，改用了清单里的另一套（按顺序第一份能取到的）。 */
  readonly fellBack: boolean;
}

/**
 * 按候选顺序找一份能取到的皮肤清单。
 *
 * 为什么要有回落：`pets[].model` 是**三种渲染方式共用的一个字段**，切渲染方式时不会跟着改写
 * （切到 layered 那一刻它可能还是 live2d 的模型路径）。live2d 那边早就按「配置的不在清单里就用
 * 第一份」处理；layered 不这么做，症状就是「右键里 layered 可用、点下去一片空白」。
 *
 * @param skin - `pets[].model` 指的皮肤 id。
 * @param getJson - 按相对路径取正文；取不到返回 `undefined`（不抛）。
 * @param listSkins - 可选的皮肤清单来源（`/skin/<素材根>/skins`）：当前这套取不到时按它的顺序再试一遍。
 * @returns 命中的路径与正文；一处都取不到时 `null`。
 */
export async function resolveLayeredManifest(
  skin: string | undefined | null,
  getJson: LayeredManifestFetcher,
  listSkins?: () => Promise<readonly string[]>,
): Promise<LayeredManifestHit | null> {
  const tried = new Set<string>();
  for (const path of layeredManifestPaths(skin)) {
    if (tried.has(path)) continue;
    tried.add(path);
    const body = await getJson(path);
    if (body !== undefined) return { path, body, fellBack: false };
  }
  if (listSkins === undefined) return null;
  let ids: readonly string[];
  try {
    ids = await listSkins();
  } catch {
    return null;
  }
  for (const id of ids) {
    const path = layeredManifestPathOf(id);
    if (tried.has(path)) continue;
    tried.add(path);
    const body = await getJson(path);
    if (body !== undefined) return { path, body, fellBack: true };
  }
  return null;
}
