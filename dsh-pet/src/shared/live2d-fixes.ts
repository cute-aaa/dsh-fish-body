/**
 * 逐模型的 live2d 渲染修正表：某些模型把「遮罩源」也当成可见图层画出来（DeepSeek 公皮鼻梁上那块
 * 黑方块），或者带上 VTube Studio 专用的开关图层。这里按模型文件名登记要「不画」的 drawable 序号。
 *
 * 用 drawable 序号而不是部件名：部件不透明度会连带遮罩一起失效（遮罩按源图 alpha 裁切），
 * 而 `getDrawableOpacity` 只影响可见绘制，遮罩绘制时会被忽略——所以只压这一个访问器。
 * 表按模型文件名索引，换模型不受影响；同一文件被替换后序号可能漂移，届时删掉对应条目即可。
 * @module dsh-pet/src/shared/live2d-fixes
 */

/** 模型文件名（`.model3.json`） → 不参与可见绘制的 drawable 序号。 */
const HIDDEN_DRAWABLES: Readonly<Record<string, readonly number[]>> = {
  // 大肥鱼公皮的「鼻子」部件里有两块纯黑遮罩源（序号 513/514，见 texture_00 里的黑色圆角条），
  // 它们同时是 5 个图层的裁切形状：不画它们，鼻子剩下的细线与遮罩都还在。
  '大肥鱼.model3.json': [513, 514],
};

/**
 * 取某个模型不需要可见绘制的 drawable 序号。
 *
 * @param modelFile - `.model3.json` 的文件名或相对路径（只比较最后一段）。
 * @returns 序号列表；没有修正项时返回空数组。
 */
export function hiddenDrawableIndexesOf(modelFile: string): readonly number[] {
  const name = modelFile.slice(modelFile.lastIndexOf('/') + 1);
  return HIDDEN_DRAWABLES[name] ?? [];
}
