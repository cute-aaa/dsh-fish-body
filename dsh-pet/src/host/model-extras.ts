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
 * @module dsh-pet/src/host/model-extras
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** 动作目录候选名：VTube 工程用 `Animation`，Cubism 官方模板常用 `motions` / `motion`。 */
const MOTION_DIRS = ['Animation', 'Motions', 'motions', 'motion'];

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
 * 扫出目录里全部动作，拼成 model3 的 `Motions` 结构（待机单独成组，其余归到目录同名组）。
 *
 * @param dir - 模型所在目录。
 * @returns `{ 组名: [{File, Name, FadeInTime, Duration}] }`；没有动作时为空对象。
 */
function collectMotions(dir: string): Record<string, unknown[]> {
  for (const name of MOTION_DIRS) {
    const files = filesIn(join(dir, name), '.motion3.json');
    if (files.length === 0) continue;
    const groups: Record<string, unknown[]> = {};
    for (const file of files) {
      const full = join(dir, name, file);
      const seconds = motionSeconds(full);
      const entry = {
        File: name + '/' + file,
        // 菜单文案取这里（见 shared/menu/renderer-actions）：Cubism 标准 motion 条目没有名字。
        Name: file.replace(/\.motion3\.json$/, ''),
        FadeInTime: FADE_IN_SECONDS,
        ...(seconds > 0 ? { Duration: seconds } : {}),
      };
      // 待机是一条常驻循环，混在动作组里既会被当成一次性动作，也轮不到 setIdle 用。
      const group = /idle/i.test(file) ? IDLE_GROUP : name;
      (groups[group] ??= []).push(entry);
    }
    return groups;
  }
  return {};
}

/**
 * 扫出目录里全部表情，拼成 model3 的 `Expressions` 结构（名字取文件名）。
 *
 * @param dir - 模型所在目录。
 * @returns `[{Name, File}]`；没有表情时为空数组。
 */
function collectExpressions(dir: string): unknown[] {
  for (const name of EXPRESSION_DIRS) {
    const files = filesIn(join(dir, name), '.exp3.json');
    if (files.length === 0) continue;
    return files.map((file) => ({
      Name: file.replace(/\.exp3\.json$/, ''),
      File: name + '/' + file,
    }));
  }
  return [];
}

/**
 * 给一份模型清单补上目录里现成的动作与表情（已有的声明一律不覆盖）。
 *
 * @param modelFile - 磁盘上的 `.model3.json` 路径（据此定位同目录的 Animation / Exp3）。
 * @param raw - 清单的解析结果。
 * @returns 补全后的清单；清单结构不认识时原样返回。
 */
export function mergeModelExtras(modelFile: string, raw: unknown): unknown {
  const root = obj(raw);
  const refs = obj(root?.FileReferences);
  if (root === undefined || refs === undefined) return raw;
  const dir = join(modelFile, '..');
  const nextRefs: Record<string, unknown> = { ...refs };

  const declaredMotions = obj(refs.Motions);
  if (declaredMotions === undefined || Object.keys(declaredMotions).length === 0) {
    const motions = collectMotions(dir);
    if (Object.keys(motions).length > 0) nextRefs.Motions = motions;
  }
  // 用户自己写了 Expressions 就整段让位；半截补全会让菜单顺序与磁盘对不上。
  if (!Array.isArray(refs.Expressions) || refs.Expressions.length === 0) {
    const expressions = collectExpressions(dir);
    if (expressions.length > 0) nextRefs.Expressions = expressions;
  }
  if (nextRefs.Motions === refs.Motions && nextRefs.Expressions === refs.Expressions) return raw;
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
