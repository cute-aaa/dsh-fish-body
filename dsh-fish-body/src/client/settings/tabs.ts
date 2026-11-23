/**
 * 设置页的分区表与标签条：`id` 是跨文件稳定标识符，`titleKey` 取字典，顺序即标签条顺序。
 *
 * 这张表是「增减分区」的唯一改动点：加一行就多一个分区（面板装配在 `./panels.ts` 里对应补一项），
 * 删一行就少一个，入口不写 if。分区 id 用字面量联合类型钉住，面板表按它 `Record<>` 展开。
 * 分区按「个体 → 手感 → 声音 → 智能 → 附加 → 维护」排：越靠前越常改，越靠后越是配一次就不动。
 * 标签条是一条等宽分段控件（轨道 + 选中块），窄容器改横向滚动而不是折成两三行。
 * owns only 分区的名字、顺序与标签条交互，never 任何字段状态。
 * @module dsh-fish-body/src/client/settings/tabs
 */
import type { FunctionComponent } from 'react';
import type { Key } from './locales/index.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 一个分区的定义。 */
export interface SettingsTabDef {
  /** 稳定标识符：出现在 DOM id 与面板表里，不进文案。 */
  readonly id: string;
  /** 标签文案的字典键。 */
  readonly titleKey: Key;
}

/** 分区顺序即阅读顺序：高频在前，维护在后。 */
export const SETTINGS_TABS = [
  { id: 'pet', titleKey: 'tabPet' },
  { id: 'feel', titleKey: 'tabFeel' },
  { id: 'audio', titleKey: 'tabAudio' },
  { id: 'chat', titleKey: 'tabChat' },
  { id: 'fish', titleKey: 'tabFish' },
  { id: 'system', titleKey: 'tabSystem' },
] as const satisfies readonly SettingsTabDef[];

/** 分区标识符；由表推导，新增一行自动扩 union。 */
export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

/** 默认分区：打开设置页先看桌宠，这是本页最常改的东西。 */
export const DEFAULT_SETTINGS_TAB: SettingsTabId = 'pet';

/** 面板与标签按钮的 id 前缀（`aria-controls` / `aria-labelledby` 两边共用，避免字面量散落）。 */
const ID_PREFIX = 'dsh-pet-cfg';

/**
 * 分区面板的 DOM id。
 *
 * @param id - 分区标识符。
 * @returns 面板 id。
 */
export const tabPanelId = (id: SettingsTabId): string => ID_PREFIX + '-panel-' + id;

/**
 * 分区标签按钮的 DOM id。
 *
 * @param id - 分区标识符。
 * @returns 按钮 id。
 */
export const tabButtonId = (id: SettingsTabId): string => ID_PREFIX + '-tab-' + id;

/** 标签条的输入。 */
export interface TabBarProps {
  /** 当前分区。 */
  readonly active: SettingsTabId;
  /** 切到另一个分区。 */
  onSelect(id: SettingsTabId): void;
  /** 每个分区是否有未保存改动；为 true 的标签右侧画一个圆点。 */
  readonly dirty: Record<SettingsTabId, boolean>;
}

/**
 * 造分区标签条。
 *
 * 键盘按 ARIA tabs 的惯例：左右方向键在分区之间移动并跟着切换（自动激活），Home / End 跳到首尾。
 * 切换是纯本地状态，所以加载中也不禁用——看别的分区不该等网络。
 * 圆点只表达「这一页有未保存改动」，点击行为与无障碍名都不变（圆点自带 `aria-label`，会并进按钮名）。
 *
 * @param rt - 注入的节点工厂、`useRef` 与翻译函数。
 * @returns 标签条组件。
 */
export function makeTabBar(rt: Pick<SettingsRuntime, 'h' | 't' | 'useRef'>): FunctionComponent<TabBarProps> {
  const { h, t, useRef } = rt;

  return function TabBar(props: TabBarProps) {
    const listRef = useRef<HTMLDivElement | null>(null);

    /** 把焦点搬到某个分区并把它的滚动位置带进可视区（窄容器里标签条是横向滚动的）。 */
    const focusTab = (id: SettingsTabId): void => {
      const button = listRef.current?.querySelector<HTMLElement>('[data-tab="' + id + '"]');
      button?.focus();
      button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    /** 按方向键 / Home / End 移动：选定并把焦点搬过去，键盘用户不用再 Tab 一遍。 */
    const onKeyDown = (event: { key: string; preventDefault(): void }): void => {
      const index = SETTINGS_TABS.findIndex((tab) => tab.id === props.active);
      const last = SETTINGS_TABS.length - 1;
      const next =
        event.key === 'ArrowRight'
          ? (index + 1) % SETTINGS_TABS.length
          : event.key === 'ArrowLeft'
            ? (index - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? last
                : -1;
      if (next < 0) return;
      event.preventDefault();
      const target = SETTINGS_TABS[next];
      props.onSelect(target.id);
      focusTab(target.id);
    };

    return h('div', {
      ref: listRef,
      className: 'dsh-pet-cfg__seg',
      role: 'tablist',
      'aria-label': t('nav'),
      onKeyDown,
      children: SETTINGS_TABS.map((tab) =>
        h('button', {
          key: tab.id,
          type: 'button',
          id: tabButtonId(tab.id),
          'data-tab': tab.id,
          role: 'tab',
          'aria-selected': tab.id === props.active,
          'aria-controls': tabPanelId(tab.id),
          tabIndex: tab.id === props.active ? 0 : -1,
          className: 'dsh-pet-cfg__segItem' + (tab.id === props.active ? ' is-active' : ''),
          onClick: () => props.onSelect(tab.id),
          children: [
            t(tab.titleKey),
            props.dirty[tab.id]
              ? h('i', {
                  key: 'dot',
                  className: 'dsh-pet-cfg__dot',
                  role: 'img',
                  'aria-label': t('unsaved'),
                  title: t('unsaved'),
                })
              : null,
          ],
        }),
      ),
    });
  };
}
