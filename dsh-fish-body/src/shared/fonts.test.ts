/**
 * 内置字体契约：配置 id、CSS 字体栈与默认值必须共同指向 Dymon。
 *
 * 配置 id `candy` 是为兼容旧用户保留的稳定键；真正展示给用户的名称与实际字体由 preset 决定。
 * @module dsh-fish-body/src/shared/fonts.test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_FONT, FONT_PRESETS, fontStackOf } from './fonts.ts';

test('默认字体保持兼容 id，实际使用 Dymon 手写体', () => {
  assert.equal(DEFAULT_FONT.family, 'candy');
  assert.equal(FONT_PRESETS[0]?.id, 'candy');
  assert.match(fontStackOf('candy'), /^"DymonShouXieTi"/);
});

test('未知字体 id 回落到 Dymon，而不是空的 CSS 字体栈', () => {
  assert.equal(fontStackOf('missing-font'), fontStackOf('candy'));
  assert.ok(fontStackOf('missing-font').endsWith(',sans-serif'));
});
