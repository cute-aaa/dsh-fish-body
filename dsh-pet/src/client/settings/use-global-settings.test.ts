/**
 * 全局开关状态（src/client/settings/use-global-settings.ts）的行为测试。
 *
 * 两条契约（取代原先「扫源码里有没有 fetch/PUT」的守卫）：
 *   1. 切开关只改本地状态：不得发任何请求——即时写盘会让宿主重启桌面 Helper，全部桌面宠物窗口重建；
 *   2. `apply` 只覆盖成品响应里出现的键：响应缺字段时保留手里的值，不拿 undefined 抹掉。
 *
 * 用最小 rt 替身跑 hook：`useState` 给独立的一格并把 setter 写入记下来，
 * `useCallback` 原样返回。不引入 react，也不重渲染——测的是「点了开关会发生什么」。
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { SettingsRuntime } from './runtime.ts';
import { useGlobalSettings } from './use-global-settings.ts';

/** 最小运行时：setter 记值，`useCallback` 直通。 */
function fakeRuntime(): { rt: Pick<SettingsRuntime, 'useState' | 'useCallback'>; writes: unknown[] } {
  const writes: unknown[] = [];
  const rt = {
    useState: ((init: unknown) => [
      init,
      (value: unknown) => {
        writes.push(value);
      },
    ]) as SettingsRuntime['useState'],
    useCallback: ((callback: unknown) => callback) as SettingsRuntime['useCallback'],
  };
  return { rt, writes };
}

/** 记录 fetch 调用次数；`requestNotificationPermission` 在无 Notification 的环境里不会发请求。 */
function spyFetch(): { calls: unknown[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: unknown[] = [];
  globalThis.fetch = ((...args: unknown[]) => {
    calls.push(args);
    return Promise.reject(new Error('切换开关不得发请求'));
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const spies: Array<() => void> = [];
afterEach(() => {
  while (spies.length > 0) spies.pop()?.();
});

describe('useGlobalSettings —— 切开关只改本地状态', () => {
  test('普通开关：只写本地值，不发请求', () => {
    const { rt, writes } = fakeRuntime();
    const spy = spyFetch();
    spies.push(spy.restore);
    const flags = useGlobalSettings(rt);

    flags.setFlag('sfxEnabled', false);
    flags.setFlag('confineToScreen', true);
    flags.setFlag('trayEnabled', false);

    assert.deepEqual(writes, [false, true, false], '每个开关各写一格');
    assert.equal(spy.calls.length, 0, '切开关不得即时写盘（会重启桌面 Helper）');
  });

  test('常驻预热：默认勾选，切一下只写本地值', () => {
    const { rt, writes } = fakeRuntime();
    const spy = spyFetch();
    spies.push(spy.restore);
    const flags = useGlobalSettings(rt);

    assert.deepEqual(flags.values.sfxKeepAlive, true, '常驻预热默认勾上（首声完整 + 混音器里可整体调音量）');
    flags.setFlag('sfxKeepAlive', false);

    assert.deepEqual(writes, [false]);
    assert.equal(spy.calls.length, 0, '切开关不得即时写盘');
  });

  test('音效音量：默认 0.5，apply 把响应里的值写进状态', () => {
    const { rt, writes } = fakeRuntime();
    const flags = useGlobalSettings(rt);

    assert.equal(flags.sfxVolume, 0.5, '内置默认 0.5（与其余提示音同一档）');
    flags.apply({ sfxVolume: 0.3 });
    assert.deepEqual(writes, [0.3], '音量补丁走 setState，不进开关的写入序列');
  });

  test('通知开关：同样只写本地值（权限申请由浏览器处理，不是写配置）', () => {
    const { rt, writes } = fakeRuntime();
    const spy = spyFetch();
    spies.push(spy.restore);
    const flags = useGlobalSettings(rt);

    flags.setFlag('notificationsEnabled', true);

    assert.deepEqual(writes, [true]);
    assert.equal(spy.calls.length, 0, '通知开关必须随「保存」写入，不能自己发请求');
  });
});

describe('useGlobalSettings —— apply 只覆盖响应里出现的键', () => {
  test('缺字段时保留手里的值', () => {
    const { rt, writes } = fakeRuntime();
    const flags = useGlobalSettings(rt);

    flags.apply({ trayEnabled: false });

    assert.deepEqual(writes, [false], '只写补丁里出现的那一个键');
  });

  test('字段齐全时逐个覆盖', () => {
    const { rt, writes } = fakeRuntime();
    const flags = useGlobalSettings(rt);

    flags.apply({
      notificationsEnabled: false,
      sfxEnabled: false,
      sfxKeepAlive: true,
      confineToScreen: true,
      trayEnabled: false,
    });

    assert.deepEqual(writes, [false, false, true, true, false]);
  });
});
