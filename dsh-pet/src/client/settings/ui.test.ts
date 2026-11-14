/**
 * 设置页共用小件（src/client/settings/ui.ts）的契约测试。
 *
 * 四条契约：
 *   1. 说明只有两个出口：卡头问号（`role=img` + 可读名）与字段 / 开关标签的悬浮气泡；
 *      **字段本身不再长问号**——四十个问号把视线切碎，信息大多能从标签读出来；
 *   2. 开关格的勾选态与禁用态透传给原生 checkbox，视觉是开关、语义仍是 checkbox；
 *   3. 圆点只在卡头与折叠卡上出现，字段级不再重复同一条「这块改过」的信号；
 *   4. 小节 / 说明行 / 开关组各自只负责自己的盒子，不夹带交互。
 *
 * 用假的 `h` 记录节点树（不引 jsdom）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { H } from './runtime.ts';

import { makeUiKit } from './ui.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: string, props: Record<string, unknown>) => ({ tag, props })) as unknown as H;

const ui = makeUiKit({ h, t: (key) => key });

/** 摊平整棵树，便于按标签找节点。 */
function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const byClass = (node: unknown, className: string): Node[] =>
  flatten(node).filter((child) => String(child.props.className ?? '').includes(className));

describe('field —— 字段', () => {
  test('带说明：说明挂在标签的 data-tip 上，字段里不长问号', () => {
    const field = ui.field('大小', h('input', {}), '高度自动 = 宽度 × 9/16');
    const [label] = byClass(field, 'dsh-pet-cfg__flabel');
    assert.equal(label.props['data-tip'], '高度自动 = 宽度 × 9/16', '鼠标悬浮标签能读到说明');
    assert.deepEqual(byClass(field, 'dsh-pet-cfg__q'), [], '字段级问号已废弃');
    assert.equal(
      flatten(label).some((node) => node.tag === 'input'),
      false,
      '输入框在字段容器里，不在标签里',
    );
  });

  test('不带说明：标签就是纯文本，不挂 data-tip', () => {
    const field = ui.field('大小', h('input', {}));
    const [label] = byClass(field, 'dsh-pet-cfg__flabel');
    assert.equal(label.props['data-tip'], undefined);
    assert.deepEqual(label.props.children, ['大小', null], '没给路径时标签后不长圆点');
  });

  test('给了路径且该路径有改动：字段自己挂高亮，标签后面跟一颗圆点', () => {
    const dirty = { count: 1, has: (prefix: string) => prefix === 'look.font.size' };
    const kit = makeUiKit({ h, t: (key) => key }, dirty);
    const touched = kit.field('字号', h('input', {}), undefined, 'look.font.size') as unknown as Node;
    assert.match(String(touched.props.className), /is-dirty/);
    const [label] = byClass(touched, 'dsh-pet-cfg__flabel');
    const [dot] = byClass(touched, 'dsh-pet-cfg__dot');
    assert.ok(dot, '改过的字段要有自己的圆点');
    assert.match(String(dot.props.className), /is-inline/);
    assert.equal(dot.props['aria-label'], 'unsaved');
    assert.ok(Array.isArray(label.props.children));

    // 同一个 kit 里另一个路径没改动：不长点、也不加高亮。
    const clean = kit.field('字号', h('input', {}), undefined, 'look.font.family') as unknown as Node;
    assert.equal(clean.props.className, 'dsh-pet-cfg__field');
    assert.deepEqual(byClass(clean, 'dsh-pet-cfg__dot'), []);
  });

  test('开关同理：改动项自己带圆点，容器带 is-dirty', () => {
    const dirty = { count: 1, has: (prefix: string) => prefix === 'global.trayEnabled' };
    const kit = makeUiKit({ h, t: (key) => key }, dirty);
    const touched = kit.toggleCell('trayToggle', true, false, () => {}, 'global.trayEnabled') as unknown as Node;
    assert.match(String(touched.props.className), /is-dirty/);
    assert.ok(byClass(touched, 'dsh-pet-cfg__dot').length === 1, '开关文字后跟一颗圆点');
    const clean = kit.toggleCell('trayToggle', true, false, () => {}, 'global.sfxEnabled') as unknown as Node;
    assert.equal(clean.props.className, 'dsh-pet-cfg__switch');
    assert.deepEqual(byClass(clean, 'dsh-pet-cfg__dot'), []);
  });
});

describe('toggleCell —— 开关格', () => {
  test('勾选态与禁用态透传给 checkbox，标题走翻译', () => {
    const cell = ui.toggleCell('notifyToggle', true, true, () => {});
    const input = flatten(cell).find((node) => node.tag === 'input');
    assert.equal(input?.props.type, 'checkbox');
    assert.equal(input?.props.checked, true);
    assert.equal(input?.props.disabled, true);
    assert.ok(flatten(cell).some((node) => node.props.children === 'notifyToggle'));
  });

  test('切换只回传布尔值，不把事件对象抛给调用方', () => {
    const seen: boolean[] = [];
    const cell = ui.toggleCell('x', false, false, (value) => seen.push(value));
    const input = flatten(cell).find((node) => node.tag === 'input');
    const onChange = input?.props.onChange as (event: { target: { checked: boolean } }) => void;
    onChange({ target: { checked: true } });
    assert.deepEqual(seen, [true]);
  });

  test('说明挂在开关标签上（`<label + Hint>`），不额外长问号', () => {
    const cell = ui.toggleCell('notifyToggle', false, false, () => {});
    const label = byClass(cell, 'dsh-pet-cfg__switch')[0];
    assert.equal(flatten(label).length >= 2, true);
    const [first] = byClass(cell, 'dsh-pet-cfg__switch');
    const inner = flatten(first).find((node) => node.tag === 'label');
    assert.equal(inner?.props['data-tip'], 'notifyToggleHint');
    assert.deepEqual(byClass(cell, 'dsh-pet-cfg__q'), []);
  });

  test('圆点是真节点：轨道与圆点跟在 checkbox 后面，皮肤对读屏不可见', () => {
    const cell = ui.toggleCell('x', true, false, () => {}) as unknown as Node;
    const label = flatten(cell).find((node) => node.tag === 'label');
    const children = label?.props.children as Node[];
    // 伪元素在替换元素（input）上不保证生成：一旦不生成，开关就只剩一条会换色的色条。
    assert.equal(children[0].tag, 'input', '真控件排第一，轨道靠相邻选择器接勾选态');
    assert.equal(children[1].props.className, 'dsh-pet-cfg__swTrack');
    assert.equal(children[2].props.className, 'dsh-pet-cfg__swText');
    const knob = flatten(children[1]).find((node) => node.props.className === 'dsh-pet-cfg__swKnob');
    assert.ok(knob, '圆点必须是可渲染的真节点');
    assert.equal(children[1].props['aria-hidden'], 'true');
  });
});

describe('cardHead —— 卡片头', () => {
  test('标题 + 问号；没有说明时只有标题', () => {
    const withHint = ui.cardHead('宠物配置', '每只宠物独立配置');
    const [question] = byClass(withHint, 'dsh-pet-cfg__q');
    assert.equal(question.props['aria-label'], '每只宠物独立配置');

    const without = ui.cardHead('宠物配置');
    assert.deepEqual(byClass(without, 'dsh-pet-cfg__q'), []);
  });

  test('第四个参数是卡头右侧动作，包一层贴右容器', () => {
    const head = ui.cardHead('音效', '说明', undefined, h('button', { children: '打开文件夹' }));
    const [actions] = byClass(head, 'dsh-pet-cfg__cardActions');
    assert.ok(actions, '动作要有自己的容器');
    assert.equal(byClass(actions, '').length > 0, true);
  });
});

describe('section / note / switchGrid —— 卡片内的小节', () => {
  test('小节：标题 + 正文块', () => {
    const node = ui.section('功能', [h('div', {}), null]) as unknown as Node;
    assert.equal(node.props.className, 'dsh-pet-cfg__section', '小节根就是一个盒子');
    const [title] = byClass(node, 'dsh-pet-cfg__sectionTitle');
    assert.equal(title.props.children, '功能');
  });

  test('说明行：tight 是小一号的同一种盒子', () => {
    const loose = ui.note('说明') as unknown as Node;
    const tight = ui.note('说明', true) as unknown as Node;
    assert.equal(loose.props.className, 'dsh-pet-cfg__note');
    assert.match(String(tight.props.className), /is-tight/);
  });

  test('开关组：muted 让整组降透明（父开关关掉时的从属关系）', () => {
    const muted = ui.switchGrid([ui.toggleCell('a', true, false, () => {})], true) as unknown as Node;
    assert.match(String(muted.props.className), /is-muted/);
    const plain = ui.switchGrid([]) as unknown as Node;
    assert.equal(plain.props.className, 'dsh-pet-cfg__switchGrid');
  });
});

describe('dot —— 未保存改动的圆点', () => {
  /** 只认这几条路径的查询口。 */
  const dirty = {
    count: 2,
    has: (prefix: string) =>
      prefix === 'look.physics' ||
      prefix.startsWith('look.physics.') ||
      prefix === 'model' ||
      prefix.startsWith('model.'),
  };

  test('不传查询口：一个圆点都不画', () => {
    const field = ui.field('大小', h('input', {}), '说明');
    assert.deepEqual(byClass(field, 'dsh-pet-cfg__dot'), []);
  });

  test('命中路径：卡头与折叠卡各画一个可读的圆点；字段与开关不再重复', () => {
    const withDirty = makeUiKit({ h, t: (key) => key }, dirty);
    assert.deepEqual(byClass(withDirty.field('大小', h('input', {}), '说明'), 'dsh-pet-cfg__dot'), []);
    assert.deepEqual(
      byClass(
        withDirty.toggleCell('x', false, false, () => {}),
        'dsh-pet-cfg__dot',
      ),
      [],
    );

    const head = withDirty.cardHead('物理', '说明', 'look.physics');
    const [headDot] = byClass(head, 'dsh-pet-cfg__dot');
    assert.equal(headDot.props['aria-label'], 'unsaved');
    assert.equal(headDot.props.role, 'img');

    const fold = withDirty.foldCard({
      id: 'x',
      title: '标题',
      hint: '说明',
      body: [],
      open: false,
      onToggle: () => {},
      scope: 'model',
    });
    assert.equal(byClass(fold, 'dsh-pet-cfg__dot').length, 1);
  });

  test('没命中的路径不画点', () => {
    const withDirty = makeUiKit({ h, t: (key) => key }, dirty);
    assert.deepEqual(byClass(withDirty.cardHead('字体', '说明', 'look.font.size'), 'dsh-pet-cfg__dot'), []);
  });
});
