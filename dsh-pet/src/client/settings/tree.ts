/**
 * 目录树的「前缀」计算：把扁平的 `{depth}` 列表变成一行行 `├─ / └─ / │` 文本。
 *
 * 为什么在客户端算：宿主只给结构与顺序（谁在第几层、存不存在），画成树的样式属于展示层；
 * 这样同一个响应也能被别的消费者（脚本、测试）当结构数据用，不必去解析制表符。
 * 纯函数：不读盘、不依赖 react，便于单测把「最后一个子项」「祖先还有兄弟」这些边角钉住。
 *
 * 根行（`depth === 0`）**不画枝干**：它占满整行宽度、右边就是一句说明，前面再顶一个 `└─ `
 * 只会让整棵树整体右移、和卡片左边缘对不齐。所以第一层子项直接落在第 0 列。
 * 由此推出一个前提：一次渲染里只有一个根（`layoutNodes()` 就是唯一根），多根会把两棵树的枝干并排画在一起。
 * @module dsh-fish-body/src/client/settings/tree
 */

/** 只依赖层级的最小输入：宿主返回的节点比它多，多的字段这里不关心。 */
export interface TreeRow {
  readonly depth: number;
}

/**
 * 这一行之后，同层还有兄弟吗。
 *
 * @param rows - 全部行。
 * @param index - 当前行下标。
 * @returns 后面还有同层（depth 相同）的行时为 true。
 */
function hasNextSibling(rows: readonly TreeRow[], index: number): boolean {
  const depth = rows[index]?.depth ?? 0;
  for (let i = index + 1; i < rows.length; i += 1) {
    const next = rows[i]?.depth ?? 0;
    if (next === depth) return true;
    // 更浅 = 已经回到父层，本层不会再有兄弟；更深 = 子项，继续看。
    if (next < depth) return false;
  }
  return false;
}

/**
 * 第 `level` 层的祖先在后续行里还有兄弟吗（决定那条竖线要不要一直画下去）。
 *
 * @param rows - 全部行。
 * @param index - 当前行下标。
 * @param level - 祖先层级。
 * @returns 后续行里同一层还有条目时为 true。
 */
function ancestorHasNext(rows: readonly TreeRow[], index: number, level: number): boolean {
  for (let i = index + 1; i < rows.length; i += 1) {
    const next = rows[i]?.depth ?? 0;
    if (next === level) return true;
    if (next < level) return false;
  }
  return false;
}

/**
 * 每一行的前缀字符串（等宽字体下呈树形）。
 *
 * 缩进用「两个空格 + 竖线/空白」：目录名本身长度不一，固定宽度前缀才不会让层级看起来在漂。
 * 根行没有前缀，所以祖先列从第 1 层算起——第 0 列留给第一层子项的 `├─ / └─`。
 *
 * @param rows - 扁平行列表（顺序即展示顺序）。
 * @returns 与 `rows` 等长的前缀数组；深度 0 的行拿到空串，深度 1 的行拿到 `'└─ '` 或 `'├─ '` 之一。
 */
export function treePrefixes(rows: readonly TreeRow[]): string[] {
  return rows.map((row, index) => {
    if (row.depth <= 0) return '';
    let out = '';
    for (let level = 1; level < row.depth; level += 1) {
      out += ancestorHasNext(rows, index, level) ? '│  ' : '   ';
    }
    out += hasNextSibling(rows, index) ? '├─ ' : '└─ ';
    return out;
  });
}
