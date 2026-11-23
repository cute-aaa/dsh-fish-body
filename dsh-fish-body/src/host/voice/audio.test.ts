/**
 * 音频格式表的契约测试（src/host/voice/audio.ts）：mime ↔ 扩展名必须双向一致。
 * 这张表决定缓存落盘名字与 `/voice/speak` 的 Content-Type，错一处就是「文件放不出来」。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUDIO_EXTENSIONS, audioExtOf, audioMimeOfExt, normalizeAudioMime, DEFAULT_AUDIO_MIME } from './audio.ts';

test('normalizeAudioMime：去参数、转小写、mp3 收成 mpeg', () => {
  assert.equal(normalizeAudioMime('AUDIO/MPEG'), 'audio/mpeg');
  assert.equal(normalizeAudioMime('audio/wav; charset=binary'), 'audio/wav');
  assert.equal(normalizeAudioMime('audio/mp3'), DEFAULT_AUDIO_MIME);
});

test('audioExtOf：认识的格式给扩展名，不认识的给 undefined', () => {
  assert.equal(audioExtOf('audio/mpeg'), 'mp3');
  assert.equal(audioExtOf('audio/wav'), 'wav');
  assert.equal(audioExtOf('audio/x-wav'), 'wav');
  assert.equal(audioExtOf('audio/ogg'), 'ogg');
  assert.equal(audioExtOf('audio/flac'), undefined, '表外格式一律拒绝');
  assert.equal(audioExtOf(''), undefined);
});

test('audioMimeOfExt：扩展名换回可信 mime（命中旧缓存时回 Content-Type 用）', () => {
  for (const ext of AUDIO_EXTENSIONS) {
    const mime = audioMimeOfExt(ext);
    assert.ok(mime !== undefined, ext + ' 必须能换回 mime');
    assert.equal(audioExtOf(mime), ext, ext + ' 必须能双向对上');
  }
  assert.equal(audioMimeOfExt('mp3'), 'audio/mpeg');
  assert.equal(audioMimeOfExt('wav'), 'audio/wav');
  assert.equal(audioMimeOfExt('flac'), undefined);
});
