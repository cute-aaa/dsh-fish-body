/**
 * 右键「渲染方式」里哪些后端点得动：一次探测的三份原始结果 → 一份可用清单。
 *
 * 判据的**唯一目的**是「点下去一定画得出东西」，不是「目录里有没有东西」：
 * - `webm` 恒可用：动画池来自配置，缺素材是配置问题而不是后端问题；
 * - `layered`：当前皮肤清单取得到，或者池里至少有一套分层皮肤（挂载时会回落到它，见
 *   `resolveLayeredManifest`）——只看前者会漏掉「配置的 model 是 live2d 路径」这个常见状态；
 * - `live2d`：`/models` 非空（200 + 空数组也算没有）。
 *
 * 两端（浏览器 `card/entry.ts`、桌面 `sprite/init.js`）都从这里出答案：分开写必然漂移，
 * 症状就是一端置灰、另一端能点，或者菜单说能用、点完是空画布。
 * @module dsh-fish-body/src/shared/renderer-availability
 */
import { RENDERERS } from './config.ts';
import type { RendererKind } from './types.ts';

/** 一次素材探测的原始结果。 */
export interface RendererProbe {
  /** 当前 `pets[].model` 的皮肤清单是否取得到（根布局或 `layered/` 子目录布局都算）。 */
  readonly manifestHit: boolean;
  /** `/skin/<素材根>/skins` 给出的可切换皮肤 id（根布局是空串）。 */
  readonly skins: readonly string[];
  /** `/skin/<素材根>/models` 给出的 `.model3.json` 相对路径。 */
  readonly models: readonly string[];
}

/**
 * 算出这只宠物实际可用的后端（顺序与「渲染方式」菜单一致）。
 *
 * @param probe - 三份探测结果；探测失败时调用方给空数组（按「没有」处理）。
 * @returns 可用后端的顺序表；`webm` 永远在第一位。
 */
export function availableRenderers(probe: RendererProbe): RendererKind[] {
  const usable: Readonly<Record<RendererKind, boolean>> = {
    webm: true,
    layered: probe.manifestHit || probe.skins.length > 0,
    live2d: probe.models.length > 0,
  };
  return RENDERERS.filter((renderer) => usable[renderer]);
}
