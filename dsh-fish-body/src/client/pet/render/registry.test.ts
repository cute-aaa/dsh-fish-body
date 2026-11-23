/**
 * 渲染后端注册表单元测试：注册、造实例、注销与重复拒绝。
 * @module dsh-fish-body/src/client/pet/render/registry.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRenderer, listRenderers, registerRenderer, resetRenderers } from './registry.ts';
import type { Renderer } from './types.ts';

/** 造一个最小合法渲染实例。 */
function fakeRenderer(kind: string): Renderer {
  return {
    kind: kind as Renderer['kind'],
    mount: () => {},
    destroy: () => {},
    playAction: () => {},
    setIdle: () => {},
    setEndedHandler: () => {},
    stopLooping: () => {},
    setFrozen: () => null,
    isFrozen: () => false,
    frontElement: () => null,
    progress: () => ({ playbackId: null, anim: '', currentTime: 0, duration: 0, paused: true, buffering: false }),
    ready: false,
  };
}

test('registerRenderer：注册后可按 kind 造实例并列出，注销后清空', () => {
  resetRenderers();
  const dispose = registerRenderer('webm', () => fakeRenderer('webm'));
  assert.deepEqual(listRenderers(), ['webm']);
  assert.equal(createRenderer('webm')?.kind, 'webm');
  dispose();
  assert.equal(createRenderer('webm'), undefined);
  assert.deepEqual(listRenderers(), []);
});

test('registerRenderer：kind 重复抛错，不覆盖先注册的', () => {
  resetRenderers();
  registerRenderer('webm', () => fakeRenderer('webm'));
  assert.throws(() => registerRenderer('webm', () => fakeRenderer('webm')), /重复/);
});

test('createRenderer：未注册 kind 返回 undefined', () => {
  resetRenderers();
  assert.equal(createRenderer('layered'), undefined);
});
