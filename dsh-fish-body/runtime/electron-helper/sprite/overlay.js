/**
 * 桌面 live2d 的叠加层：动作与外观各自成层，可同时挂多个，且不打断内置待机。
 *
 * 与 `src/client/pet/render/live2d/overlay.ts` 同构（那一份是网页端的实现）。为什么不合并：
 * 网页端走 ESM 类型，桌面端只有经典脚本 + `window.PetShared`，两侧的 cubism 入口虽然同源，
 * 但模块系统不同，共享的只有纯函数（`S.parseMotion3` / `S.parseExp3`）。
 *
 * 为什么不用运行库的 `model.motion()`：pixi-live2d-display 0.4.0 的 cubism4 后端把所有 motion
 * 塞进同一个队列，`_startMotion` 一进来就 `stopAllMotions()`——点第二个动作会把第一个连同待机一起掐掉。
 * VTube 的用法相反：热键动作叠在待机之上，举手/竖手指/狗尾巴草还能同时保持。
 *
 * **外观不是动作**：`CubismExpressionMotion` 是一次性的（淡入 → 淡出 → 结束），外观却是
 * VTube 语义的开关状态，所以这里自己解析 exp3 并把参数每帧重写，直到被摘掉为止。
 * @module dsh-fish-body/runtime/electron-helper/sprite-overlay
 */
'use strict';

/** 同时挂着的上限：再多也看不出区别，纯粹是内存与逐帧开销。 */
const OVERLAY_MAX_LAYERS = 8;

/**
 * 造叠加层。
 *
 * @param {object} api - cubism4 的构造入口（`PIXI.live2d` 上就有；外观不用表达式入口）。
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

  /**
   * 把一组外观参数按当前权重写进模型。
   *
   * 混合方式自己算而不是交给 setParameterValueById 的 weight：那个 weight 是「向目标值插值」，
   * 对 Add / Multiply 只有在基准是 0 / 1 时才等价——VTube 的 key* 参数正好是这种，别的模型未必。
   *
   * @param {object} model - 当前 coreModel。
   * @param {Array<{id: string, value: number, blend: string}>} params - exp3 解析出来的参数表。
   * @param {number} weight - 0~1（淡入进度）。
   */
  const applyParams = (model, params, weight) => {
    const w = Math.max(0, Math.min(1, weight));
    for (const item of params) {
      const current = typeof model.getParameterValueById === 'function' ? model.getParameterValueById(item.id) : NaN;
      const base = typeof current === 'number' && Number.isFinite(current) ? current : undefined;
      if (item.blend === 'Multiply') {
        model.setParameterValueById(item.id, base === undefined ? item.value : base * item.value, w);
      } else if (item.blend === 'Overwrite') {
        model.setParameterValueById(item.id, item.value, w);
      } else {
        model.setParameterValueById(item.id, base === undefined ? item.value : base + item.value, w);
      }
    }
  };

  /** 超上限时淘汰同类里最早的那条（Map 保插入顺序）。 */
  const evict = (kind) => {
    for (const [key, entry] of entries) {
      if (entry.kind !== kind) continue;
      if (entry.queue) entry.queue.stopAllMotions();
      entries.delete(key);
      return;
    }
  };

  const stop = (key) => {
    const entry = entries.get(key);
    if (!entry) return;
    if (entry.queue) entry.queue.stopAllMotions();
    entries.delete(key);
  };

  const play = (key, kind, json, options) => {
    const opts = options || {};
    stop(key);
    if (entries.size >= OVERLAY_MAX_LAYERS) evict(kind);
    const now = performance.now() / 1000;
    // 外观：解析 exp3 后每帧重写，不建队列——运行库的表达式是一次性的，挂不住。
    if (kind === 'expression') {
      const parsed = S.parseExp3(json);
      // 一行诊断：先看 exp3 写了哪些参数、当前值多少、以及写下去能读回多少。
      // 读回值不等于目标值 = 这条参数被模型钳住了（min=max，或压根没有受它影响的绘制）。
      const model = core();
      const show = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '?');
      const detail = parsed.parameters
        .map((p) => {
          // 只读不回写：帧外写参数会与正在跑的帧抢参数，也会污染测试对写入次数的断言。
          let base;
          try {
            base = model && typeof model.getParameterValueById === 'function' ? model.getParameterValueById(p.id) : NaN;
          } catch {
            base = NaN;
          }
          return p.id + '(基' + show(base) + '+' + String(p.value) + ')';
        })
        .join(',');
      console.log(
        '[fish-body] 外观挂载 ' +
          key +
          ' params=' +
          String(parsed.parameters.length) +
          (parsed.parameters.length === 0 ? '（这份 exp3 没有 Parameters，挂上也不会变）' : '(' + detail + ')'),
      );
      entries.set(key, {
        kind,
        queue: null,
        finals: null,
        params: parsed.parameters,
        startedAt: now,
        fadeIn: Number.isFinite(opts.fadeSeconds) ? opts.fadeSeconds : parsed.fadeIn,
        done: false,
      });
      return;
    }
    const queue = new api.CubismMotionQueueManager();
    // 事件回调空实现：动作文件带 UserData 时运行库会无条件调用它，缺了直接抛异常。
    if (typeof queue.setEventCallback === 'function') queue.setEventCallback(() => {});
    const motion = api.CubismMotion.create(json);
    // 文件里的 Loop 是给待机循环用的；热键动作一律播一遍，否则手臂会反复来回抖。
    if (typeof motion.setIsLoop === 'function') motion.setIsLoop(false);
    if (Number.isFinite(opts.fadeSeconds) && typeof motion.setFadeInTime === 'function') {
      motion.setFadeInTime(opts.fadeSeconds);
      motion.setFadeOutTime(opts.fadeSeconds);
    }
    queue.startMotion(motion, false, now);
    const finals = opts.hold === true && opts.raw !== undefined ? S.parseMotion3(opts.raw).finals : null;
    entries.set(key, {
      kind,
      queue,
      finals: finals && finals.length > 0 ? finals : null,
      params: null,
      startedAt: now,
      fadeIn: 0,
      done: false,
    });
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
      // 外观：挂着就一直写（这就是「开关状态」的全部实现），淡入只跑一次。
      if (entry.kind === 'expression') {
        if (entry.params && entry.params.length > 0) {
          const weight = entry.fadeIn <= 0 ? 1 : (nowSeconds - entry.startedAt) / entry.fadeIn;
          applyParams(model, entry.params, weight);
        }
        continue;
      }
      if (!entry.queue || entry.done) continue;
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
