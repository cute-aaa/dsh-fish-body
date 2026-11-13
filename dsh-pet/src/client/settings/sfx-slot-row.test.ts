/**
 * 音效槽位两张脸（src/client/settings/sfx-slot-row.ts）的契约测试。
 *
 * 三条契约：
 *   1. 紧凑列表：八个槽位各一个开关与一个「试听」，关掉的槽位不给试听（点了也没声，只会被当成坏按钮）；
 *   2. 来源徽标写的是该行的来源类别，未匹配要带 `is-warn`（否则没人知道为什么没声音）；
 *   3. 明细行：「打开文件夹」的类别必须来自该行自己的 which——开错目录比没有按钮更糟。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { SFX_EVENT_SLOTS } from '../../shared/sfx/types.ts';
import { makeSfxSlotMeta, makeSfxSlotRows } from './sfx-slot-row.ts';
import type { SfxSettings, SfxSlotView } from './use-sfx-settings.ts';

interface Node {
  tag: unknown;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
const runtime = { h, t: (key: string) => key, useState: (<T>(init: T) => [init, () => undefined]) as never };

/** 造一行槽位视图。 */
const slot = (patch: Partial<SfxSlotView> & Pick<SfxSlotView, 'slot'>): SfxSlotView => ({
  enabled: true,
  file: 'x.wav',
  origin: 'package-default',
  which: 'sound',
  ...patch,
});

/** 造一份只含给定槽位与 hook 的状态。 */
const settingsOf = (slots: SfxSlotView[], hooks: SfxSettings['hooks'] = []): SfxSettings => ({
  apply: () => undefined,
  config: {},
  hooks,
  load: () => undefined,
  setSlotEnabled: () => undefined,
  slots,
  addHook: () => false,
  removeHook: () => undefined,
  tryHook: () => undefined,
  trySlot: () => undefined,
});

function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const everySlot = (patch: Partial<SfxSlotView> = {}): SfxSlotView[] =>
  SFX_EVENT_SLOTS.map((name) => slot({ slot: name, ...patch }));

describe('SfxSlotRows —— 槽位紧凑列表', () => {
  const Rows = makeSfxSlotRows(runtime as never);

  test('八个槽位各一个开关与一个试听，勾选态来自视图', () => {
    const nodes = flatten(Rows({ busy: false, sfx: settingsOf(everySlot()) }));
    const boxes = nodes.filter((node) => node.tag === 'input' && node.props.type === 'checkbox');
    assert.equal(boxes.length, SFX_EVENT_SLOTS.length);
    const tries = nodes.filter((node) => node.tag === 'button' && node.props.children === 'sfxTry');
    assert.equal(tries.length, SFX_EVENT_SLOTS.length);
  });

  test('关掉的槽位不给试听，忙时全部禁用', () => {
    const off = flatten(Rows({ busy: false, sfx: settingsOf(everySlot({ enabled: false })) }));
    for (const node of off.filter((item) => item.tag === 'button')) assert.equal(node.props.disabled, true);
    const busy = flatten(Rows({ busy: true, sfx: settingsOf(everySlot()) }));
    for (const node of busy.filter((item) => item.tag === 'button')) assert.equal(node.props.disabled, true);
  });

  test('来源徽标写该行的来源；未匹配带 is-warn', () => {
    const nodes = flatten(
      Rows({
        busy: false,
        sfx: settingsOf([slot({ slot: 'click', origin: 'none', file: '' }), slot({ slot: 'throw', origin: 'skin' })]),
      }),
    );
    const badges = nodes.filter((node) => String(node.props.className ?? '').includes('dsh-pet-cfg__badge'));
    assert.deepEqual(
      badges.map((node) => node.props.children),
      ['sfxOriginNone', 'sfxOriginSkin'],
    );
    assert.match(String(badges[0].props.className), /is-warn/);
    assert.doesNotMatch(String(badges[1].props.className), /is-warn/);
  });
});

describe('SfxSlotMeta —— 槽位明细', () => {
  const Meta = makeSfxSlotMeta(runtime as never);

  test('八个「打开文件夹」，类别来自各自的 which', () => {
    const slots = SFX_EVENT_SLOTS.map((name) => slot({ slot: name, which: name === 'click' ? 'sound' : 'skin' }));
    const nodes = flatten(Meta({ busy: false, sfx: settingsOf(slots) }));
    const buttons = nodes.filter((node) => typeof node.props?.which === 'string');
    assert.equal(buttons.length, SFX_EVENT_SLOTS.length);
    assert.equal(buttons[0].props.which, 'sound');
  });

  test('命中文件：显示绝对路径与命名规则', () => {
    const nodes = flatten(
      Meta({
        busy: false,
        sfx: settingsOf([slot({ slot: 'click', path: 'D:/u/skin/sound/click.wav', which: 'sound' })]),
      }),
    );
    const path = nodes.find(
      (node) => node.props?.className === 'dsh-pet-cfg__mono' && node.props.children === 'D:/u/skin/sound/click.wav',
    );
    assert.ok(path, '明细里要给出实际命中的路径');
    const pattern = nodes.find(
      (node) => node.props?.className === 'dsh-pet-cfg__mono' && String(node.props.children).includes('sfxSlotPattern'),
    );
    assert.ok(pattern, '每个槽位都要写明命名规则');
  });

  test('未命中：给出「建议放这里」', () => {
    const nodes = flatten(
      Meta({
        busy: false,
        sfx: settingsOf([
          slot({
            slot: 'click',
            suggestion: { absolute: 'D:/u/s/c1-click.wav', relative: 'skin/c1/c1-click.wav', which: 'sound' },
          }),
        ]),
      }),
    );
    assert.ok(
      nodes.some((node) => String(node.props.children).includes('sfxWhereToPut')),
      '没有命中文件时要告诉用户文件该放哪',
    );
  });
});
