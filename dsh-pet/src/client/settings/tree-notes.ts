/**
 * 树里每一行后面的说明：节点 key → 字典键。
 *
 * 为什么用白名单映射而不是拼 `'fsDesc.' + key`：字典的键类型是联合类型，拼字符串会绕过类型检查，
 * 新增/改名节点时漏翻译要等到界面上印出半个键名才发现。这里逐个写死，漏一个就编译不过。
 *
 * 没登记的 key（包内只读那一组、以及未来新增但还不想写说明的节点）返回 undefined，行上就只显示名字。
 * @module dsh-fish-body/src/client/settings/tree-notes
 */
import type { Key } from './locales/index.ts';

/** 节点 key → 说明的字典键。 */
const TREE_NOTES: Readonly<Record<string, Key>> = {
  root: 'fsDesc.root',
  config: 'fsDesc.config',
  'config.main': 'fsDesc.config.main',
  'config.sessionFish': 'fsDesc.config.sessionFish',
  'config.voiceProviders': 'fsDesc.config.voiceProviders',
  data: 'fsDesc.data',
  'data.memory': 'fsDesc.data.memory',
  'data.todos': 'fsDesc.data.todos',
  cache: 'fsDesc.cache',
  'cache.voice': 'fsDesc.cache.voice',
  'cache.download': 'fsDesc.cache.download',
  'cache.desktop': 'fsDesc.cache.desktop',
  runtime: 'fsDesc.runtime',
  'runtime.electron': 'fsDesc.runtime.electron',
  skin: 'fsDesc.skin',
  assets: 'fsDesc.assets',
  'assets.animation': 'fsDesc.assets.animation',
  'assets.sound': 'fsDesc.assets.sound',
  'assets.memes': 'fsDesc.assets.memes',
  'assets.pet': 'fsDesc.assets.pet',
  'assets.sessionFish': 'fsDesc.assets.sessionFish',
  logs: 'fsDesc.logs',
};

/**
 * 取某一行的说明文案。
 *
 * @param t - 字典函数。
 * @param key - 节点稳定键。
 * @returns 说明；没有登记时 undefined（调用方不渲染这一段）。
 */
export function treeNote(t: (key: Key) => string, key: string): string | undefined {
  const dictKey = TREE_NOTES[key];
  return dictKey === undefined ? undefined : t(dictKey);
}
