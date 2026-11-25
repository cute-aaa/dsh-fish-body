/**
 * 「兼容与记忆」卡的契约测试。
 *
 * 三条契约：
 *   1. 拉不到数据时给「暂不可用」，不显空白卡；
 *   2. 检测到同伴时名字可见，`auto` 要说清「没静音」；
 *   3. 记忆三种情况（接上 / 槽被占 / 没有来源）必须能分开读。
 *
 * hooks 用注入桩：`useState` 按调用顺序返回预设值，`useEffect` 不进副作用——
 * 这样不必起 DOM，也不会因为「挂载时拉一次」而变成异步测试。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makeCompatCard } from './compat-card.ts';
import type { CompatSnapshot } from './compat-api.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;

/** 把树摊平。 */
function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

/** 收集所有文本。 */
function texts(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return node.flatMap(texts);
  return texts((node as Node).props?.children);
}

const buttons = (tree: unknown): Node[] => flatten(tree).filter((node) => node.tag === 'button');

/**
 * 按顺序注入 useState 的值。
 *
 * 顺序与组件里的声明顺序一致：snapshot → message → failed → pending。
 */
function render(snapshot: CompatSnapshot | null): unknown {
  const seq: unknown[] = [snapshot, '', false, ''];
  let index = 0;
  const Card = makeCompatCard({
    h,
    t: (key: string) => key,
    useState: <T>(init: T) => {
      const value = (index < seq.length ? seq[index] : init) as T;
      index += 1;
      return [value, () => undefined] as [T, (next: T) => void];
    },
    useEffect: () => undefined,
    useRef: <T>(initial: T) => ({ current: initial }),
    useCallback: (<T>(fn: T) => fn) as never,
  } as never);
  return Card({ busy: false });
}

/** 一份「检测到 surfcore、记忆没接上」的快照。 */
const SNAPSHOT: CompatSnapshot = {
  coexist: {
    mode: 'auto',
    partners: [
      { id: 'surfcore', label: 'surfcore（自带宠物聊天与语音）', evidence: 'surfcore/pet/host.json', risk: 'high' },
    ],
    autoWhisperPaused: false,
  },
  memory: {
    provider: null,
    candidates: [
      { id: 'dsh-rofm', label: 'dsh-rofm', dir: 'D:/x', installed: false, evidence: '没有记忆文件' },
      { id: 'dsh-suzu-memory', label: 'dsh-suzu-memory', dir: 'D:/y', installed: false, evidence: '没有记忆文件' },
    ],
    slotTakenByOther: false,
  },
};

describe('CompatCard —— 数据缺失', () => {
  test('拉不到数据 → 显示「暂不可用」，不崩也不空白', () => {
    const tree = render(null);
    const all = texts(tree);
    assert.ok(all.includes('compatUnavailable'), '应有不可用提示');
    assert.ok(all.includes('compatTitle'), '标题仍在（卡片不消失）');
  });
});

describe('CompatCard —— 共存', () => {
  test('检测到同伴 → 名字可见，auto 时说明「正常运行」', () => {
    const all = texts(render(SNAPSHOT));
    assert.ok(
      all.some((line) => line.includes('surfcore')),
      '同伴名字要看得见',
    );
    assert.ok(all.includes('compatActive'), 'auto 不静音，要明确说出来');
  });

  test('三个模式按钮都在（auto / full / body-only）', () => {
    const labels = buttons(render(SNAPSHOT)).map((node) => texts(node.props?.children).join(''));
    for (const key of ['compatModeAuto', 'compatModeFull', 'compatModeBodyOnly']) {
      assert.ok(labels.includes(key), '缺少按钮：' + key);
    }
  });

  test('body-only 生效时说明已让位', () => {
    const paused: CompatSnapshot = {
      ...SNAPSHOT,
      coexist: { ...SNAPSHOT.coexist!, mode: 'body-only', autoWhisperPaused: true },
    };
    assert.ok(texts(render(paused)).includes('compatPaused'));
  });
});

describe('CompatCard —— 记忆', () => {
  test('没接上 → 说「没有可用的记忆来源」，候选逐条列出', () => {
    const all = texts(render(SNAPSHOT));
    assert.ok(all.includes('compatMemoryNone'));
    assert.ok(all.some((line) => line.includes('dsh-rofm')));
    assert.ok(all.some((line) => line.includes('dsh-suzu-memory')));
  });

  test('槽被别的实现占着 → 说清楚，而不是「没有来源」', () => {
    const taken: CompatSnapshot = {
      ...SNAPSHOT,
      memory: { ...SNAPSHOT.memory!, slotTakenByOther: true },
    };
    const all = texts(render(taken));
    assert.ok(all.includes('compatMemoryTaken'));
    assert.equal(all.includes('compatMemoryNone'), false, '两种情况不能混');
  });

  test('接上了 → 显示 id 与条数', () => {
    const live: CompatSnapshot = {
      ...SNAPSHOT,
      memory: {
        provider: { id: 'dsh-rofm', dir: 'D:/x', registeredAt: '', notes: 7, skipped: 0, lastReadAt: '' },
        candidates: SNAPSHOT.memory!.candidates,
        slotTakenByOther: false,
      },
    };
    const all = texts(render(live));
    const joined = all.join('|');
    assert.ok(joined.includes('compatMemoryOn'), '要说明已接上');
    assert.ok(joined.includes('dsh-rofm'), '要显示接上的是谁');
    assert.ok(joined.includes('7'), '要显示读到几条');
  });
});
