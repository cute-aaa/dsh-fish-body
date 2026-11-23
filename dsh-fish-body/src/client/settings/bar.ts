/**
 * 分区底部的常驻操作栏：状态（未保存数 / 保存结论 / 需重启条数）+ 撤销 / 取消 / 应用 / 确定。
 *
 * 贴底常显（`position:sticky`），长表单滚动时四个动作始终在手边；按钮顺序按「越靠右越终局」排，
 * 确定用实心主按钮。写盘或配置未就绪时禁掉的只有会改东西的三个（撤销 / 应用 / 确定）：
 * 「取消」只关闭页面，留着它才有退路——它同时也是「配置读失败」时唯一能用的按钮。
 * 重启与重置不在这一行：它们是维护动作，改一次就不动，已迁到「系统 → 维护动作」一组。
 * 唯一的例外是「已保存、但要重建桌面窗口才生效」的那条：它属于**保存的收尾**，不是维护动作，
 * 所以带一个「立即重启」一起出现在状态行右侧；没有这类改动时两个字节点都不渲染，不留空位。
 * 顶部一行只有一条状态：有反馈就显示反馈，否则显示未保存条数——两者不并排，避免底部栏左右各一句话。
 * owns only 按钮与状态的排布，never 保存 / 关闭 / 撤销 / 重启的实现。
 * @module dsh-fish-body/src/client/settings/bar
 */
import type { FunctionComponent } from 'react';
import type { Feedback } from './feedback.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';

/** 「已保存但需重启才生效」的提示与入口。 */
export interface BarRestart {
  /** 需重启才生效的改动条数（≥1 时才传这个对象）。 */
  readonly count: number;
  /** 立即重启（先保存再重启，与维护卡同一实现）。 */
  onRestart(): void;
  /** 重启请求进行中：按钮置灰。 */
  readonly busy: boolean;
}

/** 底部操作栏的输入。 */
export interface BarProps {
  /** 保存中或配置未就绪：三个会改东西的按钮一起禁用。 */
  readonly busy: boolean;
  /** 保存 / 重置 / 撤销的最近一次结论。 */
  readonly msg: Feedback;
  /** 未保存改动条数：用于禁掉「撤销改动」并显示计数。 */
  readonly dirtyCount: number;
  /** 撤销：把未保存的改动丢掉，回到服务端权威值。 */
  onRevert(): void;
  /** 确定：保存成功后由外壳关闭设置页。 */
  onConfirm(): void;
  /** 取消：不保存直接关闭设置页。 */
  onCancel(): void;
  /** 应用：保存但不关闭。 */
  onApply(): void;
  /** 已保存但仍需重启再生效的改动；缺省 = 没有这类改动。 */
  readonly restart?: BarRestart;
}

/**
 * 造底部操作栏。
 *
 * @param rt - 注入的节点工厂与翻译函数。
 * @returns 操作栏组件。
 */
export function makeBar(rt: SettingsRuntime): FunctionComponent<BarProps> {
  const { h, t } = rt;
  const { tip } = makeUiKit({ h, t });

  return function Bar(props: BarProps) {
    const { busy, msg, dirtyCount, restart } = props;
    return h('div', {
      className: 'dsh-pet-cfg__bar',
      role: 'group',
      'aria-label': t('barGroup'),
      children: [
        // 需重启的提示排在状态之前：它是「这次保存」的结论，比「还剩几项没存」更该先读到。
        restart === undefined
          ? null
          : h('span', {
              key: 'restart',
              className: 'dsh-pet-cfg__barState is-restart',
              role: 'status',
              children: t('restartPending').replace('{n}', String(restart.count)),
            }),
        restart === undefined
          ? null
          : h('button', {
              key: 'restartNow',
              type: 'button',
              className: 'dsh-pet-cfg__btn is-sm',
              disabled: busy || restart.busy,
              onClick: restart.onRestart,
              ...tip(t('barRestartHint')),
              children: t('fsLocationRestart'),
            }),
        msg.text
          ? h('span', {
              key: 'msg',
              className: 'dsh-pet-cfg__msg' + (msg.kind === 'err' ? ' is-err' : ''),
              role: 'status',
              children: msg.text,
            })
          : dirtyCount > 0
            ? h('span', {
                key: 'count',
                className: 'dsh-pet-cfg__barState',
                role: 'status',
                children: [
                  h('i', { key: 'd', className: 'dsh-pet-cfg__dot', 'aria-hidden': 'true' }),
                  t('barDirty').replace('{n}', String(dirtyCount)),
                ],
              })
            : null,
        // 撑开中间：状态贴左、动作贴右，状态出现 / 消失时按钮不跳位。
        h('span', { key: 'spacer', className: 'dsh-pet-cfg__barSpacer' }),
        h('button', {
          key: 'revert',
          type: 'button',
          className: 'dsh-pet-cfg__btn',
          disabled: busy || dirtyCount === 0,
          onClick: props.onRevert,
          ...tip(t('barRevertHint')),
          children: t('barRevert'),
        }),
        h('button', {
          key: 'cancel',
          type: 'button',
          className: 'dsh-pet-cfg__btn',
          onClick: props.onCancel,
          ...tip(t('barCancelHint')),
          children: t('barCancel'),
        }),
        h('button', {
          key: 'apply',
          type: 'button',
          className: 'dsh-pet-cfg__btn',
          disabled: busy,
          onClick: props.onApply,
          ...tip(t('barApplyHint') + '（' + t('saveHotkey') + '）'),
          children: t('barApply'),
        }),
        h('button', {
          key: 'confirm',
          type: 'button',
          className: 'dsh-pet-cfg__btn is-primary',
          disabled: busy,
          onClick: props.onConfirm,
          ...tip(t('barConfirmHint')),
          children: t('barConfirm'),
        }),
      ],
    });
  };
}
