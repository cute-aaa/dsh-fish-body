/**
 * 目录树前缀（src/client/settings/tree.ts）的契约测试。
 *
 * 树形是画出来的，所以「谁是最后一个」「祖先的竖线要不要继续」必须钉死：
 * 这两件事错一次，整棵树的层级读起来就全是错的。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { treePrefixes } from './tree.ts';

/** 项目简写：`[depth, 名字]`。 */
type Item = readonly [number, string];

const prefixesOf = (items: readonly Item[]): string[] => treePrefixes(items.map(([depth]) => ({ depth })));

describe('treePrefixes —— 树形前缀', () => {
  test('只有一个根：给末位连接符', () => {
    assert.deepEqual(prefixesOf([[0, 'root']]), ['└─ ']);
  });

  test('同层的兄弟：前几个 ├─，最后一个 └─', () => {
    assert.deepEqual(
      prefixesOf([
        [0, 'a'],
        [0, 'b'],
      ]),
      ['├─ ', '└─ '],
    );
  });

  test('父层还有兄弟 → 子项前面画竖线；父层是最后一个 → 画空格', () => {
    const rows: Item[] = [
      [0, 'a'], // 后面还有 b → ├─
      [1, 'a1'], // 父层 a 有后续 → 竖线
      [1, 'a2'], // 本层最后一个 → └─
      [0, 'b'], // 最后一个 → └─
      [1, 'b1'],
    ];
    assert.deepEqual(prefixesOf(rows), ['├─ ', '│  ├─ ', '│  └─ ', '└─ ', '   └─ ']);
  });

  test('两级缩进：祖父有兄弟时每层各画一条竖线', () => {
    const rows: Item[] = [
      [0, 'a'],
      [1, 'a1'],
      [2, 'a1x'], // 祖父 a 与父 a1 都还有后续
      [2, 'a1y'],
      [1, 'a2'],
    ];
    // 根 a 是唯一的 0 层 → 它是「最后一个」；a 的子项靠祖先竖线只到 a1 这一层。
    assert.deepEqual(prefixesOf(rows), ['└─ ', '   ├─ ', '   │  ├─ ', '   │  └─ ', '   └─ ']);
  });

  test('空输入不炸', () => {
    assert.deepEqual(prefixesOf([]), []);
  });
});
