/**
 * 设置页的搜索索引：**从已经渲染出来的 DOM 里读**「标题 / 名称 / 当前值」，不另维护一份字段清单。
 *
 * 为什么不写一张「可搜索项」表：设置页有上百个字段，分散在六个分区与十几个 hook 里；表一写两处，
 * 改一个标签就得记得同步，忘一次就是「搜不到某个开关」的静默 bug。而用户想搜的东西恰恰就是屏幕上
 * 那些字——标题、字段标签、输入框里的值、开关的开/关。所以索引就是 DOM 本身：
 * 卡片（`.dsh-pet-cfg__card`）→ 卡标题；卡里的字段/开关/行（见 {@link ITEM_SELECTOR}）→ 名称 + 当前值。
 *
 * 三个入口各司其职：{@link readSearchEntries} 把一棵子树读成条目，{@link matchEntries} 做纯匹配
 * （可单测、无 DOM），{@link highlightMatches} 把命中项标出来并滚到第一处——它复用同一套选择器，
 * 所以「搜索结果」与「跳过去高亮的东西」永远是同一批元素。
 * @module dsh-fish-body/src/client/settings/search
 */
import type { SettingsTabId } from './tabs.ts';

/** 一条可搜索项：一个字段/开关/行，或者一张没有细项的卡片。 */
export interface SearchEntry {
  /** 所属分区。 */
  readonly tab: SettingsTabId;
  /** 卡标题（同一张卡里的多条共用一个）。 */
  readonly title: string;
  /** 字段名 / 开关名 / 行标题；空串表示这条是「整卡」。 */
  readonly label: string;
  /** 当前值的可读形式（输入框内容、开/关、行的补充说明）。 */
  readonly value: string;
  /** 参与匹配的小写文本（标题 + 名称 + 值，外加分区名由调用方补）。 */
  readonly text: string;
}

/** 参与索引与高亮的元素：字段、开关、列表行、字段行、目录树行、hook 行、chip。 */
const ITEM_SELECTOR = [
  '.dsh-pet-cfg__field',
  '.dsh-pet-cfg__switch',
  '.dsh-pet-cfg__row',
  // 字段级的一行（静默时段 / 窗口行为）用独立类名，不与列表行共用 `__row`。
  '.dsh-pet-cfg__fieldRow',
  '.dsh-pet-cfg__treeRow',
  '.dsh-pet-cfg__hookRow',
  '.dsh-pet-cfg__chip',
].join(',');

/** 高亮用的类名（样式在 `./style/controls`）。 */
const HIT_CLASS = 'is-search-hit';

/** 折叠空白：`textContent` 会把缩进与换行一起带出来。 */
const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * 取子树里第一个匹配元素的文字。
 *
 * @param root - 起点。
 * @param selector - 选择器。
 * @returns 收拢空白后的文字；没有匹配时为空串。
 */
function textOf(root: Element, selector: string): string {
  const node = root.querySelector(selector);
  return node === null ? '' : squash(node.textContent ?? '');
}

/**
 * 一个控件此刻的值，转成可搜索的文字。
 *
 * 勾选框读 `checked` 而不是 `value`（`value` 恒为 `on`，搜「开/关」永远搜不到）；
 * 下拉框读选中项的文案（用户看到的是「小 / 中 / 大」而不是内部的 `0.7`）。
 *
 * @param root - 条目元素。
 * @returns 值的文字形式；没有控件时为空串。
 */
function valueOf(root: Element): string {
  const control = root.querySelector('input, select, textarea');
  if (control === null) return '';
  // 按能力判断而不是 `instanceof HTMLInputElement`：这段逻辑在浏览器里跑，但用属性探测更稳，
  // 也让单测可以拿普通对象当控件（node 里没有 DOM 全局）。
  const field = control as unknown as {
    readonly checked?: unknown;
    readonly selectedOptions?: unknown;
    readonly value?: unknown;
    readonly type?: unknown;
  };
  if (typeof field.checked === 'boolean' && (field.type === 'checkbox' || field.type === 'radio')) {
    return field.checked ? '开 on' : '关 off';
  }
  if (field.selectedOptions !== undefined) {
    const options = field.selectedOptions as ArrayLike<{ textContent: string | null }> | undefined;
    const selected = options?.[0]?.textContent ?? '';
    return squash(selected !== '' ? selected : typeof field.value === 'string' ? field.value : '');
  }
  if (typeof field.value !== 'string') return '';
  // 密码框：值从不回传，空的当没填；有内容也只说「已填写」（别把密钥种进索引）
  if (field.type === 'password') return field.value === '' ? '' : '已填写 set';
  return field.value;
}

/**
 * 一个条目元素的名称：按类名挑它自己的标题位，取不到就退回整块文字。
 *
 * @param root - 条目元素。
 * @returns 名称文字。
 */
function labelOf(root: Element): string {
  for (const selector of ['.dsh-pet-cfg__flabel', '.dsh-pet-cfg__swText', '.dsh-pet-cfg__rowMain']) {
    const text = textOf(root, selector);
    if (text !== '') return text;
  }
  // 目录树行 / hook 行没有专属标题类：取整块文字（它们本身就很短）
  return squash(root.textContent ?? '');
}

/**
 * 把一棵已渲染的子树读成搜索条目。
 *
 * @param root - 子树根（一个分区的面板，或者临时挂载的隐藏容器）。
 * @param tab - 这些条目属于哪个分区。
 * @param tabLabel - 分区名（并进 `text`，于是搜「声音」也能命中里面每一项）。
 * @returns 条目列表：每张卡至少一条（卡标题），卡里有细项时按细项各一条。
 */
export function readSearchEntries(root: Element, tab: SettingsTabId, tabLabel = ''): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const cards = root.querySelectorAll('.dsh-pet-cfg__card');
  for (const card of cards) {
    const title = textOf(card, '.dsh-pet-cfg__cardTitle') || textOf(card, '.dsh-pet-cfg__cardHead');
    const items = card.querySelectorAll(ITEM_SELECTOR);
    if (items.length === 0) {
      entries.push(makeEntry(tab, tabLabel, title, '', '', squash(card.textContent ?? '')));
      continue;
    }
    for (const item of items) {
      const label = labelOf(item);
      const value = valueOf(item);
      // 名称与值都空的条目（纯分隔线、空行）没有搜索价值，跳过
      if (label === '' && value === '') continue;
      entries.push(makeEntry(tab, tabLabel, title, label, value, squash(item.textContent ?? '')));
    }
  }
  return entries;
}

/**
 * 造一条条目：`text` 统一小写，匹配时只做包含判断。
 *
 * @param tab - 分区。
 * @param tabLabel - 分区名。
 * @param title - 卡标题。
 * @param label - 名称。
 * @param value - 当前值。
 * @param fallback - 元素自身的文字（兜底，保证「屏幕上看得见的字」都进索引）。
 * @returns 条目。
 */
function makeEntry(
  tab: SettingsTabId,
  tabLabel: string,
  title: string,
  label: string,
  value: string,
  fallback: string,
): SearchEntry {
  const text = [tabLabel, title, label, value, fallback].join(' ').toLowerCase();
  return { tab, title, label, value, text };
}

/**
 * 把查询串切成词：空白分隔，全小写，去掉空串。
 *
 * @param query - 用户输入。
 * @returns 词数组；空数组表示没有有效查询。
 */
export function splitQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');
}

/** 一条命中结果：条目 + 它命中的部位（用来排先后与显示）。 */
export interface SearchHit {
  readonly entry: SearchEntry;
  /** 3 = 命中名称，2 = 命中标题，1 = 只命中值/其它文字。 */
  readonly score: number;
}

/**
 * 纯匹配：每个词都要出现（AND），按「先命中名称、再标题、最后值」排先后。
 *
 * @param entries - 条目列表。
 * @param query - 用户输入。
 * @param limit - 最多回多少条（默认 40，够用且不会把结果列表撑成第二页设置页）。
 * @returns 排序后的命中；查询为空时为空数组。
 */
export function matchEntries(entries: readonly SearchEntry[], query: string, limit = 40): SearchHit[] {
  const words = splitQuery(query);
  if (words.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const entry of entries) {
    if (!words.every((word) => entry.text.includes(word))) continue;
    const labelHit = words.every((word) => entry.label.toLowerCase().includes(word));
    const titleHit = !labelHit && words.every((word) => entry.title.toLowerCase().includes(word));
    hits.push({ entry, score: labelHit ? 3 : titleHit ? 2 : 1 });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/**
 * 把命中项标出来并把第一处滚到眼前。
 *
 * 复用 {@link ITEM_SELECTOR} 与 {@link readSearchEntries} 的同一套判据：结果列表里能点的东西，
 * 这里一定能标出来——两处若各写一套选择器，「点了结果跳过去却什么都没亮」就会是常态。
 *
 * @param root - 当前分区的面板。
 * @param query - 用户刚才搜的词。
 * @param durationMs - 高亮保留时长（毫秒）；到点自动摘掉，不留一堆黄框。
 * @returns 命中的元素个数。
 */
export function highlightMatches(root: Element, query: string, durationMs = 2600): number {
  const words = splitQuery(query);
  if (words.length === 0) return 0;
  const hits: Element[] = [];
  for (const item of root.querySelectorAll(ITEM_SELECTOR)) {
    const text = squash(item.textContent ?? '').toLowerCase();
    const value = valueOf(item).toLowerCase();
    if (words.every((word) => text.includes(word) || value.includes(word))) hits.push(item);
  }
  for (const item of hits) item.classList.add(HIT_CLASS);
  if (hits.length > 0) {
    const first = hits[0];
    // 面板自己就是滚动容器：`nearest` 只滚必要的距离，不会把整页弹到顶上
    first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      for (const item of hits) item.classList.remove(HIT_CLASS);
    }, durationMs);
  }
  return hits.length;
}
