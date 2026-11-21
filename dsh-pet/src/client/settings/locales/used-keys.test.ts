/**
 * 防复发：设置页里 `t(…)` 引用的每个键，都必须在 `zh` 字典里真实存在。
 *
 * 为什么需要这条：`t()` 对缺失的键不会报错，而是把键名原样印出来。真机上出现过
 * 「系统对话框标题印着 `voiceImportText`」「保存失败时印着 `fish.saveFailed`」——
 * 类型系统管不到「拼错的键名」（`t` 收的是 `string`），只有对账才发现。
 *
 * 扫描范围：`src/client/settings/**` 下所有非测试源码，排除 `locales/` 目录本身。
 * 约定：设置页的组件一律使用设置页字典（`NS`），引用别的命名空间的键会在这里被拦下——
 * 那说明该组件用错了翻译器，而不是守卫误报。
 *
 * 扫描方式：读 TypeScript 语法树取每个 `t(…)` 实参里**值位置**的字面量，不再用正则。
 * 起因（review-report P2-1）：正则 `t('字面量')` 只认「括号里恰好一个单引号串」，
 * `t(failed ? 'loadError' : 'loading')` 这类纯字面量三元整片漏扫——那些键从字典删掉时守卫仍是绿的。
 * 语法树版本覆盖两种写法：
 *   - `cond ? t('a') : t('b')`：本来就是两个调用，各自命中；
 *   - `t(cond ? 'a' : 'b')`：一个调用、实参是三元，取两支（`?` 左侧是条件，**不**当键）。
 * 也不会把比较用的字面量当键（`dialog.kind === 'corrupt' ? …` 里的 `'corrupt'` 是枚举值）。
 *
 * 拼接式键（`t('motion.' + key)`、模板串、`t(NUMBER_LABELS[key])`）静态判不了，不在守卫范围：
 * 那种键名的正确性由相邻的常量表（`WEIGHT_KEYS`）与它自己的类型保证。这类调用会被计为
 * 「依赖运行时」并打印在第一条用例的诊断里，数量变了就是有人新增/删掉了拼接键。
 * @module dsh-fish-body/src/client/settings/locales/used-keys.test
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { zh } from './index.ts';

/** 本文件所在目录（= `src/client/settings/locales`）。 */
const HERE = dirname(fileURLToPath(import.meta.url));
/** 设置页客户端源码根（`src/client/settings`）。 */
const SETTINGS_ROOT = resolve(HERE, '..');

/**
 * 递归收集设置页源码（排除 `locales/` 与测试文件）。
 *
 * @param dir - 起始目录。
 * @param out - 累加器。
 * @returns 绝对路径清单。
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'locales') continue;
      sourceFiles(full, out);
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** 一处挂在字典上的键引用。 */
interface KeyRef {
  /** 相对 `src/client/settings` 的路径（报错时给人看）。 */
  readonly file: string;
  /** 1 起的行号。 */
  readonly line: number;
  /** 引用到的键名。 */
  readonly key: string;
}

/** 一次 `t(…)` 实参的静态结论。 */
interface ArgKeys {
  /** 实参**可能**取值里静态可判定的那些（比较运算、拼接、变量取值一律不进）。 */
  readonly keys: readonly string[];
  /** `true` = 实参的取值全在这份 `keys` 里；`false` = 还有运行时才知道的分支。 */
  readonly exact: boolean;
}

/** 实参取值依赖运行时（`t(key)`、`t(a + b)`、模板串）：静态判不了，也不该猜。 */
const RUNTIME_VALUE: ArgKeys = { keys: [], exact: false };

/** 实参一定不是键（比较结果、`!'x'` 这类布尔）：静态确定，且没有键要检查。 */
const NOT_A_KEY: ArgKeys = { keys: [], exact: true };

/** 结果可能是两侧之一（`??` / `||` / `&&`）。 */
const BRANCH_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
]);

/** 比较类运算符：结果是布尔，两侧的字面量是枚举值而不是键。 */
const COMPARE_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
]);

/**
 * 两支合并：键取并集，`exact` 取交集（任一支有运行时成分，整体就不是全判定的）。
 *
 * @param left - 一支的结论。
 * @param right - 另一支的结论。
 * @returns 合并结论。
 */
function unionOf(left: ArgKeys, right: ArgKeys): ArgKeys {
  return { keys: [...new Set([...left.keys, ...right.keys])], exact: left.exact && right.exact };
}

/**
 * `+` 的两侧：只有两侧都是单个字面量时才拼得出确定的键。
 *
 * `t('motion.' + key)` 里的 `'motion.'` 是**前缀**而不是键，所以任一侧不可判定时整条放弃。
 *
 * @param left - 左侧结论。
 * @param right - 右侧结论。
 * @returns 拼接结论。
 */
function concatOf(left: ArgKeys, right: ArgKeys): ArgKeys {
  if (left.keys.length === 0 && left.exact) return right.keys.length === 0 ? NOT_A_KEY : RUNTIME_VALUE;
  if (!left.exact || !right.exact) return RUNTIME_VALUE;
  if (left.keys.length !== 1 || right.keys.length !== 1) return RUNTIME_VALUE;
  return { keys: [String(left.keys[0]) + String(right.keys[0])], exact: true };
}

/**
 * 一个表达式在「值位置」上可能是哪些字面量。
 *
 * 只认几种静态可判的形状：字面量、三元两支、`??`/`||`/`&&` 两侧、括号与 `as` 断言、
 * 纯字面量拼接。比较运算两侧是枚举值（`dialog.kind === 'corrupt'`），返回 {@link NOT_A_KEY}。
 *
 * @param node - 表达式节点。
 * @returns 结论。
 */
function keysOfExpression(node: ts.Expression): ArgKeys {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text === '' ? NOT_A_KEY : { keys: [node.text], exact: true };
  }
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return keysOfExpression(node.expression);
  }
  if (ts.isConditionalExpression(node)) {
    return unionOf(keysOfExpression(node.whenTrue), keysOfExpression(node.whenFalse));
  }
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    if (BRANCH_OPERATORS.has(operator)) return unionOf(keysOfExpression(node.left), keysOfExpression(node.right));
    if (COMPARE_OPERATORS.has(operator)) return NOT_A_KEY;
    if (operator === ts.SyntaxKind.PlusToken)
      return concatOf(keysOfExpression(node.left), keysOfExpression(node.right));
    return RUNTIME_VALUE;
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) return NOT_A_KEY;
  return RUNTIME_VALUE;
}

/**
 * 被调用的表达式是不是设置页的翻译函数。
 *
 * 两种写法都收：解构出来的裸 `t(…)`，以及 `xxx.t(…)`（与旧正则 `\bt\(` 的覆盖面一致）。
 *
 * @param expression - `CallExpression.expression`。
 * @returns 是翻译函数则 `true`。
 */
function isTranslator(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return expression.text === 't';
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text === 't';
  return false;
}

/** 一个文件的扫描结论。 */
interface FileScan {
  /** 静态可判定的键引用（含重复）。 */
  readonly refs: KeyRef[];
  /** `t(…)` 调用总数。 */
  readonly calls: number;
  /** 实参有运行时成分的调用数（这些键名静态判不了）。 */
  readonly unresolved: number;
}

/**
 * 扫一个文件：收下每个 `t(…)` 实参里静态可判定的键。
 *
 * @param file - 绝对路径。
 * @param relative - 报错用的相对路径。
 * @returns 该文件的结论。
 */
function scanFile(file: string, relative: string): FileScan {
  const parsed = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const refs: KeyRef[] = [];
  let calls = 0;
  let unresolved = 0;
  /** 深度优先走完整棵树：`t(…)` 可能嵌在 `h(…)`、`field(…)` 的参数里。 */
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTranslator(node.expression)) {
      const arg = node.arguments[0];
      const found = arg === undefined ? NOT_A_KEY : keysOfExpression(arg);
      calls += 1;
      if (!found.exact) unresolved += 1;
      const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
      for (const key of found.keys) refs.push({ file: relative, line, key });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return { refs, calls, unresolved };
}

/** 全量扫描结论。 */
interface SettingsScan extends FileScan {
  /** 扫到的源码文件数。 */
  readonly files: number;
}

/**
 * 扫整个设置页源码。
 *
 * @returns 全部结论。
 */
function scanSettings(): SettingsScan {
  const files = sourceFiles(SETTINGS_ROOT);
  const refs: KeyRef[] = [];
  let calls = 0;
  let unresolved = 0;
  for (const file of files) {
    const relative = file.slice(SETTINGS_ROOT.length + 1).replace(/\\/g, '/');
    const scan = scanFile(file, relative);
    refs.push(...scan.refs);
    calls += scan.calls;
    unresolved += scan.unresolved;
  }
  return { refs, calls, unresolved, files: files.length };
}

/** 两个用例共用同一份扫描结果（解析 100+ 个文件不必做两遍）。 */
let cachedScan: SettingsScan | undefined;

/**
 * 取（或第一次取时算）全量扫描结论。
 *
 * @returns 扫描结论。
 */
function settingsScan(): SettingsScan {
  cachedScan ??= scanSettings();
  return cachedScan;
}

/**
 * 只由「三元里的字面量」引用的键：正则版本一个都扫不到（review-report P2-1 点名的受害样本）。
 *
 * 它们必须出现在扫描结果里——否则守卫等于对三元写法离线。2026-11 之前的实测：这 6 个键
 * 在设置页里只出现在 `t(cond ? 'a' : 'b')` 中，删掉任一个，旧正则守卫仍全绿。
 */
const TERNARY_ONLY_KEYS = [
  'loadError',
  'corruptTitle',
  'confirmTitle',
  'saveInvalid',
  'whisperModelLabel',
  'chatModelLabel',
] as const;

/**
 * 比较用的枚举值（`dialog.kind === 'corrupt'`、`key === 'whisperModel'`）：不是字典键。
 *
 * 守卫必须**不**把它们收进键集，否则每加一个比较式就多一条误报。
 */
const COMPARED_LITERALS = ['corrupt', 'whisperModel'] as const;

test('每个 t(…) 的键都在字典里：否则 UI 会印出键名而不是文案', (t) => {
  const known = new Set(Object.keys(zh));
  const { refs, calls, unresolved, files } = settingsScan();
  const missing: string[] = [];
  for (const ref of refs) {
    if (!known.has(ref.key)) missing.push(`${ref.file}:${String(ref.line)} → t('${ref.key}')`);
  }
  const distinct = new Set(refs.map((ref) => ref.key));
  t.diagnostic(
    `扫描 ${String(files)} 个设置页源码文件：${String(calls)} 处 t(…) 调用，` +
      `${String(refs.length)} 处字面量键引用（${String(distinct.size)} 个不同的键），` +
      `${String(unresolved)} 处依赖运行时（拼接键，不在守卫范围）`,
  );
  assert.ok(files > 50, '扫描到的源码太少，守卫本身可能失效了：' + String(files));
  assert.ok(
    refs.length > 500,
    "字面量键引用少于 500 处：守卫大概退回「只认 t('字面量')」，三元里的键又漏了：" + String(refs.length),
  );
  assert.deepEqual(missing, [], '某个键被引用但字典里没有，UI 会印出键名（不是文案）：\n' + missing.join('\n'));
});

test("三元里的字面量键也在守卫范围（正则版只认 t('字面量')）", (t) => {
  const collected = new Set(settingsScan().refs.map((ref) => ref.key));
  const missed = TERNARY_ONLY_KEYS.filter((key) => !collected.has(key));
  t.diagnostic(
    `三元字面量键命中 ${String(TERNARY_ONLY_KEYS.length - missed.length)}/${String(TERNARY_ONLY_KEYS.length)}：` +
      TERNARY_ONLY_KEYS.join(', '),
  );
  assert.deepEqual(missed, [], '这些键只在三元里出现，扫描漏掉它们等于守卫漏掉它们：' + missed.join(', '));
  const wrong = COMPARED_LITERALS.filter((token) => collected.has(token));
  assert.deepEqual(wrong, [], '比较用的枚举值不是字典键，不能收进键集（否则守卫会误报）：' + wrong.join(', '));
});
