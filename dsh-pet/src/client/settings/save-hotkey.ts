/**
 * Ctrl+S / Cmd+S 就地保存：设置页按分区收纳后仍然很长，改完不必切回底部找按钮。
 *
 * 三条都是踩过的坑：① 只在本页真的可见时接管——DSH 可能在别的设置页仍挂着本组件，
 * 不能把别人的快捷键抢走；② 只在真要保存时 `preventDefault`，否则会拦掉浏览器的「保存网页」；
 * ③ `save` 每次渲染重建（闭包捕获宠物 / 物理参数等状态），直接塞进 `useEffect([])` 会拿旧状态存盘，
 * 所以每次渲染把最新的那一个转发进 ref。
 * @module dsh-pet/src/client/settings/save-hotkey
 */
import type * as ReactNS from 'react';
import type { SettingsRuntime } from './runtime.ts';

/** 一次 keydown 里本模块关心的字段（只取用到的，便于纯函数测试）。 */
export interface SaveHotkeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/** 判断「本页可见」用的最小根节点形状。 */
export interface HotkeyRoot {
  readonly isConnected: boolean;
  getClientRects(): { readonly length: number };
}

/**
 * 这次按键是否该由本页当作「保存」。
 *
 * @param event - keydown 事件里与本判定相关的字段。
 * @param root - 设置页根节点；`null` 表示还没挂载。
 * @returns 是则为 `true`；此时调用方才该 `preventDefault` 并存盘。
 */
export function isSaveHotkey(event: SaveHotkeyEvent, root: HotkeyRoot | null): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return false;
  if (event.key.toLowerCase() !== 's') return false;
  if (root === null || !root.isConnected) return false;
  // 卸载后仍挂着引用、或所在设置页被隐藏时，节点还在但量不到盒子：按不可见处理。
  return root.getClientRects().length > 0;
}

/**
 * 把 Ctrl+S / Cmd+S 接到保存动作上。
 *
 * @param rt - 只用到 `useEffect` 与 `useRef`。
 * @param root - 设置页根节点（可见性判定用）。
 * @param save - 这一次渲染的保存动作；每次渲染都会被转发进内部 ref。
 */
export function useSaveHotkey(
  rt: Pick<SettingsRuntime, 'useEffect' | 'useRef'>,
  root: ReactNS.MutableRefObject<HTMLElement | null>,
  save: () => void,
): void {
  const { useEffect, useRef } = rt;
  const saveRef = useRef<() => void>(save);
  // 每次渲染转发一次：不建依赖数组，闭包里的 save 永远是最新的那份状态。
  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!isSaveHotkey(event, root.current)) return;
      event.preventDefault();
      saveRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [root]);
}
