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
 * 已知边界：剥注释是「字符串感知」的字符扫描，不是完整 JS 词法器；正则字面量里若出现引号，
 * 归属判定可能变粗——但判据是「有没有这个符号」，不会因此漏掉真实计时器。
 * 同理挡不住**算出来的**名字：`globalThis['set' + 'Timeout']`、`(0, eval)('setTimeout')`、
 * `AbortSignal['time' + 'out']` 这类拼接一律穿透（要拦住它们得换成 AST/词法级扫描，或引入依赖）。
 * 规则拦的是「正常会写出来的形态」——包括 `= globalThis.setTimeout` 这种成员取值，与既有守卫口径一致。
 * 失败信息一律指向可执行的下一步，而不是「assert 失败」。
 * @module dsh-fish-body/src/host/pick-no-timeout-guard.test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** `dsh-pet` 包根（本文件在 `src/host/`）。 */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * 被守的四个源码文件（相对包根）：B 通道宿主、A 通道客户端、helper 侧对话框、helper 协议桥。
 *
 * 少一个都算守卫失效——这四处合起来才是「点一次选择…」的整条链路。
 */
const PICK_SOURCES = [
  'src/host/pick-folder.ts',
  'src/host/helper/dialog.ts',
  'runtime/electron-helper/main/dialog.js',
  'runtime/electron-helper/main/bridge.js',
] as const;

/**
 * 每个文件剥离注释后**必须仍然存在**的锚点：防止「文件被挪走 / 被清空」时守卫静默变成全绿。
 *
 * 取值都是该文件独有的真实符号（不是注释里的措辞）。
 */
const ANCHORS: Readonly<Record<string, string>> = {
  'src/host/pick-folder.ts': 'pickPathOnce',
  'src/host/helper/dialog.ts': 'createHelperDialog',
  'runtime/electron-helper/main/dialog.js': 'showOpenDialog',
  'runtime/electron-helper/main/bridge.js': 'handlePick',
};

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
    // 本仓 voice/**、vision.ts 等 16 处是正当用法（长耗时推理必须有时限）；pick 链路相反，只盯四个 pick 文件。
    // 四个文件而不是 `dialog.ts`（review P3-1）：在 `pick-folder.ts` 造时限再作为 signal 传进 A 通道，
    // 到点同样是 `aborted` → `{kind:'none'}`（用户「点了没反应」），所以扫描面就是整条链路。
    files: PICK_SOURCES,
  },
  {
    id: 'requestTimeoutOption',
    source: '\\btimeout\\s*:',
    what: '请求选项里的 timeout（`node:http` 的 timeout 会按时间掐断等待，P2-2）',
    // 同上：四个 pick 文件剥注释后 0 命中；`timeoutMs` / `TimeoutError` 这类标识量与错误名不会被它命中。
    files: PICK_SOURCES,
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
 * 剥掉 `//` 与 `/* *\/` 注释，**保留换行与长度**（把注释字符换成空格）。
 *
 * 为什么不用正则一把梭：本仓代码里有 `'http://127.0.0.1:…'` 这种字符串，`//` 出现在字符串里时
 * 不能被当成行注释，否则后面整段真实代码会被吃掉、守卫变成假的绿。
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
 * 从命中片段里取「最后一个数字实参」当作间隔。
 *
 * 只认字面量（`180000` / `1_000`）：标识量（如 `PICK_WAIT_HEARTBEAT_MS`）取不到值就返回
 * `undefined`，规则退回基础形态判定——不猜常量的值，也不因为猜不到就放行。
 *
 * @param snippet - {@link Finding.snippet}。
 * @returns 毫秒数；取不到时 `undefined`。
 */
function intervalOf(snippet: string): number | undefined {
  const matches = [...snippet.matchAll(/,\s*([\d][\d_]*)\s*\)/g)];
  const raw = matches[matches.length - 1]?.[1];
  if (raw === undefined) return undefined;
  const value = Number(raw.replace(/_/g, ''));
  return Number.isFinite(value) ? value : undefined;
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
 * 读一个被守文件并扫描；顺带断言锚点还在（文件挪走/清空时立刻红，而不是「0 命中 = 通过」）。
 *
 * @param file - 相对包根的路径。
 * @returns 该文件的全部命中。
 */
function scanFile(file: string): Finding[] {
  const source = readFileSync(resolve(PACKAGE_ROOT, file), 'utf8');
  const code = stripComments(source);
  const anchor = ANCHORS[file];
  assert.ok(
    anchor !== undefined && code.includes(anchor),
    `${file} 里找不到锚点 ${String(anchor)}：守卫扫描的对象可能已经错位（文件被挪走/被清空），` +
      '在修正 ANCHORS 之前，这条守卫生效与否都是未知的',
  );
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
  const findings = PICK_SOURCES.flatMap((file) => scanFile(file));
  const unexplained = unexplainedOf(findings);
  t.diagnostic(
    `扫描 ${String(PICK_SOURCES.length)} 个 pick 文件：${String(findings.length)} 处计时器符号命中，` +
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

test('扩面后的零误伤：四个 pick 文件里 `AbortSignal.timeout` / `timeout:` 的当前命中数都是 0', (t) => {
  // review P3-1 的收口前提：把两条时限规则从 `dialog.ts` 扩到四个 pick 文件时，**今天必须一处都不命中**，
  // 否则「扩面」会立刻变成「既有代码被判违规」。这条断言把那个前提钉在测试里：将来谁在这四个文件里
  // 真的加了时限，红的就是它（而不是等宽限期过去后由人回忆「当初扩面有没有误伤」）。
  const counts = PICK_SOURCES.map((file) => {
    const findings = scanFile(file);
    return {
      file,
      abortSignalTimeout: findings.filter((finding) => finding.rule.id === 'abortSignalTimeout').length,
      requestTimeoutOption: findings.filter((finding) => finding.rule.id === 'requestTimeoutOption').length,
    };
  });
  t.diagnostic(
    `时限规则命中：${counts
      .map(
        (entry) =>
          `${entry.file} abortSignalTimeout=${String(entry.abortSignalTimeout)} requestTimeoutOption=${String(
            entry.requestTimeoutOption,
          )}`,
      )
      .join('；')}`,
  );
  for (const entry of counts) {
    assert.equal(
      entry.abortSignalTimeout,
      0,
      `${entry.file} 出现了 \`AbortSignal.timeout(\`：给 pick 等待加时限＝「到点就判失败」（P2-2 / P3-1）`,
    );
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
  for (const file of PICK_SOURCES) {
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
    '时限规则只盯 `PICK_SOURCES` 那四个文件：voice/** 的 16 处 `AbortSignal.timeout` 不是 pick 链路',
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
