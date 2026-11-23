/**
 * 通用「打开文件夹」按钮（src/client/settings/folder-button.ts）的契约测试。
 *
 * 这张按钮存在的理由是「先打开 → not-found → 问 → 创建再打开」这套结论判定只该有一份，
 * 所以测试钉的是这四步，外加它接受的两种视觉（行内小按钮 / 纯文字按钮）。
 * 用假的 `h` 与假的 `fetch`，不引 jsdom；`useState` 返回可写的盒子，点击后能读到重渲染前的状态。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makeFolderButton } from './folder-button.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;

/** 假 useState：值写回盒子，读时拿最新值（按钮里只有 tip / busy 两个状态）。 */
function fakeState() {
  const cells: Array<{ value: unknown }> = [];
  let cursor = 0;
  const useState = ((init: unknown) => {
    const slot = cursor;
    cursor += 1;
    if (cells[slot] === undefined) cells[slot] = { value: init };
    const cell = cells[slot];
    return [cell.value, (next: unknown) => (cell.value = next)];
  }) as never;
  return { useState, reset: () => (cursor = 0) };
}

/**
 * 造一次「组件 + 假状态」。
 *
 * `render()` 每次把钩子游标重置回 0，模拟一次真正的重渲染——否则第二次调用会分配到新的状态槽，
 * 就看不到「点了之后提示出现了」这件事。
 */
function mount(t: (key: string) => string = (key) => key) {
  const state = fakeState();
  const FolderButton = makeFolderButton({ h, t, useState: state.useState } as never);
  return {
    render: (props: Parameters<typeof FolderButton>[0]) => {
      state.reset();
      return FolderButton(props) as unknown as Node;
    },
  };
}

function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const buttonsOf = (tree: unknown): Node[] => flatten(tree).filter((node) => node.tag === 'button');

/** 换掉全局 fetch 并记录请求地址。 */
async function withFetch(
  respond: () => { ok: boolean; body: unknown },
  run: (urls: string[]) => Promise<void>,
): Promise<void> {
  const previous = globalThis.fetch;
  const urls: string[] = [];
  try {
    globalThis.fetch = ((url: string) => {
      urls.push(url);
      return Promise.resolve({ ok: true, json: async () => respond().body } as Response);
    }) as unknown as typeof fetch;
    await run(urls);
  } finally {
    globalThis.fetch = previous;
  }
}

/** 让 openFolderOf 的 promise 链跑完。 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('FolderButton —— 打开目录的唯一实现', () => {
  test('成功：只发一次不带 create 的请求，不留下提示', async () => {
    await withFetch(
      () => ({ ok: true, body: { ok: true, path: 'D:/u/fish-body/skin', created: false } }),
      async (urls) => {
        const card = mount();
        const tree = card.render({ which: 'skin-root' });
        (buttonsOf(tree)[0].props.onClick as () => void)();
        await settle();
        assert.equal(urls.length, 1);
        assert.match(urls[0], /which=skin-root/);
        assert.doesNotMatch(urls[0], /create=1/, '第一次必须先试着打开，不擅自建目录');
      },
    );
  });

  test('目录不存在：就地询问，确认后才带 create 再发一次', async () => {
    await withFetch(
      () => ({ ok: false, body: { ok: false, reason: 'not-found', path: 'D:/u/fish-body/skin' } }),
      async (urls) => {
        const card = mount();
        const opened = card.render({ which: 'skin-root' });
        (buttonsOf(opened)[0].props.onClick as () => void)();
        await settle();
        assert.equal(urls.length, 1);
        assert.doesNotMatch(urls[0], /create=1/, '第一次必须先试着打开，不擅自建目录');

        // 第二次渲染：提示出现过（问的是「要不要创建」，并把路径摆出来）。
        const asked = card.render({ which: 'skin-root' });
        const texts = flatten(asked).map((node) => String(node.props.children ?? ''));
        assert.ok(texts.includes('sfxFolderMissing'), '要给一句「目录还没建」');
        assert.ok(texts.includes('D:/u/fish-body/skin'), '要把宿主算出的路径摆出来');
        const askButtons = buttonsOf(asked);
        assert.deepEqual(
          askButtons.map((node) => node.props.children),
          ['sfxOpenFolder', 'sfxFolderCreateYes', 'sfxFolderCreateNo'],
        );

        // 点「创建」：这次请求带 create=1。
        (askButtons[1].props.onClick as () => void)();
        await settle();
        assert.equal(urls.length, 2);
        assert.match(urls[1], /create=1/);
      },
    );
  });

  test('视觉：默认是行内小按钮，`variant: text` 是纯文字按钮，文案可覆盖', async () => {
    await withFetch(
      () => ({ ok: true, body: { ok: true, path: 'D:/u/fish-body/skin', created: false } }),
      async () => {
        const card = mount();
        const plain = buttonsOf(card.render({ which: 'skin-root' }))[0];
        assert.equal(plain.props.className, 'dsh-pet-cfg__btn is-sm');
        assert.equal(plain.props.children, 'sfxOpenFolder');

        const text = buttonsOf(card.render({ which: 'fish-skin', variant: 'text', label: 'fish.openSkinFolder' }))[0];
        assert.equal(text.props.className, 'dsh-pet-cfg__btn is-text');
        assert.equal(text.props.children, 'fish.openSkinFolder');
      },
    );
  });

  test('禁用态透传给按钮（浏览器因此不会再派发点击）', async () => {
    await withFetch(
      () => ({ ok: true, body: { ok: true, path: 'D:/u/fish-body/skin', created: false } }),
      async (urls) => {
        const card = mount();
        const disabled = buttonsOf(card.render({ which: 'skin-root', disabled: true }))[0];
        assert.equal(disabled.props.disabled, true);
        // 组件自己不拦点击：置灰交给浏览器，点了根本不会触发 onClick。
        assert.deepEqual(urls, []);
      },
    );
  });
});
