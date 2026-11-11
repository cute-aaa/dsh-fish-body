/**
 * GSV 配置解析的测试（src/host/voice/gsv/settings.ts）。
 *
 * 钉三件事：缺项一律空串（不猜路径）、baseURL/语种有默认值、Windows 路径必须转正斜杠
 * （实测反斜杠会让 api_v2 的 `/set_*_weights` 抛 Errno 22）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_GSV_SETTINGS, GSV_DEFAULT_BASE_URL, gsvMissingFields, gsvSettingsOf, toPosixPath } from './settings.ts';

test('缺席的 voice-providers.json：只有 baseURL 与语种有默认值，目录为空', () => {
  assert.deepEqual(gsvSettingsOf(undefined), EMPTY_GSV_SETTINGS);
  assert.equal(EMPTY_GSV_SETTINGS.baseURL, GSV_DEFAULT_BASE_URL);
  assert.equal(EMPTY_GSV_SETTINGS.textLang, 'zh');
  assert.equal(EMPTY_GSV_SETTINGS.voicesDir, '');
});

test('写坏的字段当空串；promptLang 跟随 textLang', () => {
  const settings = gsvSettingsOf({
    gsv: { baseURL: '  http://127.0.0.1:9999  ', voice: 42, voicesDir: '', textLang: 'ja' },
  });
  assert.equal(settings.baseURL, 'http://127.0.0.1:9999');
  assert.equal(settings.voice, '');
  assert.equal(settings.textLang, 'ja');
  assert.equal(settings.promptLang, 'ja');
});

test('缺必填项的人话清单：没配音色目录就报 voicesDir', () => {
  assert.deepEqual(gsvMissingFields({ ...EMPTY_GSV_SETTINGS, voicesDir: '' }), ['voicesDir']);
  assert.deepEqual(gsvMissingFields({ ...EMPTY_GSV_SETTINGS, voicesDir: 'D:/v' }), []);
});

test('目录配置全空时的 baseURL 仍可用（只缺目录）', () => {
  const settings = gsvSettingsOf({ gsv: { voicesDir: 'D:/v', gptWeightsDir: 'D:/w/gpt', sovitsWeightsDir: 'D:/w/s' } });
  assert.equal(settings.baseURL, GSV_DEFAULT_BASE_URL);
  assert.deepEqual(gsvMissingFields(settings), []);
});

test('Windows 路径转正斜杠', () => {
  assert.equal(toPosixPath('D:\\AI\\x\\y.ckpt'), 'D:/AI/x/y.ckpt');
  assert.equal(toPosixPath('/already/posix'), '/already/posix');
});
