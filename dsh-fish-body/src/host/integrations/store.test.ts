/**
 * 接入配置存储契约：默认值、路径状态、外部授权与原子写入。
 * @module dsh-fish-body/src/host/integrations/store.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  inspectIntegrationPath,
  integrationsFile,
  integrationsView,
  prepareIntegrationsPatch,
  readIntegrations,
  writeIntegrations,
} from './store.ts';

describe('integrations store', () => {
  test('缺文件 → 默认值；写入后可读且留下备份', () => {
    const root = mkdtempSync(join(tmpdir(), 'fish-integrations-'));
    try {
      assert.deepEqual(readIntegrations(root).config.memory.mode, 'auto');
      const file = integrationsFile(root);
      mkdirSync(join(root, 'config'), { recursive: true });
      writeFileSync(file, JSON.stringify({ version: 1 }), 'utf8');
      writeIntegrations(root, {
        version: 1,
        persona: { customPath: null, approvedExternal: false },
        memory: { mode: 'auto', customDir: null, approvedExternal: false },
      });
      writeIntegrations(root, {
        version: 1,
        persona: { customPath: null, approvedExternal: false },
        memory: { mode: 'auto', customDir: null, approvedExternal: false },
      });
      assert.ok(readdirSync(join(root, 'config')).some((name) => name.startsWith('integrations.json.bak-')));
      assert.equal(readIntegrations(root).config.version, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('路径：根内可用，根外未授权拒绝，授权后可用', () => {
    const root = mkdtempSync(join(tmpdir(), 'fish-integrations-path-'));
    const outside = mkdtempSync(join(tmpdir(), 'fish-integrations-outside-'));
    try {
      const inside = join(root, 'persona.json');
      const external = join(outside, 'persona.md');
      writeFileSync(inside, '{}', 'utf8');
      writeFileSync(external, '# x', 'utf8');
      assert.equal(inspectIntegrationPath(inside, [root], false, 'any').ok, true);
      const blocked = inspectIntegrationPath(external, [root], false, 'any');
      assert.equal(blocked.ok, false);
      assert.equal(blocked.ok ? '' : blocked.state, 'unapproved');
      assert.equal(inspectIntegrationPath(external, [root], true, 'any').ok, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('相对路径与不存在路径分别返回 invalid / missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'fish-integrations-state-'));
    try {
      const relative = inspectIntegrationPath('persona.json', [root], false, 'any');
      assert.equal(relative.ok ? '' : relative.state, 'invalid');
      const missing = inspectIntegrationPath(join(root, 'nope.json'), [root], false, 'any');
      assert.equal(missing.ok ? '' : missing.state, 'missing');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('patch：外部 persona 需显式授权；memory custom 需要目录', () => {
    const root = mkdtempSync(join(tmpdir(), 'fish-integrations-patch-'));
    const outside = mkdtempSync(join(tmpdir(), 'fish-integrations-patch-out-'));
    try {
      const file = join(outside, 'persona.md');
      writeFileSync(file, '# p', 'utf8');
      const base = readIntegrations(root).config;
      const blocked = prepareIntegrationsPatch(base, { persona: { customPath: file } }, [root]);
      assert.equal(blocked.ok, false);
      assert.equal(blocked.ok ? '' : blocked.reason, 'external-approval-required');
      const approved = prepareIntegrationsPatch(base, { persona: { customPath: file, approvedExternal: true } }, [
        root,
      ]);
      assert.equal(approved.ok, true);
      if (approved.ok) assert.equal(approved.config.persona.approvedExternal, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('view：未配置是 unset，坏文件降级为默认', () => {
    const root = mkdtempSync(join(tmpdir(), 'fish-integrations-view-'));
    try {
      const view = integrationsView(root, [root]);
      assert.equal(view.persona.state, 'unset');
      assert.equal(view.memory.mode, 'auto');
      mkdirSync(join(root, 'config'), { recursive: true });
      writeFileSync(integrationsFile(root), '{ bad', 'utf8');
      assert.equal(readIntegrations(root).config.version, 1);
      assert.ok(readIntegrations(root).issue.length > 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
