/**
 * `.motion3.json` 的最小解析：只回答「这条动作停在哪个姿态」。
 *
 * 叠加层自己管队列（见 client/pet/render/live2d/overlay），VTube 的「停在最后一帧」
 * （`StopsOnLastFrame`）要求动作播完之后**继续**把末态参数写回去，否则手臂会立刻弹回待机姿态。
 * 运行库内部已经算过这些值，但它不给外部读——所以这里按 Cubism 的段格式取每条曲线的末点。
 *
 * 段格式（与 Cubism SDK 的解析循环一致）：`[x0, y0, 类型, …]`，线性/阶跃段跟 2 个数、
 * 贝塞尔段跟 6 个数（两个控制点 + 终点）。末点就是最后一段的终点。
 * @module dsh-pet/src/shared/live2d-motion3
 */

/** 一条曲线在动作末帧的取值。 */
export interface MotionFinalValue {
  /** 参数 / 部件 id。 */
  readonly id: string;
  /** 写回位置：参数走 `setParameterValueById`，部件不透明度走 `setPartOpacityById`。 */
  readonly target: 'Parameter' | 'PartOpacity';
  /** 末点取值。 */
  readonly value: number;
}

/** 一份 `.motion3.json` 的概要。 */
export interface Motion3Summary {
  /** 动作时长（秒）；`Meta.Duration` 缺失或非法时为 0（调用方另有兜底）。 */
  readonly duration: number;
  /** 每条曲线在末帧的取值；正常文件不会为空。 */
  readonly finals: readonly MotionFinalValue[];
}

/** 段类型（与 Cubism 的 CubismMotionSegmentType 同值）。 */
const SEG_BEZIER = 1;

/** 容错取对象。 */
function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * 取一条曲线末段的终点 y。
 *
 * @param segments - 曲线自己的 `Segments` 数组（未知元素按 0 处理）。
 * @returns 末点取值；数组太短或算出来不是有限数时返回 null。
 */
function lastValueOf(segments: readonly unknown[]): number | null {
  if (segments.length < 2) return null;
  // 首点是线段起点，天然就是「目前的末点」
  let last = Number(segments[1]);
  let at = 2;
  while (at < segments.length) {
    const type = Number(segments[at]);
    if (type === SEG_BEZIER) {
      last = Number(segments[at + 6]);
      at += 7;
    } else {
      last = Number(segments[at + 2]);
      at += 3;
    }
  }
  return Number.isFinite(last) ? last : null;
}

/**
 * 解析一份动作文件（入参是 `JSON.parse` 的结果，可能来自网络、可能结构不对）。
 *
 * @param raw - `.motion3.json` 的解析结果。
 * @returns 时长与各曲线的末点取值；结构不认识时给出空结果，不抛异常。
 */
export function parseMotion3(raw: unknown): Motion3Summary {
  const root = obj(raw);
  const meta = obj(root?.Meta);
  const seconds = Number(meta?.Duration);
  const duration = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const curves = Array.isArray(root?.Curves) ? root.Curves : [];
  const finals: MotionFinalValue[] = [];
  for (const item of curves) {
    const curve = obj(item);
    if (curve === undefined) continue;
    const id = typeof curve.Id === 'string' ? curve.Id : '';
    const segments = Array.isArray(curve.Segments) ? curve.Segments : [];
    const value = lastValueOf(segments);
    if (id === '' || value === null) continue;
    finals.push({ id, target: curve.Target === 'PartOpacity' ? 'PartOpacity' : 'Parameter', value });
  }
  return { duration, finals };
}
