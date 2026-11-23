/**
 * 人设领域路由：`/persona/*` 共 9 条操作（来源描述、扫描、角色库、应用、删除、文档导入、AI 润色）。
 *
 * 只解析与校验输入，存取全走 `deps.persona` / `deps.characters`（装配期注入的同一份实例）；
 * 两个 AI 动作（import / polish）**零写盘**：预览结果直接回给前端，落库永远是显式的下一次调用。
 * 业务结论一律 200（与其余动作端点一致），只有协议失败（方法、JSON、体超限）保留真实状态码。
 * @module dsh-fish-body/src/host/routes/persona
 */
import { findPetInstance, readAllConfig } from '../config.ts';
import { MAX_BODY_BYTES } from '../http.ts';
import { projectCard } from '../persona-source/card-reader.ts';
import { extractDocuments } from '../persona-import/extract.ts';
import { characterizeDocuments } from '../persona-import/characterize.ts';
import { polishText } from '../persona/polish.ts';
import { characterIdValid } from '../persona/characters/ids.ts';
import type { CharaCardData } from '../persona-source/card-reader.ts';
import type { CharacterSource } from '../persona/characters/types.ts';
import { failResult, invalidJson, methodNotAllowed, okResult, payloadTooLarge } from './result.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';

/** 路径前缀。 */
const PREFIX = 'persona';

/** 润色正文上限（超过先精简；与方案 §3.5 一致）。 */
const MAX_POLISH_CHARS = 8000;

/** 8 个卡片字段（导入体必须逐项是字符串）。 */
const CARD_FIELDS = [
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'system_prompt',
  'post_history_instructions',
] as const;

/** 允许的 `source.kind`。 */
const SOURCE_KINDS: readonly CharacterSource['kind'][] = ['soul-card', 'custom', 'editor', 'document', 'custom-text'];

/** 解析 JSON 对象体；不是对象返回 null。 */
function parseObjectBody(body: string | undefined): Record<string, unknown> | null {
  if (body === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/** 读 8 字段：任一字段不是字符串或缺席 → null；全空也 → null（没有可落库的内容）。 */
function readCardFields(raw: unknown): CharaCardData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of CARD_FIELDS) {
    const value = source[key];
    if (typeof value !== 'string') return null;
    out[key] = value;
  }
  const hasContent = CARD_FIELDS.some((key) => out[key].trim() !== '');
  if (!hasContent) return null;
  return out as unknown as CharaCardData;
}

/** 读可选的来源标注（缺省 = 文档导入）。 */
function readSource(raw: unknown): CharacterSource | null {
  if (raw === undefined || raw === null) return { kind: 'document', id: 'import', path: '' };
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const kind = typeof source.kind === 'string' ? source.kind : 'document';
  if (!SOURCE_KINDS.includes(kind as CharacterSource['kind'])) return null;
  return {
    kind: kind as CharacterSource['kind'],
    id: typeof source.id === 'string' && source.id.trim() !== '' ? source.id.trim() : 'import',
    path: typeof source.path === 'string' ? source.path : '',
  };
}

/** 一只宠物的角色作用域信息。 */
function petScopeOf(
  deps: PetRouteDeps,
  petId: string,
): RouteResult | { id: string; entry: string; writable: boolean; character: string | null } {
  const found = findPetInstance(readAllConfig(deps.configPaths), petId);
  if (found === undefined) return failResult('unknown-pet', '没有这只桌宠：' + petId);
  const character = typeof found.pet.personaCharacter === 'string' ? found.pet.personaCharacter : null;
  return { id: petId, entry: found.entry, writable: found.entry === 'main', character };
}

/** 类型守卫：上面那个联合里成功分支没有 `kind`。 */
function isRouteResult(value: object): value is RouteResult {
  return 'kind' in value;
}

/** 人设领域：未命中返回 undefined，命中返回应答。 */
export async function handlePersonaRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { body, method, rest, url } = input;
  if (rest !== PREFIX && !rest.startsWith(PREFIX + '/')) return undefined;

  // GET /persona/sources（不带 pet 也要成功；带了未知 pet 回 unknown-pet）
  if (rest === PREFIX || rest === 'persona/sources') {
    if (method !== 'GET') return methodNotAllowed();
    const petParam = (url.searchParams.get('pet') ?? '').trim();
    const described = await deps.persona.describe();
    const sources = described.map((source) => ({ ...source, lastScan: deps.persona.lastScan(source.id) ?? null }));
    const listed = await deps.characters.list();
    const payload: Record<string, unknown> = {
      ok: true,
      sources,
      characters: { total: listed.characters.length, skipped: listed.skipped },
    };
    if (petParam !== '') {
      const scope = petScopeOf(deps, petParam);
      if (isRouteResult(scope)) return scope;
      payload.pet = scope;
    }
    return okResult(payload);
  }

  // POST /persona/scan
  if (rest === 'persona/scan') {
    if (method !== 'POST') return methodNotAllowed();
    const raw = parseObjectBody(body);
    if (raw === null) return invalidJson();
    const source = typeof raw.source === 'string' ? raw.source.trim() : '';
    if (source === '') return failResult('bad-request', '缺少 source');
    if (raw.path !== undefined && raw.path !== null && typeof raw.path !== 'string') {
      return failResult('bad-request', 'path 必须是字符串');
    }
    const path = typeof raw.path === 'string' ? raw.path : undefined;
    try {
      const outcome = await deps.persona.scan(source, path);
      if (!outcome.ok) {
        return failResult(
          outcome.reason,
          outcome.message,
          outcome.expectedPath === undefined ? undefined : { extra: { expectedPath: outcome.expectedPath } },
        );
      }
      return okResult({
        ok: true,
        source: outcome.source,
        installed: outcome.installed,
        scanned: outcome.scanned,
        imported: outcome.imported,
        skipped: outcome.skipped,
      });
    } catch (e) {
      return failResult('settings-write-failed', `角色库写入失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // GET /persona/characters
  if (rest === 'persona/characters') {
    if (method !== 'GET') return methodNotAllowed();
    const listed = await deps.characters.list();
    return okResult({
      ok: true,
      characters: listed.characters.map((record) => ({
        id: record.id,
        name: record.name,
        source: record.source,
        importedAt: record.importedAt,
        chars: record.chars,
        appliedTo: record.appliedTo,
      })),
      skipped: listed.skipped,
    });
  }

  // POST /persona/characters/import
  if (rest === 'persona/characters/import') {
    if (method !== 'POST') return methodNotAllowed();
    const raw = parseObjectBody(body);
    if (raw === null) return invalidJson();
    const fields = readCardFields(raw.character);
    if (fields === null) return failResult('bad-request', 'character 必须是 8 个字符串字段且至少一项非空');
    const source = readSource(raw.source);
    if (source === null) return failResult('bad-request', 'source.kind 不合法');
    try {
      const result = await deps.characters.put({ fields, source });
      return okResult({
        ok: true,
        character: { id: result.record.id, name: result.record.name },
        reused: result.reused,
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'character-id-exhausted') {
        return failResult('bad-request', e instanceof Error ? e.message : String(e));
      }
      return failResult('settings-write-failed', `角色库写入失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // POST /persona/characters/apply
  if (rest === 'persona/characters/apply') {
    if (method !== 'POST') return methodNotAllowed();
    const raw = parseObjectBody(body);
    if (raw === null) return invalidJson();
    const petId = typeof raw.pet === 'string' ? raw.pet.trim() : '';
    if (petId === '') return failResult('pet-required', 'pet 必填：要指定应用给哪只桌宠');
    const characterId = typeof raw.characterId === 'string' ? raw.characterId.trim() : '';
    if (characterId === '') return failResult('bad-request', 'characterId 必填');
    if (raw.writeName !== undefined && typeof raw.writeName !== 'boolean') {
      return failResult('bad-request', 'writeName 必须是布尔');
    }
    const writeName = raw.writeName === undefined ? undefined : raw.writeName;
    const outcome = await deps.characters.apply(
      petId,
      characterId,
      writeName === undefined ? undefined : { writeName },
    );
    if (outcome.status === 'applied') {
      // 写盘后广播：别的窗口（网页端 + 桌面端）手里那份配置已经过期，必须重读。
      deps.state.writeSection('config', {});
      return okResult({
        ok: true,
        pet: outcome.petId,
        characterId: outcome.characterId,
        chars: outcome.chars,
        wroteName: outcome.wroteName,
      });
    }
    if (outcome.status === 'unchanged') {
      const record = await deps.characters.get(outcome.characterId);
      const chars = record === undefined ? 0 : projectCard(record).length;
      return okResult({
        ok: true,
        pet: outcome.petId,
        characterId: outcome.characterId,
        chars,
        wroteName: false,
        unchanged: true,
      });
    }
    if (outcome.status === 'skipped') {
      return failResult('persona-readonly-entry', '文件宠物的人设由所属条目管理（非 main 实例不可应用）');
    }
    if (outcome.reason === 'unknown-pet') return failResult('unknown-pet', '没有这只桌宠：' + petId);
    if (outcome.reason === 'unknown-character')
      return failResult('unknown-character', '角色库里没有这个角色：' + characterId);
    return failResult('settings-write-failed', '写盘失败：配置未改动');
  }

  // DELETE /persona/characters/<id>
  if (rest.startsWith('persona/characters/')) {
    if (method !== 'DELETE') return methodNotAllowed();
    const id = rest.slice('persona/characters/'.length).trim();
    if (id === '' || !characterIdValid(id)) return failResult('bad-request', '角色 id 不合法');
    const outcome = await deps.characters.remove(id);
    if (outcome.ok) return okResult({ ok: true, deleted: outcome.deleted });
    if (outcome.reason === 'character-in-use') {
      return failResult('character-in-use', '这个角色正被宠物引用，先换成别的角色再删', {
        extra: { referrers: outcome.referrers ?? [] },
      });
    }
    return failResult('unknown-character', '角色库里没有这个角色：' + id);
  }

  // POST /persona/import（文档 → 预览，零写盘）
  if (rest === 'persona/import') {
    if (method !== 'POST') return methodNotAllowed();
    if (Buffer.byteLength(body ?? '', 'utf8') > MAX_BODY_BYTES) return payloadTooLarge('请求体超过 1 MiB');
    const raw = parseObjectBody(body);
    if (raw === null) return invalidJson();
    const petId = typeof raw.pet === 'string' ? raw.pet.trim() : '';
    if (petId === '') return failResult('pet-required', 'pet 必填：要指定应用到哪只桌宠');
    const filesRaw = raw.files;
    if (!Array.isArray(filesRaw)) return failResult('bad-request', 'files 必须是数组');
    const files = filesRaw.map((item) => {
      const entry = item as { name?: unknown; base64?: unknown };
      return {
        name: typeof entry?.name === 'string' ? entry.name : '',
        base64: typeof entry?.base64 === 'string' ? entry.base64 : '',
      };
    });
    const extracted = await extractDocuments(files);
    if (!extracted.ok) return failResult(extracted.reason, extracted.message);
    const pet = findPetInstance(readAllConfig(deps.configPaths), petId);
    if (pet === undefined) return failResult('unknown-pet', '没有这只桌宠：' + petId);
    const textOutcome = await characterizeDocuments(
      { agentDefaultModel: deps.ctx.agentDefaultModel, llm: deps.ctx.llm },
      extracted.files,
      { petName: typeof pet?.pet.name === 'string' ? pet.pet.name : undefined },
    );
    if (!textOutcome.ok) {
      return failResult(
        textOutcome.reason === 'extract-failed' ? 'extract-failed' : 'generate-error',
        textOutcome.message,
      );
    }
    return okResult({
      ok: true,
      files: textOutcome.files,
      preview: textOutcome.preview,
      ...(textOutcome.usage === undefined ? {} : { usage: textOutcome.usage }),
    });
  }

  // POST /persona/polish（AI 润色 → 预览，零写盘）
  if (rest === 'persona/polish') {
    if (method !== 'POST') return methodNotAllowed();
    const raw = parseObjectBody(body);
    if (raw === null) return invalidJson();
    const petId = typeof raw.pet === 'string' ? raw.pet.trim() : '';
    if (petId === '') return failResult('pet-required', 'pet 必填：要指定哪只桌宠的人设');
    const text = typeof raw.text === 'string' ? raw.text.trim() : '';
    if (text === '') return failResult('bad-request', 'text 必须是非空字符串');
    if (text.length > MAX_POLISH_CHARS)
      return failResult('bad-request', `text 最多 ${MAX_POLISH_CHARS} 个字符，请先精简`);
    const pet = findPetInstance(readAllConfig(deps.configPaths), petId);
    if (pet === undefined) return failResult('unknown-pet', '没有这只桌宠：' + petId);
    const name = typeof pet.pet.name === 'string' ? pet.pet.name : '';
    const result = await polishText(
      { agentDefaultModel: deps.ctx.agentDefaultModel, llm: deps.ctx.llm },
      { name, text },
    );
    if (!result.ok) return failResult('generate-error', result.message);
    return okResult({ ok: true, text: result.text, ...(result.usage === undefined ? {} : { usage: result.usage }) });
  }

  // 其余 /persona/... 一律 404 文本（不进业务）
  return { kind: 'text', status: 404, body: 'fish-body: unknown persona endpoint' };
}
