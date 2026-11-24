/**
 * 设置页的面板表：分区标识符 → 该分区的节点。
 *
 * 分区顺序与文案在 `./tabs.ts`，这里只负责「这个分区显示什么」。加一个分区就是表里加一项；
 * 装配较长、各有输入形状的分区（桌宠 / 外观与手感 / 声音 / 对话 / 会话鱼 / 系统）各有自己的文件，
 * 面板表只按顺序把状态递进去。卡片组件在装配时造一次、跨渲染稳定；`deps` 每次渲染重取。
 * owns only 分区到卡片的映射，never 字段状态、加载与写盘。
 * @module dsh-fish-body/src/client/settings/panels
 */
import type { jsx } from 'react/jsx-runtime';
import type { ShortcutHost } from '../app-shortcut.ts';
import { makeAudioTab } from './audio-tab.ts';
import type { DirtyQuery } from './dirty.ts';
import { makeFeelTab } from './feel-tab.ts';
import type { Feedback } from './feedback.ts';
import { makeFishTab } from './fish-tab.ts';
import { makeModelTab } from './model-tab.ts';
import { makePetTab, type PetAvatarView } from './pet-tab.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeSystemTab } from './system-tab.ts';
import type { SettingsTabId } from './tabs.ts';
import type { AppearanceSettings } from './use-appearance-settings.ts';
import type { GlobalSettings } from './use-global-settings.ts';
import type { HotkeysSettings } from './use-hotkeys-settings.ts';
import type { RemoteData } from './use-remote-data.ts';
import type { SessionFishState } from './use-session-fish.ts';
import type { SettingsBackupState } from './use-settings-backup.ts';
import type { PacksState } from './use-packs.ts';
import type { ScreenSettings } from './use-screen-settings.ts';
import type { SfxSettings } from './use-sfx-settings.ts';
import type { ModelSettings } from './use-model-settings.ts';
import type { PetList } from './use-pet-list.ts';
import type { VoiceSettings } from './use-voice-settings.ts';
import type { PersonaCharactersState } from './use-persona-characters.ts';
import type { PersonaImportState } from './use-persona-import.ts';
import type { PersonaPolishState } from './use-persona-polish.ts';
import type { RenderResourcesState } from './use-render-resources.ts';

/**
 * 维护动作（重启 / 重置）：只在系统分区末尾的「维护动作」一组里出现。
 *
 * 两个重启入口共用同一份实现（`use-plugin-restart`），差别只有「要不要先存盘」：
 * `restart` 先保存再重启（维护卡与底部栏），`restartNow` 直接重启（搬迁完成后让新位置生效）。
 */
export interface MaintenanceActions {
  restart(): void;
  restartNow(): void;
  reset(): void;
}

/** 装配一个分区所需要的全部输入。 */
export interface SettingsPanelDeps {
  /** 表单是否禁用（保存中或配置还没加载好）。 */
  readonly busy: boolean;
  /** 宠物列表状态与操作。 */
  readonly list: PetList;
  /** 头像预览与上传入口。 */
  readonly avatar: PetAvatarView;
  /** 页面级一次性拉取的结果（候选模型与落盘位置）。 */
  readonly remote: RemoteData;
  readonly global: GlobalSettings;
  /** 九个悬停键（「系统」分区里的快捷键卡可改绑）。 */
  readonly hotkeys: HotkeysSettings;
  readonly sfx: SfxSettings;
  readonly voice: VoiceSettings;
  readonly model: ModelSettings;
  readonly look: AppearanceSettings;
  /** 会话鱼草稿与动作。 */
  readonly fish: SessionFishState;
  /** 测试通知的结论与触发入口。 */
  readonly perm: { readonly msg: Feedback; test(): void };
  /** 备份与恢复。 */
  readonly backup: SettingsBackupState;
  /** 资源包（字体 / 表情包 / 动画 / Cubism）清单与装删动作。 */
  readonly packs: PacksState;
  /** 看屏幕与避让的十三项（「系统」分区的同一张卡）。 */
  readonly screen: ScreenSettings;
  /** 重启插件与重置设置。 */
  readonly maintenance: MaintenanceActions;
  /** 角色库（来源 / 角色 / 应用 / 删除）。 */
  readonly characters: PersonaCharactersState;
  /** 文档导入草稿。 */
  readonly personaImport: PersonaImportState;
  /** AI 润色预览。 */
  readonly polish: PersonaPolishState;
  /** 渲染资源三桶清单。 */
  readonly resources: RenderResourcesState;
  /** 跳到另一个分区（声音页的「会话鱼播报」引用行）。 */
  readonly onSelectTab: (tab: SettingsTabId) => void;
  /** 从声音页跳过来时要聚焦的锚点（fish.speak）。 */
  readonly focusAnchor: string | null;
  /** 未保存改动查询口：各卡片据此在卡头上画圆点。 */
  readonly dirty: DirtyQuery;
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
  const FeelTab = makeFeelTab(rt);
  const AudioTab = makeAudioTab(rt);
  const ModelTab = makeModelTab(rt);
  const FishTab = makeFishTab(rt);
  const SystemTab = makeSystemTab(rt, ctx);

  return (deps: SettingsPanelDeps): SettingsPanels => ({
    pet: () =>
      h(PetTab, {
        list: deps.list,
        avatar: deps.avatar,
        busy: deps.busy,
        dirty: deps.dirty,
        character: { persona: deps.characters, importer: deps.personaImport, polish: deps.polish },
        onChange: deps.list.update,
      }),
    feel: () =>
      h(FeelTab, {
        busy: deps.busy,
        look: deps.look,
        dirty: deps.dirty,
        pet: deps.list.pets.find((pet) => pet.id === deps.list.selId) ?? null,
        petIndex: deps.list.pets.findIndex((pet) => pet.id === deps.list.selId),
        resources: deps.resources,
        global: deps.global,
        onChange: deps.list.update,
      }),
    audio: () =>
      h(AudioTab, {
        busy: deps.busy,
        global: deps.global,
        sfx: deps.sfx,
        voice: deps.voice,
        dirty: deps.dirty,
        onSelectTab: deps.onSelectTab,
      }),
    chat: () => h(ModelTab, { busy: deps.busy, model: deps.model, remote: deps.remote, dirty: deps.dirty }),
    fish: () => h(FishTab, { busy: deps.busy, fish: deps.fish, dirty: deps.dirty, focusAnchor: deps.focusAnchor }),
    system: () =>
      h(SystemTab, {
        busy: deps.busy,
        global: deps.global,
        hotkeys: deps.hotkeys,
        perm: deps.perm,
        remote: deps.remote,
        dirty: deps.dirty,
        backup: deps.backup,
        packs: deps.packs,
        screen: deps.screen,
        maintenance: deps.maintenance,
      }),
  });
}
