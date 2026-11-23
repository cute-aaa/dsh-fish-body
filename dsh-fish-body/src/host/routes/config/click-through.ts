/**
 * 单只宠物的「鼠标穿透」（POST /pet-click-through）：写 `pets[].clickThrough`，层归属由宿主反查。
 *
 * 与 /pet-display、/pet-size 同一套写入语义（白名单重建 + 磁盘原值透传 + 写后广播 config 段），
 * **但刻意不重启桌面 Helper**：穿透是运行期可即时翻转的窗口属性，重启会把全部宠物窗口重建、
 * 跳回配置角落——为一次「能不能点」付这个代价不合理。生效路径是渲染端自己：
 * 菜单点切换 → 本地 bridge 立即翻窗；设置页保存 → PUT /config 本来就会重启，启动时按本字段落位。
 *
 * @module dsh-fish-body/src/host/routes/config/click-through
 */
import { findPetInstance, readAllConfig, saveUserConfig } from '../../config.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { type RouteResult } from '../../http.ts';
import type { PetRouteDeps, RouteInput } from '../types.ts';
import { resolveConfigLayer } from './layer.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from '../result.ts';

/**
 * 改一只宠物的鼠标穿透并返回改动后的成品聚合。
 *
 * `value` 必须是布尔（缺省不算「关」——没有目标值的调用一律当协议错误）；`false` 等于删掉该键，
 * 配置里不凭空多一行 `false`。失败一律 200 + 失败实体。
 *
 * @param deps - 路由依赖（配置路径、状态广播）。
 * @param input - 请求（只接受 POST）。
 * @returns 成品聚合或失败实体。
 */
export async function setPetClickThrough(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult> {
  if (input.method !== 'POST') return methodNotAllowed();
  let payload: { id?: unknown; value?: unknown };
  try {
    payload = JSON.parse(input.body ?? '') as { id?: unknown; value?: unknown };
  } catch {
    return invalidJson();
  }
  const petId = typeof payload.id === 'string' ? payload.id.trim() : '';
  if (!petId) return failResult('pet-required', 'pet 必填：要指定操作哪只桌宠');
  if (typeof payload.value !== 'boolean') {
    return failResult('bad-request', `value 必须是布尔：${String(payload.value)}`);
  }
  const value = payload.value;
  let merged: Record<string, Record<string, unknown>>;
  try {
    merged = readAllConfig(deps.configPaths);
  } catch (e) {
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
  const hit = findPetInstance(merged, petId);
  if (!hit) return failResult('unknown-pet', `没有这只桌宠：${petId}`);
  const resolved = resolveConfigLayer(deps, hit.entry);
  if (!resolved.ok) return failResult('generate-error', `宠物条目配置文件找不到：${hit.entry}`);
  const layer = resolved.layer;
  // 整段替换语义：saveUserConfig 重建的是整个 pets 数组，必须带上该层全部宠物，只改目标那只。
  const layerPets = Array.isArray(hit.conf.pets) ? (hit.conf.pets as Record<string, unknown>[]) : [];
  const pets = layerPets.map((p) => (String(p.id) === petId ? withClickThrough(p, value) : p));
  const clean = saveUserConfig({ pets }, layer.existing);
  if (!clean) return failResult('bad-request', '宠物配置非法');
  try {
    await mkdir(layer.dir, { recursive: true });
    await writeFile(layer.path, JSON.stringify(clean, null, 2), 'utf8');
  } catch (e) {
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
  // 配置变更信号（只在写盘成功之后）：设置页/网页端靠它发现配置被别处改过并重拉 /config。
  deps.state.writeSection('config', {});
  return okResult(readAllConfig(deps.configPaths));
}

/**
 * 在一只宠物上写入或删除鼠标穿透。
 *
 * @param pet - 磁盘上的原始宠物对象（其余键原样保留）。
 * @param value - `true` 写该键；`false` 删掉它（等于回到缺省 = 可交互）。
 * @returns 新的宠物对象（不修改入参）。
 */
function withClickThrough(pet: Record<string, unknown>, value: boolean): Record<string, unknown> {
  const { clickThrough: _drop, ...rest } = pet;
  void _drop;
  return value ? { ...rest, clickThrough: true } : rest;
}
