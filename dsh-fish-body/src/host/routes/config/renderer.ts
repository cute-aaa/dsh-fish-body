/**
 * 单只宠物的渲染方式（POST /pet-renderer）：调用方只给 id 与 renderer，层归属由宿主反查。
 * 与 /pet-display 同一套写入语义：白名单重建 + 磁盘原值透传 + 写后广播并重启 Helper。
 * 不解析整段 pets[]，不负责配置读取的合并（归 ../../config）。
 * @module dsh-fish-body/src/host/routes/config/renderer
 */
import { RENDERER_SET, findPetInstance, readAllConfig, saveUserConfig } from '../../config.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { type RouteResult } from '../../http.ts';
import type { PetRouteDeps, RouteInput } from '../types.ts';
import { resolveConfigLayer } from './layer.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from '../result.ts';

/**
 * 改一只宠物的 renderer 并返回改动后的成品聚合。
 *
 * 失败一律 200 + 失败实体：缺 id / renderer 非法 / 宠物不存在 / 写盘失败都是业务结论；
 * 方法不对与 JSON 坏了发生在业务之前，由协议构造器给真实状态码。
 */
export async function setPetRenderer(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult> {
  if (input.method !== 'POST') return methodNotAllowed();
  let payload: { id?: unknown; renderer?: unknown };
  try {
    payload = JSON.parse(input.body ?? '') as { id?: unknown; renderer?: unknown };
  } catch {
    return invalidJson();
  }
  const petId = typeof payload.id === 'string' ? payload.id.trim() : '';
  const nextRenderer = String(payload.renderer ?? '');
  if (!petId) return failResult('pet-required', 'pet 必填：要指定操作哪只桌宠');
  if (!RENDERER_SET.has(nextRenderer)) {
    return failResult('bad-request', `renderer 必须是 webm / layered / live2d：${nextRenderer}`);
  }
  let merged: Record<string, Record<string, unknown>>;
  try {
    merged = readAllConfig(deps.configPaths);
  } catch (e) {
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
  const hit = findPetInstance(merged, petId);
  if (!hit) return failResult('unknown-pet', `没有这只桌宠：${petId}`);
  const resolved = resolveConfigLayer(deps, hit.entry);
  // 单只端点把「条目文件找不到」仍报 generate-error：id 在合并里存在、文件却消失，属于安装或 IO
  // 异常，不是调用方参数问题（整条目端点会把它报成 unknown-entry，两者语义不同）。
  if (!resolved.ok) return failResult('generate-error', `宠物条目配置文件找不到：${hit.entry}`);
  const layer = resolved.layer;
  // 整段替换语义：saveUserConfig 重建的是整个 pets 数组，必须带上该层全部宠物，只把目标
  // 那只的 renderer 换掉（漏掉别的 = 把它们从配置里删掉）。
  const layerPets = Array.isArray(hit.conf.pets) ? (hit.conf.pets as Record<string, unknown>[]) : [];
  const pets = layerPets.map((p) => (String(p.id) === petId ? { ...p, renderer: nextRenderer } : p));
  const clean = saveUserConfig({ pets }, layer.existing);
  if (!clean) return failResult('bad-request', '宠物配置非法');
  try {
    await mkdir(layer.dir, { recursive: true });
    await writeFile(layer.path, JSON.stringify(clean, null, 2), 'utf8');
  } catch (e) {
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
  // 配置变更信号（只在写盘成功之后）：浏览器端靠它发现「配置被别处改过」并重拉 /config。
  deps.state.writeSection('config', {});
  // 切渲染方式不改变显示，不撤销占用锁——宠物仍在那，只是换一套视觉素材。
  void deps.requestRestart();
  return okResult(readAllConfig(deps.configPaths));
}
