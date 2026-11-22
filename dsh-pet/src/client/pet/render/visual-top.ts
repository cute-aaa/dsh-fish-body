/**
 * 画布内容顶探测（浏览器侧入口）：实现在 `layered/probe.ts`，这里只转出。
 *
 * 为什么实现搬到 layered/ 下：桌面 Helper 的 `layered-core.js` 只打包 `render/layered/index.ts` 这一个入口，
 * 而它同样需要内容顶与包围盒两个探测。放在共享入口里 = 两端同一份实现（历史上这里是两份手抄件，
 * 一改一漏就会出现「网页端气泡贴头、桌面端盖脸」这种只在一边出现的偏差）。
 * @module dsh-fish-body/src/client/pet/render/visual-top
 */

export { measureVisualBox, measureVisualTopRatio, type CanvasBoxRatios, type VisualProbe } from './layered/probe.ts';
