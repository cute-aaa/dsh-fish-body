/**
 * layered 皮肤的类型与清单解析：把 surfcore `manifest.json`（schema 2）解析成强类型结构。
 * 只做「读与校验」，不加载图片、不碰 DOM；图片加载在 rig/渲染器里。
 * 清单字段多为可选（老版本 / 不同皮肤写法不一），解析一律容错：缺字段取默认、坏字段静默跳过。
 * @module dsh-pet/src/client/pet/render/layered/types
 */

/** 画布尺寸（px，同画布、同位置、透明底）。 */
export interface SkinCanvas {
  readonly w: number;
  readonly h: number;
}

/** 命中框（画布坐标）。 */
export interface SkinHitbox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 一个坐标点 [x, y]。 */
export type Point = readonly [number, number];

/** 嘴部装配。 */
export interface MouthRig {
  /** 静息是张开的还是闭合的。 */
  readonly rest: 'open' | 'closed';
  /** 张嘴素材（rest=closed 时淡入；缺省无张嘴素材）。 */
  readonly open?: string;
  readonly openPivot?: Point;
  readonly openOffset?: Point;
  readonly openRotation?: number;
  /** 张嘴时整层收掉闭合嘴（rest=closed 时）。 */
  readonly hideBase?: boolean;
  /** rest=open 时「闭嘴」纵向压扁下限。 */
  readonly squashMin?: number;
  readonly squashRotation?: number;
  readonly squashOffset?: Point;
}

/** 装配参数：头部 / 眼睛 / 嘴巴 / 尾巴的锚点与幅度。 */
export interface RigOptions {
  readonly headPivot?: Point;
  readonly backHairPivot?: Point;
  readonly mouthPivot?: Point;
  readonly gazeCenter?: Point;
  readonly eyeCenters?: { readonly l: Point; readonly r: Point };
  readonly tailPivot?: Point;
  readonly tailAmp?: number;
  readonly headTilt?: number;
  /** 眨眼位移：数字（两侧同）或 { l: [x,y], r: [x,y] }（左右各自 x/y）。 */
  readonly blinkLash?: number | { readonly l: Point; readonly r: Point };
  readonly motion?: {
    readonly breath?: number;
    readonly sway?: number;
    readonly headTurn?: number;
    readonly gazeMax?: Point;
  };
  readonly mouth?: MouthRig;
}

/** 交互区域（命中区）。 */
export interface InteractionRegion {
  readonly id: string;
  readonly gesture?: string;
  readonly hoverCloseEyes?: boolean;
  readonly shape:
    | { readonly type: 'ellipse'; readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number }
    | { readonly type: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

/** 交互：命中区与右键动作清单。 */
export interface Interaction {
  readonly regions?: readonly InteractionRegion[];
  readonly menu?: readonly string[];
}

/** 一层皮肤。 */
export interface SkinLayer {
  readonly id: string;
  readonly file: string;
  readonly group: 'body' | 'head';
  readonly role: string;
}

/** 解析后的皮肤清单。 */
export interface SkinManifest {
  readonly id: string;
  readonly name: string;
  readonly canvas: SkinCanvas;
  readonly displayScale: number;
  readonly hitbox: SkinHitbox | null;
  readonly rig: RigOptions;
  readonly interaction: Interaction;
  readonly layers: readonly SkinLayer[];
}

/** 容错取数：非有限数返回 undefined。 */
function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** 容错取点：必须是两个有限数。 */
function point(value: unknown): Point | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const x = num(value[0]);
  const y = num(value[1]);
  return x === undefined || y === undefined ? undefined : [x, y];
}

/** 容错取对象。 */
function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** 容错取字符串。 */
function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** 解析一层。 */
function parseLayer(value: unknown): SkinLayer | null {
  const o = obj(value);
  if (!o) return null;
  const id = str(o.id);
  const file = str(o.file);
  if (!id || !file) return null;
  const group = o.group === 'head' ? 'head' : 'body';
  return { id, file, group, role: str(o.role) ?? id };
}

/** 解析交互区域。 */
function parseRegion(value: unknown): InteractionRegion | null {
  const o = obj(value);
  if (!o) return null;
  const id = str(o.id);
  const shape = obj(o.shape);
  if (!id || !shape) return null;
  if (shape.type === 'ellipse') {
    const cx = num(shape.cx);
    const cy = num(shape.cy);
    const rx = num(shape.rx);
    const ry = num(shape.ry);
    if (cx === undefined || cy === undefined || rx === undefined || ry === undefined) return null;
    return {
      id,
      gesture: str(o.gesture),
      hoverCloseEyes: o.hoverCloseEyes === true,
      shape: { type: 'ellipse', cx, cy, rx, ry },
    };
  }
  const x = num(shape.x);
  const y = num(shape.y);
  const w = num(shape.w);
  const h = num(shape.h);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;
  return {
    id,
    gesture: str(o.gesture),
    hoverCloseEyes: o.hoverCloseEyes === true,
    shape: { type: 'rect', x, y, w, h },
  };
}

/** 解析嘴部装配。 */
function parseMouth(o: Record<string, unknown> | undefined): MouthRig | undefined {
  if (!o) return undefined;
  const rest = o.rest === 'open' ? 'open' : 'closed';
  return {
    rest,
    ...(str(o.open) ? { open: str(o.open) } : {}),
    ...(point(o.openPivot) ? { openPivot: point(o.openPivot) } : {}),
    ...(point(o.openOffset) ? { openOffset: point(o.openOffset) } : {}),
    ...(num(o.openRotation) !== undefined ? { openRotation: num(o.openRotation) } : {}),
    ...(o.hideBase === true ? { hideBase: true } : {}),
    ...(num(o.squashMin) !== undefined ? { squashMin: num(o.squashMin) } : {}),
    ...(num(o.squashRotation) !== undefined ? { squashRotation: num(o.squashRotation) } : {}),
    ...(point(o.squashOffset) ? { squashOffset: point(o.squashOffset) } : {}),
  };
}

/**
 * 解析 surfcore 皮肤清单。
 *
 * @param raw - `manifest.json` 的解析结果（unknown）。
 * @returns 强类型清单；`canvas` 或 `layers` 缺失（真异常）时返回 null。
 */
export function parseSkinManifest(raw: unknown): SkinManifest | null {
  const root = obj(raw);
  if (!root) return null;
  const canvas = obj(root.canvas);
  const cw = canvas ? num(canvas.w) : undefined;
  const ch = canvas ? num(canvas.h) : undefined;
  const layersRaw = Array.isArray(root.layers) ? root.layers : null;
  if (cw === undefined || ch === undefined || layersRaw === null) return null;

  const layers: SkinLayer[] = [];
  for (const item of layersRaw) {
    const layer = parseLayer(item);
    if (layer) layers.push(layer);
  }
  if (layers.length === 0) return null;

  const hitbox = obj(root.hitbox);
  const hx = hitbox ? num(hitbox.x) : undefined;
  const hy = hitbox ? num(hitbox.y) : undefined;
  const hw = hitbox ? num(hitbox.w) : undefined;
  const hh = hitbox ? num(hitbox.h) : undefined;

  const rigRaw = obj(root.rigOptions);
  const motion = rigRaw ? obj(rigRaw.motion) : undefined;
  const blinkRaw = rigRaw?.blinkLash;
  const blinkLash =
    typeof blinkRaw === 'number' && Number.isFinite(blinkRaw)
      ? blinkRaw
      : (() => {
          const b = obj(blinkRaw);
          if (!b) return undefined;
          const l = point(b.l);
          const r = point(b.r);
          return l && r ? { l, r } : undefined;
        })();
  const eyeCentersRaw = rigRaw ? obj(rigRaw.eyeCenters) : undefined;
  const eyeCenters =
    eyeCentersRaw && point(eyeCentersRaw.l) && point(eyeCentersRaw.r)
      ? { l: point(eyeCentersRaw.l)!, r: point(eyeCentersRaw.r)! }
      : undefined;

  const interactionRaw = obj(root.interaction);
  const regions: InteractionRegion[] = [];
  if (Array.isArray(interactionRaw?.regions)) {
    for (const item of interactionRaw.regions) {
      const region = parseRegion(item);
      if (region) regions.push(region);
    }
  }

  return {
    id: str(root.id) ?? '',
    name: str(root.name) ?? str(root.id) ?? '',
    canvas: { w: cw, h: ch },
    displayScale: num((obj(root.display) ?? {}).scale) ?? 1,
    hitbox:
      hx !== undefined && hy !== undefined && hw !== undefined && hh !== undefined
        ? { x: hx, y: hy, w: hw, h: hh }
        : null,
    rig: {
      ...(rigRaw && point(rigRaw.headPivot) ? { headPivot: point(rigRaw.headPivot) } : {}),
      ...(rigRaw && point(rigRaw.backHairPivot) ? { backHairPivot: point(rigRaw.backHairPivot) } : {}),
      ...(rigRaw && point(rigRaw.mouthPivot) ? { mouthPivot: point(rigRaw.mouthPivot) } : {}),
      ...(rigRaw && point(rigRaw.gazeCenter) ? { gazeCenter: point(rigRaw.gazeCenter) } : {}),
      ...(eyeCenters ? { eyeCenters } : {}),
      ...(rigRaw && point(rigRaw.tailPivot) ? { tailPivot: point(rigRaw.tailPivot) } : {}),
      ...(rigRaw && num(rigRaw.tailAmp) !== undefined ? { tailAmp: num(rigRaw.tailAmp) } : {}),
      ...(rigRaw && num(rigRaw.headTilt) !== undefined ? { headTilt: num(rigRaw.headTilt) } : {}),
      ...(blinkLash !== undefined ? { blinkLash } : {}),
      ...(motion
        ? {
            ...(num(motion.breath) !== undefined ? { breath: num(motion.breath) } : {}),
            ...(num(motion.sway) !== undefined ? { sway: num(motion.sway) } : {}),
            ...(num(motion.headTurn) !== undefined ? { headTurn: num(motion.headTurn) } : {}),
            ...(point(motion.gazeMax) ? { gazeMax: point(motion.gazeMax) } : {}),
          }
        : {}),
      ...(parseMouth(rigRaw ? obj(rigRaw.mouth) : undefined)
        ? { mouth: parseMouth(rigRaw ? obj(rigRaw.mouth) : undefined) }
        : {}),
    },
    interaction: {
      regions,
      menu: Array.isArray(interactionRaw?.menu) ? interactionRaw.menu.filter((m) => typeof m === 'string') : [],
    },
    layers,
  };
}
