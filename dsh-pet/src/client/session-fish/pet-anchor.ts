/**
 * 桌宠锚点：从 DOM 读桌宠当前占的位置，供会话鱼围绕它排布。
 *
 * 为什么读 DOM 而不是订阅状态：桌宠的位置有四个写入方（角落 CSS、拖拽、走位 rAF、抛掷积分），
 * 只有 `getBoundingClientRect()` 一次性覆盖全部四者；经状态转发的话每加一条运动路径都要再补一次。
 * 每帧调用一次，量的是舞台盒（含 `translateY(bottomPad)`），所以脚底与头顶都对得上。
 * 必须始终成立：找不到桌宠（未挂载 / `display` 不含 web / 桌面模式的另一个窗口）时返回 null，
 * 由调用方退回右下角排布——绝不猜一个坐标。
 * @module dsh-pet/src/client/session-fish/pet-anchor
 */

/** 一段视口矩形（px）。 */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** 桌宠锚点：舞台中心、尺寸与「鱼不该压上去的那块身体」。 */
export interface PetAnchor {
  /** 舞台中心 x（px）。 */
  readonly cx: number;
  /** 舞台中心 y（px）。 */
  readonly cy: number;
  /** 舞台宽（px）。 */
  readonly w: number;
  /** 舞台高（px，16:9）。 */
  readonly h: number;
  /** 身体盒：舞台矩形按固定比例内缩（左右各让 15%，上 10%、下 12%）。 */
  readonly body: Rect;
}

/** 桌宠根节点选择器（`client/pet/card/view.ts` 的类名）。 */
const PET_ROOT_SELECTOR = '.dsh-pet-root';
/** 桌宠舞台选择器：位移与尺寸都挂在它身上。 */
const PET_STAGE_SELECTOR = '.dsh-pet-stage';
/** 身体盒的内缩比例：左右透明边 + 头顶留白，碰撞按这块算。 */
const BODY_INSET = { x: 0.15, top: 0.1, bottom: 0.12 } as const;

/** 缓存的舞台节点：DOM 每帧查一次成本不低，桌宠通常整页只卸载一次。 */
let cachedStage: Element | null = null;

/**
 * 清掉节点缓存（测试与「桌宠重挂」后用）。
 */
export function resetPetAnchorCache(): void {
  cachedStage = null;
}

/**
 * 读桌宠锚点。
 *
 * @param doc - 文档对象（默认 `document`；测试可注入假文档）。
 * @returns 锚点；页面上没有桌宠或它还没布局时 null。
 */
export function readPetAnchor(doc: Document | undefined = globalThis.document): PetAnchor | null {
  if (!doc) return null;
  let stage = cachedStage;
  if (stage === null || !stage.isConnected) {
    const root = doc.querySelector(PET_ROOT_SELECTOR);
    stage = root === null ? null : root.querySelector(PET_STAGE_SELECTOR);
    cachedStage = stage;
  }
  if (stage === null) return null;
  const rect = stage.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const insetX = rect.width * BODY_INSET.x;
  return {
    cx: rect.left + rect.width / 2,
    cy: rect.top + rect.height / 2,
    w: rect.width,
    h: rect.height,
    body: {
      left: rect.left + insetX,
      top: rect.top + rect.height * BODY_INSET.top,
      right: rect.right - insetX,
      bottom: rect.bottom - rect.height * BODY_INSET.bottom,
    },
  };
}
