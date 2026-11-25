/**
 * `/integrations` 路由协议：GET / PUT、非法 JSON 与外部授权失败。
 * @module dsh-fish-body/src/host/routes/integrations.test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createIntegrationsController } from '../integrations/controller.ts';
import { handleIntegrationsRoutes } from './integrations.ts';

function depsFor(root: string) {
  return {
    integrations: createIntegrationsController({
      userRoot: root,
      roots: [root],
      applyMemory: () => ({ ok: true, providerId: null }),
    }),
  } as never;
}

function input(method: string, body?: string) {
  return { url: new URL('http://127.0.0.1/dsh-pet-7340/integrations'), rest: 'integrations', method, body };
}

describe('/integrations', () => {
  test('GET 返回默认视图', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fish-integrations-route-'));
    try {
      const result = await handleIntegrationsRoutes(depsFor(root), input('GET'));
      assert.equal(result?.kind, 'json');
      if (result?.kind === 'json') {
        assert.equal(result.status, 200);
        assert.equal((result.obj as { ok?: boolean }).ok, true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('PUT 保存根内路径；外部路径未授权回 200 + ok:false', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fish-integrations-route-path-'));
    const outside = mkdtempSync(join(tmpdir(), 'fish-integrations-route-out-'));
    try {
      const inside = join(root, 'persona.md');
      const external = join(outside, 'persona.md');
      writeFileSync(inside, '# p', 'utf8');
      writeFileSync(external, '# p', 'utf8');
      const ok = await handleIntegrationsRoutes(
        depsFor(root),
        input('PUT', JSON.stringify({ persona: { customPath: inside } })),
      );
      assert.equal(ok?.kind, 'json');
      if (ok?.kind === 'json') assert.equal((ok.obj as { ok?: boolean }).ok, true);
      const blocked = await handleIntegrationsRoutes(
        depsFor(root),
        input('PUT', JSON.stringify({ persona: { customPath: external } })),
      );
      assert.equal(blocked?.kind, 'json');
      if (blocked?.kind === 'json') {
        assert.equal(blocked.status, 200);
        assert.equal((blocked.obj as { ok?: boolean }).ok, false);
        assert.equal((blocked.obj as { reason?: string }).reason, 'external-approval-required');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('非法 JSON 返回 400；未知方法返回 405', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fish-integrations-route-bad-'));
    try {
      const bad = await handleIntegrationsRoutes(depsFor(root), input('PUT', '{ nope'));
      assert.equal(bad?.kind, 'json');
      if (bad?.kind === 'json') assert.equal(bad.status, 400);
      const method = await handleIntegrationsRoutes(depsFor(root), input('POST', '{}'));
      assert.equal(method?.kind, 'json');
      if (method?.kind === 'json') assert.equal(method.status, 405);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
