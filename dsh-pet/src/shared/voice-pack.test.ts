/**
 * 语音导入网络视图的解析测试（src/shared/voice-pack.ts）。
 *
 * 钉两件事：坏数据不炸（字段缺席/类型不对时给安全默认）、
 * 关键字段缺失时返回 null（界面保留上一次结果并显示错误，而不是画一个空表格）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readTextLines,
  readVoicePackApply,
  readVoicePackBatch,
  readVoicePackPreview,
  readVoicePackPreviews,
  readWeightImportScan,
} from './voice-pack.ts';

test('预览：坏字段按默认值，缺 id / targetDir 时 null', () => {
  assert.equal(readVoicePackPreview(undefined), null);
  assert.equal(readVoicePackPreview({ id: 'klee' }), null, '没有目标目录不画');

  const preview = readVoicePackPreview({
    id: 'klee',
    suggestedId: 'klee',
    kind: 'sovits',
    pair: { status: 'matched', path: 'D:/x.pth', candidates: [{ path: 'D:/x.pth', version: 'v2' }] },
    versions: { gpt: 'v2', sovits: 'v2' },
    warnings: ['  ', '缺参考文本'],
    targetDir: 'D:/voices/klee',
    targetAudioPath: 'D:/voices/klee/ref.wav',
    targetTextPath: 'D:/voices/klee/ref.txt',
    weights: [{ kind: 'gpt', source: 'D:/a.ckpt', target: 'D:/v/a.ckpt', action: 'copy', bytes: 10 }],
    placement: 'copy',
    pending: false,
    status: 'skip',
  });
  assert.ok(preview);
  assert.equal(preview.kind, 'sovits');
  assert.equal(preview.pair.status, 'matched');
  assert.equal(preview.pair.candidates.length, 1);
  assert.deepEqual(preview.warnings, ['缺参考文本']);
  assert.equal(preview.placement, 'copy');
  assert.equal(preview.pending, false);
  assert.equal(preview.weights[0]?.action, 'copy');
  assert.equal(preview.status, 'skip');
});

test('预览：不认识的配对状态按 missing；不在三态里的写入状态按 new；未知放法按引用', () => {
  const preview = readVoicePackPreview({
    id: 'klee',
    targetDir: 'D:/v/klee',
    pair: { status: 'ambiguous' },
    placement: 'pointer',
    status: 'weird',
  });
  assert.ok(preview);
  assert.equal(preview.pair.status, 'missing');
  assert.equal(preview.placement, 'hardlink');
  assert.equal(preview.status, 'new');
});

test('plan：previews 与 errors 按位对齐（报错那条是 null）', () => {
  const parsed = readVoicePackPreviews({
    previews: [{ id: 'klee', targetDir: 'D:/v/klee' }, null, { id: 'ayaka', targetDir: 'D:/v/ayaka' }],
    errors: [
      { index: 1, id: 'hutao', message: '参考音频不存在' },
      { index: 9, message: '  ' },
    ],
  });
  assert.equal(parsed.previews.length, 3);
  assert.equal(parsed.previews[1], null);
  assert.deepEqual(
    parsed.errors.map((error) => [error.index, error.id, error.message]),
    [[1, 'hutao', '参考音频不存在']],
  );
  assert.deepEqual(readVoicePackPreviews(undefined), { previews: [], errors: [] });
});

test('落地结果与批量：只留合法项', () => {
  assert.equal(readVoicePackApply(null), null);
  assert.equal(readVoicePackApply({ id: 'klee', status: 'weird' }), null);
  const applied = readVoicePackApply({
    id: 'klee',
    status: 'written',
    targetDir: 'D:/v/klee',
    backups: ['', 'D:/v/klee/ref.wav.bak-1'],
    notes: ['  ', '沿用现有文件'],
  });
  assert.ok(applied);
  assert.deepEqual(applied.backups, ['D:/v/klee/ref.wav.bak-1']);
  assert.deepEqual(applied.notes, ['沿用现有文件']);

  const batch = readVoicePackBatch({
    results: [{ id: 'klee', status: 'written', targetDir: 'D:/v/klee' }, null],
    errors: [{ index: 1, message: '硬链接失败' }],
  });
  assert.equal(batch.results[0]?.status, 'written');
  assert.equal(batch.results[1], null);
  assert.equal(batch.errors[0]?.message, '硬链接失败');
  assert.deepEqual(readVoicePackBatch('nope'), { results: [], errors: [] });
});

test('导入提案：候选缺 id 丢弃，布尔缺省按 false', () => {
  assert.equal(readWeightImportScan(undefined), null);
  const scan = readWeightImportScan({
    root: 'D:/repo',
    gptDirs: ['D:/repo/GPT_weights_v2', '  '],
    sovitsDirs: ['D:/repo/SoVITS_weights_v2'],
    voicesDir: 'D:/voices',
    candidates: [
      {
        id: 'klee',
        gptFiles: ['D:/g/klee.ckpt'],
        sovitsFiles: [],
        gptPath: 'D:/g/klee.ckpt',
        bytes: 12,
        linkable: true,
        installed: false,
        warnings: ['只有一侧'],
      },
      { gptFiles: [] },
    ],
    adopted: 1,
    notes: ['ok'],
  });
  assert.ok(scan);
  assert.deepEqual(scan.gptDirs, ['D:/repo/GPT_weights_v2']);
  assert.equal(scan.candidates.length, 1, '缺 id 的候选丢掉');
  assert.equal(scan.candidates[0]?.sovitsPath, undefined);
  assert.deepEqual(scan.candidates[0]?.warnings, ['只有一侧']);
  assert.equal(scan.adopted, 1);
});

test('文本行：只留非空', () => {
  assert.deepEqual(readTextLines(undefined), []);
  assert.deepEqual(readTextLines({ lines: 'x' }), []);
  assert.deepEqual(
    readTextLines({ lines: [{ index: 1, text: '甲' }, { index: 2, text: '  ' }, 'bad'] }).map((line) => line.text),
    ['甲'],
  );
});
