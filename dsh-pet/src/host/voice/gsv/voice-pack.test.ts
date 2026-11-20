/**
 * 音色导入的宿主逻辑测试（src/host/voice/gsv/voice-pack.ts）。
 *
 * 钉六件事：选根只认 `GPT_weights*` / `SoVITS_weights*`（选中项本身是子目录就上提一级）、
 * 预览零写入、引用＝真硬链接（同 inode）、复制＝独立文件、只有一侧权重也能导（之后置灰）、
 * 批量落地逐条独立成败且共用同一个备份时间戳。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import {
  applyVoicePack,
  applyVoicePacks,
  discoverWeightRoots,
  previewVoicePack,
  proposeImports,
  sameVolumeOf,
  VoicePackError,
  type VoicePackInput,
  type VoicePackRoots,
} from './voice-pack.ts';
import { EMPTY_GSV_SETTINGS } from './settings.ts';

const roots: string[] = [];

/** 建临时工作根，结束时删掉。 */
function workRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pet-vp-'));
  roots.push(root);
  return root;
}

/** 写文件并建父目录。 */
function put(file: string, content: string | Uint8Array = 'weights'): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 一套最小素材：仓库里的两侧权重 + 一份参考音频/文本 + 空的音色包目录。 */
interface Setup {
  readonly root: string;
  readonly repo: string;
  readonly gpt: string;
  readonly sovits: string;
  readonly ref: string;
  readonly roots: VoicePackRoots;
}

/** 造素材。 */
function setup(): Setup {
  const root = workRoot();
  const repo = join(root, 'repo');
  const gpt = join(repo, 'GPT_weights_v2', 'klee-gsv-e10.ckpt');
  const sovits = join(repo, 'SoVITS_weights_v2', 'klee-gsv_e8_s288.pth');
  const ref = join(root, 'in', 'klee.wav');
  put(gpt, 'gpt-weights');
  put(sovits, 'sovits-weights');
  put(ref, new Uint8Array([1, 2, 3]));
  mkdirSync(join(root, 'voices'), { recursive: true });
  return { root, repo, gpt, sovits, ref, roots: { voicesDir: join(root, 'voices'), promptLang: 'zh' } };
}

/** 表单输入。 */
function inputOf(made: Setup, patch: Partial<VoicePackInput> = {}): VoicePackInput {
  return {
    weightPath: made.gpt,
    counterpartPath: made.sovits,
    refAudioPath: made.ref,
    refText: '甲',
    id: 'klee',
    placement: 'hardlink',
    overwrite: false,
    ...patch,
  };
}

/** 两个路径是不是同一个 inode（硬链接的判据）。 */
function sameInode(a: string, b: string): boolean {
  return statSync(a).ino === statSync(b).ino;
}

describe('discoverWeightRoots', () => {
  test('父目录：展开 GPT_weights* / SoVITS_weights*', () => {
    const made = setup();
    put(join(made.repo, 'GPT_weights_v5turbo', 'klee-gsv-e10.ckpt'), 'x');
    const dirs = discoverWeightRoots(made.repo);
    assert.equal(dirs.root, made.repo.replace(/\\/g, '/'));
    assert.deepEqual(
      dirs.gptDirs.map((dir) => dir.split('/').pop()),
      ['GPT_weights_v2', 'GPT_weights_v5turbo'],
    );
    assert.deepEqual(
      dirs.sovitsDirs.map((dir) => dir.split('/').pop()),
      ['SoVITS_weights_v2'],
    );
    assert.deepEqual(dirs.notes, []);
  });

  test('选中的本身就是权重子目录：上提一级再展开', () => {
    const made = setup();
    const dirs = discoverWeightRoots(join(made.repo, 'GPT_weights_v2'));
    assert.equal(dirs.root, made.repo.replace(/\\/g, '/'));
    assert.equal(dirs.gptDirs.length, 1);
    assert.equal(dirs.sovitsDirs.length, 1, '兄弟目录也要认出来');
    assert.match(dirs.notes.join(' / '), /这一层展开/);
  });

  test('只有一侧 / 根目录直接放权重 / 什么都没有 / 目录不存在', () => {
    const made = setup();
    const onlyGpt = discoverWeightRoots(join(made.repo, 'GPT_weights_v2'));
    assert.equal(onlyGpt.sovitsDirs.length, 1);

    const flat = join(made.root, 'flat');
    put(join(flat, 'klee.ckpt'), 'x');
    put(join(flat, 'klee.pth'), 'y');
    const flatDirs = discoverWeightRoots(flat);
    assert.deepEqual(flatDirs.gptDirs, [flat.replace(/\\/g, '/')]);
    assert.deepEqual(flatDirs.sovitsDirs, [flat.replace(/\\/g, '/')]);
    assert.match(flatDirs.notes.join(' / '), /没有 GPT_weights\* 子目录/);

    const empty = join(made.root, 'empty');
    mkdirSync(empty, { recursive: true });
    const emptyDirs = discoverWeightRoots(empty);
    assert.deepEqual(emptyDirs.gptDirs, []);
    assert.deepEqual(emptyDirs.sovitsDirs, []);
    assert.match(emptyDirs.notes.join(' / '), /没有 GPT_weights\* \/ SoVITS_weights\*/);

    assert.throws(() => discoverWeightRoots(join(made.root, 'nope')), VoicePackError);
    assert.throws(() => discoverWeightRoots('  '), VoicePackError);
  });
});

test('sameVolumeOf：判盘符，相对路径一律算不同卷', () => {
  assert.equal(sameVolumeOf('D:/a/x.ckpt', 'D:/b'), true);
  assert.equal(sameVolumeOf('D:/a', 'd:/b'), true);
  assert.equal(sameVolumeOf('D:\\a\\x.ckpt', 'D:/b'), true, '正斜杠与反斜杠混写也要判对');
  assert.equal(sameVolumeOf('D:/a', 'C:/b'), false);
  assert.equal(sameVolumeOf('relative/x', 'D:/b'), false);
});

describe('previewVoicePack', () => {
  test('零写入：给出 id、两侧去向与目标路径', () => {
    const made = setup();
    const preview = previewVoicePack(inputOf(made), made.roots);
    assert.equal(preview.id, 'klee');
    assert.equal(preview.suggestedId, 'klee');
    assert.equal(preview.pair.status, 'matched');
    assert.equal(preview.status, 'new');
    assert.equal(preview.pending, true);
    assert.equal(preview.placement, 'hardlink');
    assert.deepEqual(
      preview.weights.map((plan) => plan.action),
      ['hardlink', 'hardlink'],
    );
    assert.equal(preview.targetDir, join(made.roots.voicesDir, 'klee').replace(/\\/g, '/'));
    assert.equal(existsSync(join(made.roots.voicesDir, 'klee')), false, '预览绝不能建目录');
  });

  test('只有一侧：unpaired + 提示，仍然可以导（之后置灰）', () => {
    const made = setup();
    const preview = previewVoicePack(inputOf(made, { counterpartPath: '' }), made.roots);
    assert.equal(preview.pair.status, 'unpaired');
    assert.equal(preview.weights.length, 1);
    assert.equal(preview.pending, true);
    assert.match(preview.warnings.join(' / '), /只有一侧权重/);
  });

  test('id 与文件名对不上、参考文本为空时都会警告', () => {
    const made = setup();
    const preview = previewVoicePack(inputOf(made, { id: 'klee2', refText: '' }), made.roots);
    assert.match(preview.warnings.join(' / '), /与权重文件名推出的「klee」不同/);
    assert.match(preview.warnings.join(' / '), /零样本/);
  });

  test('非法输入一律拒绝', () => {
    const made = setup();
    assert.throws(() => previewVoicePack(inputOf(made, { id: '../evil' }), made.roots), VoicePackError);
    assert.throws(() => previewVoicePack(inputOf(made, { refAudioPath: '' }), made.roots), VoicePackError);
    assert.throws(
      () => previewVoicePack(inputOf(made, { weightPath: join(made.root, 'nope.ckpt') }), made.roots),
      VoicePackError,
    );
    assert.throws(() => previewVoicePack(inputOf(made), { voicesDir: '', promptLang: 'zh' }), /音色包目录/);
  });
});

describe('applyVoicePack', () => {
  test('引用：造真硬链接（同 inode），不写 voice.json', async () => {
    const made = setup();
    const result = await applyVoicePack(inputOf(made), made.roots);
    const dir = join(made.roots.voicesDir, 'klee');
    assert.equal(result.status, 'written');
    assert.equal(result.placed.length, 2);
    assert.ok(sameInode(join(dir, 'klee-gsv-e10.ckpt'), made.gpt), 'GPT 权重应是硬链接');
    assert.ok(sameInode(join(dir, 'klee-gsv_e8_s288.pth'), made.sovits), 'SoVITS 权重应是硬链接');
    assert.equal(readFileSync(join(dir, 'ref.wav')).length, 3, '参考音频是复制');
    assert.equal(readFileSync(join(dir, 'ref.txt'), 'utf8').trim(), '甲');
    assert.equal(existsSync(join(dir, 'voice.json')), false, '不再写 voice.json');
  });

  test('复制：两侧都是独立文件，体积与源一致', async () => {
    const made = setup();
    const result = await applyVoicePack(inputOf(made, { placement: 'copy' }), made.roots);
    const dir = join(made.roots.voicesDir, 'klee');
    assert.equal(result.placed.length, 2);
    assert.equal(sameInode(join(dir, 'klee-gsv-e10.ckpt'), made.gpt), false);
    assert.equal(statSync(join(dir, 'klee-gsv-e10.ckpt')).size, statSync(made.gpt).size);
  });

  test('参考已存在且没勾覆盖：只补权重，第二次真无事可做时 skipped', async () => {
    const made = setup();
    await applyVoicePack(inputOf(made), made.roots);
    // 换一份权重（新 epoch），参考不动
    const newer = join(made.repo, 'GPT_weights_v2', 'klee-gsv-e20.ckpt');
    put(newer, 'newer');
    const second = await applyVoicePack(inputOf(made, { weightPath: newer }), made.roots);
    assert.equal(second.status, 'written', '只补权重也算写');
    const dir = join(made.roots.voicesDir, 'klee');
    assert.ok(existsSync(join(dir, 'klee-gsv-e20.ckpt')));

    const third = await applyVoicePack(inputOf(made, { weightPath: newer }), made.roots);
    assert.equal(third.status, 'skipped');
    assert.deepEqual(third.placed, []);
  });

  test('勾覆盖：先把旧参考改名备份，再写新的', async () => {
    const made = setup();
    await applyVoicePack(inputOf(made), made.roots);
    const other = join(made.root, 'in', 'klee2.wav');
    put(other, new Uint8Array([9, 9]));
    const result = await applyVoicePack(inputOf(made, { refAudioPath: other, overwrite: true }), made.roots);
    assert.equal(result.status, 'written');
    assert.equal(result.backups.length >= 1, true, '旧参考要留一份备份');
    assert.equal(readFileSync(join(made.roots.voicesDir, 'klee', 'ref.wav')).length, 2, '新参考已顶上');
  });
});

describe('proposeImports / applyVoicePacks', () => {
  test('按 id 配对两侧权重，标出已存在与可不可引用', () => {
    const made = setup();
    put(join(made.repo, 'GPT_weights_v2', 'ayaka-gsv-e10.ckpt'), 'a');
    put(join(made.repo, 'SoVITS_weights_v2', 'ayaka-gsv_e8_s288.pth'), 'b');
    put(join(made.repo, 'GPT_weights_v2', 'hutao-gsv-e10.ckpt'), 'c');
    mkdirSync(join(made.roots.voicesDir, 'klee'), { recursive: true });

    const dirs = discoverWeightRoots(made.repo);
    const scan = proposeImports(dirs, { ...EMPTY_GSV_SETTINGS, voicesDir: made.roots.voicesDir });
    assert.deepEqual(
      scan.candidates.map((candidate) => candidate.id),
      ['ayaka', 'hutao', 'klee'],
    );
    const klee = scan.candidates.find((candidate) => candidate.id === 'klee');
    assert.equal(klee?.installed, true, '目录里已有同名文件夹');
    assert.equal(klee?.linkable, true, '同一分区');
    assert.equal(klee?.gptPath?.endsWith('klee-gsv-e10.ckpt'), true);
    const hutao = scan.candidates.find((candidate) => candidate.id === 'hutao');
    assert.equal(hutao?.sovitsPath, undefined, '只有 GPT 一侧');
    assert.equal(scan.adopted, 1);
  });

  test('音色包目录没配：linkable=false（引用不可选）', () => {
    const made = setup();
    const scan = proposeImports(discoverWeightRoots(made.repo), EMPTY_GSV_SETTINGS);
    const klee = scan.candidates[0];
    assert.equal(klee?.linkable, false);
    assert.equal(scan.voicesDir, '');
  });

  test('批量落地：逐条独立成败，成功的那条照常写盘', async () => {
    const made = setup();
    put(join(made.repo, 'SoVITS_weights_v2', 'ayaka-gsv_e8_s288.pth'), 'b');
    put(join(made.repo, 'GPT_weights_v2', 'ayaka-gsv-e10.ckpt'), 'a');
    const inputs = [
      inputOf(made),
      // 这条缺权重文件：必须只失败它自己
      inputOf(made, { id: 'broken', weightPath: join(made.repo, 'GPT_weights_v2', 'nope.ckpt') }),
      inputOf(made, {
        id: 'ayaka',
        weightPath: join(made.repo, 'GPT_weights_v2', 'ayaka-gsv-e10.ckpt'),
        counterpartPath: join(made.repo, 'SoVITS_weights_v2', 'ayaka-gsv_e8_s288.pth'),
        refText: '乙',
      }),
    ];
    const batch = await applyVoicePacks(inputs, made.roots, new Date('2026-01-02T03:04:05Z'));
    assert.equal(batch.errors.length, 1);
    assert.equal(batch.errors[0]?.index, 1);
    assert.match(batch.errors[0]?.message ?? '', /权重文件不存在/);
    assert.equal(batch.results[0]?.status, 'written');
    assert.equal(batch.results[1], undefined);
    assert.equal(batch.results[2]?.status, 'written');
    assert.ok(existsSync(join(made.roots.voicesDir, 'klee', 'ref.wav')));
    assert.ok(existsSync(join(made.roots.voicesDir, 'ayaka', 'ref.wav')));
  });
});
