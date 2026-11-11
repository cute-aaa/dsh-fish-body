/**
 * 右键「动作」树按渲染方式差异化的判据测试：皮肤清单手势、model3 声明、以及两端的选树入口。
 *
 * 浏览器（card/entry）与桌面（sprite/menu）经 shared-core 共用同一份实现，所以钉在这里；
 * 动作名是两端渲染器 `playAction` 的入参，格式一改就得两边同时改，测试是这条契约的唯一守卫。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  actionMenuTree,
  model3ActionGroups,
  model3Expressions,
  rendererActionTree,
  skinMenuGroups,
} from './renderer-actions.ts';
import type { Animations } from '../types.ts';

/** 一份最小动画池（只有 webm 分支读它）。 */
const animations = {
  idle: ['待机呼吸'],
  turn: [],
  drag: [],
  clicks: ['点击回应-开心'],
  moves: { default: {}, actions: [] },
  categories: [],
  events: {},
} as unknown as Animations;

describe('skinMenuGroups —— 皮肤清单 interaction.menu', () => {
  test('手势 id 按声明顺序折成中文条目，name 仍是手势 id', () => {
    const groups = skinMenuGroups(['wag', 'tailpet', 'pat', 'hop', 'blink', 'talk', 'mouth']);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].label, '皮肤手势');
    assert.deepEqual(
      groups[0].actions.map((action) => action.name),
      ['wag', 'tailpet', 'pat', 'hop', 'blink', 'talk', 'mouth'],
      'name 必须是 rig 认识的手势 id，不能是中文文案',
    );
    assert.equal(groups[0].actions[0].label, '摇尾巴');
  });

  test('宿主应用命令（separator / resize / recenter / hide / quit）与重复项被丢掉', () => {
    const groups = skinMenuGroups(['mouth', 'separator', 'resize', 'recenter', 'hide', 'quit', 'mouth', 'MOUTH']);
    assert.deepEqual(
      groups[0].actions.map((action) => action.name),
      ['mouth'],
      '应用命令不是动作，重复手势只留第一次',
    );
  });

  test('没有任何可播条目 → 空数组（菜单里不出现空的「动作」）', () => {
    assert.deepEqual(skinMenuGroups([]), []);
    assert.deepEqual(skinMenuGroups(['separator', 'resize', 'quit']), []);
  });
});

describe('model3ActionGroups —— model3 的 Motions / Expressions', () => {
  test('motion 组逐组展开，多条目用「组名 序号」区分', () => {
    const groups = model3ActionGroups({
      FileReferences: {
        Motions: {
          Idle: [{ File: 'Animation/IDLE.motion3.json' }],
          TapBody: [{ File: 'a.json' }, { File: 'b.json' }],
          Broken: 'not-an-array',
        },
      },
    });
    assert.equal(groups.length, 2, '非数组的组要被跳过');
    assert.deepEqual(groups[0], { label: 'Idle', actions: [{ label: 'Idle', name: 'motion:Idle:0' }] });
    assert.deepEqual(groups[1].actions, [
      { label: 'TapBody 1', name: 'motion:TapBody:0' },
      { label: 'TapBody 2', name: 'motion:TapBody:1' },
    ]);
  });

  test('Expressions 不进「动作」：表情是挂着的状态，归「外观」子菜单', () => {
    const raw = {
      FileReferences: {
        Motions: { Idle: [{ File: 'Animation/IDLE.motion3.json' }] },
        Expressions: [{ Name: '脸红', File: 'a.exp3.json' }, { File: 'b.exp3.json' }],
      },
    };
    assert.deepEqual(
      model3ActionGroups(raw).map((group) => group.label),
      ['Idle'],
      '动作树里只留 motion 组',
    );
    assert.deepEqual(model3Expressions(raw), ['脸红'], '缺 Name 的表情跳过，其余留给外观菜单');
  });

  test('未声明 / 坏形状 → 空数组（DeepSeek 公皮就是这一种）', () => {
    assert.deepEqual(model3ActionGroups({ Version: 3, FileReferences: { Moc: 'a.moc3' } }), []);
    assert.deepEqual(model3ActionGroups({ FileReferences: { Motions: {} } }), []);
    assert.deepEqual(model3ActionGroups(null), []);
    assert.deepEqual(model3Expressions({ FileReferences: {} }), []);
  });
});

describe('rendererActionTree —— 动作树形状', () => {
  test('只有一组：条目直接摊在「动作」下', () => {
    const tree = rendererActionTree(skinMenuGroups(['blink', 'mouth']));
    assert.deepEqual(tree, [
      {
        label: '动作',
        children: [
          { label: '眨个眼', action: 'renderer-action', rendererAction: 'blink' },
          { label: '张个嘴', action: 'renderer-action', rendererAction: 'mouth' },
        ],
      },
    ]);
  });

  test('多组：每组一个子菜单（live2d 的多组 motion）', () => {
    const tree = rendererActionTree(
      model3ActionGroups({
        FileReferences: {
          Motions: {
            TapBody: [{ File: 'a.json' }],
            Idle: [{ File: 'b.json' }, { File: 'c.json' }],
          },
        },
      }),
    );
    assert.deepEqual(tree, [
      {
        label: '动作',
        children: [
          {
            label: 'TapBody',
            children: [{ label: 'TapBody', action: 'renderer-action', rendererAction: 'motion:TapBody:0' }],
          },
          {
            label: 'Idle',
            children: [
              { label: 'Idle 1', action: 'renderer-action', rendererAction: 'motion:Idle:0' },
              { label: 'Idle 2', action: 'renderer-action', rendererAction: 'motion:Idle:1' },
            ],
          },
        ],
      },
    ]);
  });

  test('空组与空标签被剔掉，全空时返回空数组', () => {
    assert.deepEqual(rendererActionTree([{ label: '空组', actions: [] }]), []);
    assert.deepEqual(rendererActionTree([{ label: '坏标签', actions: [{ label: ' ', name: 'blink' }] }]), []);
  });
});

describe('actionMenuTree —— 按渲染方式选树', () => {
  test('webm 走动画池，渲染器动作组一概不读', () => {
    const tree = actionMenuTree('webm', animations, skinMenuGroups(['blink']));
    assert.deepEqual(tree, [
      {
        label: '动作',
        children: [
          { label: '待机', children: [{ label: '待机呼吸', anim: '待机呼吸' }] },
          { label: '点击回应', children: [{ label: '点击回应-开心', anim: '点击回应-开心' }] },
        ],
      },
    ]);
  });

  test('layered 走皮肤手势，不再混入 webm 动画池', () => {
    const tree = actionMenuTree('layered', animations, skinMenuGroups(['pat', 'wag']));
    assert.deepEqual(tree, [
      {
        label: '动作',
        children: [
          { label: '摸摸头', action: 'renderer-action', rendererAction: 'pat' },
          { label: '摇尾巴', action: 'renderer-action', rendererAction: 'wag' },
        ],
      },
    ]);
  });

  test('live2d 未声明动作 → 没有「动作」树（只留渲染方式与模型）', () => {
    assert.deepEqual(actionMenuTree('live2d', animations, []), []);
  });
});
