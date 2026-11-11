/**
 * 菜单树构建：从动画清单与第三方注册项拼出层级，并做镜像动画过滤。
 *
 * 不碰 DOM；输入是配置与注册数据，输出是纯对象树。
 * 必须始终成立：同一份输入必得同一棵树，层级顺序稳定。
 * @module dsh-pet/src/shared/menu/tree
 */
import { DISPLAY_HOTKEY_HINTS, DISPLAY_ORDER } from '../display-hotkey.ts';
import { RENDERERS } from '../config.ts';
import { type Animations, type Category, type PetDisplay, type RendererKind } from '../types.ts';
import type { MenuBranch, MenuLeaf, MenuMoreItem, MenuNode } from './types.ts';

/** 睡着时仍然放行的菜单动作：维护类、「叫醒它」本身，以及第三方菜单项。
 *  第三方要做什么由它自己决定——真去驱动宠物时会带占用锁调接口，宿主闸门在那一层再判
 *  （锁优先）。在渲染端先拦掉，等于让「更多」里的第三方入口在睡觉时整体失效。 */
const SLEEP_ALLOWED_ACTIONS: readonly string[] = [
  'sleep',
  'wake',
  'home',
  'set-display',
  'set-renderer',
  'set-model',
  'set-size',
  'reload',
  'reload-plugin',
  'third-party',
];

/** 该菜单动作在睡着时是否放行（两端共用：对话弹窗、待办面板、动作点播都是渲染端行为，宿主闸门拦不到）。 */
export const isSleepAllowedAction = (action: string | undefined): boolean =>
  action !== undefined && SLEEP_ALLOWED_ACTIONS.includes(action);

/** 四个显示位置的菜单文案；键是 {@link DISPLAY_ORDER} 的元素，顺序以那边为准。 */
const DISPLAY_LABELS: Readonly<Record<PetDisplay, string>> = {
  web: '仅网页',
  desktop: '仅桌面',
  both: '两者',
  none: '都不',
};

/** 「显示位置」子菜单：两端注入同一份，文案与设置页的显示位置下拉框一致。
 *  两端各写一份必然漂移，而这一项语义对称：桌面端用它把宠物送走，浏览器端用它送到桌面。
 *  「都不」是单向门（恢复入口是设置页），其余三个值都能从某一端改回来。
 *  右侧键帽由 `1`-`4` 数字键的同一份顺序派生，改顺序只改 {@link DISPLAY_ORDER}。 */
export const displayMenuBranch = (): MenuBranch => ({
  label: '显示位置',
  children: DISPLAY_ORDER.map((display, index): MenuLeaf => ({
    label: DISPLAY_LABELS[display],
    action: 'set-display',
    display,
    hint: DISPLAY_HOTKEY_HINTS[index],
  })),
});

/** 三种渲染方式的菜单文案。 */
const RENDERER_LABELS: Readonly<Record<RendererKind, string>> = {
  webm: 'webm（视频）',
  layered: 'layered（分层 PNG）',
  live2d: 'live2d（Cubism）',
};

/** 「渲染方式」子菜单：三种互斥后端，点击即切换（与 pets[].renderer 同一套取值）。
 *
 *  `current` 给了就在对应项上打勾；`available` 给了就把缺素材的后端置灰——两端都从这里出菜单，
 *  选中态与可用态只写一处。`available` 缺省（探测还没回来）时按「都可用」渲染，不挡住切换。
 *  当前值即使不在 `available` 里也不置灰：那是「配置说它在用」，以配置为准。
 */
export const rendererMenuBranch = (current?: RendererKind, available?: readonly RendererKind[]): MenuBranch => ({
  label: '渲染方式',
  children: RENDERERS.map((renderer): MenuLeaf => {
    const usable = available === undefined || available.includes(renderer) || renderer === current;
    const label = current === renderer ? `${RENDERER_LABELS[renderer]} ✓` : RENDERER_LABELS[renderer];
    return { label, action: 'set-renderer', renderer, ...(usable ? {} : { disabled: true }) };
  }),
});

/** 单选子菜单：给一组取值与当前值，当前那项打勾。`items` 是取值本身（菜单文案与取值同形）。 */
const choiceMenuBranch = (label: string, items: readonly string[], current?: string): MenuBranch | null => {
  if (items.length === 0) return null;
  return {
    label,
    children: items.map((item): MenuLeaf => ({
      label: current === item ? `${item} ✓` : item,
      action: 'set-model',
      model: item,
    })),
  };
};

/** 「模型」子菜单：layered 皮肤 / live2d 模型的列表（相对皮肤目录路径）；空列表返回 null。 */
export const modelMenuBranch = (models: readonly string[], current?: string): MenuBranch | null =>
  choiceMenuBranch('模型', models, current);

/** 「皮肤」子菜单：layered 的皮肤 id（根布局记为空串 → 文案写「默认」）；空列表返回 null。 */
export const skinMenuBranch = (skins: readonly string[], current?: string): MenuBranch | null => {
  if (skins.length === 0) return null;
  return {
    label: '皮肤',
    children: skins.map((skin): MenuLeaf => {
      const shown = skin === '' ? '默认皮肤' : skin;
      return { label: current === skin ? `${shown} ✓` : shown, action: 'set-model', model: skin };
    }),
  };
};

/** 取消「当前表情/配件」的动作名：渲染器把表情清回模型默认外观。 */
export const EXPRESSION_RESET = 'expression-reset';

/** 取消「叠加中的动作/定格姿态」的动作名：渲染器把动作层全部摘掉，回到纯待机。 */
export const MOTION_RESET = 'motion-reset';

/**
 * 「大小」子菜单的档位：相对 `pets[].size` 的倍率。
 *
 * 三档 + 一个特大就够日常用；精确到像素走设置页的输入框。写回的是**当前渲染方式**的
 * `pets[].sizes[renderer]`，所以同一只宠物切到另一种素材可以各用一套大小。
 */
export const SIZE_PRESETS: readonly { readonly label: string; readonly scale: number }[] = [
  { label: '小', scale: 0.7 },
  { label: '中', scale: 1 },
  { label: '大', scale: 1.35 },
  { label: '特大', scale: 1.8 },
];

/**
 * 「大小」子菜单：按当前渲染方式调画框宽度。
 *
 * @param current - 当前渲染方式生效的宽度（px），用来打勾。
 * @param base - `pets[].size`（档位倍率的基准）。
 * @returns 子菜单；末尾一条「恢复默认」= 删掉覆盖。
 */
export const sizeMenuBranch = (current: number, base: number): MenuBranch => {
  const children: MenuLeaf[] = SIZE_PRESETS.map(({ label, scale }) => {
    // 「中」就是基准值本身；其余档取整到 10px——档位是给人看的，462×0.7=323.4 这种小数没有意义。
    const size = scale === 1 ? base : Math.round((base * scale) / 10) * 10;
    const shown = current === size ? `${label}（${size}px）✓` : `${label}（${size}px）`;
    return { label: shown, action: 'set-size', size };
  });
  children.push({ label: '恢复默认大小', action: 'set-size' });
  return { label: '大小', children };
};

/**
 * 「外观」子菜单：live2d 的 Expressions（单片眼镜、兔牙、尾巴开关…）。
 *
 * 与「动作」分开：动作是往身上叠一段 motion，外观是**挂着的状态**（眼镜 + 脸红 + 兔牙可以同时开），
 * 所以这里打勾表示「当前挂着它」，且**可同时勾多个**；末尾一条「恢复默认外观」把状态全清。
 * 叠挂是自己实现的（渲染端每条外观一对独立参数层），不依赖 Cubism 的 expressionManager 单槽。
 *
 * @param names - 外观名（模型清单的 `Expressions[].Name`）。
 * @param active - 当前挂着的外观名；空数组表示一个都没挂。
 * @returns 子菜单；没有外观时返回 null（菜单里不出现空的外观）。
 */
export const accessoryMenuBranch = (names: readonly string[], active?: readonly string[]): MenuBranch | null => {
  if (names.length === 0) return null;
  const on = new Set(active ?? []);
  const children: MenuLeaf[] = names.map((name) => ({
    label: on.has(name) ? `${name} ✓` : name,
    action: 'renderer-action',
    rendererAction: 'expression:' + name,
  }));
  children.push({ label: '恢复默认外观', action: 'renderer-action', rendererAction: EXPRESSION_RESET });
  return { label: '外观', children };
};

/** 第三方菜单项统一收在这个一级菜单下（宿主自己的菜单项不进这里）。 */
export const MORE_MENU_LABEL = '更多';

/** 从 /state 的 sections.menu.data 里读出本端要显示的第三方菜单项。
 *  target 等于本端身份或 both 才收；target 缺失或不认识时按 both 处理——老宿主没有这个字段，
 *  宁可在两端都显示，也不要让一个正在用的第三方菜单凭空消失。
 *  快照来自网络，字段一律按「可能不存在」处理：坏条目静默丢弃，不能让一条数据搞崩菜单。 */
export function readMenuItems(data: unknown, surface: 'web' | 'desktop'): MenuMoreItem[] {
  if (!data || typeof data !== 'object') return [];
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: MenuMoreItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    // 端过滤：只认三个字面量，其余（缺失 / 写坏）一律当 both
    const rawTarget = rec.target;
    const target = rawTarget === 'web' || rawTarget === 'desktop' || rawTarget === 'both' ? rawTarget : 'both';
    if (target !== 'both' && target !== surface) continue;
    const owner = rec.owner;
    const label = rec.label;
    if (typeof owner === 'string' && owner !== '' && typeof label === 'string' && label !== '') {
      out.push({ owner, label });
    }
  }
  return out;
}

/** 「更多」：第三方菜单项的固定容器；没有第三方项时返回 null，菜单里不出现空的「更多」。
 *
 *  层级只按 label 是否重名决定：label 在全部第三方项里唯一 → 直接平铺（`更多 / 弹弓`）；
 *  label 重名 → 每个 owner 各占一个子菜单（`更多 / owner / label`），靠它区分同名项。
 *  重名只可能跨 owner（同一 owner 内 label 按 Map 去重，见 host/menu 的注册表），子项仍是原
 *  label——点击上报的 (owner, label) 与平铺时完全一致，两端点击处理不用分叉。 */
export function buildMoreBranch(items: readonly MenuMoreItem[]): MenuBranch | null {
  const labelCount = new Map<string, number>();
  for (const item of items) labelCount.set(item.label, (labelCount.get(item.label) ?? 0) + 1);
  const children: MenuNode[] = [];
  // owner → 该 owner 的重名子菜单；第一次遇到它的重名项时按当时顺序插进 children（保持注册顺序）
  const branches = new Map<string, MenuBranch>();
  for (const item of items) {
    if ((labelCount.get(item.label) ?? 0) === 1) {
      children.push({ label: item.label, action: 'third-party', owner: item.owner });
      continue;
    }
    let branch = branches.get(item.owner);
    if (branch === undefined) {
      branch = { label: item.owner, children: [] };
      branches.set(item.owner, branch);
      children.push(branch);
    }
    branch.children.push({ label: item.label, action: 'third-party', owner: item.owner });
  }
  return children.length > 0 ? { label: MORE_MENU_LABEL, children } : null;
}

/** 事件名 → 分类标签（无映射时用事件名本身）。 */
const EVENT_LABELS: Record<string, string> = {
  balance: '余额档位',
  whisper: '碎碎念',
  workStatus: '工作状态',
};

/** 把动画名包成叶子。 */
export const leaf = (anim: string): MenuLeaf => ({ label: anim, anim });

/** 由成品 animations 配置推导菜单树：一级「动作」→ 二级分类 → 三级动画名；空池与空分类自动省略。 */
export function buildMenuTree(animations: Animations): MenuNode[] {
  const groups: MenuNode[] = [];
  const pools: Array<[string, string[]]> = [
    ['待机', animations.idle],
    ['转向', animations.turn],
    ['拖拽', animations.drag],
    ['点击回应', animations.clicks],
    ['移动', animations.moves.actions.map((m) => m.name)],
  ];
  for (const [label, pool] of pools) {
    if (pool.length) groups.push({ label, children: pool.map(leaf) });
  }
  // 随机动作分类：noMirror 分类照样可点播，播放端朝右时强制朝左（见 isNoMirrorAnimation）
  const cats = (animations.categories ?? []).filter((c) => c.actions.length > 0);
  for (const c of cats) {
    groups.push({ label: c.id, children: c.actions.map(leaf) });
  }
  // 事件动画：每个事件一个分类，不来自随机链；数组槽位展平为逐个叶子，候选都可点播预览。
  const events = animations.events ?? {};
  for (const key of Object.keys(events)) {
    const pool = events[key] ?? [];
    const names: string[] = [];
    for (const slot of pool) {
      if (typeof slot === 'string') names.push(slot);
      else names.push(...slot);
    }
    if (names.length) groups.push({ label: EVENT_LABELS[key] ?? key, children: names.map(leaf) });
  }
  if (!groups.length) return [];
  return [{ label: '动作', children: groups }];
}

/** 该动画是否属于 noMirror 分类（文字类）：朝右镜像时点播前强制朝左，避免文字镜像。 */
export function isNoMirrorAnimation(categories: Category[], anim: string): boolean {
  return (categories ?? []).some((c) => c.noMirror === true && c.actions.includes(anim));
}
