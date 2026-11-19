/**
 * GSV 配置解析的测试（src/host/voice/gsv/settings.ts）。
 *
 * 钉四件事：缺项一律空串（不猜路径）、baseURL/语种有默认值、
 * 必填只有「服务地址 + 音色包目录」（旧的参考/权重目录已经不存在）、
 * Windows 路径必须转正斜杠（实测反斜杠会让 api_v2 的 `/set_*_weights` 抛 Errno 22）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMPTY_GSV_SETTINGS,
  GSV_DEFAULT_BASE_URL,
  GSV_FIELD_BASE_URL,
  GSV_FIELD_VOICES_DIR,
  gsvMissingFields,
  gsvSettingsOf,
  toPosixPath,
} from './settings.ts';

test('缺席的 voice-providers.json：只有 baseURL 与语种有默认值，目录为空', () => {
  assert.deepEqual(gsvSettingsOf(undefined), EMPTY_GSV_SETTINGS);
  assert.equal(EMPTY_GSV_SETTINGS.baseURL, GSV_DEFAULT_BASE_URL);
  assert.equal(EMPTY_GSV_SETTINGS.textLang, 'zh');
  assert.equal(EMPTY_GSV_SETTINGS.voicesDir, '');
  assert.equal(EMPTY_GSV_SETTINGS.voice, '');
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

test('必填判定：服务地址 + 音色包目录', () => {
  assert.deepEqual(gsvMissingFields(EMPTY_GSV_SETTINGS), [GSV_FIELD_VOICES_DIR]);
  assert.deepEqual(gsvMissingFields({ ...EMPTY_GSV_SETTINGS, voicesDir: 'D:/v' }), []);
  assert.deepEqual(gsvMissingFields({ ...EMPTY_GSV_SETTINGS, baseURL: '' }), [
    GSV_FIELD_BASE_URL,
    GSV_FIELD_VOICES_DIR,
  ]);
  assert.deepEqual(gsvMissingFields({ ...EMPTY_GSV_SETTINGS, baseURL: '', voicesDir: 'D:/v' }), [GSV_FIELD_BASE_URL]);
});

test('已移除的旧键不读：refsDir / gptWeightsDir / sovitsWeightsDir 一律忽略', () => {
  // 老配置文件里残留着三个键：解析结果里既没有它们，也不会凭空造出音色来源。
  const settings = gsvSettingsOf({
    gsv: { refsDir: 'D:/refs', gptWeightsDir: 'D:/g', sovitsWeightsDir: 'D:/s' },
  });
  assert.deepEqual(settings, EMPTY_GSV_SETTINGS);
  assert.deepEqual(gsvMissingFields(settings), [GSV_FIELD_VOICES_DIR], '权重目录不能再顶替音色包目录');
});

test('配置对象不是对象时不炸', () => {
  assert.deepEqual(gsvSettingsOf({ gsv: 'nope' }), EMPTY_GSV_SETTINGS);
  assert.deepEqual(gsvSettingsOf(null), EMPTY_GSV_SETTINGS);
  assert.deepEqual(gsvSettingsOf([]), EMPTY_GSV_SETTINGS);
});

test('Windows 路径转正斜杠', () => {
  assert.equal(toPosixPath('D:\\AI\\x\\y.ckpt'), 'D:/AI/x/y.ckpt');
  assert.equal(toPosixPath('/already/posix'), '/already/posix');
});
