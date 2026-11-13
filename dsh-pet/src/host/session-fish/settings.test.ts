/**
 * 会话鱼设置：读侧宽容、写侧严格、写失败保留旧值。
 * @module dsh-pet/src/host/session-fish/settings.test
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkSessionFishPatch,
  parseSessionFishSettings,
  SessionFishSettingsStore,
  sessionFishSettingsPath,
} from './settings.ts';
import { DEFAULT_SESSION_FISH_SETTINGS } from '../../shared/session-fish.ts';

let dir = '';

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-fish-settings-'));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('parseSessionFishSettings', () => {
  test('文件缺失/非对象：全默认', () => {
    assert.deepEqual(parseSessionFishSettings(undefined), DEFAULT_SESSION_FISH_SETTINGS);
    assert.deepEqual(parseSessionFishSettings(null), DEFAULT_SESSION_FISH_SETTINGS);
    assert.deepEqual(parseSessionFishSettings([]), DEFAULT_SESSION_FISH_SETTINGS);
  });

  test('逐字段宽容：坏的只回默认，好的保留', () => {
    const parsed = parseSessionFishSettings({ enabled: false, sizePx: 9999, speakTurnEnd: false, maxCount: 3 });
    assert.equal(parsed.enabled, false);
    assert.equal(parsed.sizePx, DEFAULT_SESSION_FISH_SETTINGS.sizePx);
    assert.equal(parsed.maxCount, 3);
    assert.equal(parsed.speakTurnEnd, false);
  });

  test('皮肤与跟随：合法值保留，脏值/越界回默认', () => {
    const ok = parseSessionFishSettings({ skin: '我的鱼.gif', followPet: false });
    assert.equal(ok.skin, '我的鱼.gif');
    assert.equal(ok.followPet, false);
    const dirty = parseSessionFishSettings({ skin: '../package.json', followPet: 'no' });
    assert.equal(dirty.skin, DEFAULT_SESSION_FISH_SETTINGS.skin);
    assert.equal(dirty.followPet, DEFAULT_SESSION_FISH_SETTINGS.followPet);
  });
});

describe('checkSessionFishPatch', () => {
  test('未知键拒绝', () => {
    const result = checkSessionFishPatch({ nope: 1 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /unknown/);
  });

  test('类型与范围拒绝', () => {
    assert.equal(checkSessionFishPatch({ sizePx: 10 }).ok, false);
    assert.equal(checkSessionFishPatch({ maxCount: 1.5 }).ok, false);
    assert.equal(checkSessionFishPatch({ enabled: 'yes' }).ok, false);
    assert.equal(checkSessionFishPatch([]).ok, false);
  });

  test('皮肤名：只收一个合法文件名，路径/未知扩展名/超长都拒', () => {
    assert.equal(checkSessionFishPatch({ skin: '' }).ok, true);
    assert.equal(checkSessionFishPatch({ skin: '写代码.webm' }).ok, true);
    assert.equal(checkSessionFishPatch({ skin: '../package.json' }).ok, false);
    assert.equal(checkSessionFishPatch({ skin: 'a/b.gif' }).ok, false);
    assert.equal(checkSessionFishPatch({ skin: 'readme.md' }).ok, false);
    assert.equal(checkSessionFishPatch({ skin: 'x'.repeat(200) + '.png' }).ok, false);
    assert.equal(checkSessionFishPatch({ skin: 42 }).ok, false);
  });

  test('followPet 只收布尔', () => {
    assert.equal(checkSessionFishPatch({ followPet: false }).ok, true);
    assert.equal(checkSessionFishPatch({ followPet: 0 }).ok, false);
  });

  test('合法片段：只回写显式给出的键', () => {
    const result = checkSessionFishPatch({ sizePx: 72, speakProgress: false });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.patch, { sizePx: 72, speakProgress: false });
  });
});

describe('SessionFishSettingsStore', () => {
  test('没写过文件：用默认值，且不创建文件', () => {
    const file = join(dir, 'missing', 'session-fish.json');
    const store = new SessionFishSettingsStore(file);
    assert.deepEqual(store.get(), DEFAULT_SESSION_FISH_SETTINGS);
    assert.equal(existsSync(file), false);
  });

  test('写成功才换内存：文件内容与内存一致', async () => {
    const file = sessionFishSettingsPath(dir);
    const store = new SessionFishSettingsStore(file);
    const updated = await store.update({ enabled: false, sizePx: 88 });
    assert.equal(updated.ok, true);
    assert.equal(store.get().enabled, false);
    assert.equal(store.get().sizePx, 88);
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    assert.equal(onDisk.sizePx, 88);
  });

  test('非法 patch：拒绝且不改内存/文件', async () => {
    const file = sessionFishSettingsPath(dir);
    const store = new SessionFishSettingsStore(file);
    const before = readFileSync(file, 'utf8');
    const updated = await store.update({ maxCount: 0 });
    assert.equal(updated.ok, false);
    if (!updated.ok) assert.equal(updated.kind, 'invalid');
    assert.equal(store.get().maxCount, DEFAULT_SESSION_FISH_SETTINGS.maxCount);
    assert.equal(readFileSync(file, 'utf8'), before);
  });

  test('文件写坏：回落默认并告警一次', () => {
    const file = join(dir, 'broken.json');
    writeFileSync(file, '{ not json', 'utf8');
    const messages: string[] = [];
    const store = new SessionFishSettingsStore(file, (message) => messages.push(message));
    assert.deepEqual(store.get(), DEFAULT_SESSION_FISH_SETTINGS);
    assert.equal(messages.length, 1);
  });

  test('reload 重新读盘（手工改文件后重载插件）', async () => {
    const file = join(dir, 'reload.json');
    const store = new SessionFishSettingsStore(file);
    await store.update({ sizePx: 50 });
    writeFileSync(file, JSON.stringify({ sizePx: 90 }), 'utf8');
    assert.equal(store.reload().sizePx, 90);
  });

  test('写盘失败（目标是目录）：kind=io，内存保持旧值', async () => {
    const file = join(dir, 'as-directory');
    // 建目录占位：writeFile 会 EISDIR/EPERM，走 io 分支。
    mkdirSync(file, { recursive: true });
    const store = new SessionFishSettingsStore(file);
    const updated = await store.update({ sizePx: 70 });
    assert.equal(updated.ok, false);
    if (!updated.ok) assert.equal(updated.kind, 'io');
    assert.equal(store.get().sizePx, DEFAULT_SESSION_FISH_SETTINGS.sizePx);
  });
});
