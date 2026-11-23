/**
 * 外观/动作的当前状态：渲染端上报（`POST /appearance/report`）与查询（`GET /appearance`）。
 *
 * 为什么由渲染端上报：外观有两个入口（对话下发、右键菜单本地切换），还有「临时挂 N 秒到点自动摘」，
 * 宿主自己记账必然与画面漂移。渲染端是唯一知道画面挂着什么的一方，所以真值从它来。
 * 与 `/pose`（桌面实况）同构：内部通道、不校验 surface、不参与睡觉闸门（它不打扰任何人）。
 *
 * 依赖（PetRouteDeps）显式传入，模块内不读全局、不建状态。
 * @module dsh-fish-body/src/host/routes/appearance
 */
import { normalizeAppearance } from '../appearance.ts';
import { readAllConfig } from '../config.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';

/** 外观领域：未命中返回 undefined，命中返回应答。 */
export async function handleAppearanceRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { appearance, configPaths, requirePet } = deps;
  const { body, method, rest, url } = input;

  if (rest !== 'appearance' && rest !== 'appearance/report') return undefined;
  const isReport = rest === 'appearance/report';
  if (isReport && method !== 'POST') return methodNotAllowed();
  if (!isReport && method !== 'GET') return methodNotAllowed();

  // 协议层错误（非法 JSON）先报，与 /pose/report、/anim 同一顺序。
  let parsed: unknown;
  if (isReport) {
    try {
      parsed = JSON.parse(body ?? 'null');
    } catch {
      return invalidJson();
    }
  }
  // 请求体形状先校验：坏形状不碰 store，也不读配置（必然失败的请求不读盘）。
  const normalized = isReport ? normalizeAppearance(parsed) : null;
  if (normalized !== null && !normalized.ok) return failResult(normalized.reason, normalized.message);

  try {
    const who = requirePet(url.searchParams, () => readAllConfig(configPaths));
    if (!who.ok) return who.res;
    if (!isReport) {
      const snap = appearance.get(who.petId);
      // 没上报过也要能回答：`reported: false` 让调用方区分「什么都没戴」与「画面还没上报过」。
      return okResult({
        ok: true,
        petId: who.petId,
        reported: snap !== undefined,
        expressions: snap === undefined ? [] : [...snap.expressions],
        ...(snap?.action === undefined ? {} : { action: snap.action }),
        ...(snap === undefined ? {} : { updatedAt: snap.updatedAt }),
      });
    }
    if (normalized === null || !normalized.ok) return failResult('bad-request', '上报体无效');
    const snap = appearance.set(who.petId, normalized.value);
    return okResult({ ok: true, petId: who.petId, expressions: [...snap.expressions] });
  } catch (e) {
    // 配置读取失败等（安装损坏）→ 显式失败，不静默（与其他端点同一口径）
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
}
