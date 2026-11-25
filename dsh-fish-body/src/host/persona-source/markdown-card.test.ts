/**
 * Markdown 人格文档投影的契约：名字推断的三档优先级、按文件名定语义、正文不重复、同内容去重。
 *
 * 这些行为都会直接影响落库结果（名字会写进 `pets[].name`、正文会成为 system prompt 第一段），
 * 所以逐条钉住；纯函数，不碰磁盘。
 * @module dsh-fish-body/src/host/persona-source/markdown-card.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { isNotPersonaDoc, markdownCardOf, markdownCardOfOne, nameOfDocs } from './markdown-card.ts';

describe('markdownCardOf —— 按文件名定语义', () => {
  test('SOUL.md 是正文开头且不戴标签，其余按文件名带标签', () => {
    const card = markdownCardOf([
      { name: 'AGENTS.md', text: '# 规则\n\n不碰主人的文件。' },
      { name: 'IDENTITY.md', text: '# 身份\n\n名字：鱼生' },
      { name: 'SOUL.md', text: '# 灵魂\n\n一条住在桌面上的鱼。' },
    ]);
    assert.ok(card.description.startsWith('一条住在桌面上的鱼。'));
    assert.ok(card.description.includes('身份：名字：鱼生'));
    assert.ok(card.description.includes('规则：不碰主人的文件。'));
  });

  test('HEARTBEAT.md 折成「作息与节律」，排序：主体 → 规则 → 作息 → 记忆', () => {
    const card = markdownCardOf([
      { name: 'MEMORY.md', text: '# 记忆\n\n2026-11-24 开源剥离。' },
      { name: 'HEARTBEAT.md', text: '# 心跳\n\n23:00 睡，08:00 起。' },
      { name: 'AGENTS.md', text: '# 规则\n\n不传谣。' },
      { name: 'SOUL.md', text: '# 灵魂\n\n主体。' },
    ]);
    const at = (needle: string): number => card.description.indexOf(needle);
    assert.ok(at('主体。') === 0, 'SOUL.md 是开头');
    assert.ok(at('规则：不传谣。') > 0, '规则带标签');
    assert.ok(at('作息与节律') > at('规则：不传谣。'), '作息排在规则之后');
    assert.ok(at('长期记忆：') > at('作息与节律'), '记忆排在作息之后');
  });

  test('认不出的文件名：内容保留、不戴标签、排在最后', () => {
    const card = markdownCardOf([
      { name: 'whatever.md', text: '# 随手写的\n\n一些补充。' },
      { name: 'SOUL.md', text: '# 灵魂\n\n主体。' },
    ]);
    assert.ok(card.description.startsWith('主体。'));
    assert.ok(card.description.includes('一些补充。'));
    assert.equal(card.description.includes('随手写的补充：'), false, '不认识的文件名不编标签');
  });

  test('同内容不同文件名只留第一份（大小写并存 / 复制了一份）', () => {
    const body = '# 鱼生\n\n一条鱼。';
    const card = markdownCardOf([
      { name: 'SOUL.md', text: body },
      { name: 'Soul.md', text: body },
      { name: 'soul.md', text: body },
    ]);
    assert.equal(card.description.split('一条鱼。').length - 1, 1);
  });
});

describe('名字推断 —— 声明 > 标题 > 文件名', () => {
  test('显式声明优先于标题', () => {
    const docs = [{ name: 'IDENTITY.md', text: '# 身份\n\n名字：鱼生' }];
    assert.equal(nameOfDocs(docs), '鱼生');
  });

  test('三种声明写法都认（中英文冒号、带引号、名字是）', () => {
    assert.equal(nameOfDocs([{ name: 'a.md', text: '名字：鱼生' }]), '鱼生');
    assert.equal(nameOfDocs([{ name: 'a.md', text: 'Name: YU' }]), 'YU');
    assert.equal(nameOfDocs([{ name: 'a.md', text: '名字是「糖糖」' }]), '糖糖');
    assert.equal(nameOfDocs([{ name: 'a.md', text: '名称: 阿澈' }]), '阿澈');
  });

  test('声明在任一文档里都算（不限第一份）', () => {
    const docs = [
      { name: 'SOUL.md', text: '# 灵魂\n\n主体。' },
      { name: 'IDENTITY.md', text: '名字：鱼生' },
    ];
    assert.equal(nameOfDocs(docs), '鱼生');
  });

  test('没有声明时取一级标题', () => {
    assert.equal(nameOfDocs([{ name: 'SOUL.md', text: '# 鱼生\n\n一条鱼。' }]), '鱼生');
  });

  test('都没有时退回文件名（去扩展名）', () => {
    assert.equal(nameOfDocs([{ name: 'notitle.md', text: '没有标题也没有声明。' }]), 'notitle');
  });

  test('声明行里的包裹符号会被去掉', () => {
    assert.equal(nameOfDocs([{ name: 'a.md', text: '名字：「鱼生」' }]), '鱼生');
    assert.equal(nameOfDocs([{ name: 'a.md', text: "Name: 'YU'" }]), 'YU');
  });
});

describe('正文清理', () => {
  test('一级标题不重复进正文，二级小节保留', () => {
    const card = markdownCardOfOne('SOUL.md', '# 鱼生\n\n## 说话方式\n\n短句。');
    assert.equal(card.description, '## 说话方式\n\n短句。');
    assert.equal(card.description.includes('# 鱼生'), false);
  });

  test('空文档 / 只有标题的文档 → 正文为空', () => {
    assert.equal(markdownCardOf([{ name: 'a.md', text: '' }]).description, '');
    assert.equal(markdownCardOf([{ name: 'a.md', text: '# 只有标题' }]).description, '');
  });

  test('CRLF 与前后空行不影响结果', () => {
    const card = markdownCardOfOne('SOUL.md', '\r\n\r\n# 鱼生\r\n\r\n一条鱼。\r\n');
    assert.equal(card.description.trim(), '一条鱼。');
  });

  test('其余 7 个字段留空（Markdown 没有 SillyTavern 那套分段）', () => {
    const card = markdownCardOfOne('SOUL.md', '# 鱼生\n\n一条鱼。');
    assert.deepEqual(
      [
        card.personality,
        card.scenario,
        card.first_mes,
        card.mes_example,
        card.system_prompt,
        card.post_history_instructions,
      ],
      ['', '', '', '', '', ''],
    );
  });
});

describe('isNotPersonaDoc —— 项目文档不算人格', () => {
  test('README / LICENSE / CHANGELOG 等被排除', () => {
    for (const name of ['README.md', 'readme.md', 'LICENSE.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md']) {
      assert.equal(isNotPersonaDoc(name), true, name);
    }
  });

  test('人格文档不被排除', () => {
    for (const name of ['SOUL.md', 'Soul.md', 'IDENTITY.md', 'AGENTS.md', 'HEARTBEAT.md', 'USER.md']) {
      assert.equal(isNotPersonaDoc(name), false, name);
    }
  });
});
