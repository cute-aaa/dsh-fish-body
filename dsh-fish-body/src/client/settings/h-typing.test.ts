/**
 * `h` 的类型守卫（src/client/settings/runtime.ts）。
 *
 * 这类测试的断言在**编译期**：`tsc -p tsconfig.test.json` 会把整份测试一起检查。
 * 两条契约：
 *   1. 组件的 props 写错属性名必须报错——`@ts-expect-error` 若「没用了」会让 tsc 直接失败
 *      （真实事故：试听按钮的回调声明成 `onTest`、状态对象给的是 `test`，点了毫无反应）；
 *   2. 写对的调用不能报错——`@ts-expect-error` 只在真有错时才成立，写对却报错同样会红。
 *
 * 运行时只做一次最小调用，证明这套签名在跑起来之后仍然可用（元素工厂被原样调用）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { H } from './runtime.ts';
import { makeKindTabs } from './kind-tabs.ts';

/** 记录每次调用的假工厂：返回值只用于断言「真的被调用了」。 */
const calls: Array<{ type: unknown; props: unknown }> = [];
const h = ((type: unknown, props: unknown) => {
  calls.push({ type, props });
  return { type, props };
}) as unknown as H;

const KindTabs = makeKindTabs({ h, t: (key: string) => key });

describe('h 的类型守卫', () => {
  test('props 写对时调用成立，且原样转交给元素工厂', () => {
    calls.length = 0;
    const node = h(KindTabs, { kinds: [], kind: 'main', busy: false, onSelect: () => undefined });
    assert.equal(calls.length, 1, '组件调用应当只产生一个元素');
    assert.equal(calls[0].type, KindTabs);
    assert.ok(node !== null, '返回一个可渲染节点');
  });

  test('属性名写错会在编译期报错（runtype 只是把这一行留在文件里给 tsc 看）', () => {
    // @ts-expect-error 属性名拼错（onSelcet）必须被类型系统拦下；这条指令失效即说明 h 又变成了全 any
    h(KindTabs, { kinds: [], kind: 'main', busy: false, onSelcet: () => undefined });
    assert.ok(true, '运行时不做校验，拦截发生在 tsc 里');
  });
});
