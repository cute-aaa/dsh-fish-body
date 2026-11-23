/**
 * 对话表演联动的纯逻辑测试：名单范围、注入提示词的文案、回复标记的解析、用户点名的兜底。
 *
 * 四条契约：
 *   1. 名单只取 `animations.categories`（或 live2d 清单），待机 / 转向 / 拖拽 / 点击 / 移动 / 事件动画一律不进；
 *   2. 指令与配图同句式（可选、按语境挑、没有合适的就不写），并且把每个名字都列出来；
 *   3. 解析剥掉所有标记（无效名称也剥），外观采纳**全部**命中项（可多条、可叠加、可摘、可临时）；
 *   4. 用户点名即指令：说到就执行，结算规则见 mergeExpressionsIntent。
 *
 * 用 Node 内置 test runner（node:test），不引入任何 npm 依赖。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  actionFromText,
  actionInstruction,
  chatActionList,
  chatActionNames,
  currentStateInstruction,
  extractChatAction,
  extractChatExpression,
  expressionInstruction,
  expressionsFromText,
  mergeExpressionsIntent,
  parseExpressionTag,
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

describe('expressionsFromText —— 用户原话里的外观指令（确定性兜底）', () => {
  const NAMES = ['单片眼镜', '黑框眼镜', '兔牙', '圈圈眼'];

  test('点名就认：「戴上单片眼镜」→ 只要它', () => {
    assert.deepEqual(expressionsFromText('戴上单片眼镜给我看看', NAMES).names, ['单片眼镜']);
  });

  test('缩写按核心词认，同组只取第一个：「戴个眼镜」→ 单片眼镜（不连带黑框眼镜）', () => {
    assert.deepEqual(expressionsFromText('戴个眼镜吧', NAMES).names, ['单片眼镜']);
  });

  test('核心词放开成多组：「戴眼镜和兔牙」→ 两组各取一个', () => {
    // 旧口径只取第一个，于是「和兔牙」被吞掉——用户看到的是「我说了两样，只戴了一样」。
    assert.deepEqual(expressionsFromText('把眼镜和兔牙都戴上', NAMES).names, ['单片眼镜', '兔牙']);
  });

  test('否定/摘除结算成 remove，不结算成「戴上」', () => {
    const one = expressionsFromText('把眼镜摘了', NAMES);
    assert.deepEqual(one.names, []);
    assert.deepEqual(one.remove, ['单片眼镜', '黑框眼镜'], '核心词命中时整组都该摘');
    assert.deepEqual(expressionsFromText('别戴眼镜', NAMES).names, []);
    assert.deepEqual(expressionsFromText('都摘了', NAMES).reset, true);
  });

  test('临时：「戴一下」「临时戴」带 ttl，显式秒数优先', () => {
    assert.equal(expressionsFromText('临时戴个兔牙', NAMES).ttlMs, 30_000);
    assert.equal(expressionsFromText('戴 20 秒眼镜', NAMES).ttlMs, 20_000);
    assert.equal(expressionsFromText('戴上兔牙', NAMES).ttlMs, undefined);
  });

  test('叠加：「再戴个兔牙」是加，不是换', () => {
    assert.equal(expressionsFromText('顺便再戴个兔牙', NAMES).additive, true);
    assert.equal(expressionsFromText('戴上兔牙', NAMES).additive, false);
  });

  test('没点名就不认；一次最多 6 个', () => {
    assert.deepEqual(expressionsFromText('今天好累', NAMES).names, []);
    const many = expressionsFromText('单片眼镜 黑框眼镜 兔牙 圈圈眼 全都要', NAMES);
    assert.ok(many.names.length <= 6);
  });
});

describe('parseExpressionTag —— 标记语法（多写 / 叠加 / 摘单个 / 摘光 / 临时）', () => {
  const NAMES = ['单片眼镜', '兔牙', '圈圈眼'];

  test('多写：顿号、逗号、空格、和/与 都能分隔', () => {
    assert.deepEqual(parseExpressionTag('兔牙、单片眼镜', NAMES).names, ['兔牙', '单片眼镜']);
    assert.deepEqual(parseExpressionTag('兔牙,单片眼镜', NAMES).names, ['兔牙', '单片眼镜']);
    assert.deepEqual(parseExpressionTag('兔牙和单片眼镜', NAMES).names, ['兔牙', '单片眼镜']);
  });

  test('叠加与摘单个：+ / - 前缀', () => {
    const add = parseExpressionTag('+兔牙', NAMES);
    assert.equal(add.additive, true);
    assert.deepEqual(add.names, ['兔牙']);
    const drop = parseExpressionTag('-兔牙', NAMES);
    assert.deepEqual(drop.remove, ['兔牙']);
    assert.deepEqual(drop.names, []);
  });

  test('摘光与动词写法', () => {
    assert.equal(parseExpressionTag('摘掉', NAMES).reset, true);
    assert.deepEqual(parseExpressionTag('摘眼镜', NAMES).remove, ['单片眼镜']);
  });

  test('临时时长：20s / 2min / 临时，越界夹取', () => {
    assert.equal(parseExpressionTag('兔牙|20s', NAMES).ttlMs, 20_000);
    assert.equal(parseExpressionTag('兔牙| 2min', NAMES).ttlMs, 120_000);
    assert.equal(parseExpressionTag('兔牙|临时', NAMES).ttlMs, 30_000);
    assert.equal(parseExpressionTag('兔牙|0.2s', NAMES).ttlMs, 1_000, '下界夹到 1 秒');
  });

  test('对不上白名单的名字不采纳（宁可不动，也不要戴错）', () => {
    const r = parseExpressionTag('帽子', NAMES);
    assert.deepEqual(r.names, []);
    assert.equal(r.reset, false);
  });
});

describe('mergeExpressionsIntent —— 意图结算成「最终挂着的那批」', () => {
  test('不叠加就整批替换（既有语义不变）', () => {
    assert.deepEqual(
      mergeExpressionsIntent(['单片眼镜'], { names: ['兔牙'], remove: [], reset: false, additive: false }),
      ['兔牙'],
    );
  });

  test('叠加是在当前之上加', () => {
    assert.deepEqual(
      mergeExpressionsIntent(['单片眼镜'], { names: ['兔牙'], remove: [], reset: false, additive: true }),
      ['单片眼镜', '兔牙'],
    );
  });

  test('只摘单个：其余保留；摘光：清空', () => {
    assert.deepEqual(
      mergeExpressionsIntent(['单片眼镜', '兔牙'], { names: [], remove: ['兔牙'], reset: false, additive: false }),
      ['单片眼镜'],
    );
    assert.deepEqual(mergeExpressionsIntent(['单片眼镜'], { names: [], remove: [], reset: true, additive: false }), []);
  });

  test('什么都没提到就不动（空意图 = 保持当前）', () => {
    assert.deepEqual(mergeExpressionsIntent(['兔牙'], { names: [], remove: [], reset: false, additive: false }), [
      '兔牙',
    ]);
  });
});

describe('actionFromText —— 用户点名动作直接播', () => {
  const ACTIONS = ['抚胸手打开', '竖手指打开', '脱捕'];

  test('点名就认；清单名比用户说法长时按核心词认', () => {
    assert.equal(actionFromText('给我演个抚胸手打开', ACTIONS), '抚胸手打开');
    assert.equal(actionFromText('做个抚胸手', ACTIONS), '抚胸手打开');
    assert.equal(actionFromText('脱捕一下', ACTIONS), '脱捕');
  });

  test('没点名 / 否定句都不动', () => {
    assert.equal(actionFromText('今天好累', ACTIONS), undefined);
    assert.equal(actionFromText('别做抚胸手', ACTIONS), undefined);
  });
});

describe('currentStateInstruction —— 「你现在挂着什么」', () => {
  test('有外观有动作：两个都说', () => {
    const text = currentStateInstruction({ expressions: ['兔牙', '单片眼镜'], action: '抚胸手打开' });
    assert.ok(text.includes('兔牙、单片眼镜'));
    assert.ok(text.includes('抚胸手打开'));
  });

  test('全空：明说「什么都没戴」，并给出可以自己动手的口径', () => {
    const text = currentStateInstruction({});
    assert.ok(text.includes('什么都没戴'));
    assert.ok(text.includes('直接写标记'));
    assert.ok(!text.includes('上一段动作'));
  });
});

describe('外观联动 —— 指令与解析', () => {
  const EXPRESSIONS = ['兔牙', '单片眼镜'];

  test('指令列出全部外观名，并把整套写法讲全（多写 / 叠加 / 摘单个 / 摘光 / 临时）', () => {
    const text = expressionInstruction(EXPRESSIONS);
    assert.ok(text.includes('- 兔牙') && text.includes('- 单片眼镜'));
    assert.ok(text.includes('[外观:名称]'));
    assert.ok(text.includes('[外观:名称、名称]'), '要给出多写的写法');
    assert.ok(text.includes('[外观:+名称]'), '要给出叠加的写法');
    assert.ok(text.includes('[外观:-名称]'), '要给出摘单个的写法');
    assert.ok(text.includes('[外观:摘掉]'), '要给出摘光的写法');
    assert.ok(text.includes('[外观:名称|20s]'), '要给出临时的写法');
  });

  test('解析：剥掉标记、采纳白名单内**全部**名字（一次可挂多个）', () => {
    const r = extractChatExpression('给你看个东西\n[外观:兔牙]\n[外观:单片眼镜]', EXPRESSIONS);
    assert.equal(r.text, '给你看个东西');
    assert.deepEqual(r.intent.names, ['兔牙', '单片眼镜']);
  });

  test('标记里一次写两个也行；同名重复只留一个', () => {
    const r = extractChatExpression('[外观:兔牙、单片眼镜]\n[外观:兔牙]', EXPRESSIONS);
    assert.deepEqual(r.intent.names, ['兔牙', '单片眼镜']);
  });

  test('白名单外的名字剥掉但不采纳；空名单照剥', () => {
    const r = extractChatExpression('[外观:兔牙]\n[外观:不存在的]', EXPRESSIONS);
    assert.deepEqual(r.intent.names, ['兔牙']);
    const empty = extractChatExpression('好\n[外观:兔牙]', []);
    assert.equal(empty.text, '好');
    assert.deepEqual(empty.intent.names, []);
  });

  test('临时与摘光也走同一条解析', () => {
    const temp = extractChatExpression('[外观:兔牙|15s]', EXPRESSIONS);
    assert.equal(temp.intent.ttlMs, 15_000);
    assert.deepEqual(temp.intent.names, ['兔牙']);
    const reset = extractChatExpression('[外观:摘掉]', EXPRESSIONS);
    assert.equal(reset.intent.reset, true);
  });

  test('无标记时正文原样、意图为空', () => {
    const plain = extractChatExpression('没有任何标记', EXPRESSIONS);
    assert.equal(plain.text, '没有任何标记');
    assert.deepEqual(plain.intent.names, []);
    assert.equal(plain.intent.reset, false);
  });
});
