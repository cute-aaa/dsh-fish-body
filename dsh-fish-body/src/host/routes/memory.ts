/**
 * 记忆端点：`GET /memory` 告诉你「外部记忆接上了没有、读到几条、为什么没生效」。
 *
 * 记忆后端是单槽（同时只能有一个实现改内容），所以「装了却没生效」是常态而不是故障。
 * 这个端点把三种情况拆开：
 * 1. 没装任何记忆插件 → `provider: null` + 候选全是 `installed: false`
 * 2. 装了但槽被别的实现占着 → `provider: null` + `slotTakenByOther: true`
 * 3. 接上了 → `provider: { id, dir, notes, skipped, lastReadAt }`
 * @module dsh-fish-body/src/host/routes/memory
 */
import { memoryView } from '../memory/status.ts';
import { okResult } from './result.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';

/** 记忆领域：未命中返回 undefined，命中返回应答。 */
export async function handleMemoryRoutes(_deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { method, rest } = input;
  // 与字面量直接比较：check-openapi 按这种写法收集宿主实现的路由
  const isMemory = rest === 'memory';
  if (!isMemory) return undefined;
  if (method !== 'GET') {
    return {
      kind: 'json',
      status: 405,
      obj: { ok: false, reason: 'method-not-allowed', message: 'method not allowed' },
    };
  }
  const view = memoryView();
  const selection = _deps.integrations?.memorySelection() ?? { mode: 'auto' as const, customDir: null };
  const reason =
    view.provider !== null
      ? null
      : view.slotTakenByOther
        ? 'slot-taken'
        : selection.mode === 'custom'
          ? 'custom-empty'
          : 'no-source';
  const message =
    reason === null
      ? ''
      : reason === 'slot-taken'
        ? '记忆槽已被另一个实现占用，本插件不会抢占'
        : reason === 'custom-empty'
          ? '自定义记忆目录里没有可读的 md / txt / json 记忆文件'
          : '没有检测到可用的记忆来源';
  return okResult({
    ok: true,
    mode: selection.mode,
    customDir: selection.customDir,
    reason,
    message,
    provider: view.provider,
    candidates: view.candidates,
    slotTakenByOther: view.slotTakenByOther,
  });
}
