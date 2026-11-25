/**
 * 「系统」分区：提醒与桌面、看屏幕与避让、快捷键参考，以及页尾的「维护动作」一组
 * （备份与恢复、文件与目录、插件维护）。
 *
 * 这一页分两段读：前半是「插件与本机的关系」（怎么提醒、能不能点、键位是什么），后半是维护动作
 * （备份 / 搬家 / 重启 / 重置 / 卸载）——它们配一次就不动，所以整组沉到页尾，也都不占底部操作栏。
 * 前两张卡会产生「未保存改动」；备份、文件与目录、维护卡由外壳执行，不进「未保存」的账。
 * owns only 这一块的装配，never 开关状态、路径拉取与运行时下载。
 * @module dsh-fish-body/src/client/settings/system-tab
 */
import type { FunctionComponent } from 'react';
import type { SettingsBackupState } from './use-settings-backup.ts';
import { makeBackupCard } from './backup-card.ts';
import type { DirtyQuery } from './dirty.ts';
import type { Feedback } from './feedback.ts';
import { makeFsCard } from './fs-card.ts';
import { makeMaintenanceCard } from './maintenance-card.ts';
import { makeCompatCard } from './compat-card.ts';
import { makePacksCard } from './packs-card.ts';
import type { PacksState } from './use-packs.ts';
import type { MaintenanceActions } from './panels.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeScreenCard } from './screen-card.ts';
import { makeShortcutsCard } from './shortcuts-card.ts';
import { makeSystemCard } from './system-card.ts';
import type { ShortcutHost } from '../app-shortcut.ts';
import type { GlobalSettings } from './use-global-settings.ts';
import type { ScreenSettings } from './use-screen-settings.ts';
import type { HotkeysSettings } from './use-hotkeys-settings.ts';
import type { RemoteData } from './use-remote-data.ts';
import { makeUiKit } from './ui.ts';

/** 系统分区的输入。 */
export interface SystemTabProps {
  /** 表单是否禁用（保存中或配置还没就绪）。 */
  readonly busy: boolean;
  /** 全局开关（本分区只读系统三项）。 */
  readonly global: GlobalSettings;
  /** 九个悬停键：快捷键卡直接改绑。 */
  readonly hotkeys: HotkeysSettings;
  /** 测试通知的结论与触发入口。 */
  readonly perm: { readonly msg: Feedback; test(): void };
  /** 页面级一次性拉取的结果（落盘位置）。 */
  readonly remote: RemoteData;
  /** 未保存改动查询口。 */
  readonly dirty: DirtyQuery;
  /** 备份与恢复的状态与动作。 */
  readonly backup: SettingsBackupState;
  /** 重启插件（先保存 / 不保存两种）与重置设置。 */
  readonly maintenance: MaintenanceActions;
  /** 看屏幕与避让的十三项。 */
  readonly screen: ScreenSettings;
  /** 资源包清单与装删动作（字体 / 表情包 / 动画 / Cubism 都不进包，靠这里补齐）。 */
  readonly packs: PacksState;
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
  const { section } = makeUiKit({ h, t });
  const SystemCard = makeSystemCard(rt);
  const BackupCard = makeBackupCard(rt);
  const ShortcutsCard = makeShortcutsCard(rt, ctx);
  const MaintenanceCard = makeMaintenanceCard(rt);
  const FsCard = makeFsCard(rt);
  const ScreenCard = makeScreenCard(rt);
  const PacksCard = makePacksCard(rt);
  const CompatCard = makeCompatCard(rt);

  return function SystemTab(props: SystemTabProps) {
    const { busy, global, hotkeys, perm, remote, dirty, backup, maintenance, screen, packs } = props;
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
        // 看屏幕与避让：十三项时机全在这张卡里，紧跟系统卡（同为「插件与本机的关系」）。
        h(ScreenCard, { key: 'screen', busy, screen, dirty }),
        // 快捷键是编辑性动作（随「保存」落盘、会亮圆点），所以留在维护组之前。
        h(ShortcutsCard, {
          key: 'shortcuts',
          hotkeys: hotkeys.values,
          hideAll: hotkeys.hideAll,
          onAssign: hotkeys.setKey,
          onReset: hotkeys.reset,
          onHideAllChange: hotkeys.setHideAll,
          onHideAllReset: hotkeys.resetHideAll,
          disabled: busy,
          dirty,
        }),
        // 素材与字体：字体、表情包、Cubism Core 都不进插件包（授权与体积原因），
        // 由这里按需获取；它不产生「未保存改动」，所以放在编辑性卡片之后、维护组之前。
        h(PacksCard, { key: 'packs', busy, packs }),
        // 兼容与记忆：谁也在驱动这只宠物、记忆插件接上了没有。即时生效，不产生未保存改动。
        h(CompatCard, { key: 'compat', busy }),
        // 维护动作一组：备份与恢复 → 文件与目录 → 插件维护。
        // 三者都不产生「未保存改动」，都是「配一次就不动」，所以聚在一处并沉到页尾；
        // 组内顺序按风险递增：只读的备份 → 会搬目录的文件卡 → 破坏性的重启 / 重置。
        section(t('maintenanceSection'), [
          h(BackupCard, {
            key: 'backup',
            busy: busy || backup.busy,
            onExport: backup.exportNow,
            onPick: backup.pick,
          }),
          // 文件与目录：路径、可删性、运行时与卸载都在一张卡里；读不到 meta 就整块不出现
          // （缺路径提示比给错路径更安全）。搬迁完成后的「立即重启」走与维护卡同一个实现。
          remote.paths ? h(FsCard, { key: 'fs', paths: remote.paths, onRestart: maintenance.restartNow }) : null,
          // 维护卡放最后：它是这一组里唯一的破坏性 / 全局动作，不该在滚动首屏里被误点。
          h(MaintenanceCard, {
            key: 'maintenance',
            busy,
            intro: t('intro'),
            onRestart: maintenance.restart,
            onReset: maintenance.reset,
          }),
        ]),
      ],
    });
  };
}
