/**
 * 目录记忆（`src/client/settings/pick-dirs.ts`）的契约。
 *
 * 五条容易被误判的语义都钉在这里：
 *   1. **优先级**：本用途槽位 → `last` → 调用方兜底 → 不传 `start`（顺序错一次，用户就会莫名其妙落到别处）；
 *   2. **file 记父目录、folder 原样**，且 `\` 与 `/` 两种写法都要认（Windows 路径是主流）；
 *   3. **坏数据一律当「没记过」**：坏 JSON / 非对象 / 数组 / 空串 / 非字符串值 / `getItem` 抛错；
 *   4. **写入失败被吞**：配额满、隐私模式、`setItem` 抛错都不该让选择框失败；
 *   5. 没有存储口（`null`）时读是空对象、写是静默 no-op。
 *
 * 纯逻辑 + 可注入存储：不碰真 `localStorage`，也不碰 DOM。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  dirOfPickedPath,
  PICK_DIRS_KEY,
  pickDirStorage,
  readPickDirs,
  rememberPickDir,
  startFor,
} from './pick-dirs.ts';

/** 一个假存储：记下每一次 `setItem`，并可让 `getItem` / `setItem` 抛错。 */
function fakeStorage(initial: Record<string, string> = {}, opts: { getThrows?: boolean; setThrows?: boolean } = {}) {
  const data = new Map(Object.entries(initial));
  const writes: { key: string; value: string }[] = [];
  return {
    data,
    writes,
    storage: {
      getItem: (key: string): string | null => {
        if (opts.getThrows === true) throw new Error('getItem 不可用');
        return data.get(key) ?? null;
      },
      setItem: (key: string, value: string): void => {
        if (opts.setThrows === true) throw new Error('配额满了');
        writes.push({ key, value });
        data.set(key, value);
      },
    },
  };
}

describe('dirOfPickedPath：文件取父目录、目录原样', () => {
  test('file：`/` 与 `\\` 两种分隔符都要取对', () => {
    assert.equal(dirOfPickedPath('D:/AI/voice/klee.wav', 'file'), 'D:/AI/voice');
    assert.equal(dirOfPickedPath('D:\\AI\\voice\\klee.wav', 'file'), 'D:\\AI\\voice');
    assert.equal(dirOfPickedPath('D:/mixed\\dir/klee.wav', 'file'), 'D:/mixed\\dir');
  });

  test('folder：原样返回（不再往上退一层）', () => {
    assert.equal(dirOfPickedPath('D:/AI/AI-Voice', 'folder'), 'D:/AI/AI-Voice');
    assert.equal(dirOfPickedPath('D:\\AI\\AI-Voice', 'folder'), 'D:\\AI\\AI-Voice');
  });

  test('没有分隔符 / 空串：返回空串（不记一个假目录）', () => {
    assert.equal(dirOfPickedPath('klee.wav', 'file'), '');
    assert.equal(dirOfPickedPath('', 'file'), '');
    assert.equal(dirOfPickedPath('   ', 'folder'), '');
  });
});

describe('readPickDirs / rememberPickDir：读写往返', () => {
  test('选中文件 → 记父目录，同时更新该用途槽位与 last（单键一次写入）', () => {
    const fake = fakeStorage();
    rememberPickDir('refAudio', 'D:/AI/voice/klee.wav', 'file', fake.storage);

    assert.deepEqual(readPickDirs(fake.storage), { refAudio: 'D:/AI/voice', last: 'D:/AI/voice' });
    assert.equal(fake.writes.length, 1, '一次写入，不存在半写');
    assert.equal(fake.writes[0]?.key, PICK_DIRS_KEY);
    assert.deepEqual(JSON.parse(fake.writes[0]?.value ?? '{}'), { refAudio: 'D:/AI/voice', last: 'D:/AI/voice' });
  });

  test('选中目录 → 原样记住；再次写入不丢其它用途的槽位', () => {
    const fake = fakeStorage();
    rememberPickDir('weights', 'D:/AI/AI-Voice', 'folder', fake.storage);
    rememberPickDir('refText', 'D:/AI/txt/lines.txt', 'file', fake.storage);

    assert.deepEqual(readPickDirs(fake.storage), {
      weights: 'D:/AI/AI-Voice',
      refText: 'D:/AI/txt',
      last: 'D:/AI/txt',
    });
  });

  test('路径推导不出目录时不写（别把下一次指到无意义的位置）', () => {
    const fake = fakeStorage();
    rememberPickDir('refAudio', 'klee.wav', 'file', fake.storage);
    assert.equal(fake.writes.length, 0);
    assert.deepEqual(readPickDirs(fake.storage), {});
  });
});

describe('startFor：四级优先级', () => {
  test('本用途槽位 > last > 调用方兜底 > 不传 start', () => {
    const dirs = { weights: 'D:/w', refAudio: 'D:/a', last: 'D:/last' };
    assert.equal(startFor('refAudio', dirs), 'D:/a', '① 自己的槽位最优先');
    assert.equal(startFor('refText', dirs), 'D:/last', '② 没选过的用途回落到最近一次');
    assert.equal(startFor('refText', { last: 'D:/last' }, 'D:/draft'), 'D:/last', '② 仍然优先于兜底');
    assert.equal(startFor('refText', {}, '  D:/draft  '), 'D:/draft', '③ 没有记忆才用兜底（并 trim）');
    assert.equal(startFor('refText', {}, '   '), undefined, '④ 兜底是空白 → 不传 start');
    assert.equal(startFor('refText', {}), undefined, '④ 什么都没有 → 交给系统默认目录');
  });

  test('槽位里的空白串当作没有（防手改坏数据）', () => {
    assert.equal(startFor('refText', { refText: '   ', last: 'D:/last' }), 'D:/last');
  });
});

describe('坏数据一律当「没记过」', () => {
  /** 各种坏值：读出来都必须是空对象，「不抛」是硬要求。 */
  const cases: { name: string; raw: string }[] = [
    { name: '坏 JSON', raw: '{not json' },
    { name: '不是对象（数组）', raw: '[1,2,3]' },
    { name: '不是对象（字符串）', raw: '"D:/AI"' },
    { name: '不是对象（null）', raw: 'null' },
    { name: '空串值', raw: '{"refAudio":""}' },
    { name: '非字符串值', raw: '{"refAudio":42,"last":{}}' },
    { name: '未知键', raw: '{"schema":1}' },
  ];

  for (const item of cases) {
    test(item.name, () => {
      const fake = fakeStorage({ [PICK_DIRS_KEY]: item.raw });
      assert.deepEqual(readPickDirs(fake.storage), {});
    });
  }

  test('部分合法时只留合法的那几个', () => {
    const fake = fakeStorage({ [PICK_DIRS_KEY]: '{"refAudio":"D:/a","refText":null,"last":"  ","weights":"D:/w"}' });
    assert.deepEqual(readPickDirs(fake.storage), { refAudio: 'D:/a', weights: 'D:/w' });
  });

  test('没有存储口（null）：读是空对象、写是静默 no-op', () => {
    assert.deepEqual(readPickDirs(null), {});
    rememberPickDir('refAudio', 'D:/a/b.wav', 'file', null);
  });

  test('getItem 抛错 → 空对象；setItem 抛错 → 被吞（不让选择框失败）', () => {
    const broken = fakeStorage({}, { getThrows: true });
    assert.deepEqual(readPickDirs(broken.storage), {});
    assert.doesNotThrow(() => rememberPickDir('refAudio', 'D:/a/b.wav', 'file', broken.storage));

    const full = fakeStorage({}, { setThrows: true });
    assert.doesNotThrow(() => rememberPickDir('refAudio', 'D:/a/b.wav', 'file', full.storage));
  });
});

describe('pickDirStorage：没有 DOM / 访问器抛错时退化为「不记忆」', () => {
  test('拿得到 localStorage 就返回它；拿不到返回 null', () => {
    const holder = globalThis as { localStorage?: unknown };
    const original = holder.localStorage;
    try {
      holder.localStorage = undefined;
      assert.equal(pickDirStorage(), null, '没有 DOM（或隐私模式）→ null');

      const fake = fakeStorage();
      holder.localStorage = fake.storage;
      assert.equal(pickDirStorage(), fake.storage);

      // 访问器本身抛错（隐私模式下真的会）：也必须退化成 null，而不是把异常抛给 UI。
      Object.defineProperty(holder, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('SecurityError');
        },
      });
      assert.equal(pickDirStorage(), null);
    } finally {
      Object.defineProperty(holder, 'localStorage', { configurable: true, writable: true, value: original });
    }
  });
});
