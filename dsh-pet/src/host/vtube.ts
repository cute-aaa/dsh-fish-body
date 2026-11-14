/**
 * VTube Studio 工程的热键表：菜单文案、淡入时长与「停在最后一帧」都写在这里。
 *
 * VTube 的 `model3.json` 通常一个字都不声明动作/表情，真正的入口是 `<模型名>.vtube.json` 的
 * `Hotkeys`：每条热键有给人看的 `Name`（中文标签）、`Action`（`TriggerAnimation` / `ToggleExpression`）
 * 与一个**不带目录**的文件名。文件名散落在 `Animation/` 与 `Exp3/`，所以这里要探一遍目录。
 *
 * 只做解析与探测，不写盘、不碰网络；补全成 model3 的 `Motions` / `Expressions` 归 ./model-extras。
 * @module dsh-fish-body/src/host/vtube
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** 一条可播的动作热键。 */
export interface VtubeMotion {
  /** 热键名（用户在 VTube 里看到的标签）。 */
  readonly name: string;
  /** 相对模型目录的动作文件（含目录，如 `Animation/举手.motion3.json`）。 */
  readonly file: string;
  /** 淡入秒数（`FadeSecondsAmount`）；没写为 undefined。 */
  readonly fadeSeconds: number | undefined;
  /** 播完停在最后一帧（`StopsOnLastFrame`）：举手 / 竖手指这类姿态全靠它保持。 */
  readonly hold: boolean;
}

/** 一条可切换的外观热键。 */
export interface VtubeExpression {
  /** 热键名（显示用）。 */
  readonly name: string;
  /** 相对模型目录的 exp3 文件。 */
  readonly file: string;
}

/** 一次解析的结果。 */
export interface VtubeHotkeys {
  readonly motions: readonly VtubeMotion[];
  readonly expressions: readonly VtubeExpression[];
}

/** 动作文件的候选目录（VTube 用 `Animation`，Cubism 模板常用 `Motions`）。 */
const MOTION_DIRS = ['Animation', 'Motions', 'motions', 'motion'];

/** 外观文件的候选目录（VTube 用 `Exp3`）。 */
const EXPRESSION_DIRS = ['Exp3', 'Expressions', 'expressions', 'expression'];

/** 什么也没有。 */
const EMPTY: VtubeHotkeys = { motions: [], expressions: [] };

/** 容错取对象。 */
function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** 取可选的非负数字。 */
function optionalNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * 在模型目录里找一个热键指向的文件。
 *
 * VTube 只存文件名（不含目录），所以按候选目录逐个试；都找不到说明这条热键是外链或已删素材。
 *
 * @param dir - 模型所在目录（`.model3.json` 的目录）。
 * @param file - 热键里的文件名。
 * @param candidates - 候选子目录（空串 = 模型目录本身）。
 * @returns 相对 `dir` 的路径；找不到时返回 null。
 */
function locate(dir: string, file: string, candidates: readonly string[]): string | null {
  if (file === '') return null;
  for (const folder of candidates) {
    const rel = folder === '' ? file : folder + '/' + file;
    if (existsSync(join(dir, ...rel.split('/')))) return rel;
  }
  return null;
}

/**
 * 解析 `<模型名>.vtube.json` 的内容（纯函数：入参是 `JSON.parse` 的结果）。
 *
 * @param raw - `.vtube.json` 的解析结果。
 * @param dir - 模型所在目录：热键的文件名要靠它定位（不给目录就只认 `Animation/`、`Exp3/`）。
 * @returns 动作与外观热键；结构不认识时给空结果，不抛异常。
 */
export function parseVtubeHotkeys(raw: unknown, dir?: string): VtubeHotkeys {
  const hotkeys = obj(raw)?.Hotkeys;
  if (!Array.isArray(hotkeys)) return EMPTY;
  const motions: VtubeMotion[] = [];
  const expressions: VtubeExpression[] = [];
  for (const item of hotkeys) {
    const hotkey = obj(item);
    if (hotkey === undefined) continue;
    const name = typeof hotkey.Name === 'string' ? hotkey.Name.trim() : '';
    const file = typeof hotkey.File === 'string' ? hotkey.File.trim() : '';
    if (name === '' || file === '') continue;
    const action = hotkey.Action;
    if (action === 'TriggerAnimation') {
      // 没有目录信息时按 VTube 的约定猜 `Animation/`。
      const rel = dir === undefined ? 'Animation/' + file : locate(dir, file, MOTION_DIRS.concat(''));
      if (rel === null) continue;
      motions.push({
        name,
        file: rel,
        fadeSeconds: optionalNumber(hotkey.FadeSecondsAmount),
        hold: hotkey.StopsOnLastFrame === true,
      });
      continue;
    }
    if (action === 'ToggleExpression') {
      const rel = dir === undefined ? 'Exp3/' + file : locate(dir, file, EXPRESSION_DIRS.concat(''));
      if (rel === null) continue;
      expressions.push({ name, file: rel });
    }
    // 其余热键（RemoveAllExpressions / 移动模型 / 道具…）不是素材，跳过。
  }
  return { motions, expressions };
}

/**
 * `.model3.json` → 同名的 `.vtube.json` 路径。
 *
 * @param modelFile - 磁盘上的模型清单路径。
 * @returns 同目录同前缀的 `.vtube.json` 路径（不保证存在）。
 */
export function vtubeFileOf(modelFile: string): string {
  const name = basename(modelFile).replace(/\.model3\.json$/i, '');
  return join(modelFile, '..', name + '.vtube.json');
}

/**
 * 读一个模型所在目录的 VTube 热键表（文件缺失 / 坏 JSON 都当没有）。
 *
 * @param modelFile - 磁盘上的 `.model3.json` 路径。
 * @returns 动作与外观热键；没有 `.vtube.json` 时为空。
 */
export function readVtubeHotkeys(modelFile: string): VtubeHotkeys {
  const path = vtubeFileOf(modelFile);
  if (!existsSync(path)) return EMPTY;
  try {
    return parseVtubeHotkeys(JSON.parse(readFileSync(path, 'utf8')), join(modelFile, '..'));
  } catch {
    return EMPTY;
  }
}
