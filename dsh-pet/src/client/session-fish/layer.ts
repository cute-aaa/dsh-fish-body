/**
 * 会话鱼浮层：注册进 `shell.overlay`，把 `/state` 里的会话鱼快照画成围着桌宠转的小鱼群。
 *
 * 不产生状态、不写 `say` 叶子：档位与播报全部由宿主给出，这里只做「谁该显示、谁该念、
 * 点一下去哪、拖到哪里」。运动交给 `roam`（槽位 + 弹簧 + 碰撞），DOM 位置每帧由它直接写 transform，
 * 不走 React state —— 否则 60fps 的重渲染会把整棵树拖慢。
 *
 * 必须始终成立：
 * - 首拍只记播报基线，不补念历史；
 * - 播报只对「真正显示出来的那几条」发（超出 `maxCount` 的不出声），且先向宿主认领出声权
 *   （双标签页 / 网页 + 桌面只念一次）；
 * - 桌宠不在本页（`display` 不含 web）就不显示鱼、也不出声——鱼的显示面跟着桌宠走；
 * - 拖动超过阈值才吞掉随后的 click，小于阈值就是一次点击；
 * - 所有 hook 都在早退之前：快照没到时也要按同一顺序调用。
 * @module dsh-pet/src/client/session-fish/layer
 */
import type { Dispatch, DependencyList, EffectCallback, MutableRefObject, SetStateAction } from 'react';
import type { jsx } from 'react/jsx-runtime';
import {
  isSessionFishBubbleVisible,
  readSessionFish,
  selectSessionFishes,
  sessionFishSpeechOf,
  SESSION_FISH_SIZE_MAX,
  SESSION_FISH_SIZE_MIN,
  type SessionFishEntry,
  type SessionFishSnapshot,
} from '../../shared/session-fish.ts';
import { ROUTE_PATH } from '../../shared/constants.ts';
import { fetchState } from '../../shared/state.ts';
import { playSfx } from '../../shared/sfx/player.ts';
import { getActiveSession } from './active.ts';
import { injectSessionFishCss } from './css.ts';
import { claimFishLine, postSessionFishAction } from './api.ts';
import { makeSessionFishMedia, sessionFishAspectOf, sessionFishHeightOf } from './media.ts';
import { readOffsets, SESSION_FISH_POSITIONS_RESET_EVENT, writeFishOffset, type FishOffset } from './offsets.ts';
import { createRoam, resolveFishSlots, type FishBox, type Roam } from '../../shared/session-fish/roam.ts';
import { readPetAnchor } from './pet-anchor.ts';
import { webPetVisible } from './surface.ts';
import { enqueueFishLine, stopFishSpeech } from './speech.ts';
import { subscribePetBridge } from '../settings/bridge.ts';
import { runStatePoll } from '../pet/state-poll.ts';

/** 浮层用的 react 能力（只取用到的子集）。 */
export interface SessionFishRuntime {
  h: typeof jsx;
  useState: <T>(init: T | (() => T)) => [T, Dispatch<SetStateAction<T>>];
  useEffect: (effect: EffectCallback, deps?: DependencyList) => void;
  useRef: <T>(initial: T) => MutableRefObject<T>;
  t: (key: string) => string;
}

/** 会话列表的一行（只取本功能要的字段）。 */
export interface SessionRowLike {
  displayTitle?: string;
  blank?: boolean;
  running?: boolean;
}

/** `sessions.list` 的最小形状（可选能力：拿不到就退化成「没有标题、不做归档清理」）。 */
export interface SessionListLike {
  getSnapshot(): { phase?: string; ids?: readonly string[]; byId?: Record<string, SessionRowLike> };
  subscribe(listener: () => void): () => void;
}

/** 浮层依赖。 */
export interface SessionFishLayerDeps {
  /** 打开某个会话（`uiWorkspace.openSession`）；缺失时点鱼只做 ack。 */
  openSession?: (sessionId: string) => void;
  /** 客户端会话列表；用于标题与归档清理。 */
  sessions?: { list?: SessionListLike };
}

/** 一条鱼多久没更新后才参与归档清理（避免把刚建的会话误判为已归档）。 */
const PRUNE_MIN_AGE_MS = 10 * 60 * 1000;
/** 拖动判定阈值（px）：小于它算点击，避免手抖把「点开」变成「拖走」。 */
const DRAG_THRESHOLD_PX = 4;
/** 没有桌宠时，气泡翻到右侧的分界 x（px）。 */
const BUBBLE_FLIP_X_PX = 260;
/** 碰撞音：与桌宠碰撞音同一个素材，音量压低（鱼比桌宠轻）。 */
const FISH_BUMP_URL = ROUTE_PATH + '/sound/main/' + encodeURIComponent('bump-soft.wav');
/** 低于这个相对速度不出声：鱼群自己挤一挤不该一直响。 */
const BUMP_SOUND_MIN_SPEED = 220;
/** 碰撞音的最小间隔（ms）。 */
const BUMP_SOUND_GAP_MS = 320;

/** 视口尺寸。 */
interface Viewport {
  readonly w: number;
  readonly h: number;
}

/** 一次拖动的起点。 */
interface DragState {
  readonly sessionId: string;
  readonly startX: number;
  readonly startY: number;
  moved: boolean;
}

/** 安全读会话列表快照（报告器与浮层共用；服务缺失/抛错都返回 undefined）。 */
export function listSnapshot(sessions: SessionFishLayerDeps['sessions']) {
  try {
    return sessions?.list?.getSnapshot();
  } catch {
    return undefined;
  }
}

/** 夹取一个数值。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 视口是否要求减少动态效果。 */
function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** 把左上角写成 transform（唯一的位置写入口）。 */
function place(el: HTMLElement, x: number, y: number): void {
  el.style.transform = 'translate3d(' + Math.round(x) + 'px,' + Math.round(y) + 'px,0)';
}

/**
 * 造会话鱼浮层组件。
 *
 * @param rt - 注入的 react 能力与翻译。
 * @param deps - 打开会话与列表服务（都可缺失）。
 * @returns 可注册进 `shell.overlay` 的组件。
 */
export function makeSessionFishLayer(rt: SessionFishRuntime, deps: SessionFishLayerDeps) {
  const { h, useState, useEffect, useRef, t } = rt;
  const SessionFishMedia = makeSessionFishMedia({ h, useState });
  injectSessionFishCss();

  return function SessionFishLayer(): ReturnType<typeof jsx> | null {
    const [snapshot, setSnapshot] = useState<SessionFishSnapshot | null>(null);
    const [titles, setTitles] = useState<Record<string, string>>({});
    const [hiddenIds, setHiddenIds] = useState<readonly string[]>([]);
    // 气泡到点要收起：只用一个秒级 tick 驱动重渲染，不在每条鱼上挂定时器。
    const [nowTs, setNowTs] = useState(Date.now());
    const [viewport, setViewport] = useState<Viewport>(() =>
      typeof window === 'undefined' ? { w: 1280, h: 720 } : { w: window.innerWidth, h: window.innerHeight },
    );
    // 显示面 tick：桌宠的 display 变了就重渲染一次（鱼跟着桌宠出现/消失，不等下一次轮询）。
    const [, setSurfaceTick] = useState(0);
    // 拖拽后的偏移：先读本地，再在拖拽结束时更新；`offsetsRef` 给引擎实时读最新值。
    const [offsets, setOffsets] = useState<Record<string, FishOffset>>(readOffsets);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    // 皮肤量到真实尺寸后重排一次（第一帧按 16:9 排）。
    const [, setAspectTick] = useState(0);
    const offsetsRef = useRef<Record<string, FishOffset>>(offsets);
    const followPetRef = useRef(true);
    const viewportRef = useRef<Viewport>(viewport);
    const elementsRef = useRef(new Map<string, HTMLElement>());
    /** 每条鱼一个稳定的 ref 回调：身份不变，React 才不会每秒重挂 DOM（重挂会把引擎写的位置打回槽位）。 */
    const refCallbacksRef = useRef(new Map<string, (el: HTMLElement | null) => void>());
    const engineRef = useRef<Roam | null>(null);
    const dragRef = useRef<DragState | null>(null);
    const suppressClickUntilRef = useRef(0);
    const lastSeqRef = useRef<Record<string, number>>({});
    const seededRef = useRef(false);
    const prunedRef = useRef<Set<string>>(new Set());
    /** 上一拍本页是否在显示鱼：由「显示」翻到「不显示」时要把正在念的播报掐掉。 */
    const surfaceRef = useRef(true);

    // 引擎只造一次：视口、偏移、跟随开关都经 ref 现读，避免每次渲染重建（rAF 与拖拽状态在引擎里）。
    engineRef.current ??= createRoam({
      viewport: () => viewportRef.current,
      anchor: () => readPetAnchor(),
      offsets: () => offsetsRef.current,
      followPet: () => followPetRef.current,
      reducedMotion: () => prefersReducedMotion(),
    });

    // 会话标题：跟随列表快照更新；取不到就回落到「新会话」。
    useEffect(() => {
      const list = deps.sessions?.list;
      if (!list) return undefined;
      const read = (): void => {
        const snap = listSnapshot(deps.sessions);
        const next: Record<string, string> = {};
        for (const id of snap?.ids ?? []) {
          const title = snap?.byId?.[id]?.displayTitle;
          if (typeof title === 'string' && title.trim() !== '') next[id] = title.trim();
        }
        setTitles(next);
      };
      read();
      try {
        return list.subscribe(read);
      } catch {
        return undefined;
      }
    }, []);

    // 视口变化：引擎与槽位都按最新尺寸算（鱼会被夹回可视范围）。
    useEffect(() => {
      if (typeof window === 'undefined') return undefined;
      const onResize = (): void => {
        const next = { w: window.innerWidth, h: window.innerHeight };
        viewportRef.current = next;
        setViewport(next);
      };
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }, []);

    // 设置页「重置鱼的位置」：清本地并让当前渲染回到默认环位。
    useEffect(() => {
      if (typeof window === 'undefined') return undefined;
      const onReset = (): void => {
        const empty: Record<string, FishOffset> = {};
        offsetsRef.current = empty;
        engineRef.current?.reset();
        setOffsets(empty);
        setAspectTick((tick) => tick + 1);
      };
      window.addEventListener(SESSION_FISH_POSITIONS_RESET_EVENT, onReset);
      return () => window.removeEventListener(SESSION_FISH_POSITIONS_RESET_EVENT, onReset);
    }, []);

    // 卸载：停掉队列，别让已经离开页面的鱼还在念。
    useEffect(() => () => stopFishSpeech(), []);

    // 桌宠的显示方式变了（设置页改 display）：立刻重排；鱼要跟着桌宠消失时顺手掐掉播报。
    useEffect(() => {
      const onConfig = (): void => {
        const visible = webPetVisible();
        if (surfaceRef.current && !visible) stopFishSpeech();
        surfaceRef.current = visible;
        setSurfaceTick((tick) => tick + 1);
      };
      return subscribePetBridge(onConfig);
    }, []);

    /** 一拍快照 → 播报、渲染与清理。 */
    const applyState = (state: Parameters<Parameters<typeof runStatePoll>[0]['onState']>[0]): void => {
      const leaf = state.sections.sessionFish;
      if (!leaf || leaf.data === null) return;
      const snap = readSessionFish(leaf.data);
      if (!snap) return;
      followPetRef.current = snap.followPet;
      // 显示面：桌宠不在本页就不出声也不显示（鱼跟着桌宠走）。序号基线照常推进，
      // 这样重新显示时不会把中途攒下的旧播报补念一遍。
      const surfaceVisible = webPetVisible();
      if (surfaceRef.current && !surfaceVisible) stopFishSpeech();
      surfaceRef.current = surfaceVisible;
      // 播报只认「显示出来的那几条」：超出上限、用户根本看不见的鱼不该出声。
      const shown = selectSessionFishes(snap.fishes, snap.maxCount);
      const previous = lastSeqRef.current;
      if (!seededRef.current) {
        for (const fish of snap.fishes) previous[fish.sessionId] = fish.lineSeq;
        seededRef.current = true;
      } else {
        let latest: { readonly fish: SessionFishEntry; readonly line: string } | undefined;
        for (const fish of shown) {
          // 首拍已在上面 seed 过；之后新出现的鱼从 0 起算，它的第一条播报要念。
          const before = previous[fish.sessionId] ?? 0;
          // 插件重载后宿主序号会从头开始：只看不念，把基线拉回来。
          if (before > 0 && fish.lineSeq < before) {
            previous[fish.sessionId] = fish.lineSeq;
            continue;
          }
          const line = sessionFishSpeechOf(fish, before, snap);
          previous[fish.sessionId] = fish.lineSeq;
          if (!surfaceVisible) continue;
          if (line !== undefined && (latest === undefined || fish.lineAt > latest.fish.lineAt)) {
            latest = { fish, line };
          }
        }
        if (latest !== undefined) {
          // 先向宿主认领出声权：同一个 (会话, 序号) 全机器只念一次，双标签页/网页+桌面都算一次。
          // 认领失败（网络问题）按放行处理——宁可偶尔多念一次，也不能把播报静音。
          const target = latest;
          void claimFishLine(target.fish.sessionId, target.fish.lineSeq).then((granted) => {
            if (!granted) return;
            // 交给队列：多鱼同一刻收工时串行念、同句不重念（见 speech.ts）。
            enqueueFishLine({
              sessionId: target.fish.sessionId,
              text: target.line,
              kind: target.fish.lineKind,
              lineAt: target.fish.lineAt,
            });
          });
        }
      }
      setSnapshot(snap);
      setHiddenIds((ids) => ids.filter((id) => snap.fishes.some((fish) => fish.sessionId === id)));
      // 已归档/已删除的会话：只清理「本身也旧了」的鱼，刚建的会话可能还没进列表。
      const list = listSnapshot(deps.sessions);
      if (snap.enabled && list?.phase === 'ready' && Array.isArray(list.ids)) {
        const known = new Set(list.ids);
        const active = getActiveSession();
        for (const fish of snap.fishes) {
          if (known.has(fish.sessionId) || fish.sessionId === active) continue;
          if (prunedRef.current.has(fish.sessionId)) continue;
          if (Date.now() - fish.updatedAt < PRUNE_MIN_AGE_MS) continue;
          prunedRef.current.add(fish.sessionId);
          void postSessionFishAction({ action: 'close', sessionId: fish.sessionId });
        }
      }
    };

    // 唯一数据源：/state 的长轮询。首拍只记播报序号，不补念。
    useEffect(() => {
      let alive = true;
      void runStatePoll({
        fetch: (options) => fetchState(undefined, options),
        waitMs: 10_000,
        fallbackMs: 1_000,
        isAlive: () => alive,
        onState: (state) => {
          try {
            applyState(state);
          } catch (error) {
            // 浮层是旁路：一拍解析失败不能让轮询循环挂掉（下一拍还会来）。
            console.warn('[dsh-pet] 会话鱼快照处理失败：', error);
          }
        },
      });
      return () => {
        alive = false;
      };
    }, []);

    // 只要还有「未完成且气泡还没到点」的鱼，就每秒推进一次 nowTs。
    useEffect(() => {
      if (!snapshot?.enabled) return undefined;
      const now = Date.now();
      const hasLiveBubble = snapshot.fishes.some(
        (fish) => !fish.done && fish.line !== null && now - fish.lineAt < snapshot.bubbleMs,
      );
      if (!hasLiveBubble) return undefined;
      const timer = setInterval(() => setNowTs(Date.now()), 1_000);
      return () => clearInterval(timer);
    }, [snapshot]);

    // ===== 以下都是渲染期派生值（不含 hook），供渲染与两个运动相关的 effect 共用 =====
    const enabled = snapshot?.enabled === true && webPetVisible();
    const fishes = enabled
      ? selectSessionFishes(snapshot.fishes, snapshot.maxCount).filter((fish) => !hiddenIds.includes(fish.sessionId))
      : [];
    // 尺寸再夹一次：快照解析只保数字，宿主配错/手改文件也不该把鱼画成一面墙。
    const boxW = clamp(
      Math.round(snapshot?.sizePx ?? SESSION_FISH_SIZE_MIN),
      SESSION_FISH_SIZE_MIN,
      SESSION_FISH_SIZE_MAX,
    );
    const boxH = sessionFishHeightOf(boxW, sessionFishAspectOf(snapshot?.skin ?? ''));
    const boxes: FishBox[] = fishes.map((fish) => ({ id: fish.sessionId, w: boxW, h: boxH }));
    const followPet = snapshot?.followPet === true;
    followPetRef.current = followPet;
    viewportRef.current = viewport;
    offsetsRef.current = offsets;
    // 渲染期的槽位：给首帧一个正确的起点（引擎每帧写的是同一个函数算出的位置，所以接得上）。
    const initialSlots = resolveFishSlots({
      mode: followPet ? 'ring' : 'stack',
      anchor: followPet ? readPetAnchor() : null,
      viewport,
      fishes: boxes,
      offsets,
    });

    /** 每帧把引擎算出来的位置写到 DOM（只写 transform 与两个 class，不触发 React）。 */
    const paint = (): void => {
      const engine = engineRef.current;
      if (!engine) return;
      const anchor = readPetAnchor();
      const bodies = engine.bodies();
      const now = Date.now();
      for (const [id, el] of elementsRef.current) {
        const body = bodies.get(id);
        if (!body) continue;
        place(el, body.x, body.y);
        // 气泡永远朝背离桌宠的一侧：鱼在右边就翻到右边，免得盖住桌宠。
        const flipped = anchor !== null ? body.x + body.w / 2 > anchor.cx : body.x < BUBBLE_FLIP_X_PX;
        el.classList.toggle('is-flipped', flipped);
        el.classList.toggle('is-bumping', body.bumpUntil > now);
      }
      for (const impact of engine.takeImpacts()) {
        if (impact.speed < BUMP_SOUND_MIN_SPEED) continue;
        playSfx(FISH_BUMP_URL, { throttleMs: BUMP_SOUND_GAP_MS, throttleKey: 'session-fish-bump', volume: 0.45 });
      }
    };

    /** 同步鱼列表到引擎（新增的直接落位，删掉的丢掉），并立刻画一帧。 */
    const syncEngine = (): void => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.sync(boxes);
      paint();
    };

    // 鱼集合 / 尺寸变了才重同步引擎；同步后立刻画一帧，免得等到下一帧 rAF 才落位。
    const fishKey = boxes.map((box) => box.id).join('|') + '|' + boxW + '|' + boxH;
    useEffect(() => {
      syncEngine();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在鱼集合与尺寸变化时同步，boxes 是本次渲染的派生值
    }, [fishKey]);

    // 单 rAF 驱动全部鱼：后台标签页停掉，回来接着跑。
    useEffect(() => {
      let alive = true;
      let frame = 0;
      const tick = (): void => {
        if (!alive) return;
        if (typeof document === 'undefined' || !document.hidden) {
          engineRef.current?.step();
          paint();
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => {
        alive = false;
        cancelAnimationFrame(frame);
      };
    }, []);

    if (!enabled || fishes.length === 0) return null;

    /** 点鱼：打开会话，并显式 ack 一次（已完成的那条会立刻消失）。 */
    const openFish = (fish: SessionFishEntry): void => {
      if (fish.done) setHiddenIds((ids) => (ids.includes(fish.sessionId) ? ids : [...ids, fish.sessionId]));
      deps.openSession?.(fish.sessionId);
      void postSessionFishAction({ action: 'focus', sessionId: fish.sessionId });
    };

    /** 点 ×：先本地隐藏，宿主随后把这条从快照里移掉。 */
    const closeFish = (fish: SessionFishEntry): void => {
      setHiddenIds((ids) => (ids.includes(fish.sessionId) ? ids : [...ids, fish.sessionId]));
      void postSessionFishAction({ action: 'close', sessionId: fish.sessionId });
    };

    /** 指针按下：把鱼交给引擎「拿着」，阈值内不算拖动（仍是一次点击）。 */
    const startDrag = (fish: SessionFishEntry, event: PointerEventLike): void => {
      if (event.button !== 0) return;
      suppressClickUntilRef.current = 0;
      dragRef.current = { sessionId: fish.sessionId, startX: event.clientX, startY: event.clientY, moved: false };
      engineRef.current?.beginDrag(fish.sessionId, { x: event.clientX, y: event.clientY });
      setDraggingId(fish.sessionId);
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        /* 个别浏览器/合成事件没有捕获：拖拽仍按 move 事件生效 */
      }
    };

    /** 指针移动：超过阈值才真正拖动（鱼跟手，引擎负责夹进视口）。 */
    const moveDrag = (event: PointerEventLike): void => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.moved) {
        if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
      }
      event.preventDefault();
      engineRef.current?.dragTo({ x: event.clientX, y: event.clientY });
    };

    /** 指针松开/取消：拖动过才保存偏移；随后的 click 由抑制标记吞掉。 */
    const endDrag = (event: PointerEventLike): void => {
      const drag = dragRef.current;
      if (!drag) return;
      try {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      } catch {
        /* 没有捕获可释放 */
      }
      dragRef.current = null;
      setDraggingId(null);
      // 把松手坐标一并交给引擎：最后一次 pointermove 与松手往往不是同一个点，
      // 只用「上一次拖到哪」会把落点算偏（触屏与快速甩动尤其明显）。
      const saved = engineRef.current?.endDrag({ x: event.clientX, y: event.clientY });
      if (!drag.moved || !saved) return;
      // 拖完的 click 可能在 pointerup 之后才到（触屏/合成事件），用时间窗吞掉；
      // 比布尔标记稳：即使没有 click，也不会把下一次真正的点击吞掉。
      suppressClickUntilRef.current = Date.now() + 500;
      writeFishOffset(saved.id, saved.offset);
      const next = readOffsets();
      offsetsRef.current = next;
      setOffsets(next);
    };

    /** click 兜底：键盘 Enter/Space 走这里；刚拖完的时间窗内吞掉 click。 */
    const clickFish = (fish: SessionFishEntry): void => {
      if (Date.now() < suppressClickUntilRef.current) return;
      openFish(fish);
    };

    /** 取该鱼的 ref 回调（每个 id 只造一次，React 才不会每秒重挂节点）。 */
    const refCallbackFor = (sessionId: string): ((el: HTMLElement | null) => void) => {
      const cached = refCallbacksRef.current.get(sessionId);
      if (cached) return cached;
      const callback = (el: HTMLElement | null): void => {
        if (el === null) {
          elementsRef.current.delete(sessionId);
          return;
        }
        const isNew = !elementsRef.current.has(sessionId);
        elementsRef.current.set(sessionId, el);
        if (!isNew) return;
        // 首帧就摆在槽位上：否则会从左上角划进来一道。
        const slot = engineRef.current?.slots().get(sessionId) ?? initialSlots.get(sessionId);
        if (slot) place(el, slot.x, slot.y);
      };
      refCallbacksRef.current.set(sessionId, callback);
      return callback;
    };

    /** 一条鱼：皮肤在环位上、气泡朝外（背离桌宠）、× 常驻右上。 */
    const renderFish = (fish: SessionFishEntry, index: number): ReturnType<typeof jsx> => {
      const title = titles[fish.sessionId] ?? t('newSession');
      const showBubble = isSessionFishBubbleVisible(fish, nowTs, snapshot.bubbleMs);
      const text = fish.line ?? fish.task;
      const dragging = draggingId === fish.sessionId;
      return h('div', {
        key: fish.sessionId,
        ref: refCallbackFor(fish.sessionId),
        className: 'dsh-session-fish' + (dragging ? ' is-dragging' : ''),
        'data-session-fish': '',
        'data-session-id': fish.sessionId,
        style: {
          width: boxW + 'px',
          height: boxH + 'px',
          zIndex: dragging ? 60 : 10 + index,
        },
        children: [
          showBubble
            ? h('div', {
                key: 'bubble-' + fish.lineSeq,
                className: 'dsh-session-fish__bubble',
                'aria-live': 'polite',
                title: text ?? title,
                children: [
                  h('div', {
                    key: 'title',
                    className: 'dsh-session-fish__title',
                    children: [
                      h('span', { key: 't', className: 'dsh-session-fish__titleText', children: title }),
                      fish.done ? h('span', { key: 'ok', className: 'dsh-session-fish__done', children: '✓' }) : null,
                    ],
                  }),
                  text ? h('div', { key: 'line', className: 'dsh-session-fish__line', children: text }) : null,
                ],
              })
            : null,
          h('button', {
            key: 'open',
            type: 'button',
            className: 'dsh-session-fish__open',
            'aria-label': t('openSession') + '：' + title,
            title,
            onPointerDown: (event: PointerEventLike) => startDrag(fish, event),
            onPointerMove: moveDrag,
            onPointerUp: endDrag,
            onPointerCancel: endDrag,
            onContextMenu: (event: { preventDefault(): void }) => event.preventDefault(),
            onClick: () => clickFish(fish),
            children: h(SessionFishMedia, {
              width: boxW,
              skin: snapshot.skin,
              kind: snapshot.skinKind,
              state: fish.state,
              onAspect: () => setAspectTick((tick) => tick + 1),
            }),
          }),
          h('button', {
            key: 'close',
            type: 'button',
            className: 'dsh-session-fish__close',
            'aria-label': t('closeFish') + '：' + title,
            title: t('closeFish'),
            onClick: () => closeFish(fish),
            children: '×',
          }),
        ],
      });
    };

    return h('div', {
      className: 'dsh-session-fish-layer',
      'data-session-fish-layer': '',
      children: fishes.map(renderFish),
    });
  };
}

/** 指针事件的窄类型：只用到坐标、按钮、捕获与 preventDefault。 */
interface PointerEventLike {
  readonly button: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly currentTarget: {
    setPointerCapture?(pointerId: number): void;
    releasePointerCapture?(pointerId: number): void;
  };
  preventDefault(): void;
}
