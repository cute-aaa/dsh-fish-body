/**
 * 系统与桌面卡：系统通知、系统托盘、锁定在当前屏幕，以及「测试弹窗」按钮与它的就地反馈。
 *
 * 这三个开关都只影响「本机怎么显示 / 怎么提醒」，与桌宠本身的动作无关，所以和音效解耦后自成一卡。
 * 「测试弹窗」挂进卡头右侧：它是这张卡的验证入口，不是第四个设置项——放在开关下方会让人以为它也保存一个值。
 * 通知开关额外需要用户手势，开与关都走外壳同一个入口，卡里只回传键名与目标值；
 * 测试结论与保存结论分开放，互不覆盖。
 * @module dsh-fish-body/src/client/settings/system-card
 */
import type { FunctionComponent } from 'react';
import type { DirtyQuery } from './dirty.ts';
import type { Feedback } from './feedback.ts';
import { type GlobalFlagKey, type GlobalFlags } from './global-flags.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';

/** 系统与桌面卡的输入。 */
export interface SystemCardProps {
  /** 保存中或配置未就绪时禁用开关。 */
  readonly busy: boolean;
  /** 五个全局开关的当前值（本卡只读其中三个系统项）。 */
  readonly flags: GlobalFlags;
  /** 切一个开关；通知开关的权限申请由外壳处理。 */
  readonly onFlag: (key: GlobalFlagKey, value: boolean) => void;
  /** 测试通知的最近一次结论（空文案 = 还没测过）。 */
  readonly permMsg: Feedback;
  /** 发一条测试系统通知。 */
  onTestNotification(): void;
  /** 未保存改动查询口。 */
  readonly dirty: DirtyQuery;
}

/**
 * 造系统与桌面卡。
 *
 * @param rt - 注入的节点工厂与翻译函数。
 * @returns 卡片组件。
 */
export function makeSystemCard(rt: SettingsRuntime): FunctionComponent<SystemCardProps> {
  const { h, t } = rt;

  return function SystemCard(props: SystemCardProps) {
    const { busy, flags, permMsg, dirty } = props;
    const { cardHead, toggleCell, switchGrid } = makeUiKit({ h, t }, dirty);
    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(
          t('systemTitle'),
          t('systemHint'),
          ['global.petEnabled', 'global.notificationsEnabled', 'global.trayEnabled', 'global.confineToScreen'],
          h('button', {
            type: 'button',
            className: 'dsh-pet-cfg__btn is-sm',
            onClick: props.onTestNotification,
            children: t('notifyTest'),
          }),
        ),
        switchGrid([
          toggleCell(
            'petToggle',
            flags.petEnabled,
            busy,
            (value) => props.onFlag('petEnabled', value),
            'global.petEnabled',
          ),
          toggleCell(
            'notifyToggle',
            flags.notificationsEnabled,
            busy,
            (value) => props.onFlag('notificationsEnabled', value),
            'global.notificationsEnabled',
          ),
          toggleCell(
            'trayToggle',
            flags.trayEnabled,
            busy,
            (value) => props.onFlag('trayEnabled', value),
            'global.trayEnabled',
          ),
          toggleCell(
            'confineToggle',
            flags.confineToScreen,
            busy,
            (value) => props.onFlag('confineToScreen', value),
            'global.confineToScreen',
          ),
        ]),
        // 测试结论就地落在开关下方：它验的是「这条链路通不通」，与保存结论互不覆盖。
        permMsg.text
          ? h('span', {
              key: 'msg',
              className: 'dsh-pet-cfg__msg' + (permMsg.kind === 'err' ? ' is-err' : ''),
              role: 'status',
              children: permMsg.text,
            })
          : null,
      ],
    });
  };
}
