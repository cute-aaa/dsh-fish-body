/**
 * layered 皮肤的装配数学：把「运行时姿态」折成每层的平移 / 旋转 / 缩放 / 透明度，并画到画布。
 * 只做纯计算与绘制，不持有图片、不读时钟、不碰 DOM 以外的画布；动画驱动在渲染器里。
 * 层序以 manifest 的 layers 顺序为准（后画压前画），张嘴素材插在基础嘴层之后。
 * @module dsh-pet/src/client/pet/render/layered/rig
 */
import type { SkinManifest } from './types.ts';

/** 运行时姿态：呼吸 / 摇摆 / 眨眼 / 视线 / 嘴 / 尾巴 / 弹跳 / 挤压。 */
export interface RigState {
  /** 呼吸相位（0~2π）。 */
  readonly breath: number;
  /** 摇摆相位（0~2π）。 */
  readonly sway: number;
  /** 眨眼 0~1（0 睁，1 闭）。 */
  readonly blink: number;
  /** 视线 -1~1。 */
  readonly gazeX: number;
  readonly gazeY: number;
  /** 嘴张开 0~1。 */
  readonly mouth: number;
  /** 尾巴摆动 -1~1。 */
  readonly tail: number;
  /** 弹跳 0~1（0 落，1 跳起）。 */
  readonly hop: number;
  /** 挤压 0~1（0 常态，1 最扁）。 */
  readonly jelly: number;
}

/** 一层已解码的图层。 */
export interface LoadedLayer {
  readonly role: string;
  readonly group: 'body' | 'head';
  readonly image: CanvasImageSource;
}

/** 一层的最终姿态。 */
export interface LayerPose {
  readonly image: CanvasImageSource;
  readonly pivotX: number;
  readonly pivotY: number;
  readonly dx: number;
  readonly dy: number;
  readonly rot: number;
  readonly sx: number;
  readonly sy: number;
  readonly alpha: number;
}

/** 该眼睛的眨眼位移（px）：数字两侧同，对象左右各自取 y。 */
function blinkOffset(skin: SkinManifest, role: string): number {
  const blink = skin.rig.blinkLash;
  if (typeof blink === 'number') return blink;
  if (blink && role.endsWith('.l')) return blink.l[1] ?? 0;
  if (blink && role.endsWith('.r')) return blink.r[1] ?? 0;
  return 0;
}

/**
 * 折出全部层（含张嘴素材）的姿态。
 *
 * @param skin - 皮肤清单。
 * @param layers - 已解码图层（按 manifest 顺序）。
 * @param openMouth - 张嘴素材；`null` = 没有张嘴层。
 * @param s - 运行时姿态。
 * @returns 按绘制顺序的姿态列表。
 */
export function computePoses(
  skin: SkinManifest,
  layers: readonly LoadedLayer[],
  openMouth: CanvasImageSource | null,
  s: RigState,
): LayerPose[] {
  const W = skin.canvas.w;
  const H = skin.canvas.h;
  const rig = skin.rig;
  const motion = rig.motion ?? {};
  const breathAmp = motion.breath ?? 0.011;
  const swayAmp = motion.sway ?? 0.008;
  const headTurn = motion.headTurn ?? 0;
  const gazeMax = motion.gazeMax ?? [6, 4.5];
  const headPivot = rig.headPivot ?? [W / 2, H / 2];

  // 呼吸：绕底部中心纵向缩放。
  const breathScale = 1 + Math.sin(s.breath) * breathAmp;
  // 挤压：压扁回弹（sx 反向放一点，保持体积感）。
  const jellyScale = 1 - s.jelly * 0.12;
  // 弹跳：整体上移。
  const hopDy = -Math.abs(Math.sin(s.hop * Math.PI)) * H * 0.04;

  const poses: LayerPose[] = [];
  for (const layer of layers) {
    let dx = hopDy;
    let dy = 0;
    let rot = 0;
    let sx = 1;
    let sy = 1;
    let alpha = 1;
    let pivotX = W / 2;
    let pivotY = H;

    // 呼吸 + 挤压：所有层绕底部中心缩放。
    sy *= breathScale * jellyScale;
    sx *= 1 + s.jelly * 0.06;

    // 头部组：绕 headPivot 摇摆 + 轻微转头。
    if (layer.group === 'head') {
      pivotX = headPivot[0];
      pivotY = headPivot[1];
      rot += Math.sin(s.sway) * swayAmp + (Math.sin(s.sway * 0.6) * (headTurn * Math.PI)) / 180;
    }

    // 眨眼：睫毛下移。
    if (layer.role.startsWith('eye.lash')) {
      dy += blinkOffset(skin, layer.role) * s.blink;
    }

    // 视线：虹膜平移。
    if (layer.role.startsWith('eye.iris')) {
      dx += s.gazeX * gazeMax[0];
      dy += s.gazeY * gazeMax[1];
    }

    // 尾巴：绕 tailPivot 摆动。
    if (layer.role === 'tail') {
      const tp = rig.tailPivot ?? [W / 2, H / 2];
      pivotX = tp[0];
      pivotY = tp[1];
      rot += s.tail * (rig.tailAmp ?? 0.13);
    }

    // 嘴：rest=closed 淡出基础嘴；rest=open 纵向压扁来「闭嘴」。
    if (layer.role === 'mouth' && rig.mouth) {
      if (rig.mouth.rest === 'closed') {
        alpha = 1 - s.mouth;
      } else {
        const min = rig.mouth.squashMin ?? 0.3;
        sy *= min + (1 - min) * s.mouth;
        rot += ((rig.mouth.squashRotation ?? 0) * (1 - s.mouth) * Math.PI) / 180;
      }
    }

    poses.push({ image: layer.image, pivotX, pivotY, dx, dy, rot, sx, sy, alpha });

    // 张嘴素材：紧接基础嘴层之后画（rest=closed 且配了 open 时）。
    if (layer.role === 'mouth' && openMouth !== null && rig.mouth?.rest === 'closed' && s.mouth > 0) {
      const mp = rig.mouth.openPivot ?? [pivotX, pivotY];
      const off = rig.mouth.openOffset ?? [0, 0];
      poses.push({
        image: openMouth,
        pivotX: mp[0],
        pivotY: mp[1],
        dx: dx + off[0],
        dy: dy + off[1],
        rot: rot + ((rig.mouth.openRotation ?? 0) * Math.PI) / 180,
        sx,
        sy,
        alpha: s.mouth,
      });
    }
  }
  return poses;
}

/** 应用一次变换并画一层。 */
function drawPose(ctx: CanvasRenderingContext2D, pose: LayerPose): void {
  if (pose.alpha <= 0.003) return;
  ctx.save();
  if (pose.alpha < 0.999) ctx.globalAlpha = pose.alpha;
  ctx.translate(pose.pivotX + pose.dx, pose.pivotY + pose.dy);
  if (pose.rot !== 0) ctx.rotate(pose.rot);
  if (pose.sx !== 1 || pose.sy !== 1) ctx.scale(pose.sx, pose.sy);
  ctx.translate(-pose.pivotX, -pose.pivotY);
  ctx.drawImage(pose.image, 0, 0);
  ctx.restore();
}

/** 按姿态列表画整帧。 */
export function drawPoses(ctx: CanvasRenderingContext2D, poses: readonly LayerPose[]): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const pose of poses) drawPose(ctx, pose);
}

/** 命中判定：画布坐标 → 命中区 id。 */
export function hitTest(skin: SkinManifest, x: number, y: number): string | undefined {
  for (const region of skin.interaction.regions ?? []) {
    if (region.shape.type === 'ellipse') {
      const nx = (x - region.shape.cx) / region.shape.rx;
      const ny = (y - region.shape.cy) / region.shape.ry;
      if (nx * nx + ny * ny <= 1) return region.id;
    } else {
      const r = region.shape;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return region.id;
    }
  }
  return undefined;
}
