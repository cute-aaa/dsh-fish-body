/**
 * 音色导入界面（src/client/settings/voice-import.ts）的契约测试。
 *
 * 三条契约：
 *   1. 默认不放法按磁盘判：同盘 → 引用（硬链接），跨盘 → 复制（引用会置灰）；
 *   2. 勾选行 → 请求条目：有 GPT 就作锚点，另一侧进 counterpartPath，只有一侧时留空；
 *   3. 卡里那一段是「导入音色…」+「扫描音色」+ 结构说明（*.ckpt 与 *.pth 各占一行）；
 *      弹窗关着时不渲染任何东西，开着且音色包目录为空时要明说「先去保存」，导入按钮不可点；
 *      权重目录既能手输也能弹系统选择框——原生框弹不出来时这条路仍然通。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { jsx } from 'react/jsx-runtime';
import type { WeightImportCandidateView } from '../../shared/voice-pack.ts';
import { PICK_DIRS_KEY } from './pick-dirs.ts';
import { buildImportItems, makeVoiceImportDialog, makeVoiceImportRow, rowStateOf } from './voice-import.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;

/**
 * 手搓一个带 useState / useRef / useEffect 的运行时：同一个槽位在多次渲染之间保留值。
 *
 * 假渲染没有提交阶段，`useEffect` 当场执行——本文件的组件只用它做「行状态镜像同步」，幂等。
 * `setSlot` 是给「清单被外部重建」这类时序用的白盒口子（真 React 里由重新扫描触发）。
 * `translate` 可换成「保留占位符」的版本，用来断言 `{m}` 这种计数真的进了文案。
 */
function fakeRuntime(translate: (key: string) => string = (key) => key) {
  const slots: unknown[] = [];
  let cursor = 0;
  const useState = <T>(init: T): readonly [T, (next: T | ((prev: T) => T)) => void] => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = init;
    const set = (next: T | ((prev: T) => T)): void => {
      slots[index] = typeof next === 'function' ? (next as (prev: T) => T)(slots[index] as T) : next;
    };
    return [slots[index] as T, set];
  };
  const useRef = <T>(init: T): { current: T } => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: init };
    return slots[index] as { current: T };
  };
  const useEffect = (effect: () => void): void => {
    effect();
  };
  return {
    rt: { h, t: translate, useState, useRef, useEffect } as never,
    reset: (): void => {
      cursor = 0;
    },
    setSlot: (index: number, value: unknown): void => {
      slots[index] = value;
    },
    slot: (index: number): unknown => slots[index],
  };
}

function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

/** 节点子树里的全部文本片段（假 t 直接把键当文案）。 */
function texts(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  if (node === null || node === undefined || typeof node !== 'object') return [];
  return texts((node as Node).props?.children);
}

/** 子节点里某个文案。 */
const hasText = (node: Node, text: string): boolean => texts(node.props?.children).includes(text);

/** 按文案找按钮。 */
const buttonOf = (tree: unknown, text: string): Node | undefined =>
  flatten(tree).find((node) => node.tag === 'button' && hasText(node, text));

/** 一条候选。 */
function candidateOf(patch: Partial<WeightImportCandidateView> & { id: string }): WeightImportCandidateView {
  return {
    gptFiles: [`D:/gpt/${patch.id}-gsv-e10.ckpt`],
    sovitsFiles: [`D:/sovits/${patch.id}-gsv_e8_s288.pth`],
    gptPath: `D:/gpt/${patch.id}-gsv-e10.ckpt`,
    sovitsPath: `D:/sovits/${patch.id}-gsv_e8_s288.pth`,
    bytes: 229 * 1024 * 1024,
    linkable: true,
    installed: false,
    warnings: [],
    ...patch,
  };
}

/** 一次「读取权重目录」的宿主应答（`mode: 'weights'`）。 */
const scanFixture = {
  root: 'D:/w',
  gptDirs: ['D:/w/GPT_weights'],
  sovitsDirs: ['D:/w/SoVITS_weights'],
  voicesDir: 'D:/AI/GSV-voices',
  adopted: 1,
  notes: [],
  candidates: [candidateOf({ id: 'klee' }), candidateOf({ id: 'hutao' })],
};

/** 等 Promise 链跑完（假渲染没有调度器，只能手动放行微任务）。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 用假 `fetch` 代替宿主：`pickFile` / `postJson` 走的还是真实实现（含请求体与解析），
 * 只把网络这一层换掉——这样断言覆盖的是「客户端真的按下这条路走」。
 */
function stubFetch(handler: (url: string, body: unknown) => unknown) {
  const original = globalThis.fetch;
  const calls: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ url, body });
    return { ok: true, status: 200, json: async () => handler(url, body) } as unknown as Response;
  }) as typeof fetch;
  return {
    calls,
    restore: (): void => {
      globalThis.fetch = original;
    },
  };
}

/** 带某个类名的节点。 */
const classOf = (node: Node): string => (typeof node.props?.className === 'string' ? node.props.className : '');

/** 清单里某一行（以勾选框的 aria-label 认领）。 */
const rowNodeOf = (tree: unknown, id: string): Node | undefined =>
  flatten(tree).find(
    (node) =>
      classOf(node).includes('__impRow') &&
      flatten(node).some(
        (inner) => inner.tag === 'input' && inner.props.type === 'checkbox' && inner.props['aria-label'] === id,
      ),
  );

/** 某个节点里第一个满足条件的元素。 */
const nodeIn = (tree: unknown, match: (node: Node) => boolean): Node | undefined => flatten(tree).find(match);

describe('rowStateOf / buildImportItems', () => {
  test('默认不放法按磁盘判：同盘引用，跨盘复制且引用会被置灰', () => {
    const same = rowStateOf(candidateOf({ id: 'klee' }));
    assert.equal(same.placement, 'hardlink');
    assert.equal(same.checked, false, '默认不勾：清单常常十几行，勾了才可编辑');
    assert.equal(same.gpt, 'D:/gpt/klee-gsv-e10.ckpt');

    const cross = rowStateOf(candidateOf({ id: 'klee', linkable: false, warnings: ['跨盘'] }));
    assert.equal(cross.placement, 'copy', '跨盘不能预选「引用」');
  });

  test('勾选行 → 请求条目：锚点、另一侧与放法', () => {
    const klee = candidateOf({ id: 'klee' });
    const hutao = candidateOf({ id: 'hutao', sovitsFiles: [], sovitsPath: undefined });
    const ayaka = candidateOf({ id: 'ayaka' });
    const rows = {
      klee: { ...rowStateOf(klee), checked: true, refAudioPath: 'D:/in/klee.wav', refText: '甲' },
      hutao: { ...rowStateOf(hutao), checked: true, refAudioPath: 'D:/in/hutao.wav', refText: '乙' },
      ayaka: { ...rowStateOf(ayaka), checked: false },
    };
    const items = buildImportItems(
      [klee, hutao].filter((candidate) => rows[candidate.id as 'klee'].checked),
      rows,
      true,
    );
    assert.equal(items.length, 2, '只导勾选的两行');
    assert.deepEqual(items[0], {
      provider: 'gsv',
      weightPath: 'D:/gpt/klee-gsv-e10.ckpt',
      counterpartPath: 'D:/sovits/klee-gsv_e8_s288.pth',
      refAudioPath: 'D:/in/klee.wav',
      refText: '甲',
      id: 'klee',
      placement: 'hardlink',
      overwrite: true,
    });
    assert.equal(items[1]?.counterpartPath, '', '只有一侧时另一侧留空（导入后置灰）');
    assert.equal(items[1]?.weightPath, 'D:/gpt/hutao-gsv-e10.ckpt');
  });

  test('只有 SoVITS 一侧：以它为锚点', () => {
    const only = candidateOf({ id: 'norma', gptFiles: [], gptPath: undefined });
    const rows = { norma: { ...rowStateOf(only), checked: true, refAudioPath: 'D:/in/n.wav' } };
    const items = buildImportItems([only], rows, false);
    assert.equal(items[0]?.weightPath, 'D:/sovits/norma-gsv_e8_s288.pth');
    assert.equal(items[0]?.placement, 'hardlink');
  });
});

describe('VoiceImportRow', () => {
  test('两个按钮（导入 / 扫描）+ 结构说明；点按钮回调 onOpen', () => {
    const { rt } = fakeRuntime();
    let opened = 0;
    const tree = makeVoiceImportRow(rt)({ busy: false, onOpen: () => (opened += 1), onScanned: () => {} } as never);
    const button = buttonOf(tree, 'voiceImportOpen');
    assert.ok(button, '卡里必须有「导入音色…」按钮');
    (button.props.onClick as () => void)();
    assert.equal(opened, 1);
    assert.ok(buttonOf(tree, 'voiceScan'), '重新同步目录里现有的音色：扫描按钮');

    const treeRows = flatten(tree).filter((node) => String(node.props.className ?? '').includes('__treeRow'));
    assert.equal(treeRows.length, 5, '目录结构五行：<id>/ ref.wav ref.txt *.ckpt *.pth');
    assert.equal(hasText(treeRows[1] as Node, 'voiceImportTreeRef'), true);
    // .ckpt 与 .pth 是同级的两类文件：各占一行，不能写成「*.ckpt / *.pth」。
    assert.equal(hasText(treeRows[3] as Node, 'voiceImportTreeGpt'), true);
    assert.equal(hasText(treeRows[4] as Node, 'voiceImportTreeSovits'), true);
  });

  test('busy 时两个按钮都禁用', () => {
    const { rt } = fakeRuntime();
    const tree = makeVoiceImportRow(rt)({ busy: true, onOpen: () => {}, onScanned: () => {} } as never);
    assert.equal(buttonOf(tree, 'voiceImportOpen')?.props.disabled, true);
    assert.equal(buttonOf(tree, 'voiceScan')?.props.disabled, true);
  });
});

describe('VoiceImportDialog', () => {
  test('关着的时候什么都不渲染', () => {
    const { rt, reset } = fakeRuntime();
    const Dialog = makeVoiceImportDialog(rt);
    reset();
    assert.equal(
      Dialog({ open: false, busy: false, draftVoicesDir: '', onClose: () => {}, onRefresh: () => {} } as never),
      null,
    );
  });

  test('打开：标题 / 选目录 / 导入不可点；音色包目录为空时明确指路', () => {
    const { rt, reset } = fakeRuntime();
    const Dialog = makeVoiceImportDialog(rt);
    reset();
    const tree = Dialog({
      open: true,
      busy: false,
      draftVoicesDir: '',
      onClose: () => {},
      onRefresh: () => {},
    } as never);
    assert.ok(buttonOf(tree, 'voiceImportPickRoot'), '还没选根：给「选择权重目录…」');
    assert.equal(buttonOf(tree, 'voiceImportStart')?.props.disabled, true, '没扫描过就不能导');
    const dialog = flatten(tree).find((node) => String(node.props.className ?? '').includes('__dialog'));
    assert.ok(dialog);
    assert.equal(hasText(dialog as Node, 'voiceImportTitle'), true);
    assert.equal(hasText(dialog as Node, 'voiceImportPackMissing'), true, '目录没配要明说');
  });

  test('打开且有草稿目录：显示路径而不是「还没配置」', () => {
    const { rt, reset } = fakeRuntime();
    const Dialog = makeVoiceImportDialog(rt);
    reset();
    const tree = Dialog({
      open: true,
      busy: false,
      draftVoicesDir: 'D:/AI/GSV-voices',
      onClose: () => {},
      onRefresh: () => {},
    } as never);
    const dialog = flatten(tree).find((node) => String(node.props.className ?? '').includes('__dialog'));
    assert.ok(dialog);
    assert.equal(hasText(dialog as Node, 'voiceImportPackMissing'), false);
    assert.equal(hasText(dialog as Node, 'voiceImportPackDir'), true);
  });

  test('选根两条路：手输框 + 「读取」按钮都在（原生框弹不出来也不至于没反应）', () => {
    const { rt, reset } = fakeRuntime();
    const Dialog = makeVoiceImportDialog(rt);
    reset();
    const tree = Dialog({
      open: true,
      busy: false,
      draftVoicesDir: 'D:/AI/GSV-voices',
      onClose: () => {},
      onRefresh: () => {},
    } as never);
    const input = flatten(tree).find(
      (node) =>
        node.tag === 'input' && node.props.type === 'text' && node.props.placeholder === 'voiceImportRootPlaceholder',
    );
    assert.ok(input, '权重目录要能直接粘贴');
    const load = buttonOf(tree, 'voiceImportRootLoad');
    assert.ok(load, '「读取」按钮：从输入框的路径开始扫描');
    assert.equal(load.props.disabled, true, '空路径时不能点');
    (input.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'D:/w' } });
    reset();
    const after = Dialog({
      open: true,
      busy: false,
      draftVoicesDir: 'D:/AI/GSV-voices',
      onClose: () => {},
      onRefresh: () => {},
    } as never);
    assert.equal(buttonOf(after, 'voiceImportRootLoad')?.props.disabled, false, '填了路径就能读');
  });
});

/**
 * 装配层：把这几个入口串起来跑一遍（扫描 → 勾选 → 选文件 → 点候选行），
 * 断言的是「点完候选行，这一行的 refText 真的进了输入框」这条用户可见结果。
 */
describe('VoiceImportDialog 装配：选行回填', () => {
  /** 渲染一次（假渲染：reset 游标 + 调用组件函数）。 */
  const makeHarness = () => {
    const { rt, reset, setSlot } = fakeRuntime();
    const Dialog = makeVoiceImportDialog(rt);
    const props = {
      open: true,
      busy: false,
      draftVoicesDir: 'D:/AI/GSV-voices',
      onClose: () => {},
      onRefresh: () => {},
    };
    const render = (): unknown => {
      reset();
      return Dialog(props as never);
    };
    return { render, setSlot };
  };

  /** 走到「候选行已经出现」这一步：读目录 → 勾选 klee → 点「选一行…」。 */
  const openLines = async (render: () => unknown) => {
    let tree = render();
    const rootInput = nodeIn(
      tree,
      (node) => node.tag === 'input' && node.props.placeholder === 'voiceImportRootPlaceholder',
    );
    assert.ok(rootInput, '权重目录要能直接粘贴');
    (rootInput.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'D:/w' } });
    tree = render();
    (buttonOf(tree, 'voiceImportRootLoad')?.props.onClick as () => void)();
    await flush();
    tree = render();
    const row = rowNodeOf(tree, 'klee');
    assert.ok(row, '扫描结果要渲染成候选行');
    (
      nodeIn(row, (node) => node.tag === 'input' && node.props.type === 'checkbox')?.props.onChange as (e: {
        target: { checked: boolean };
      }) => void
    )({ target: { checked: true } });
    tree = render();
    (
      nodeIn(rowNodeOf(tree, 'klee'), (node) => node.tag === 'button' && hasText(node, 'voiceImportPickLine'))?.props
        .onClick as () => void
    )();
    await flush();
    return render();
  };

  test('点候选行 → 该行 refText 立刻写入，列表关闭', async () => {
    const stub = stubFetch((url) => {
      if (url.includes('/voice/voice-pack')) return { ok: true, scan: scanFixture };
      if (url.includes('/voice/text-lines'))
        return {
          ok: true,
          lines: [
            { index: 1, text: '甲' },
            { index: 2, text: '乙' },
          ],
        };
      if (url.includes('/pick-file')) return { ok: true, path: 'D:/in/ref.txt' };
      return { ok: false, message: '意外的请求 ' + url };
    });
    try {
      const { render } = makeHarness();
      let tree = await openLines(render);
      const lineButtons = flatten(tree).filter((node) => classOf(node).includes('__searchRow'));
      assert.equal(lineButtons.length, 2, '候选行要按宿主返回的行数渲染');

      (lineButtons[0]?.props.onClick as () => void)();
      tree = render();

      const filled = nodeIn(
        rowNodeOf(tree, 'klee'),
        (node) => node.tag === 'input' && node.props.placeholder === 'voiceImportTextPlaceholder',
      );
      assert.equal(filled?.props.value, '甲', '点候选行 → 该行的 reference text 立刻回填');
      assert.equal(
        nodeIn(rowNodeOf(tree, 'hutao'), (node) => node.props.value === '甲'),
        undefined,
        '不能写到别的行',
      );
      assert.equal(
        flatten(tree).filter((node) => classOf(node).includes('__searchRow')).length,
        0,
        '写入后候选行列表关闭',
      );
      assert.equal(stub.calls.filter((call) => call.url.includes('/voice/text-lines')).length, 1);
    } finally {
      stub.restore();
    }
  });

  test('行键不存在时不静默：给出提示且列表保留', async () => {
    const stub = stubFetch((url) => {
      if (url.includes('/voice/voice-pack')) return { ok: true, scan: scanFixture };
      if (url.includes('/voice/text-lines'))
        return {
          ok: true,
          lines: [
            { index: 1, text: '甲' },
            { index: 2, text: '乙' },
          ],
        };
      if (url.includes('/pick-file')) return { ok: true, path: 'D:/in/ref.txt' };
      return { ok: false, message: '意外的请求 ' + url };
    });
    try {
      const { render, setSlot } = makeHarness();
      let tree = await openLines(render);
      assert.equal(flatten(tree).filter((node) => classOf(node).includes('__searchRow')).length, 2);

      // 清单被重建（真 React 里由重新扫描触发）：这一行已经不在了，点候选行必须说话。
      setSlot(2, {});
      tree = render();
      const lineButtons = flatten(tree).filter((node) => classOf(node).includes('__searchRow'));
      assert.equal(lineButtons.length, 2, '列表还在（重建清单不该把它抹掉）');
      (lineButtons[0]?.props.onClick as () => void)();
      tree = render();

      const status = nodeIn(
        tree,
        (node) =>
          node.props.role === 'status' && classOf(node).includes('is-err') && hasText(node, 'voiceImportRowMissing'),
      );
      assert.ok(status, '行不在了要给出「这一行已经不在清单里了」的提示，而不是点了没反应');
      assert.equal(
        flatten(tree).filter((node) => classOf(node).includes('__searchRow')).length,
        2,
        '提示的同时保留列表，用户可以直接重选',
      );
    } finally {
      stub.restore();
    }
  });
});

/**
 * 「×」清除（T4）与目录记忆（T6）的**可观察结果**。
 *
 * 装配层直接跑用户那几步：读目录 → 勾行 → 选音频 / 填文本 → 清字段 → 开始导入；
 * 断言的是「字段被清、计数变了、按钮回到初始态、提交体里没有文本」，
 * 以及「只有 picked 才写 localStorage」这条调用约定（用可注入存储的写入次数判）。
 */
describe('「×」清除与目录记忆', () => {
  /** 保留占位符的字典：`voiceImportSelected` 的 `{n}`/`{m}` 替换后能读出真实数字。 */
  const tWithCounters = (key: string): string => (key === 'voiceImportSelected' ? 'voiceImportSelected {n} {m}' : key);

  /** 装一个假 `localStorage`（记录每一次 `setItem`），结束时还原。 */
  function installStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    const writes: { key: string; value: string }[] = [];
    const holder = globalThis as { localStorage?: unknown };
    const original = holder.localStorage;
    holder.localStorage = {
      getItem: (key: string): string | null => data.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        writes.push({ key, value });
        data.set(key, value);
      },
    };
    return {
      writes,
      restore: (): void => {
        holder.localStorage = original;
      },
    };
  }

  /**
   * 装配层：真组件 + 假 fetch。
   *
   * `pickQueue` 是 `/pick-*` 的应答队列：一个对象就是宿主回的那个 JSON；
   * 字符串 `'never'` 表示「宿主回 `{kind:'none'}`、没有响应体」——`fetch` 永远不落地（≈ 调用方已断开）。
   */
  function harness(pickQueue: unknown[] = [], translate: (key: string) => string = (key) => key) {
    const { rt, reset } = fakeRuntime(translate);
    const Dialog = makeVoiceImportDialog(rt);
    const props = {
      open: true,
      busy: false,
      draftVoicesDir: 'D:/AI/GSV-voices',
      onClose: () => {},
      onRefresh: () => {},
    };
    const render = (): unknown => {
      reset();
      return Dialog(props as never);
    };
    const stub = stubFetch((url, body) => {
      const entry = body as { mode?: string } | null;
      if (url.includes('/voice/voice-pack')) {
        if (entry?.mode === 'plan') {
          return {
            ok: true,
            previews: [{ id: 'klee', targetDir: 'D:/AI/GSV-voices/klee', pending: true }],
            errors: [],
          };
        }
        if (entry?.mode === 'apply') {
          return {
            ok: true,
            results: [{ id: 'klee', status: 'written', targetDir: 'D:/AI/GSV-voices/klee' }],
            errors: [],
          };
        }
        return { ok: true, scan: scanFixture };
      }
      if (url.includes('/voice/text-lines')) {
        return {
          ok: true,
          lines: [
            { index: 1, text: '甲' },
            { index: 2, text: '乙' },
          ],
        };
      }
      if (url.includes('/pick-file') || url.includes('/pick-folder')) {
        const next = pickQueue.shift();
        // `{kind:'none'}`：路由不写响应，客户端这一侧就是「请求永远不回」。
        if (next === 'never') return new Promise(() => undefined);
        return next ?? { ok: false, reason: 'cancelled' };
      }
      return { ok: false, message: '意外的请求 ' + url };
    });
    return { render, calls: stub.calls, restore: stub.restore };
  }

  /** 读目录 → 勾选 klee（走到「候选行可编辑」这一步）。 */
  const loadAndCheck = async (render: () => unknown): Promise<unknown> => {
    let tree = render();
    const rootInput = nodeIn(
      tree,
      (node) => node.tag === 'input' && node.props.placeholder === 'voiceImportRootPlaceholder',
    );
    (rootInput?.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'D:/w' } });
    tree = render();
    (buttonOf(tree, 'voiceImportRootLoad')?.props.onClick as () => void)();
    await flush();
    tree = render();
    const check = nodeIn(rowNodeOf(tree, 'klee'), (node) => node.tag === 'input' && node.props.type === 'checkbox');
    (check?.props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    return render();
  };

  /** 点某一行的「参考音频」按钮。 */
  const clickRef = (tree: unknown): void => {
    const button = nodeIn(rowNodeOf(tree, 'klee'), (node) => node.tag === 'button' && hasText(node, 'voiceImportRef'));
    (button?.props.onClick as () => void)();
  };

  /** 点某一行的「×」（按 data-field 认）。 */
  const clickClear = (tree: unknown, field: 'refAudio' | 'refText'): void => {
    const button = nodeIn(rowNodeOf(tree, 'klee'), (node) => node.props['data-field'] === field);
    (button?.props.onClick as () => void)();
  };

  /** 填参考文本。 */
  const fillText = (tree: unknown, value: string): void => {
    const input = nodeIn(
      rowNodeOf(tree, 'klee'),
      (node) => node.tag === 'input' && node.props.placeholder === 'voiceImportTextPlaceholder',
    );
    (input?.props.onChange as (e: { target: { value: string } }) => void)({ target: { value } });
  };

  /** 一行里某类控件的取值（断言「没被误清」用）。 */
  const textValueOf = (tree: unknown): unknown =>
    nodeIn(rowNodeOf(tree, 'klee'), (node) => node.props.placeholder === 'voiceImportTextPlaceholder')?.props.value;

  test('「×」只在字段非空时渲染；data-field 正确；未勾选的行禁用', async () => {
    const kit = harness([{ ok: true, path: 'D:/in/klee.wav' }]);
    try {
      let tree = await loadAndCheck(kit.render);
      assert.equal(
        nodeIn(rowNodeOf(tree, 'klee'), (node) => node.props['data-field'] === 'refAudio'),
        undefined,
        '字段还空着：不该有参考音频的 ×',
      );
      assert.equal(
        nodeIn(rowNodeOf(tree, 'klee'), (node) => node.props['data-field'] === 'refText'),
        undefined,
        '字段还空着：不该有参考文本的 ×',
      );

      clickRef(tree);
      await flush();
      tree = kit.render();
      const audioClear = nodeIn(rowNodeOf(tree, 'klee'), (node) => node.props['data-field'] === 'refAudio');
      assert.ok(audioClear, '选了音频之后才有 ×');
      assert.equal(audioClear.props.children, '×');
      assert.equal(audioClear.props['aria-label'], 'voiceImportClearRefAudio', '无障碍名要写清「清除什么」');
      assert.equal(audioClear.props.title, 'voiceImportClearRefAudio');
      assert.equal(classOf(audioClear), 'dsh-pet-cfg__btn is-text dsh-pet-cfg__clear', '复用 is-text，不新增 CSS');
      assert.equal(audioClear.props.disabled, false, '勾着且不忙时可点');
      assert.equal(
        nodeIn(rowNodeOf(tree, 'klee'), (node) => node.props['data-field'] === 'refText'),
        undefined,
        '文本还空着：没有文本的 ×',
      );

      fillText(tree, '甲');
      tree = kit.render();
      const textClear = nodeIn(rowNodeOf(tree, 'klee'), (node) => node.props['data-field'] === 'refText');
      assert.ok(textClear, '填了文本之后才有文本的 ×');
      assert.equal(textClear.props['aria-label'], 'voiceImportClearRefText');
      assert.equal(textClear.props.children, '×');

      // 取消勾选：值还在（× 仍渲染），但两个都禁用——与同行其它控件同一条条件。
      const check = nodeIn(rowNodeOf(tree, 'klee'), (node) => node.tag === 'input' && node.props.type === 'checkbox');
      (check?.props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: false } });
      tree = kit.render();
      assert.equal(
        nodeIn(rowNodeOf(tree, 'klee'), (node) => node.props['data-field'] === 'refAudio')?.props.disabled,
        true,
        '未勾选的行：参考音频的 × 置灰',
      );
      assert.equal(
        nodeIn(rowNodeOf(tree, 'klee'), (node) => node.props['data-field'] === 'refText')?.props.disabled,
        true,
        '未勾选的行：参考文本的 × 置灰',
      );
    } finally {
      kit.restore();
    }
  });

  test('只有 picked 才写 localStorage：cancelled / unsupported / 无应答（aborted）都不写', async () => {
    const storage = installStorage();
    // 前三次都不是 picked：取消 / 弹不出来 / 路由回 {kind:'none'}（响应永远不来）。
    const kit = harness([
      { ok: false, reason: 'cancelled' },
      { ok: false, reason: 'unsupported', message: '弹不出来' },
      'never',
      { ok: true, path: 'D:/in/klee.wav' },
    ]);
    try {
      let tree = await loadAndCheck(kit.render);
      for (const label of ['cancelled', 'unsupported', 'aborted']) {
        clickRef(tree);
        await flush();
        tree = kit.render();
        assert.equal(storage.writes.length, 0, `${label} 不该写记忆（只有 picked 才算用户认可了这个目录）`);
      }

      clickRef(tree);
      await flush();
      tree = kit.render();
      assert.equal(storage.writes.length, 1, 'picked 才写，且只写一次');
      assert.equal(storage.writes[0]?.key, PICK_DIRS_KEY);
      assert.deepEqual(JSON.parse(storage.writes[0]?.value ?? '{}'), { refAudio: 'D:/in', last: 'D:/in' });
    } finally {
      kit.restore();
      storage.restore();
    }
  });

  test('目录记忆：第二次打开参考音频框带上次的目录（第一次不传 start）', async () => {
    const storage = installStorage();
    const kit = harness([
      { ok: true, path: 'D:/in/klee.wav' },
      { ok: true, path: 'D:/in/hutao.wav' },
    ]);
    try {
      let tree = await loadAndCheck(kit.render);
      clickRef(tree);
      await flush();
      tree = kit.render();
      clickRef(tree);
      await flush();

      const picks = kit.calls.filter((call) => call.url.includes('/pick-file'));
      assert.equal(picks.length, 2);
      const first = picks[0]?.body as { start?: string; title?: string; extensions?: readonly string[] };
      assert.equal(first.title, 'voiceImportRef');
      assert.deepEqual(first.extensions, ['.wav', '.mp3', '.flac', '.ogg', '.m4a']);
      assert.equal(first.start, undefined, '第一次没有任何记忆：不传 start，交给系统默认目录');
      assert.equal((picks[1]?.body as { start?: string }).start, 'D:/in', '第二次直接落在上次的目录');
    } finally {
      kit.restore();
      storage.restore();
    }
  });

  test('清音频 → 缺参考音频 {m} +1、开始导入置灰；清文本 → 提交体 refText 为空', async () => {
    const storage = installStorage();
    // 队列：① 选参考音频 ② 选参考文本文件（点「选一行…」用）。
    const kit = harness(
      [
        { ok: true, path: 'D:/in/klee.wav' },
        { ok: true, path: 'D:/in/lines.txt' },
      ],
      tWithCounters,
    );
    try {
      let tree = await loadAndCheck(kit.render);
      fillText(tree, '甲');
      tree = kit.render();
      clickRef(tree);
      await flush();
      tree = kit.render();

      const selectedText = (): string | undefined =>
        flatten(tree)
          .map((node) => texts(node.props.children))
          .flat()
          .find((text) => text.startsWith('voiceImportSelected'));
      assert.equal(selectedText(), 'voiceImportSelected 1 0', '音频与文本都在：缺参考音频 0');
      assert.equal(buttonOf(tree, 'voiceImportStart')?.props.disabled, false, '齐了就能导');

      // 先打开候选行列表，证明「清字段」不动它（列表是 linePick，不是 results）。
      (
        nodeIn(rowNodeOf(tree, 'klee'), (node) => node.tag === 'button' && hasText(node, 'voiceImportPickLine'))?.props
          .onClick as () => void
      )();
      await flush();
      tree = kit.render();
      assert.equal(flatten(tree).filter((node) => classOf(node).includes('__searchRow')).length, 2);

      // 点参考文本的 ×：只清文本。
      clickClear(tree, 'refText');
      tree = kit.render();
      assert.equal(textValueOf(tree), '', '参考文本被清空');
      assert.equal(
        flatten(tree).filter((node) => classOf(node).includes('__searchRow')).length,
        2,
        '候选列表保留（applyRow 只清 results，不碰 linePick）',
      );
      assert.equal(selectedText(), 'voiceImportSelected 1 0', '清文本不影响「缺参考音频」计数');
      assert.equal(
        nodeIn(rowNodeOf(tree, 'klee'), (node) => node.props['data-field'] === 'refText'),
        undefined,
        '文本清空后它自己的 × 也随之消失',
      );
      assert.equal(buttonOf(tree, 'voiceImportStart')?.props.disabled, false, '音频还在：仍然可以导（零样本）');

      // 提交：这一条的 refText 必须是空串（宿主按零样本合成，不落 ref.txt）。
      (buttonOf(tree, 'voiceImportStart')?.props.onClick as () => void)();
      await flush();
      const applyCall = kit.calls.find(
        (call) => call.url.includes('/voice/voice-pack') && (call.body as { mode?: string }).mode === 'apply',
      );
      const items = (applyCall?.body as { items: { refText: string; refAudioPath: string }[] }).items;
      assert.equal(items[0]?.refText, '', '清文本后提交体 refText 为空 → 宿主按零样本合成');
      assert.equal(items[0]?.refAudioPath, 'D:/in/klee.wav', '音频不受影响');

      // 把文本填回来，再点参考音频的 ×：计数 +1、按钮回到初始态、开始导入置灰。
      tree = kit.render();
      fillText(tree, '甲');
      tree = kit.render();
      clickClear(tree, 'refAudio');
      tree = kit.render();
      assert.equal(selectedText(), 'voiceImportSelected 1 1', '清音频 → 该行重新计入「缺参考音频」');
      assert.equal(buttonOf(tree, 'voiceImportStart')?.props.disabled, true, '缺参考音频 → 开始导入置灰');
      assert.equal(textValueOf(tree), '甲', '清音频不动参考文本');
      const refButton = nodeIn(
        rowNodeOf(tree, 'klee'),
        (node) => node.tag === 'button' && hasText(node, 'voiceImportRef'),
      );
      assert.deepEqual(refButton?.props.children, ['voiceImportRef', ''], '按钮文案回到「参考音频」，不再带文件名');
    } finally {
      kit.restore();
      storage.restore();
    }
  });
});
