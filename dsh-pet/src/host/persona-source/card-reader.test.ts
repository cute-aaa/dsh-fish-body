/**
 * 人设卡读取与投影单元测试：钉住 SillyTavern v2 卡的解析、占位符替换与 PNG tEXt 解包。
 * @module dsh-pet/src/host/persona-source/card-reader.test
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCard, projectCard, readCardFile } from './card-reader.ts';

/** 一份含占位符、空字段与收尾指令的 SillyTavern v2 卡。 */
const CARD = {
  spec: 'chara_card_v2',
  data: {
    name: '鱼生',
    description: '{{char}}是一只蓝色大肥鱼。',
    personality: '慵懒、贪吃',
    scenario: '桌面宠物',
    first_mes: '{{user}}，今天想吃什么？',
    mes_example: '<START>\n{{user}}: 你好\n{{char}}: 咕噜咕噜',
    system_prompt: '',
    post_history_instructions: '不要说自己是 AI。',
  },
};

/** 构造一个带 chara tEXt 块的最小 PNG（CRC 留空，本解析器不校验）。 */
function pngWithCard(card: unknown): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const data = Buffer.concat([
    Buffer.from('chara\0', 'latin1'),
    Buffer.from(Buffer.from(JSON.stringify(card), 'utf8').toString('base64'), 'latin1'),
  ]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const chunk = Buffer.concat([length, Buffer.from('tEXt', 'latin1'), data, Buffer.alloc(4)]);
  const iend = Buffer.concat([Buffer.alloc(4), Buffer.from('IEND', 'latin1'), Buffer.alloc(4)]);
  return Buffer.concat([signature, chunk, iend]);
}

test('projectCard：拼接人设字段并替换 {{char}}/{{user}} 占位符', () => {
  const data = parseCard(JSON.stringify(CARD));
  assert.ok(data, '合法卡必须解析成功');
  const text = projectCard(data);
  assert.match(text, /人设：鱼生是一只蓝色大肥鱼。/);
  assert.match(text, /性格：慵懒、贪吃/);
  assert.match(text, /背景：桌面宠物/);
  assert.match(text, /开场白：主人，今天想吃什么？/);
  assert.match(text, /对话示例：<START>/);
  assert.match(text, /不要说自己是 AI。/);
  assert.doesNotMatch(text, /\{\{char\}\}|\{\{user\}\}/);
});

test('parseCard：spec 不符 / data 缺失 / 非法 JSON → undefined', () => {
  assert.equal(parseCard('不是 json'), undefined);
  assert.equal(parseCard('{"spec":"other"}'), undefined);
  assert.equal(parseCard('{"spec":"chara_card_v2"}'), undefined);
  assert.equal(parseCard('{"spec":"chara_card_v2","data":[]}'), undefined);
});

test('readCardFile：JSON 卡投影成功', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'persona-card-'));
  try {
    const path = join(dir, 'persona.json');
    await writeFile(path, JSON.stringify(CARD), 'utf8');
    const result = await readCardFile(path);
    assert.ok(result.ok);
    assert.match(result.text, /鱼生是一只蓝色大肥鱼/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readCardFile：PNG 卡从 tEXt chara 块解出', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'persona-card-'));
  try {
    const path = join(dir, 'persona.png');
    await writeFile(path, pngWithCard(CARD));
    const result = await readCardFile(path);
    assert.ok(result.ok);
    assert.match(result.text, /鱼生/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readCardFile：文件不存在 → not-found', async () => {
  const result = await readCardFile(join(tmpdir(), 'no-such-card.json'));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'not-found');
});

test('readCardFile：卡片无可用正文 → invalid-card', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'persona-card-'));
  try {
    const path = join(dir, 'empty.json');
    await writeFile(path, JSON.stringify({ spec: 'chara_card_v2', data: {} }), 'utf8');
    const result = await readCardFile(path);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'invalid-card');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
