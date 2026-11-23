/**
 * 对话表演联动的纯逻辑：可表演的动作名单、注入提示词的指令、回复里标记的解析，
 * 以及「用户点名就直接执行」的确定性兜底。
 *
 * 设计目的是让角色**自由**使用外观与动作，所以标记语法比「一个名字」宽：
 * 一次写多个（`、`）、叠加（`+`）、摘单个（`-`）、整批摘光（`摘掉`）、临时挂几秒（`|20s`），
 * 全部在这一个模块解析完，执行端只拿一份 {@link ExpressionIntent}。
 * 解析一律容错（精确名优先 → 核心词归一），但对不上白名单就**不猜**：宁可不动，也不要戴错一个。
 *
 * 不做生成与落盘（归 ./chat 与 ./plugin/chat-memory），也不写 S。
 * 与 ./anim 分开：那边回答「/anim 该不该播、播哪个」，这边只服务对话这一条触发路径。
 * @module dsh-fish-body/src/host/chat-action
 */

/**
 * 一份「要改哪些外观」的意图：解析的产物，执行端据此算出最终那批。
 *
 * 四条改法互相独立：`reset`（整批摘光）> `remove`（摘单个）> `names`（挂上，`additive` 决定是叠加还是替换）。
 */
export interface ExpressionIntent {
  /** 要挂上的外观名（已对到白名单，保持书写顺序、去重）。 */
  readonly names: readonly string[];
  /** 要单独摘掉的外观名（`[外观:-兔牙]`、用户说「把眼镜摘了」）——核心词命中时是该组的全部成员。 */
  readonly remove: readonly string[];
  /** 整批摘光（`[外观:摘掉]`、用户说「都摘了」）。 */
  readonly reset: boolean;
  /** 叠加语义：加到当前挂着的那批之上而不是替换（`[外观:+兔牙]`、用户说「顺便再戴个兔牙」）。 */
  readonly additive: boolean;
  /** 临时挂多久（ms）；缺省 = 一直挂着，直到下一次换外观。 */
  readonly ttlMs?: number;
}

/** 空意图：这句里什么都没提到。 */
const NO_INTENT: ExpressionIntent = { names: [], remove: [], reset: false, additive: false };

/** 一次标记/一句话里最多认几个外观：再多是堆叠，不是表达。 */
const MAX_NAMES = 6;

/** 临时外观的缺省时长（ms）：说「临时」「戴一下」但没给秒数时用它。 */
const DEFAULT_TTL_MS = 30_000;

/** 临时外观时长的上下界（ms）：太长等于永久（不如不写），太短看不见。 */
const MIN_TTL_MS = 1_000;
const MAX_TTL_MS = 600_000;

/** 名字分隔符：一次写多个时用它隔开。`|` 不在此列——那是临时时长的分隔符。 */
const NAME_SEP = /[、,，;；/／+＋\s]+/;

/** 整段就是「摘光」的说法。 */
const RESET_WORD =
  /^(摘掉|摘光|摘了|脱掉|全部摘掉|摘掉全部|摘掉所有|全都摘掉|都不要|清空|恢复默认外观|默认|无|空|reset|none|-)$/i;

/** 名字前缀：`+` = 叠加到当前之上，`-` = 只摘这一个。 */
const ADD_PREFIX = /^[+＋]\s*/;
const REMOVE_PREFIX = /^[-－]\s*/;

/** `[外观:摘眼镜]` 这种「动词 + 名字」的写法：整段按摘除处理。 */
const VERB_REMOVE = /^(摘掉?|脱掉?|去掉|取下|拿掉|不要)/;

/** 时长后缀里的「临时」同义词。 */
const TEMP_WORD = /^(临时|暂时|temporary|temp)$/i;

/** 否定/摘除动词：句子里出现就按「摘掉点名的那些」理解，不按「戴上」理解。 */
const NEGATION = /不要|不用|别|甭|摘|脱|去掉|取下|拿掉/;

/**
 * 动作的否定词：只认「别做 / 不要做」这类。
 *
 * 刻意比 {@link NEGATION} 窄：那里为了外观收集了摘 / 脱 / 取下，而动作名自己就带这些字
 * （「脱捕」是最典型的——用外观那套口径会让它永远播不出来）。
 */
const ACTION_NEGATION = /不要|不用|别|甭|不许|停止|取消/;

/** 整批摘光（用户原话）。 */
const CLEAR_ALL = /(摘光|全部摘|都摘|全摘|清空外观|恢复默认外观)/;

/** 叠加语义（用户原话）：「顺便再戴一个」「再加个尾巴」。 */
const ADD_HINT = /再加|再戴|再挂|又戴|还要|顺便|另外/;

/** 用户原话里的显式时长：`戴 20 秒`。 */
const TTL_IN_TEXT = /(\d+(?:\.\d+)?)\s*(?:ms|毫秒|s\b|秒|min|分钟|m\b)/i;

/** 用户原话里的「临时」语义（没说秒数时用缺省时长）。 */
const TEMP_IN_TEXT = /临时|暂时|一会儿|一下就摘|只戴/;

/**
 * 把一个标记里的名字对到白名单上（先精确、再包含式）。
 *
 * 为什么容错：模型常把「单片眼镜」写成「眼镜」、「抬手打招呼」写成「抬手」。精确匹配下这些
 * 都会被剥掉且不采纳——用户看到的是「它明明说要戴，却没戴」。包含式匹配只在唯一命中时采纳，
 * 命中多个就不猜（宁可不动，也不要戴错一个）。
 *
 * @param raw - 标记里写下的名字（已 trim）。
 * @param names - 白名单。
 * @returns 白名单里的规范名；对不上或命中多个时返回 undefined。
 */
function matchName(raw: string, names: readonly string[]): string | undefined {
  if (raw === '') return undefined;
  const exact = names.find((name) => name === raw);
  if (exact !== undefined) return exact;
  const fuzzy = names.filter((name) => name.includes(raw) || raw.includes(name));
  return fuzzy.length === 1 ? fuzzy[0] : undefined;
}

/**
 * 外观名的核心词：中文名取去掉常见修饰前缀后的片段（「单片眼镜」→「眼镜」）。
 *
 * 核心词只用于「用户说了简称」这一种情况，并且按核心词分组——同一组只认一个，
 * 否则用户说「眼镜」会把单片眼镜与黑框眼镜一起挂上，看起来像 bug。
 *
 * @param name - 白名单里的外观名。
 * @returns 用于匹配的核心词；没有可用片段时返回空串（调用方回落成整个名字）。
 */
function coreWordOf(name: string): string {
  const stripped = name.replace(/^(单片|黑框|红色|蓝色|白色|小|大)/, '');
  return stripped !== name && stripped.length >= 2 ? stripped : '';
}

/** 去重并保持首次出现的顺序。 */
function dedupe(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of list) if (!out.includes(item)) out.push(item);
  return out;
}

/**
 * 解析标记里的时长后缀（`[外观:兔牙|20s]`）。
 *
 * @param raw - `|` 之后那一段。
 * @returns 夹到 [{@link MIN_TTL_MS}, {@link MAX_TTL_MS}] 的毫秒数；不是时长写法时 undefined。
 */
function ttlOf(raw: string): number | undefined {
  const text = raw.trim();
  if (text === '') return undefined;
  if (TEMP_WORD.test(text)) return DEFAULT_TTL_MS;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|毫秒|s|秒|m|min|分|分钟)?$/i.exec(text);
  if (m === null) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const unit = (m[2] ?? 's').toLowerCase();
  const ms = unit === 'ms' || unit === '毫秒' ? n : unit === 's' || unit === '秒' ? n * 1000 : n * 60_000;
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, Math.round(ms)));
}

/**
 * 把一段名字文本拆成「挂上 / 摘掉」两组（`+` / `-` 前缀与「摘眼镜」这类动词写法）。
 *
 * 连词（和 / 与 / 跟）只在整段对不上任何名字时才拆一次：名字里本来就可能带这些字。
 *
 * @param raw - 标记体（已去掉时长后缀与首个 `+` 前缀）。
 * @param names - 白名单。
 * @param verbRemove - 整段是否已判定为「摘除」写法。
 * @returns 两组规范名（各去重、各限 {@link MAX_NAMES} 个）。
 */
function namesOf(raw: string, names: readonly string[], verbRemove: boolean): { names: string[]; remove: string[] } {
  const keep: string[] = [];
  const drop: string[] = [];
  for (const part of raw.split(NAME_SEP)) {
    let text = part.trim();
    if (text === '') continue;
    let isRemove = verbRemove;
    if (REMOVE_PREFIX.test(text)) {
      isRemove = true;
      text = text.replace(REMOVE_PREFIX, '');
    }
    if (ADD_PREFIX.test(text)) text = text.replace(ADD_PREFIX, '');
    if (text === '') continue;
    const hit = matchName(text, names);
    if (hit !== undefined) {
      (isRemove ? drop : keep).push(hit);
      continue;
    }
    // 整段对不上再按连词拆：「兔牙和单片眼镜」这类写法模型真的会写。
    for (const piece of text.split(/[和与跟]/)) {
      const one = matchName(piece.trim(), names);
      if (one !== undefined) (isRemove ? drop : keep).push(one);
    }
  }
  return { names: dedupe(keep).slice(0, MAX_NAMES), remove: dedupe(drop).slice(0, MAX_NAMES) };
}

/**
 * 解析一个 `[外观:…]` 标记体。
 *
 * 语法（全部可选、可组合）：
 * - `名称` 换一批（上次挂的整批摘掉）；`名称、名称` 一次挂多个；
 * - `+名称` 叠加到当前之上；`-名称` 只摘这一个；`摘掉` 整批摘光；
 * - `|20s` / `|2min` / `|临时` 临时挂一段，到点自动摘掉。
 *
 * @param raw - 标记体原文（`[外观:` 与 `]` 之间）。
 * @param names - 白名单。
 * @returns 意图；什么都没写时是 {@link NO_INTENT}。
 */
export function parseExpressionTag(raw: string, names: readonly string[]): ExpressionIntent {
  let body = raw.trim();
  if (body === '') return NO_INTENT;
  // 时长写在最后一段 `|` 之后：先摘掉它，剩下的才是名字——名字里带 `|` 的情况不存在。
  let ttlMs: number | undefined;
  const bar = body.lastIndexOf('|');
  if (bar >= 0) {
    const ttl = ttlOf(body.slice(bar + 1));
    if (ttl !== undefined) {
      ttlMs = ttl;
      body = body.slice(0, bar).trim();
    }
  }
  const withTtl = (intent: ExpressionIntent): ExpressionIntent => (ttlMs === undefined ? intent : { ...intent, ttlMs });
  let additive = false;
  if (ADD_PREFIX.test(body)) {
    additive = true;
    body = body.replace(ADD_PREFIX, '').trim();
  }
  if (RESET_WORD.test(body)) return withTtl({ names: [], remove: [], reset: true, additive: false });
  const verbRemove = VERB_REMOVE.test(body);
  // 「摘眼镜」这类动词写法：先把动词剥掉再对名字，否则整段永远对不上白名单。
  if (verbRemove) body = body.replace(VERB_REMOVE, '').trim();
  const { names: keep, remove } = namesOf(body, names, verbRemove);
  if (keep.length === 0 && remove.length === 0) return NO_INTENT;
  return withTtl({ names: keep, remove, reset: false, additive });
}

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
    '\n挑中就在回复最后另起一行写 [动作:名称]，名称原样照抄清单里的写法；' +
    '用户点名要动作时更要写。一次只做一个动作（同一个标记重复写没有意义）。' +
    '没有合适的就完全不要写这个标记。'
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
    const hit = matchName(name, names) ?? actionFromList(name, names);
    if (action === undefined && hit !== undefined) action = hit;
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
 * 动作名的核心词匹配：去掉「打开 / 关闭 / 一次」这类尾巴再比一次。
 *
 * 用户的说法通常比清单短（「抚胸手」vs「抚胸手打开」），精确匹配会一律落空。
 *
 * @param raw - 要匹配的片段。
 * @param names - 白名单。
 * @returns 唯一命中的规范名；命中多个或不命中时 undefined。
 */
function actionFromList(raw: string, names: readonly string[]): string | undefined {
  const text = raw.trim();
  if (text === '') return undefined;
  const hits = names.filter((name) => {
    const core = name.replace(/(打开|关闭|开始|结束|一次|一下)$/u, '');
    return (core !== name && core.length >= 2 && (core === text || text.includes(core))) || text.includes(name);
  });
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * 从**用户这句话**里认出点名要做的动作（确定性兜底）。
 *
 * 与外观兜底同因：模型经常嘴上说「我给你比个心」却不写标记。用户点名动作时这本来就是指令。
 * 动作是瞬时事件，一次只做一个——多选没有意义（同时两条动作会互相顶掉）。
 *
 * @param text - 用户输入原文。
 * @param names - 当前可表演的动作白名单。
 * @returns 命中的动作名；没有点名、或句子里是否定式时 undefined。
 */
export function actionFromText(text: string, names: readonly string[]): string | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (ACTION_NEGATION.test(trimmed)) return undefined;
  const exact = names.find((name) => trimmed.includes(name));
  if (exact !== undefined) return exact;
  return actionFromList(trimmed, names);
}

/**
 * 外观指令：与动作指令并列，但语义不同——外观是**挂着的状态**，不做动作。
 *
 * 语法在这里讲全（多写、叠加、只摘一个、整批摘光、临时），因为模型只会照抄提示词里的例子：
 * 只写「可以写多个」时它仍然一次只写一个。
 *
 * @param names - 可切换的外观名；空名单由调用方直接跳过。
 */
export function expressionInstruction(names: readonly string[]): string {
  return (
    '\n\n[外观] 外观是你身上挂着的配件/样子（眼镜、兔牙、尾巴…），不是动作：挂上就一直有效，' +
    '直到你换下一批。可用的外观：\n' +
    names.map((name) => '- ' + name).join('\n') +
    '\n回复最后另起一行写标记，写法可以组合（名称原样照抄清单，别缩写）：\n' +
    '- [外观:名称] 换成这一批（上次挂的整批摘掉）\n' +
    '- [外观:名称、名称] 一次挂多个\n' +
    '- [外观:+名称] 在当前挂着的之上再加一个\n' +
    '- [外观:-名称] 只摘掉这一个\n' +
    '- [外观:摘掉] 整批摘光\n' +
    '- [外观:名称|20s] 只挂 20 秒（`临时` 也行），到点自动摘掉——想臭美一下就摘时用它\n' +
    '用户提到换样子时**必须**写；用户没提、也没这个必要就不要写。'
  );
}

/**
 * 当前状态那一小段：把「你现在挂着的」如实告诉角色。
 *
 * 为什么要有：角色自己换过外观之后，下一轮它只能从历史里翻 `[外观:…]` 去猜现在挂着什么；
 * 「摘掉刚才那个」「再戴一个」这类话没有真值就只能瞎编。这一段的来源是渲染端上报的真实状态
 * （见 host/appearance 与 POST /appearance/report），不是宿主自己的猜测。
 *
 * @param worn - 当前挂着的外观名与上一段动作名（都可能是空）。
 * @returns 注入 system/user 的一段；两者都空时只说明「什么都没挂」。
 */
export function currentStateInstruction(worn: { expressions?: readonly string[]; action?: string }): string {
  const list = (worn.expressions ?? []).filter((name) => name !== '');
  const lines: string[] = [
    list.length === 0 ? '你现在什么都没戴（外观是空的）。' : '你现在挂着的外观：' + list.join('、') + '。',
  ];
  const action = worn.action ?? '';
  if (action !== '') lines.push('你上一段做的动作是「' + action + '」。');
  lines.push('要换就直接写标记，不用先问用户。');
  return '\n\n[当前] ' + lines.join('');
}

/**
 * 用户原话里点到名的外观（否定/摘除语境用：命中的是要**摘掉**的那些）。
 *
 * 精确名命中就是它本身；核心词命中则整组都算（说「把眼镜摘了」时，单片眼镜与黑框眼镜都该摘）。
 *
 * @param text - 用户输入原文。
 * @param names - 当前模型的外观白名单。
 * @returns 要摘掉的外观名（按白名单顺序）。
 */
function removableNames(text: string, names: readonly string[]): string[] {
  const out: string[] = [];
  const exact = names.filter((name) => text.includes(name));
  if (exact.length > 0) return exact;
  for (const name of names) {
    const core = coreWordOf(name);
    if (core !== '' && text.includes(core)) out.push(name);
  }
  return out;
}

/**
 * 从**用户这句话**里认出要点名的外观（确定性兜底）。
 *
 * 为什么需要它：模型经常嘴上说「眼镜戴上了」却不写 `[外观:…]` 标记。用户明确点了名时，
 * 这就是一条指令而不是需要模型转述的愿望，所以 host 直接按白名单匹配——比反复调提示词可靠。
 *
 * 几条口径（都是踩过的坑）：
 * - 精确名优先：用户写了「单片眼镜」就只认它，不再用核心词扩散；
 * - 核心词按组认，同组只取第一个：否则「眼镜」会同时挂上单片眼镜与黑框眼镜；
 * - 否定/摘除动词（别、摘、去掉）→ 结算成 `remove` / `reset`，不结算成「戴上」；
 * - `临时` / `戴一下` / `N 秒` → 带 ttl，到点自动摘掉。
 *
 * @param text - 用户输入原文。
 * @param names - 当前模型的外观白名单。
 * @returns 意图；什么都没提到时是 {@link NO_INTENT}。
 */
export function expressionsFromText(text: string, names: readonly string[]): ExpressionIntent {
  const trimmed = text.trim();
  if (trimmed === '') return NO_INTENT;
  const seconds = TTL_IN_TEXT.exec(trimmed);
  const ttlMs =
    seconds !== null
      ? Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, Math.round(Number(seconds[1]) * 1000)))
      : TEMP_IN_TEXT.test(trimmed)
        ? DEFAULT_TTL_MS
        : undefined;
  const base = ttlMs === undefined ? {} : { ttlMs };
  if (CLEAR_ALL.test(trimmed)) return { names: [], remove: [], reset: true, additive: false, ...base };
  const negated = NEGATION.test(trimmed);
  if (negated) {
    const remove = removableNames(trimmed, names);
    return remove.length === 0
      ? NO_INTENT
      : { names: [], remove: remove.slice(0, MAX_NAMES), reset: false, additive: false, ...base };
  }
  const additive = ADD_HINT.test(trimmed);
  // 精确名与核心词**并集**：精确命中的优先（用户写了全名就只认它），核心词只补那些
  // 「整组都没有精确命中」的组——同组只取白名单里第一个，避免「眼镜」把单片眼镜与黑框眼镜一起挂上。
  const exact = new Set(names.filter((name) => trimmed.includes(name)));
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const core = coreWordOf(name) || name;
    if (exact.has(name)) {
      seen.add(core);
      picked.push(name);
      continue;
    }
    if (picked.length >= MAX_NAMES) break;
    if (seen.has(core) || core.length < 2 || !trimmed.includes(core)) continue;
    // 这一组已有精确命中：不再用核心词扩散（「戴单片眼镜」不该顺带挂上黑框眼镜）。
    if ([...exact].some((hit) => (coreWordOf(hit) || hit) === core)) continue;
    seen.add(core);
    picked.push(name);
  }
  return { names: picked.slice(0, MAX_NAMES), remove: [], reset: false, additive, ...base };
}

/**
 * 把意图结算成「最终挂着的那批」。
 *
 * 结算在 host 侧而不是渲染端：叠加（`+`）与摘单个（`-`）都要知道当前挂着什么，而渲染端只知道画面、
 * 不知道意图；host 拿到上报的真值后就地把结果算成完整的一批，渲染端只负责「换成这一批」。
 * 一条规则一句话：`reset` 先清空 → 非叠加且有名字则整批替换 → 逐个挂上 → 最后摘掉点名的。
 *
 * @param current - 此刻实际挂着的外观名（渲染端上报的真值；没上报过就是空）。
 * @param intent - 这一轮解析出来的意图。
 * @returns 结算后的完整名单（去重、限 {@link MAX_NAMES} 个）。
 */
export function mergeExpressionsIntent(current: readonly string[], intent: ExpressionIntent): string[] {
  const out: string[] = intent.reset ? [] : [...current];
  if (!intent.reset && intent.names.length > 0 && !intent.additive) out.length = 0;
  for (const name of intent.names) if (!out.includes(name)) out.push(name);
  return out.filter((name) => !intent.remove.includes(name)).slice(0, MAX_NAMES);
}

/**
 * 从模型回复里取外观（对话联动的解析半侧）。
 *
 * 与动作标记同一套规则：全部剥掉；但**采纳全部**命中项（外观是可叠加状态，一条回复写几个
 * 就是要几个一起挂）。每条标记各自解析（各自的 `+` / `-` / 时长），最后合成一份意图：
 * 名字与摘除项取并集，`reset` 与 `additive` 取「有即真」，时长取最后写明的那个。
 *
 * @param text - 模型回复原文（可已剥过动作）。
 * @param names - 白名单（{@link Live2dCatalog.expressions}）；空名单 = 开关关闭，标记照剥但不采纳。
 * @returns 剥掉标记后的正文，以及命中的外观意图。
 */
export function extractChatExpression(
  text: string,
  names: readonly string[],
): { text: string; intent: ExpressionIntent } {
  const tag = /\[外观[:：]\s*([^\]\n]+?)\s*\]/g;
  const keep: string[] = [];
  const drop: string[] = [];
  let reset = false;
  let additive = false;
  let ttlMs: number | undefined;
  let tagged = false;
  const cleaned = text.replace(tag, (_tag, raw: string) => {
    tagged = true;
    const one = parseExpressionTag(raw, names);
    if (one.reset) reset = true;
    if (one.additive) additive = true;
    if (one.ttlMs !== undefined) ttlMs = one.ttlMs;
    for (const name of one.names) if (!keep.includes(name)) keep.push(name);
    for (const name of one.remove) if (!drop.includes(name)) drop.push(name);
    return '';
  });
  if (!tagged) return { text, intent: NO_INTENT };
  const body = cleaned
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (!reset && keep.length === 0 && drop.length === 0) return { text: body, intent: NO_INTENT };
  return {
    text: body,
    intent: {
      names: keep.slice(0, MAX_NAMES),
      remove: drop.slice(0, MAX_NAMES),
      reset,
      additive,
      ...(ttlMs === undefined ? {} : { ttlMs }),
    },
  };
}
