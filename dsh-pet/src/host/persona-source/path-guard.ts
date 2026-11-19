/**
 * 自定义来源的路径闸门：`POST /persona/scan` 的 `path` 与 `custom` 来源的 `probe` 共用这一份判定。
 *
 * 为什么必须收口：`existsSync('fish-soul/persona.json')` 按**进程 cwd** 解析，而 cwd 是宿主进程的
 * 任意目录——只要用户（或注入进来的脚本）能给一个相对路径或 `..\..\` 穿越，就能把数据根之外的
 * 任意可读文件当人设导入。这里把「必须是绝对路径」与「必须落在允许根内」两条一起钉死。
 *
 * 允许根：插件数据根（`<userRoot>`）与 `DSH_HOME`。判定用 `realpath` 之后的实际路径，
 * 符号链接指到根外同样算越界。
 * @module dsh-fish-body/src/host/persona-source/path-guard
 */
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

/** 校验结论：能扫的绝对路径，或两类可读失败（相对/越界 = bad-request，根内不存在 = not-found）。 */
export type CardPathOutcome =
  { ok: true; path: string } | { ok: false; reason: 'bad-request' | 'not-found'; message: string };

/** 规范化根：先 resolve，能 realpath 就用真身（数据根常是符号链接 / 8.3 短名）。 */
function normalizeRoot(root: string): string {
  const trimmed = root.trim();
  if (trimmed === '') return '';
  try {
    return realpathSync(trimmed);
  } catch {
    return resolve(trimmed);
  }
}

/** 目标是否等于某个根，或位于其下（按分隔符判边界，避免 `/data2` 冒充 `/data`）。 */
function insideAny(target: string, roots: readonly string[]): boolean {
  return roots.some((root) => root !== '' && (target === root || target.startsWith(root + sep)));
}

/**
 * 校验并规范化 `path` 输入。
 *
 * @param raw - 请求里的原值。
 * @param allowedRoots - 允许的根（数据根、`DSH_HOME`）。
 * @returns 通过时给 realpath 之后的绝对路径；失败给 `bad-request`（相对 / 越界）或 `not-found`（根内不存在）。
 */
export function resolveCardPathInput(raw: string, allowedRoots: readonly string[]): CardPathOutcome {
  const value = (raw ?? '').trim();
  if (value === '') {
    return { ok: false, reason: 'bad-request', message: 'path 必填：自定义来源需要一个绝对路径' };
  }
  if (!isAbsolute(value)) {
    // 相对路径会按宿主进程 cwd 解析——那里的东西不该被当成人设读进来。
    return { ok: false, reason: 'bad-request', message: `path 必须是绝对路径（收到相对路径：${value}）` };
  }

  const exists = existsSync(value);
  let target: string;
  try {
    target = exists ? realpathSync(value) : join(realpathOf(dirname(value)), basename(value));
  } catch {
    return { ok: false, reason: 'bad-request', message: `path 无法解析：${value}` };
  }

  if (!insideAny(target, allowedRoots.map(normalizeRoot))) {
    return { ok: false, reason: 'bad-request', message: '路径不在允许的目录内（数据根或 DSH_HOME）' };
  }
  if (!exists) return { ok: false, reason: 'not-found', message: `路径不存在: ${value}` };
  return { ok: true, path: target };
}

/** 取目录的 realpath；目录不存在时退回 resolve，让后续的存在性检查给出 not-found。 */
function realpathOf(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return resolve(dir);
  }
}
