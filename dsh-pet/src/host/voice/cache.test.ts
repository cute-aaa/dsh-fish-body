/**
 * 语音缓存的行为测试（src/host/voice/cache.ts）。
 * 用真实临时目录与真实 fs：这个模块的价值就在文件行为。每个用例自建目录，互不干扰。
 */
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cacheKey, cachePath, ensureCacheDir, findCachedClip, pruneCache } from './cache.ts';

/** 在一个独立临时目录里跑用例，结束后清理。 */
async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-cache-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('cacheKey：同输入稳定，来源/音色/语速/文本任一不同即不同', () => {
  const base = cacheKey('edge', 'zh-CN-XiaoxiaoNeural', '+0%', '你好');
  assert.equal(base, cacheKey('edge', 'zh-CN-XiaoxiaoNeural', '+0%', '你好'), '同输入必须稳定');
  assert.notEqual(base, cacheKey('my-tts', 'zh-CN-XiaoxiaoNeural', '+0%', '你好'), '换实现不能命中旧音频');
  assert.notEqual(base, cacheKey('edge', 'zh-CN-YunxiNeural', '+0%', '你好'));
  assert.notEqual(base, cacheKey('edge', 'zh-CN-XiaoxiaoNeural', '+10%', '你好'));
  assert.notEqual(base, cacheKey('edge', 'zh-CN-XiaoxiaoNeural', '+0%', '你好 '), '空格不归一化');
});

test('cachePath：固定落在 userRoot/voice-cache 下，扩展名由格式决定', () => {
  assert.equal(cachePath(join('root'), 'abc', 'mp3'), join('root', 'voice-cache', 'abc.mp3'));
  assert.equal(cachePath(join('root'), 'abc', 'wav'), join('root', 'voice-cache', 'abc.wav'));
});

test('findCachedClip：任一已知扩展名命中即返回文件与 mime，空文件不算命中', () =>
  withDir(async (dir) => {
    assert.equal(await findCachedClip(dir, 'k'), undefined, '什么都没有时未命中');
    const cacheDir = await ensureCacheDir(dir);
    await writeFile(join(cacheDir, 'k.mp3'), Buffer.alloc(0));
    assert.equal(await findCachedClip(dir, 'k'), undefined, '0 字节文件不算命中');
    await writeFile(join(cacheDir, 'k.wav'), Buffer.alloc(4));
    assert.deepEqual(await findCachedClip(dir, 'k'), { file: join(cacheDir, 'k.wav'), mime: 'audio/wav' });
  }));

test('ensureCacheDir：目录不存在时创建，重复调用不报错', () =>
  withDir(async (dir) => {
    const created = await ensureCacheDir(dir);
    assert.equal(created, join(dir, 'voice-cache'));
    await ensureCacheDir(dir);
  }));

test('pruneCache：超过条数上限时从最旧的开始删', () =>
  withDir(async (dir) => {
    for (const [index, name] of ['a.mp3', 'b.mp3', 'c.mp3'].entries()) {
      const file = join(dir, name);
      await writeFile(file, Buffer.alloc(10));
      const stamp = new Date(2026, 0, 1 + index);
      await utimes(file, stamp, stamp);
    }
    const removed = await pruneCache(dir, { maxFiles: 2, maxBytes: 1_000_000 });
    assert.equal(removed, 1, '只删超出上限的那一个');
    const left = await readdir(dir);
    assert.equal(left.includes('a.mp3'), false, '最旧的 a.mp3 应被删掉');
    assert.deepEqual(left.sort(), ['b.mp3', 'c.mp3']);
  }));

test('pruneCache：目录不存在时返回 0 而不是抛错', () =>
  withDir(async (dir) => {
    assert.equal(await pruneCache(join(dir, 'missing')), 0);
  }));
