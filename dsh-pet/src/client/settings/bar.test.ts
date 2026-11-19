/**
 * 底部操作栏（src/client/settings/bar.ts）的契约测试。
 *
 * 四条契约：
 *   1. 四个按钮按「越靠右越终局」排：撤销 / 取消 / 应用 / 确定，确定是实心主按钮；
 *   2. 写盘时禁掉会改东西的三个（撤销 / 应用 / 确定），取消永远可点——它是读失败时唯一的退路；
 *   3. 没有未保存改动时「撤销」禁用（点了也没东西可撤），状态位让给保存结论；
 *   4. 状态只有一条：有反馈显示反馈，否则显示未保存条数，两者不并排。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { H } from './runtime.ts';

import { makeBar } from './bar.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: string, props: Record<string, unknown>) => ({ tag, props })) as unknown as H;
const Bar = makeBar({ h, t: (key: string) => key } as never);

/** 摊平整棵树，便于按标签找节点。 */
function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const buttons = (tree: unknown): Node[] => flatten(tree).filter((node) => node.tag === 'button');

/** 造一份栏输入；未覆盖的字段给固定值。 */
function props(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    busy: false,
    msg: { kind: '', text: '' },
    dirtyCount: 0,
    onRevert: () => {},
    onConfirm: () => {},
    onCancel: () => {},
    onApply: () => {},
    ...over,
  };
}

describe('Bar —— 底部操作栏', () => {
  test('四个按钮按终局顺序排，确定是主按钮', () => {
    const all = buttons(Bar(props() as never));
    assert.deepEqual(
      all.map((node) => node.props.children),
      ['barRevert', 'barCancel', 'barApply', 'barConfirm'],
    );
    assert.equal(all[3].props.className, 'dsh-pet-cfg__btn is-primary');
  });

  test('点击各自回调，互不串台', () => {
    const calls: string[] = [];
    const tree = Bar(
      props({
        dirtyCount: 3,
        onConfirm: () => calls.push('confirm'),
        onCancel: () => calls.push('cancel'),
        onApply: () => calls.push('apply'),
        onRevert: () => calls.push('revert'),
      }) as never,
    );
    for (const node of buttons(tree)) (node.props.onClick as () => void)();
    assert.deepEqual(calls, ['revert', 'cancel', 'apply', 'confirm']);
  });

  test('写盘时只禁会改东西的三个，取消仍可点', () => {
    const all = buttons(Bar(props({ busy: true, dirtyCount: 2 }) as never));
    assert.deepEqual(
      all.map((node) => node.props.disabled === true),
      [true, false, true, true],
    );
  });

  test('没有未保存改动时撤销禁用', () => {
    const [revert] = buttons(Bar(props({ dirtyCount: 0 }) as never));
    assert.equal(revert.props.disabled, true);
  });

  test('状态只有一条：有反馈显示反馈，否则显示未保存条数', () => {
    const saved = Bar(props({ msg: { kind: 'ok', text: 'saved' }, dirtyCount: 2 }) as never);
    assert.ok(
      flatten(saved).some((node) => node.props.children === 'saved'),
      '反馈优先',
    );
    assert.equal(
      flatten(saved).some((node) => node.props.children === 'barDirty'),
      false,
    );

    const dirty = Bar(props({ dirtyCount: 3 }) as never);
    const [state] = flatten(dirty).filter((node) => String(node.props.className ?? '').includes('__barState'));
    assert.ok(state, '没有反馈时显示未保存条数');
    // 字典键里带 `{n}` 占位符，测试的 t 是恒等函数，所以这里断言的是「这条状态用的是 barDirty」。
    assert.ok(
      flatten(state).some((node) => String(node.props.children ?? '').includes('barDirty')),
      '计数文案走 barDirty',
    );

    assert.equal(
      flatten(Bar(props() as never)).filter((node) => String(node.props.className ?? '').includes('__msg')).length,
      0,
    );
  });

  test('错误反馈带 is-err', () => {
    const err = Bar(props({ msg: { kind: 'err', text: 'saveError' } }) as never);
    const [bad] = flatten(err).filter((node) => node.props.children === 'saveError');
    assert.match(String(bad.props.className), /is-err/);
  });

  test('有「已保存但需重启」的改动：多一条状态与一个立即重启按钮，点击回传', () => {
    const calls: string[] = [];
    const tree = Bar(
      props({
        msg: { kind: 'ok', text: 'saved' },
        restart: { count: 2, onRestart: () => calls.push('restart'), busy: false },
      }) as never,
    );
    const states = flatten(tree).filter((node) => String(node.props.className ?? '').includes('__barState'));
    assert.equal(states.length, 1, '需重启提示自己就是一条状态');
    assert.match(String(states[0].props.className), /is-restart/);
    assert.ok(
      flatten(states[0]).some((node) => String(node.props.children ?? '').includes('restartPending')),
      '文案走 restartPending',
    );
    // 保存结论仍然在：两者说的不是同一件事（一个「存了」，一个「还得重启」）。
    assert.ok(flatten(tree).some((node) => node.props.children === 'saved'));

    const restartBtn = buttons(tree).find((node) => node.props.children === 'fsLocationRestart');
    assert.ok(restartBtn, '要有一个立即重启按钮');
    (restartBtn?.props.onClick as () => void)();
    assert.deepEqual(calls, ['restart']);
  });

  test('没有这类改动：不渲染提示与重启按钮，按钮仍是四个', () => {
    const tree = Bar(props() as never);
    assert.equal(flatten(tree).filter((node) => String(node.props.className ?? '').includes('is-restart')).length, 0);
    assert.equal(buttons(tree).length, 4);
  });

  test('重启进行中：立即重启按钮置灰', () => {
    const tree = Bar(props({ restart: { count: 1, onRestart: () => {}, busy: true } }) as never);
    const restartBtn = buttons(tree).find((node) => node.props.children === 'fsLocationRestart');
    assert.equal(restartBtn?.props.disabled, true);
  });
});
