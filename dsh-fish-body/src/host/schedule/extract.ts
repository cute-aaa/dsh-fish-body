/**
 * 作息文本 → 结构化时段：只认「人明确写出来的时刻」，不做任何语义推断。
 *
 * 为什么要这一层：真实 soul 项目的作息形态千差万别——每日闹钟（`daily HH:MM`）、
 * 驱动力 + 下次触发（`nextFireAt` + `drives` 权重），还有一大类只是人设里的一句话
 * （「23:00 必须睡」「早上 08:00 自己醒」）。前两类它们自己会算，第三类只能靠这里抽出来，
 * 抽出来的结果再交给 `/rhythm` 去驱动真实入睡 —— **不塞进提示词**。
 *
 * 三条刻意的克制，都是「误判成本高于漏判」：
 * 1. 中文数字时间（「十一点睡」「晚上十一点」）**不认**：要认就得写一套数字解析，
 *    而抽错一条会让宠物在白天被强制入睡，漏一条只是回到改之前的行为。
 * 2. 只有时间、附近没有睡眠相关词时**不抽**：「23:00 加班」不是作息。
 * 3. 单点时刻推出的区间长度是**缺省值**（见 {@link DEFAULT_SPAN_HOURS}），不是从文本读出来的；
 *    文本里没写起床时刻时，这个长度只是「比零长度更有用的猜测」。
 *
 * 纯函数：不读盘、不读时钟、不抛；超长输入直接放弃（避免正则回溯拖住宿主线程）。
 * @module dsh-fish-body/src/host/schedule/extract
 */

/** 一天里的时段状态，与 `GET/POST /rhythm` 的两态对齐：`sleeping` 会驱动真实入睡。 */
export type ScheduleState = 'sleeping' | 'awake';

/** 一条结构化时段。 */
export interface ScheduleEntry {
  /** `"HH:MM"`（24 小时制，两位补零）。 */
  readonly from: string;
  /** `"HH:MM"`；跨午夜合法（如 23:00 → 08:00）。 */
  readonly to: string;
  readonly state: ScheduleState;
  /** 原文片段（排障与展示用，**不改写原文措辞**）。 */
  readonly source: string;
}

/**
 * 缺省睡眠长度（小时）：只在「只给了一个时刻」时用来凑出另一端。
 *
 * 这个 7 **不是从文本里读出来的**，也不是谁的标准——它只是比「零长度」更有用的缺省值。
 * 文本里同时写了入睡与起床时刻时，两端都来自原文，这个常量不参与。
 */
const DEFAULT_SPAN_HOURS = 7;

/** 关键词窗口（字符）：时刻前后各取这么长来判断「附近在说睡还是在说醒」。 */
const KEYWORD_WINDOW = 12;

/** 配对允许的最大间隔（字符）：`23:00 睡觉，早上 08:00 起床` 之间只有几个字，32 足够宽松。 */
const PAIR_MAX_GAP = 32;

/** 超过这个长度直接返回空数组：64 KiB 的中文文本已经远超任何合理人设，再算下去只是给正则喂回溯。 */
const MAX_TEXT_LENGTH = 64 * 1024;

/** 入睡方向的词（`睡觉` 含 `睡`，所以顺序无所谓；只用于判定方向，不做分词）。 */
const SLEEP_WORDS: readonly string[] = ['睡觉', '入睡', '睡', '困'];

/** 起床方向的强词（比单个 `起` 可靠，先判）。 */
const WAKE_STRONG: readonly string[] = ['起床', '醒来', '醒'];

/** 起床方向的弱词：单个 `起`。误判风险最高，所以单独一档、最后判、并且排除「一起」。 */
const WAKE_WEAK: readonly string[] = ['起'];

/** 时刻 token：`H:MM` / `HH:MM`；`(?!\d)` 挡住 `123:45` 这种尾巴。 */
const TIME_RE = /(\d{1,2}):(\d{2})(?!\d)/g;

/**
 * 中文钟点的匹配：**必须带时段前缀**（`晚上十一点` / `早上八点`）。
 *
 * 不带前缀的 `十一点` 刻意不认：它既可能是 11:00 也可能是 23:00，猜错就会让宠物在中午睡下。
 * 带前缀时歧义消失，这才是可以安全归一的部分。
 */
const CN_CLOCK_RE =
  /(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|夜间|深夜|半夜)\s*([一二三四五六七八九十两]{1,3})\s*点\s*(半|一刻|三刻|[一二三四五六七八九十]{1,3}\s*分)?/g;

/** 中文数字 → 数值；只支持作息里会出现的 1..59（`十` / `十一` / `二十` / `三十五` 这类）。 */
function cnNumber(raw: string): number | undefined {
  const text = raw.trim();
  if (text === '') return undefined;
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  // 单字
  const single = digits[text];
  if (single !== undefined) return single;
  // 十 / 十X / X十 / X十Y
  const hit = /^([一二三四五两])?十([一二三四五六七八九])?$/.exec(text);
  if (hit !== null) {
    const tens = hit[1] === undefined ? 1 : (digits[hit[1]] ?? 0);
    const ones = hit[2] === undefined ? 0 : (digits[hit[2]] ?? 0);
    return tens * 10 + ones;
  }
  return undefined;
}

/** 时段前缀 → 12 小时制的换算规则；返回 undefined 表示这个钟点在这个时段里不成立。 */
function hoursOfPrefix(prefix: string, hour12: number): number | undefined {
  if (hour12 < 1 || hour12 > 12) return undefined;
  switch (prefix) {
    // 十二点在这些时段里都是零点：凌晨十二点、半夜十二点、晚上十二点
    case '凌晨':
    case '半夜':
      return hour12 === 12 ? 0 : hour12;
    // 深夜/夜里/夜间/晚上：十二点算零点，其余 +12
    case '深夜':
    case '夜里':
    case '夜间':
    case '晚上':
      return hour12 === 12 ? 0 : hour12 + 12;
    // 下午/傍晚：十二点仍是正午，其余 +12
    case '下午':
    case '傍晚':
      return hour12 === 12 ? 12 : hour12 + 12;
    // 中午：十二点是正午，一到五点仍算午后
    case '中午':
      return hour12 === 12 ? 12 : hour12 + 12;
    // 早上/早晨/上午：十二点算正午
    case '早上':
    case '早晨':
    case '上午':
      return hour12;
    default:
      return undefined;
  }
}

/** 分钟部分（`半` / `一刻` / `三刻` / `X分`）→ 0..59。 */
function minutesOfSuffix(suffix: string | undefined): number {
  if (suffix === undefined) return 0;
  const text = suffix.replace(/\s+/g, '');
  if (text === '半') return 30;
  if (text === '一刻') return 15;
  if (text === '三刻') return 45;
  const raw = text.endsWith('分') ? text.slice(0, -1) : text;
  const value = cnNumber(raw);
  return value !== undefined && value >= 0 && value <= 59 ? value : 0;
}

/**
 * 把带时段前缀的中文钟点改写成 `HH:MM`（预处理，不改语义）。
 *
 * 为什么先归一而不是在抽取时识别：抽取那边只认 `HH:MM`，加一条并行分支会让
 * 「区间 / 方向配对 / 关键词窗口」三套逻辑都要写两遍。归一之后它们全部复用。
 *
 * @param text - 原文。
 * @returns 改写后的文本；没有可归一的钟点时原样返回。
 */
export function normalizeChineseClock(text: string): string {
  return text.replace(CN_CLOCK_RE, (whole, prefix: string, hourRaw: string, suffix: string | undefined) => {
    const hour12 = cnNumber(hourRaw);
    if (hour12 === undefined) return whole;
    const hour = hoursOfPrefix(prefix, hour12);
    if (hour === undefined || hour > 23) return whole;
    return pad2(hour) + ':' + pad2(minutesOfSuffix(suffix));
  });
}

/** 一个命中的时刻。 */
interface TimeToken {
  /** 原文起点（含）。 */
  readonly start: number;
  /** 原文终点（不含）。 */
  readonly end: number;
  /** 归一化后的 `HH:MM`。 */
  readonly clock: string;
}

/** 两位补零。 */
function pad2(value: number): string {
  return value < 10 ? '0' + String(value) : String(value);
}

/**
 * 校验并归一化一个时刻。
 *
 * @param hh - 小时（原文里的数字）。
 * @param mm - 分钟（原文里的数字）。
 * @returns `HH:MM`；越界（`25:00` / `12:70`）返回 undefined。
 */
function normalizeClock(hh: number, mm: number): string | undefined {
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return undefined;
  if (hh < 0 || hh > 23) return undefined;
  if (mm < 0 || mm > 59) return undefined;
  return pad2(hh) + ':' + pad2(mm);
}

/** 从文本里取出全部合法时刻（非法的不进列表，等于丢弃）。 */
function timeTokensOf(text: string): TimeToken[] {
  const out: TimeToken[] = [];
  TIME_RE.lastIndex = 0;
  let match: RegExpExecArray | null = TIME_RE.exec(text);
  while (match !== null) {
    const start = match.index;
    // 前一个字符是数字时不是独立时刻（`123:45` 的 `23:45`）
    const before = start > 0 ? (text[start - 1] ?? '') : '';
    if (before !== '' && before >= '0' && before <= '9') {
      match = TIME_RE.exec(text);
      continue;
    }
    const clock = normalizeClock(Number(match[1]), Number(match[2]));
    if (clock !== undefined) out.push({ start, end: start + match[0].length, clock });
    match = TIME_RE.exec(text);
  }
  return out;
}

/** 一段文本的方向：附近在说睡还是说醒；都没有 undefined。 */
function directionOf(window: string): ScheduleState | undefined {
  if (WAKE_STRONG.some((word) => window.includes(word))) return 'awake';
  if (SLEEP_WORDS.some((word) => window.includes(word))) return 'sleeping';
  // 单个 `起` 只在排除「一起」之后才算——「23:00 一起看电影」不是作息
  const withoutTogether = window.split('一起').join('');
  if (WAKE_WEAK.some((word) => withoutTogether.includes(word))) return 'awake';
  return undefined;
}

/** 分句边界：关键词窗口不跨这些符号。 */
const CLAUSE_SEPS: readonly string[] = ['，', ',', '。', '；', ';', '\n', '！', '!', '？', '?'];

/** 一段文本在最后一个分句边界之后的部分。 */
function tailClause(text: string): string {
  let cut = -1;
  for (const sep of CLAUSE_SEPS) cut = Math.max(cut, text.lastIndexOf(sep));
  return cut < 0 ? text : text.slice(cut + 1);
}

/** 一段文本在第一个分句边界之前的部分。 */
function headClause(text: string): string {
  let cut = text.length;
  for (const sep of CLAUSE_SEPS) {
    const at = text.indexOf(sep);
    if (at >= 0 && at < cut) cut = at;
  }
  return text.slice(0, cut);
}

/**
 * 某个 token 附近的关键词窗口原文。
 *
 * **窗口不跨分句**：`23:00 睡觉，早上 08:00 起床` 里若 08:00 的窗口含「睡觉」，
 * 它会被判成入睡而不是起床，「方向配对」整条通道就失效了——这个坑是中文化归一路上暴露的。
 */
function windowOf(text: string, token: TimeToken): string {
  const before = tailClause(text.slice(Math.max(0, token.start - KEYWORD_WINDOW), token.start));
  const after = headClause(text.slice(token.end, Math.min(text.length, token.end + KEYWORD_WINDOW)));
  return before + text.slice(token.start, token.end) + after;
}

/**
 * 两个时刻之间是不是「显式区间」的连接写法。
 *
 * 认 `~ ～ - — – 到 至`，并允许中间夹「次日 / 早上 / 晚上 / 凌晨」这类时段词——
 * `从 23:00 到次日 08:00` 是明确区间，而 `23:00 睡觉，早上 08:00 起床` 中间是另一句话，
 * 走的是「方向配对」那条路，不能在这里被当成连接符。
 */
function isRangeLink(between: string): boolean {
  const stripped = between.replace(/次日|第二天|隔天|早上|早晨|上午|中午|下午|晚上|夜里|凌晨|左右/g, '');
  if (stripped.length > 8) return false;
  if (/[~～\-—–]/.test(stripped)) return true;
  return /到|至/.test(stripped);
}

/**
 * 按小时平移一个 `HH:MM`（对 24 取模）。
 *
 * @param clock - `HH:MM`。
 * @param hours - 平移小时数（可为负）。
 * @returns 平移后的 `HH:MM`。
 */
function shiftClock(clock: string, hours: number): string {
  const parts = clock.split(':');
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  const shifted = (((hour + hours) % 24) + 24) % 24;
  return pad2(shifted) + ':' + pad2(Number.isFinite(minute) ? minute : 0);
}

/** 收集器：校验 + 去重 + 保序。 */
interface Sink {
  readonly entries: ScheduleEntry[];
  readonly seen: Set<string>;
  /** 追加一条；`from === to` 或时间非法时丢弃。 */
  push(from: string, to: string, state: ScheduleState, source: string): void;
}

/** 造一个收集器（去重键是 `from|to|state`）。 */
function createSink(): Sink {
  const entries: ScheduleEntry[] = [];
  const seen = new Set<string>();
  return {
    entries,
    seen,
    push(from: string, to: string, state: ScheduleState, source: string): void {
      // `from === to` 无法区分「零长度」与「整天」，按规则丢弃
      if (from === to) return;
      if (normalizeClock(Number(from.slice(0, 2)), Number(from.slice(3))) === undefined) return;
      if (normalizeClock(Number(to.slice(0, 2)), Number(to.slice(3))) === undefined) return;
      const key = from + '|' + to + '|' + state;
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({ from, to, state, source });
    },
  };
}

/**
 * 从一段自然语言里抽作息时段。
 *
 * 三条通道，按优先级依次消费时刻，先被消费的不再参与后面的通道：
 * 1. **显式区间**：`23:00 ~ 08:00` / `23:00-08:00` / `23:00 到 08:00` / `从 23:00 到次日 08:00`；
 * 2. **方向配对**：两个时刻各自附近分别在说睡与说醒（`23:00 睡觉，早上 08:00 起床`），间隔 ≤ 32 字符；
 * 3. **单点推断**：只剩一个时刻且附近有睡眠词时，按 {@link DEFAULT_SPAN_HOURS} 凑另一端。
 *
 * 不做的事：中文数字时间、没有睡眠词的时刻、`from === to` 的条目、任何跨句的语义推断。
 *
 * @param text - 人设正文 / `HEARTBEAT.md` 之类的一段文本。
 * @returns 抽到的时段（按出现顺序、去重）；一条都抽不出时返回空数组。
 */
export function extractSchedule(text: string): ScheduleEntry[] {
  // 签名是 string，但运行时调用方可能塞进 undefined：这里按「没有文本」处理，不抛
  if (typeof text !== 'string' || text === '') return [];
  if (text.length > MAX_TEXT_LENGTH) return [];

  // 先归一中文钟点（`晚上十一点半` → `23:30`），后面的区间 / 配对 / 关键词窗口全部复用同一份逻辑
  const normalized = normalizeChineseClock(text);
  const tokens = timeTokensOf(normalized);
  if (tokens.length === 0) return [];

  const sink = createSink();
  const used = new Set<number>();

  // 通道 1：显式区间
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (a === undefined || b === undefined || used.has(i) || used.has(i + 1)) continue;
    if (!isRangeLink(normalized.slice(a.end, b.start))) continue;
    // 区间自身的语义由原文里的关键词决定；两端都没有睡眠词时按入睡处理
    // （`23:00-08:00` 这种写法本身就只可能是在说睡眠）
    const direction =
      directionOf(windowOf(normalized, a)) ?? directionOf(windowOf(normalized, b)) ?? ('sleeping' as ScheduleState);
    sink.push(a.clock, b.clock, direction, normalized.slice(a.start, b.end).trim());
    used.add(i);
    used.add(i + 1);
  }

  // 通道 2：方向配对（睡在前、醒在后，且两者之间没有别的时刻）
  for (let i = 0; i < tokens.length; i += 1) {
    const sleepToken = tokens[i];
    if (sleepToken === undefined || used.has(i)) continue;
    if (directionOf(windowOf(normalized, sleepToken)) !== 'sleeping') continue;
    for (let j = i + 1; j < tokens.length; j += 1) {
      const wakeToken = tokens[j];
      if (wakeToken === undefined || used.has(j)) continue;
      const gap = wakeToken.start - sleepToken.end;
      if (gap > PAIR_MAX_GAP) break;
      if (directionOf(windowOf(normalized, wakeToken)) !== 'awake') continue;
      sink.push(
        sleepToken.clock,
        wakeToken.clock,
        'sleeping',
        normalized.slice(sleepToken.start, wakeToken.end).trim(),
      );
      used.add(i);
      used.add(j);
      break;
    }
  }

  // 通道 3：单点推断
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === undefined || used.has(i)) continue;
    const direction = directionOf(windowOf(normalized, token));
    if (direction === undefined) continue;
    // `direction` 只决定「区间朝哪边推」，不决定 state：一条条目描述的是一段**睡眠**，
    // 无论原文写的是入睡时刻还是起床时刻，它推出来的都是同一段睡眠。
    // `awake` 目前不产出（没有可信的「清醒时段」写法），留着这个取值是给将来显式声明的清醒段。
    const from = direction === 'sleeping' ? token.clock : shiftClock(token.clock, -DEFAULT_SPAN_HOURS);
    const to = direction === 'sleeping' ? shiftClock(token.clock, DEFAULT_SPAN_HOURS) : token.clock;
    // 原文片段只取「时刻 + 紧跟其后的几个字」，够排障又不会把整段人设塞进 source
    const source = normalized.slice(token.start, Math.min(normalized.length, token.end + 8)).trim();
    sink.push(from, to, 'sleeping', source);
  }

  return sink.entries;
}
