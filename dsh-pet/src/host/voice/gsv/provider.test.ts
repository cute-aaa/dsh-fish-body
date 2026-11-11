/**
 * GSV provider 的时序测试（src/host/voice/gsv/provider.ts）。
 *
 * 钉四件事：探活结论是缓存的（availability 同步可读）、权重只在新音色时切一次、
 * 合成参数照 `voice.json` 走（切句法/采样/语速）、失败会把这一环标成不可用并抛出。
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { VoiceSynthError } from '../edge.ts';
import type { GsvHttp, GsvTtsRequest } from './client.ts';
import { createGsvProvider, type GsvProvider } from './provider.ts';
import { EMPTY_GSV_SETTINGS, type GsvSettings } from './settings.ts';

const roots: string[] = [];
const disposers: GsvProvider[] = [];

/** 建临时素材根，结束时删掉。 */
function workRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pet-gsvp-'));
  roots.push(root);
  return root;
}

/** 写文件并建父目录。 */
function put(file: string, content: string | Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** 造两套音色（alpha/beta）与它们各自的权重文件。 */
function makeSettings(root: string): GsvSettings {
  for (const id of ['alpha', 'beta']) {
    put(
      join(root, 'voices', id, 'voice.json'),
      JSON.stringify({
        engine: 'gsv',
        ref: 'ref.wav',
        ref_text: `${id} 的参考文本`,
        split: 'cut5',
        top_k: 15,
        top_p: 1,
        temperature: 0.6,
        seed: 1,
      }),
    );
    put(join(root, 'voices', id, 'ref.wav'), new Uint8Array([0]));
    put(join(root, 'gpt', `${id}-gsv-e10.ckpt`), '');
    put(join(root, 'sovits', `${id}-gsv_e8_s232.pth`), '');
  }
  return {
    ...EMPTY_GSV_SETTINGS,
    baseURL: 'http://127.0.0.1:9880',
    voice: 'alpha',
    voicesDir: join(root, 'voices'),
    gptWeightsDir: join(root, 'gpt'),
    sovitsWeightsDir: join(root, 'sovits'),
  };
}

/** 桩 HTTP：记录调用，可指定探活结果与合成失败。 */
function stubHttp(options: { alive?: boolean; ttsError?: Error } = {}) {
  const calls = { probe: 0, weights: [] as string[], tts: [] as GsvTtsRequest[] };
  const http: GsvHttp = {
    async probe() {
      calls.probe += 1;
      return options.alive ?? true;
    },
    async setWeights(_baseURL, kind, weightsPath) {
      calls.weights.push(`${kind}:${weightsPath}`);
    },
    async tts(_baseURL, request) {
      calls.tts.push(request);
      if (options.ttsError) throw options.ttsError;
      return { data: new Uint8Array([82, 73, 70, 70]), mime: 'audio/wav' };
    },
  };
  return { http, calls };
}

/** 造 provider 并登记到 afterEach 收尾（后台探活定时器不该留在测试进程里）。 */
function makeProvider(settings: GsvSettings | (() => GsvSettings), http: GsvHttp): GsvProvider {
  const read = typeof settings === 'function' ? settings : () => settings;
  const provider = createGsvProvider({ settings: read, http, probeIntervalMs: 60_000 });
  disposers.push(provider);
  return provider;
}

afterEach(() => {
  for (const provider of disposers.splice(0)) provider.dispose();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('没配音色目录：不可用理由说清缺什么，合成直接失败', async () => {
  const { http } = stubHttp();
  const provider = makeProvider({ ...EMPTY_GSV_SETTINGS, voice: 'alpha' }, http);
  assert.equal(provider.availability().ok, false);
  assert.equal(await provider.refresh(), false);
  const verdict = provider.availability();
  assert.equal(verdict.ok, false);
  assert.match(verdict.ok === false ? verdict.reason : '', /voicesDir/);
  await assert.rejects(() => provider.synthesize({ text: '你好', rate: '+0%' }), VoiceSynthError);
});

test('探活结论被缓存：refresh 后 availability 同步可读', async () => {
  const root = workRoot();
  const { http, calls } = stubHttp({ alive: true });
  const provider = makeProvider(makeSettings(root), http);
  assert.equal(await provider.refresh(), true);
  assert.deepEqual(provider.availability(), { ok: true });
  assert.equal(calls.probe >= 1, true);
});

test('合成：参考音频/参考文本/切句/采样/语速都按音色走，权重切一次', async () => {
  const root = workRoot();
  const settings = makeSettings(root);
  const { http, calls } = stubHttp();
  const provider = makeProvider(settings, http);

  const clip = await provider.synthesize({ text: '你好呀', rate: '+20%' });
  assert.equal(clip.mime, 'audio/wav');
  assert.deepEqual(
    calls.weights.map((item) => item.split(':')[0]),
    ['gpt', 'sovits'],
  );
  const request = calls.tts[0];
  assert.ok(request);
  assert.equal(request.text, '你好呀');
  assert.match(request.refAudioPath, /voices\/alpha\/ref\.wav$/);
  assert.equal(request.promptText, 'alpha 的参考文本');
  assert.equal(request.textSplitMethod, 'cut5');
  assert.equal(request.speedFactor, 1.2);
  assert.equal(request.topK, 15);
  assert.equal(request.seed, 1);
});

test('同一音色连说三句：只切一次权重', async () => {
  const root = workRoot();
  const { http, calls } = stubHttp();
  const provider = makeProvider(makeSettings(root), http);
  for (const text of ['一', '二', '三']) await provider.synthesize({ text, rate: '+0%' });
  assert.equal(calls.weights.length, 2, 'gpt + sovits 各一次');
  assert.equal(calls.tts.length, 3);
});

test('换音色：切到新权重，缓存指纹跟着变', async () => {
  const root = workRoot();
  let settings = makeSettings(root);
  const { http, calls } = stubHttp();
  const provider = makeProvider(() => settings, http);
  await provider.synthesize({ text: '甲', rate: '+0%' });
  const beforeTag = provider.cacheTag();

  settings = { ...settings, voice: 'beta' };
  await provider.synthesize({ text: '乙', rate: '+0%' });

  assert.equal(calls.weights.length, 4, '换音色要再切一套（gpt + sovits）');
  assert.match(calls.weights[calls.weights.length - 2] ?? '', /beta-gsv-e10\.ckpt$/);
  assert.match(calls.weights[calls.weights.length - 1] ?? '', /beta-gsv_e8_s232\.pth$/);
  assert.notEqual(provider.cacheTag(), beforeTag);
  assert.match(provider.cacheTag(), /^beta\|/);
});

test('合成失败：这一环标成不可用（下次链会跳过它），错误继续往上抛', async () => {
  const root = workRoot();
  const { http } = stubHttp({ ttsError: new Error('/tts 返回 500：CUDA out of memory') });
  const provider = makeProvider(makeSettings(root), http);
  await assert.rejects(() => provider.synthesize({ text: '你好', rate: '+0%' }), /CUDA/);
  const verdict = provider.availability();
  assert.equal(verdict.ok, false);
  assert.match(verdict.ok === false ? verdict.reason : '', /CUDA/);
});

test('音色清单与当前音色：id/描述/activeVoice 都来自扫描', async () => {
  const root = workRoot();
  const provider = makeProvider(makeSettings(root), stubHttp().http);
  assert.deepEqual(
    provider.listVoices?.().map((voice) => voice.id),
    ['alpha', 'beta'],
  );
  assert.equal(provider.activeVoice?.(), 'alpha');
  assert.equal(provider.voices().length, 2);
});

test('配置里写的音色扫不到：合成报「音色不存在」而不是拿第一个顶上', async () => {
  const root = workRoot();
  const provider = makeProvider({ ...makeSettings(root), voice: 'nope' }, stubHttp().http);
  await assert.rejects(() => provider.synthesize({ text: '你好', rate: '+0%' }), /音色不存在/);
});
