/**
 * 右键「动作」树按渲染方式差异化：webm 走动画池，layered 走皮肤清单的 interaction.menu，
 * live2d 走 model3.json 的 FileReferences.Motions / Expressions。
 *
 * 只产出菜单数据与判据，不碰 DOM、不读配置：皮肤清单与模型声明本身由两端的渲染器解析后传入，
 * 本模块只认「组 → 条目」这一层中性结构，浏览器（card/entry）与桌面（sprite/menu）共用同一份。
 * 必须始终成立：同一份输入必得同一棵树；空组被丢弃，没有可点条目时不产出空的「动作」。
 * @module dsh-fish-body/src/shared/menu/renderer-actions
 */
import { type Animations, type RendererKind } from '../types.ts';
import { buildMenuTree, MOTION_RESET } from './tree.ts';
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

/** 待机组名：待机是常驻循环，不是可点动作，菜单与叠加层都不该把它当动作列出来。 */
export const IDLE_MOTION_GROUP = 'Idle';

/** 一条 live2d 动作的落盘信息（菜单文案与「播哪份文件」都在这里对齐）。 */
export interface Model3Motion {
  /** 交给 `Renderer.playAction` 的动作名：`motion:<组>:<序号>`。 */
  readonly action: string;
  /** motion 组名（菜单分组用）。 */
  readonly group: string;
  /** 组内序号。 */
  readonly index: number;
  /** 菜单文案：清单里的 `Name`（宿主补全的热键名/文件名），缺失时用「组名 序号」。 */
  readonly label: string;
  /** 相对模型清单的动作文件（`Animation/x.motion3.json`）。 */
  readonly file: string;
  /** 播完停在末帧（VTube 热键的 `StopsOnLastFrame`）。 */
  readonly hold: boolean;
  /** 淡入秒数（VTube 的 `FadeSecondsAmount`）；清单没写为 undefined。 */
  readonly fadeSeconds: number | undefined;
}

/** 读一个可选的数字字段。 */
function optionalNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * model3.json → 可点播的动作清单（跳过待机组）。
 *
 * 两端都读这一份：菜单按 `group` 分组、渲染器按 `file` 取文件、叠加层按 `hold`/`fadeSeconds`
 * 决定定格与淡入。分成两套遍历必然漂移（序号对不上就会点 A 播 B）。
 *
 * @param raw - 模型清单原始值。
 * @returns 声明顺序的动作清单；没有 `Motions` 时为空数组。
 */
export function model3Motions(raw: unknown): Model3Motion[] {
  const motions = obj(obj(obj(raw)?.FileReferences)?.Motions);
  if (motions === undefined) return [];
  const out: Model3Motion[] = [];
  for (const [group, list] of Object.entries(motions)) {
    if (!Array.isArray(list) || group === IDLE_MOTION_GROUP) continue;
    list.forEach((item, index) => {
      const entry = obj(item);
      if (entry === undefined) return;
      const file = typeof entry.File === 'string' ? entry.File : '';
      if (file === '') return;
      const declared = entry.Name;
      // 单条目组不必带序号（「TapBody」比「TapBody 1」好读）；多条目才靠序号区分。
      const fallback = list.length === 1 ? group : `${group} ${String(index + 1)}`;
      out.push({
        action: `motion:${group}:${index}`,
        group,
        index,
        label: typeof declared === 'string' && declared !== '' ? declared : fallback,
        file,
        hold: entry.StopsOnLastFrame === true,
        fadeSeconds: optionalNumber(entry.FadeInTime),
      });
    });
  }
  return out;
}

/** 一条 live2d 外观（exp3）的落盘信息：菜单文案与文件地址。 */
export interface Model3Expression {
  /** 菜单文案与 `expression:<名>` 里的名字。 */
  readonly name: string;
  /** 相对模型清单的 exp3 文件。 */
  readonly file: string;
}

/**
 * model3.json → 外观清单（`Expressions[]`）。
 *
 * @param raw - 模型清单原始值。
 * @returns 声明顺序的外观项；没有 `Expressions` 时为空数组。
 */
export function model3ExpressionRefs(raw: unknown): Model3Expression[] {
  const expressions = obj(obj(raw)?.FileReferences)?.Expressions;
  if (!Array.isArray(expressions)) return [];
  const out: Model3Expression[] = [];
  for (const item of expressions) {
    const entry = obj(item);
    const name = entry?.Name;
    const file = entry?.File;
    if (typeof name !== 'string' || name === '' || typeof file !== 'string' || file === '') continue;
    out.push({ name, file });
  }
  return out;
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

/**
 * model3.json → 动作组（Motions 每组一组，待机组不出现）。
 *
 * **不包含 Expressions**：外观是「挂在身上的状态」而不是一次性动作，归「外观」子菜单
 * （见 shared/menu/tree 的 `accessoryMenuBranch`），否则切换状态会被当成播一次。
 * 动作条目本身由 {@link model3Motions} 给出——菜单只负责分组，不另做一次遍历。
 *
 * @param raw - `Live2DModel.from` 用的模型清单原始值（unknown）。
 * @returns 按声明顺序排列的动作组；没有 Motions 时返回空数组。
 */
export function model3ActionGroups(raw: unknown): RendererActionGroup[] {
  const order: string[] = [];
  const byGroup = new Map<string, RendererAction[]>();
  for (const motion of model3Motions(raw)) {
    const action: RendererAction = { label: motion.label, name: motion.action };
    const list = byGroup.get(motion.group);
    if (list === undefined) {
      order.push(motion.group);
      byGroup.set(motion.group, [action]);
      continue;
    }
    list.push(action);
  }
  return order.map((group) => ({ label: group, actions: byGroup.get(group) ?? [] }));
}

/**
 * model3.json → 表情名清单（供「外观」子菜单）。
 *
 * @param raw - 模型清单原始值。
 * @returns 声明顺序的表情名；没有 `Expressions` 时返回空数组。
 */
export function model3Expressions(raw: unknown): string[] {
  return model3ExpressionRefs(raw).map((expression) => expression.name);
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
 * 多组时每组一个子菜单（live2d 的 motion 组）。给 `resetAction` 时末尾补一条复位项——
 * 叠加上去的动作与定格姿态得有个一键回待机的出口。
 *
 * @param groups - 渲染器给出的动作组。
 * @param resetAction - 复位动作名（见 shared/menu/tree 的 `MOTION_RESET`）；缺省不出现复位项。
 * @returns `[{ label: '动作', … }]`；没有可点条目时返回空数组（菜单里不出现空的「动作」）。
 */
export function rendererActionTree(groups: readonly RendererActionGroup[], resetAction?: string): MenuNode[] {
  const filled = groups
    .map((group) => ({
      label: group.label,
      leaves: group.actions.map(leafOf).filter((leaf): leaf is MenuLeaf => leaf !== null),
    }))
    .filter((group) => group.leaves.length > 0);
  if (filled.length === 0) return [];
  const children: MenuNode[] =
    filled.length === 1 ? filled[0].leaves : filled.map((group) => ({ label: group.label, children: group.leaves }));
  if (resetAction !== undefined) {
    children.push({ label: '恢复默认动作', action: 'renderer-action', rendererAction: resetAction });
  }
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
  if (renderer === 'live2d') return rendererActionTree(groups, MOTION_RESET);
  return renderer === 'layered' ? rendererActionTree(groups) : buildMenuTree(animations);
}
