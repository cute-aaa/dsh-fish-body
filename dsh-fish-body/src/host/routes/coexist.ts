/**
 * 共存端点：`GET /coexist` 看「还有谁在驱动这只宠物」，`POST /coexist` 显式让位。
 *
 * `auto` 只报告不改行为——自动静音会让用户莫名其妙；要不要让位由人决定。
 * @module dsh-fish-body/src/host/routes/coexist
 */
import { failResult, methodNotAllowed, okResult } from './result.ts';
import type { CoexistMode } from '../coexist.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';

/** 允许的模式取值（与 `CoexistMode` 对齐；路由层独立校验外部输入）。 */
const MODES = ['auto', 'full', 'body-only'] as const;

/** 共存领域：未命中返回 undefined，命中返回应答。 */
export async function handleCoexistRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { coexist } = deps;
  const { body, method, rest } = input;
  // 与字面量直接比较：check-openapi 按这种写法收集宿主实现的路由
  const isCoexist = rest === 'coexist';
  if (!isCoexist) return undefined;
  // 精简测试桩可能没装共存表：当作「这个宿主没这个能力」
  if (coexist === undefined) return undefined;

  if (method === 'GET') return okResult({ ok: true, ...coexist.view() });
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
  const mode = (parsed as Record<string, unknown>).mode;
  if (typeof mode !== 'string' || !(MODES as readonly string[]).includes(mode)) {
    return failResult('bad-request', 'mode 只能是 auto / full / body-only');
  }
  const changed = coexist.set(mode as CoexistMode);
  return okResult({ ok: true, changed, ...coexist.view() });
}
