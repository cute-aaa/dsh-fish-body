/**
 * 桌面视频双缓冲「原子交接」的源码守卫：切动画时不能再闪一下。
 *
 * 为什么用源码断言而不是跑起来测：这是纯渲染时序问题（透明窗口上的 alpha 叠合 +
 * 首帧是否已提交），在没有真实合成器的 node:test 里测不出来；而一旦有人把
 * 交叉淡化写回 CSS 或把交接改回「先换 front 再 play」，只有源码能立刻报警。
 *
 * 两条不可退让的约定：
 *   1. helper 的 `video.pet-video` **不能**有 opacity 过渡——窗口是透明的，两段半透明视频
 *      叠着合成会让不透明像素掉到 0.75（1−(1−0.5)²），观感就是「每次切动画暗一下」。
 *   2. 新段必须先开播、等它真正出画后**同一帧**顶掉旧段；旧段在此之前一直亮着，不能露空洞。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HELPER = fileURLToPath(new URL('../../runtime/electron-helper/', import.meta.url));

/**
 * 取 CSS 里某条规则的声明块。
 *
 * @param {string} css - 样式表全文。
 * @param {string} selector - 选择器（按 `selector {` 精确匹配）。
 * @returns {string} 花括号里的内容；找不到时返回空串。
 */
function ruleBody(css, selector) {
  const at = css.indexOf(selector + ' {');
  if (at < 0) return '';
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return open < 0 || close < 0 ? '' : css.slice(open + 1, close);
}

test('helper 的 .pet-video 不能有 opacity 过渡（透明窗口上叠合会掉 alpha）', () => {
  const css = readFileSync(HELPER + 'index.html', 'utf8');
  const body = ruleBody(css, 'video.pet-video');
  assert.ok(body.length > 0, '必须能定位到 video.pet-video 的样式块');
  assert.equal(/transition\s*:/.test(body), false, '桌面端不许给 .pet-video 加过渡：切动画会暗一下');
  assert.equal(/opacity\s*:/.test(body), true, 'opacity:0 / .is-front opacity:1 的离散切换必须保留');
});

test('换源必须先开播、再在帧回调里同一帧交接 front', () => {
  const source = readFileSync(HELPER + 'sprite/playback.js', 'utf8');
  // 先开播：el.play() 必须出现在交接函数之前
  const playAt = source.indexOf('const started = el.play();');
  const handoffAt = source.indexOf('const handoff = () => {');
  assert.ok(playAt > 0, '必须有「先 play 再交接」的那一行');
  assert.ok(handoffAt > playAt, 'play() 必须在 handoff 之前，否则会露一帧空白');
  // 帧回调 + 定时器兜底同时在
  assert.match(source, /requestVideoFrameCallback\(\(\) => handoff\(\)\)/, '要用帧回调当交接时机');
  assert.match(source, /setTimeout\(handoff, HANDOFF_FALLBACK_MS\)/, '帧回调不触发时要有兜底');
  // 交接里才是换 front 的地方
  const handoffBody = source.slice(handoffAt, source.indexOf('started', handoffAt));
  assert.match(handoffBody, /classList\.add\('is-front'\)/, '交接时才给新段加 is-front');
  assert.match(handoffBody, /classList\.remove\('is-front'\)/, '同一帧撤掉旧段的 is-front');
});

test('动作音排期不能挤在换源那一帧', () => {
  const source = readFileSync(HELPER + 'sprite/playback.js', 'utf8');
  assert.match(source, /queueAnimSfx\(next\)/, 'switchTo 必须走延后版本的动作音排期');
  const switchAt = source.indexOf('switchTo(next, nextOnce, playbackId, url) {');
  const head = source.slice(switchAt, switchAt + 1200);
  assert.equal(/this\.playAnimSfx\(/.test(head), false, 'switchTo 顶部不许再同步排动作音（会拖慢交接帧）');
});
