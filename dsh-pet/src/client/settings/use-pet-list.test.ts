/**
 * 宠物列表状态的契约测试（`use-pet-list.ts` / `selection-memory.ts`）。
 *
 * 纯函数部分（种类归纳、main 层过滤、选择回落）与 hook 接线部分（首帧读记忆、四个写入点、
 * `replace()` 不写）分开断言：前者是规则，后者是「规则真的被接上了」——只测前者会留下
 * 「函数对、没人调」的空转实现。
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { mainPetsOf, petKinds, usePetList } from './use-pet-list.ts';
import { PET_STORAGE_KEY, readPetSelection, resolveSelection, savePetSelection } from './selection-memory.ts';
import type { TabStorage } from './tab-memory.ts';
import { petBridge } from './bridge.ts';
import type { ConfigEntry } from './config/index.ts';
import type { Pet } from '../../shared/types.ts';

/** 一只最小实例；`assetRoot` 省略时模拟「没打标的实例」。 */
const pet = (id: string, assetRoot?: string): Pet => ({
  id,
  name: id,
  size: 300,
  balanceEnabled: false,
  whisperEnabled: false,
  workStatusEnabled: false,
  fixedEnabled: false,
  display: 'web',
  position: { corner: 'top-right', marginX: 0, marginY: 0 },
  ...(assetRoot === undefined ? {} : { assetRoot }),
});

describe('petKinds —— 实例列表 → 种类条', () => {
  test('按首次出现顺序去重，并统计每种的实例数', () => {
    assert.deepEqual(petKinds([pet('m1', 'main'), pet('d1', 'daily'), pet('d2', 'daily'), pet('f1', 'festival')]), [
      { entry: 'main', kind: 'main', count: 1 },
      { entry: 'daily', kind: 'pack', count: 2 },
      { entry: 'festival', kind: 'pack', count: 1 },
    ]);
  });

  test('没有 assetRoot 的实例归到 main', () => {
    assert.deepEqual(petKinds([pet('x1')]), [{ entry: 'main', kind: 'main', count: 1 }]);
  });

  test('空列表：没有种类', () => {
    assert.deepEqual(petKinds([]), []);
  });
});

describe('mainPetsOf —— PUT /config 的提交内容', () => {
  test('只留 main 层实例：pack 实例不得进用户主配置', () => {
    const pets = [pet('m1', 'main'), pet('d1', 'daily'), pet('f1', 'festival'), pet('x1')];
    assert.deepEqual(
      mainPetsOf(pets).map((item) => item.id),
      ['m1', 'x1'],
      '没有 assetRoot 的老实例算 main，pack 实例必须排除',
    );
  });
});

// ───────────────────────────── R3：实例选择记忆 ─────────────────────────────

/** 内存存储替身（与 tab-memory.test.ts 同形）；`fail` 为真时读写都抛（模拟隐私模式）。 */
const fakeStorage = (
  initial: Record<string, string> = {},
  options: { fail?: boolean } = {},
): TabStorage & { readonly data: Map<string, string> } => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key) {
      if (options.fail) throw new Error('storage disabled');
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (options.fail) throw new Error('storage disabled');
      data.set(key, value);
    },
  };
};

/** 一只带种类的实例（同文件的 `pet` 助手，但允许补字段）。 */
const petOf = (id: string, assetRoot?: string): Pet => pet(id, assetRoot);

describe('resolveSelection —— 由「记住的 id」+「权威列表」算一次有效选择', () => {
  const pets = [petOf('m1', 'main'), petOf('m2', 'main'), petOf('d1', 'daily')];

  test('① 命中：记住的那只还在 → 用它，种类就是它自己的', () => {
    assert.deepEqual(resolveSelection('m2', pets, 'main'), { petId: 'm2', kind: 'main' });
  });

  test('① 命中且跨种类：种类条被一并纠正（否则卡片与 chip 行对不上）', () => {
    assert.deepEqual(
      resolveSelection('d1', pets, 'main'),
      { petId: 'd1', kind: 'daily' },
      '记住的是 daily 的那只，就不能停在 main 种类',
    );
  });

  test('② 不存在：回落到 fallbackKind 的第一只', () => {
    assert.deepEqual(resolveSelection('gone', pets, 'daily'), { petId: 'd1', kind: 'daily' });
  });

  test('② 没有记忆（null / 空串同义）：同样回落第一只', () => {
    assert.deepEqual(resolveSelection(null, pets, 'main'), { petId: 'm1', kind: 'main' });
  });

  test('③ 空列表：交出空选择，不抛', () => {
    assert.deepEqual(resolveSelection('m2', [], 'main'), { petId: '', kind: 'main' });
    assert.deepEqual(resolveSelection(null, [], 'daily'), { petId: '', kind: 'daily' });
  });

  test('③ 记忆的种类一只都不剩：退回列表第一只，别留一整页空白', () => {
    const only = [petOf('d1', 'daily')];
    assert.deepEqual(resolveSelection('m1', only, 'main'), { petId: 'd1', kind: 'daily' });
  });

  test('没有 assetRoot 的老实例：种类算 main', () => {
    assert.deepEqual(resolveSelection('x1', [petOf('x1')], 'daily'), { petId: 'x1', kind: 'main' });
  });
});

describe('readPetSelection / savePetSelection —— 读写边界', () => {
  test('存的是裸 petId（key = dsh-pet/settings-pet）', () => {
    assert.equal(PET_STORAGE_KEY, 'dsh-pet/settings-pet');
    const storage = fakeStorage();
    savePetSelection(storage, 'pet-2');
    assert.equal(storage.data.get(PET_STORAGE_KEY), 'pet-2');
    assert.equal(readPetSelection(storage), 'pet-2');
  });

  test('空串 / 没记过 → null（= 不记忆，回落第一只）', () => {
    assert.equal(readPetSelection(fakeStorage()), null);
    assert.equal(readPetSelection(fakeStorage({ [PET_STORAGE_KEY]: '' })), null);
  });

  test('存储不可用或抛错：读回 null、写入不抛（隐私模式不该让切换实例失败）', () => {
    assert.equal(readPetSelection(null), null);
    assert.doesNotThrow(() => savePetSelection(null, 'm1'));
    const broken = fakeStorage({}, { fail: true });
    assert.equal(readPetSelection(broken), null);
    assert.doesNotThrow(() => savePetSelection(broken, 'm1'));
  });
});

/** 假 react：状态槽与 ref 槽跨渲染共享（本 hook 只用 useState / useCallback / useRef）。 */
function createRuntime() {
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  let cursor = 0;
  const useState = ((init: unknown) => {
    const index = cursor;
    cursor += 1;
    if (!(index in states)) states[index] = typeof init === 'function' ? (init as () => unknown)() : init;
    const set = (next: unknown): void => {
      states[index] = typeof next === 'function' ? (next as (previous: unknown) => unknown)(states[index]) : next;
    };
    return [states[index], set];
  }) as never;
  const useRef = ((init: unknown) => {
    const index = cursor;
    cursor += 1;
    if (!(index in refs)) refs[index] = { current: init };
    return refs[index];
  }) as never;
  // 引用稳定性与断言无关：原样返回，省掉依赖数组的比较逻辑
  const useCallback = ((fn: unknown) => fn) as never;
  return {
    rt: { useState, useRef, useCallback } as never,
    render<T>(run: () => T): T {
      cursor = 0;
      return run();
    },
  };
}

/** 装上假的 `localStorage`（Node 默认没有），并记录每一次写入。 */
function installStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: string[] = [];
  const fake = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
      writes.push(key + '=' + value);
    },
  };
  (globalThis as unknown as { localStorage?: typeof fake }).localStorage = fake;
  return {
    data,
    writes,
    restore: () => {
      delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    },
  };
}

/** 造一条 ConfigEntry（`replace()` 的入参形状）。 */
const entryOf = (key: string, pets: Pet[]): ConfigEntry => ({
  key,
  kind: key === 'main' ? 'main' : 'pack',
  entryPrompt: key + ' 的人设',
  pets,
});

describe('usePetList —— 选择记忆的接线（首帧 / 四个写入点 / replace 不写）', () => {
  const originalBridge = petBridge.current;
  const restores: Array<() => void> = [];

  /** 起一个 hook 实例；返回渲染结果与「再渲染一次」的入口。 */
  function mount(initialPets: Pet[], storageSeed: Record<string, string> = {}) {
    petBridge.current = initialPets;
    const store = installStorage(storageSeed);
    restores.push(store.restore);
    const runtime = createRuntime();
    const render = () => runtime.render(() => usePetList(runtime.rt, () => {}));
    let list = render();
    return {
      store,
      get current() {
        return list;
      },
      /** 重渲染（读到的仍是同一批状态槽，模拟 React 的下一次渲染）。 */
      rerender() {
        list = render();
        return list;
      },
    };
  }

  afterEach(() => {
    petBridge.current = originalBridge;
    for (const restore of restores.splice(0)) restore();
  });

  const three = (): Pet[] => [petOf('m1', 'main'), petOf('m2', 'main'), petOf('d1', 'daily')];

  test('刷新后仍停在原来那只（记忆命中）', () => {
    const app = mount(three(), { [PET_STORAGE_KEY]: 'm2' });
    assert.equal(app.current.selId, 'm2');
    assert.equal(app.current.kind, 'main');
  });

  test('记忆里那只被删了 → 回落第一只，不报错不空白', () => {
    const app = mount(three(), { [PET_STORAGE_KEY]: 'deleted-pet' });
    assert.equal(app.current.selId, 'm1');
    assert.equal(app.current.kind, 'main');
  });

  test('记忆指向别的种类 → 种类条一并纠正', () => {
    const app = mount(three(), { [PET_STORAGE_KEY]: 'd1' });
    assert.equal(app.current.selId, 'd1');
    assert.equal(app.current.kind, 'daily');
    assert.deepEqual(
      app.current.visiblePets.map((item) => item.id),
      ['d1'],
      '可见列表必须跟上被纠正的种类',
    );
  });

  test('没有可用的 localStorage（隐私模式）：正常渲染并回落第一只', () => {
    petBridge.current = three();
    const runtime = createRuntime();
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    const list = runtime.render(() => usePetList(runtime.rt, () => {}));
    assert.equal(list.selId, 'm1');
    petBridge.current = originalBridge;
  });

  test('四个写入点各写一次存储：select / selectKind / add / remove', () => {
    const app = mount(three());
    assert.deepEqual(app.store.writes, [], '首帧不该写存储');

    app.current.select('m2');
    assert.deepEqual(app.store.writes, [PET_STORAGE_KEY + '=m2']);

    app.rerender();
    app.current.selectKind('daily');
    assert.equal(app.store.writes[1], PET_STORAGE_KEY + '=d1', '切种类会选中它的第一只，并记住');

    app.rerender();
    app.current.selectKind('main');
    app.rerender();
    app.current.add();
    app.rerender();
    const addedId = app.current.selId;
    assert.ok(addedId !== 'm1' && addedId !== 'm2', '新增的实例应当是新的 id');
    assert.equal(app.store.writes[3], PET_STORAGE_KEY + '=' + addedId, '新增即选中，并记住新 id');

    app.current.remove();
    app.rerender();
    assert.equal(app.store.writes[4], PET_STORAGE_KEY + '=' + app.current.selId, '删完落到谁就记谁');
    assert.equal(app.store.writes.length, 5, '五个用户动作 = 五次写入，不多不少');
  });

  test('删掉某个种类的最后一只：种类条跟着搬到剩下的那只（不留空种类、也不记错的 id）', () => {
    const app = mount(three(), { [PET_STORAGE_KEY]: 'd1' });
    assert.equal(app.current.kind, 'daily', '前提：停在 daily 那一只');
    app.current.remove();
    app.rerender();
    assert.equal(app.current.kind, 'main', 'daily 已经一只不剩 → 种类要搬到 main');
    assert.equal(app.current.selId, 'm1');
    assert.deepEqual(
      app.current.visiblePets.map((pet) => pet.id),
      ['m1', 'm2'],
      '可见列表必须跟着种类走',
    );
    assert.equal(
      app.store.writes[app.store.writes.length - 1],
      PET_STORAGE_KEY + '=m1',
      '记的是真正落到的那一只（不是被删掉的 d1）',
    );
  });

  test('删到一只不剩：不写存储（空串会盖掉上一次的记忆，而它下次仍要校验）', () => {
    const app = mount([petOf('only', 'main')]);
    app.current.remove();
    app.rerender();
    assert.equal(app.current.selId, '');
    assert.deepEqual(app.store.writes, [], '没有真实选择时不该写');
  });

  test('同种类里还有别的实例：留在这一种类，不跨种类乱跳', () => {
    const app = mount([petOf('m1', 'main'), petOf('m2', 'main'), petOf('d1', 'daily')], { [PET_STORAGE_KEY]: 'm1' });
    app.current.remove();
    app.rerender();
    assert.equal(app.current.kind, 'main');
    assert.equal(app.current.selId, 'm2', '删 m1 后留在 main 的下一个');
  });

  test('replace() 是对账不是用户动作：一次都不写存储', () => {
    const app = mount(three(), { [PET_STORAGE_KEY]: 'm2' });
    app.current.replace([entryOf('main', [petOf('m1', 'main')]), entryOf('daily', [petOf('d1', 'daily')])]);
    app.rerender();
    assert.deepEqual(app.store.writes, [], 'replace 不写');
    assert.equal(app.current.selId, 'm1', '原来那只不在了 → 回落 nextKind 的第一只');
  });

  test('replace() 保住仍在列表里的选择，并把种类纠正到它自己', () => {
    const app = mount(three(), { [PET_STORAGE_KEY]: 'd1' });
    app.current.replace([
      entryOf('main', [petOf('m1', 'main'), petOf('m2', 'main')]),
      entryOf('daily', [petOf('d1', 'daily')]),
    ]);
    app.rerender();
    assert.equal(app.current.selId, 'd1');
    assert.equal(app.current.kind, 'daily');
    assert.deepEqual(app.store.writes, []);
  });

  test('首帧列表还不完整时不丢记忆：后来的权威列表里出现它，就停在它上面', () => {
    // 真实场景：容器拍平是异步的，设置页先渲染时 petBridge.current 可能只有 main 那一只；
    // 这时按已解析出来的 selId 校验就会把记忆当成「已被删掉」而永远回落到第一只
    // （浏览器 E2E「刷新后仍停在第二只」抓到的正是这个缺口）。
    const app = mount([petOf('m1', 'main')], { [PET_STORAGE_KEY]: 'pet-2' });
    assert.equal(app.current.selId, 'm1', '首帧只有一只，先显示它');
    assert.equal(app.current.kind, 'main');

    app.current.replace([
      entryOf('main', [petOf('m1', 'main'), petOf('pet-2', 'main')]),
      entryOf('daily', [petOf('d1', 'daily')]),
    ]);
    app.rerender();
    assert.equal(app.current.selId, 'pet-2', '权威列表到达后，记忆里的那只必须被选中');
    assert.equal(app.current.kind, 'main');
    assert.deepEqual(app.store.writes, [], 'replace 仍然不写');
  });

  test('用户先自己点了一只，之后 replace 以用户的选择为准（记忆不是圣旨）', () => {
    const app = mount(three(), { [PET_STORAGE_KEY]: 'd1' });
    app.current.select('m1');
    app.current.replace([
      entryOf('main', [petOf('m1', 'main'), petOf('pet-2', 'main')]),
      entryOf('daily', [petOf('d1', 'daily')]),
    ]);
    app.rerender();
    assert.equal(app.current.selId, 'm1', '用户刚选的那只优先于旧记忆');
    assert.equal(app.current.kind, 'main');
  });
});
