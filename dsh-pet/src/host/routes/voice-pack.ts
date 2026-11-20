/**
 * 音色导入：`POST /voice/voice-pack`（选根发现 / 只读预检 / 批量落地）与 `POST /voice/text-lines`
 * （从 `.list`/文本文件里挑一行参考文本）。
 *
 * 为什么单独一份：这条路由有「只读」与「写盘」两种模式，还要在写完后让 provider 立刻重扫；
 * 混进 `voice.ts` 会把「音色切换」和「素材导入」两类语义搅在一起（与 `provider-config` 拆出去同理）。
 *
 * 三种模式：
 * - `weights { root }`：纯读——展开 `GPT_weights*` / `SoVITS_weights*`，按文件名配对成逐行候选；
 * - `plan { items }`：只读预检，逐条给「会成为什么」，任一条不合法就只回错误；
 * - `apply { items }`：真正写盘，逐条独立成败，结束时统一 rescan 一次。
 *
 * 契约见 openapi.yaml；本模块只做方法/JSON/取值校验、根目录解析与 rescan 编排。
 * @module dsh-fish-body/src/host/routes/voice-pack
 */
import type { RouteResult } from '../http.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';
import { voiceProviderOf, voiceProviderStatuses } from '../voice/registry.ts';
import { providerConfigPath, readProviderConfig } from '../voice/gsv/store.ts';
import { gsvSettingsOf } from '../voice/gsv/settings.ts';
import {
  applyVoicePacks,
  discoverWeightRoots,
  MAX_IMPORT_ITEMS,
  previewVoicePack,
  proposeImports,
  readTextLines,
  VoicePackError,
  voicePackRootsOf,
  type VoicePackInput,
  type VoicePackPlacement,
  type VoicePackPreview,
} from '../voice/gsv/voice-pack.ts';

/** 请求体里认的键（多写的一律拒，避免设置页以为保存成功）。 */
interface VoicePackBody {
  readonly provider?: unknown;
  readonly mode?: unknown;
  readonly root?: unknown;
  readonly items?: unknown;
}

/** 取字符串（缺省空串）。 */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 把请求体里的一条校验成 {@link VoicePackInput}。
 *
 * @param raw - 单条原始值。
 * @returns 校验后的输入，或一句可直接回给前端的原因。
 */
function parseItem(raw: unknown): { ok: true; value: VoicePackInput } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'items 里只能放对象' };
  const entry = raw as Record<string, unknown>;
  for (const key of ['weightPath', 'counterpartPath', 'refAudioPath', 'refText', 'id'] as const) {
    if (entry[key] !== undefined && typeof entry[key] !== 'string') {
      return { ok: false, message: `${key} 必须是字符串` };
    }
  }
  if (entry.overwrite !== undefined && typeof entry.overwrite !== 'boolean') {
    return { ok: false, message: 'overwrite 必须是布尔值' };
  }
  const placement = text(entry.placement) || 'hardlink';
  if (placement !== 'hardlink' && placement !== 'copy') {
    return { ok: false, message: 'placement 只能是 hardlink（引用）或 copy（复制）' };
  }
  return {
    ok: true,
    value: {
      weightPath: text(entry.weightPath),
      counterpartPath: text(entry.counterpartPath),
      refAudioPath: text(entry.refAudioPath),
      refText: text(entry.refText),
      id: text(entry.id),
      placement: placement as VoicePackPlacement,
      overwrite: entry.overwrite === true,
    },
  };
}

/**
 * 校验 `items`：必须是 1–{@link MAX_IMPORT_ITEMS} 条。
 *
 * @param raw - 请求体里的 `items`。
 * @returns 逐条输入；不合法时给应答。
 */
function parseItems(raw: unknown): { ok: true; value: VoicePackInput[] } | { ok: false; res: RouteResult } {
  if (!Array.isArray(raw)) return { ok: false, res: failResult('bad-request', 'items 必须是数组') };
  if (raw.length === 0) return { ok: false, res: failResult('bad-request', 'items 是空的：没有要导入的音色') };
  if (raw.length > MAX_IMPORT_ITEMS) {
    return { ok: false, res: failResult('bad-request', `一次最多导入 ${MAX_IMPORT_ITEMS} 个音色`) };
  }
  const value: VoicePackInput[] = [];
  for (const [index, item] of raw.entries()) {
    const parsed = parseItem(item);
    if (!parsed.ok) return { ok: false, res: failResult('bad-request', `第 ${index + 1} 条：${parsed.message}`) };
    value.push(parsed.value);
  }
  return { ok: true, value };
}

/**
 * 处理 `voice/voice-pack`。
 *
 * @param deps - 路由依赖（数据根）。
 * @param input - 路由输入。
 * @returns 应答；方法不对回 405。
 */
async function handleVoicePack(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult> {
  if (input.method !== 'POST') return methodNotAllowed();
  let raw: unknown;
  try {
    raw = JSON.parse(input.body ?? 'null');
  } catch {
    return invalidJson();
  }
  const body = (raw ?? {}) as VoicePackBody;
  const provider = text(body.provider) || 'gsv';
  if (provider !== 'gsv') return failResult('bad-request', `导入只支持 gsv：${provider}`);
  const mode = text(body.mode) || 'plan';
  if (mode !== 'weights' && mode !== 'plan' && mode !== 'apply') {
    return failResult('bad-request', 'mode 只能是 weights、plan 或 apply');
  }

  const settings = gsvSettingsOf(readProviderConfig(providerConfigPath(deps.userRoot)));
  const roots = voicePackRootsOf(settings);

  if (mode === 'weights') {
    try {
      const dirs = discoverWeightRoots(text(body.root));
      if (dirs.gptDirs.length === 0 && dirs.sovitsDirs.length === 0) {
        return failResult('bad-request', dirs.notes.join('；') || '这个目录下没有权重文件');
      }
      const scan = proposeImports(dirs, settings);
      if (scan.candidates.length === 0) {
        return failResult('bad-request', scan.notes.join('；') || '没有配对出可导入的音色');
      }
      return okResult({ ok: true, mode, scan, providers: voiceProviderStatuses() });
    } catch (error) {
      if (error instanceof VoicePackError) return failResult('bad-request', error.message);
      return failResult('generate-error', error instanceof Error ? error.message : String(error));
    }
  }

  const parsed = parseItems(body.items);
  if (!parsed.ok) return parsed.res;

  if (mode === 'plan') {
    const previews: (VoicePackPreview | null)[] = [];
    const errors: { index: number; id?: string; message: string }[] = [];
    for (const [index, item] of parsed.value.entries()) {
      try {
        previews.push(previewVoicePack(item, roots));
      } catch (error) {
        if (!(error instanceof VoicePackError)) {
          return failResult('generate-error', error instanceof Error ? error.message : String(error));
        }
        const id = item.id.trim();
        errors.push({ index, ...(id === '' ? {} : { id }), message: error.message });
        previews.push(null);
      }
    }
    return okResult({ ok: true, mode, previews, errors });
  }

  try {
    const batch = await applyVoicePacks(parsed.value, roots);
    // 新音色立刻生效：不让菜单等 15s 的扫描软过期。
    await voiceProviderOf('gsv')?.rescan?.();
    return okResult({
      ok: true,
      mode,
      results: batch.results,
      errors: batch.errors,
      providers: voiceProviderStatuses(),
    });
  } catch (error) {
    if (error instanceof VoicePackError) return failResult('bad-request', error.message);
    return failResult('generate-error', error instanceof Error ? error.message : String(error));
  }
}

/**
 * 处理 `voice/text-lines`：读文本文件，返回可选行（`.list` 取第 4 列）。
 *
 * @param input - 路由输入（`{ path, max? }`）。
 * @returns 应答；方法不对回 405。
 */
async function handleTextLines(input: RouteInput): Promise<RouteResult> {
  if (input.method !== 'POST') return methodNotAllowed();
  let parsed: { path?: unknown; max?: unknown };
  try {
    parsed = JSON.parse(input.body ?? 'null') as { path?: unknown; max?: unknown };
  } catch {
    return invalidJson();
  }
  const path = text(parsed.path);
  if (path === '') return failResult('bad-request', 'path 必填');
  const max =
    typeof parsed.max === 'number' && Number.isFinite(parsed.max)
      ? Math.min(500, Math.max(1, Math.trunc(parsed.max)))
      : undefined;
  try {
    return okResult({ ok: true, lines: readTextLines(path, max) });
  } catch (error) {
    if (error instanceof VoicePackError) return failResult('bad-request', error.message);
    return failResult('generate-error', error instanceof Error ? error.message : String(error));
  }
}

/**
 * `voice/voice-pack` 与 `voice/text-lines` 的入口。
 * @param deps - 路由依赖。
 * @param input - 路由输入。
 * @returns 未命中这两个路径时 undefined。
 */
export async function handleVoicePackRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  if (input.rest === 'voice/voice-pack') return handleVoicePack(deps, input);
  if (input.rest === 'voice/text-lines') return handleTextLines(input);
  return undefined;
}
