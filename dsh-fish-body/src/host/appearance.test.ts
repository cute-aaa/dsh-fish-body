/**
 * 外观快照表（src/host/appearance）的契约测试：上报归一化、整份替换、未知宠物回落。
 *
 * 三条契约：
 *   1. 上报是**全量**语义：`expressions` 就是此刻挂着的完整名单，宿主整份替换（增量会让漏报一拍永久跑偏）；
 *   2. 坏形状直接拒（调用方回 bad-request）——静默改写成空会让「什么都没戴」被当成真值，比报错更难查；
 *   3. 没上报过与「上报过但空」是两件事：`get` 返回 undefined vs `{ expressions: [] }`。
 *
 * 跑法：node --experimental-strip-types --test src/host/appearance.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { AppearanceStore, normalizeAppearance } from './appearance.ts';

describe('normalizeAppearance —— 上报体归一化', () => {
  test('合法上报：名字去空白、去重、丢弃非字符串', () => {
    const r = normalizeAppearance({ expressions: [' 兔牙 ', '兔牙', '', 42, '单片眼镜'] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok === true && r.value.expressions, ['兔牙', '单片眼镜']);
  });

  test('缺省 expressions = 空名单（摘光也是合法上报）', () => {
    const r = normalizeAppearance({});
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok === true && r.value.expressions, []);
  });

  test('action 空串不进快照（没演过就不该有字段）', () => {
    const r = normalizeAppearance({ expressions: [], action: '   ' });
    assert.equal(r.ok === true && r.value.action, undefined);
  });

  test('坏形状直接拒：非对象 / expressions 不是数组 / action 不是字符串', () => {
    assert.equal(normalizeAppearance(null).ok, false);
    assert.equal(normalizeAppearance([]).ok, false);
    assert.equal(normalizeAppearance({ expressions: '兔牙' }).ok, false);
    assert.equal(normalizeAppearance({ expressions: [], action: 1 }).ok, false);
  });

  test('超长与超量的名字被丢掉（防坏数据撑爆提示词）', () => {
    const many = Array.from({ length: 40 }, (_, i) => '外观' + String(i));
    const r = normalizeAppearance({ expressions: [...many, 'x'.repeat(200)] });
    assert.ok(r.ok === true && r.value.expressions.length <= 16);
    assert.ok(r.ok === true && !r.value.expressions.includes('x'.repeat(200)));
  });
});

describe('AppearanceStore —— 快照读写', () => {
  test('没上报过：get 返回 undefined（与「上报过但空」区分开）', () => {
    const store = new AppearanceStore();
    assert.equal(store.get('main'), undefined);
  });

  test('上报是整份替换，不是追加', () => {
    const store = new AppearanceStore();
    store.set('main', { expressions: ['兔牙'] });
    store.set('main', { expressions: ['单片眼镜'] });
    assert.deepEqual(store.get('main')?.expressions, ['单片眼镜']);
  });

  test('上报过但空：返回快照且名单为空（= 摘光了）', () => {
    const store = new AppearanceStore();
    store.set('main', { expressions: [] });
    const snap = store.get('main');
    assert.ok(snap !== undefined);
    assert.deepEqual(snap.expressions, []);
  });

  test('按宠物分开存；clear 只清一只', () => {
    const store = new AppearanceStore({ now: () => 1234 });
    store.set('main', { expressions: ['兔牙'] });
    store.set('pet-2', { expressions: ['单片眼镜'], action: '抚胸手打开' });
    assert.equal(store.get('main')?.updatedAt, 1234);
    assert.equal(store.get('pet-2')?.action, '抚胸手打开');
    store.clear('main');
    assert.equal(store.get('main'), undefined);
    assert.deepEqual(store.get('pet-2')?.expressions, ['单片眼镜']);
  });
});
