/**
 * 系统级快捷键：「全局隐藏 / 暂停」。
 *
 * 为什么必须是系统级（`globalShortcut`）而不是悬停裸键：这条快捷键的用途就是「宠物躲起来了也要能
 * 按回来」——全屏应用在前台时窗口被避让藏了、或者用户自己按过一次隐藏，页面上根本没有可悬停的东西。
 * 悬停键在那一刻必然按不到，所以它只能由主进程注册成全局键。
 *
 * 一次按键做两件事：把全部宠物窗口藏起来（或放出来），并让渲染端把语音暂停（或恢复）。
 * 窗口 hide() 之后页面还在跑，不通知渲染端就只是「看不见还在念」——两件事必须一起做。
 *
 * 不读配置、不管窗口细节（归 ./windows）：注册与注销都在这里，配置来源由 main.js 传进来。
 * @module dsh-fish-body/runtime/electron-helper/main/shortcut
 */
'use strict';

const { globalShortcut } = require('electron');

/** 组合键文本 → 能否注册。Electron 只认 accelerator 写法（`CommandOrControl+Alt+H`）。 */
function createHideAllHotkey({ windows, log, onToggled }) {
  /** 当前注册着的组合键（空串 = 没注册）。 */
  let registered = '';

  const toggle = () => {
    // 以主进程的「手动隐藏」为准：托盘菜单和这条快捷键改的是同一个状态，谁先按都从同一个值翻。
    const hidden = !windows.isHidden();
    windows.setHidden(hidden);
    // 渲染端据此静音 / 恢复：与「避让暂停」分开记，互不覆盖（见 src/shared/voice.ts）。
    windows.broadcastCommand(hidden ? 'pause' : 'resume');
    // 托盘那一项的文字（隐藏 / 显示）跟着翻：不同步的话按完快捷键再点托盘会像「没反应」。
    onToggled?.(hidden);
    log('[fish-body-desktop] 快捷键：' + (hidden ? '隐藏并暂停' : '显示并恢复') + '（' + registered + '）');
  };

  /**
   * 换一条组合键（重复调用会先注销旧的）。
   *
   * 注册失败（被系统或别的程序占用）只记一行日志、不抛：宠物本身仍然可用，
   * 托盘里还有「隐藏宠物」这条等价路径。
   */
  const apply = (accelerator) => {
    if (registered) {
      try {
        globalShortcut.unregister(registered);
      } catch {
        /* 已经没了：忽略 */
      }
      registered = '';
    }
    if (typeof accelerator !== 'string' || accelerator === '') return;
    try {
      const ok = globalShortcut.register(accelerator, toggle);
      if (!ok) {
        log('[fish-body-desktop] 快捷键注册被拒（可能被别的程序占用）：' + accelerator);
        return;
      }
      registered = accelerator;
      log('[fish-body-desktop] 快捷键已注册：' + accelerator + ' → 全局隐藏 / 暂停');
    } catch (e) {
      log('[fish-body-desktop] 快捷键注册失败：' + accelerator + ' ' + String(e && e.message ? e.message : e));
    }
  };

  /** 退出前清干净：全局键是系统资源，进程消失时 Electron 会收，但显式注销更稳。 */
  const dispose = () => {
    if (!registered) return;
    try {
      globalShortcut.unregister(registered);
    } catch {
      /* 忽略 */
    }
    registered = '';
  };

  return { apply, dispose, toggle, current: () => registered };
}

module.exports = { createHideAllHotkey };
