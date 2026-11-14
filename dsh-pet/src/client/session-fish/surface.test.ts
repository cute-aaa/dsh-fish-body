/**
 * 会话鱼的显示面判定：鱼跟着桌宠走（桌宠只在桌面显示时，网页里就不该有鱼）。
 *
 * 只测纯判定：`petBridge` 是模块单例，用 before/after 把它恢复原样。
 * @module dsh-fish-body/src/client/session-fish/surface.test
 */
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyPetBridge, petBridge, subscribePetBridge } from '../settings/bridge.ts';
import { webPetVisible } from './surface.ts';
import type { Pet } from '../../shared/types.ts';

/** 一只最小宠物：只用 display。 */
function pet(display: string): Pet {
  return { id: 'main', name: '鱼生', display } as unknown as Pet;
}

let before: { current: Pet[]; ready: boolean };

beforeEach(() => {
  before = { current: petBridge.current, ready: petBridge.ready };
});

afterEach(() => {
  petBridge.current = before.current;
  petBridge.ready = before.ready;
});

describe('webPetVisible —— 鱼跟着桌宠的显示面走', () => {
  test('配置还没拍平：按「有桌宠」处理，避免浮层先闪一下再消失', () => {
    petBridge.ready = false;
    petBridge.current = [];
    assert.equal(webPetVisible(), true);
  });

  test('桌宠只在桌面显示：网页里没有鱼', () => {
    petBridge.ready = true;
    petBridge.current = [pet('desktop')];
    assert.equal(webPetVisible(), false);
  });

  test('web / both 都算在网页显示；none 与空列表都不算', () => {
    petBridge.ready = true;
    petBridge.current = [pet('web')];
    assert.equal(webPetVisible(), true);
    petBridge.current = [pet('both')];
    assert.equal(webPetVisible(), true);
    petBridge.current = [pet('none')];
    assert.equal(webPetVisible(), false);
    petBridge.current = [];
    assert.equal(webPetVisible(), false);
  });

  test('多只宠物：有一只 web 可见就算（与容器 pickSurfacePet 同口径）', () => {
    petBridge.ready = true;
    petBridge.current = [pet('desktop'), pet('web')];
    assert.equal(webPetVisible(), true);
  });
});

describe('petBridge 配置通知', () => {
  test('订阅后收到通知；取消订阅不再收到；单个订阅者抛错不影响其余', () => {
    const seen: string[] = [];
    const offA = subscribePetBridge(() => {
      seen.push('a');
      throw new Error('boom');
    });
    const offB = subscribePetBridge(() => seen.push('b'));
    notifyPetBridge();
    assert.deepEqual(seen, ['a', 'b'], 'a 抛错不该挡住 b');
    offA();
    offB();
    notifyPetBridge();
    assert.deepEqual(seen, ['a', 'b'], '退订后不再收到');
  });
});
