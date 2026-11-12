/**
 * 播报文本的表情清理（src/host/voice/emoji.ts）：只删表情，句子与标点原样留下。
 *
 * 这条清理只用在「念出来」的链路上（合成前），识别结果不走它。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { stripEmoji } from './emoji.ts';

describe('stripEmoji', () => {
  test('删表情，句子与标点不动', () => {
    assert.equal(stripEmoji('今天真不错🙂'), '今天真不错');
    assert.equal(stripEmoji('OK 😅 let us go'), 'OK let us go', '删完留下的连续空格折成一个');
    assert.equal(stripEmoji('❤️喜欢这个'), '喜欢这个', '变体选择符一起删');
    assert.equal(stripEmoji('第一① 用箭头 → 走'), '第一① 用箭头 → 走', '非表情符号不动');
  });

  test('复合表情整段删掉：ZWJ 家庭、国旗、肤色修饰', () => {
    assert.equal(stripEmoji('一家三口 👨‍👩‍👧 出门'), '一家三口 出门');
    assert.equal(stripEmoji('🇨🇳 中国'), '中国');
    assert.equal(stripEmoji('挥手👋🏽'), '挥手');
  });

  test('纯表情清成空串（调用方据此跳过合成）', () => {
    assert.equal(stripEmoji('🙂🙂'), '');
    assert.equal(stripEmoji('   '), '');
  });
});
