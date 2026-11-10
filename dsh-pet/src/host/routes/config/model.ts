/**
 * 单只宠物的皮肤/模型（POST /pet-model）：调用方只给 id 与 model，层归属由宿主反查。
 * 与 /pet-renderer 同一套写入语义：白名单重建 + 磁盘原值透传 + 写后广播并重启 Helper。
 * 不解析整段 pets[]，不负责配置读取的合并（归 ../../config）。
 * @module dsh-pet/src/host/routes/config/model
 */
import { findPetInstance, readAllConfig, saveUserConfig } from '../../config.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { type RouteResult } from '../../http.ts';
import type { PetRouteDeps, RouteInput } from '../types.ts';
import { resolveConfigLayer } from './layer.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from '../result.ts';

/**
 * 改一只宠物的 model 并返回改动后的成品聚合。
 *
 * model 是相对皮肤目录的路径（layered 的皮肤 id / live2d 的 .model3.json 相对路径）；
 * 空串 = 清掉覆盖（回落第一个）。失败一律 200 + 失败实体。
 */
export async function setPetModel(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult> {
  if (input.method !== 'POST') return methodNotAllowed();
  let payload: { id?: unknown; model?: unknown };
  try {
    payload = JSON.parse(input.body ?? '') as { id?: unknown; model?: unknown };
  } catch {
    return invalidJson();
  }
  const petId = typeof payload.id === 'string' ? payload.id.trim() : '';
  const nextModel = typeof payload.model === 'string' ? payload.model.trim() : '';
  if (!petId) return failResult('pet-required', 'pet 必填：要指定操作哪只桌宠');
  if (payload.model !== undefined && typeof payload.model !== 'string') {
    return failResult('bad-request', 'model 必须是字符串');
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
  if (!resolved.ok) return failResult('generate-error', `宠物条目配置文件找不到：${hit.entry}`);
  const layer = resolved.layer;
  // 整段替换语义：带上该层全部宠物，只把目标那只的 model 换掉（空串 = 删掉覆盖）。
  const layerPets = Array.isArray(hit.conf.pets) ? (hit.conf.pets as Record<string, unknown>[]) : [];
  const pets = layerPets.map((p) => {
    if (String(p.id) !== petId) return p;
    if (nextModel === '') {
      const { model: _model, ...rest } = p;
      void _model;
      return rest;
    }
    return { ...p, model: nextModel };
  });
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
  // 切皮肤不改变显示，不撤销占用锁。
  void deps.requestRestart();
  return okResult(readAllConfig(deps.configPaths));
}
