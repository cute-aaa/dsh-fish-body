/**
 * 防复发（review-report P2-2）：「选择框不得以时间为条件判失败」这条不变量，靠**源码扫描**守住。
 *
 * 为什么单测不够：去超时那轮写的断言只能观察 120/150ms 的窗口，把旧缺陷的量级（180s）原样加回去时
 * `pick-folder.test.ts` **36/36 全绿**——进程被那个没人清的定时器拖到 ~180s 才退出，却没有一条断言变红。
 * 只要计时器的间隔比观察窗口长，行为断言就永远看不见它。所以这里直接读源码文本做符号级断言：
 * 一旦有人把 `setTimeout` / `Promise.race` / 超时常量接回去，不管间隔写多大都会立刻红。
 *
 * 扫描口径（写死，避免变成「谁都拦不住的模糊规则」）：
 *   1. 先剥注释（`//` 与 `/* *\/`，跳过字符串里的 `//`），只看剩下的**代码文本**——
 *      所以 JSDoc 里写「`HELPER_PICK_CLIENT_TIMEOUT_MS` 已删除」这类说明是允许的。
 *   2. 禁止出现的符号：`setTimeout(`、`Promise.race`、`AbortController`、`PICK_TIMEOUT_MS`、
 *      `HELPER_PICK_CLIENT_TIMEOUT_MS`、`PICK_DIALOG_TIMEOUT_MESSAGE`、`TIMED_OUT`、`timeoutMs`；
 *      外加两条「回归形态」规则：全局请求实现 `\bfetch\b`（**只**盯 `src/host/helper/dialog.ts`，
 *      成因是 undici 默认 `headersTimeout=300s` 悬崖）与计时器别名赋值 `const d = setTimeout`（四文件全扫）。
 *   3. `setInterval(` 也扫四个文件，并带**间隔上限 60_000ms**：命中片段里取得到数字实参就比一比，
 *      超上限必须由白名单显式声明 `exceedsIntervalCap` 才放行——所以「白名单了一个 180s」不会静默通过。
 *   4. 「给等待加时限」的两种最顺手写法也各有规则，**覆盖全部四个 pick 文件**（review P2-2 立规、P3-1 扩面）：
 *      `AbortSignal.timeout(…)`（本仓 `voice/**`、`vision.ts` 正在用的写法）与请求选项里的 `timeout:`。
 *      它们与 `TimeoutError` 那条错误路径叠加后的可观察结果就是「点了没反应」，所以必须在源码层拦住。
 *      作用域是 {@link PICK_SOURCES} 四个文件而不是单盯 `dialog.ts`：B 通道侧（`pick-folder.ts`）造一个
 *      时限再作为 `signal` 传进 A 通道，到点的可观察结果一模一样（`aborted` → 路由 `{kind:'none'}`）。
 *   4b. `AbortSignal.timeout(` 与三条静态形态规则（`globalThis['set'+'Timeout']`、`AbortSignal['time'+'out']`、
 *      `(0, setTimeout)`）还扩到 {@link ROUTE_FILES}（`src/host/routes/**` 目录枚举）：routes 是 pick 链路的
 *      **上游调用方**——在路由里造一个时限再作为 `signal` 传下来，到点同样是 `aborted`。
 *      请求选项 `timeout:` **不**扩到 routes（`routes/` 里没有 `http.request`，写上只会扩大未来的误伤面）。
 *   5. 白名单只有两条，都限定「落在哪个函数里、最多几次」：
 *      - `pick-folder.ts` 的 `setInterval` 排障心跳（`unref` 过、回调只写日志；另有专用用例断言
 *        它不调用 `finish`/`resolve`/`reject`；600s 间隔 > 上限，走 `exceedsIntervalCap` 显式豁免）；
 *      - `bridge.js` 的 `setTimeout(…, 45000)` 是 bridge RPC 应答兜底（早于本轮就存在、不在 pick 链路上），
 *        只允许 `bridgeRequest` 里那一次。
 *
 * 误伤评估（全仓 `setInterval` 复核，24 处）：除 `pick-folder.ts` 的 600s 心跳外，最长的是
 * `use-voice-settings` 的 30s 探针，其余都在 ≤6s（`windows.js` 的 60ms/1s/3s 看门狗、60ms 指针轮询、
 * `log-file` 1s flush、`gsv` 20s 探针…），再往下就是毫秒级 tick。60s 阈值留了一倍余量，且这些文件
 * 里只有 `pick-folder.ts` 在扫描面上。`fetch(` 只扫 `dialog.ts` 的理由：`bridge.js:201` 的
 * `fetch(origin + url, …)` 是非 bridge 模式的宿主应答直连（短请求、45s 兜底），不在 pick 等待链路上。
 *
 * 两条时限规则的作用域同理：`AbortSignal.timeout(` 在本仓别处有 16 处正当用法（`voice/gsv/client.ts`、
 * `voice/cloud/provider.ts`、`vision.ts`、`whisper.ts`、`shared/{voice,hear,chat/send}.ts`、`host/balance`、
 * `host/chat.ts`），它们都是「长耗时推理必须有时限」的正常需求，全局规则会一律误伤；pick 这条链路恰恰相反
 * （人的思考时间不是失败），所以只盯 {@link PICK_SOURCES} 这四个文件（review P3-1 把范围从 `dialog.ts`
 * 扩到全部四个：另三个文件今天 `AbortSignal.timeout` / `timeout:` 均 0 命中，扩面无误伤）。
 * `\btimeout\s*:` 同口径：四个文件剥注释后 0 命中，
 * 而 `timeoutMs` / `WAITING_TIMEOUT_CODES` / `'HeadersTimeoutError'` 这些标识量与字符串都不会被它命中
 * （`\btimeout` 后面必须是可选空白加冒号；`TimeoutError` 首字母大写也匹配不到）。
 *
 * 已知边界（**这是可执行的事实，不是免责声明**）：剥注释是「字符串感知 + 正则字面量感知」的字符扫描，
 * 不是完整 JS 词法器；模板串 `${…}` 内部的引号/正则不做嵌套解析——但判据是「有没有这个符号」，
 * 这些粗化都只会把注释/字符串内容带进匹配（误报方向），不会漏掉真实计时器。
 *
 * 一处**实测并已修复**的失步（2026-11 复现、同月修复）：`pick-folder.ts` 的 `replace(/'/g, "''")`
 * 让旧扫描器从那一行起一直以为自己在字符串里 → 那之后的行内注释**不被剥掉**。方向是**误报**
 * （字符串内容原样参与匹配，真实代码里的 `setInterval(` 照样命中，不会漏计时器），后果是「在失步点
 * 之后写一句带 `setInterval(` 的注释」会被判违规。修复：`stripComments` / `lastArgumentOf` 都通过
 * {@link isRegexStart} 感知正则字面量（表达式起点启发式 + 关键字白名单），合成样本与真实文件锚点
 * 双双钉进用例（见「stripComments：正则字面量不再劫持引号态」与「lastArgumentOf：正则字面量」两条）。
 *
 * 静态拼接/逗号转手规则（`globalBracketTimer` / `abortSignalBracketTimer` / `commaIndirection`）：
 *   **拦得住**——单行内纯字面量的任意切分（`globalThis['set' + 'Timeout']`、`AbortSignal['time' + 'out']`）、
 *   逗号转手（`(0, setTimeout)` / `(0, AbortSignal.timeout)`）、成员取值别名（既有的 `timerAlias`）。
 *   **拦不住**（负向用例已把下面七条**全部写成可执行的**，防止有人以为它全知；文件头与本用例是同一份
 *   事实的两处表达，改一处必须改另一处）：
 *     ① 变量参与拼接（`globalThis['set' + name]`）；
 *     ② 模板串插值（`` globalThis[`set${'Timeout'}`] ``）；
 *     ③ 跨行拼接；
 *     ④ 更远的间接·反射（`Reflect.get(globalThis, 'setTimeout')`）；
 *     ⑤ 更远的间接·求值（`eval`）；
 *     ⑥ 更远的间接·函数化（`new Function`）；
 *     ⑦ 运行时改写全局（`Object.defineProperty`）。
 *   要拦住这些得上 AST 级扫描或引入依赖，本轮刻意不做（守卫要在没有 `node_modules` 的极端情况下
 *   也能说清「为什么红」）。规则拦的是「正常会写出来的形态」——包括 `= globalThis.setTimeout` 这种成员取值。
 * 失败信息一律指向可执行的下一步，而不是「assert 失败」。
 * @module dsh-fish-body/src/host/pick-no-timeout-guard.test
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** `dsh-pet` 包根（本文件在 `src/host/`）。 */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * 一处被守的扫描面：文件 + 它剥离注释后必须仍存在的锚点 + 为什么它属于这条不变量。
 *
 * `reason` 不是注释而是**数据**：它进失败信息，也被用例断言（非空、够长）——
 * 免得有人复制一条空理由就把一个新文件塞进扫描面。
 */
interface PickSource {
  /** 相对包根。 */
  readonly file: string;
  /** 剥离注释后必须仍存在的符号（防止文件被挪走/清空时静默全绿）。 */
  readonly anchor: string;
  /** 为什么它属于这条不变量（给人看，也进失败信息）。 */
  readonly reason: string;
}

/**
 * 被守的四个源码文件（相对包根）：B 通道宿主、A 通道客户端、helper 侧对话框、helper 协议桥。
 *
 * 少一个都算守卫失效——这四处合起来才是「点一次选择…」的整条链路。
 * {@link PICK_FILES} 与 {@link ANCHORS} 都从这里派生（单一真源），不再出现「数组改了一处、
 * `ANCHORS` 忘了同步」这种半改。
 */
const PICK_SOURCES: readonly PickSource[] = [
  {
    file: 'src/host/pick-folder.ts',
    anchor: 'pickPathOnce',
    reason: 'B 通道宿主：自己 spawn 兜底命令、自己决定结局；在这里造时限＝到点判失败',
  },
  {
    file: 'src/host/helper/dialog.ts',
    anchor: 'createHelperDialog',
    reason: 'A 通道客户端：唯一允许的等待出口是 req.signal；任何计时器都是 P1-1 的 300s 悬崖回归',
  },
  {
    file: 'runtime/electron-helper/main/dialog.js',
    anchor: 'showOpenDialog',
    reason: 'helper 侧真正弹框处：加 timeout 会让框自己消失，用户以为没点到',
  },
  {
    file: 'runtime/electron-helper/main/bridge.js',
    anchor: 'handlePick',
    reason: 'helper 协议桥：/pick 意图的唯一通道，同族路径（上一轮实测绕过点就在这类「同一件事的第二段」）',
  },
];

/** 四个 pick 文件（`rule.files` 与用例都用它，别再单独维护一份字符串数组）。 */
const PICK_FILES: readonly string[] = PICK_SOURCES.map((item) => item.file);

/** 锚点表：由 {@link PICK_SOURCES} 派生。 */
const ANCHORS: Readonly<Record<string, string>> = Object.fromEntries(
  PICK_SOURCES.map((item) => [item.file, item.anchor]),
);

/**
 * pick 链路的**上游调用方**面：`src/host/routes/` 里先在请求上造一个时限、再作为 `signal` 传下来，
 * 到点的可观察结果与在 pick 文件里造时限完全一样（`aborted` → 路由 `{kind:'none'}`，一个字节都不写）。
 *
 * 用**目录枚举**而不是硬编码清单：新增 `routes/pick-xxx.ts` 自动进面——这正是「漏登记就红」的机制。
 * 排除 `*.test.ts`：测试夹具里造一个带时限的 signal 用来模拟「上游传下来」是合法写法，
 * 生产代码才是「造时限」的地方。
 */
const ROUTE_SURFACE = {
  dir: 'src/host/routes',
  include: /\.ts$/,
  exclude: /\.test\.ts$/,
  reason: 'routes 是 pick 链路的上游调用方；只挂 `AbortSignal.timeout(` 与三条静态形态规则',
} as const;

/**
 * `src/host/routes/**` 的生产文件（相对包根）。
 *
 * 目录被改名/清空时它会变空 → 那三条规则「0 命中」就成了假绿，所以另有规模与必含文件断言。
 */
const ROUTE_FILES: readonly string[] = readdirSync(resolve(PACKAGE_ROOT, ROUTE_SURFACE.dir))
  .filter((name) => ROUTE_SURFACE.include.test(name) && !ROUTE_SURFACE.exclude.test(name))
  .map((name) => `${ROUTE_SURFACE.dir}/${name}`);

/** 一条扫描规则：`id` 用于白名单引用，`source` 是正则源码（每次现编，避免 `lastIndex` 状态泄漏）。 */
interface Rule {
  /** 稳定标识（白名单按它引用，不用正则字符串比较）。 */
  readonly id: string;
  /** 正则源码（总按全局模式编译）。 */
  readonly source: string;
  /** 给人看的名字：出现在失败信息里。 */
  readonly what: string;
  /** 只对这些文件生效（相对包根）；缺省 = 全部 {@link PICK_SOURCES}。 */
  readonly files?: readonly string[];
  /** 间隔上限（毫秒）：只有「命中片段里取得到数字实参」时才会比较。 */
  readonly intervalCapMs?: number;
  /**
   * 命中后还要过一遍的过滤器：入参是第一个捕获组。缺省 = 直接算命中。
   *
   * 为什么需要它：像 `globalThis[X]` 这种形态，只有把 `X` 求值出来才知道是不是计时器；
   * 把「求值」放进规则里的小谓词，比在扫描主流程里堆特判更不容易漏。
   */
  readonly when?: (group: string) => boolean;
}

/** 方括号里拼出来之后算「计时器」的名字（`globalThis['set' + 'Timeout']` 求值后与它比）。 */
const TIMER_NAMES: ReadonlySet<string> = new Set(['setTimeout', 'setInterval', 'setImmediate']);

/**
 * 把「纯字符串字面量用 `+` 连接」的表达式求值；别的形状一律 `undefined`（**不猜**）。
 *
 * 认什么：`'set' + 'Timeout'`、`"set"+"Interval"`、`'setTi' + 'meout'`（任意切分都行——求的是**值**不是形状）。
 * 不认什么：任何变量/成员/调用参与（`'set' + name`）、模板串、跨行拼接——负向用例钉住这三类必须**不**红。
 *
 * @param expression - 方括号里的原始文本（或合成样本）。
 * @returns 拼出来的字符串；认不出时 `undefined`。
 */
function staticStringOf(expression: string): string | undefined {
  const text = expression.trim();
  if (text === '') return undefined;
  const parts: string[] = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index] ?? '')) index += 1;
    if (index >= text.length) break;
    const quote = text[index];
    if (quote !== '"' && quote !== "'") return undefined;
    index += 1;
    let value = '';
    let closed = false;
    while (index < text.length) {
      const ch = text[index] ?? '';
      if (ch === '\\') {
        // 只处理最常见的两种转义；其它按字面量字符算（判据是「拼出来是不是计时器名」，不是严格 JSON 解析）。
        const next = text[index + 1] ?? '';
        value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
        index += 2;
        continue;
      }
      if (ch === quote) {
        index += 1;
        closed = true;
        break;
      }
      value += ch;
      index += 1;
    }
    if (!closed) return undefined;
    parts.push(value);
    while (index < text.length && /\s/.test(text[index] ?? '')) index += 1;
    if (index >= text.length) break;
    if (text[index] !== '+') return undefined;
    index += 1;
  }
  return parts.length === 0 ? undefined : parts.join('');
}

/** 判失败的计时器符号。顺序即报告顺序。 */
const RULES: readonly Rule[] = [
  { id: 'setTimeout', source: 'setTimeout\\s*\\(', what: 'setTimeout（按时间收尾）' },
  { id: 'promiseRace', source: 'Promise\\.race', what: 'Promise.race（与睡多久竞速）' },
  { id: 'abortController', source: 'AbortController', what: 'AbortController（定时中止）' },
  { id: 'pickTimeoutMs', source: '\\bPICK_TIMEOUT_MS\\b', what: 'PICK_TIMEOUT_MS（旧的宿主/helper 超时常量）' },
  {
    id: 'helperPickTimeoutMs',
    source: '\\bHELPER_PICK_CLIENT_TIMEOUT_MS\\b',
    what: 'HELPER_PICK_CLIENT_TIMEOUT_MS（旧的 A 通道总超时常量）',
  },
  {
    id: 'dialogTimeoutMessage',
    source: '\\bPICK_DIALOG_TIMEOUT_MESSAGE\\b',
    what: 'PICK_DIALOG_TIMEOUT_MESSAGE（「选择框超时」文案）',
  },
  { id: 'timedOut', source: '\\bTIMED_OUT\\b', what: "TIMED_OUT（helper 的 reason:'timeout' 旧实现）" },
  { id: 'timeoutMs', source: '\\btimeoutMs\\b', what: 'timeoutMs（把间隔当参数传进来的口子）' },
  {
    id: 'globalFetch',
    source: '\\bfetch\\b',
    what: '全局 fetch（undici 默认 headersTimeout=300s 悬崖，P1-1 的成因）',
    // 只盯 A 通道客户端：bridge.js:201 的 `fetch(` 是非 bridge 模式的短请求直连，不在 pick 等待链路上。
    files: ['src/host/helper/dialog.ts'],
  },
  {
    id: 'abortSignalTimeout',
    source: 'AbortSignal\\s*\\.\\s*timeout\\b',
    what: 'AbortSignal.timeout（给等待加时限＝重新引入「到点就判失败」，P2-2）',
    // 本仓 voice/**、vision.ts 等 16 处是正当用法（长耗时推理必须有时限）；pick 链路相反，只盯 pick 文件。
    // 四个文件而不是 `dialog.ts`（review P3-1）：在 `pick-folder.ts` 造时限再作为 signal 传进 A 通道，
    // 到点同样是 `aborted` → `{kind:'none'}`（用户「点了没反应」），所以扫描面就是整条链路。
    // 扩到 routes（T5-5）：routes 是上游调用方——在那里造时限再作为 signal 传下来，结果一模一样。
    files: [...PICK_FILES, ...ROUTE_FILES],
  },
  {
    id: 'requestTimeoutOption',
    source: '\\btimeout\\s*:',
    what: '请求选项里的 timeout（`node:http` 的 timeout 会按时间掐断等待，P2-2）',
    // 同上：四个 pick 文件剥注释后 0 命中；`timeoutMs` / `TimeoutError` 这类标识量与错误名不会被它命中。
    // **不**扩到 routes：`routes/` 里没有 `http.request`，写上只会扩大未来的误伤面（需求 D3 / 未决问题 3）。
    files: PICK_FILES,
  },
  {
    id: 'setInterval',
    source: 'setInterval\\s*\\(',
    what: 'setInterval（按时间重复判定的口子）',
    intervalCapMs: 60_000,
  },
  {
    id: 'timerAlias',
    source: '(?:const|let|var)\\s+[A-Za-z_$][\\w$]*\\s*=\\s*(?:globalThis\\s*\\.\\s*)?(?:setTimeout|setInterval)\\b',
    what: '计时器别名赋值（`const d = setTimeout` / `= globalThis.setTimeout` 这类转手）',
  },
  {
    id: 'globalBracketTimer',
    source: '\\b(?:globalThis|window|self)\\s*\\[([^\\]\\n]{1,160})\\]',
    what: 'globalThis["set" + "Timeout"] 这类方括号取计时器（换个写法就绕过了 `setTimeout(` 的检测）',
    files: [...PICK_FILES, ...ROUTE_FILES],
    when: (group) => TIMER_NAMES.has(staticStringOf(group) ?? ''),
  },
  {
    id: 'abortSignalBracketTimer',
    source: '\\bAbortSignal\\s*\\[([^\\]\\n]{1,160})\\]',
    what: "AbortSignal['time' + 'out']（换个写法就能给等待加时限）",
    files: [...PICK_FILES, ...ROUTE_FILES],
    when: (group) => staticStringOf(group) === 'timeout',
  },
  {
    id: 'commaIndirection',
    source:
      '\\(\\s*(?:0|void\\s+0)\\s*,\\s*(?:globalThis\\s*\\.\\s*)?(?:setTimeout|setInterval|AbortSignal\\s*\\.\\s*timeout)\\b',
    what: '(0, setTimeout) / (0, AbortSignal.timeout) 这类逗号转手（取的是全局引用，绕过裸名检测）',
    files: [...PICK_FILES, ...ROUTE_FILES],
  },
];

/** 一次命中。 */
interface Finding {
  /** 相对包根的路径。 */
  readonly file: string;
  /** 1 起的行号。 */
  readonly line: number;
  /** 命中行的代码文本（已去注释、已 trim），给人看。 */
  readonly text: string;
  /**
   * 命中处的实参区间（从命中点到配对右括号，最长 400 字符，换行折成空格）。
   *
   * 为什么需要它：间隔常常在**下一个或更后面的行**上（`setTimeout(() => { … }, 45000)`），
   * 只看命中行会认不出「这一处到底是哪个间隔」。
   */
  readonly snippet: string;
  /** 命中的规则。 */
  readonly rule: Rule;
  /** 文本向上回溯到的最近一个具名函数（仅用于白名单归户，不是语法级归属）。 */
  readonly enclosing: string | undefined;
}

/**
 * 一条白名单：某个文件里的某条规则，允许出现 `max` 次，且必须落在指定函数里、行内还要匹配 `lineIncludes`。
 *
 * 三条约束同时成立才算「允许」——只放宽一半是最容易出事的那种改法（例如允许了 `setTimeout`
 * 但没限定归属，于是有人能在 pick 路径里塞一个 180s）。
 */
interface Allowance {
  /** 相对包根的路径。 */
  readonly file: string;
  /** 对应的 {@link Rule.id}。 */
  readonly ruleId: string;
  /** 该文件里最多允许几次。 */
  readonly max: number;
  /** 必须落在这个具名函数里（`undefined` = 不限定，目前没有这种白名单）。 */
  readonly enclosing: string | undefined;
  /** 命中处还必须匹配它（用来钉住「就是那一个间隔」）。 */
  readonly snippetIncludes: RegExp | undefined;
  /**
   * 是否显式豁免 {@link Rule.intervalCapMs}（缺省 `false`）。
   *
   * 缺省 false 的语义：哪怕白名单匹配上了，只要间隔超过上限就仍然红——想放过一个长计时器，
   * 必须在这里写下理由并被审到。
   */
  readonly exceedsIntervalCap?: boolean;
  /** 为什么允许：写进报告，也写进失败信息。 */
  readonly why: string;
}

/**
 * 白名单（唯一两处，都是「观测/协议兜底」，不是结局判定）。
 *
 * 新增条目等于放宽这条不变量：先确认它不是「等久了判失败」，再在 `03-code/change-report.md` 里写明。
 */
const ALLOWANCES: readonly Allowance[] = [
  {
    file: 'src/host/pick-folder.ts',
    ruleId: 'setInterval',
    max: 1,
    enclosing: 'attempt',
    snippetIncludes: /PICK_WAIT_HEARTBEAT_MS/,
    exceedsIntervalCap: true,
    why: '排障心跳：unref() 过、回调只写一行日志，纯度由专项用例钉死（不调 finish/resolve/reject）；600s 间隔超上限，显式豁免',
  },
  {
    file: 'runtime/electron-helper/main/bridge.js',
    ruleId: 'setTimeout',
    max: 1,
    enclosing: 'bridgeRequest',
    snippetIncludes: /45_?000/,
    why: 'bridge RPC 应答的 45s 兜底（宿主长期不应答时 reject），不在 pick 链路上，早于本轮就存在',
  },
];

/**
 * 判定 `source[index]` 处的 `/` 是不是**正则字面量的开头**（除法则返回 `false`）。
 *
 * 为什么需要它：本仓源码里既有 `a / 2`（除法）也有 `/'/g`（正则），后者里的引号如果被当成
 * 字符串引号，扫描器从那里起就「以为自己在字符串里」——行注释不被剥、逗号切分切错
 * （`pick-folder.ts` 的 `replace(/'/g, "''")` 是实测失步点）。识别正则不需要完整词法器：
 * JS 规定正则只能出现在**表达式起点**，所以看 `/` 前面最近的一个有效字符/词就够——
 * `(` `,` `=` `:` 等后面是正则，数字、标识符、`)` `]` `}` 与闭引号后面是除法，
 * 唯一的歧义是关键字（`return /re/`），用关键字白名单解决。
 *
 * 误判后果可控且方向安全：把除法当正则时，正则区间内容**原样保留**（不是删掉），
 * 最坏退化成「该区间内注释不被剥」——与修复前的失步同款，误报方向，不会漏真实计时器。
 *
 * @param source - 原始文本（剥注释前的原文，或已剥注释的代码）。
 * @param index - `/` 的下标。
 * @returns `true` = 正则字面量开头；`false` = 除法或其它。
 */
function isRegexStart(source: string, index: number): boolean {
  // 关键字后跟 `/` 是正则（`return /re/`）；但 `.in /`、`.of /` 这类**成员名撞关键字**极罕见，
  // 且误判只造成误报方向（同上），列进来。
  const KEYWORDS_BEFORE_REGEX: ReadonlySet<string> = new Set([
    'return',
    'case',
    'typeof',
    'instanceof',
    'in',
    'of',
    'new',
    'delete',
    'void',
    'throw',
    'do',
    'else',
    'yield',
    'await',
  ]);
  let i = index - 1;
  while (i >= 0 && /\s/.test(source[i] ?? '')) i -= 1;
  const prev = source[i] ?? '';
  if (prev === '') return true;
  // `++` / `--` 后的 `/` 是除法（`count++ / 2`）；单个 `+`/`-` 后是正则（`a + /re/.test(x)`）。
  if (prev === '+' || prev === '-') {
    let j = i - 1;
    while (j >= 0 && (source[j] ?? '') !== prev && /\s/.test(source[j] ?? '')) j -= 1;
    return (source[j] ?? '') !== prev;
  }
  // 除法的确定语境：值（数字/标识符/闭括号/闭引号）后面的 `/` 一定是除法。
  if (prev === ')' || prev === ']' || prev === '}' || prev === '"' || prev === "'" || prev === '`' || /\d/.test(prev)) {
    return false;
  }
  // 表达式起点字符：正则合法。
  if ('([{,;=:!&|?^~%*<>'.includes(prev)) return true;
  // 标识符结尾：向前取整个词，只有关键字命中才算正则。
  let j = i;
  while (j >= 0 && /[A-Za-z_$0-9]/.test(source[j] ?? '')) j -= 1;
  return KEYWORDS_BEFORE_REGEX.has(source.slice(j + 1, i + 1));
}

/**
 * 剥掉 `//` 与 `/* *\/` 注释，**保留换行与长度**（把注释字符换成空格）。
 *
 * 为什么不用正则一把梭：本仓代码里有 `'http://127.0.0.1:…'` 这种字符串，`//` 出现在字符串里时
 * 不能被当成行注释，否则后面整段真实代码会被吃掉、守卫变成假的绿。
 *
 * 正则字面量也要感知（2026-11-21 轮修复的实测失步）：`pick-folder.ts` 的
 * `replace(/'/g, "''")` 里正则带引号，旧实现把它当成字符串引号后，从那行起行内注释
 * 全部漏剥（方向是误报——注释里的 `setInterval(` 会被判违规）。现在 `/` 在表达式起点
 * （{@link isRegexStart}）按正则处理：区间内容**原样保留**，收尾的未转义 `/`（字符类内的
 * `/` 不收尾）之后吞掉 flags；正则不跨行，行尾还没闭合就当没开过（保持旧失步的误报方向，
 * 不把误判扩大到下一行）。
 *
 * @param source - 原始文件文本。
 * @returns 同长度文本，注释位置全是空格（换行原样保留，行号可直接对应）。
 */
function stripComments(source: string): string {
  const out: string[] = [];
  let index = 0;
  /** 当前所在的引号种类；`undefined` = 在代码里（不在字符串里）。 */
  let quote: string | undefined;
  while (index < source.length) {
    const ch = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (quote !== undefined) {
      out.push(ch);
      if (ch === '\\') {
        out.push(next);
        index += 2;
        continue;
      }
      if (ch === quote) quote = undefined;
      index += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out.push(ch);
      index += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (index < source.length && (source[index] ?? '') !== '\n') {
        out.push(' ');
        index += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      out.push(' ', ' ');
      index += 2;
      while (index < source.length && !((source[index] ?? '') === '*' && (source[index + 1] ?? '') === '/')) {
        out.push((source[index] ?? '') === '\n' ? '\n' : ' ');
        index += 1;
      }
      out.push(' ', ' ');
      index += 2;
      continue;
    }
    if (ch === '/' && isRegexStart(source, index)) {
      // 正则字面量：内容原样输出（它是代码，不是注释）。
      out.push(ch);
      index += 1;
      /** `[…]` 字符类里的 `/` 不收尾（`[/]` 合法且常见）。 */
      let inClass = false;
      while (index < source.length) {
        const regexCh = source[index] ?? '';
        out.push(regexCh);
        if (regexCh === '\\') {
          out.push(source[index + 1] ?? '');
          index += 2;
          continue;
        }
        if (regexCh === '[') inClass = true;
        else if (regexCh === ']') inClass = false;
        else if (regexCh === '\n')
          break; // 字面量正则不跨行：行尾还没闭合就当没开过（不扩吞）。
        else if (regexCh === '/' && !inClass) {
          index += 1;
          break;
        }
        index += 1;
      }
      // flags（g/i/m/s/u/y/d 等）：原样保留。
      while (index < source.length && /[a-z]/i.test(source[index] ?? '')) {
        out.push(source[index] ?? '');
        index += 1;
      }
      continue;
    }
    out.push(ch);
    index += 1;
  }
  return out.join('');
}

/**
 * 向上找最近的「具名函数声明」或「具名函数表达式赋值」。
 *
 * 只认 `function name(` 与 `const name = (…) =>`／`const name = function (` 这两种本仓在用的写法。
 * 找不到就返回 `undefined`——**不猜**，因为白名单要的是确定的归属（猜错的归属会放过一个真计时器）。
 *
 * @param lines - 去注释后的代码行。
 * @param index - 命中行的下标（0 起）。
 * @returns 函数名或 `undefined`。
 */
function enclosingOf(lines: readonly string[], index: number): string | undefined {
  for (let i = index; i >= 0; i--) {
    const line = lines[i] ?? '';
    const declared = /(?:^|\s)function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(line);
    if (declared?.[1] !== undefined) return declared[1];
    const assigned = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function\b)/.exec(line);
    if (assigned?.[1] !== undefined) return assigned[1];
  }
  return undefined;
}

/**
 * 取命中处的「到配对右括号为止」的片段（最长 400 字符，换行折成空格）。
 *
 * @param code - 去注释后的代码。
 * @param at - 命中起点。
 * @returns 可读片段（括号不配对时退化为前 400 字符）。
 */
function snippetOf(code: string, at: number): string {
  const slice = code.slice(at, Math.min(code.length, at + 400));
  const open = slice.indexOf('(');
  if (open < 0) return slice.replace(/\s+/g, ' ');
  let depth = 0;
  for (let i = open; i < slice.length; i++) {
    const ch = slice[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return slice.slice(0, i + 1).replace(/\s+/g, ' ');
    }
  }
  return slice.replace(/\s+/g, ' ');
}

/**
 * 取一个调用实参里的**最后一段**（顶层逗号切分）。
 *
 * 为什么不能只按 `,` 切：回调里带逗号（`setInterval(() => log(a, b), 60000)`）、对象/数组实参、
 * 箭头函数体里的逗号都会被误切成多段，于是「最后一个数字」可能来自别处。
 * 这里按 `()` / `[]` / `{}` 深度与字符串（`'` `"` `` ` ``，含转义）一起感知，只在**深度 1** 的逗号处切；
 * 正则字面量也按字面量感知（`isRegexStart`）：`setInterval(cb, /,/.test(x), 60000)` 里正则内的
 * 逗号/引号/括号都不得参与切分，否则「最后一个实参」会取错段（与 {@link stripComments} 的失步同族）。
 *
 * @param callText - 从调用名开始的片段（{@link Finding.snippet}）。
 * @returns 最后一段实参文本；括号不配对时 `undefined`。
 */
function lastArgumentOf(callText: string): string | undefined {
  const open = callText.indexOf('(');
  if (open < 0) return undefined;
  let depth = 0;
  let quote: string | undefined;
  /** 当前是否在正则字面量里（`inClass` = 正则的 `[…]` 字符类，类里的 `/` 不收尾）。 */
  let regex = false;
  let regexInClass = false;
  let lastComma = open;
  for (let index = open; index < callText.length; index++) {
    const ch = callText[index] ?? '';
    if (regex) {
      if (ch === '\\') {
        index += 1;
        continue;
      }
      if (ch === '[') regexInClass = true;
      else if (ch === ']') regexInClass = false;
      else if (ch === '/' && !regexInClass) regex = false;
      continue;
    }
    if (quote !== undefined) {
      if (ch === '\\') {
        index += 1;
        continue;
      }
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '/' && isRegexStart(callText, index)) {
      regex = true;
      regexInClass = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return callText.slice(lastComma + 1, index).trim();
    } else if (ch === ',' && depth === 1) lastComma = index;
  }
  return undefined;
}

/**
 * 把一段「纯数值表达式」求值：四则 + 括号 + 数字字面量，别的一律 `undefined`（**不猜**）。
 *
 * 认什么：`180000`、`180_000`、`1e5`、`1.8e5`、`0x2BF20`、`0b…`、`0o…`、`60 * 1000`、`2 * 60_000`、
 * `180000 / 3`、`(60) * 1000`、`-` 前缀。
 * 不认什么（写在这里，免得下次有人以为它能算一切）：标识量（`PICK_WAIT_HEARTBEAT_MS`）、模板串、
 * 函数调用（`Math.max(…)`）、`**`、`??`、跨行拼接后带注释的实参——这些返回 `undefined`，
 * 调用处退回「基础形态判定」（`setInterval(` 照样红，只是不做上限比较）。
 *
 * 有了它，「白名单里把心跳写成 `1e5`」这种改法才不会再蒙混过去：`overCapOf` 现在给得出数值。
 *
 * @param expression - 待求值的表达式文本。
 * @returns 数值；认不出、除零、非有限值都返回 `undefined`。
 */
function numericValueOf(expression: string): number | undefined {
  const text = expression.trim();
  if (text === '') return undefined;
  let index = 0;

  /** 跳过空白。 */
  function skip(): void {
    while (index < text.length && /\s/.test(text[index] ?? '')) index += 1;
  }

  /** 数字字面量（十进制/下划线/0x/0b/0o/小数/指数）。 */
  function parseNumber(): number | undefined {
    skip();
    const match =
      /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.[\d_]+)(?:[eE][+-]?\d+)?)/.exec(
        text.slice(index),
      );
    if (match === null) return undefined;
    index += match[0].length;
    const value = Number(match[0].replace(/_/g, ''));
    return Number.isFinite(value) ? value : undefined;
  }

  function parseExpr(): number | undefined {
    let left = parseTerm();
    if (left === undefined) return undefined;
    for (;;) {
      skip();
      const op = text[index];
      if (op !== '+' && op !== '-') return left;
      index += 1;
      const right = parseTerm();
      if (right === undefined) return undefined;
      left = op === '+' ? left + right : left - right;
      if (!Number.isFinite(left)) return undefined;
    }
  }

  function parseTerm(): number | undefined {
    let left = parseUnary();
    if (left === undefined) return undefined;
    for (;;) {
      skip();
      const op = text[index];
      if (op !== '*' && op !== '/') return left;
      index += 1;
      const right = parseUnary();
      if (right === undefined) return undefined;
      // 除零不猜：宁可退回基础形态判定，也不把 Infinity 当成「间隔」。
      if (op === '/' && right === 0) return undefined;
      left = op === '*' ? left * right : left / right;
      if (!Number.isFinite(left)) return undefined;
    }
  }

  function parseUnary(): number | undefined {
    skip();
    if (text[index] === '-') {
      index += 1;
      const value = parseUnary();
      return value === undefined ? undefined : -value;
    }
    if (text[index] === '+') {
      index += 1;
      return parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): number | undefined {
    skip();
    if (text[index] === '(') {
      index += 1;
      const inner = parseExpr();
      skip();
      if (inner === undefined || text[index] !== ')') return undefined;
      index += 1;
      return inner;
    }
    return parseNumber();
  }

  const value = parseExpr();
  skip();
  // 必须整段吃干净：`180000 + foo` 这种半截表达式不能只读前半截就当数。
  return value !== undefined && index === text.length ? value : undefined;
}

/**
 * 从命中片段里取「最后一个实参」当作间隔。
 *
 * 取不到数字（标识量、模板串、调用、除零…）就返回 `undefined`，规则退回基础形态判定——
 * 不猜常量的值，也不因为猜不到就放行。
 *
 * @param snippet - {@link Finding.snippet}。
 * @returns 毫秒数；取不到时 `undefined`。
 */
function intervalOf(snippet: string): number | undefined {
  const last = lastArgumentOf(snippet);
  return last === undefined ? undefined : numericValueOf(last);
}

/**
 * 扫一段源码文本（先去注释）。
 *
 * @param source - 文件原文或合成样本。
 * @param file - 报告里显示的名字；同时决定哪些规则对这个文件生效。
 * @returns 全部命中（按 {@link RULES} 顺序、每条内部按出现顺序）。
 */
function scanText(source: string, file: string): Finding[] {
  const code = stripComments(source);
  const lines = code.split('\n');
  const findings: Finding[] = [];
  for (const rule of RULES) {
    // 规则可以只盯某几个文件（例如 `\bfetch\b` 只对 A 通道客户端生效）。
    if (rule.files !== undefined && !rule.files.includes(file)) continue;
    for (const match of code.matchAll(new RegExp(rule.source, 'g'))) {
      // 形态对上了还要过一遍语义过滤（例如方括号里拼出来的是不是 `setTimeout`）。
      if (rule.when !== undefined && !rule.when(match[1] ?? '')) continue;
      const at = match.index;
      const line = code.slice(0, at).split('\n').length;
      findings.push({
        file,
        line,
        text: (lines[line - 1] ?? '').trim(),
        snippet: snippetOf(code, at),
        rule,
        enclosing: enclosingOf(lines, line - 1),
      });
    }
  }
  return findings;
}

/**
 * 读一个被守文件并扫描。
 *
 * 四个 pick 文件有锚点断言（文件挪走/清空时立刻红，而不是「0 命中 = 通过」）；
 * `routes/` 的文件没有锚点，靠 {@link ROUTE_FILES} 的规模断言兜底。
 *
 * @param file - 相对包根的路径。
 * @returns 该文件的全部命中。
 */
function scanFile(file: string): Finding[] {
  const source = readFileSync(resolve(PACKAGE_ROOT, file), 'utf8');
  const anchor = ANCHORS[file];
  if (anchor !== undefined) {
    assert.ok(
      stripComments(source).includes(anchor),
      `${file} 里找不到锚点 ${anchor}：守卫扫描的对象可能已经错位（文件被挪走/被清空），` +
        '在修正 ANCHORS 之前，这条守卫生效与否都是未知的',
    );
  }
  return scanText(source, file);
}

/**
 * 过滤掉白名单覆盖的命中。
 *
 * @param findings - 全部命中。
 * @returns 没有正当理由的命中（应当为空）。
 */
function unexplainedOf(findings: readonly Finding[]): Finding[] {
  const perRule = new Map<string, number>();
  const unexplained: Finding[] = [];
  for (const finding of findings) {
    const key = `${finding.file}|${finding.rule.id}`;
    const seen = (perRule.get(key) ?? 0) + 1;
    perRule.set(key, seen);
    const allowance = ALLOWANCES.find((item) => item.file === finding.file && item.ruleId === finding.rule.id);
    if (allowance === undefined) {
      unexplained.push(finding);
      continue;
    }
    const allowed =
      seen <= allowance.max &&
      (allowance.enclosing === undefined || finding.enclosing === allowance.enclosing) &&
      (allowance.snippetIncludes === undefined || allowance.snippetIncludes.test(finding.snippet));
    // 超上限的计时器即使命中白名单也红：想放行必须在白名单里显式写 `exceedsIntervalCap`。
    const overCap = overCapOf(finding) !== undefined && allowance.exceedsIntervalCap !== true;
    if (!allowed || overCap) unexplained.push(finding);
  }
  return unexplained;
}

/**
 * 命中处的间隔是否超过规则上限。
 *
 * @param finding - 命中。
 * @returns 超上限时返回实际间隔（毫秒）；不适用或未超上限时 `undefined`。
 */
function overCapOf(finding: Finding): number | undefined {
  const cap = finding.rule.intervalCapMs;
  if (cap === undefined) return undefined;
  const interval = intervalOf(finding.snippet);
  return interval !== undefined && interval > cap ? interval : undefined;
}

/**
 * 把一条命中渲染成可定位的一行。
 *
 * @param finding - 命中。
 * @returns `${文件}:${行} → ${符号}「${代码}」`；间隔超上限时补一句实测间隔。
 */
function describeOf(finding: Finding): string {
  const base = `${finding.file}:${String(finding.line)} → ${finding.rule.what}「${finding.text}」`;
  const over = overCapOf(finding);
  if (over === undefined) return base;
  return `${base}（间隔 ${String(over)}ms > 上限 ${String(finding.rule.intervalCapMs)}ms）`;
}

/**
 * 取一个调用的实参区间：从 `name(` 的左括号到与它配对的右括号（含）。
 *
 * 用来检查心跳回调里到底有没有 `finish`/`resolve`/`reject`——只看那一句话，不扩大到整个文件。
 *
 * @param code - 去注释后的代码。
 * @param name - 调用名（如 `setInterval`）。
 * @returns 实参区间文本；找不到或不配对时返回 `undefined`。
 */
function callTextOf(code: string, name: string): string | undefined {
  const start = code.indexOf(`${name}(`);
  if (start < 0) return undefined;
  const open = start + name.length;
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  return undefined;
}

test('源码扫描：四个 pick 文件里没有「以时间为条件判失败」的路径', (t) => {
  const findings = PICK_FILES.flatMap((file) => scanFile(file));
  const unexplained = unexplainedOf(findings);
  t.diagnostic(
    `扫描 ${String(PICK_FILES.length)} 个 pick 文件：${String(findings.length)} 处计时器符号命中，` +
      `${String(findings.length - unexplained.length)} 处被白名单覆盖，${String(unexplained.length)} 处违规`,
  );
  assert.deepEqual(
    unexplained.map(describeOf),
    [],
    [
      '某文件新增了以时间为条件的失败路径，会重现「等久了就判失败」（review-report P2-2 指出的原始缺陷）：',
      ...unexplained.map((finding) => `  - ${describeOf(finding)}`),
      '',
      '选择框的结局只能来自确定的事实：选中 / 取消 / 弹不出来 / 调用方断开（signal）。',
      '确实需要观测时，只允许 `unref()` 过的日志心跳（照 `pick-folder.ts` 的 `PICK_WAIT_HEARTBEAT_MS` 写，',
      '回调里不许出现 finish/resolve/reject）；确实需要新的白名单，就在 change-report 里写明理由并同步 ALLOWANCES。',
    ].join('\n'),
  );
});

test('白名单：pick-folder.ts 的 setInterval 心跳只写日志，绝不参与结局判定', (t) => {
  const code = stripComments(readFileSync(resolve(PACKAGE_ROOT, 'src/host/pick-folder.ts'), 'utf8'));
  const intervals = code.match(/setInterval\s*\(/g) ?? [];
  assert.equal(
    intervals.length,
    1,
    'pick-folder.ts 里的计时器只允许那一个排障心跳；多了就说明有人接了新的定时逻辑（见上一条用例）',
  );
  const heartbeat = callTextOf(code, 'setInterval');
  assert.ok(heartbeat !== undefined, 'setInterval 的实参区间取不到：守卫可能扫错了位置');
  t.diagnostic(`心跳实参区间：${heartbeat.replace(/\s+/g, ' ')}`);
  for (const banned of ['finish', 'resolve', 'reject']) {
    assert.equal(
      heartbeat.includes(banned),
      false,
      `心跳回调里出现了 \`${banned}\`：那它就能按时间给出结局（「等久了就判失败」的原始缺陷）。` +
        '心跳只允许写一行日志，结局由 close/error/abort 决定。',
    );
  }
  assert.ok(
    /log\?\.warn|log\.warn/.test(heartbeat),
    '心跳回调必须只调 log 的 warn（否则它就不只是观测了）：' + heartbeat,
  );
  assert.ok(
    heartbeat.includes('PICK_WAIT_HEARTBEAT_MS'),
    '心跳间隔必须用 PICK_WAIT_HEARTBEAT_MS（10 分钟），别改成别的间隔：' + heartbeat,
  );
  const after = code.slice(code.indexOf('setInterval('), code.indexOf('setInterval(') + 400);
  assert.ok(after.includes('.unref'), '心跳必须 unref()，否则进程会被它拖住不退出（变异实测就是这么暴露的）');
});

test('白名单：bridge.js 的 45s 兜底只能待在 bridgeRequest，不得进 pick 链路', (t) => {
  const findings = scanFile('runtime/electron-helper/main/bridge.js');
  const timers = findings.filter((finding) => finding.rule.id === 'setTimeout');
  t.diagnostic(`bridge.js 的 setTimeout 命中：${timers.map((finding) => `第 ${String(finding.line)} 行`).join('、')}`);
  assert.equal(
    timers.length,
    1,
    'bridge.js 只允许 bridgeRequest 里那一个 45s 兜底；数量变了要么是有人加了新计时器，要么是删了旧的却没同步白名单',
  );
  const [only] = timers;
  assert.equal(
    only?.enclosing,
    'bridgeRequest',
    '那一个 45s 必须仍在 bridgeRequest 里，不能挪进 handlePick（pick 链路）',
  );
  assert.ok(/45_?000/.test(only?.snippet ?? ''), '白名单钉的是 45s 这个间隔：' + String(only?.snippet));
  assert.equal(
    unexplainedOf(findings).length,
    0,
    'bridge.js 出现了白名单之外的计时器符号：' + unexplainedOf(findings).map(describeOf).join('；'),
  );
});

test('扩面后的零误伤：pick 四个文件 + routes 生产文件的时限/形态规则命中数都是 0', (t) => {
  // review P3-1 的收口前提（本轮扩到 routes 后同口径）：把规则扩面时，**今天必须一处都不命中**，
  // 否则「扩面」会立刻变成「既有代码被判违规」。这条断言把那个前提钉在测试里：将来谁在这两面
  // 真的加了时限/转手，红的就是它（而不是等宽限期过去后由人回忆「当初扩面有没有误伤」）。
  const surface = [...PICK_FILES, ...ROUTE_FILES];
  const counts = surface.map((file) => {
    const findings = scanFile(file);
    const count = (id: string): number => findings.filter((finding) => finding.rule.id === id).length;
    return {
      file,
      abortSignalTimeout: count('abortSignalTimeout'),
      globalBracketTimer: count('globalBracketTimer'),
      abortSignalBracketTimer: count('abortSignalBracketTimer'),
      commaIndirection: count('commaIndirection'),
      requestTimeoutOption: count('requestTimeoutOption'),
    };
  });
  const total = counts.reduce(
    (sum, entry) =>
      sum +
      entry.abortSignalTimeout +
      entry.globalBracketTimer +
      entry.abortSignalBracketTimer +
      entry.commaIndirection +
      entry.requestTimeoutOption,
    0,
  );
  t.diagnostic(
    `扫描面 ${String(surface.length)} 个文件（pick=${String(PICK_FILES.length)} / routes=${String(
      ROUTE_FILES.length,
    )}）：四条时限/形态规则 + requestTimeoutOption 合计命中 ${String(total)}`,
  );
  for (const entry of counts) {
    for (const [id, value] of [
      ['abortSignalTimeout', entry.abortSignalTimeout],
      ['globalBracketTimer', entry.globalBracketTimer],
      ['abortSignalBracketTimer', entry.abortSignalBracketTimer],
      ['commaIndirection', entry.commaIndirection],
    ] as const) {
      assert.equal(
        value,
        0,
        `${entry.file} 出现 ${id}：给 pick 等待加时限（或换个写法取计时器）＝「到点就判失败」（P2-2 / P3-1）`,
      );
    }
  }
  // `timeout:` 只挂 pick 面（routes 里没有 `http.request`）：pick 面今日 0 命中。
  for (const entry of counts.filter((item) => PICK_FILES.includes(item.file))) {
    assert.equal(
      entry.requestTimeoutOption,
      0,
      `${entry.file} 的请求选项里出现了 \`timeout:\`：\`node:http\` 会按时间掐断等待（P2-2 / P3-1）`,
    );
  }
});

test('守卫自身有效：合成样本里的 180s 超时 / Promise.race / AbortController / timeoutMs 都会被抓住', () => {
  // 这一段就是 review-report M1b 的回归写法：间隔 180000（旧缺陷量级），单测观察窗口看不见它。
  const synthetic = [
    'const timer = setTimeout(() => { finish({ kind: "unsupported" }); }, 180000);',
    'await Promise.race([dialog, sleep(180000)]);',
    'const controller = new AbortController();',
    'const request = { title: "x", timeoutMs: 180000 };',
  ].join('\n');
  const hit = new Set(scanText(synthetic, 'synthetic.ts').map((finding) => finding.rule.id));
  for (const id of ['setTimeout', 'promiseRace', 'abortController', 'timeoutMs']) {
    assert.ok(hit.has(id), `守卫漏掉了 ${id}：这条用例就是为了证明它不是「永远绿」`);
  }
  // 注释里提到这些符号是允许的（文档要说明「已经删掉了什么」），判定前必须先剥注释。
  const onlyComments = scanText(
    [
      '// 老实现：await Promise.race([pick, sleep(180000)]);',
      '/* 常量 HELPER_PICK_CLIENT_TIMEOUT_MS 与 timeoutMs 已删除 */',
      'const ok = 1;',
    ].join('\n'),
    'synthetic.ts',
  );
  assert.deepEqual(
    onlyComments.map(describeOf),
    [],
    '注释里的提及不算违规：说明文字不是运行路径（剥注释这一步失效了才会红）',
  );
});

test('守卫自身有效（新规则）：setInterval 超上限 / 计时器别名 / dialog.ts 里的 `fetch(` 都会被抓住', () => {
  // ① setInterval(…, 180000)：规则抓得到，且间隔能取出来、被判为超上限。
  const intervals = scanText(
    'setInterval(() => { finish({ kind: "cancelled" }); }, 180000);',
    'src/host/pick-folder.ts',
  );
  const intervalFinding = intervals.find((finding) => finding.rule.id === 'setInterval');
  assert.ok(intervalFinding !== undefined, '`setInterval(` 没被抓住：这条守卫对「塞回一个定时器」失效');
  assert.equal(intervalOf(intervalFinding.snippet), 180_000, '间隔要从命中片段里取出来（最后一个数字实参）');
  assert.equal(overCapOf(intervalFinding), 180_000, '180s > 60s 上限：必须判为超上限');
  assert.equal(
    unexplainedOf(intervals).length,
    1,
    '180s 的 setInterval 必须红（心跳白名单钉的是 PICK_WAIT_HEARTBEAT_MS 那一个，不是任意一个）',
  );

  // ② 计时器别名赋值：在赋值处就红，不必等到调用处。
  const alias = scanText(
    ['const d = setTimeout;', 'd(() => finish({ kind: "cancelled" }), 180000);'].join('\n'),
    'src/host/pick-folder.ts',
  );
  assert.deepEqual(
    alias.map((finding) => finding.rule.id),
    ['timerAlias'],
    '`const d = setTimeout;` 这种转手必须被抓（否则换个名字就能绕过 setTimeout( 的检测）',
  );

  // ②b 成员形态的计时器别名：`const d = globalThis.setTimeout` 也要在赋值处就红（review P3-1）。
  const memberAlias = scanText(
    ['const d = globalThis.setTimeout;', 'd(() => undefined, 180000);'].join('\n'),
    'src/host/pick-folder.ts',
  );
  assert.deepEqual(
    memberAlias.map((finding) => finding.rule.id),
    ['timerAlias'],
    '`const d = globalThis.setTimeout` 这种成员取值形态必须被抓：只认裸 `= setTimeout` 等于留了个后门',
  );

  // ③ 全局请求实现：只对 A 通道客户端生效。
  const inDialog = scanText('const resp = await fetch("http://127.0.0.1:1/pick");', 'src/host/helper/dialog.ts');
  assert.ok(
    inDialog.some((finding) => finding.rule.id === 'globalFetch'),
    '`dialog.ts` 里出现 `fetch(` 必须红：那会把 300s 的响应头悬崖接回来',
  );
  // 同一个样本出现在别的文件里不算违规：bridge.js 的 `fetch(` 是短请求直连，有正当理由。
  assert.deepEqual(
    scanText('const resp = await fetch("/x");', 'runtime/electron-helper/main/bridge.js').map(describeOf),
    [],
    '`globalFetch` 的作用域必须限定在 `src/host/helper/dialog.ts`，否则会误伤 bridge.js 的宿主应答直连',
  );

  // ④ 「给等待加时限」的两种写法：`AbortSignal.timeout(…)` 与请求选项里的 `timeout:`（review P2-2 / P3-1）。
  //    作用域是全部四个 pick 文件：**每个文件各一条合成样本**都必须红，否则「在 B 通道侧造时限再传下去」
  //    这条路径会整个漏过去（review P3-1 实测：范围只写 `dialog.ts` 时，写进 `pick-folder.ts` 仍 5/5 全绿）。
  for (const file of PICK_FILES) {
    const timedIds = scanText(
      [
        'const deadline = AbortSignal.timeout(300000);',
        'const req = httpRequest(url, { method: "POST", timeout: 180000, agent: false });',
      ].join('\n'),
      file,
    ).map((finding) => finding.rule.id);
    assert.ok(
      timedIds.includes('abortSignalTimeout'),
      `${file}：\`AbortSignal.timeout(\` 必须红：本仓 voice/** 正在这么写，顺手抄进 pick 链路就会「到点判失败」`,
    );
    assert.ok(
      timedIds.includes('requestTimeoutOption'),
      `${file}：请求选项里的 \`timeout:\` 必须红：\`node:http\` 的 timeout 会按时间掐断等待（P2-2 的第二种形态）`,
    );
  }
  // 同口径的作用域：本仓别处的 `AbortSignal.timeout(` 是正当用法，不能被这两条规则误伤。
  assert.deepEqual(
    scanText('const deadline = AbortSignal.timeout(300000);', 'src/host/voice/gsv/client.ts').map(describeOf),
    [],
    '时限规则只盯 `PICK_FILES` 与 `ROUTE_FILES`：voice/** 的 16 处 `AbortSignal.timeout` 不是 pick 链路',
  );

  // 注释里的提及仍不算违规（剥注释必须先发生）。
  assert.deepEqual(
    scanText(
      [
        '// const d = setTimeout;',
        '/* fetch( 与 setInterval(…, 180000) 都已删除 */',
        '// const deadline = AbortSignal.timeout(300000);',
        '/* const req = httpRequest(url, { timeout: 180000 }); */',
        'const ok = 1;',
      ].join('\n'),
      'src/host/helper/dialog.ts',
    ).map(describeOf),
    [],
    '注释里的提及不算违规：说明文字不是运行路径（剥注释失效才会红）',
  );
});

test('stripComments：正则字面量不再劫持引号态（pick-folder.ts 失步已修，真实文件锚定）', () => {
  // 修复前的实测失步：`replace(/'/g, "''")` 的正则带引号，旧扫描器把正则里的 `'` 当成字符串引号，
  // 从那一行起「以为自己在字符串里」→ 之后的行内注释不被剥（注释里写 setInterval( 会被误判违规）。
  const synthetic = [
    "const t = (title ?? '默认').replace(/'/g, \"''\");",
    "const filter = extensions.length > 0 ? `文件 (${patterns})|${patterns}` : '所有文件 (*.*)';",
    '// 与目录框同一套理由：注释里的 setInterval( 必须被剥掉',
    'keepGoing(1);',
  ].join('\n');
  const code = stripComments(synthetic);
  assert.ok(!code.includes('setInterval('), '失步回归：行内注释没被剥掉（正则里的引号又被当成了字符串引号）');
  assert.ok(code.includes('keepGoing(1);'), '注释后面的真实代码被误吞：剥注释矫枉过正');

  // 真实文件锚定：pick-folder.ts 里就有失步源，且其后有一条行内注释——合成样本之外的双保险。
  const file = 'src/host/pick-folder.ts';
  const source = readFileSync(resolve(PACKAGE_ROOT, file), 'utf8');
  const stripped = stripComments(source);
  const regexLine = source.split('\n').findIndex((line) => line.includes("replace(/'/g"));
  assert.ok(regexLine >= 0, `${file} 里找不到 replace(/'/g：失步源已重构，请同步更新本用例的锚点`);
  const commentLine = source.split('\n').findIndex((line) => line.includes('// 与目录框同一套理由'));
  assert.ok(commentLine > regexLine, `${file} 的行内注释跑到失步点之前了：锚点失效，请同步更新本用例`);
  assert.ok(
    !(stripped.split('\n')[commentLine] ?? '').includes('与目录框同一套理由'),
    `${file}:${String(commentLine + 1)} 的行内注释没被剥掉：stripComments 从正则字面量起失步（修复前就是这条症状）`,
  );
  assert.ok(
    stripped.includes('System.Windows.Forms'),
    '失步点之后行的真实代码被误吞：正则识别矫枉过正（内容必须原样保留）',
  );
  // 同长度不变量：剥注释只把注释字符换成空格，不增删任何字符（行号可直接对应的前提）。
  assert.equal(stripped.length, source.length, 'stripComments 的输出长度必须与输入一致');
});

test('lastArgumentOf：正则字面量里的引号/逗号不再劫持实参切分（断言解值）', () => {
  // 修复前：正则里的 `'` 会打开一个关不上的假字符串态 → 整段括号配对失效 → 间隔解不出来。
  // 这条旧实现必红（返回 undefined），新实现必须解出 60000。
  assert.equal(
    intervalOf("setInterval(cb, /'/.test(x) ? 1 : 2, 60000)"),
    60_000,
    '正则里的引号劫持了字符串态：60000 解不出来（旧失步同族）',
  );
  // 除法仍是除法：`/` 前面是数字时不许被误判成正则开头（误判会把四则实参吞掉）。
  assert.equal(
    intervalOf('setInterval(cb, 60000 / 3)'),
    20_000,
    '数字后的除法被误判为正则：四则实参 60000/3 解不出 20000',
  );
  // `++` / `--` 后的 `/` 是除法：没有这条保护，`count++ / 2` 的 `/` 会被当成正则开头。
  assert.equal(
    intervalOf('setInterval(cb, count++ / 2, 45000)'),
    45_000,
    '`++` 后的除法被误判为正则：45000 会取错段或取不到',
  );
  // 既有行为不回退：字符串里的逗号照旧不参与切分；回调带逗号照旧取到最后一段。
  assert.equal(intervalOf("setInterval(() => log('a,b'), 45000)"), 45_000, '字符串里的逗号必须继续被忽略');
  assert.equal(intervalOf('setInterval(() => log(a, b), 60000)'), 60_000, '回调实参里的逗号切分回归面');
});

test('intervalOf：数值求值覆盖十进制/下划线/0x/0b/0o/指数/小数与四则，**断言解值**', () => {
  // 为什么必须断言解值：`180_000` 在旧正则下本来就能红，「只断言红」证明不了修复；
  // 旧实现的真实缺口是 `1e5` / `1.8e5` / `0x2BF20` / `60 * 1000` 解不出数——
  // `overCapOf` 给不出数值，于是「允许一个 10 万毫秒定时器」与「允许一个心跳」在白名单里长得一样。
  const cases: readonly (readonly [string, number])[] = [
    ['setInterval(cb, 180000)', 180_000],
    ['setInterval(cb, 180_000)', 180_000],
    ['setInterval(cb, 1e5)', 100_000],
    ['setInterval(cb, 1.8e5)', 180_000],
    ['setInterval(cb, 0x2BF20)', 180_000],
    ['setInterval(cb, 0b10101)', 21],
    ['setInterval(cb, 0o17)', 15],
    ['setInterval(cb, 60 * 1000)', 60_000],
    ['setInterval(cb, 2 * 60_000)', 120_000],
    ['setInterval(cb, 180000 / 3)', 60_000],
    ['setInterval(cb, (60) * 1000)', 60_000],
    ['setInterval(cb, -1000)', -1_000],
  ];
  for (const [snippet, expected] of cases) {
    assert.equal(
      intervalOf(snippet),
      expected,
      `${snippet} 应当解出 ${String(expected)}（解不出数，上限比较就退化成「白名单说放行就放行」）`,
    );
  }

  // 认不出的形状：返回 undefined → 调用处退回基础形态判定（`setInterval(` 照样红，只是不做上限比较）。
  const opaque = [
    'setInterval(cb, PICK_WAIT_HEARTBEAT_MS)',
    'setInterval(cb, `60000`)',
    'setInterval(cb, Math.max(60000, 1))',
    'setInterval(cb, 1000 / 0)',
    'setInterval(cb, 60000 + foo)',
    'setInterval(cb, 1e999)',
  ];
  for (const snippet of opaque) {
    assert.equal(intervalOf(snippet), undefined, `${snippet}：认不出就该返回 undefined，不许猜`);
  }

  // 顶层逗号切分：回调里带逗号、对象/数组实参都不能把「最后一段」切错。
  assert.equal(intervalOf('setInterval(() => log(a, b), 60000)'), 60_000, '回调里的逗号不许把间隔切丢');
  assert.equal(intervalOf('setInterval(() => run({ a: 1, b: 2 }, [3, 4]), 45000)'), 45_000, '对象/数组实参同理');
  assert.equal(intervalOf('setInterval(() => undefined, 1)'), 1, '最短的那一种也要认');
});

test('overCapOf：五种「换个写法」的 60s 以上间隔都给得出数值并判超上限', () => {
  const cases: readonly (readonly [string, number])[] = [
    ['setInterval(() => log.warn("tick"), 1e5)', 100_000],
    ['setInterval(() => log.warn("tick"), 1.8e5)', 180_000],
    ['setInterval(() => log.warn("tick"), 0x2BF20)', 180_000],
    ['setInterval(() => log.warn("tick"), 180_000)', 180_000],
    ['setInterval(() => log.warn("tick"), 60 * 1000)', 60_000],
  ];
  for (const [source, expected] of cases) {
    const finding = scanText(source, 'src/host/pick-folder.ts').find((item) => item.rule.id === 'setInterval');
    assert.ok(finding !== undefined, `${source}：setInterval 没被抓到，守卫对「塞回一个定时器」失效`);
    assert.equal(intervalOf(finding.snippet), expected, `${source} 的间隔解值`);
    // 上限是 60s：正好等于上限的 `60 * 1000` 不超；其余四种都必须判超。
    assert.equal(
      overCapOf(finding),
      expected > 60_000 ? expected : undefined,
      `${source}：超过 60s 上限必须判出来（否则白名单里写 1e5 也能静默通过）`,
    );
  }
});

test('三条静态形态规则：方括号取计时器 / AbortSignal 方括号 / 逗号转手都会红', () => {
  const samples: readonly (readonly [string, string])[] = [
    ["globalThis['set' + 'Timeout'](() => undefined, 1);", 'globalBracketTimer'],
    ['globalThis["set" + "Interval"](() => undefined, 1);', 'globalBracketTimer'],
    ["globalThis['setTi' + 'meout'](() => undefined, 1);", 'globalBracketTimer'],
    ["window['set' + 'Timeout'](() => undefined, 1);", 'globalBracketTimer'],
    ["AbortSignal['time' + 'out'](300000);", 'abortSignalBracketTimer'],
    ['(0, setTimeout)(() => undefined, 180000);', 'commaIndirection'],
    ['(0, AbortSignal.timeout)(300000);', 'commaIndirection'],
  ];
  for (const [source, id] of samples) {
    const ids = scanText(source, 'src/host/pick-folder.ts').map((finding) => finding.rule.id);
    assert.ok(ids.includes(id), `${source} 必须命中 ${id}：任意切分/逗号转手都是「换个写法就能绕过」的口子`);
  }

  // 负向边界：这七类**拦不住**，写成可执行的，防止下一轮有人误以为这条规则全知。
  // 文件头的「已知边界」段与本用例是同一份事实的两处表达，改一处必须改另一处。
  const boundaries = [
    // ① 变量参与拼接
    "globalThis['set' + name](() => undefined, 1);",
    // ② 模板串插值
    'globalThis[`set${"Timeout"}`](() => undefined, 1);',
    // ③ 跨行拼接
    "globalThis['set' +\n  'Timeout'](() => undefined, 1);",
    // ④ 更远的间接·反射
    'Reflect.get(globalThis, "setTimeout")(() => undefined, 1);',
    // ⑤ 更远的间接·求值
    'eval("setTimeout")(() => undefined, 1);',
    // ⑥ 更远的间接·函数化
    'new Function("return setTimeout")()(() => undefined, 1);',
    // ⑦ 运行时改写全局（样本里不得出现 `setTimeout(` 这类会被既有规则抓住的形态，钉的是「这条规则拦不住」）
    'Object.defineProperty(globalThis, "setTimeout", { value: globalThis.setTimeout });',
  ];
  for (const source of boundaries) {
    assert.deepEqual(
      scanText(source, 'src/host/pick-folder.ts').map(describeOf),
      [],
      `${source}：已知边界（变量/模板串/跨行/反射），规则拦不住；这是诚实记录，不是回归`,
    );
  }
});

test('routes 面：`src/host/routes/layout.ts` 里出现 `AbortSignal.timeout(` 必须红', () => {
  // routes 是 pick 链路的上游调用方：在路由里造时限再作为 signal 传下来，到点同样是 `aborted`
  // → 路由 `{kind:'none'}` → 一个字节都不写（用户「点了没反应」）。
  const ids = scanText('const deadline = AbortSignal.timeout(300000);', 'src/host/routes/layout.ts').map(
    (finding) => finding.rule.id,
  );
  assert.ok(ids.includes('abortSignalTimeout'), 'routes 面必须能抓住 `AbortSignal.timeout(`：这就是扩面的意义');
  // 同一批新规则也在 routes 面上生效（三条形态规则与 `AbortSignal.timeout` 同面）。
  const forms = scanText(
    ["globalThis['set' + 'Timeout'](() => undefined, 1);", '(0, setTimeout)(() => undefined, 180000);'].join('\n'),
    'src/host/routes/state.ts',
  ).map((finding) => finding.rule.id);
  assert.ok(forms.includes('globalBracketTimer'), 'routes 面：方括号取计时器也要红');
  assert.ok(forms.includes('commaIndirection'), 'routes 面：逗号转手也要红');
});

test('扫描面自身完整性：pick-*.ts 全登记、reason 非空够长、ROUTE_FILES 规模与必含文件', () => {
  // 防「漏登记就静默全绿」：`src/host/` 下新增一个 `pick-file.ts`，这条立刻红。
  const unregistered = readdirSync(resolve(PACKAGE_ROOT, 'src/host'))
    .filter((name) => /^pick-.*\.ts$/.test(name) && !name.endsWith('.test.ts'))
    .map((name) => `src/host/${name}`)
    .filter((file) => !PICK_FILES.includes(file));
  assert.deepEqual(
    unregistered,
    [],
    `这些 pick 源文件没登记进 PICK_SOURCES，等于不在守卫面上：${unregistered.join('、')}`,
  );

  for (const source of PICK_SOURCES) {
    assert.ok(
      source.reason.trim().length >= 12,
      `${source.file} 的 reason 太短（≥12 字符）：写清「为什么它属于这条不变量」，别拿空串应付`,
    );
  }
  assert.equal(
    new Set(PICK_FILES).size,
    PICK_SOURCES.length,
    '同一个文件登记两次＝有一条被静默吞掉（白名单与失败信息会指错地方）',
  );

  // 防假绿：目录改名/清空后 `ROUTE_FILES` 会变空，那三条规则的「0 命中」就毫无意义。
  assert.ok(
    ROUTE_FILES.length >= 20,
    `routes 扫描面只剩 ${String(ROUTE_FILES.length)} 个文件：目录被改名/清空时规则会静默全绿`,
  );
  assert.ok(
    ROUTE_FILES.includes('src/host/routes/layout.ts'),
    'routes 面必须含 `layout.ts`（`/pick-folder`、`/pick-file` 就在里面）',
  );
});
