/**
 * `.exp3.json`（Cubism 外观）的解析：把「挂着的外观」变成**每帧重写的一组参数**。
 *
 * 为什么要自己解析而不是交给运行库的 `CubismExpressionMotion`：那是一个**一次性**动作
 * （淡入 → 停留 → 淡出 → `isFinished()`），外观却是 VTube 语义的**开关状态**——摘之前一直生效。
 * 直接用运行库的结果是「牙齿闪一下就没了」（真实故障：用户报「兔牙没生效」）。
 * 参数含义只有三样：Id / Value / Blend，序列化成本极低，自己写一帧一应用反而最稳。
 *
 * 纯函数、无副作用、两端共用（网页端直接 import，桌面端走 `window.PetShared.parseExp3`）。
 * @module dsh-fish-body/src/shared/live2d-exp3
 */

/** Cubism 的参数混合方式（exp3 里就是这三个字面量）。 */
export type Exp3Blend = 'Add' | 'Multiply' | 'Overwrite';

/** 一条外观参数。 */
export interface Exp3Parameter {
  /** 参数字典 id（VTube 导出的外观通常是 `key9` 这类键位参数）。 */
  readonly id: string;
  /** 目标值。 */
  readonly value: number;
  /** 混合方式；缺省 `Add`（与 Cubism 一致）。 */
  readonly blend: Exp3Blend;
}

/** 一份外观 = 一组参数 + 淡入淡出时长。 */
export interface Exp3Motion {
  /** 要写的参数（空数组 = 这份 exp3 什么都没写，等于无效外观）。 */
  readonly parameters: readonly Exp3Parameter[];
  /** 淡入秒数（文件没写时的缺省值）。 */
  readonly fadeIn: number;
  /** 淡出秒数（只在外观被摘掉时有用；挂着期间不淡出）。 */
  readonly fadeOut: number;
}

/** 文件没声明淡入时的缺省值（秒）：0.2 秒比 Cubism 的 1 秒跟手，换外观不该等一秒。 */
const DEFAULT_FADE_IN = 0.2;

/** 文件没声明淡出时的缺省值（秒）。 */
const DEFAULT_FADE_OUT = 0.2;

/** 单条外观最多写几个参数：正常 exp3 只有个位数，多到这份上是坏数据。 */
const MAX_PARAMETERS = 64;

/**
 * 解析一份 `.exp3.json`。
 *
 * 容错优先：形状不对的条目逐条跳过，整份坏成空参数也不抛——外观挂不上只是没效果，
 * 抛出去会把整帧渲染打断（画布直接黑掉）。
 *
 * @param raw - 已解析成对象的 exp3 JSON。
 * @returns 参数表与淡入淡出；`raw` 是垃圾时返回空参数 + 缺省时长。
 */
export function parseExp3(raw: unknown): Exp3Motion {
  const source = (raw && typeof raw === 'object' ? raw : {}) as {
    Parameters?: unknown;
    FadeInTime?: unknown;
    FadeOutTime?: unknown;
  };
  const parameters: Exp3Parameter[] = [];
  if (Array.isArray(source.Parameters)) {
    for (const item of source.Parameters) {
      if (parameters.length >= MAX_PARAMETERS) break;
      if (!item || typeof item !== 'object') continue;
      const one = item as { Id?: unknown; Value?: unknown; Blend?: unknown };
      if (typeof one.Id !== 'string' || one.Id === '') continue;
      if (typeof one.Value !== 'number' || !Number.isFinite(one.Value)) continue;
      const blend: Exp3Blend =
        one.Blend === 'Multiply' || one.Blend === 'Overwrite' || one.Blend === 'Add' ? one.Blend : 'Add';
      parameters.push({ id: one.Id, value: one.Value, blend });
    }
  }
  const fade = (value: unknown, fallback: number): number => {
    const n = typeof value === 'number' ? value : Number.NaN;
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    parameters,
    fadeIn: fade(source.FadeInTime, DEFAULT_FADE_IN),
    fadeOut: fade(source.FadeOutTime, DEFAULT_FADE_OUT),
  };
}
