/**
 * 「soul 是灵魂、本项目是身体」这条分工的兼容面实测：拿四个已被注册的 soul 来源 id，
 * 按各自项目**已知的产物形态**造目录，看本项目的扫描能不能认出来。
 *
 * 形态依据（2026-11-25 查到的公开描述，未在真实项目上跑过）：
 * - `fish-soul`（Britneycode/dsh-fish-soul）→ 单角色，SillyTavern v2 卡 `persona.json`（本项目唯一实证过的形态）
 * - `dsh-soul`（kagura-chen/dsh-soul）→ 一组 Markdown：SOUL / IDENTITY / USER / AGENTS / MEMORY
 * - `dsh-soul-md`（Scorp1o117/dsh-soul-md）→ `Soul.md`（名字即格式）
 * - `dsh-rofm`（wall1234567/dsh-rofm）→ 长期记忆插件，产物是 `memory/` 归档，不是人设
 * - `dsh-suzu-memory`（eryucheng/dsh-suzu-memory）→ 记忆 + persona 设置，落盘是自己那份设置 JSON
 *
 * 这些测试**锁的是现状**：认得出的形态锁死行为；认不出的形态显式断言「0 角色」，
 * 这样将来补上 Markdown 支持时，失败的那几条会主动提醒改这里。
 * @module dsh-fish-body/src/host/persona-source/soul-projects.test
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createCardFileSource } from './card-file.ts';
import { parseCardBytes, projectCard } from './card-reader.ts';

/** 根临时目录：整个文件共用一个，退出时递归删除。 */
const ROOT = mkdtempSync(join(tmpdir(), 'soul-projects-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));

/** 每用例一个独立子目录（避免互相污染）。 */
function project(name: string): string {
  const dir = join(ROOT, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 一份 SillyTavern v2 卡（fish-soul 的 `persona.json`）。 */
function v2Card(fields: Record<string, string>): string {
  return JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: fields });
}

/** 造一张带 `tEXt chara` 块的最小 PNG 卡（SillyTavern 导出的就是这种）。 */
function pngCard(fields: Record<string, string>): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const base64 = Buffer.from(v2Card(fields), 'utf8').toString('base64');
  const body = Buffer.concat([Buffer.from('chara\0', 'latin1'), Buffer.from(base64, 'latin1')]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const textChunk = Buffer.concat([length, Buffer.from('tEXt', 'latin1'), body, Buffer.alloc(4)]);
  const iend = Buffer.concat([Buffer.alloc(4), Buffer.from('IEND', 'latin1'), Buffer.alloc(4)]);
  return Buffer.concat([signature, textChunk, iend]);
}

describe('soul 来源兼容面：认得出的形态', () => {
  test('fish-soul：persona.json（v2 卡）→ 1 个角色，正文含人设段落', async () => {
    const dir = project('fish-soul');
    writeFileSync(
      join(dir, 'persona.json'),
      v2Card({
        name: '鱼生',
        description: '一条网上冲浪的鱼，嘴贫但靠得住。',
        personality: '皮、爱撒娇',
        scenario: '住在主人桌面上',
      }),
      'utf8',
    );
    const source = createCardFileSource({ id: 'fish-soul', name: 'dsh-fish-soul', dir });
    const probe = await source.probe?.();
    assert.equal(probe?.installed, true, 'fish-soul 的目录约定必须被认成已安装');
    const result = await source.scan?.();
    assert.equal(result?.characters.length, 1);
    assert.equal(result?.characters[0]?.name, '鱼生');
    const text = result?.characters[0]?.text ?? '';
    assert.ok(text.includes('一条网上冲浪的鱼'), 'description 必须进正文');
    assert.ok(text.includes('性格：皮、爱撒娇'), 'personality 带标签进正文');
    assert.ok(text.includes('背景：住在主人桌面上'), 'scenario 带标签进正文');
    assert.deepEqual(result?.skipped, []);
  });

  test('多角色形态：personas/ 下 json 与 png 各一个 → 2 个角色', async () => {
    const dir = project('multi');
    mkdirSync(join(dir, 'personas'), { recursive: true });
    writeFileSync(join(dir, 'personas', 'a.json'), v2Card({ name: '甲', description: '甲的人设' }), 'utf8');
    writeFileSync(join(dir, 'personas', 'b.png'), pngCard({ name: '乙', description: '乙的人设' }));
    const source = createCardFileSource({ id: 'custom', name: '自定义路径', dir, kind: 'custom' });
    const result = await source.scan?.();
    assert.deepEqual(
      [...(result?.characters.map((item) => item.name) ?? [])].sort(),
      ['乙', '甲'].sort(),
      'PNG 卡与 JSON 卡都要扫出来',
    );
  });

  test('PNG 卡：tEXt chara 块解出的字段与 JSON 卡完全一致', async () => {
    const fields = { name: '影卡', description: '来自 PNG 的卡', personality: '安静' };
    const fromPng = parseCardBytes(pngCard(fields));
    const fromJson = parseCardBytes(Buffer.from(v2Card(fields), 'utf8'));
    assert.deepEqual(fromPng, fromJson);
    assert.equal(projectCard(fromPng!), projectCard(fromJson!));
  });

  test('自定义路径：显式指向单个 json 文件也能导入', async () => {
    const dir = project('explicit');
    const file = join(dir, 'one.json');
    writeFileSync(file, v2Card({ name: '单卡', description: '显式路径' }), 'utf8');
    const source = createCardFileSource({ id: 'custom', name: '自定义路径', dir, kind: 'custom' });
    const result = await source.scan?.({ path: file });
    assert.deepEqual(
      result?.characters.map((item) => item.name),
      ['单卡'],
    );
  });
});

describe('soul 来源兼容面：Markdown 人格文档（通用解析器）', () => {
  test('dsh-soul（kagura-chen）：SOUL/IDENTITY/USER/AGENTS/MEMORY.md → 合并成 1 个角色', async () => {
    const dir = project('dsh-soul');
    const files: Record<string, string> = {
      'SOUL.md': '# 灵魂\n\n你是一条住在主人桌面上的鱼，皮、爱撒娇，关键时刻靠得住。\n',
      'IDENTITY.md': '# 身份\n\n名字：鱼生\n自称：本鱼\n称呼用户：主人\n',
      'USER.md': '# 关于主人\n\n习惯熬夜，凌晨两点还在写代码。\n',
      'AGENTS.md': '# 行为规则\n\n不碰主人的文件、账号、聊天记录。\n',
      'MEMORY.md': '# 长期记忆\n\n2026-11-24：主人做了开源剥离。\n',
    };
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text, 'utf8');
    const source = createCardFileSource({ id: 'dsh-soul', name: 'dsh-soul', dir });
    const probe = await source.probe?.();
    assert.equal(probe?.installed, true, '只有 Markdown 也该判成已安装');
    const result = await source.scan?.();
    assert.equal(result?.characters.length, 1, '五份文档合成一个角色，不是五个');
    const character = result?.characters[0];
    assert.equal(character?.name, '鱼生', '名字取 IDENTITY.md 的显式声明');
    assert.equal(character?.path, dir, '来源记目录（多份合成，指着一份是错的）');
    const text = character?.text ?? '';
    // 第一段（SOUL.md）不戴标签，其后各段按文件名带标签
    assert.ok(text.startsWith('你是一条住在主人桌面上的鱼'), 'SOUL.md 是正文开头且不戴标签');
    assert.ok(text.includes('身份：名字：鱼生'), 'IDENTITY.md 带「身份：」');
    assert.ok(text.includes('关于主人：习惯熬夜'), 'USER.md 带「关于主人：」');
    assert.ok(text.includes('规则：不碰主人的文件'), 'AGENTS.md 带「规则：」');
    assert.ok(text.includes('长期记忆：2026-11-24'), 'MEMORY.md 带「长期记忆：」');
    assert.deepEqual(result?.skipped, []);
  });

  test('dsh-soul-md：Soul.md 单文件 → 1 个角色（大小写并存时同内容只留一份）', async () => {
    const dir = project('dsh-soul-md');
    for (const name of ['Soul.md', 'SOUL.md', 'soul.md']) {
      writeFileSync(join(dir, name), '# 鱼生\n\n一条网上冲浪的鱼。\n', 'utf8');
    }
    const source = createCardFileSource({ id: 'dsh-soul', name: 'dsh-soul', dir });
    const result = await source.scan?.();
    assert.equal(result?.characters.length, 1);
    assert.equal(result?.characters[0]?.name, '鱼生', '没有声明时取一级标题');
    const text = result?.characters[0]?.text ?? '';
    assert.equal(text.split('一条网上冲浪的鱼').length - 1, 1, '同一段正文不该拼三遍');
  });

  test('顶层有 persona.json 时不再看顶层 md（两个单角色来源会给出两个身份）', async () => {
    const dir = project('both');
    writeFileSync(join(dir, 'persona.json'), v2Card({ name: '卡片角色', description: '来自 v2 卡' }), 'utf8');
    writeFileSync(join(dir, 'SOUL.md'), '# 文档角色\n\n来自 Markdown\n', 'utf8');
    const source = createCardFileSource({ id: 'custom', name: '自定义路径', dir, kind: 'custom' });
    const result = await source.scan?.();
    assert.deepEqual(
      result?.characters.map((item) => item.name),
      ['卡片角色'],
      'persona.json 优先',
    );
  });

  test('README / LICENSE 这类项目文档不算人格', async () => {
    const dir = project('docs-noise');
    writeFileSync(join(dir, 'README.md'), '# 我的项目\n\n安装说明。\n', 'utf8');
    writeFileSync(join(dir, 'LICENSE.md'), '# MIT\n\n随便用。\n', 'utf8');
    writeFileSync(join(dir, 'SOUL.md'), '# 鱼生\n\n一条鱼。\n', 'utf8');
    const source = createCardFileSource({ id: 'dsh-soul', name: 'dsh-soul', dir });
    const result = await source.scan?.();
    assert.equal(result?.characters.length, 1);
    const text = result?.characters[0]?.text ?? '';
    assert.equal(text.includes('安装说明'), false, 'README 没被并进人设');
    assert.equal(text.includes('随便用'), false, 'LICENSE 没被并进人设');
  });

  test('自定义路径指向单个 .md → 1 个角色', async () => {
    const dir = project('custom-md');
    const file = join(dir, 'Soul.md');
    writeFileSync(file, '# 影\n\n安静的角色。\n', 'utf8');
    const source = createCardFileSource({ id: 'custom', name: '自定义路径', dir, kind: 'custom' });
    const result = await source.scan?.({ path: file });
    assert.deepEqual(
      result?.characters.map((item) => item.name),
      ['影'],
    );
    assert.equal(result?.characters[0]?.path, file);
  });

  test('dsh-rofm：memory/ 归档 + 设置 json → 仍 0 角色（那些不是人格产物）', async () => {
    const dir = project('dsh-rofm');
    mkdirSync(join(dir, 'memory'), { recursive: true });
    writeFileSync(join(dir, 'memory', '2026-11-25.md'), '- 主人今天在写插件\n', 'utf8');
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ threshold: 0.6 }), 'utf8');
    const source = createCardFileSource({ id: 'dsh-rofm', name: 'dsh-rofm', dir });
    const result = await source.scan?.();
    assert.deepEqual(result?.characters, [], '子目录里的记忆归档不是人格');
    assert.equal((await source.probe?.())?.installed, false);
  });

  test('dsh-suzu-memory：自己那份 persona.json 不是 v2 卡 → skipped(invalid-card)', async () => {
    const dir = project('dsh-suzu-memory');
    writeFileSync(
      join(dir, 'persona.json'),
      JSON.stringify({ persona: '你是体贴的助手', compaction: { threshold: 0.8 } }),
      'utf8',
    );
    const source = createCardFileSource({ id: 'dsh-suzu-memory', name: 'dsh-suzu-memory', dir });
    assert.equal((await source.probe?.())?.installed, true, '文件名叫 persona.json 就算装了');
    const result = await source.scan?.();
    assert.deepEqual(result?.characters, []);
    assert.deepEqual(
      result?.skipped.map((item) => item.reason),
      ['invalid-card'],
      '好在会给出 invalid-card，用户能看出「文件在但格式不对」',
    );
  });
});

describe('灵魂侧定义的「作息」能带进提示词的部分', () => {
  test('作息写进 description/scenario → 投影后仍在正文里（模型能读到，但本项目不会按点触发）', () => {
    const card = parseCardBytes(
      Buffer.from(
        v2Card({
          name: '鱼生',
          description: '一条网上冲浪的鱼。',
          scenario: '作息：23:00 上床刷手机，01:00 才睡，早上 09:30 起。夜里困了会打哈欠。',
        }),
        'utf8',
      ),
    );
    const text = projectCard(card!);
    assert.ok(text.includes('23:00'), '作息时刻必须原样进正文');
    assert.ok(text.includes('09:30'));
    assert.ok(text.includes('打哈欠'), '与作息绑定的行为描述同样保留');
  });

  test('作息写在 v2 卡的 extensions / character_book 里 → 被丢弃（本项目不读这两个字段）', () => {
    const raw = JSON.stringify({
      spec: 'chara_card_v2',
      data: {
        name: '鱼生',
        description: '一条网上冲浪的鱼。',
        extensions: { schedule: { sleep: '23:00', wake: '09:30' } },
        character_book: { entries: [{ keys: ['作息'], content: '23:00 睡觉' }] },
      },
    });
    const card = parseCardBytes(Buffer.from(raw, 'utf8'));
    const text = projectCard(card!);
    assert.equal(text.includes('23:00'), false, 'extensions 里的作息进不了正文');
    assert.equal(text.includes('character_book'), false);
    // 这就是「作息能不能同步」的判据：不在 8 个投影字段里的东西，一律丢。
  });
});
