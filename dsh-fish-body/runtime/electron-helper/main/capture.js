'use strict';
/**
 * 截一帧屏幕：按物理像素取图 → 判黑图 → 缩到长边上限 → 编码成 JPEG。
 *
 * 为什么要判黑图：4K / 150% 缩放（以及某些虚拟显示器）下 `desktopCapturer` 的缩略图可能
 * 尺寸正确、内容全黑——不判就会把一张纯黑 JPEG 发给读图模型，白花一次钱还得到一句瞎话。
 * 判黑只在识屏链路开（chat 的截图链路不判：那里用户自己看得到预览，多一次全图扫描不值）。
 *
 * 必须始终成立：本模块不 require('electron')——deps 由调用方注入，因此能被 node:test
 * 直接加载（几何换算与黑图判定都是纯函数）。
 * @module dsh-fish-body/runtime/electron-helper/main/capture
 */

/** 黑图判定的采样网格边长：32×32 = 1024 个采样点，够用且几乎不花时间。 */
const BLACK_GRID = 32;

/** 单通道 ≤ 这个值算「黑」（约 #0c0c0c；深色桌面主题的底色也在这条线以下）。 */
const BLACK_LEVEL = 12;

/** 非黑采样点占比低于这个值就判黑图：正常桌面哪怕深色主题也有图标、文字、任务栏。 */
const BLACK_LIT_MIN_RATIO = 0.002;

/** 识屏用的长边上限（像素）：再大对读图模型只是白花 token。 */
const SCREEN_MAX_EDGE = 1280;

/** 识屏用的 JPEG 质量：0.7–0.8 之间对读图足够，体积一般压到 300 KB 以内。 */
const SCREEN_JPEG_QUALITY = 80;

/** 请求缩略图时的边长上限（Electron 在大尺寸下更不稳，与旧路径保持一致）。 */
const THUMB_MAX_EDGE = 4096;

/**
 * 等比缩到长边不超过 maxEdge。
 *
 * @param width - 原始宽（像素）。
 * @param height - 原始高（像素）。
 * @param maxEdge - 长边上限；≤0 / 非有限数时返回 null（= 不缩）。
 * @returns `{width, height}`（都 ≥1）或 null。
 */
function fitWithin(width, height, maxEdge) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const limit = Math.round(Number(maxEdge) || 0);
  if (!(limit > 0)) return null;
  const longest = Math.max(w, h);
  if (longest <= limit) return null;
  const scale = limit / longest;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * 这张图是不是「几乎全黑」。
 *
 * 采样而不是逐像素：4K 图有 800 万像素，逐点扫一遍要几十毫秒，而 32×32 网格已经足够
 * 表达「有没有内容」。判据是**非黑**采样点的占比——纯黑遮罩下这个占比接近 0，
 * 深色桌面也远高于阈值。
 *
 * @param image - 任何带 `getSize()` 与 `toBitmap()`（BGRA）的对象（Electron NativeImage 即可）。
 * @returns true = 判黑图。
 */
function isMostlyBlack(image) {
  if (!image || typeof image.getSize !== 'function' || typeof image.toBitmap !== 'function') return false;
  const { width, height } = image.getSize();
  if (!(width > 0) || !(height > 0)) return true;
  const bitmap = image.toBitmap();
  if (!bitmap || bitmap.length < 4) return true;
  let lit = 0;
  let total = 0;
  const stepX = Math.max(1, Math.floor(width / BLACK_GRID));
  const stepY = Math.max(1, Math.floor(height / BLACK_GRID));
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      // BGRA：跳过第 3 个字节（alpha 在透明窗场景下不可靠，判黑只看三通道）
      const i = (y * width + x) * 4;
      if (i + 2 >= bitmap.length) continue;
      total += 1;
      if (bitmap[i] > BLACK_LEVEL || bitmap[i + 1] > BLACK_LEVEL || bitmap[i + 2] > BLACK_LEVEL) lit += 1;
    }
  }
  if (total === 0) return true;
  return lit / total < BLACK_LIT_MIN_RATIO;
}

/**
 * 取一帧屏幕并编码。
 *
 * @param deps.screen - Electron `screen`。
 * @param deps.desktopCapturer - Electron `desktopCapturer`。
 * @param deps.win - 宠物窗口（决定取哪块屏；缺省取主屏）。
 * @param deps.maxEdge - 长边上限（像素）；缺省不缩。
 * @param deps.quality - JPEG 质量 1–100（缺省 85）。
 * @param deps.checkBlack - 是否做黑图判定（缺省 false）。
 * @returns `{mediaType, data, width, height, bytes, scaleFactor, black}`；取不到画面时 null。
 */
async function grabScreen(deps) {
  const { screen, desktopCapturer, win } = deps || {};
  if (!screen || !desktopCapturer) return null;
  const display =
    win && typeof win.isDestroyed === 'function' && !win.isDestroyed()
      ? screen.getDisplayMatching(win.getBounds())
      : screen.getPrimaryDisplay();
  const scale = display.scaleFactor || 1;
  const maxEdge = Number.isFinite(deps.maxEdge) ? Math.min(THUMB_MAX_EDGE, Math.max(0, deps.maxEdge)) : undefined;
  const size = {
    width: Math.max(1, Math.min(THUMB_MAX_EDGE, Math.round(display.size.width * scale))),
    height: Math.max(1, Math.min(THUMB_MAX_EDGE, Math.round(display.size.height * scale))),
  };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  // display_id 是字符串；取不到对应屏时退回第一块，总比「点了没反应」好
  const source = sources.find((item) => String(item.display_id) === String(display.id)) ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) return null;
  const black = deps.checkBlack === true ? isMostlyBlack(source.thumbnail) : false;
  let image = source.thumbnail;
  const fit = maxEdge === undefined ? null : fitWithin(image.getSize().width, image.getSize().height, maxEdge);
  if (fit) image = image.resize({ width: fit.width, height: fit.height, quality: 'good' });
  const jpeg = image.toJPEG(Number.isFinite(deps.quality) ? Math.min(100, Math.max(1, deps.quality)) : 85);
  const encoded = image.getSize();
  return {
    mediaType: 'image/jpeg',
    data: jpeg.toString('base64'),
    width: encoded.width,
    height: encoded.height,
    bytes: jpeg.length,
    scaleFactor: scale,
    black,
  };
}

module.exports = {
  BLACK_GRID,
  BLACK_LEVEL,
  BLACK_LIT_MIN_RATIO,
  SCREEN_JPEG_QUALITY,
  SCREEN_MAX_EDGE,
  THUMB_MAX_EDGE,
  fitWithin,
  grabScreen,
  isMostlyBlack,
};
