/**
 * 设置页顶部的搜索：输入框 + 结果列表 + 一次性索引层。
 *
 * 索引为什么要「藏一层」：搜索必须能命中还没打开的分区（用户搜「云端」时人在「桌宠」页），
 * 而设置页只渲染当前分区。做法是在第一次搜索时把六个分区的面板挂进一个 `display:none` 的容器，
 * 读成条目后立刻卸掉——DOM 是唯一与渲染同步的「字段清单」，没有第二份需要维护的映射表。
 * 代价是每个分区各跑一次副作用（例如「文件与目录」卡会问一次运行时状态），只在搜索时发生一次。
 *
 * 搜索态下结果列表**替掉**分区面板（而不是盖在上面）：设置页本来就是一个滚动容器，
 * 浮层会跟滚动位置、底部吸附栏打架；替掉之后「结果 → 点一条 → 分区切过去并高亮」路径最短。
 * @module dsh-fish-body/src/client/settings/use-settings-search
 */
import type { jsx } from 'react/jsx-runtime';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type { SettingsRuntime } from './runtime.ts';
import { matchEntries, readSearchEntries, type SearchEntry, type SearchHit } from './search.ts';
import type { SettingsTabId } from './tabs.ts';

/** 搜索能看到的标签：分区 id 与它的显示名（后者也进索引文本，搜「声音」能命中整个分区）。 */
export interface SettingsSearchTab {
  readonly id: SettingsTabId;
  readonly label: string;
}

/** 造搜索需要的外部输入。 */
export interface SettingsSearchOptions {
  /** 全部分区（顺序即结果里的分区次序）。 */
  readonly tabs: readonly SettingsSearchTab[];
  /** 按分区渲染面板：隐藏索引层与正常渲染共用同一个入口，索引才与屏幕一致。 */
  readonly renderPanel: (id: SettingsTabId) => ReturnType<typeof jsx>;
  /** 选中一条结果：切分区 + 按查询高亮（查询由这里给，调用方不必自己记）。 */
  readonly onPick: (id: SettingsTabId, query: string) => void;
}

/** 搜索区交出去的三块节点与状态。 */
export interface SettingsSearchState {
  /** 是否处于搜索态：调用方据此决定渲染结果列表还是分区面板。 */
  readonly active: boolean;
  /** 输入框（含计数），固定在分区标签条上方。 */
  readonly box: ReturnType<typeof jsx>;
  /** 结果列表；不在搜索态时为 `null`。 */
  readonly results: ReturnType<typeof jsx> | null;
  /** 隐藏的索引层；只有「正在建索引」的那一帧不是 `null`。 */
  readonly indexLayer: ReturnType<typeof jsx> | null;
}

/**
 * 管理搜索的输入、索引与结果列表。
 *
 * @param rt - 注入的 `h`、`useState`、`useEffect`、`useRef` 与翻译。
 * @param options - 分区表、面板渲染入口与选中回调。
 * @returns 三块节点与「是否搜索态」。
 */
export function useSettingsSearch(
  rt: Pick<SettingsRuntime, 'h' | 'useState' | 'useEffect' | 'useRef' | 't'>,
  options: SettingsSearchOptions,
): SettingsSearchState {
  const { h, useState, useEffect, useRef, t } = rt;
  const { tabs, renderPanel, onPick } = options;
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<readonly SearchEntry[] | null>(null);
  const [building, setBuilding] = useState(false);
  const [cursor, setCursor] = useState(0);
  const indexRef = useRef<HTMLElement | null>(null);

  const labelOf = (id: SettingsTabId): string => tabs.find((tab) => tab.id === id)?.label ?? '';
  const words = query.trim();
  const active = words !== '';

  // 第一次真正搜索时才建索引：从不搜索的人不该为它付任何渲染代价。
  useEffect(() => {
    if (!active || entries !== null || building) return;
    setBuilding(true);
  }, [active, entries, building]);

  // 索引层挂上来的同一次提交里读它：读的是面板刚渲染出的文字与控件值，不需要等动画或轮询。
  useEffect(() => {
    const layer = indexRef.current;
    if (!building || layer === null) return;
    const list: SearchEntry[] = [];
    for (const tab of tabs) {
      const scope = layer.querySelector('[data-search-tab="' + tab.id + '"]');
      if (scope !== null) list.push(...readSearchEntries(scope, tab.id, tab.label));
    }
    setEntries(list);
    setBuilding(false);
  }, [building, tabs]);

  const hits: SearchHit[] = entries === null ? [] : matchEntries(entries, words);
  // 结果换了就把光标收回第一条：键盘上下移动时不会停在越界的位置
  const cursorIndex = Math.min(cursor, Math.max(hits.length - 1, 0));

  const pick = (hit: SearchHit): void => {
    onPick(hit.entry.tab, words);
    setQuery('');
    setCursor(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setQuery('');
      return;
    }
    if (hits.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((current) => (current + 1) % hits.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((current) => (current - 1 + hits.length) % hits.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const hit = hits[cursorIndex];
      if (hit !== undefined) pick(hit);
    }
  };

  const box = h('div', {
    className: 'dsh-pet-cfg__search',
    children: [
      h('input', {
        type: 'search',
        className: 'dsh-pet-cfg__searchInp',
        value: query,
        placeholder: t('searchPlaceholder'),
        'aria-label': t('searchPlaceholder'),
        onChange: (event: ChangeEvent<HTMLInputElement>) => {
          setQuery(event.target.value);
          setCursor(0);
        },
        onKeyDown,
      }),
      active
        ? h('span', {
            className: 'dsh-pet-cfg__searchCount',
            children: building ? '…' : String(hits.length),
          })
        : null,
    ],
  });

  const results: ReturnType<typeof jsx> | null = !active
    ? null
    : h('div', {
        className: 'dsh-pet-cfg__searchList',
        role: 'list',
        'aria-label': t('searchResults'),
        children:
          hits.length === 0
            ? [h('p', { className: 'dsh-pet-cfg__note', children: t('searchEmpty') })]
            : hits.map((hit, index) =>
                h('button', {
                  key: hit.entry.tab + ':' + hit.entry.title + ':' + hit.entry.label + ':' + index,
                  type: 'button',
                  role: 'listitem',
                  className: 'dsh-pet-cfg__searchRow' + (index === cursorIndex ? ' is-active' : ''),
                  onClick: () => pick(hit),
                  // 鼠标悬停把光标挪过去：点之前先用方向键也不会跳两条
                  onMouseEnter: () => setCursor(index),
                  children: [
                    h('span', {
                      key: 'p',
                      className: 'dsh-pet-cfg__searchPath',
                      children: [labelOf(hit.entry.tab), hit.entry.title].filter((part) => part !== '').join(' › '),
                    }),
                    h('span', {
                      key: 'n',
                      className: 'dsh-pet-cfg__searchName',
                      children: hit.entry.label === '' ? t('searchWholeCard') : hit.entry.label,
                    }),
                    hit.entry.value === ''
                      ? null
                      : h('span', { key: 'v', className: 'dsh-pet-cfg__searchValue', children: hit.entry.value }),
                  ],
                }),
              ),
      });

  // 索引层：只在建索引的那一帧挂载，读走内容立刻卸掉（不留在 DOM 里当第二份表单）
  const indexLayer = !building
    ? null
    : h('div', {
        ref: indexRef,
        style: { display: 'none' },
        'aria-hidden': 'true',
        children: tabs.map((tab) =>
          h('div', { key: tab.id, 'data-search-tab': tab.id, children: [renderPanel(tab.id)] }),
        ),
      });

  return { active, box, results, indexLayer };
}
