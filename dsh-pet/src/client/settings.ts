/**
 * 「桌宠配置」设置页（`settings.section`，id 为 pet-config）：六个功能分区 + 底部常驻操作栏。
 *
 * 本文件是装配根：分区表在 `settings/tabs.ts`，字段状态在 `settings/use-*.ts`，
 * 分区到卡片的映射在 `settings/panels.ts`，表单快照在 `settings/snapshot.ts`，写盘在 `settings/config/`。
 * 这里只剩加载、写盘编排、未保存改动基线、快捷键与外壳，所以照旧不自己拼条目级字段。
 * 基线（最近一次服务端权威值）在加载、保存成功与重置成功后推进；圆点由「基线 vs 当前」的 diff 决定。
 * 保存相关只有一条准则：任何改动都随底部栏落盘，页面自己不做即时写入。
 * @module dsh-fish-body/src/client/settings
 */
import { avatarUrl } from '../shared/avatar.ts';
import type { SessionFishSettings } from '../shared/session-fish.ts';
import type { FunctionComponent } from 'react';
import type { ShortcutHost } from './app-shortcut.ts';
import { requestPluginRestart, schedulePageReload } from './plugin-restart.ts';
import { makeBar } from './settings/bar.ts';
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
import { baselineFromConfig, diffSnapshot, dirtyTabs, makeDirtyQuery, type FormSnapshot } from './settings/dirty.ts';
import { NO_FEEDBACK, type Feedback } from './settings/feedback.ts';
import { makeLoadStatus } from './settings/load-status.ts';
import { makeSettingsPanels, type SettingsPanelDeps } from './settings/panels.ts';
import { buildSaveFields } from './settings/save-fields.ts';
import { useSaveHotkey } from './settings/save-hotkey.ts';
import { makeSnapshot, withoutFish } from './settings/snapshot.ts';
import { readSavedTab, saveTab, settingsTabStorage } from './settings/tab-memory.ts';
import type { SettingsRuntime } from './settings/runtime.ts';
import { highlightMatches } from './settings/search.ts';
import { useSettingsSearch } from './settings/use-settings-search.ts';
import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_TABS,
  makeTabBar,
  tabButtonId,
  tabPanelId,
  type SettingsTabId,
} from './settings/tabs.ts';
import { attachTipLayer } from './settings/tip-layer.ts';
import { useAppearanceSettings } from './settings/use-appearance-settings.ts';
import { useAvatarUpload } from './settings/use-avatar-upload.ts';
import { useGlobalSettings } from './settings/use-global-settings.ts';
import { useHotkeysSettings } from './settings/use-hotkeys-settings.ts';
import { useModelSettings } from './settings/use-model-settings.ts';
import { usePermissionTest } from './settings/use-permission-test.ts';
import { usePetList } from './settings/use-pet-list.ts';
import { useRemoteData } from './settings/use-remote-data.ts';
import { useRevert } from './settings/use-revert.ts';
import { useSessionFish } from './settings/use-session-fish.ts';
import { useSettingsBackup } from './settings/use-settings-backup.ts';
import { useSfxSettings } from './settings/use-sfx-settings.ts';
import { useVoiceSettings } from './settings/use-voice-settings.ts';

// 字典与桥的真源都在 settings/ 里：宿主的 locale 注册、容器与测试夹具都经这里取，不各自深路径引用。
export { dicts, NS } from './settings/locales/index.ts';
export type { Key } from './settings/locales/index.ts';
export { petBridge };

/** 一条改动都没有时的路径集合（模块级常量：避免每次渲染新建）。 */
const NO_PATHS: ReadonlySet<string> = new Set<string>();

/**
 * 制造「桌宠配置」设置页组件。
 * 浏览器半侧是 `__ModuleLoader__` 单文件形态，react 能力只能由宿主在运行时注入，
 * 因此以工厂接收依赖，造出组件后再注册进设置页插槽。
 * @param rt - 运行时注入的依赖：`h`、hooks 与翻译函数 `t`。
 * @param ctx - 客户端上下文：只用于读用户改绑后的快捷键键位。
 * @returns 设置页组件；`close` 由设置页外壳提供（确定与取消都要用它）。
 */
export function makePetConfigSection(
  rt: SettingsRuntime,
  ctx: ShortcutHost,
): FunctionComponent<{ close?: () => void }> {
  const { h, useState, useEffect, useRef, useCallback, t } = rt;

  // 样式注入幂等，重复渲染不会重复插入。
  injectSettingsCss();

  // 外壳部件与面板表在装配时各造一次：组件类型必须跨渲染稳定，
  // 否则选择器与标签条的浮层 / 焦点状态每次渲染都会丢。
  const SettingsDialog = makeDialog(rt);
  const LoadStatus = makeLoadStatus({ h, t });
  const TabBar = makeTabBar({ h, t, useRef });
  const Bar = makeBar(rt);
  const panelsOf = makeSettingsPanels(rt, ctx);
  // 分区记忆：装配时读一次（渲染期不再碰存储），初始分区取上次停留的那一页。
  const tabStorage = settingsTabStorage();
  const firstTab: SettingsTabId = readSavedTab(tabStorage) ?? DEFAULT_SETTINGS_TAB;

  return function PetConfigSection(props) {
    const close = props.close;
    const [saving, setBusy] = useState(false);
    const [msg, setMsg] = useState<Feedback>(NO_FEEDBACK);
    // 当前分区只是本地视图状态：不写配置，只在 localStorage 里记一笔「上次看到哪」。
    const [tab, setTab] = useState<SettingsTabId>(firstTab);
    // 设置页根节点：Ctrl+S 只在它可见时接管。
    const rootRef = useRef<HTMLElement | null>(null);
    // 确认 / 提示弹窗：remove 删除宠物、lastOne 只剩一只删不了、reset 重置设置、corrupt 用户配置已损坏。
    const [dialog, setDialog] = useState<DialogState>(null);
    // 基线：最近一次服务端权威值；null = 还没加载好，此时一个圆点都不画。
    const [baseline, setBaseline] = useState<FormSnapshot | null>(null);
    // 会话鱼不在成品配置里，它的基线单独记；成品配置后到时再一起塞进 baseline。
    const fishBaselineRef = useRef<SessionFishSettings | null>(null);
    // 当前快照的最新值：保存成功后用它推进基线（回调里读不到渲染期的局部变量）。
    const snapshotRef = useRef<FormSnapshot | null>(null);

    /** 会话鱼权威值到达（加载 / 保存 / 重置成功）：记下来并补进基线。 */
    const markFish = useCallback((settings: SessionFishSettings): void => {
      fishBaselineRef.current = settings;
      setBaseline((current) => (current === null ? current : { ...current, fish: settings }));
    }, []);

    // 各分区的字段状态各归各的文件；这里只按顺序取用，不碰它们的内部状态。
    const list = usePetList(rt, setDialog);
    const global = useGlobalSettings(rt);
    // 九个悬停键：可改绑，随保存整包写进 main 条目顶层。
    const hotkeys = useHotkeysSettings(rt);
    const sfx = useSfxSettings(rt);
    const voice = useVoiceSettings(rt);
    const model = useModelSettings(rt);
    const look = useAppearanceSettings(rt);
    // 一次性拉取的宿主数据：落盘位置（系统分区的两张卡）与候选模型清单（对话分区的下拉框）。
    const remote = useRemoteData(rt);
    // 头像上传不走「保存」；测试通知的反馈与保存反馈分开放。
    const current = list.pets.find((pet) => pet.id === list.selId) ?? null;
    const avatar = useAvatarUpload(rt, { pet: current, report: setMsg, t });
    const permission = usePermissionTest(rt);
    // 会话鱼：草稿、皮肤清单与两个写入口；保存 / 重置由底部栏触发。
    const fish = useSessionFish(rt, { report: setMsg, onAuthoritative: markFish });

    // 首次读取与恢复默认必须更新同一组控件，避免下一次保存回写过期值。
    // 每个分区只认自己那几项，这里按分区派发，不逐字段 setState；同时推进基线。
    const { replace } = list;
    const applyGlobal = global.apply;
    const applyHotkeys = hotkeys.apply;
    const applySfx = sfx.apply;
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
        applyHotkeys(patch);
        applySfx(patch);
        applyVoice(patch);
        applyModel(patch);
        applyLook(patch);
        // 刚读到 / 刚重置：表单即将等于这份权威值，基线跟着走（会话鱼那半截由 markFish 补）。
        setBaseline({ ...baselineFromConfig(entries, patch), fish: fishBaselineRef.current });
      },
      [replace, applyGlobal, applyHotkeys, applySfx, applyVoice, applyModel, applyLook],
    );

    // 备份与恢复：导出只读不写；恢复要先过确认弹窗，写成功后用它回填表单并推进基线。
    const backup = useSettingsBackup(rt, {
      report: setMsg,
      setDialog,
      onRestored: (merged, settings) => {
        applyConfig(merged);
        fish.apply(settings);
      },
    });

    // 配置没就绪（加载中 / 失败）时整页只读，避免在占位值上编辑再保存回去。
    const { loadState, retry } = useConfigLoad(rt, applyConfig);
    const busy = saving || loadState !== 'ready' || fish.busy;

    // 音效索引：配置就绪后拉一次，卡片据此显示每个槽位实际用的文件与来源。
    const loadSfx = sfx.load;
    useEffect(() => {
      if (loadState === 'ready') loadSfx();
    }, [loadState, loadSfx]);

    // 说明气泡：挂 body 摆位（伪元素会被窗口边缘与滚动容器裁掉），随页面卸载一起拆。
    useEffect(() => attachTipLayer(), []);

    // 此刻的表单快照：形状与基线一致，diff 之后才知道哪些字段还没保存。
    const snapshot = makeSnapshot({ list, global, hotkeys, sfx, voice, model, look, fish });
    snapshotRef.current = snapshot;

    const paths = baseline === null ? NO_PATHS : diffSnapshot(baseline, snapshot);
    const dirty = makeDirtyQuery(paths);
    const tabsDirty = dirtyTabs(paths);

    /** 保存成功：把基线推进到此刻这份表单（主配置或整包）。 */
    const markSaved = useCallback((scope: 'main' | 'all'): void => {
      const now = snapshotRef.current;
      if (now === null) return;
      // 主配置那一半取「此刻的表单」；会话鱼那一半永远取它的权威值——`fish.save` 已经用宿主回包
      // 更新过基线，这里再拿保存前的快照盖回去，会让刚保存完的那一页又亮起点。
      setBaseline((current) => ({
        ...current,
        ...withoutFish(now),
        ...(scope === 'all' ? { fish: fishBaselineRef.current } : {}),
      }));
    }, []);

    // 写路径在 settings/config/write-flow.ts：保存、保存全部与重置都走同一条校验与落盘。
    // 传的是回调而不是值——save 每次渲染重建，捕获状态会拿旧值存盘。
    // 请求体由 save-fields.ts 摊平：每个分区贡献自己那几项，键名与成品配置字段同名。
    const write = createWriteFlow({
      fields: () =>
        buildSaveFields({
          pets: list.mainPets,
          global: global.values,
          hotkeys: hotkeys.values,
          sfxVolume: global.sfxVolume,
          sfx: sfx.config,
          chat: model.chatFlags,
          voice,
          model,
          look,
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
      // 会话鱼草稿没读到时跳过这一块：别拿默认值把用户的文件盖掉。
      saveFish: () => (fish.draft === null ? Promise.resolve(true) : fish.save()),
      resetFish: fish.reset,
      onSaved: markSaved,
      onRestore: backup.confirm,
    });

    // 撤销：重新读配置与会话鱼，成功 / 失败由 loadState 落地。
    const { revert } = useRevert(rt, { loadState, retry, reloadFish: fish.reload, report: setMsg });

    // Ctrl+S = 应用（保存但不关闭）。
    useSaveHotkey(rt, rootRef, () => void write.saveAll());

    /** 切分区：本地状态立刻生效，同时记一笔「上次看到哪」（记不住也不影响切换）。 */
    const selectTab = (id: SettingsTabId): void => {
      setTab(id);
      saveTab(tabStorage, id);
    };

    /** 确定：保存成功才关闭；失败时留在原地看红字。 */
    const confirm = (): void => {
      void write.saveAll().then((ok) => {
        if (ok) close?.();
      });
    };

    /** 重启：先保存（失败就不重启），再让宿主重新组合本插件。 */
    const restart = (): void => {
      void write.saveAll().then(async (ok) => {
        if (!ok) return;
        setMsg({ kind: '', text: t('restarting') });
        const mode = await requestPluginRestart();
        if (mode === null) {
          setMsg({ kind: 'err', text: t('restartFailed') });
          return;
        }
        if (mode === 'hmr') {
          setMsg({ kind: 'ok', text: t('restartHmr') });
          schedulePageReload();
          return;
        }
        setMsg({ kind: 'ok', text: t('restartHelper') });
      });
    };

    const deps: SettingsPanelDeps = {
      busy,
      list,
      // 预览与聊天面板同一个地址：内置回默认 logo，所以无需区分「有没有头像」。
      avatar: { src: avatarUrl(current?.assetRoot ?? '', avatar.version), busy: avatar.busy, onPick: avatar.upload },
      remote,
      global,
      hotkeys,
      sfx,
      voice,
      model,
      look,
      fish,
      perm: { msg: permission.message, test: permission.test },
      backup,
      maintenance: { restart, reset: write.requestReset },
      dirty,
    };
    const panels = panelsOf(deps);

    // 搜索要能命中还没打开的分区，所以它的索引层会用同一个 `panels` 把六个分区各渲染一次
    // （`display:none`，读完成条目立刻卸掉）。选中结果后由 `pickResult` 切分区并高亮。
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [flash, setFlash] = useState<{ query: string; seq: number } | null>(null);
    const pickResult = useCallback((id: SettingsTabId, query: string): void => {
      selectTab(id);
      // 同一个词连点两次也要重新闪一下：靠 seq 让 effect 每次都跑
      setFlash((current) => ({ query, seq: (current?.seq ?? 0) + 1 }));
    }, []);
    const search = useSettingsSearch(rt, {
      tabs: SETTINGS_TABS.map((def) => ({ id: def.id, label: t(def.titleKey) })),
      renderPanel: (id) => panels[id](),
      onPick: pickResult,
    });

    // 切完分区再高亮：面板在这一次提交里已经是新分区，滚到第一处命中
    useEffect(() => {
      const run = (): void => {
        const root = panelRef.current;
        if (root === null || flash === null) return;
        highlightMatches(root, flash.query);
      };
      run();
    }, [flash]);

    return h('section', {
      ref: rootRef,
      className: 'dsh-pet-cfg',
      // 页头标题已删（与左侧导航重复）：给整块补一个可读名，屏幕阅读器仍有上下文。
      'aria-label': t('nav'),
      style: { maxWidth: '720px' },
      children: [
        // 搜索框固定在分区标签条上方：搜的是「六个分区里的所有项」，所以不属于任何一页。
        search.box,

        // 页头只剩分区标签条：分区名已经在设置页的左侧导航里，再写一遍标题只是重复。
        h(TabBar, { active: tab, onSelect: selectTab, dirty: tabsDirty }),

        h(LoadStatus, { loadState, onRetry: retry }),

        // 搜索态用结果列表替掉面板（面板仍保留在页面上会跟结果抢滚动位置）。
        search.active
          ? search.results
          : h('div', {
              key: tab,
              ref: panelRef,
              role: 'tabpanel',
              id: tabPanelId(tab),
              'aria-labelledby': tabButtonId(tab),
              className: 'dsh-pet-cfg__panel',
              children: panels[tab](),
            }),

        // 建索引那一帧才存在的隐藏容器；读完成条目立刻卸掉。
        search.indexLayer,

        // 底部栏：不属于任何分区，任何一页都在同一位置。
        h(Bar, {
          busy,
          msg,
          dirtyCount: paths.size,
          onRevert: revert,
          onCancel: () => close?.(),
          onApply: () => void write.saveAll(),
          onConfirm: confirm,
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
