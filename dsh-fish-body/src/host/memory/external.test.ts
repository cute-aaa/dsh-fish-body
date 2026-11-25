/**
 * 外部记忆目录的契约：只认像记忆的文件、时间只从文件名与字段取、注入带「可能过时」的边界。
 *
 * 这些行为决定模型的每一句话会不会拿旧事当现状，所以逐条钉住；纯读盘 + 纯字符串，不碰网络。
 * @module dsh-fish-body/src/host/memory/external.test
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createExternalMemoryProvider, dateOfName, memoryPromptOf, readMemoryNotes } from './external.ts';

const ROOT = mkdtempSync(join(tmpdir(), 'ext-memory-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));

let seq = 0;
/** 每个用例一个干净目录。 */
function tempDir(): string {
  seq += 1;
  const dir = join(ROOT, 'case' + String(seq));
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('dateOfName', () => {
  test('认 2026-11-25 与 20261125 两种写法', () => {
    assert.equal(dateOfName('2026-11-25.md'), new Date(2026, 10, 25).getTime());
    assert.equal(dateOfName('memory-20261125.md'), new Date(2026, 10, 25).getTime());
  });

  test('认不出时返回 undefined（不瞎猜）', () => {
    assert.equal(dateOfName('notes.md'), undefined);
    assert.equal(dateOfName('v1.2.3'), undefined);
  });
});

describe('readMemoryNotes', () => {
  test('md 整份算一条，日期取文件名', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, '2026-11-24.md'), '- 主人做了开源剥离\n', 'utf8');
    const { notes, skipped } = await readMemoryNotes(dir);
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.text, '- 主人做了开源剥离');
    assert.equal(notes[0]?.at, new Date(2026, 10, 24).getTime());
    assert.deepEqual(skipped, []);
  });

  test('memory/ 子目录也被读到（rofm 的归档布局）', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'memory'), { recursive: true });
    writeFileSync(join(dir, 'memory', '2026-11-20.md'), '换了分层皮肤', 'utf8');
    const { notes } = await readMemoryNotes(dir);
    assert.equal(notes.length, 1);
    assert.ok(notes[0]?.path.includes('memory'));
  });

  test('settings.json 这类设置文件被跳过，不混进记忆', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ threshold: 0.6 }), 'utf8');
    writeFileSync(join(dir, '2026-11-24.md'), '真记忆', 'utf8');
    const { notes } = await readMemoryNotes(dir);
    assert.deepEqual(
      notes.map((note) => note.text),
      ['真记忆'],
    );
  });

  test('JSON 数组与含 messages 的对象都能读，条目时间取 ts', async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, 'a.json'),
      JSON.stringify([
        { content: '第一条', ts: new Date(2026, 10, 1).getTime() },
        { text: '第二条', ts: new Date(2026, 10, 2).getTime() },
        { nothing: true },
      ]),
      'utf8',
    );
    writeFileSync(
      join(dir, 'b.json'),
      JSON.stringify({ messages: [{ role: 'user', content: '对象里的消息', ts: new Date(2026, 10, 3).getTime() }] }),
      'utf8',
    );
    const { notes } = await readMemoryNotes(dir);
    assert.deepEqual(
      notes.map((note) => note.text),
      ['第一条', '第二条', '对象里的消息'],
    );
    assert.equal(notes[2]?.at, new Date(2026, 10, 3).getTime());
  });

  test('坏 JSON 不影响其它文件（跳过而不是整体失败）', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'bad.json'), '{ 不是 json', 'utf8');
    writeFileSync(join(dir, '2026-11-24.md'), '好记忆', 'utf8');
    const { notes, skipped } = await readMemoryNotes(dir);
    assert.deepEqual(
      notes.map((note) => note.text),
      ['好记忆'],
    );
    assert.deepEqual(skipped, [], '坏 json 解析成空数组，不算 unreadable');
  });

  test('超过 512 KiB 的文件进 skipped(too-large)', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, '2026-11-24.md'), 'x'.repeat(512 * 1024 + 1), 'utf8');
    const { notes, skipped } = await readMemoryNotes(dir);
    assert.deepEqual(notes, []);
    assert.deepEqual(
      skipped.map((item) => item.reason),
      ['too-large'],
    );
  });

  test('结果按时间升序（旧 → 新）', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, '2026-11-25.md'), '新', 'utf8');
    writeFileSync(join(dir, '2026-11-20.md'), '旧', 'utf8');
    const { notes } = await readMemoryNotes(dir);
    assert.deepEqual(
      notes.map((note) => note.text),
      ['旧', '新'],
    );
  });

  test('目录不存在 → 空结果，不抛', async () => {
    const result = await readMemoryNotes(join(ROOT, 'nope'));
    assert.deepEqual(result, { notes: [], skipped: [] });
  });

  test('没有日期文件名时用 mtime 兜底（不乱排序）', async () => {
    const dir = tempDir();
    const older = join(dir, 'a.md');
    const newer = join(dir, 'b.md');
    writeFileSync(older, '早写的', 'utf8');
    writeFileSync(newer, '晚写的', 'utf8');
    utimesSync(older, new Date(2026, 10, 1), new Date(2026, 10, 1));
    utimesSync(newer, new Date(2026, 10, 5), new Date(2026, 10, 5));
    const { notes } = await readMemoryNotes(dir);
    assert.deepEqual(
      notes.map((note) => note.text),
      ['早写的', '晚写的'],
    );
  });
});

describe('memoryPromptOf', () => {
  const notes = [
    { path: 'a', at: new Date(2026, 10, 20).getTime(), text: '旧事一' },
    { path: 'b', at: new Date(2026, 10, 24).getTime(), text: '旧事二' },
  ];

  test('带「可能过时、以当前为准」的边界声明', () => {
    const text = memoryPromptOf(notes);
    assert.ok(text.includes('【长期记忆】'));
    assert.ok(text.includes('可能已经过时'));
    assert.ok(text.includes('以当前为准'));
  });

  test('每条带日期前缀，按时间从早到晚', () => {
    const text = memoryPromptOf(notes);
    assert.ok(text.indexOf('2026-11-20：旧事一') > 0);
    assert.ok(text.indexOf('2026-11-20：旧事一') < text.indexOf('2026-11-24：旧事二'));
  });

  test('超预算时丢最旧的、留最新的一条', () => {
    const text = memoryPromptOf(notes, 12);
    assert.equal(text.includes('旧事一'), false, '旧的被丢掉');
    assert.ok(text.includes('旧事二'), '最新的一条必须保留');
  });

  test('没有记忆 → 空串（调用方据此不注入）', () => {
    assert.equal(memoryPromptOf([]), '');
  });
});

describe('createExternalMemoryProvider', () => {
  const input = (system: string) => ({ petId: 'main', system, history: [], userText: '在吗' });

  test('recall 把记忆追加到 system 末尾，不改人设本身', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, '2026-11-24.md'), '主人做过开源剥离', 'utf8');
    const provider = createExternalMemoryProvider({ id: 'rofm', dir });
    const patch = await provider.recall?.(input('你是鱼生。'));
    assert.ok(patch?.system?.startsWith('你是鱼生。'), '人设原样保留在开头');
    assert.ok(patch?.system?.includes('主人做过开源剥离'));
    assert.equal(patch?.history, undefined, '不动历史');
    assert.equal(patch?.userText, undefined, '不动本轮问题');
  });

  test('目录空 / 不存在 → 返回 undefined（等同不介入）', async () => {
    const dir = tempDir();
    const provider = createExternalMemoryProvider({ id: 'rofm', dir });
    assert.equal(await provider.recall?.(input('人设')), undefined);
  });

  test('缓存生效：改文件后不 invalidate 读到的还是旧的，invalidate 之后才是新的', async () => {
    const dir = tempDir();
    const file = join(dir, '2026-11-24.md');
    writeFileSync(file, '旧内容', 'utf8');
    const provider = createExternalMemoryProvider({ id: 'rofm', dir });
    const first = await provider.recall?.(input('人设'));
    assert.ok(first?.system?.includes('旧内容'));
    writeFileSync(file, '新内容', 'utf8');
    const cached = await provider.recall?.(input('人设'));
    assert.ok(cached?.system?.includes('旧内容'), 'TTL 内仍读缓存');
    provider.invalidate();
    const fresh = await provider.recall?.(input('人设'));
    assert.ok(fresh?.system?.includes('新内容'));
  });

  test('system 为空时只给记忆段（不产生前导换行）', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, '2026-11-24.md'), '一条记忆', 'utf8');
    const provider = createExternalMemoryProvider({ id: 'rofm', dir });
    const patch = await provider.recall?.(input(''));
    assert.ok(patch?.system?.startsWith('【长期记忆】'));
  });
});
