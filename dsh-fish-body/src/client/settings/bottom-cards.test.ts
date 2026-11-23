/**
 * 维护卡（src/client/settings/maintenance-card.ts）与音效总闸卡、系统与桌面卡的契约测试。
 *
 * 三张卡都在「设置页底部」这一带，各自只有一条容易写错的规则：
 *   1. 维护卡把重启与重置放在同一行，重置走危险样式，写盘时两个都禁用；
 *   2. 音效三项与系统三项各自回传**配置字段名**（键名错位会静默写坏另一个开关）；
 *   3. 测试弹窗按钮只管触发，结论由宿主页面放进 `permMsg`。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { H } from './runtime.ts';

import { NO_DIRTY } from './dirty.ts';
import { makeMaintenanceCard } from './maintenance-card.ts';
import { makeSfxMasterCard } from './sfx-master-card.ts';
import { makeSystemCard } from './system-card.ts';
import type { GlobalFlags } from './global-flags.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: string, props: Record<string, unknown>) => ({ tag, props })) as unknown as H;
const rt = { h, t: (key: string) => key } as never;

/** 摊平整棵树，便于按标签找节点。 */
function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const buttons = (tree: unknown): Node[] => flatten(tree).filter((node) => node.tag === 'button');
const checks = (tree: unknown): Node[] =>
  flatten(tree).filter((node) => node.tag === 'input' && node.props.type === 'checkbox');

const flags: GlobalFlags = {
  petEnabled: true,
  notificationsEnabled: true,
  sfxEnabled: true,
  sfxKeepAlive: false,
  confineToScreen: false,
  trayEnabled: true,
};

describe('MaintenanceCard —— 插件维护', () => {
  const MaintenanceCard = makeMaintenanceCard(rt);

  test('重启 + 重置两个按钮；重置走危险样式，两个都回传', () => {
    const calls: string[] = [];
    const tree = MaintenanceCard({
      busy: false,
      intro: 'intro',
      onRestart: () => calls.push('restart'),
      onReset: () => calls.push('reset'),
    } as never);
    const all = buttons(tree);
    assert.deepEqual(
      all.map((node) => node.props.children),
      ['barRestart', 'resetSettings'],
    );
    assert.match(String(all[1].props.className), /is-danger/);
    for (const node of all) (node.props.onClick as () => void)();
    assert.deepEqual(calls, ['restart', 'reset']);
  });

  test('写盘时两个都禁用；页面说明与重置说明都在卡里', () => {
    const tree = MaintenanceCard({ busy: true, intro: 'intro', onRestart: () => {}, onReset: () => {} } as never);
    for (const node of buttons(tree)) assert.equal(node.props.disabled, true);
    const notes = flatten(tree)
      .filter((node) => String(node.props.className ?? '').includes('__note'))
      .map((node) => node.props.children);
    assert.deepEqual(notes, ['resetHint', 'intro']);
  });
});

describe('SfxMasterCard —— 音效总闸', () => {
  const SfxMasterCard = makeSfxMasterCard(rt);

  test('两个开关回传配置字段名，音量回传数字', () => {
    const keys: string[] = [];
    const volumes: number[] = [];
    const tree = SfxMasterCard({
      busy: false,
      flags,
      onFlag: (key: string, value: boolean) => keys.push(key + '=' + String(value)),
      volume: 0.5,
      onVolume: (value: number) => volumes.push(value),
      dirty: NO_DIRTY,
    } as never);
    const boxes = checks(tree);
    assert.equal(boxes.length, 2);
    (boxes[0].props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: false } });
    (boxes[1].props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    assert.deepEqual(keys, ['sfxEnabled=false', 'sfxKeepAlive=true']);

    const range = flatten(tree).find((node) => node.tag === 'input' && node.props.type === 'range');
    assert.ok(range, '总音量要有滑块');
    (range.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: '0.8' } });
    assert.deepEqual(volumes, [0.8]);
  });
});

describe('SystemCard —— 系统与桌面', () => {
  const SystemCard = makeSystemCard(rt);

  test('三个开关回传各自的配置字段名', () => {
    const keys: string[] = [];
    const tree = SystemCard({
      busy: false,
      flags,
      onFlag: (key: string) => keys.push(key),
      permMsg: { kind: '', text: '' },
      onTestNotification: () => {},
      dirty: NO_DIRTY,
    } as never);
    const boxes = checks(tree);
    assert.equal(boxes.length, 4, '总开关 / 通知 / 托盘 / 锁定屏幕各一个');
    for (const box of boxes)
      (box.props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    assert.deepEqual(keys, ['petEnabled', 'notificationsEnabled', 'trayEnabled', 'confineToScreen']);
  });

  test('测试弹窗只管触发；结论来自 permMsg', () => {
    const calls: string[] = [];
    const tree = SystemCard({
      busy: false,
      flags,
      onFlag: () => {},
      permMsg: { kind: 'err', text: 'notifyDenyBlocked' },
      onTestNotification: () => calls.push('test'),
      dirty: NO_DIRTY,
    } as never);
    const [button] = buttons(tree);
    assert.equal(button.props.children, 'notifyTest');
    (button.props.onClick as () => void)();
    assert.deepEqual(calls, ['test']);
    const [msg] = flatten(tree).filter((node) => node.props.children === 'notifyDenyBlocked');
    assert.match(String(msg.props.className), /is-err/);
  });
});
