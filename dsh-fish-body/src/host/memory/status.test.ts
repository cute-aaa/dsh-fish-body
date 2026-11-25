/**
 * 记忆接线与可观测的契约：候选探测、单槽不抢占、盘点可见。
 *
 * 单槽是既有设计（同时只能一个实现改内容），所以「装了却没生效」是常态；
 * 这一层的职责就是把三种情况区分开，让用户查得到原因。
 * @module dsh-fish-body/src/host/memory/status.test
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectMemoryCandidates,
  memoryView,
  resetMemoryStatus,
  setMemoryCandidates,
  setMemoryProviderStatus,
  setMemorySlotTaken,
  updateMemoryReadResult,
} from './status.ts';

const ROOT = mkdtempSync(join(tmpdir(), 'mem-status-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));

let seq = 0;
function dshRoot(): string {
  seq += 1;
  const dir = join(ROOT, 'case' + String(seq));
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => resetMemoryStatus());

describe('detectMemoryCandidates', () => {
  test('rofm 的 memory/ 归档目录优先于它的根目录', () => {
    const dshHome = dshRoot();
    mkdirSync(join(dshHome, 'dsh-rofm', 'memory'), { recursive: true });
    writeFileSync(join(dshHome, 'dsh-rofm', 'memory', '2026-11-25.md'), '- 主人做了开源剥离\n', 'utf8');
    writeFileSync(join(dshHome, 'dsh-rofm', 'settings.json'), '{}', 'utf8');
    const [rofm] = detectMemoryCandidates(dshHome);
    assert.equal(rofm?.id, 'dsh-rofm');
    assert.equal(rofm?.installed, true);
    assert.ok(rofm?.dir.endsWith(join('dsh-rofm', 'memory')), '选归档目录而不是根');
    assert.equal(rofm?.evidence, 'memory/ 归档目录');
  });

  test('只有目录、没有记忆文件 → installed false（不算装了）', () => {
    const dshHome = dshRoot();
    mkdirSync(join(dshHome, 'dsh-suzu-memory'), { recursive: true });
    writeFileSync(join(dshHome, 'dsh-suzu-memory', 'desktop.ini'), 'x', 'utf8');
    const entry = detectMemoryCandidates(dshHome).find((item) => item.id === 'dsh-suzu-memory');
    assert.equal(entry?.installed, false);
    assert.equal(entry?.evidence, '没有记忆文件');
  });

  test('顺序固定：rofm 在前（与注册优先级一致）', () => {
    assert.deepEqual(
      detectMemoryCandidates(dshRoot()).map((item) => item.id),
      ['dsh-rofm', 'dsh-suzu-memory'],
    );
  });

  test('DSH 根不存在 → 全部未安装，不抛', () => {
    const list = detectMemoryCandidates(join(ROOT, 'nope'));
    assert.equal(list.length, 2);
    assert.ok(list.every((item) => !item.installed));
  });
});

describe('memoryView', () => {
  test('没接线 → provider null、候选为空', () => {
    assert.deepEqual(memoryView(), { provider: null, candidates: [], slotTakenByOther: false });
  });

  test('接上之后能看到 id / 目录 / 第一次读的条数', () => {
    setMemoryProviderStatus({
      id: 'dsh-rofm',
      dir: 'D:/x/memory',
      registeredAt: '2026-11-25T12:00:00.000Z',
      notes: 0,
      skipped: 0,
      lastReadAt: '',
    });
    updateMemoryReadResult(3, 1, '2026-11-25T12:00:01.000Z');
    const view = memoryView();
    assert.equal(view.provider?.id, 'dsh-rofm');
    assert.equal(view.provider?.notes, 3);
    assert.equal(view.provider?.skipped, 1);
    assert.equal(view.provider?.lastReadAt, '2026-11-25T12:00:01.000Z');
  });

  test('没有 provider 时 updateReadResult 是空操作', () => {
    updateMemoryReadResult(5, 0, '2026-11-25T12:00:00.000Z');
    assert.equal(memoryView().provider, null);
  });

  test('占槽标记可读（让用户看到「装了但被别人占着」）', () => {
    setMemoryCandidates([]);
    setMemorySlotTaken(true);
    assert.equal(memoryView().slotTakenByOther, true);
  });
});
