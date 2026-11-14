/**
 * 一张宠物卡的动画装配：按 pets[].renderer 造渲染实例并挂载到 stage，跟随状态驱动播放。
 * 不再持有 video 元素：A/B 双缓冲由 webm 渲染器内部管理；本模块只决定「何时读、何时切」。
 * 不负责运动与浮层：走位、拖拽、挤压经装配根的迟绑槽取值，本模块只把渲染器暴露出去。
 * 卸载顺序固定：摘监听 → 注销 pose/progress → 销毁渲染器 → 停三套运动。
 * @module dsh-fish-body/src/client/pet/card/animation
 */
import { registerPose } from '../../pose.ts';
import { registerProgress } from '../../progress.ts';
import { playPetAnimSfx, stopPetAnimSfx } from '../sfx.ts';
import { boxToRatio, centerToBox, clampReachableBox, derivePetMetrics } from '../motion/geometry.ts';
import { createRenderer } from '../render/registry.ts';
import { renderSizeOf, resolvePetSizePx } from '../../../shared/pet-size.ts';
import type { Renderer } from '../render/types.ts';
import type { CardLive } from './live.ts';
import type { CardStateApi } from './state.ts';
import type { RuntimePet } from '../types.ts';
import type { LockState } from '../../../shared/state.ts';
import type { WorkStatusSnapshot } from '../../../shared/work-status.ts';
import type * as ReactNS from 'react';

/** 注入的 react 能力。 */
export interface CardAnimationRuntime {
  /** 副作用。 */
  useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
  /** 引用；渲染实例只造一次。 */
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
}

/** 动画装配的输入；全部是取值函数或稳定引用。 */
export interface CardAnimationInput {
  /** 卡状态：动画名、序号与朝向都从它取。 */
  card: CardStateApi;
  /** 成品配置的最新值。 */
  cfgRef: ReactNS.MutableRefObject<RuntimePet>;
  /** 工作状态的最新值：播完判定要读，回调晚于状态更新。 */
  workStatusRef: ReactNS.MutableRefObject<WorkStatusSnapshot | null>;
  /** 装配根迟绑槽。 */
  live: ReactNS.MutableRefObject<CardLive>;
  /** 新首帧就位后是否补一次 Q 弹（点击互动置位）。 */
  pendingSquash: ReactNS.MutableRefObject<boolean>;
  /** 舞台节点（渲染器的挂载点）。 */
  stage: () => HTMLDivElement | null;
  /** 点播回执：真实播放结果只有浏览器侧知道。 */
  report: (playbackId: string, status: 'playing' | 'ended' | 'failed' | 'cancelled', reason?: string) => void;
  /** 挂载瞬间的锁叶子：只用于决定渲染器初始是否冻结。 */
  lock?: LockState;
  /** 消费掉点播编号，避免 effect 再跑一趟。 */
  setCuePlayback: (id: string | null) => void;
  /** 本宠物 id：挂载期注册只读服务用它。 */
  petId: string;
  /** 画面量出内容顶后回写气泡锚点；null = 本后端没量到，卡片退回 webm 口径。 */
  onBubbleAnchor: (y: number | null) => void;
}

/**
 * 造动画装配的 hook。
 *
 * @param rt - 注入的 react 能力。
 * @returns 接收装配输入的 hook，返回本卡的渲染实例。
 */
export function createCardAnimation(rt: CardAnimationRuntime) {
  const { useEffect, useRef } = rt;

  return function useCardAnimation(input: CardAnimationInput): Renderer {
    const { card, cfgRef, live, pendingSquash, petId, workStatusRef } = input;

    const rendererKind = cfgRef.current.renderer ?? 'webm';
    // 渲染实例同步建（ref 只造一次）：kind 变化时重建——与旧 OwnAnimation 同期语义一致，
    // 让装配根在渲染期就能读 isFrozen/setFrozen，而不是等到挂载 effect 之后。
    const rendererRef = useRef<Renderer | null>(null);
    if (rendererRef.current === null || rendererRef.current.kind !== rendererKind) {
      rendererRef.current = createRenderer(rendererKind) ?? createRenderer('webm') ?? null;
    }
    const renderer = rendererRef.current;
    if (renderer === null) throw new Error('fish-body: 渲染后端未注册（缺 webm）');
    // 挂载瞬间的锁冻结：渲染器只读一次，这里锁住「第一次渲染时」的值，之后锁变化走 setFrozen。
    const initiallyFrozenRef = useRef(input.lock?.locked === true && input.lock.expiresAt > Date.now());

    // 迟绑槽当场填好：运动/菜单/指令的闭包都经它取，不缓存渲染期的 null。
    live.current.ownAnim = renderer;
    live.current.frontVideo = () => renderer.frontElement() as HTMLVideoElement | null;

    // 按 renderer 即时重建：kind 变化 → 销毁旧实例、造新实例、重新挂载（stage 即时重建）。
    useEffect(() => {
      const stageEl = input.stage();
      if (stageEl === null) return;
      // 换后端先清掉上一个后端的锚点：webm 没量内容顶，留着旧值气泡会飘在半空。
      input.onBubbleAnchor(null);
      // 槽对象身份稳定（useRef 一次）：捕获一份给清理用，避免读 .current。
      const slots = live.current;
      // 挂载前重新填槽：kind 切换时旧实例的清理会先把它置 null，这里恢复成本次实例。
      slots.ownAnim = renderer;
      slots.frontVideo = () => renderer.frontElement() as HTMLVideoElement | null;
      const mounted = Promise.resolve(
        renderer.mount(stageEl, {
          size: resolvePetSizePx(
            renderSizeOf(cfgRef.current),
            cfgRef.current.sizePercent,
            window.innerWidth,
            cfgRef.current.renderer,
          ),
          assetRoot: cfgRef.current.assetRoot ?? '',
          source: {
            cfg: () => cfgRef.current,
            currentAnim: () => card.animRef.current,
            workStatus: () => workStatusRef.current,
            facing: () => card.facingRef.current,
            report: input.report,
            clearCuePlayback: () => input.setCuePlayback(null),
            onFrontReady: (el) => {
              // 点击 Q 弹要等新动画就位后才压，压的是新首帧。
              if (pendingSquash.current) {
                pendingSquash.current = false;
                slots.squash.start(el as HTMLVideoElement);
              }
              if (slots.walk.hasPending()) slots.walk.start(el as HTMLVideoElement);
            },
            isDragging: () => slots.drag.isActive(),
            initiallyFrozen: initiallyFrozenRef.current,
            onVisualAnchor: (y) => input.onBubbleAnchor(y),
          },
        }),
      );
      // 播完判定回调在渲染器挂载完成后接上；回调晚于 flow 创建，经迟绑槽读最新 flow。
      void mounted.then(() => {
        renderer.setEndedHandler((cue) => slots.flow?.applyEndedCue(cue));
      });
      return () => {
        renderer.destroy();
        slots.ownAnim = null;
        slots.frontVideo = () => null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- 变化原因只有 renderer kind；回调与 stage 都经 ref/getter 现读
    }, [rendererKind]);

    const { anim, cuePlayback, once, seq } = card.state;

    // 状态驱动播放：once=false 走循环待机，once=true 走一次动作；绝对地址由渲染器自己识别。
    useEffect(() => {
      if (once) {
        renderer.playAction(anim, { playbackId: cuePlayback });
      } else {
        renderer.setIdle(anim);
      }
      // 动作音与动画名绑定：换源就换音，同一段重播（seq 递增）也重排时间线。
      playPetAnimSfx(cfgRef.current, anim, live.current.ownAnim?.sfxLayer?.() ?? null);
      // 换源/卸载先撤掉本段排下的点：旧动画的动作音不该飘到下一段头上。
      return stopPetAnimSfx;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖由 anim/once/seq/cuePlayback/rendererKind 的换源身份决定
    }, [anim, once, seq, cuePlayback, rendererKind]);

    useEffect(() => {
      // 槽对象身份稳定（useRef 一次），字段每渲染就地更新；捕获一份给清理用，避免读 .current。
      const services = live.current;
      // 视口变化要按新尺寸重算根节点位置，否则改窗口大小后宠物停在旧比例上；
      // 重算后再压一次可见下限，缩窗把宠物挤到视口外时能自愈。
      const onResize = () =>
        card.actions.setCustomPos((prev) => {
          if (!prev) return prev;
          // 读 cfgRef 而不是闭包里的 card.state：本效果只注册一次，渲染期快照是初始尺寸。
          // 尺寸与装配根用同一条解析（按渲染方式取画框宽，再套占屏上限），否则缩放后的位置会跳。
          const cfg = cfgRef.current;
          const size = resolvePetSizePx(renderSizeOf(cfg), cfg.sizePercent, window.innerWidth, cfg.renderer);
          const { renderer } = cfg;
          const { halfW, halfH, bottomPad } = derivePetMetrics(size, renderer);
          const viewport = { width: window.innerWidth, height: window.innerHeight };
          const half = { w: halfW, h: halfH };
          const box = centerToBox(prev, viewport, half);
          // 必须返回新对象：视口变了就得重渲染，返回同一引用 React 会跳过，位置不会重算。
          return { ...boxToRatio(clampReachableBox(box, viewport, { size, bottomPad, renderer }), viewport, half) };
        });
      window.addEventListener('resize', onResize);
      // 把本页这只宠物的实时位置与朝向注册给只读服务 petApi7340（见 ../pose）；
      // 消费者按需读闭包，拖拽、抛掷中途也能拿到当前值，不是快照。
      const unregisterPose = registerPose(petId, () => {
        const center = live.current.center();
        return {
          x: center.x / window.innerWidth,
          y: center.y / window.innerHeight,
          facing: card.facingRef.current,
        };
      });
      // 播放进度走同一个 Cordis 入口（见 ../progress）；经渲染器暴露当前播放状态。
      const unregisterProgress = registerProgress(petId, () => renderer.progress());
      return () => {
        window.removeEventListener('resize', onResize);
        unregisterPose(); // 卸载即摘除：静默失效比读到陈旧值安全。
        unregisterProgress();
        services.stopMove();
        services.drag.stopFollow();
        services.flight.stop();
        services.squash.stop();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载/卸载各跑一次：闭包读的是 refs 与稳定 props
    }, []);

    return renderer;
  };
}
