/**
 * 自定义 hook 音效：`POST /sfx/<名字>?pet=`。
 *
 * 只校验「这个名字在这只宠物身上确实有音效」（配置 `sfx.hooks` 或索引里自动匹配到的
 * `hook-<名字>`）然后把指令写进 `pets.<id>.sfx` 叶子，实际发声由两端各自执行。
 * 名字集合由宿主判定而不是渲染端：名字打错时调用方拿到 unknown-hook，而不是「发出了但没声音」。
 * @module dsh-pet/src/host/routes/sfx
 */
import { readAllConfig } from '../config.ts';
import { buildSfxIndex } from '../sfx/index-build.ts';
import { readSfxSources, skinIdOfModel } from '../sfx/scan.ts';
import { SFX_HOOK_NAME_RE } from '../../shared/sfx/types.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import { failResult, methodNotAllowed, okResult } from './result.ts';

/**
 * 音效 hook 领域：未命中返回 undefined，命中返回应答。
 */
export async function handleSfxRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { configPaths, lockBlocked, requirePet, soundDirsFor, state, surfaceBlocked } = deps;
  const { rest, method, url } = input;
  if (!rest.startsWith('sfx/')) return undefined;
  if (method !== 'POST') return methodNotAllowed();
  const hook = rest.slice('sfx/'.length);
  // 名字口径与设置页表单同一份（shared/sfx/types 的 SFX_HOOK_NAME_RE）。
  if (!SFX_HOOK_NAME_RE.test(hook)) {
    return failResult('bad-request', 'hook 名只能由字母、数字、下划线与连字符组成（1–64 字符）');
  }
  try {
    const cfg = readAllConfig(configPaths);
    const who = requirePet(url.searchParams, () => cfg, { surface: true });
    if (!who.ok) return who.res;
    // 配置里声明过（条目级 sfx.hooks）或磁盘上有 hook-<名字>.<ext>，两者都算「这只宠物有这个音效」。
    const declared = hook in ((who.conf.sfx as { hooks?: Record<string, unknown> } | undefined)?.hooks ?? {});
    let discovered = false;
    if (!declared) {
      // 素材根 = 条目 key（与 /thumb、/sound 同一口径）。
      const sources = readSfxSources(soundDirsFor(who.entry, '.webm'));
      const index = buildSfxIndex({ model: skinIdOfModel(String(who.pet.model ?? '')), sources });
      discovered = index.hooks[hook] !== undefined;
    }
    if (!declared && !discovered) {
      return failResult(
        'unknown-hook',
        who.petId + ' 没有名为「' + hook + '」的音效（配置 sfx.hooks 或放一个 hook-' + hook + '.wav）',
      );
    }
    const noSurface = surfaceBlocked(cfg, who.petId, url.searchParams);
    if (noSurface) return noSurface;
    const blocked = lockBlocked(who.petId, url.searchParams);
    if (blocked) return blocked;
    state.writePet(who.petId, 'sfx', { hook });
    return okResult({ ok: true, hook });
  } catch (e) {
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
}
