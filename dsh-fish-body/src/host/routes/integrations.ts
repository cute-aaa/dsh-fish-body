/**
 * 接入配置路由：读取 persona / memory 路径，或应用一次设置页补丁。
 *
 * 路径校验、外部授权与 memory 重连都在控制器里完成；这里只解析协议并映射成 200 实体。
 * @module dsh-fish-body/src/host/routes/integrations
 */
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';

/** 接入配置领域：未命中返回 undefined。 */
export async function handleIntegrationsRoutes(
  deps: PetRouteDeps,
  input: RouteInput,
): Promise<RouteResult | undefined> {
  const { body, method, rest } = input;
  const isIntegrations = rest === 'integrations';
  if (!isIntegrations) return undefined;
  if (deps.integrations === undefined) return failResult('unsupported', '当前宿主没有接入配置能力');
  if (method === 'GET') return okResult({ ok: true, integrations: deps.integrations.view() });
  if (method !== 'PUT') return methodNotAllowed();

  let parsed: unknown;
  try {
    parsed = body === undefined || body.trim() === '' ? {} : JSON.parse(body);
  } catch {
    return invalidJson();
  }
  const outcome = deps.integrations.update(parsed);
  if (!outcome.ok) return failResult(outcome.reason, outcome.message);
  return okResult({ ok: true, integrations: outcome.view });
}
