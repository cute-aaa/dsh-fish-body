/**
 * 分层皮肤的清单位置：一个素材根里可以同时放分层皮肤与 live2d 模型。
 *
 * `manifest.json` 在根上是老布局（`pet/<素材根>-skin/manifest.json`）；
 * 新布局把它收进子目录，好让同一个素材根既装 `.model3.json` 又装分层美术：
 *   pet/<素材根>-skin/live2d/<模型>.model3.json
 *   pet/<素材根>-skin/layered/manifest.json
 * 清单里的图片路径相对清单自身，所以子目录里的 `art/x.png` 不用改写。
 * 两端（浏览器 / 桌面 Helper）按同一顺序探测：先根后子目录。
 * @module dsh-pet/src/shared/layered-paths
 */

/** 分层皮肤清单的候选相对路径，按优先级排列。 */
export const LAYERED_MANIFEST_PATHS: readonly string[] = ['manifest.json', 'layered/manifest.json'];

/** 命中子目录布局时的地址前缀（拼在 `/skin/<素材根>/` 之后）；根布局为空串。 */
export function layeredBaseOf(manifestPath: string): string {
  return manifestPath === LAYERED_MANIFEST_PATHS[0] ? '' : manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1);
}
