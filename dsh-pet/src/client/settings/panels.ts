/**
 * 设置页的面板表：分区标识符 → 该分区的节点。
 *
 * 分区顺序与文案在 `./tabs.ts`，这里只负责「这个分区显示什么」。加一个分区就是表里加一项；
 * 三个装配较长、且有各自输入形状的分区（宠物 / 语音 / 对话 / 外观）各有自己的文件，
 * 只用两到三张卡按序拼起来的分区（全局 / 存储）就地写，不额外造文件。
 * 卡片组件在装配时造一次、跨渲染稳定；`deps` 每次渲染重取，节点按需构造。
 * owns only 分区到卡片的映射，never 字段状态、加载与写盘。
 * @module dsh-pet/src/client/settings/panels
 */
import type { jsx } from 'react/jsx-runtime';
import type { ShortcutHost } from '../app-shortcut.ts';
import type { Feedback } from './actions.ts';
import { makeGlobalCard } from './global-card.ts';
import { makeLookTab } from './look-tab.ts';
import { makeModelTab } from './model-tab.ts';
import { makePathsCards } from './paths-cards.ts';
import { makePetTab, type PetAvatarView } from './pet-tab.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeShortcutsCard } from './shortcuts-card.ts';
import type { SettingsTabId } from './tabs.ts';
import type { AppearanceSettings } from './use-appearance-settings.ts';
import type { GlobalSettings } from './use-global-settings.ts';
import type { ModelSettings } from './use-model-settings.ts';
import type { PetList } from './use-pet-list.ts';
import type { RemoteData } from './use-remote-data.ts';
import type { VoiceSettings } from './use-voice-settings.ts';
import { makeVoiceTab } from './voice-tab.ts';

/** 装配一个分区所需要的全部输入；设置页入口每渲染重建一次，卡片只读它。 */
export interface SettingsPanelDeps {
  /** 表单是否禁用（保存中或配置还没加载好）。 */
  readonly busy: boolean;
  /** 宠物列表状态与操作。 */
  readonly list: PetList;
  /** 保存 / 同步的最近一次反馈（宠物卡与头像上传共用）。 */
  readonly feedback: Feedback;
  /** 头像预览与上传入口。 */
  readonly avatar: PetAvatarView;
  /** 就近保存（宠物卡右上角与底部操作区是同一个动作）。 */
  readonly onSave: () => void;
  /** 页面级一次性拉取的结果（候选模型与落盘位置）。 */
  readonly remote: RemoteData;
  readonly global: GlobalSettings;
  readonly voice: VoiceSettings;
  readonly model: ModelSettings;
  readonly look: AppearanceSettings;
}

/** 一个分区的渲染入口：调用即得到该分区此刻的节点。 */
export type SettingsPanel = () => ReturnType<typeof jsx>;

/** 分区表：每个分区都必须有一项（缺项在类型检查期报错）。 */
export type SettingsPanels = Record<SettingsTabId, SettingsPanel>;

/**
 * 造面板表。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @param ctx - 客户端上下文：只用于读用户改绑后的快捷键键位。
 * @returns 接收 `deps` 的面板工厂；`deps` 每次渲染新取，卡片组件只造一次。
 */
export function makeSettingsPanels(
  rt: SettingsRuntime,
  ctx: ShortcutHost,
): (deps: SettingsPanelDeps) => SettingsPanels {
  const { h } = rt;
  const PetTab = makePetTab(rt);
  const GlobalCard = makeGlobalCard(rt);
  const LookTab = makeLookTab(rt);
  const VoiceTab = makeVoiceTab(rt);
  const ModelTab = makeModelTab(rt);
  const ShortcutsCard = makeShortcutsCard(rt, ctx);
  const { ConfigMetaCard, StorageCard } = makePathsCards(rt);

  return (deps: SettingsPanelDeps): SettingsPanels => ({
    pet: () =>
      h(PetTab, {
        list: deps.list,
        feedback: deps.feedback,
        avatar: deps.avatar,
        busy: deps.busy,
        onSave: deps.onSave,
      }),
    // 全局：五个开关 + 快捷键说明。快捷键卡只读，与开关是否禁用无关，所以不吃 busy。
    global: () =>
      h('div', {
        className: 'dsh-pet-cfg__group',
        children: [
          h(GlobalCard, {
            key: 'flags',
            busy: deps.busy,
            values: deps.global.values,
            onChange: deps.global.setFlag,
            volume: deps.global.soundVolume,
            onVolumeChange: deps.global.setSoundVolume,
          }),
          h(ShortcutsCard, { key: 'shortcuts' }),
        ],
      }),
    look: () => h(LookTab, { busy: deps.busy, look: deps.look }),
    voice: () => h(VoiceTab, { busy: deps.busy, voice: deps.voice }),
    model: () => h(ModelTab, { busy: deps.busy, model: deps.model, remote: deps.remote }),
    // 存储：两张只读卡都靠 meta，读不到就整块不出现（缺路径提示比给错路径更安全）。
    storage: () =>
      h('div', {
        className: 'dsh-pet-cfg__group',
        children: [
          deps.remote.paths ? h(ConfigMetaCard, { key: 'meta', paths: deps.remote.paths }) : null,
          deps.remote.paths ? h(StorageCard, { key: 'storage', paths: deps.remote.paths }) : null,
        ],
      }),
  });
}
