/**
 * 桌面 live2d 的叠加层：动作与外观各自成层，可同时挂多个，且不打断内置待机。
 *
 * 与 `src/client/pet/render/live2d/overlay.ts` 同构（那一份是网页端的实现）。为什么不合并：
 * 网页端走 ESM 类型，桌面端只有经典脚本 + `window.PetShared`，两侧的 cubism 入口虽然同源，
 * 但模块系统不同，共享的只有纯函数（`S.parseMotion3`）。
 *
 * 为什么不用运行库的 `model.motion()`：pixi-live2d-display 0.4.0 的 cubism4 后端把所有 motion
 * 塞进同一个队列，`_startMotion` 一进来就 `stopAllMotions()`——点第二个动作会把第一个连同待机一起掐掉。
 * VTube 的用法相反：热键动作叠在待机之上，举手/竖手指/狗尾巴草还能同时保持。
 * @module dsh-pet/runtime/electron-helper/sprite-overlay
 */
'use strict';

/** 同时挂着的上限：再多也看不出区别，纯粹是内存与逐帧开销。 */
const OVERLAY_MAX_LAYERS = 8;

/**
 * 造叠加层。
 *
 * @param {object} api - cubism4 的三个构造入口（`PIXI.live2d` 上就有）。
 * @param {() => object|null} core - 取当前 coreModel 的取值函数。
 * @returns {{play: Function, toggle: Function, stop: Function, stopKind: Function, active: Function, tick: Function, destroy: Function}}
 */
function createOverlay(api, core) {
  const entries = new Map();

  /** 把定格姿态写回模型（参数与部件不透明度分开走）。 */
  const applyFinals = (model, finals) => {
    for (const item of finals) {
      if (item.target === 'PartOpacity') {
        if (typeof model.setPartOpacityById === 'function') model.setPartOpacityById(item.id, item.value);
      } else {
        model.setParameterValueById(item.id, item.value, 1);
      }
    }
  };

  /** 超上限时淘汰同类里最早的那条（Map 保插入顺序）。 */
  const evict = (kind) => {
    for (const [key, entry] of entries) {
      if (entry.kind !== kind) continue;
      entry.queue.stopAllMotions();
      entries.delete(key);
      return;
    }
  };

  const stop = (key) => {
    const entry = entries.get(key);
    if (!entry) return;
    entry.queue.stopAllMotions();
    entries.delete(key);
  };

  const play = (key, kind, json, options) => {
    const opts = options || {};
    stop(key);
    if (entries.size >= OVERLAY_MAX_LAYERS) evict(kind);
    const queue = new api.CubismMotionQueueManager();
    // 事件回调空实现：动作文件带 UserData 时运行库会无条件调用它，缺了直接抛异常。
    if (typeof queue.setEventCallback === 'function') queue.setEventCallback(() => {});
    const motion = kind === 'expression' ? api.CubismExpressionMotion.create(json) : api.CubismMotion.create(json);
    // 文件里的 Loop 是给待机循环用的；热键动作一律播一遍，否则手臂会反复来回抖。
    if (kind === 'motion' && typeof motion.setIsLoop === 'function') motion.setIsLoop(false);
    if (Number.isFinite(opts.fadeSeconds) && typeof motion.setFadeInTime === 'function') {
      motion.setFadeInTime(opts.fadeSeconds);
      motion.setFadeOutTime(opts.fadeSeconds);
    }
    queue.startMotion(motion, false, performance.now() / 1000);
    const finals =
      kind === 'motion' && opts.hold === true && opts.raw !== undefined ? S.parseMotion3(opts.raw).finals : null;
    entries.set(key, { kind, queue, finals: finals && finals.length > 0 ? finals : null, done: false });
  };

  const tick = () => {
    const model = core();
    if (!model) return;
    const nowSeconds = performance.now() / 1000;
    // 先写定格姿态、再推进活动层：新动作要能盖住旧的定格。
    for (const entry of entries.values()) {
      if (entry.done && entry.finals) applyFinals(model, entry.finals);
    }
    for (const [key, entry] of entries) {
      if (entry.done) continue;
      entry.queue.doUpdateMotion(model, nowSeconds);
      if (!entry.queue.isFinished()) continue;
      if (entry.finals) entry.done = true;
      else entries.delete(key);
    }
  };

  return {
    play,
    toggle: (key, kind, json, options) => {
      if (entries.has(key)) {
        stop(key);
        return 'off';
      }
      play(key, kind, json, options);
      return 'on';
    },
    stop,
    stopKind: (kind) => {
      for (const key of [...entries.keys()]) {
        const entry = entries.get(key);
        if (entry && entry.kind === kind) stop(key);
      }
    },
    active: (kind) => [...entries.entries()].filter(([, entry]) => entry.kind === kind).map(([key]) => key),
    tick,
    destroy: () => {
      for (const key of [...entries.keys()]) stop(key);
    },
  };
}
