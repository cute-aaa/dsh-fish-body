/**
 * live2d 模型清单的动作补全：把皮肤目录里现成的 `Animation/*.motion3.json` 与 `Exp3/*.exp3.json`
 * 补进下发给前端的 model3.json。
 *
 * VTube Studio 的工程把动作与表情当「随模型目录一起走的资源」，清单里不写；Cubism 标准却只认清单，
 * 于是这套公皮在两种渲染端都是「有素材、菜单里空的」。补全只发生在**服务端下发的这一份**里：
 * 用户目录一个字节都不动，网页端与桌面 Helper 读同一条路由，两边同时拿到动作。
 *
 * 另外给 motion 条目塞一个 `Duration`（Cubism 不认这个字段，会忽略）：举手 / 竖手指这类片段是
 * 循环的，前端要按它计时收尾，否则点一次就把宠物钉在那个姿态上（见 shared/live2d-motions）。
 * @module dsh-fish-body/src/host/model-extras
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readVtubeHotkeys, type VtubeMotion } from './vtube.ts';

/** 动作目录候选名：VTube 工程用 `Animation`，Cubism 官方模板常用 `motions` / `motion`。 */
const MOTION_DIRS = ['Animation', 'Motions', 'motions', 'motion'];

/** VTube 热键补出来的动作组名（与它的素材目录同名）。 */
const MOTION_GROUP = 'Animation';

/** 待机组名：文件名带 idle 的进这一组，两端 setIdle 直接按组名起播。 */
const IDLE_GROUP = 'Idle';

/** 表情目录候选名：同上，VTube 工程用 `Exp3`。 */
const EXPRESSION_DIRS = ['Exp3', 'Expressions', 'expressions', 'expression'];

/** 新增 motion 默认淡入秒数：给个小值让切换不突兀，用户自己的清单不受影响。 */
const FADE_IN_SECONDS = 0.3;

/** 取对象（非数组）。 */
function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** 列目录里的文件（相对名）；目录不存在返回空。 */
function filesIn(dir: string, suffix: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(suffix))
      .sort();
  } catch {
    return [];
  }
}

/** 读一个 `.motion3.json` 的时长（秒）；读不到用零（前端另有兜底）。 */
function motionSeconds(file: string): number {
  try {
    const meta = obj(obj(JSON.parse(readFileSync(file, 'utf8')))?.Meta);
    const duration = Number(meta?.Duration);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}

/**
 * VTube 热键 → `Motions` 结构（待机单独成组，其余归 `Animation` 组），并把用掉的文件登记下来。
 *
 * 分组名沿用 VTube 的目录名 `Animation`：菜单里它就是一层子菜单，与用户在 VTube 里的直觉一致。
 * 顺序保持热键表原顺序（用户在 VTube 里排好的顺序）。
 *
 * @param groups - 累加目标的 `Motions` 结构（热键在前、目录扫描在后）。
 * @param used - 已占用的相对路径（随后的目录扫描跳过它们，避免同一条动作出现两次）。
 * @param dir - 模型所在目录（读每个动作文件的时长）。
 * @param hotkeys - `readVtubeHotkeys` 的结果。
 */
function mergeHotkeyMotions(
  groups: Record<string, unknown[]>,
  used: Set<string>,
  dir: string,
  hotkeys: readonly VtubeMotion[],
): void {
  for (const hotkey of hotkeys) {
    const seconds = motionSeconds(join(dir, ...hotkey.file.split('/')));
    const entry = {
      File: hotkey.file,
      // 菜单文案取热键名（「抚胸手打开」而不是「默认手切举手」）。
      Name: hotkey.name,
      FadeInTime: hotkey.fadeSeconds ?? FADE_IN_SECONDS,
      // 非标准字段：Cubism 运行库忽略，叠加层据此在播完后保持末帧姿态。
      ...(hotkey.hold ? { StopsOnLastFrame: true } : {}),
      ...(seconds > 0 ? { Duration: seconds } : {}),
    };
    // 待机是一条常驻循环，混在动作组里既会被当成一次性动作，也轮不到 setIdle 用。
    const group = /idle/i.test(hotkey.file) ? IDLE_GROUP : MOTION_GROUP;
    (groups[group] ??= []).push(entry);
    used.add(hotkey.file);
  }
}

/**
 * 扫出目录里全部动作并**并入** `groups`（跳过 `used` 里的文件）。
 *
 * 热键覆盖不到的两类文件正是它要补的：待机循环 `IDLE.motion3.json`（不是热键，但没有它模型就不会
 * 自己动），以及没绑热键的动作（`脱捕` 这类）。只认第一个命中的候选目录，与旧行为一致。
 *
 * @param groups - 累加目标的 `Motions` 结构。
 * @param dir - 模型所在目录。
 * @param used - 已被热键占用的相对路径。
 */
function mergeScannedMotions(groups: Record<string, unknown[]>, dir: string, used: ReadonlySet<string>): void {
  for (const name of MOTION_DIRS) {
    const files = filesIn(join(dir, name), '.motion3.json');
    if (files.length === 0) continue;
    for (const file of files) {
      const rel = name + '/' + file;
      if (used.has(rel)) continue;
      const seconds = motionSeconds(join(dir, name, file));
      const entry = {
        File: rel,
        // 菜单文案取这里（见 shared/menu/renderer-actions）：Cubism 标准 motion 条目没有名字。
        Name: file.replace(/\.motion3\.json$/, ''),
        FadeInTime: FADE_IN_SECONDS,
        ...(seconds > 0 ? { Duration: seconds } : {}),
      };
      // 待机是一条常驻循环，混在动作组里既会被当成一次性动作，也轮不到 setIdle 用。
      const group = /idle/i.test(file) ? IDLE_GROUP : name;
      (groups[group] ??= []).push(entry);
    }
    return;
  }
}

/**
 * 扫出目录里全部表情并**并入** `out`（跳过 `used` 里的文件）。
 *
 * 热键没绑的 exp3 也要留着：它们可能是动画配套的开关（`竖食指开/关`），
 * 只能靠「外观」菜单手动挂，少一个就少一个可用外观。
 *
 * @param out - 累加目标的 `Expressions` 数组。
 * @param dir - 模型所在目录。
 * @param used - 已被热键占用的相对路径。
 */
function mergeScannedExpressions(out: unknown[], dir: string, used: ReadonlySet<string>): void {
  for (const name of EXPRESSION_DIRS) {
    const files = filesIn(join(dir, name), '.exp3.json');
    if (files.length === 0) continue;
    for (const file of files) {
      const rel = name + '/' + file;
      if (used.has(rel)) continue;
      out.push({ Name: file.replace(/\.exp3\.json$/, ''), File: rel });
    }
    return;
  }
}

/**
 * 给一份模型清单补上动作与表情（已有的声明一律不覆盖）。
 *
 * 两条来源，优先级从高到低：
 * 1. **VTube Studio 工程**（`<模型名>.vtube.json` 的 `Hotkeys`）：菜单文案是用户在 VTube 里看到的热键名，
 *    还带 `FadeSecondsAmount` 与 `StopsOnLastFrame`——「举手 / 竖手指 / 狗尾巴草」那种姿态全靠后者保持。
 * 2. **目录扫描**：没有 `.vtube.json`（Cubism 官方导出流程里被删了，或用户手工整理的素材），
 *    就按 `Animation/`、`Exp3/` 里的文件名补，文案取文件名。
 *
 * @param modelFile - 磁盘上的 `.model3.json` 路径（据此定位同目录的 Animation / Exp3 / .vtube.json）。
 * @param raw - 清单的解析结果。
 * @returns 补全后的清单；清单结构不认识时原样返回。
 */
export function mergeModelExtras(modelFile: string, raw: unknown): unknown {
  const root = obj(raw);
  const refs = obj(root?.FileReferences);
  if (root === undefined || refs === undefined) return raw;
  const dir = join(modelFile, '..');
  const nextRefs: Record<string, unknown> = { ...refs };
  const hotkeys = readVtubeHotkeys(modelFile);

  const declaredMotions = obj(refs.Motions);
  if (declaredMotions === undefined || Object.keys(declaredMotions).length === 0) {
    // 热键给文案与顺序，目录扫描补齐热键没覆盖的文件（待机 IDLE、没绑热键的动作）。
    const motions: Record<string, unknown[]> = {};
    const usedMotions = new Set<string>();
    if (hotkeys.motions.length > 0) mergeHotkeyMotions(motions, usedMotions, dir, hotkeys.motions);
    mergeScannedMotions(motions, dir, usedMotions);
    if (Object.keys(motions).length > 0) nextRefs.Motions = motions;
  }
  // 用户自己写了 Expressions 就整段让位；半截补全会让菜单顺序与磁盘对不上。
  if (!Array.isArray(refs.Expressions) || refs.Expressions.length === 0) {
    const expressions: unknown[] = [];
    const usedExpressions = new Set<string>();
    if (hotkeys.expressions.length > 0) {
      for (const expression of hotkeys.expressions) {
        expressions.push({
          Name: expression.name,
          File: expression.file,
          // 非标准字段：Cubism 运行库忽略，叠加层据此做淡入（VTS 的 FadeSecondsAmount）。
          ...(expression.fadeSeconds === undefined ? {} : { FadeSecondsAmount: expression.fadeSeconds }),
        });
        usedExpressions.add(expression.file);
      }
    }
    mergeScannedExpressions(expressions, dir, usedExpressions);
    if (expressions.length > 0) nextRefs.Expressions = expressions;
  }
  // 复位热键（RemoveAllExpressions）没有素材，转成一个非标准字段交给前端改菜单文案
  // （Cubism 忽略未知键）；没有热键就不写，前端回落内置文案。
  if (hotkeys.resetExpressions !== null) {
    nextRefs.ExpressionReset = { Name: hotkeys.resetExpressions };
  }
  if (
    nextRefs.Motions === refs.Motions &&
    nextRefs.Expressions === refs.Expressions &&
    nextRefs.ExpressionReset === refs.ExpressionReset
  ) {
    return raw;
  }
  return { ...root, FileReferences: nextRefs };
}

/**
 * 这份清单是不是 `.model3.json`（按扩展名判定，大小写不敏感）。
 *
 * @param rel - 相对素材根的文件路径。
 * @returns 是模型清单时返回 true。
 */
export function isModelSettingsFile(rel: string): boolean {
  return basename(rel).toLowerCase().endsWith('.model3.json');
}
