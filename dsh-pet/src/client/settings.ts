/**
 * 「桌宠配置」设置页（`settings.section` 插槽，id 为 pet-config）：按分区编辑宠物、全局、外观、语音、对话与存储。
 *
 * 本文件是装配根：分区表在 `settings/tabs.ts`，字段状态在 `settings/use-*.ts`，
 * 分区到卡片的映射在 `settings/panels.ts`，写盘在 `settings/config/`。
 * 这里只剩加载、写盘编排、快捷键与分区外壳，所以照旧不自己拼条目级字段；文件宠物永不回写。
 * 保存与同步都全量写用户层，再把宿主返回的成品交给 `applyConfig`——两条路都无需刷新页面。
 * @module dsh-pet/src/client/settings
 */
import { avatarUrl } from '../shared/avatar.ts';
import type { FunctionComponent } from 'react';
import type { ShortcutHost } from './app-shortcut.ts';
import { type Feedback, makeActions } from './settings/actions.ts';
import { petBridge } from './settings/bridge.ts';
import {
  createWriteFlow,
  type MergedConfig,
  readConfigEntries,
  readMainConfig,
  useConfigLoad,
} from './settings/config/index.ts';
import { injectSettingsCss } from './settings/css.ts';
import { makeDialog, type DialogState } from './settings/dialog.ts';
import { makeLoadStatus } from './settings/load-status.ts';
import { makeSettingsPanels, type SettingsPanelDeps } from './settings/panels.ts';
import { useSaveHotkey } from './settings/save-hotkey.ts';
import type { SettingsRuntime } from './settings/runtime.ts';
import { DEFAULT_SETTINGS_TAB, makeTabBar, tabButtonId, tabPanelId, type SettingsTabId } from './settings/tabs.ts';
import { attachTipLayer } from './settings/tip-layer.ts';
import { makeUiKit } from './settings/ui.ts';
import { useAppearanceSettings } from './settings/use-appearance-settings.ts';
import { useAvatarUpload } from './settings/use-avatar-upload.ts';
import { useGlobalSettings } from './settings/use-global-settings.ts';
import { useModelSettings } from './settings/use-model-settings.ts';
import { usePermissionTest } from './settings/use-permission-test.ts';
import { usePetList } from './settings/use-pet-list.ts';
import { useRemoteData } from './settings/use-remote-data.ts';
import { useVoiceSettings } from './settings/use-voice-settings.ts';

// 字典与桥的真源都在 settings/ 里：宿主的 locale 注册、容器与测试夹具都经这里取，不各自深路径引用。
export { dicts, NS } from './settings/locales/index.ts';
export type { Key } from './settings/locales/index.ts';
export { petBridge };

/**
 * 制造「桌宠配置」设置页组件。
 * 浏览器半侧是 `__ModuleLoader__` 单文件形态，react 能力只能由宿主在运行时注入，
 * 因此以工厂接收依赖，造出组件后再注册进设置页插槽。
 * @param rt - 运行时注入的依赖：`h`、hooks 与翻译函数 `t`。
 * @param ctx - 客户端上下文：只用于读用户改绑后的快捷键键位。
 * @returns 设置页组件；`close` 由设置页外壳提供，本页未使用。
 */
export function makePetConfigSection(
  rt: SettingsRuntime,
  ctx: ShortcutHost,
): FunctionComponent<{ close?: () => void }> {
  const { h, useState, useEffect, useRef, useCallback, t } = rt;

  // 样式注入幂等，重复渲染不会重复插入。
  injectSettingsCss();

  const { q } = makeUiKit({ h, t });

  // 外壳部件与面板表在装配时各造一次：组件类型必须跨渲染稳定，
  // 否则选择器与标签条的浮层 / 焦点状态每次渲染都会丢。
  const Actions = makeActions(rt);
  const SettingsDialog = makeDialog(rt);
  const LoadStatus = makeLoadStatus({ h, t });
  const TabBar = makeTabBar({ h, t, useRef });
  const panelsOf = makeSettingsPanels(rt, ctx);

  return function PetConfigSection() {
    const [saving, setBusy] = useState(false);
    const [msg, setMsg] = useState<Feedback>({ kind: '', text: '' });
    // 当前分区只是本地视图状态：不写盘，也不参与保存。
    const [tab, setTab] = useState<SettingsTabId>(DEFAULT_SETTINGS_TAB);
    // 设置页根节点：Ctrl+S 只在它可见时接管。
    const rootRef = useRef<HTMLElement | null>(null);
    // 确认 / 提示弹窗：remove 删除宠物、lastOne 只剩一只删不了、sync 同步覆盖、corrupt 用户配置已损坏。
    const [dialog, setDialog] = useState<DialogState>(null);

    // 各分区的字段状态各归各的文件；这里只按顺序取用，不碰它们的内部状态。
    const list = usePetList(rt, setDialog);
    const global = useGlobalSettings(rt);
    const voice = useVoiceSettings(rt);
    const model = useModelSettings(rt);
    const look = useAppearanceSettings(rt);
    // 一次性拉取的宿主数据：落盘位置（存储分区两张卡）与候选模型清单（对话分区的下拉框）。
    const remote = useRemoteData(rt);
    // 头像上传不走「保存」；测试通知的反馈与保存反馈分开放。
    const current = list.pets.find((pet) => pet.id === list.selId) ?? null;
    const avatar = useAvatarUpload(rt, { pet: current, report: setMsg, t });
    const permission = usePermissionTest(rt);

    // 首次读取与恢复默认必须更新同一组控件，避免下一次保存回写过期值。
    // 每个分区只认自己那几项，这里按分区派发，不逐字段 setState。
    const { replace } = list;
    const applyGlobal = global.apply;
    const applyVoice = voice.apply;
    const applyModel = model.apply;
    const applyLook = look.apply;
    const applyConfig = useCallback(
      (merged: MergedConfig): void => {
        // 条目列表与全局字段各取一份：前者给标签条与保存时的写回计划，后者给各分区卡片。
        const entries = readConfigEntries(merged);
        const patch = readMainConfig(merged);
        if (entries === null || patch === null) throw new Error('Invalid config response');
        replace(entries);
        applyGlobal(patch);
        applyVoice(patch);
        applyModel(patch);
        applyLook(patch);
      },
      [replace, applyGlobal, applyVoice, applyModel, applyLook],
    );

    // 配置没就绪（加载中 / 失败）时整页只读，避免在占位值上编辑再保存回去。
    const { loadState, retry } = useConfigLoad(rt, applyConfig);
    const busy = saving || loadState !== 'ready';

    // 说明气泡：挂 body 摆位（伪元素会被窗口边缘与滚动容器裁掉），随页面卸载一起拆。
    useEffect(() => attachTipLayer(), []);

    // 文件宠物条目数：只用于标题提示「另 n 只来自 pet/ 目录」。
    const packCount = list.kinds.filter((item) => item.kind === 'pack').length;

    // 写路径在 settings/config/write-flow.ts：保存、请求同步与「确认」派发都走同一条校验与落盘。
    // 传的是回调而不是值——save 每次渲染重建，捕获状态会拿旧值存盘。
    // 请求体按分区摊平：每个分区自己那几项，键名与成品配置字段同名。
    const write = createWriteFlow({
      fields: () => ({
        // PUT /config 只写用户主配置：只能提交 main 层实例，pack 实例走 POST /pet-config。
        pets: list.mainPets,
        ...global.values,
        ...model.chatFlags,
        voiceEnabled: voice.enabled,
        voiceName: voice.name,
        voiceVolume: voice.volume,
        voiceWhisperEnabled: voice.whisper,
        voiceTodoEnabled: voice.todo,
        voiceNotifyEnabled: voice.notify,
        physics: look.physics,
        whisperModel: model.whisperModel,
        chatModel: model.chatModel,
        chatMemoryRounds: model.chatMemory,
        chatImageLimit: model.chatImageLimit,
        font: look.font,
        animationWeights: look.weights,
      }),
      busy: () => busy,
      setBusy,
      setMsg,
      setDialog,
      dialog: () => dialog,
      applyConfig,
      packWrites: list.packWrites,
      userFile: () => remote.paths?.user ?? '',
      t,
      onRemove: list.remove,
    });

    useSaveHotkey(rt, rootRef, () => void write.save());

    const deps: SettingsPanelDeps = {
      busy,
      list,
      feedback: msg,
      // 预览与聊天面板同一个地址：内置回默认 logo，所以无需区分「有没有头像」。
      avatar: { src: avatarUrl(current?.assetRoot ?? '', avatar.version), busy: avatar.busy, onPick: avatar.upload },
      onSave: () => void write.save(),
      remote,
      global,
      voice,
      model,
      look,
    };
    const panels = panelsOf(deps);

    return h('section', {
      ref: rootRef,
      className: 'dsh-pet-cfg',
      style: { maxWidth: '720px' },
      children: [
        // 标题：intro 与「额外宠物」说明都收进问号。
        h('h2', {
          className: 'dsh-pet-cfg__title',
          children: [
            t('nav'),
            q(packCount > 0 ? t('intro') + '\n' + t('extraPetsHint').replace('{n}', String(packCount)) : t('intro')),
          ],
        }),

        h(LoadStatus, { loadState, onRetry: retry }),

        // 只渲染当前分区：其余分区的卡片不构造节点（字段状态仍在各 hook 里，切回来不丢）。
        h(TabBar, { active: tab, onSelect: setTab }),
        h('div', {
          role: 'tabpanel',
          id: tabPanelId(tab),
          'aria-labelledby': tabButtonId(tab),
          className: 'dsh-pet-cfg__panel',
          children: panels[tab](),
        }),

        // 操作区不属任何分区：保存按钮在任何分区里都在同一位置。
        h(Actions, {
          busy,
          msg,
          permMsg: permission.message,
          onSave: () => void write.save(),
          onSync: write.requestSync,
          onTestNotification: permission.test,
        }),

        dialog
          ? h(SettingsDialog, {
              dialog,
              selId: list.selId,
              onDismiss: () => setDialog(null),
              onConfirm: write.confirmDialog,
            })
          : null,
      ],
    });
  };
}
