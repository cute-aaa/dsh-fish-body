/**
 * 对话动作联动的纯逻辑测试：名单范围、注入提示词的文案、回复标记的解析。
 *
 * 三条契约：
 *   1. 名单只取 `animations.categories`，待机 / 转向 / 拖拽 / 点击 / 移动 / 事件动画一律不进；
 *   2. 指令与配图同句式（可选、按语境挑、没有合适的就不写），并且把每个名字都列出来；
 *   3. 解析剥掉所有动作标记（无效名称也剥），只采纳白名单内第一个。
 *
 * 用 Node 内置 test runner（node:test），不引入任何 npm 依赖。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  actionInstruction,
  chatActionList,
  chatActionNames,
  extractChatAction,
  extractChatExpression,
  expressionInstruction,
} from './chat-action.ts';

/** 与 assets/config.jsonc 同形状的最小动画配置：categories 之外还有各种不该进名单的池 */
const ANIMATIONS = {
  idle: ['待机呼吸休闲'],
  turn: ['东张西望'],
  drag: ['被鼠标拖拽悬空反馈'],
  clicks: ['点击回应-开心跃动', '点击回应-害羞惊讶'],
  moves: {
    default: { minDist: 60, maxDist: 240 },
    actions: [{ name: '原地漂浮踏步' }, { name: '螃蟹走路' }],
  },
  categories: [
    { id: '玩魔方', actions: ['原地专心玩魔方'] },
    { id: '文字类', noMirror: true, actions: ['举牌文字'] },
  ],
  events: {
    balance: ['看钱包'],
    whisper: ['深度思考碎碎念'],
    workStatus: [['档位0-A', '档位0-B'], '档位1'],
  },
};

describe('chatActionNames —— 对话联动的动作范围（只有 categories）', () => {
  test('取 categories 下全部动作，去重且保持配置顺序', () => {
    const names = chatActionNames({
      idle: ['待机'],
      categories: [
        { id: 'A', actions: ['甲', '乙'] },
        { id: 'B', actions: ['乙', '丙'] },
      ],
      events: { whisper: ['碎碎念'] },
    });
    assert.deepEqual(names, ['甲', '乙', '丙']);
  });

  test('不含待机 / 转向 / 拖拽 / 点击 / 移动 / 事件动画', () => {
    const names = chatActionNames(ANIMATIONS);
    for (const excluded of [
      '待机呼吸休闲',
      '东张西望',
      '被鼠标拖拽悬空反馈',
      '点击回应-开心跃动',
      '原地漂浮踏步',
      '看钱包',
      '深度思考碎碎念',
    ]) {
      assert.equal(names.includes(excluded), false, excluded + ' 不应进入对话动作范围');
    }
    assert.deepEqual(names, ['原地专心玩魔方', '举牌文字']);
  });

  test('非法输入 → 空名单（不抛错，开关关闭时的实际路径）', () => {
    for (const bad of [
      undefined,
      null,
      'x',
      42,
      {},
      { categories: 'oops' },
      { categories: [null, 1, { actions: 'x' }] },
    ]) {
      assert.deepEqual(chatActionNames(bad), []);
    }
  });
});

describe('actionInstruction —— 注入 user 正文的动作指令', () => {
  test('与配图同句式：可选、按语境挑、没有合适的就不写', () => {
    const text = actionInstruction(['优雅女仆舞']);
    assert.ok(text.includes('[动作]'), '必须有 [动作] 段');
    assert.ok(text.includes('挑最贴合当前语境的'), '要按语境挑，不是随机抽');
    assert.ok(text.includes('没有合适的就完全不要写这个标记'), '不强选');
  });

  test('每个名字各占一行（与配图清单同款）', () => {
    const names = ['优雅女仆舞', '原地小憩沉眠'];
    const text = actionInstruction(names);
    for (const name of names) assert.ok(text.includes('- ' + name), '清单里缺 ' + name);
    assert.equal(text.split('\n').filter((line) => line.startsWith('- ')).length, names.length);
  });

  test('标记格式与解析一致：另起一行写 [动作:名称]', () => {
    const text = actionInstruction(['优雅女仆舞']);
    assert.ok(text.includes('[动作:名称]'));
    assert.ok(text.includes('名称原样照抄'));
  });
});

describe('extractChatAction —— 动作标记的采纳与剥离', () => {
  const NAMES = ['优雅女仆舞', '原地小憩沉眠', '轻快摇摆舞'];

  test('命中 → 剥掉标记、返回动作名', () => {
    const r = extractChatAction('好呀～看我转一圈！\n[动作:轻快摇摆舞]', NAMES);
    assert.equal(r.text, '好呀～看我转一圈！');
    assert.equal(r.action, '轻快摇摆舞');
  });

  test('全角冒号与名称前后空白都能识别', () => {
    assert.equal(extractChatAction('好的\n[动作：优雅女仆舞]', NAMES).action, '优雅女仆舞');
    assert.equal(extractChatAction('好的\n[动作:  原地小憩沉眠  ]', NAMES).action, '原地小憩沉眠');
  });

  test('名称不在白名单 → 剥掉标记但不采纳（不把标记露给用户）', () => {
    const r = extractChatAction('好的\n[动作:自创动作]', NAMES);
    assert.equal(r.action, undefined);
    assert.equal(r.text, '好的');
  });

  test('多个标记 → 只采纳白名单内第一个，其余全剥', () => {
    const r = extractChatAction('嗯\n[动作:不存在]\n[动作:优雅女仆舞]\n[动作:轻快摇摆舞]', NAMES);
    assert.equal(r.action, '优雅女仆舞');
    assert.equal(r.text.includes('[动作'), false);
  });

  test('无标记 → 原样返回（不动正文）', () => {
    const r = extractChatAction('嗯嗯，我明白了', NAMES);
    assert.equal(r.text, '嗯嗯，我明白了');
    assert.equal(r.action, undefined);
  });

  test('只写标记没有正文 → 文本为空（调用方据此不弹气泡）', () => {
    const r = extractChatAction('[动作:优雅女仆舞]', NAMES);
    assert.equal(r.text, '');
    assert.equal(r.action, '优雅女仆舞');
  });

  test('空名单 → 标记照剥但不采纳（开关关闭时的路径）', () => {
    const r = extractChatAction('好的\n[动作:优雅女仆舞]', []);
    assert.equal(r.action, undefined);
    assert.equal(r.text, '好的');
  });
});

describe('chatActionList —— webm 动作池与 live2d 动作 label 合并', () => {
  test('两套名单拼接、保持各自顺序、重名只留一个', () => {
    const names = chatActionList({ categories: [{ id: 'a', actions: ['跳舞'] }] }, ['抬手打招呼', '跳舞', '眨眼']);
    assert.deepEqual(names, ['跳舞', '抬手打招呼', '眨眼']);
  });

  test('没有 live2d 清单时与 chatActionNames 完全一致', () => {
    assert.deepEqual(chatActionList(ANIMATIONS), chatActionNames(ANIMATIONS));
    assert.deepEqual(chatActionList(ANIMATIONS, []), chatActionNames(ANIMATIONS));
  });
});

describe('外观联动 —— 指令与解析', () => {
  const EXPRESSIONS = ['兔牙', '单片眼镜'];

  test('指令列出全部外观名，并明确「一条回复最多写一个」', () => {
    const text = expressionInstruction(EXPRESSIONS);
    assert.ok(text.includes('- 兔牙') && text.includes('- 单片眼镜'));
    assert.ok(text.includes('[外观:名称]'));
    assert.ok(text.includes('覆盖'), '必须写清覆盖语义，否则模型会连着写好几个');
  });

  test('解析：剥掉标记、只采纳白名单内第一个', () => {
    const r = extractChatExpression('给你看个东西\n[外观:兔牙]', EXPRESSIONS);
    assert.equal(r.text, '给你看个东西');
    assert.equal(r.expression, '兔牙');
  });

  test('白名单外的名字：标记同样剥掉，但不采纳', () => {
    const r = extractChatExpression('嘿嘿\n[外观:不存在的]', EXPRESSIONS);
    assert.equal(r.text, '嘿嘿');
    assert.equal(r.expression, undefined);
  });

  test('空名单：标记照剥不采纳；无标记时正文原样', () => {
    assert.equal(extractChatExpression('好\n[外观:兔牙]', []).text, '好');
    assert.equal(extractChatExpression('好\n[外观:兔牙]', []).expression, undefined);
    const plain = extractChatExpression('没有任何标记', EXPRESSIONS);
    assert.equal(plain.text, '没有任何标记');
    assert.equal(plain.expression, undefined);
  });
});
