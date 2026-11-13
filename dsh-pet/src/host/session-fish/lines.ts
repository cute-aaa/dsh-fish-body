/**
 * 会话鱼的播报文案：纯模板，不调用模型、不读时钟。
 *
 * 为什么放在宿主：文案要跟着「任务详情」一起成型，两端只负责念与画；宿主生成一次，浏览器与
 * 语音链拿到的是同一句。任务文案会被截短——鱼的气泡很小，长路径与长句子只会把气泡撑爆。
 * @module dsh-pet/src/host/session-fish/lines
 */
import type { SessionFishLineKind, SessionFishState } from '../../shared/session-fish.ts';

/** 插进文案里的任务详情上限（按码点）：再长就只留开头，免得念起来像在读日志。 */
export const SESSION_FISH_TASK_MAX = 24;

/** 状态对应的进度候选句；`{task}` 由任务详情替换，没有任务时用不留空格的短句。 */
const PROGRESS_LINES: Record<Exclude<SessionFishState, 'idle'>, string[]> = {
  thinking: ['我在想啦…', '让我理一理～'],
  // 任务详情本身常是完整动作（「改 index.ts」）或一句清单原文；不要在前面硬加「正在」，
  // 否则清单写成问句时会念成「正在这工具是干嘛的」。
  working: ['{task}', '忙起来了：{task}'],
  result: ['这一步好了：{task}', '搞定一步～'],
  waiting: ['等你确认：{task}', '停一下，等你拍板～'],
  success: ['这轮说完啦。', '这一轮收工～'],
  error: ['这轮出错了…', '有点不对劲，看看日志？'],
};

/** 轮次结束时按终局挑的候选句（goal 中间轮单独一组，不庆祝整个任务完成）。 */
const TURN_END_LINES: Record<'success' | 'error' | 'result', string[]> = {
  success: ['这轮说完啦。', '这一轮收工～'],
  error: ['这轮出错了…', '有点不对劲，看看日志？'],
  result: ['这轮完成了，任务还在继续～'],
};

/** 轮次结束但还有别的活在跑（子代理 / 后台任务）时的候选句。 */
const STILL_BUSY_LINES = ['这轮完了，还有活在跑～', '先别走，后面还有～'];

/** 任务完成、等用户点进来时的候选句（只在没有轮次播报时才用）。 */
const DONE_LINES = ['搞定啦，回来看看吧。', '任务收工，戳我一下我就走～'];

/** 空白会话的待命句。 */
const IDLE_LINES = ['新会话，我先待命～', '来啦，有事叫我。'];

/** 截短任务文案（按码点切，避免把 emoji 切一半）。 */
export function shortSessionFishTask(task: string | null): string {
  const text = (task ?? '').trim();
  if (text === '') return '';
  const points = Array.from(text);
  return points.length > SESSION_FISH_TASK_MAX ? points.slice(0, SESSION_FISH_TASK_MAX).join('') + '…' : text;
}

/** 从候选里挑一条；`pick` 是 [0,1) 的随机数，测试可注入固定值。 */
function pickLine(pool: readonly string[], pick: () => number): string {
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(pick() * pool.length)));
  return pool[index];
}

/** 把 `{task}` 填进模板；没有任务时退化成去掉模板收尾的泛化句。 */
function fillTask(template: string, task: string | null): string {
  const text = shortSessionFishTask(task);
  if (template.includes('{task}')) {
    if (text !== '') return template.replace('{task}', text);
    // 模板是为「有任务」写的：没有任务时换成同档位的泛化说法，而不是留下半个冒号
    return template.startsWith('忙起来了') ? '在忙呢～' : '正在干活～';
  }
  return template;
}

/**
 * 生成一条播报。
 *
 * @param kind - 播报类型；`done` 只在没有轮次播报时兜底，避免同一件事念两遍。
 * @param state - 当时档位。
 * @param task - 任务详情（可 null）。
 * @param pick - 随机源（默认 `Math.random`）；测试注入固定值以保证可断言。
 * @returns 可直接上屏 / 合成的整句。
 */
export function composeSessionFishLine(
  kind: SessionFishLineKind,
  state: SessionFishState,
  task: string | null,
  pick: () => number = Math.random,
): string {
  if (kind === 'idle' || state === 'idle') return pickLine(IDLE_LINES, pick);
  if (kind === 'done') return pickLine(DONE_LINES, pick);
  if (kind === 'turnEnd') {
    const terminal = state === 'result' ? 'result' : state === 'error' ? 'error' : 'success';
    return pickLine(TURN_END_LINES[terminal], pick);
  }
  const pool = PROGRESS_LINES[state] ?? PROGRESS_LINES.working;
  return fillTask(pickLine(pool, pick), task);
}

/**
 * 轮次结束但活动门判定还有活时的播报。
 *
 * @param pick - 随机源。
 * @returns 一句「还没真收工」的提示。
 */
export function composeStillBusyLine(pick: () => number = Math.random): string {
  return pickLine(STILL_BUSY_LINES, pick);
}
