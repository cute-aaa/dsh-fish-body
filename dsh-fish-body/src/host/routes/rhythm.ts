/**
 * 节律端点：`GET /rhythm?pet=` 查当前状态，`POST /rhythm?pet=` 让外部指定「现在该睡还是该醒」。
 *
 * 为什么要有这一对：真实 soul 项目的作息形态互不相同——每日闹钟（Coopanion 的 `alarm_set daily HH:MM`）、
 * 驱动力 + 下次触发时刻（surfcore 的 `nextFireAt`）、或者一句自然语言。本插件不试图统一时刻表，
 * 只暴露**两态 + 到期时间**，让算得出的那一侧（soul 项目 / 用户脚本 / 计划任务）来调。
 *
 * 与 `/sleep`、`/wake` 的关系：那两条是「立刻睡 / 立刻醒」的手动作；这里是「从现在到某个时刻该是什么状态」，
 * 到点自动回醒。两者共用同一个 `SleepStore`（动画与拒聊闸门只有一份）。
 * @module dsh-fish-body/src/host/routes/rhythm
 */
import { readAllConfig } from '../config.ts';
import { pickSleepNames } from '../sleep.ts';
import { failResult, methodNotAllowed, okResult } from './result.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';

/** 允许的状态取值（与 `RhythmState` 对齐；这里写死字面量是因为路由层要独立校验外部输入）。 */
const STATES = ['awake', 'sleeping'] as const;

/** 把请求体里的 `until` 收成毫秒时间戳：ISO 字符串 / 数字 / null。 */
function parseUntil(raw: unknown): { ok: true; value: number | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw === 'number') return Number.isFinite(raw) ? { ok: true, value: raw } : { ok: false };
  if (typeof raw === 'string') {
    const at = new Date(raw).getTime();
    return Number.isFinite(at) ? { ok: true, value: at } : { ok: false };
  }
  return { ok: false };
}

/** 节律领域：未命中返回 undefined，命中返回应答。 */
export async function handleRhythmRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { configPaths, requirePet, rhythm } = deps;
  const { body, method, rest, url } = input;
  // 两个分支各写一次与字面量的相等判断：check-openapi 按这种写法收集宿主实现的路由
  const isRhythm = rest === 'rhythm';
  if (!isRhythm) return undefined;
  // 精简测试桩可能没装节律表：当作「这个宿主没有该能力」，交给后面的处理器兜底
  if (rhythm === undefined) return undefined;

  try {
    const who = requirePet(url.searchParams, () => readAllConfig(configPaths));
    if (!who.ok) return who.res;

    if (method === 'GET') {
      return okResult({ ok: true, pet: who.petId, rhythm: rhythm.get(who.petId) });
    }
    if (method !== 'POST') return methodNotAllowed();

    let parsed: unknown;
    try {
      parsed = body === undefined || body.trim() === '' ? {} : JSON.parse(body);
    } catch {
      return failResult('bad-request', '请求体不是合法 JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return failResult('bad-request', '请求体必须是对象');
    }
    const raw = parsed as Record<string, unknown>;
    const state = raw.state;
    if (typeof state !== 'string' || !(STATES as readonly string[]).includes(state)) {
      return failResult('bad-request', 'state 只能是 awake / sleeping');
    }
    const until = parseUntil(raw.until);
    if (!until.ok) return failResult('bad-request', 'until 必须是 ISO 时间字符串或毫秒时间戳');
    if (raw.reason !== undefined && typeof raw.reason !== 'string') {
      return failResult('bad-request', 'reason 必须是字符串');
    }
    if (raw.source !== undefined && raw.source !== 'external' && raw.source !== 'user') {
      return failResult('bad-request', 'source 只能是 external / user');
    }

    // 睡着这个状态要能真的执行：没有配置睡觉动画时提前拒绝，而不是记下一个不会生效的状态。
    // 与 `/sleep` 用同一条判据（pickSleepNames 返回 null）和同一个 reason。
    if (state === 'sleeping' && pickSleepNames(who.conf.animations) === null) {
      return failResult('no-sleep-animations', '这只宠物没有配置睡觉动画（animations.sleep）');
    }

    const result = rhythm.set(who.petId, {
      state: state as 'awake' | 'sleeping',
      until: until.value,
      ...(typeof raw.reason === 'string' ? { reason: raw.reason } : {}),
      ...(raw.source === 'user' ? { source: 'user' as const } : {}),
    });
    return okResult({ ok: true, pet: who.petId, changed: result.changed, rhythm: result.view });
  } catch (e) {
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
}
