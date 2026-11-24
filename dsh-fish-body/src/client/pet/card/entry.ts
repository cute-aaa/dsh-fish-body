/**
 * 右键菜单、对话弹窗与悬浮提示的入口：三样都是贴在宠物上的浮层，共享同一套关闭与定位时机。
 * 不负责动作本身：菜单叶子交给 menu-actions 派发，对话内容由 shared/chat 与宿主 /chat 处理。
 * 浮层句柄只在本模块持有，卸载时统一关闭；提示位置直接写 style，不走 React 状态。
 * @module dsh-fish-body/src/client/pet/card/entry
 */
import {
  createHearHold,
  isCaptureHotkey,
  mountChatDialog,
  type ChatDialogMount,
  type EncodedImage,
} from '../../../shared/chat/index.ts';
import { captureDisplayFrame } from '../../../shared/chat/capture.ts';
import { displayOfHotkey } from '../../../shared/display-hotkey.ts';
import { hotkeyHint, type HotkeyMap } from '../../../shared/hotkeys.ts';
import { isSleepHotkey } from '../../../shared/sleep-hotkey.ts';
import { isTodoHotkey } from '../../../shared/todo/hotkey.ts';
import type { PetDisplay, PoolEntryItem, RendererKind } from '../../../shared/types.ts';
import { bindOpenChat } from './open-chat.ts';
import { playPetHook } from '../sfx.ts';
import { registerPetChatHandle } from './registry.ts';
import {
  accessoryMenuBranch,
  actionMenuTree,
  buildMemeBranch,
  buildMoreBranch,
  displayMenuBranch,
  memeThumbUrl,
  modelMenuBranch,
  mountContextMenu,
  rendererMenuBranch,
  sizeMenuBranch,
  skinMenuBranch,
  voiceMenuBranch,
  type MenuNode,
} from '../../../shared/menu.ts';
import { readVoiceProviders, type VoiceProviderView } from '../../../shared/voice-providers.ts';
import { ROUTE_PATH } from '../../../shared/constants.ts';
import { layeredManifestPaths } from '../../../shared/layered-paths.ts';
import { availableRenderers } from '../../../shared/renderer-availability.ts';
import { renderSizeOf } from '../../../shared/pet-size.ts';
import { TOOLTIP_GAP_RATIO, tooltipPlacement } from '../../../shared/tooltip.ts';
import type { MenuMoreItem } from '../../../shared/menu.ts';
import type { CardLive } from './live.ts';
import type { CardMotion } from './motion.ts';
import type { CardStateApi } from './state.ts';
import type { Drag } from '../motion/drag.ts';
import type { MenuActions } from '../menu-actions.ts';
import type { RuntimePet } from '../types.ts';
import type * as ReactNS from 'react';

/**
 * 读清单接口的 `items`（来源标注）：宿主给了就用，老版本宿主没有这一段时回退成空数组。
 *
 * @param raw - 响应体里的 `items` 原值。
 * @returns 合法的 `{id, source}` 列表。
 */
function readEntryItems(raw: unknown): PoolEntryItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PoolEntryItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as { id?: unknown; source?: unknown };
    if (typeof entry.id !== 'string') continue;
    if (entry.source !== 'pack' && entry.source !== 'pool') continue;
    out.push({ id: entry.id, source: entry.source });
  }
  return out;
}

/** 注入的 react 能力。 */
export interface CardEntryRuntime {
  /** 副作用；卸载时关闭浮层。 */
  useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
  /** 引用；浮层句柄与提示节点。 */
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
}

/** 浮层入口的输入。 */
export interface CardEntryInput {
  /** 卡状态：提示显隐与写入口。 */
  card: CardStateApi;
  /** 成品配置的最新值。 */
  cfgRef: ReactNS.MutableRefObject<RuntimePet>;
  /** 装配根迟绑槽。 */
  live: ReactNS.MutableRefObject<CardLive>;
  /** 运动面：开菜单前要停飞与停走。 */
  motion: CardMotion;
  /** 拖拽驱动：拖拽中或刚拖完不弹菜单。 */
  drag: Drag;
  /** 第三方菜单项快照；只在右键那一刻读。 */
  menuItemsRef: ReactNS.MutableRefObject<MenuMoreItem[]>;
  /** 菜单动作派发。 */
  runMenuAction: MenuActions['run'];
  /** 打开待办面板：面板占气泡槽，显隐归气泡单槽管。 */
  showTodo: () => void;
  /** 开关待办面板：D 键用，已开则收起。 */
  toggleTodo: () => void;
  /** 悬浮提示节点：位置由本模块直接写 style。 */
  tipRef: ReactNS.MutableRefObject<HTMLDivElement | null>;
  /** 舞台节点：对话弹窗贴命中区右上角。 */
  stage: () => HTMLDivElement | null;
}

/** 浮层入口对外的读写面。 */
export interface CardEntry {
  /** 把提示框摆到光标右下，放不下时翻边并夹回视口。 */
  placeTip: (clientX: number, clientY: number) => void;
  /** 打开右键菜单。 */
  handleContextMenu: (e: ReactNS.MouseEvent<HTMLDivElement>) => void;
  /** 打开对话弹窗：菜单里「对话」那一项走这里；带图时直接进入待发送状态（拖拽用）。 */
  openChat: (image?: File) => void;
  /** 打开待办面板（右键菜单入口）。 */
  openTodo: () => void;
  /** 指针进入：先摆位再显示。 */
  onPointerEnter: (e: ReactNS.PointerEvent<HTMLDivElement>) => void;
  /** 指针离开：收起提示。 */
  onPointerLeave: () => void;
  /** 音色切成功后更新本地快照：下次开菜单时勾在新音色上（不重拉、不重挂）。 */
  applyProviderVoice: (provider: string, voice: string) => void;
}

/**
 * 造浮层入口的 hook。
 *
 * @param rt - 注入的 react 能力。
 * @returns 接收装配输入的 hook，返回菜单、对话与提示的入口。
 */
export function createCardEntry(rt: CardEntryRuntime) {
  const { useEffect, useRef } = rt;

  return function useCardEntry(input: CardEntryInput): CardEntry {
    const { card, cfgRef, drag, live, menuItemsRef, motion, runMenuAction, showTodo, stage, tipRef, toggleTodo } =
      input;
    // 右键菜单与对话弹窗当前的句柄，卸载或重开前清理。对话弹窗还要按住说话遥控开录/收尾。
    const menuRef = useRef<{ close: () => void } | null>(null);
    const chatRef = useRef<ChatDialogMount | null>(null);
    // live2d/layered 的可用模型清单（相对皮肤目录路径）：右键「模型」子菜单用它，挂载时拉一次。
    const modelsRef = useRef<string[]>([]);
    // layered 可切换的皮肤 id（根布局为空串）：右键「皮肤」子菜单用它，同样挂载时拉一次。
    const skinsRef = useRef<string[]>([]);
    // 上面两份清单的来源（pack / pool）：菜单里给池资源标「（池）」，与清单一起拉。
    const skinItemsRef = useRef<PoolEntryItem[]>([]);
    const modelItemsRef = useRef<PoolEntryItem[]>([]);
    // 这只宠物实际有素材的后端：右键「渲染方式」子菜单拿它把缺素材的项置灰，挂载时探一次。
    const availableRef = useRef<readonly RendererKind[]>(['webm']);
    // 第三方语音实现的可切音色快照（/voice/voices 的 providers 段）：右键「音色」用它，挂载时拉一次。
    const providersRef = useRef<VoiceProviderView[]>([]);

    // 素材探测：layered 看当前皮肤的清单能否取到（候选顺序与渲染器加载同一份，见 shared/layered-paths），
    // live2d 看模型清单是否非空（`/models` 空数组也算没有）；webm 恒可用——动画池来自配置，
    // 缺素材是配置问题而不是后端问题。判据本身在 shared/renderer-availability，桌面端读同一份。
    // 探测失败按「没有」处理：给一个点下去黑屏的选项，比少一个灰项更糟。
    useEffect(() => {
      const cfg = cfgRef.current;
      const dir = ROUTE_PATH + '/skin/' + encodeURIComponent(cfg.assetRoot ?? cfg.id);
      let alive = true;
      const probeSkin = Promise.all(
        layeredManifestPaths(cfg.model).map((path) =>
          fetch(dir + '/' + path)
            .then((r) => r.ok)
            .catch(() => false),
        ),
      ).then((hits) => hits.some(Boolean));
      const probeModels = fetch(dir + '/models')
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { models?: unknown; items?: unknown; core?: unknown } | null) => ({
          items: readEntryItems(b?.items),
          models: b && Array.isArray(b.models) ? b.models.filter((m): m is string => typeof m === 'string') : [],
          // Cubism Core 不在包内：宿主把「找没找到」一并给出，缺了就不该让 live2d 可点。
          core: typeof b?.core === 'boolean' ? b.core : undefined,
        }))
        .catch(() => ({ items: [] as PoolEntryItem[], models: [] as string[], core: undefined }));
      const probeSkins = fetch(dir + '/skins')
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { skins?: unknown; items?: unknown } | null) => ({
          items: readEntryItems(b?.items),
          skins: b && Array.isArray(b.skins) ? b.skins.filter((s): s is string => typeof s === 'string') : [],
        }))
        .catch(() => ({ items: [] as PoolEntryItem[], skins: [] as string[] }));
      void Promise.all([probeSkin, probeModels, probeSkins]).then(([hasSkin, models, skins]) => {
        if (!alive) return;
        modelsRef.current = [...models.models];
        modelItemsRef.current = [...models.items];
        skinsRef.current = [...skins.skins];
        skinItemsRef.current = [...skins.items];
        availableRef.current = availableRenderers({
          manifestHit: hasSkin,
          models: models.models,
          skins: skins.skins,
          core: models.core,
        });
      });
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- 探测只随素材根变化：换后端不改这只有什么素材
    }, [cfgRef.current.assetRoot]);

    // 音色清单：与素材探测分开（它跟素材根无关，换皮肤不影响嗓子）。拉不到就空——那时右键不出现「音色」。
    useEffect(() => {
      let alive = true;
      void fetch(ROUTE_PATH + '/voice/voices')
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { providers?: unknown } | null) => {
          if (!alive || !body) return;
          providersRef.current = readVoiceProviders(body.providers);
        })
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, []);

    /** 把提示框摆到光标右下，放不下时翻边并夹回视口。
     *  直接写 DOM style：每次鼠标移动都走 React 状态会让整个 PetCard 重渲染。
     */
    const placeTip = (clientX: number, clientY: number): void => {
      const tipEl = tipRef.current;
      if (!tipEl) return;
      const viewport = document.documentElement;
      const p = tooltipPlacement(
        { x: clientX, y: clientY },
        { w: tipEl.offsetWidth, h: tipEl.offsetHeight },
        { x: 0, y: 0, w: viewport.clientWidth, h: viewport.clientHeight },
        motion.metrics().size * TOOLTIP_GAP_RATIO,
      );
      tipEl.style.left = p.x + 'px';
      tipEl.style.top = p.y + 'px';
    };

    // 卸载时关闭可能开着的右键菜单与对话弹窗。
    useEffect(
      () => () => {
        if (menuRef.current) {
          menuRef.current.close();
          menuRef.current = null;
        }
        if (chatRef.current) {
          chatRef.current.close();
          chatRef.current = null;
        }
      },
      [],
    );

    /** 挂载对话弹窗：弹窗贴在身体命中区右上角，视频框右上角不等于宠物右上角；超出视口夹回。 */
    const mountChat = (seed: { image?: File; encoded?: EncodedImage }): void => {
      if (chatRef.current) chatRef.current.close();
      const hitRect = stage()?.querySelector('.dsh-pet-hit')?.getBoundingClientRect();
      chatRef.current = mountChatDialog({
        petId: cfgRef.current.id,
        baseUrl: ROUTE_PATH + '/chat',
        surface: 'web',
        x: hitRect ? hitRect.right + 6 : window.innerWidth - 256,
        y: hitRect ? hitRect.top + 6 : 8,
        ...(seed.image ? { initialImage: seed.image } : {}),
        ...(seed.encoded ? { initialEncoded: seed.encoded } : {}),
        // 浏览器侧截屏：getDisplayMedia 抓一帧，系统选择器由用户确认
        capture: captureDisplayFrame,
        onSent: () => {
          // 发送成功：回复已写进 /state，长轮询会立刻返回并弹气泡。
          console.info('[fish-body] 对话已发送 pet=' + cfgRef.current.id);
        },
        onClose: () => {
          chatRef.current = null;
        },
      });
    };

    /** 打开对话（菜单、悬停 L、拖拽都走这条）；带图时直接进入待发送状态。 */
    const openChat = (image?: File): void => {
      // 内置 hook 点：hook-chat-open.wav 在每次开窗时响一下；已经开着就不重复触发。
      if (chatRef.current === null) playPetHook(cfgRef.current, 'chat-open', live.current.ownAnim?.sfxLayer?.());
      mountChat(image ? { image } : {});
    };

    /** 把一张图送进对话：已开着就塞进去（不丢写了一半的字），没开就带图打开。 */
    const openChatWithImage = (file: File): void => {
      const existing = chatRef.current;
      if (existing !== null) {
        void existing.setImageFile(file);
        return;
      }
      openChat(file);
    };

    /** 打开待办面板：面板占气泡槽，重复点击是幂等的。 */
    const openTodo = (): void => showTodo();

    /** 「按住说话」按下：弹窗没开就先开一个，再让它开录；已开着就直接在它上面开录。 */
    const startChatHear = (): void => {
      if (!chatRef.current) openChat();
      chatRef.current?.startHear();
    };
    /** 「按住说话」松开：只收尾，不关弹窗——识别结果要落进输入框让人看一眼。 */
    const stopChatHear = (): void => {
      chatRef.current?.stopHear();
    };
    /** 打开对话：已经开着就只把焦点交回输入框，重开会把打了一半的字丢掉。 */
    const openChatOrFocus = (): void => {
      const existing = chatRef.current;
      if (existing === null) {
        openChat();
        return;
      }
      existing.el.querySelector<HTMLTextAreaElement>('.dsh-pet-chat-input')?.focus();
    };

    /** 截一帧塞进对话；截不到时照样开弹窗，把原因写在弹窗里——静默失败会被当成快捷键坏了。 */
    const captureInto = async (): Promise<void> => {
      let encoded: EncodedImage;
      try {
        encoded = await captureDisplayFrame();
      } catch (error) {
        const reason = '截屏失败：' + (error instanceof Error ? error.message : String(error));
        const opened = chatRef.current;
        if (opened !== null) {
          opened.flash(reason);
          return;
        }
        mountChat({});
        chatRef.current?.flash(reason);
        return;
      }
      const existing = chatRef.current;
      if (existing !== null) {
        existing.setEncoded(encoded);
        return;
      }
      mountChat({ encoded });
    };

    /** 截图动作的对外形状；异步收在里面，调用方不关心。 */
    const screenshot = (): void => {
      void captureInto();
    };

    // 悬停标记：快捷键与拖拽都只在"鼠标停在这只宠物上"时生效，避免和页面其它交互抢事件。
    const hoverRef = useRef(false);
    // 挂载时注册一次监听，但始终调用最新的 openChat 闭包（它读 ref，不能捕获旧值）。
    const openChatRef = useRef<(image?: File) => void>(openChat);
    openChatRef.current = openChat;
    // stage 是 getter（首次渲染时节点还不存在），effect 里再取一次，并用 ref 避开依赖告警。
    const stageGetterRef = useRef(stage);
    stageGetterRef.current = stage;
    // 待办开关同样只在悬停时生效；存 ref 是因为它每次渲染都新建，闭包会捕获旧的那份。
    const toggleTodoRef = useRef(toggleTodo);
    toggleTodoRef.current = toggleTodo;
    // 睡觉同样是切换语义：按下的那一刻现读状态，决定发 /sleep 还是 /wake（与菜单那一项同一件事）。
    const toggleSleepRef = useRef<() => void>(() => {});
    toggleSleepRef.current = () => {
      const asleep = live.current.flow?.sleeping() ?? false;
      runMenuAction(asleep ? { label: '起来', action: 'wake' } : { label: '睡觉', action: 'sleep' });
    };
    // 数字键切显示位置：与右键「显示位置」子菜单同一条动作派发（写 display 配置，宿主重启生效）。
    const switchDisplayRef = useRef<(display: PetDisplay) => void>(() => {});
    switchDisplayRef.current = (display) => {
      runMenuAction({ label: '显示位置', action: 'set-display', display });
    };
    // 按住说话的按下/松开同样每次渲染都新建闭包；状态机只建一次，只能经 ref 取最新的那两个。
    const startChatHearRef = useRef<() => void>(startChatHear);
    startChatHearRef.current = startChatHear;
    const stopChatHearRef = useRef<() => void>(stopChatHear);
    stopChatHearRef.current = stopChatHear;
    const openChatOrFocusRef = useRef<() => void>(openChatOrFocus);
    openChatOrFocusRef.current = openChatOrFocus;
    const openChatWithImageRef = useRef<(file: File) => void>(openChatWithImage);
    openChatWithImageRef.current = openChatWithImage;
    const screenshotRef = useRef<() => void>(screenshot);
    screenshotRef.current = screenshot;
    // 全局快捷键要能遥控这一只：登记开关窗、开关录音，卸载时摘掉。
    // 句柄里全走 ref，卡片重渲染不会让登记表拿到过期闭包；cfgRef 本身也是稳定引用，列进依赖只为满足规则。
    useEffect(
      () =>
        registerPetChatHandle(cfgRef.current.id, {
          open: () => openChatOrFocusRef.current(),
          // close 走弹窗自己的 onClose，句柄随之置空，isOpen 立刻转假。
          close: () => chatRef.current?.close(),
          isOpen: () => chatRef.current !== null,
          startHear: () => startChatHearRef.current(),
          stopHear: () => stopChatHearRef.current(),
          isHearing: () => chatRef.current?.isHearing() ?? false,
          screenshot: () => screenshotRef.current(),
        }),
      [cfgRef],
    );
    // 悬停键共用一次挂载：对话 / 按住说话 / 截图 / 睡醒 / 待办 / 四个显示位置。
    // 具体是哪个键来自 `hotkeys` 配置（设置页「快捷键」卡可改绑），每次按键现读 cfgRef，
    // 因此保存后立刻按新键生效，不必重建监听。
    // 全部只在鼠标停在这只宠物上时生效；按住说话另有一条——焦点在宠物自己的弹窗里也算，
    // 但在弹窗输入框里打字时不算（否则拼音里的 m 会被当成开录，见 createHearHold）。
    useEffect(() => {
      /** 现读当前键位表；cfgRef 是稳定引用，这里读到的永远是最新那份配置。 */
      const keys = (): HotkeyMap | undefined => cfgRef.current.hotkeys;
      // 挂载时注册一次监听，但始终调用最新的闭包（它们读 ref，不能捕获旧值）。
      const offChat = bindOpenChat({
        stage: stageGetterRef.current(),
        isHovered: () => hoverRef.current,
        keys,
        openChat: (image) => (image === undefined ? openChatRef.current() : openChatWithImageRef.current(image)),
      });
      // 按住说话：按下开录、松手收尾。状态机自己管自动重复与松开，这里只管把事件送进去。
      const hearHold = createHearHold({
        isArmed: () => {
          if (hoverRef.current) return true;
          const chat = chatRef.current;
          const active = document.activeElement;
          return !!chat && !!active && chat.el.contains(active);
        },
        keys,
        onPress: () => startChatHearRef.current(),
        onRelease: () => stopChatHearRef.current(),
      });
      const onKeyDown = (e: KeyboardEvent): void => {
        if (hearHold.onKeyDown(e)) {
          e.preventDefault();
          return;
        }
        if (!hoverRef.current) return;
        const display = displayOfHotkey(e, keys());
        if (display !== undefined) {
          e.preventDefault();
          switchDisplayRef.current(display);
          return;
        }
        if (isCaptureHotkey(e, keys())) {
          e.preventDefault();
          screenshotRef.current();
          return;
        }
        if (isSleepHotkey(e, keys())) {
          e.preventDefault();
          toggleSleepRef.current();
          return;
        }
        if (!isTodoHotkey(e, keys())) return;
        e.preventDefault();
        toggleTodoRef.current();
      };
      const onKeyUp = (e: KeyboardEvent): void => hearHold.onKeyUp(e);
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('keyup', onKeyUp, true);
      return () => {
        offChat();
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('keyup', onKeyUp, true);
      };
      // cfgRef 是稳定引用（ref 对象本身不变），列进依赖只为满足规则；监听仍然只注册一次。
    }, [cfgRef]);
    // 菜单的动作面里含「对话」一条，回调注册一次即可：弹窗句柄在闭包里。
    live.current.placeTip = placeTip;
    live.current.tipOn = () => card.state.tipOn;

    /** 打开右键菜单。 */
    const handleContextMenu = (e: ReactNS.MouseEvent<HTMLDivElement>): void => {
      // 工具项与动作树；「查看余额」无条件显示，手动请求不受开关限制。
      // 第三方菜单项统一收在「更多」下：label 唯一的平铺，重名的按 owner 分子菜单（见 buildMoreBranch）。
      const more = buildMoreBranch(menuItemsRef.current);
      // 「配图」：按配置里的清单分成「纳入对话的配图 / 其他」，点一张就用它说一句。
      // 没有可用图时返回 null，整项不出现（不占一个点开是空的菜单）。
      // 缩略图靠 /pic/memes/<素材根>/<名称>.png：素材根就是拍平时写入的条目 key。
      const pic = cfgRef.current;
      const memes = buildMemeBranch(pic, (name) => memeThumbUrl(ROUTE_PATH, pic.assetRoot, name));
      // 睡觉/起来是同一个入口的两种文案：睡着时点它等于叫醒（与「点击宠物」同义）。
      // 该条目没配 animations.sleep 就整项不出现——与配置注释「不写 = 没有睡觉功能」一致。
      const asleep = live.current.flow?.sleeping() ?? false;
      const canSleep = (cfgRef.current.animations.sleep ?? []).length > 0;
      // 键帽一律现读配置：改绑之后菜单右侧的灰字立刻跟着变。
      const keys = cfgRef.current.hotkeys;
      const sleepHint = hotkeyHint(keys, 'sleep');
      const sleepItem: MenuNode = asleep
        ? { label: '起来', action: 'wake', hint: sleepHint }
        : { label: '睡觉', action: 'sleep', hint: sleepHint };
      // 模型/皮肤子菜单：与渲染方式配套——live2d 列 `.model3.json`，layered 列可切换的皮肤 id。
      // 两者都写同一个 `pets[].model` 字段，只是文案不同（「模型」vs「皮肤」）。
      const rendererNow = cfgRef.current.renderer ?? 'webm';
      const picker =
        rendererNow === 'layered'
          ? skinMenuBranch(skinsRef.current, cfgRef.current.model, skinItemsRef.current)
          : rendererNow === 'live2d'
            ? modelMenuBranch(modelsRef.current, cfgRef.current.model, modelItemsRef.current)
            : null;
      // 外观：live2d 的 Expressions（单片眼镜、尾巴开关…），可同时挂多个，打勾表示当前挂着它；
      // 复位项文案优先用 VTS 的 RemoveAllExpressions 热键名（没有就回落到内置的「恢复默认外观」）。
      const accessory = accessoryMenuBranch(
        live.current.ownAnim?.listExpressions?.() ?? [],
        live.current.ownAnim?.activeExpressions?.() ?? [],
        live.current.ownAnim?.expressionResetLabel?.(),
      );
      // 大小：改当前渲染方式的画框宽度（写 pets[].sizes[renderer]），另一套素材的尺寸不受影响。
      const sizeBranch = sizeMenuBranch(renderSizeOf(cfgRef.current), cfgRef.current.size);
      // 音色：第三方实现（GSV）的嗓子清单；没有可切音色时整项不出现。
      const voiceBranch = voiceMenuBranch(providersRef.current);
      // 顺序与桌面端同一排法：余额 / 待办 / 碎碎念 / 对话 / 配图 / 睡觉 → 动作树 → 显示位置 / 回到初始位置。
      // 桌面专属的两项（打开软件、重载配置）在网页端没有对应动作，不出现。
      const tools: MenuNode[] = [
        { label: '查看余额', action: 'show-balance' },
        { label: '待办事项', action: 'todo', hint: hotkeyHint(keys, 'todo') },
        { label: '碎碎念', action: 'whisper' },
        { label: '对话', action: 'chat', hint: hotkeyHint(keys, 'chat') },
        ...(memes ? [memes] : []),
        ...(canSleep ? [sleepItem] : []),
        // 渲染方式：三种后端互斥，切完由宿主回成品聚合 → 容器重渲染 → stage 即时重建。
        // 缺素材的后端置灰（可用态由挂载时的探测给出），避免点一下就剩个空画布。
        rendererMenuBranch(cfgRef.current.renderer, availableRef.current),
        // 模型（live2d）/ 皮肤（layered）：切完同样回成品聚合重建。
        ...(picker !== null ? [picker] : []),
        // 大小：三种渲染方式各自一套，切完由宿主回成品聚合 → 卡片按新尺寸重排/重绘。
        sizeBranch,
        // 音色：嗓子（声音）与模型/皮肤（画面）分开，切完不重建 stage，下一句合成即生效。
        ...(voiceBranch !== null ? [voiceBranch] : []),
        // 外观（live2d）：表情是挂着的状态，切换后一直生效，另给「恢复默认外观」。
        ...(accessory !== null && rendererNow === 'live2d' ? [accessory] : []),
      ];
      const tail: MenuNode[] = [
        // 显示位置子菜单与桌面端同一份；改成不含 web 的值后本宠物会从页面消失。
        displayMenuBranch(keys),
        // 重启插件：宿主重新组合本插件（有 HMR 时连新构建的宿主代码一起换上），页面随后自动刷新。
        { label: '重启插件', action: 'reload-plugin' },
        { label: '回到初始位置', action: 'home' },
      ];
      const tree: MenuNode[] = [
        ...tools,
        // 动作树随渲染方式不同：webm 用动画池，layered 用皮肤清单的 interaction.menu，
        // live2d 用模型声明的 Motions / Expressions（没有声明就不出现「动作」，只留渲染方式与模型）。
        ...actionMenuTree(
          cfgRef.current.renderer,
          cfgRef.current.animations,
          live.current.ownAnim?.listActionGroups?.() ?? [],
        ),
        ...tail,
        ...(more ? [more] : []),
      ];
      if (!tree.length) return;
      e.preventDefault();
      e.stopPropagation(); // 不触碰 DSH 页面的菜单与右键处理。
      if (drag.isActive() || drag.justDragged()) return;
      motion.flight.stop(); // 菜单弹出前停住飞行中的宠物。
      motion.stopMove(); // 菜单悬停期间宠物不漫游。
      if (menuRef.current) menuRef.current.close();
      menuRef.current = mountContextMenu({
        tree,
        x: e.clientX,
        y: e.clientY,
        onAction: runMenuAction,
        // 菜单被点外或 Esc 关闭时置空句柄，避免残留引用。
        onClose: () => {
          if (menuRef.current) menuRef.current = null;
        },
      });
    };

    return {
      handleContextMenu,
      onPointerEnter: (e) => {
        hoverRef.current = true;
        placeTip(e.clientX, e.clientY); // 先摆位再显示，否则会先在兜底坐标闪一帧。
        card.actions.setTipOn(true);
      },
      onPointerLeave: () => {
        hoverRef.current = false;
        card.actions.setTipOn(false);
      },
      openChat,
      openTodo,
      placeTip,
      applyProviderVoice: (provider, voice) => {
        providersRef.current = providersRef.current.map((item) => (item.id === provider ? { ...item, voice } : item));
      },
    };
  };
}
