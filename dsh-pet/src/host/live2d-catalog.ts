/**
 * 当前宠物的 live2d 表演清单：把「AI 能说什么」与「模型里真有什么」接上。
 *
 * 为什么要在 host 侧算：对话提示词由 host 拼（`./chat`），而动作/外观名只存在于模型清单里
 * （池根下的 `.model3.json`，经 `./model-extras` 按 VTS 热键补全）。客户端虽然手里也有这份表，
 * 但提示词在生成前就要用，round-trip 一次没有必要。
 *
 * 只读盘、不写、不建状态；读不到（模型没选、目录没了、JSON 坏了）一律返回空清单——
 * 空清单等于「这条链路关闭」，调用方不必分支。
 * @module dsh-fish-body/src/host/live2d-catalog
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POOL_LAYER_DIR } from '../shared/pool.ts';
import { model3ExpressionRefs, model3Motions } from '../shared/menu/renderer-actions.ts';
import { mergeModelExtras } from './model-extras.ts';

/** 一份可表演清单：动作取菜单文案（label），外观取名字。 */
export interface Live2dCatalog {
  /** 动作 label（与右键「动作」菜单同源，AI 只认这个）。 */
  readonly actions: readonly string[];
  /** 外观名（与右键「外观」菜单同源）。 */
  readonly expressions: readonly string[];
}

/** 空清单（渲染方式不是 live2d、模型没选或读不出来）。 */
const EMPTY: Live2dCatalog = { actions: [], expressions: [] };

/** 取对象（非数组）。 */
function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * 在池根里找模型清单文件。
 *
 * 模型路径（`pets[].model`）相对**渲染方式目录**（`<根>/live2d/`），历史版本也有直接放在根下的
 * 裸布局；两种都试，先命中先用（与 `/skin` 路由的候选顺序一致）。
 *
 * @param roots - 池根序（主根在前）。
 * @param model - `pets[].model` 原值（相对路径）。
 * @returns 绝对路径；都不存在时返回 undefined。
 */
function findModelFile(roots: readonly string[], model: string): string | undefined {
  const rel = model.trim().replace(/\\/g, '/');
  if (rel === '') return undefined;
  for (const root of roots) {
    if (root === '') continue;
    for (const candidate of [join(root, POOL_LAYER_DIR.live2d, ...rel.split('/')), join(root, ...rel.split('/'))]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * 算当前宠物的可表演清单。
 *
 * @param roots - 素材根的有序表（**与池路由同一条根序**：用户 `skin/` 在前、内置池在后）。
 *   传错根序的后果是「模型在用户皮肤目录里、这里却只找内置池」→ 空清单 → AI 永远不表演。
 * @param conf - 该宠物的成品配置（读 `renderer` / `model`）。
 * @returns 动作与外观名；不是 live2d、没选模型或读不出来时为空清单。
 */
export function live2dCatalogOf(roots: readonly string[], conf: unknown): Live2dCatalog {
  const entry = obj(conf);
  if (entry === undefined || entry.renderer !== 'live2d') return EMPTY;
  const model = typeof entry.model === 'string' ? entry.model : '';
  if (model.trim() === '') return EMPTY;
  const file = findModelFile(roots, model);
  if (file === undefined) return EMPTY;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return EMPTY;
  }
  // 与 `/skin` 路由同一条补全：VTS 热键 → Motions / Expressions。不补全的话
  // 标准 VTS 工程（清单里一条动作都不写）会得到空清单。
  const merged = mergeModelExtras(file, raw);
  const actions: string[] = [];
  for (const motion of model3Motions(merged)) {
    if (motion.label !== '' && !actions.includes(motion.label)) actions.push(motion.label);
  }
  const expressions = model3ExpressionRefs(merged).map((expression) => expression.name);
  return { actions, expressions };
}
