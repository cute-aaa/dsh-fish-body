/**
 * 树行的绘制：前缀 + 名字 + 说明 + 徽标 / 「打开」按钮。
 *
 * 从 `fs-card.ts` 抽出来是因为「皮肤目录三行」要用同一套外观（`.dsh-pet-cfg__treeRow` 与
 * `.is-missing` 的样式只在 CSS 里有一份）。这里只管画，描述文案与按钮节点由调用方给——
 * `fs-card` 的说明来自 `tree-notes`（按 `/config/meta` 节点 key 索引），三行来自自己的 `renderDir.*`。
 * @module dsh-fish-body/src/client/settings/tree-row
 */
import type { jsx } from 'react/jsx-runtime';
import type { SettingsRuntime } from './runtime.ts';

/** 一行树的全部输入（都已翻译、已绑定回调）。 */
export interface TreeRowView {
  /** 稳定 key（列表用）。 */
  readonly key: string;
  /** 前缀（`├─ ` / `└─ ` / 更深层的竖线）；根行传空串。 */
  readonly prefix: string;
  /** 显示名（目录已自带尾 `/`）。 */
  readonly name: string;
  /** 全路径（`title` 悬浮提示用）。 */
  readonly path: string;
  /** 一句说明；undefined 不渲染。 */
  readonly desc?: string;
  /** 右侧徽标（只读参考组用）；给了它就不再渲染「打开」。 */
  readonly badgeText?: string;
  /** 该行在磁盘上是否存在：false 时整行加 `is-missing`。 */
  readonly exists: boolean;
  /** 根行：不画前缀、网格少一列。 */
  readonly isRoot?: boolean;
  /** 「打开」按钮节点（调用方给，因为它要发请求）。 */
  readonly open?: ReturnType<typeof jsx> | null;
  /** 徽标与「打开」并存（皮肤三行要「缺失」徽标 + 打开目录；只读参考组仍二选一）。 */
  readonly keepOpenWithBadge?: boolean;
}

/**
 * 造树行渲染函数。
 *
 * @param rt - 只用到节点工厂 `h`。
 * @returns 接收一行输入、返回节点的函数。
 */
export function makeTreeRow(rt: Pick<SettingsRuntime, 'h'>): (view: TreeRowView) => ReturnType<typeof jsx> {
  const { h } = rt;
  return (view) => {
    const isRoot = view.isRoot === true;
    return h('div', {
      key: view.key,
      className: 'dsh-pet-cfg__treeRow' + (isRoot ? ' is-root' : '') + (view.exists ? '' : ' is-missing'),
      children: [
        isRoot ? null : h('span', { key: 'p', className: 'dsh-pet-cfg__treePrefix', children: view.prefix }),
        h('span', {
          key: 'n',
          className: 'dsh-pet-cfg__treeName',
          children: view.name,
          title: view.path,
        }),
        view.desc === undefined
          ? null
          : h('span', { key: 'd', className: 'dsh-pet-cfg__treeDesc', children: view.desc }),
        view.badgeText === undefined
          ? null
          : h('span', { key: 'b', className: 'dsh-pet-cfg__treeBadge', children: view.badgeText }),
        view.open === undefined ||
        view.open === null ||
        (view.badgeText !== undefined && view.keepOpenWithBadge !== true)
          ? null
          : view.open,
      ],
    });
  };
}
