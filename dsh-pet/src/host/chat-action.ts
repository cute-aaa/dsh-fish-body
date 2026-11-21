/**
 * 对话动作联动的纯逻辑：可表演的动作名单、注入提示词的指令、回复里动作标记的解析。
 *
 * 不做生成与落盘（归 ./chat 与 ./plugin/chat-memory），也不写 S；名单与 animations.categories 同源。
 * 与 ./anim 分开：那边回答「/anim 该不该播、播哪个」，这边只服务对话这一条触发路径。
 * @module dsh-fish-body/src/host/chat-action
 */

/**
 * 对话联动可用的动作：`animations.categories` 下全部动作（去重，保持配置顺序）。
 *
 * 与 animationNames 分开：待机 / 转向 / 拖拽 / 点击 / 移动 / 事件动画不参与对话联动。
 *
 * @param animations - 成品配置的 animations 段（形状非法 → 空名单）。
 * @returns 按配置顺序排列的动作名；没配 categories 时是空数组。
 */
export function chatActionNames(animations: unknown): string[] {
  const a = (animations && typeof animations === 'object' ? animations : {}) as Record<string, unknown>;
  if (!Array.isArray(a.categories)) return [];
  const out: string[] = [];
  for (const category of a.categories) {
    if (!category || typeof category !== 'object') continue;
    const actions = (category as { actions?: unknown }).actions;
    if (!Array.isArray(actions)) continue;
    for (const name of actions) {
      // 与 animationNames 同一口径：非字符串与空串一律丢弃
      if (typeof name !== 'string' || name === '') continue;
      if (!out.includes(name)) out.push(name);
    }
  }
  return out;
}

/**
 * 合并「webm 动作池」与「live2d 模型清单」两套可选动作名。
 *
 * 两套名字对 AI 是同一回事（都是「做一个动作」）；执行端按当前渲染方式各自解析——
 * webm 按动画名播文件，live2d 按 label 查 `motion:<组>:<序号>`（见 `render/live2d`）。
 * 重名只保留一个：同一个动作名让 AI 说两遍没有意义。
 *
 * @param animations - 成品配置的 animations 段。
 * @param live2dActions - live2d 清单里的动作 label（非 live2d 时为空）。
 * @returns 合并后的白名单；两套都空时为空数组（等于关闭）。
 */
export function chatActionList(animations: unknown, live2dActions: readonly string[] = []): string[] {
  const out = chatActionNames(animations);
  for (const name of live2dActions) {
    if (name !== '' && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * 动作指令：与配图指令并列附在 user 正文之后。
 *
 * 句式照配图那句写（省略主语、说「做」而不是「让宠物表演」）：模型自己就是宠物，旁白口吻它不会照做。
 *
 * @param names - 可表演的动作名（{@link chatActionNames} 的结果）；空名单由调用方直接跳过。
 */
export function actionInstruction(names: readonly string[]): string {
  return (
    '\n\n[动作] 回复结尾可选做一个动作给用户看，从下列清单里挑最贴合当前语境的：\n' +
    names.map((name) => '- ' + name).join('\n') +
    '\n挑中就在回复最后另起一行写 [动作:名称]（名称原样照抄）；没有合适的就完全不要写这个标记。'
  );
}

/**
 * 从模型回复里取动作（对话联动的解析半侧）。
 *
 * 所有动作标记都会被剥掉（无效名称也剥——标记不属于用户可见文本），只在命中白名单时采纳第一个。
 * 剥完没有正文时返回空串，由调用方决定不弹气泡。
 *
 * @param text - 模型回复原文。
 * @param names - 白名单（{@link chatActionList}）；空名单 = 开关关闭，标记照剥但不采纳。
 * @returns 剥掉标记后的正文，以及命中白名单的第一个动作名。
 */
export function extractChatAction(text: string, names: readonly string[]): { text: string; action?: string } {
  // 全局正则带 lastIndex，复用会漏匹配：每次新建一个。
  const tag = /\[动作[:：]\s*([^\]\n]+?)\s*\]/g;
  let action: string | undefined;
  let tagged = false;
  const cleaned = text.replace(tag, (_tag, raw: string) => {
    tagged = true;
    const name = raw.trim();
    if (action === undefined && names.includes(name)) action = name;
    return '';
  });
  if (!tagged) return { text };
  // 标记通常独占一行：剥完会留下空行，压掉它，否则气泡顶部多一截空白。
  const body = cleaned
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return action === undefined ? { text: body } : { text: body, action };
}

/**
 * 外观指令：与动作指令并列，但语义不同——外观是**挂着的状态**，不做动作。
 *
 * 明确写「同一回复可写多个、下次才覆盖」：执行端对人设这条路径是**覆盖整批**语义
 * （见 `render/live2d` 的 `replaceExpressions`），写成「一次只留一个」会让模型不敢表达组合。
 *
 * @param names - 可切换的外观名；空名单由调用方直接跳过。
 */
export function expressionInstruction(names: readonly string[]): string {
  return (
    '\n\n[外观] 需要换个样子给用户看时，从下列清单里挑最贴合当前语境的：\n' +
    names.map((name) => '- ' + name).join('\n') +
    '\n挑中就在回复最后另起一行写 [外观:名称]（名称原样照抄）。同一条回复可以写多个（会一起挂上），' +
    '但下一次换外观会把上一次挂的全部摘掉，所以别堆太多；不需要就完全不要写这个标记。'
  );
}

/**
 * 从模型回复里取外观（对话联动的解析半侧）。
 *
 * 与动作标记同一套规则：全部剥掉、只采纳白名单里的第一个。
 *
 * @param text - 模型回复原文（可已剥过动作）。
 * @param names - 白名单（{@link Live2dCatalog.expressions}）；空名单 = 开关关闭，标记照剥但不采纳。
 * @returns 剥掉标记后的正文，以及命中白名单的外观名（保持书写顺序、同名去重）。
 */
export function extractChatExpression(text: string, names: readonly string[]): { text: string; expressions: string[] } {
  const tag = /\[外观[:：]\s*([^\]\n]+?)\s*\]/g;
  const expressions: string[] = [];
  let tagged = false;
  const cleaned = text.replace(tag, (_tag, raw: string) => {
    tagged = true;
    const name = raw.trim();
    // 采纳**全部**命中项：外观是叠加状态，一条回复写两个就是要两个一起挂。
    if (names.includes(name) && !expressions.includes(name)) expressions.push(name);
    return '';
  });
  if (!tagged) return { text, expressions };
  const body = cleaned
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return { text: body, expressions };
}
