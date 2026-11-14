/**
 * 人格来源注册表单元测试：注册、按 id 查、注销与重复 id 拒绝。
 * @module dsh-fish-body/src/host/persona-source/registry.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { listPersonaSources, personaSource, registerPersonaSource, resetPersonaSources } from './registry.ts';

/** 造一个最小合法来源。 */
function fakeSource(id: string) {
  return {
    id,
    name: id,
    resolve: async (): Promise<{ ok: false; reason: 'not-found' }> => ({ ok: false, reason: 'not-found' }),
  };
}

test('registerPersonaSource：注册后可按 id 取到并列出，注销后清空', () => {
  resetPersonaSources();
  const dispose = registerPersonaSource(fakeSource('fish-soul'));
  assert.equal(personaSource('fish-soul')?.id, 'fish-soul');
  assert.deepEqual(listPersonaSources(), [{ id: 'fish-soul', name: 'fish-soul' }]);
  dispose();
  assert.equal(personaSource('fish-soul'), undefined);
  assert.deepEqual(listPersonaSources(), []);
});

test('registerPersonaSource：id 重复抛错，不覆盖先注册的', () => {
  resetPersonaSources();
  registerPersonaSource(fakeSource('a'));
  assert.throws(() => registerPersonaSource(fakeSource('a')), /重复/);
  assert.equal(personaSource('a')?.name, 'a');
});

test('registerPersonaSource：id / name / resolve 非法时抛错', () => {
  resetPersonaSources();
  const valid = fakeSource('x') as Record<string, unknown>;
  assert.throws(() => registerPersonaSource({ ...valid, id: '' } as never), /id/);
  assert.throws(() => registerPersonaSource({ ...valid, name: '' } as never), /name/);
  assert.throws(() => registerPersonaSource({ ...valid, resolve: 1 } as never), /resolve/);
});
