/**
 * GSV 音色扫描的测试（src/host/voice/gsv/voices.ts）。
 *
 * 钉六件事：音色 id 从权重文件名推（含 `-gsv` 后缀、lora 标记、版本标记）、
 * 单一来源就是音色包目录、参考音频/文本的三种文件名都能认、
 * 缺参考/缺任一侧权重仍然列出并带期望文件名、
 * 配对同版本优先且错配要提示、`voice.json` 已彻底不读。
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { EMPTY_GSV_SETTINGS } from './settings.ts';
import { pairWeightsOf, scanGsvVoiceLibrary, scanGsvVoices, voiceById, voiceIdOfStem, weightsTag } from './voices.ts';

const roots: string[] = [];

/** 建一个临时工作根，并在结束时删掉（避免污染用户目录）。 */
function workRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pet-gsv-'));
  roots.push(root);
  return root;
}

/** 写一个文件，自动建父目录。 */
function put(file: string, content: string | Uint8Array = ''): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** 造一个完整音色包（参考 + 两侧权重）。 */
function voicePack(root: string, id: string, ext = 'wav'): string {
  const dir = join(root, 'voices', id);
  put(join(dir, `ref.${ext}`), new Uint8Array([0]));
  put(join(dir, `${id}-gsv-e10.ckpt`));
  put(join(dir, `${id}-gsv_e8_s288.pth`));
  return dir;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('文件名 → 音色 id：gsv 后缀、epoch/step/lora、版本标记都剥掉', () => {
  assert.equal(voiceIdOfStem('klee-gsv-e10'), 'klee');
  assert.equal(voiceIdOfStem('hutao-gsv_e8_s3464_l32'), 'hutao');
  assert.equal(voiceIdOfStem('norma-v5turbo-e10'), 'norma');
  assert.equal(voiceIdOfStem('ganyu'), 'ganyu');
  assert.equal(voiceIdOfStem('loli12-gsv'), 'loli12');
});

test('音色包目录：一个子目录一个音色，id 即目录名，按名字排序', () => {
  const root = workRoot();
  voicePack(root, 'klee');
  voicePack(root, 'ayaka');
  const library = scanGsvVoiceLibrary({ ...EMPTY_GSV_SETTINGS, voicesDir: join(root, 'voices') });
  assert.deepEqual(
    library.voices.map((voice) => voice.id),
    ['ayaka', 'klee'],
  );
  for (const voice of library.voices) {
    assert.equal(voice.available, true);
    assert.equal(voice.zeroShot, true, '没有 ref.txt 就是零样本');
    assert.match(voice.gptWeights ?? '', /ayaka|klee/);
  }
  assert.deepEqual(
    scanGsvVoices({ ...EMPTY_GSV_SETTINGS, voicesDir: join(root, 'voices') }).map((voice) => voice.id),
    ['ayaka', 'klee'],
  );
  assert.match(library.notes[0] ?? '', /2 个目录，列出 2 个音色，可合成 2 个/);
});

test('缺件也要列出来，并写明缺的是哪个名字', () => {
  const root = workRoot();
  const voicesDir = join(root, 'voices');
  // 只有参考，缺两侧权重
  put(join(voicesDir, 'ganyu', 'ref.wav'), new Uint8Array([0]));
  // 只有权重，缺参考
  put(join(voicesDir, 'klee', 'klee-gsv-e10.ckpt'));
  put(join(voicesDir, 'klee', 'klee-gsv_e8_s288.pth'));
  // 缺 SoVITS
  put(join(voicesDir, 'hutao', 'ref.wav'), new Uint8Array([0]));
  put(join(voicesDir, 'hutao', 'hutao-gsv-e10.ckpt'));

  const library = scanGsvVoiceLibrary({ ...EMPTY_GSV_SETTINGS, voicesDir });
  assert.deepEqual(
    library.voices.map((voice) => voice.id),
    ['ganyu', 'hutao', 'klee'],
  );

  const ganyu = voiceById(library.voices, 'ganyu');
  assert.equal(ganyu?.available, false);
  assert.match(ganyu?.reason ?? '', /缺少 GPT 权重：ganyu\/\*\.ckpt/);
  assert.match(ganyu?.reason ?? '', /缺少 SoVITS 权重：ganyu\/\*\.pth/);

  const klee = voiceById(library.voices, 'klee');
  assert.equal(klee?.available, false);
  assert.match(klee?.reason ?? '', /缺少参考音频：klee\/ref\.wav/);

  const hutao = voiceById(library.voices, 'hutao');
  assert.equal(hutao?.available, false);
  assert.match(hutao?.reason ?? '', /缺少 SoVITS 权重：hutao\/\*\.pth/);
  assert.deepEqual(scanGsvVoices({ ...EMPTY_GSV_SETTINGS, voicesDir }), [], '一个都合不了');
});

test('参考文本三种文件名：ref.txt > <id>.txt > 与参考音频同名', () => {
  const root = workRoot();
  const voicesDir = join(root, 'voices');
  // ref.txt 优先
  voicePack(root, 'klee');
  put(join(voicesDir, 'klee', 'ref.txt'), '\uFEFF火元素的用法。\n第二行不算');
  put(join(voicesDir, 'klee', 'klee.txt'), '不该用这一条');
  // 只有 <id>.txt
  voicePack(root, 'ayaka');
  put(join(voicesDir, 'ayaka', 'ayaka.txt'), '绫华的台词');
  // 只有与参考音频同名的 .txt（参考叫 lines.wav）
  const hutao = join(voicesDir, 'hutao');
  put(join(hutao, 'lines.wav'), new Uint8Array([0]));
  put(join(hutao, 'lines.txt'), '胡桃的台词');
  put(join(hutao, 'hutao-gsv-e10.ckpt'));
  put(join(hutao, 'hutao-gsv_e8_s288.pth'));

  const library = scanGsvVoiceLibrary({ ...EMPTY_GSV_SETTINGS, voicesDir });
  assert.equal(voiceById(library.voices, 'klee')?.refText, '火元素的用法。');
  assert.equal(voiceById(library.voices, 'klee')?.zeroShot, false);
  assert.equal(voiceById(library.voices, 'ayaka')?.refText, '绫华的台词');
  assert.equal(voiceById(library.voices, 'hutao')?.refText, '胡桃的台词');
  assert.match(voiceById(library.voices, 'hutao')?.refAudioPath ?? '', /hutao\/lines\.wav$/);
});

test('参考音频：ref.* 优先，其次 <id>.*，最后目录里唯一的音频', () => {
  const root = workRoot();
  const voicesDir = join(root, 'voices');
  const klee = voicePack(root, 'klee', 'mp3');
  put(join(klee, 'extra.wav'), new Uint8Array([0]));
  const ayaka = voicePack(root, 'ayaka');
  rmSync(join(ayaka, 'ref.wav'));
  put(join(ayaka, 'ayaka.wav'), new Uint8Array([0]));
  const hutao = voicePack(root, 'hutao');
  rmSync(join(hutao, 'ref.wav'));
  put(join(hutao, 'hutao-take3.flac'), new Uint8Array([0]));

  const library = scanGsvVoiceLibrary({ ...EMPTY_GSV_SETTINGS, voicesDir });
  assert.match(voiceById(library.voices, 'klee')?.refAudioPath ?? '', /klee\/ref\.mp3$/, 'ref.* 优先于别的音频');
  assert.match(voiceById(library.voices, 'ayaka')?.refAudioPath ?? '', /ayaka\/ayaka\.wav$/, '同名文件也认');
  assert.match(voiceById(library.voices, 'hutao')?.refAudioPath ?? '', /hutao\/hutao-take3\.flac$/, '唯一音频兜底');
});

test('参考文本第四种来源：目录里唯一的 .txt（手建包写的「参考.txt」）', () => {
  const root = workRoot();
  const dir = join(root, 'voices', '纳西妲');
  put(join(dir, '纳西妲-e15.ckpt'));
  put(join(dir, '纳西妲_e2_s3060_l128.pth'));
  put(join(dir, '纳西妲.wav'), new Uint8Array([0]));
  put(join(dir, '参考.txt'), '快去避雨吧，小心头顶上长出蘑菇哦。\n');
  const library = scanGsvVoiceLibrary({ ...EMPTY_GSV_SETTINGS, voicesDir: join(root, 'voices') });
  const voice = voiceById(library.voices, '纳西妲');
  assert.equal(voice?.available, true);
  assert.equal(voice?.zeroShot, false);
  assert.equal(voice?.refText, '快去避雨吧，小心头顶上长出蘑菇哦。');
});

test('权重放一层子目录（v2/）也认，版本从目录名推', () => {
  const root = workRoot();
  const dir = join(root, 'voices', 'klee');
  put(join(dir, 'ref.wav'), new Uint8Array([0]));
  put(join(dir, 'v2', 'klee-gsv-e10.ckpt'));
  put(join(dir, 'v2', 'klee-gsv_e8_s288.pth'));
  const library = scanGsvVoiceLibrary({ ...EMPTY_GSV_SETTINGS, voicesDir: join(root, 'voices') });
  const klee = voiceById(library.voices, 'klee');
  assert.equal(klee?.available, true);
  assert.equal(klee?.gptVersion, 'v2');
  assert.equal(klee?.sovitsVersion, 'v2');
  assert.match(klee?.gptWeights ?? '', /klee\/v2\/klee-gsv-e10\.ckpt$/);
});

test('配对：同版本优先；说不出版本时不误报错配；确实错配就提示', () => {
  const root = workRoot();
  const voicesDir = join(root, 'voices');
  // 同版本优先：v2 两边齐全，另有 v5turbo 的 SoVITS 干扰
  const hutao = join(voicesDir, 'hutao');
  put(join(hutao, 'ref.wav'), new Uint8Array([0]));
  put(join(hutao, 'v2', 'hutao-gsv-e10.ckpt'));
  put(join(hutao, 'v2', 'hutao-gsv_e8_s232.pth'));
  put(join(hutao, 'v5turbo', 'hutao-gsv_e10_s3464.pth'));
  // 版本未知：不报错配
  const klee = join(voicesDir, 'klee');
  put(join(klee, 'ref.wav'), new Uint8Array([0]));
  put(join(klee, 'klee-gsv.ckpt'));
  put(join(klee, 'klee-gsv.pth'));
  // 已知错配
  const ayaka = join(voicesDir, 'ayaka');
  put(join(ayaka, 'ref.wav'), new Uint8Array([0]));
  put(join(ayaka, 'v2', 'ayaka-gsv-e10.ckpt'));
  put(join(ayaka, 'v5turbo', 'ayaka-gsv_e8_s400.pth'));

  const library = scanGsvVoiceLibrary({ ...EMPTY_GSV_SETTINGS, voicesDir });
  const hutaoVoice = voiceById(library.voices, 'hutao');
  assert.equal(hutaoVoice?.gptVersion, 'v2');
  assert.equal(hutaoVoice?.sovitsVersion, 'v2', '有同版本配对时不能拿 v5turbo 的 SoVITS');
  assert.equal(
    hutaoVoice?.notes.some((note) => note.includes('版本不一致')),
    false,
  );

  const kleeVoice = voiceById(library.voices, 'klee');
  assert.equal(
    kleeVoice?.notes.some((note) => note.includes('版本不一致')),
    false,
    '两侧都说不出版本时不该误报',
  );

  const ayakaVoice = voiceById(library.voices, 'ayaka');
  assert.equal(ayakaVoice?.available, true, '错配也列出来（能不能加载由服务端回答）');
  assert.match(ayakaVoice?.notes.join(' / ') ?? '', /版本不一致/);
  assert.match(library.notes.join(' / '), /版本不一致/);
});

test('pairWeightsOf 可直接用于任意文件清单（导入提案与扫描共用）', () => {
  const pair = pairWeightsOf(
    ['/w/GPT_weights_v2/klee-gsv-e5.ckpt', '/w/GPT_weights_v2/klee-gsv-e10.ckpt'],
    ['/w/SoVITS_weights_v2/klee-gsv_e8_s288.pth'],
  );
  assert.match(pair.gpt ?? '', /klee-gsv-e10\.ckpt$/, '取最高 epoch');
  assert.equal(pair.gptVersion, 'v2');
  assert.equal(pair.mismatch, false);

  const onlyGpt = pairWeightsOf(['/w/GPT_weights_v2/klee-gsv-e10.ckpt'], []);
  assert.equal(onlyGpt.sovits, undefined);
  assert.equal(onlyGpt.mismatch, false);

  assert.deepEqual(pairWeightsOf([], []), { mismatch: false });
});

test('空目录不列；voice.json 里的东西一概不读', () => {
  const root = workRoot();
  const voicesDir = join(root, 'voices');
  put(join(voicesDir, 'empty', 'readme.txt'), '什么也没有');
  // 老格式：只有 voice.json 里的指针，没有真权重 → 现在必须如实说缺权重
  const old = join(voicesDir, 'loli12-gsv');
  put(join(old, 'ref.wav'), new Uint8Array([0]));
  put(
    join(old, 'voice.json'),
    JSON.stringify({
      engine: 'gsv',
      ref: 'ref.wav',
      ref_text: '丁',
      gpt: '../../repo/GPT_weights_v2/loli12-gsv-e10.ckpt',
      sovits: '../../repo/SoVITS_weights_v2/loli12-gsv_e8_s232.pth',
      split: 'none',
      top_k: 15,
    }),
  );
  put(join(root, 'repo', 'GPT_weights_v2', 'loli12-gsv-e10.ckpt'));
  put(join(root, 'repo', 'SoVITS_weights_v2', 'loli12-gsv_e8_s232.pth'));

  const library = scanGsvVoiceLibrary({ ...EMPTY_GSV_SETTINGS, voicesDir });
  assert.deepEqual(
    library.voices.map((voice) => voice.id),
    ['loli12-gsv'],
    '空目录不列；voice.json 不再是音色来源',
  );
  const voice = voiceById(library.voices, 'loli12-gsv');
  assert.equal(voice?.available, false, '指针写法已废弃：权重必须是目录里的真文件');
  assert.match(voice?.reason ?? '', /缺少 GPT 权重/);
  assert.equal(voice?.refText, '', 'voice.json 里的 ref_text 不再读');
  assert.equal(voice?.zeroShot, true);
});

test('缓存指纹：换音色 / 换 epoch / 改参考文本都要变', () => {
  const root = workRoot();
  const voicesDir = join(root, 'voices');
  const dir = voicePack(root, 'klee');
  put(join(dir, 'ref.txt'), '甲');

  const before = voiceById(scanGsvVoiceLibrary({ ...EMPTY_GSV_SETTINGS, voicesDir }).voices, 'klee');
  assert.match(weightsTag(before), /^klee\|klee-gsv-e10\.ckpt\|klee-gsv_e8_s288\.pth\|ref\.wav\|/);

  put(join(dir, 'klee-gsv-e20.ckpt'));
  const afterEpoch = voiceById(scanGsvVoiceLibrary({ ...EMPTY_GSV_SETTINGS, voicesDir }).voices, 'klee');
  assert.notEqual(weightsTag(afterEpoch), weightsTag(before));
  assert.match(weightsTag(afterEpoch), /klee-gsv-e20\.ckpt/);

  put(join(dir, 'ref.txt'), '乙');
  const afterText = voiceById(scanGsvVoiceLibrary({ ...EMPTY_GSV_SETTINGS, voicesDir }).voices, 'klee');
  assert.notEqual(weightsTag(afterText), weightsTag(before), '改参考文本也要换缓存键');
});

test('目录没配 / 不存在：空清单 + 一句诊断，而不是抛错', () => {
  assert.deepEqual(scanGsvVoices(EMPTY_GSV_SETTINGS), []);
  assert.match(scanGsvVoiceLibrary(EMPTY_GSV_SETTINGS).notes.join(' / '), /没有配置音色包目录/);

  const root = workRoot();
  const missing = scanGsvVoiceLibrary({ ...EMPTY_GSV_SETTINGS, voicesDir: join(root, 'nope') });
  assert.deepEqual(missing.voices, []);
  assert.match(missing.notes.join(' / '), /音色包目录不存在/);
});
