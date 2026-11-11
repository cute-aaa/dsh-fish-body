/**
 * GSV 音色扫描的测试（src/host/voice/gsv/voices.ts）。
 *
 * 钉四件事：非 gsv 引擎与缺参考音频的条目被丢弃、ref 能按「音色根上一级」解析、
 * 权重按最高 epoch 挑、`split` 换算成 api_v2 的切句法。
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { rmSync } from 'node:fs';
import { EMPTY_GSV_SETTINGS } from './settings.ts';
import { scanGsvVoices, voiceById, voiceLabel, weightsTag } from './voices.ts';

const roots: string[] = [];

/** 建一个临时工作根，并在结束时删掉（避免污染用户目录）。 */
function workRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pet-gsv-'));
  roots.push(root);
  return root;
}

/** 写一个文件，自动建父目录。 */
function put(file: string, content: string | Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('扫音色：只留 gsv 引擎 + 有 ref/ref_text 的条目，权重取最高 epoch', () => {
  const root = workRoot();
  const voicesDir = join(root, 'voices');
  put(
    join(voicesDir, 'alpha', 'voice.json'),
    JSON.stringify({ engine: 'gsv', ref: 'ref.wav', ref_text: '甲', split: 'none', top_k: 15, temperature: 0.6 }),
  );
  put(join(voicesDir, 'alpha', 'ref.wav'), new Uint8Array([0]));
  put(join(voicesDir, 'beta', 'voice.json'), JSON.stringify({ engine: 'piper', ref: 'ref.wav', ref_text: '乙' }));
  put(join(voicesDir, 'beta', 'ref.wav'), new Uint8Array([0]));
  put(join(voicesDir, 'gamma', 'voice.json'), JSON.stringify({ engine: 'gsv', ref: 'ref.wav' }));
  put(join(voicesDir, 'gamma', 'ref.wav'), new Uint8Array([0]));
  put(
    join(voicesDir, 'delta', 'voice.json'),
    JSON.stringify({ engine: 'gsv', ref: '../voicepack/x.wav', ref_text: '丁' }),
  );
  put(join(root, 'voicepack', 'x.wav'), new Uint8Array([0]));
  put(join(root, 'gpt', 'alpha-gsv-e5.ckpt'), '');
  put(join(root, 'gpt', 'alpha-gsv-e10.ckpt'), '');
  put(join(root, 'gpt', 'alphax-gsv-e99.ckpt'), '');
  put(join(root, 'sovits', 'alpha-gsv_e4_s100.pth'), '');
  put(join(root, 'sovits', 'alpha-gsv_e8_s232.pth'), '');

  const voices = scanGsvVoices({
    ...EMPTY_GSV_SETTINGS,
    voicesDir,
    gptWeightsDir: join(root, 'gpt'),
    sovitsWeightsDir: join(root, 'sovits'),
  });

  assert.deepEqual(
    voices.map((voice) => voice.id),
    ['alpha', 'delta'],
  );
  const alpha = voiceById(voices, 'alpha');
  assert.ok(alpha);
  assert.equal(alpha.refText, '甲');
  assert.equal(alpha.textSplitMethod, 'cut0', 'split=none 要整句合成（cut0）');
  assert.equal(alpha.topK, 15);
  assert.equal(alpha.temperature, 0.6);
  assert.match(alpha.gptWeights ?? '', /alpha-gsv-e10\.ckpt$/, '取最高 epoch，别被 alphax 抢走');
  assert.match(alpha.sovitsWeights ?? '', /alpha-gsv_e8_s232\.pth$/);
  assert.match(alpha.refAudioPath, /voices\/alpha\/ref\.wav$/);

  const delta = voiceById(voices, 'delta');
  assert.ok(delta);
  assert.equal(delta.textSplitMethod, 'cut5', '没写 split 用 api_v2 默认 cut5');
  assert.match(delta.refAudioPath, /voicepack\/x\.wav$/, 'ref 相对音色根上一级解析');
  assert.equal(delta.gptWeights, undefined, '没有权重文件就不写这个键');
});

test('目录不存在：返回空数组而不是抛错', () => {
  assert.deepEqual(scanGsvVoices({ ...EMPTY_GSV_SETTINGS, voicesDir: join(workRoot(), 'nope') }), []);
  assert.deepEqual(scanGsvVoices(EMPTY_GSV_SETTINGS), []);
});

test('展示名与缓存指纹：换音色/换 epoch 指纹必须变', () => {
  const root = workRoot();
  const voicesDir = join(root, 'voices');
  put(
    join(voicesDir, 'alpha', 'voice.json'),
    JSON.stringify({ engine: 'gsv', ref: 'ref.wav', ref_text: '甲', desc: '一句话' }),
  );
  put(join(voicesDir, 'alpha', 'ref.wav'), new Uint8Array([0]));
  put(join(root, 'gpt', 'alpha-gsv-e5.ckpt'), '');
  const voices = scanGsvVoices({ ...EMPTY_GSV_SETTINGS, voicesDir, gptWeightsDir: join(root, 'gpt') });
  const alpha = voiceById(voices, 'alpha');
  assert.ok(alpha);
  assert.equal(voiceLabel(alpha), 'alpha · 一句话');
  assert.notEqual(weightsTag(alpha), weightsTag(undefined));
  assert.match(weightsTag(alpha), /^alpha\|alpha-gsv-e5\.ckpt\|$/);
});
