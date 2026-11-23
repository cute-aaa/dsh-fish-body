/**
 * 桌面视频双缓冲「原子交接」的源码守卫：切动画时不能再闪一下。
 *
 * 为什么用源码断言而不是跑起来测：这是纯渲染时序问题（透明窗口上的 alpha 叠合 +
 * 首帧是否已提交 + 滤镜层被作废），在没有真实合成器的 node:test 里测不出来；
 * 而一旦有人把交叉淡化写回 CSS，或把 visibility 换回 opacity，只有源码能立刻报警。
 *
 * 三条不可退让的约定：
 *   1. helper 的 `video.pet-video` **不能**有 opacity（更不能有过渡）——窗口是透明的，
 *      两段半透明叠着会让不透明像素掉到 0.75（1−(1−0.5)²），观感就是「每次切动画暗一下」；
 *   2. 换台用 `visibility`：带 `filter` 的视频层只要 opacity 一变，Chromium 会整组滤镜重做，
 *      **整整一帧什么都画不出来**——用户看到的就是「切动作闪一下空白」（CDP 逐帧录屏实测：
 *      opacity 版每次换台掉一帧全空，visibility 版一帧不掉）；
 *   3. 新段必须先开播、等它真正出画后**同一帧**顶掉旧段；旧段在此之前一直亮着，不能露空洞。
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

test('helper 的 .pet-video 用 visibility 换台（opacity 会让滤镜层整帧消失）', () => {
  const css = readFileSync(HELPER + 'index.html', 'utf8');
  const body = ruleBody(css, 'video.pet-video');
  assert.ok(body.length > 0, '必须能定位到 video.pet-video 的样式块');
  assert.equal(/transition\s*:/.test(body), false, '桌面端不许给 .pet-video 加过渡：切动画会暗一下');
  assert.equal(/opacity\s*:/.test(body), false, '不许用 opacity 换台：滤镜层会整帧画不出来（闪空白）');
  assert.equal(/visibility\s*:\s*hidden/.test(body), true, '换台靠 visibility:hidden / visible');
  const front = ruleBody(css, 'video.pet-video.is-front');
  assert.equal(/visibility\s*:\s*visible/.test(front), true, '前台段必须是 visibility:visible');
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
