/**
 * 单只宠物的「渲染大小」（POST /pet-size）：按渲染方式覆盖画框宽度，调用方只给 id、可选的
 * renderer 与 size，层归属由宿主反查。
 *
 * 与 /pet-renderer、/pet-model 同一套写入语义：白名单重建 + 磁盘原值透传 + 写后广播并重启 Helper。
 * 尺寸必须跟着渲染方式分开记：webm 的人物只占画框中间 37.5%，方形画布几乎铺满整块，
 * 一个数字跨不过来（见 shared/body-box）。
 * @module dsh-pet/src/host/routes/config/size
 */
import { RENDERER_SET, findPetInstance, readAllConfig, saveUserConfig } from '../../config.ts';
import { isValidSize, SIZE_MAX, SIZE_MIN } from '../../../shared/pet-size.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import type { RenderSizes } from '../../../shared/types.ts';
import { type RouteResult } from '../../http.ts';
import type { PetRouteDeps, RouteInput } from '../types.ts';
import { resolveConfigLayer } from './layer.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from '../result.ts';

/** 合并成品里该宠物当前的渲染方式（缺省 webm）：调用方不指定 renderer 时按它落键。 */
function currentRendererOf(merged: Record<string, Record<string, unknown>>, entry: string, petId: string): string {
  const pets = Array.isArray(merged[entry]?.pets) ? (merged[entry].pets as Record<string, unknown>[]) : [];
  const hit = pets.find((pet) => String(pet.id) === petId);
  const renderer = String(hit?.renderer ?? 'webm');
  return RENDERER_SET.has(renderer) ? renderer : 'webm';
}

/**
 * 改一只宠物某个渲染方式下的画框宽度并返回改动后的成品聚合。
 *
 * `size` 缺省或 null = 删掉该渲染方式的覆盖（回落 pets[].size）；给了就必须是
 * {@link SIZE_MIN}~{@link SIZE_MAX} 的数字。失败一律 200 + 失败实体。
 */
export async function setPetSize(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult> {
  if (input.method !== 'POST') return methodNotAllowed();
  let payload: { id?: unknown; renderer?: unknown; size?: unknown };
  try {
    payload = JSON.parse(input.body ?? '') as { id?: unknown; renderer?: unknown; size?: unknown };
  } catch {
    return invalidJson();
  }
  const petId = typeof payload.id === 'string' ? payload.id.trim() : '';
  if (!petId) return failResult('pet-required', 'pet 必填：要指定操作哪只桌宠');
  // 显式给了 renderer 就必须在白名单里：尺寸是按渲染方式分开存的，拼错会写进一个永远用不到的键。
  if (payload.renderer !== undefined && !RENDERER_SET.has(String(payload.renderer))) {
    return failResult('bad-request', `renderer 必须是 webm / layered / live2d：${String(payload.renderer)}`);
  }
  // size 缺省 / null = 删掉覆盖；给了就必须是 JSON 数字（字符串 "520" 会被 Number() 悄悄接受，
  // 写进配置后形态与别处不一致）。
  const rawSize = payload.size;
  const removing = rawSize === undefined || rawSize === null;
  if (!removing && typeof rawSize !== 'number') {
    return failResult('bad-request', `size 必须是数字（或 null 表示恢复默认）：${String(rawSize)}`);
  }
  const nextSize = removing ? 0 : rawSize;
  if (!removing && !isValidSize(nextSize)) {
    return failResult('bad-request', `size 必须是 ${SIZE_MIN}~${SIZE_MAX} 的数字：${String(rawSize)}`);
  }
  let merged: Record<string, Record<string, unknown>>;
  try {
    merged = readAllConfig(deps.configPaths);
  } catch (e) {
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
  const hit = findPetInstance(merged, petId);
  if (!hit) return failResult('unknown-pet', `没有这只桌宠：${petId}`);
  const renderer =
    payload.renderer === undefined ? currentRendererOf(merged, hit.entry, petId) : String(payload.renderer);
  const resolved = resolveConfigLayer(deps, hit.entry);
  if (!resolved.ok) return failResult('generate-error', `宠物条目配置文件找不到：${hit.entry}`);
  const layer = resolved.layer;
  // 整段替换语义：saveUserConfig 重建的是整个 pets 数组，必须带上该层全部宠物，只改目标那只的 sizes。
  const layerPets = Array.isArray(hit.conf.pets) ? (hit.conf.pets as Record<string, unknown>[]) : [];
  const pets = layerPets.map((p) => {
    if (String(p.id) !== petId) return p;
    return withSize(p, renderer, removing ? undefined : nextSize);
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
  // 改大小要重建窗口：桌面窗口的内容区尺寸在构造时按 pet.size 算死，改不动缓过来的那一份。
  void deps.requestRestart();
  return okResult(readAllConfig(deps.configPaths));
}

/**
 * 在一只宠物上写入/删除某个渲染方式的尺寸覆盖。
 *
 * 删到没有覆盖时整段去掉 `sizes`——留一个 `{}` 既没有语义，又会在下次单字段写回时被当成显式值。
 *
 * @param pet - 磁盘上的原始宠物对象（其余键原样保留）。
 * @param renderer - 渲染方式（已过白名单）。
 * @param size - 新宽度；`undefined` = 删除该键。
 * @returns 新的宠物对象（不修改入参）。
 */
function withSize(pet: Record<string, unknown>, renderer: string, size: number | undefined): Record<string, unknown> {
  const raw = pet.sizes && typeof pet.sizes === 'object' && !Array.isArray(pet.sizes) ? pet.sizes : {};
  const sizes: RenderSizes = { ...(raw as RenderSizes) };
  if (size === undefined) delete sizes[renderer as keyof RenderSizes];
  else sizes[renderer as keyof RenderSizes] = size;
  const { sizes: _drop, ...rest } = pet;
  void _drop;
  return Object.keys(sizes).length > 0 ? { ...rest, sizes } : rest;
}
