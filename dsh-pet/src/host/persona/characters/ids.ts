/**
 * 角色 id 与指纹：角色库、扫描去重与配置校验共用的唯一一份规则。
 *
 * 纯函数、零 IO；正则来自 `host/config/validate.ts`（读写两侧同一份，别在这里再写一遍）。
 * @module dsh-fish-body/src/host/persona/characters/ids
 */
import { createHash } from 'node:crypto';
import { characterIdValid } from '../../config/validate.ts';

/** 角色 id 的合法性：与宿主配置读写、设置页表单共用同一份（见 config/validate.ts）。 */
export { characterIdValid };

/** 冲突后缀的上限：`-2` … `-99`，再多就说明命名有问题，交给调用方回 bad-request。 */
const MAX_SUFFIX = 99;

/**
 * 名字 → 角色 id。
 *
 * 规则（与方案 §3.3 一致）：转小写 → 连续空白/下划线转 `-` → 剔除 `[^\p{L}\p{N}._-]`
 * → 折叠连续 `-` → 去首尾 `-`。中文名归一化后往往仍是中文（`鱼生` → `鱼生`），这是允许的：
 * id 会直接当文件名用，而校验正则已排除路径分隔符与保留字符。
 *
 * @param name - 角色名（可能是空串 / 全是符号）。
 * @returns 归一化后的 id；结果为空时返回空串，由调用方用指纹兜底。
 */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_]+/gu, '-')
    .replace(/[^\p{L}\p{N}._-]/gu, '')
    .replace(/-{2,}/gu, '-')
    .replace(/^[-.]+|[-.]+$/gu, '');
}

/**
 * 全符号名的兜底 id：`character-<指纹前 8 位>`。
 *
 * @param fingerprint - 正文指纹（{@link fingerprintOf} 的结果）。
 * @returns 一定合法的 id。
 */
export function fallbackId(fingerprint: string): string {
  return `character-${fingerprint.slice(0, 8)}`;
}

/**
 * 正文指纹：`sha1(text)` 前 12 位。
 *
 * 判定口径只有这一处：扫描去重（`persona-source/card-file`）与重复导入（`characters/store`）
 * 都读它，两处必须一致，否则「扫描时合并了、导入时又新建一个」。
 *
 * @param text - 已投影的正文。
 * @returns 12 位十六进制。
 */
export function fingerprintOf(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 12);
}

/**
 * 给一个想用的 id 找第一个空位（`x` / `x-2` / `x-3` …）。
 *
 * @param base - 归一化后的 id（非空）。
 * @param taken - 已被别的角色占用的 id 集合。
 * @returns 可用的 id；`-99` 仍冲突时返回 `undefined`。
 */
export function uniqueId(base: string, taken: ReadonlySet<string>): string | undefined {
  if (!taken.has(base)) return base;
  for (let n = 2; n <= MAX_SUFFIX; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return undefined;
}
