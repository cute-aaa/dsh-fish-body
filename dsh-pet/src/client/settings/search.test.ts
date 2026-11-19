/**
 * 设置搜索的纯逻辑契约（`./search.ts`）：分词、匹配排序、DOM 读取的口径。
 *
 * 这里用一个极小的假元素树代替 DOM（node 里没有 DOM）：`querySelector(All)` 只认本模块真正用到的
 * 那几个选择器（类名 / 标签名），够用来钉住三条规则：
 *   1. **名称、标题、值都进索引**——搜「2400」能命中重力，搜「重力」也能命中同一项；
 *   2. **并列词是 AND**——`重力 2400` 必须两个词都出现；
 *   3. **开关索引成「开/关」**——checkbox 的 `value` 恒为 `on`，读它会让「关」永远搜不到。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { matchEntries, readSearchEntries, splitQuery, type SearchEntry } from './search.ts';

/** 假元素的形状：标签名、单个类名、自身文字、控件属性与子节点。 */
interface FakeSpec {
  readonly tag: string;
  readonly cls?: string;
  readonly text?: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly children?: readonly FakeEl[];
}

/** 一个够用的假元素：只实现 search.ts 用到的那几个读法。 */
class FakeEl {
  private readonly spec: FakeSpec;

  constructor(spec: FakeSpec) {
    this.spec = spec;
  }

  /** 自身文字 + 所有后代文字（与真实 `textContent` 同义，只是不做空白归一）。 */
  get textContent(): string {
    return [this.spec.text ?? '', ...(this.spec.children ?? []).map((child) => child.textContent)].join('');
  }

  /** 控件属性（`value` / `checked` / `type` / `selectedOptions`）。 */
  get value(): unknown {
    return this.spec.props?.value;
  }

  get checked(): unknown {
    return this.spec.props?.checked;
  }

  get type(): unknown {
    return this.spec.props?.type;
  }

  get selectedOptions(): unknown {
    return this.spec.props?.selectedOptions;
  }

  /** 选择器匹配：支持本模块用到的 `tag`、`.class` 与逗号并集。 */
  private static matches(node: FakeEl, selector: string): boolean {
    return selector.split(',').some((part) => {
      const sel = part.trim();
      if (sel === '') return false;
      if (sel.startsWith('.')) return node.spec.cls === sel.slice(1);
      return node.spec.tag === sel;
    });
  }

  /** 后代（深度优先，不含自己）。 */
  private descendants(): FakeEl[] {
    return (this.spec.children ?? []).flatMap((child) => [child, ...child.descendants()]);
  }

  querySelectorAll(selector: string): FakeEl[] {
    return this.descendants().filter((node) => FakeEl.matches(node, selector));
  }

  querySelector(selector: string): FakeEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

/** 把假树当元素递给被测函数。 */
const asEl = (node: FakeEl): Element => node as unknown as Element;

/** 造一条条目（匹配只看 `text`，这里按 search.ts 的拼法显式给出）。 */
const entry = (label: string, title: string, value: string): SearchEntry => ({
  tab: 'feel',
  title,
  label,
  value,
  text: [title, label, value].join(' ').toLowerCase(),
});

describe('splitQuery —— 分词', () => {
  test('小写化、按空白切开、丢掉空串', () => {
    assert.deepEqual(splitQuery('  Gravity   2400 '), ['gravity', '2400']);
    assert.deepEqual(splitQuery('   '), []);
    assert.deepEqual(splitQuery(''), []);
  });
});

describe('matchEntries —— 名称 / 标题 / 值都参与，词与词之间是 AND', () => {
  const entries = [
    entry('重力', '物理', '2400'),
    entry('天花板反弹', '物理', '关 off'),
    entry('音色（本地）', '语音', 'vodyanitsa'),
  ];

  test('命中值也算命中', () => {
    const hits = matchEntries(entries, '2400');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].entry.label, '重力');
    assert.equal(hits[0].score, 1, '只命中值：排在名称/标题之后');
  });

  test('命中名称排最前，其次标题', () => {
    const byLabel = matchEntries(entries, '重力');
    assert.deepEqual([byLabel[0].entry.label, byLabel[0].score], ['重力', 3]);
    const byTitle = matchEntries(entries, '物理');
    assert.deepEqual(
      byTitle.map((hit) => hit.score),
      [2, 2],
      '两张物理卡都没在名称里命中，按标题命中计 2',
    );
  });

  test('并列词是 AND：两个词都得出现', () => {
    assert.equal(matchEntries(entries, '重力 2400').length, 1);
    assert.equal(matchEntries(entries, '重力 vodyanitsa').length, 0);
  });

  test('空查询没有结果；limit 生效', () => {
    assert.deepEqual(matchEntries(entries, '   '), []);
    assert.equal(matchEntries(entries, '物理', 1).length, 1);
  });
});

describe('readSearchEntries —— 从渲染结果里读标题、名称与值', () => {
  /** 一张卡：标题「物理」，里面一个数值字段与一个开关。 */
  const card = new FakeEl({
    tag: 'div',
    cls: 'dsh-pet-cfg__card',
    children: [
      new FakeEl({ tag: 'div', cls: 'dsh-pet-cfg__cardTitle', text: '物理' }),
      new FakeEl({
        tag: 'div',
        cls: 'dsh-pet-cfg__field',
        children: [
          new FakeEl({ tag: 'span', cls: 'dsh-pet-cfg__flabel', text: '重力' }),
          new FakeEl({ tag: 'input', props: { value: '2400', type: 'number' } }),
        ],
      }),
      new FakeEl({
        tag: 'div',
        cls: 'dsh-pet-cfg__switch',
        children: [
          new FakeEl({ tag: 'input', props: { checked: false, type: 'checkbox' } }),
          new FakeEl({ tag: 'span', cls: 'dsh-pet-cfg__swText', text: '天花板反弹' }),
        ],
      }),
    ],
  });

  test('每个字段/开关一条：名称 + 当前值，标题与分区名并进 text', () => {
    const entries = readSearchEntries(asEl(panelOf(card)), 'feel', '外观与手感');
    assert.equal(entries.length, 2);
    const [gravity, bounce] = entries;
    assert.deepEqual([gravity.title, gravity.label, gravity.value], ['物理', '重力', '2400']);
    assert.match(gravity.text, /外观与手感/);
    // 开关读 checked 而不是 value（checkbox 的 value 恒为 "on"，读错就永远搜不到「关」）
    assert.deepEqual([bounce.label, bounce.value], ['天花板反弹', '关 off']);
  });

  test('没有细项的卡片（纯说明卡）自成一整卡条目', () => {
    const note = new FakeEl({
      tag: 'div',
      cls: 'dsh-pet-cfg__card',
      children: [
        new FakeEl({ tag: 'div', cls: 'dsh-pet-cfg__cardTitle', text: '关于' }),
        new FakeEl({ tag: 'p', text: '这一页只读' }),
      ],
    });
    const entries = readSearchEntries(asEl(panelOf(note)), 'system', '系统');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].label, '');
    assert.match(entries[0].text, /这一页只读/);
  });
});

/**
 * 真实现里 `readSearchEntries` 的根是分区面板（卡片的父节点），所以假树也要包一层：
 * 直接把卡片当根时 `querySelectorAll('.…__card')` 只找后代，一张也找不到。
 *
 * @param card - 卡片节点。
 * @returns 以它为唯一子节点的面板。
 */
function panelOf(card: FakeEl): FakeEl {
  return new FakeEl({ tag: 'div', children: [card] });
}
