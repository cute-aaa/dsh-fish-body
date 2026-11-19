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
import { buildImportItems, makeVoiceImportDialog, makeVoiceImportRow, rowStateOf } from './voice-import.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;

/** 手搓一个带 useState 的运行时：同一个槽位在多次渲染之间保留值。 */
function fakeRuntime() {
  const states: unknown[] = [];
  let cursor = 0;
  const useState = <T>(init: T): readonly [T, (next: T | ((prev: T) => T)) => void] => {
    const index = cursor++;
    if (!(index in states)) states[index] = init;
    const set = (next: T | ((prev: T) => T)): void => {
      states[index] = typeof next === 'function' ? (next as (prev: T) => T)(states[index] as T) : next;
    };
    return [states[index] as T, set];
  };
  return {
    rt: { h, t: (key: string) => key, useState } as never,
    reset: (): void => {
      cursor = 0;
    },
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
