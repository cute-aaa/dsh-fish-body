/**
 * 「系统」分区：提醒与桌面、备份与恢复、快捷键参考、高级配置（文件）、卸载存储，以及插件维护。
 *
 * 这一页全是「插件与本机的关系」：怎么提醒、能不能点、键位是什么、文件落在哪、怎么卸干净、怎么重启。
 * 前四张卡都不产生「未保存改动」（开关随保存写，其余只读），只有提醒卡会出圆点；
 * 维护卡里的重启 / 重置由外壳执行，同样不进「未保存」的账。
 * owns only 这一块的装配，never 开关状态、路径拉取与卸载命令的生成。
 * @module dsh-pet/src/client/settings/system-tab
 */
import type { FunctionComponent } from 'react';
import type { SettingsBackupState } from './use-settings-backup.ts';
import { makeBackupCard } from './backup-card.ts';
import type { DirtyQuery } from './dirty.ts';
import type { Feedback } from './feedback.ts';
import { makeMaintenanceCard } from './maintenance-card.ts';
import type { MaintenanceActions } from './panels.ts';
import { makePathsCards } from './paths-cards.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeShortcutsCard } from './shortcuts-card.ts';
import { makeSystemCard } from './system-card.ts';
import type { ShortcutHost } from '../app-shortcut.ts';
import type { GlobalSettings } from './use-global-settings.ts';
import type { RemoteData } from './use-remote-data.ts';

/** 系统分区的输入。 */
export interface SystemTabProps {
  /** 表单是否禁用（保存中或配置还没就绪）。 */
  readonly busy: boolean;
  /** 全局开关（本分区只读系统三项）。 */
  readonly global: GlobalSettings;
  /** 测试通知的结论与触发入口。 */
  readonly perm: { readonly msg: Feedback; test(): void };
  /** 页面级一次性拉取的结果（落盘位置）。 */
  readonly remote: RemoteData;
  /** 未保存改动查询口。 */
  readonly dirty: DirtyQuery;
  /** 备份与恢复的状态与动作。 */
  readonly backup: SettingsBackupState;
  /** 重启插件与重置设置。 */
  readonly maintenance: MaintenanceActions;
}

/**
 * 造系统分区。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @param ctx - 客户端上下文：读改绑后的快捷键键位。
 * @returns 分区组件。
 */
export function makeSystemTab(rt: SettingsRuntime, ctx: ShortcutHost): FunctionComponent<SystemTabProps> {
  const { h, t } = rt;
  const SystemCard = makeSystemCard(rt);
  const BackupCard = makeBackupCard(rt);
  const ShortcutsCard = makeShortcutsCard(rt, ctx);
  const MaintenanceCard = makeMaintenanceCard(rt);
  const { ConfigMetaCard, StorageCard } = makePathsCards(rt);

  return function SystemTab(props: SystemTabProps) {
    const { busy, global, perm, remote, dirty, backup, maintenance } = props;
    return h('div', {
      className: 'dsh-pet-cfg__group',
      children: [
        h(SystemCard, {
          key: 'system',
          busy,
          flags: global.values,
          onFlag: global.setFlag,
          permMsg: perm.msg,
          onTestNotification: perm.test,
          dirty,
        }),
        // 维护动作紧跟系统卡：备份/恢复与具体设置项无关，也不产生「未保存改动」。
        h(BackupCard, {
          key: 'backup',
          busy: busy || backup.busy,
          onExport: backup.exportNow,
          onPick: backup.pick,
        }),
        h(ShortcutsCard, { key: 'shortcuts' }),
        // 两张路径卡都靠 meta，读不到就整块不出现（缺路径提示比给错路径更安全）。
        remote.paths ? h(ConfigMetaCard, { key: 'meta', paths: remote.paths }) : null,
        remote.paths ? h(StorageCard, { key: 'storage', paths: remote.paths }) : null,
        // 维护卡放最后：它是这一页唯一的破坏性 / 全局动作，不该在滚动首屏里被误点。
        h(MaintenanceCard, {
          key: 'maintenance',
          busy,
          intro: t('intro'),
          onRestart: maintenance.restart,
          onReset: maintenance.reset,
        }),
      ],
    });
  };
}
