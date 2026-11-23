/**
 * 目录树前缀（src/client/settings/tree.ts）的契约测试。
 *
 * 树形是画出来的，所以「根行顶格」「谁是最后一个」「祖先的竖线要不要继续」必须钉死：
 * 这三件事错一次，整棵树的层级读起来就全是错的。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { treePrefixes } from './tree.ts';

/** 项目简写：`[depth, 名字]`。 */
type Item = readonly [number, string];

const prefixesOf = (items: readonly Item[]): string[] => treePrefixes(items.map(([depth]) => ({ depth })));

describe('treePrefixes —— 树形前缀', () => {
  test('根行不画枝干：整行从第 0 列开始', () => {
    assert.deepEqual(prefixesOf([[0, 'root']]), ['']);
  });

  test('第一层子项直接落在第 0 列：前几个 ├─，最后一个 └─', () => {
    assert.deepEqual(
      prefixesOf([
        [0, 'root'],
        [1, 'a'],
        [1, 'b'],
      ]),
      ['', '├─ ', '└─ '],
    );
  });

  test('父层还有兄弟 → 第二层子项前面画竖线；父层是最后一个 → 画空格', () => {
    const rows: Item[] = [
      [0, 'root'],
      [1, 'a'], // 后面还有 b → ├─
      [2, 'a1'], // 父层 a 有后续 → 竖线
      [2, 'a2'], // 本层最后一个 → └─
      [1, 'b'], // 最后一个 → └─
      [2, 'b1'],
    ];
    assert.deepEqual(prefixesOf(rows), ['', '├─ ', '│  ├─ ', '│  └─ ', '└─ ', '   └─ ']);
  });

  test('三级缩进：每层祖先有后续就各画一条竖线', () => {
    const rows: Item[] = [
      [0, 'root'],
      [1, 'a'], // 后面还有 b → ├─
      [2, 'x'], // a 有后续 → 竖线；x 后面还有 y → ├─
      [3, 'x1'], // a 与 x 都有后续 → 两条竖线
      [3, 'x2'],
      [2, 'y'], // a 有后续 → 竖线；y 是本层最后一个 → └─
      [1, 'b'],
    ];
    assert.deepEqual(prefixesOf(rows), ['', '├─ ', '│  ├─ ', '│  │  ├─ ', '│  │  └─ ', '│  └─ ', '└─ ']);
  });

  test('只有一个根、深层竖线不断', () => {
    const rows: Item[] = [
      [0, 'fish-body'],
      [1, 'config'],
      [2, 'config.jsonc'],
      [1, 'assets'],
      [2, 'pet'],
      [3, 'layered'],
    ];
    assert.deepEqual(prefixesOf(rows), ['', '├─ ', '│  └─ ', '└─ ', '   └─ ', '      └─ ']);
  });

  test('空输入不炸', () => {
    assert.deepEqual(prefixesOf([]), []);
  });
});
