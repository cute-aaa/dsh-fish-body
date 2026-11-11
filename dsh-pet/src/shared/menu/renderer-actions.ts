/**
 * 右键「动作」树按渲染方式差异化：webm 走动画池，layered 走皮肤清单的 interaction.menu，
 * live2d 走 model3.json 的 FileReferences.Motions / Expressions。
 *
 * 只产出菜单数据与判据，不碰 DOM、不读配置：皮肤清单与模型声明本身由两端的渲染器解析后传入，
 * 本模块只认「组 → 条目」这一层中性结构，浏览器（card/entry）与桌面（sprite/menu）共用同一份。
 * 必须始终成立：同一份输入必得同一棵树；空组被丢弃，没有可点条目时不产出空的「动作」。
 * @module dsh-pet/src/shared/menu/renderer-actions
 */
import { type Animations, type RendererKind } from '../types.ts';
import { buildMenuTree } from './tree.ts';
import type { MenuLeaf, MenuNode } from './types.ts';

/** 一条可点播的渲染器动作。 */
export interface RendererAction {
  /** 菜单文案（皮肤手势的中文名 / motion 组名 / 表情名）。 */
  readonly label: string;
  /** 交给 `Renderer.playAction` 的动作名，渲染器自己解析。 */
  readonly name: string;
}

/** 一组渲染器动作（live2d 的 motion 组与表情各成一组；layered 只有一组）。 */
export interface RendererActionGroup {
  readonly label: string;
  readonly actions: readonly RendererAction[];
}

/** 皮肤清单手势 id → 菜单文案；未列出的（separator / resize / recenter / hide / quit）不是动作，跳过。 */
const SKIN_GESTURE_LABELS: Readonly<Record<string, string>> = {
  blink: '眨个眼',
  hop: '跳一下',
  jelly: 'Q 弹一下',
  jump: '跳一下',
  mouth: '张个嘴',
  pat: '摸摸头',
  poke: '戳一下',
  speak: '说句话',
  tail: '摇尾巴',
  tailpet: '摸摸尾巴',
  talk: '说句话',
  wag: '摇尾巴',
};

/** 容错取对象。 */
function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * 皮肤清单 `interaction.menu` → 动作组。
 *
 * 只保留 rig 能做的装配手势（词表见 `render/layered/gestures.ts`），其余条目是宿主应用自己的
 * 命令（resize / recenter / hide / quit），fish-body 已有等价菜单项，重复列出只会让人困惑。
 *
 * @param menu - 清单里的 `interaction.menu` 数组（可能为空或含坏值）。
 * @returns 一个「皮肤手势」组；没有可播条目时返回空数组。
 */
export function skinMenuGroups(menu: readonly string[]): RendererActionGroup[] {
  const actions: RendererAction[] = [];
  const seen = new Set<string>();
  for (const raw of menu) {
    if (typeof raw !== 'string') continue;
    const key = raw.trim().toLowerCase();
    const label = SKIN_GESTURE_LABELS[key];
    if (label === undefined || seen.has(key)) continue;
    seen.add(key);
    // name 用清单里的手势 id：rig 的 assemblyActionOf 直接认它，不必再翻译一次。
    actions.push({ label, name: key });
  }
  return actions.length === 0 ? [] : [{ label: '皮肤手势', actions }];
}

/** model3 的一个 motion 组 → 动作组；有 `Name`（宿主补全的目录动作）就用它，否则「组名 序号」区分。 */
function motionGroupOf(group: string, list: readonly unknown[]): RendererActionGroup | null {
  const actions: RendererAction[] = [];
  list.forEach((item, index) => {
    // 声明项必须是对象（File 可能缺省，但条目本身要在）；不是对象的按坏数据跳过。
    const entry = obj(item);
    if (entry === undefined) return;
    const declared = entry.Name;
    const fallback = list.length === 1 ? group : group + ' ' + String(index + 1);
    const label = typeof declared === 'string' && declared !== '' ? declared : fallback;
    actions.push({ label, name: `motion:${group}:${index}` });
  });
  return actions.length === 0 ? null : { label: group, actions };
}

/**
 * model3.json → 动作组（Motions 每组一组）。
 *
 * **不包含 Expressions**：表情是「挂在身上的状态」而不是一次性动作，归「外观」子菜单
 * （见 shared/menu/tree 的 `accessoryMenuBranch`），否则切换状态会被当成播一次。
 *
 * @param raw - `Live2DModel.from` 用的模型清单原始值（unknown）。
 * @returns 按声明顺序排列的动作组；没有 Motions 时返回空数组。
 */
export function model3ActionGroups(raw: unknown): RendererActionGroup[] {
  const refs = obj(obj(raw)?.FileReferences);
  if (refs === undefined) return [];
  const groups: RendererActionGroup[] = [];
  const motions = obj(refs.Motions);
  if (motions !== undefined) {
    for (const [group, list] of Object.entries(motions)) {
      if (!Array.isArray(list)) continue;
      const parsed = motionGroupOf(group, list);
      if (parsed !== null) groups.push(parsed);
    }
  }
  return groups;
}

/**
 * model3.json → 表情名清单（供「外观」子菜单）。
 *
 * @param raw - 模型清单原始值。
 * @returns 声明顺序的表情名；没有 `Expressions` 时返回空数组。
 */
export function model3Expressions(raw: unknown): string[] {
  const refs = obj(obj(raw)?.FileReferences);
  const expressions = refs?.Expressions;
  if (!Array.isArray(expressions)) return [];
  const out: string[] = [];
  for (const item of expressions) {
    const name = obj(item)?.Name;
    if (typeof name === 'string' && name !== '') out.push(name);
  }
  return out;
}

/** 动作组 → 一层叶子；空白标签与空组在这里统一剔掉。 */
function leafOf(action: RendererAction): MenuLeaf | null {
  if (action.label.trim() === '' || action.name.trim() === '') return null;
  return { label: action.label, action: 'renderer-action', rendererAction: action.name };
}

/**
 * 动作组 → 「动作」菜单树。
 *
 * 只有一组时把条目直接摊在「动作」下（layered 的皮肤手势就一组，多套一层没有信息量）；
 * 多组时每组一个子菜单（live2d 的 motion 组与「表情」）。
 *
 * @param groups - 渲染器给出的动作组。
 * @returns `[{ label: '动作', … }]`；没有可点条目时返回空数组（菜单里不出现空的「动作」）。
 */
export function rendererActionTree(groups: readonly RendererActionGroup[]): MenuNode[] {
  const filled = groups
    .map((group) => ({
      label: group.label,
      leaves: group.actions.map(leafOf).filter((leaf): leaf is MenuLeaf => leaf !== null),
    }))
    .filter((group) => group.leaves.length > 0);
  if (filled.length === 0) return [];
  const children: MenuNode[] =
    filled.length === 1 ? filled[0].leaves : filled.map((group) => ({ label: group.label, children: group.leaves }));
  return [{ label: '动作', children }];
}

/**
 * 按渲染方式选「动作」树：webm 用动画池，layered / live2d 用渲染器声明的动作组。
 *
 * @param renderer - 当前渲染方式（缺省 webm）。
 * @param animations - 该宠物的动画池（只有 webm 分支读它）。
 * @param groups - 渲染器声明的动作组（只有 layered / live2d 分支读它）。
 * @returns 菜单节点数组，可直接拼进右键树。
 */
export function actionMenuTree(
  renderer: RendererKind | undefined,
  animations: Animations,
  groups: readonly RendererActionGroup[],
): MenuNode[] {
  return renderer === 'layered' || renderer === 'live2d' ? rendererActionTree(groups) : buildMenuTree(animations);
}
