/**
 * 快捷键卡：把键分成三块——宠物自己的悬停键、四个显示位置键，与 DSH 分发的全局快捷键。
 *
 * 前两块**可以改绑**：点键帽进入捕获态，按一个新键就写进配置（随底部栏保存），
 * 同一个键给了两项时两者互换（见 `shared/hotkeys` 的 `assignHotkey`），所以这里没有「冲突」状态。
 * 只支持裸键（一个字母或数字）：这些键只在鼠标停着宠物时生效，带 Ctrl/Alt 的组合属于浏览器。
 * 全局快捷键的键位归 DSH 的「设置 → 通用 → 快捷键」，这一卡只显示当前值，改绑请去那边。
 * 分组不是排版偏好：三块键由不同代码派发、生效条件也不同，混在一张表里读者分不清「按了没反应」是哪种原因。
 * @module dsh-fish-body/src/client/settings/shortcuts-card
 */
import type { FunctionComponent } from 'react';
import type { DirtyQuery } from './dirty.ts';
import { NO_DIRTY } from './dirty.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';
import { keycapOf, subscribeShortcutKeycaps, type ShortcutHost } from '../app-shortcut.ts';
import { petChatShortcutKeycap } from '../chat/shortcut.ts';
import { petShortcutKeycap } from '../pet/card/shortcut.ts';
import { hotkeyHint, isHotkeyKey, type HotkeyAction, type HotkeyMap } from '../../shared/hotkeys.ts';
import { DISPLAY_ORDER } from '../../shared/display-hotkey.ts';

/** 折叠正文的 id：与卡头按钮的 `aria-controls` 成对。 */
const BODY_ID = 'pet-cfg-shortcuts';

/** 粘贴不是我们注册的命令，键帽按平台推导（macOS 是 ⌘V），不写死字符串。 */
const PASTE_KEYCAP = keycapOf({ code: 'KeyV', modifiers: ['primary'] });

/** 卡片输入：当前键位表与两个写入口。 */
export interface ShortcutsCardProps {
  /** 当前九个悬停键（来自配置，已归一）。 */
  readonly hotkeys: HotkeyMap;
  /** 改一个键（同一个键给了别的动作时由上层互换）。 */
  readonly onAssign: (action: HotkeyAction, key: string) => void;
  /** 九个键整体恢复出厂。 */
  readonly onReset: () => void;
  /** 保存中或配置未就绪：捕获与改绑都停手。 */
  readonly disabled: boolean;
  /** 未保存改动查询口（卡头与每一行的小圆点）。 */
  readonly dirty?: DirtyQuery;
}

/** 四个显示位置键与它们对应的动作（顺序与菜单同源）。 */
const DISPLAY_ROWS: ReadonlyArray<{ readonly action: HotkeyAction; readonly label: string }> = DISPLAY_ORDER.map(
  (display) => ({
    action: ('display.' + display) as HotkeyAction,
    label: 'shortcutRowDisplay' + display.charAt(0).toUpperCase() + display.slice(1),
  }),
);

/** 五个宠物悬停键（显示位置之外的）。 */
const PET_ROWS: ReadonlyArray<{ readonly action: HotkeyAction; readonly label: string }> = [
  { action: 'chat', label: 'shortcutRowChat' },
  { action: 'hear', label: 'shortcutRowHold' },
  { action: 'capture', label: 'shortcutRowCapture' },
  { action: 'todo', label: 'shortcutRowTodo' },
  { action: 'sleep', label: 'shortcutRowSleep' },
];

/** 三条可改绑命令的当前键帽（由 DSH 的快捷键服务给出，可能已被用户改过）。 */
interface GlobalKeycaps {
  /** 开关浮动对话。 */
  readonly open: string;
  /** 开关录音。 */
  readonly hear: string;
  /** 截图。 */
  readonly capture: string;
  /** 打开右侧栏对话面板。 */
  readonly sidebar: string;
}

/** 现读一遍三条全局命令的键帽。 */
function readKeycaps(ctx: ShortcutHost): GlobalKeycaps {
  return {
    open: petShortcutKeycap(ctx, 'chat'),
    hear: petShortcutKeycap(ctx, 'hear'),
    capture: petShortcutKeycap(ctx, 'capture'),
    sidebar: petChatShortcutKeycap(ctx),
  };
}

/**
 * 造快捷键卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @param ctx - 客户端上下文：读改绑后的全局命令键位。
 * @returns 卡片组件。
 */
export function makeShortcutsCard(rt: SettingsRuntime, ctx: ShortcutHost): FunctionComponent<ShortcutsCardProps> {
  const { h, t, useState, useEffect } = rt;

  return function ShortcutsCard(props: ShortcutsCardProps) {
    const { hotkeys, onAssign, onReset, disabled } = props;
    const dirty = props.dirty ?? NO_DIRTY;
    // 每张卡自带一份小件：圆点要按这张卡的 dirty 判定，不能在装配时固定成共享实例。
    const { foldCard, note } = makeUiKit({ h, t }, dirty);
    const [open, setOpen] = useState(false);
    // 正在等用户按键的那一项；null = 普通状态。
    const [editing, setEditing] = useState<HotkeyAction | null>(null);
    // 全局命令的键帽：改绑发生在「设置 → 通用 → 快捷键」那一页，切回来时必须重新读一次。
    const [keycaps, setKeycaps] = useState<GlobalKeycaps>(readKeycaps(ctx));
    useEffect(() => subscribeShortcutKeycaps(ctx, () => setKeycaps(readKeycaps(ctx))), []);

    // 捕获一个裸键：Escape 取消，带修饰键的一律不算（见模块头）。
    // 监听挂在 window 的捕获阶段并在命中后 `stopPropagation`，否则宠物自己那份 document 监听
    // 会同时把这个键当成一次快捷键按下去——用户改个键顺便把宠物打开了，很难解释。
    useEffect(() => {
      if (editing === null) return;
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setEditing(null);
          return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const key = String(e.key).toLowerCase();
        if (!isHotkeyKey(key)) return;
        e.preventDefault();
        e.stopPropagation();
        onAssign(editing, key);
        setEditing(null);
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, [editing, onAssign]);

    /** 一行：左边动作名，右边键帽（可点击改绑）；`fixed` 表示这一行不能改（只有展示）。 */
    const row = (label: string, hint: string, action?: HotkeyAction) => {
      const capturing = action !== undefined && editing === action;
      const changed = action !== undefined && dirty.has('hotkeys.' + action);
      return h('div', {
        className: 'dsh-pet-cfg__field' + (changed ? ' is-dirty' : ''),
        children: [
          h('span', { key: 'l', className: 'dsh-pet-cfg__flabel', children: t(label) }),
          action === undefined
            ? h('span', { key: 'v', className: 'dsh-pet-cfg__note', children: hint })
            : h('button', {
                key: 'k',
                type: 'button',
                className: 'dsh-pet-cfg__keycap' + (capturing ? ' is-capturing' : ''),
                disabled,
                title: t('shortcutKeycapHint'),
                'aria-label': t(label) + '：' + hint,
                onClick: () => setEditing(capturing ? null : action),
                children: capturing ? t('shortcutCapture') : hint,
              }),
        ],
      });
    };

    return foldCard({
      id: BODY_ID,
      title: t('shortcutCardTitle'),
      hint: t('shortcutCardHint'),
      scope: 'hotkeys',
      open,
      onToggle: () => setOpen(!open),
      body: [
        h('p', { key: 'petTitle', className: 'dsh-pet-cfg__cardTitle', children: t('shortcutGroupPet') }),
        note(t('shortcutGroupPetHint'), true),
        h('div', {
          key: 'petRows',
          className: 'dsh-pet-cfg__grid2',
          children: PET_ROWS.map((item) => row(item.label, hotkeyHint(hotkeys, item.action), item.action)),
        }),
        h('p', { key: 'displayTitle', className: 'dsh-pet-cfg__cardTitle', children: t('shortcutGroupDisplay') }),
        note(t('shortcutGroupDisplayHint'), true),
        h('div', {
          key: 'displayRows',
          className: 'dsh-pet-cfg__grid2',
          children: DISPLAY_ROWS.map((item) => row(item.label, hotkeyHint(hotkeys, item.action), item.action)),
        }),
        h('div', {
          key: 'reset',
          className: 'dsh-pet-cfg__path',
          children: [
            h('button', {
              key: 'r',
              type: 'button',
              className: 'dsh-pet-cfg__btn is-sm',
              disabled,
              onClick: onReset,
              children: t('shortcutReset'),
            }),
            // 恢复默认只在真的改过之后才有意义：全默认时按钮留着只是让人点一下看没反应。
            dirty.has('hotkeys')
              ? h('span', { key: 'n', className: 'dsh-pet-cfg__treeDesc', children: t('shortcutResetHint') })
              : null,
          ],
        }),
        h('p', { key: 'globalTitle', className: 'dsh-pet-cfg__cardTitle', children: t('shortcutGroupGlobal') }),
        note(t('shortcutGroupGlobalHint'), true),
        h('div', {
          key: 'globalRows',
          className: 'dsh-pet-cfg__grid2',
          children: [
            row('shortcutRowChat', keycaps.open),
            row('shortcutRowHear', keycaps.hear),
            row('shortcutRowCapture', keycaps.capture),
            row('shortcutRowSidebar', keycaps.sidebar),
            row('shortcutRowPaste', PASTE_KEYCAP),
          ],
        }),
      ],
    });
  };
}
