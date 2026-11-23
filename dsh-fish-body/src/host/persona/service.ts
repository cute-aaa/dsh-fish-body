/**
 * 人设服务：把「来源扫描 → 角色库 → 应用到某只宠物」串成一条链，并把上次扫描的回执留在内存里。
 *
 * 分两个面交给路由（`persona` = 来源描述 + 扫描；`characters` = 角色库 + 应用），
 * 但两者共享同一份 store 与账本——不能出现「路由看到一份、装配看到另一份」。
 *
 * 不做 LLM、不碰渲染；扫描写的是全局角色库（`data/persona-characters/`），应用才写宠物配置。
 * @module dsh-fish-body/src/host/persona/service
 */
import { dirname } from 'node:path';
import { readAllConfig } from '../config.ts';
import { personaSource, describePersonaSources, type PersonaSourceDescription } from '../persona-source/registry.ts';
import { resolveCardPathInput } from '../persona-source/path-guard.ts';
import { projectCard, type CharaCardData } from '../persona-source/card-reader.ts';
import type { PersonaScanSkip, PersonaSourceOptions } from '../persona-source/types.ts';
import type { ConfigPaths } from '../config/constants.ts';
import { applyCharacter } from './characters/apply.ts';
import {
  deleteCharacter,
  getCharacter,
  listCharacters,
  putCharacter,
  type CharacterSkip,
  type PutCharacterInput,
  type PutCharacterResult,
} from './characters/store.ts';
import type { ApplyOutcome, CharacterRecord, PetRef } from './characters/types.ts';

/** 一次扫描的回执（进程内内存态，**故意不落盘**：它是「刚才发生了什么」，不是配置）。 */
export interface PersonaScanLedgerEntry {
  readonly at: string;
  readonly scanned: number;
  readonly imported: number;
  readonly reused: number;
}

/** 扫描的失败原因（路由原样映射成 `ResultReason`）。 */
export type PersonaScanOutcome =
  | {
      ok: true;
      source: string;
      installed: boolean;
      scanned: number;
      imported: { id: string; name: string; reused: boolean }[];
      skipped: readonly PersonaScanSkip[];
    }
  | {
      ok: false;
      reason: 'bad-request' | 'unknown-persona-source' | 'persona-source-unavailable' | 'not-found';
      message: string;
      /** `persona-source-unavailable` 时给出期望放素材的位置。 */
      expectedPath?: string;
    };

/** 角色库视图：记录 + 正文长度 + 被哪些宠物引用。 */
export interface CharacterView extends CharacterRecord {
  readonly chars: number;
  readonly appliedTo: readonly string[];
}

/** 来源面：`GET /persona/sources` 与 `POST /persona/scan` 依赖它。 */
export interface PersonaSourceService {
  describe(options?: PersonaSourceOptions): Promise<PersonaSourceDescription[]>;
  lastScan(sourceId: string): PersonaScanLedgerEntry | undefined;
  scan(sourceId: string, path?: string): Promise<PersonaScanOutcome>;
}

/** 角色面：`GET /persona/characters` 与 `apply` / `remove` 依赖它。 */
export interface PersonaCharacterService {
  list(): Promise<{ characters: CharacterView[]; skipped: CharacterSkip[] }>;
  get(id: string): Promise<CharacterRecord | undefined>;
  put(input: PutCharacterInput): Promise<PutCharacterResult>;
  apply(petId: string, characterId: string, options?: { writeName?: boolean }): Promise<ApplyOutcome>;
  remove(
    id: string,
  ): Promise<
    | { ok: true; deleted: string }
    | { ok: false; reason: 'unknown-character' | 'character-in-use'; referrers?: readonly PetRef[] }
  >;
}

/** 服务构造输入。 */
export interface PersonaServiceInput {
  /** 角色库目录（`<数据根>/data/persona-characters`）。 */
  readonly characterDir: string;
  readonly configPaths: ConfigPaths;
  /** 用户主配置路径（应用角色时的唯一写盘落点）。 */
  readonly userConfigPath: string;
  /** 自定义来源允许的根（数据根、DSH_HOME）；缺省时只允许 characterDir 的上两级。 */
  readonly allowedRoots?: readonly string[];
}

/** 空卡片字段（来源只给正文时的降级填充）。 */
function emptyCard(): CharaCardData {
  return {
    name: '',
    description: '',
    personality: '',
    scenario: '',
    first_mes: '',
    mes_example: '',
    system_prompt: '',
    post_history_instructions: '',
  };
}

/** 把来源扫描出来的一个角色收敛成 8 字段：有 `data` 就用它，否则正文进 description。 */
function cardOf(character: { name: string; text: string; data?: CharaCardData }): CharaCardData {
  if (character.data !== undefined) return character.data;
  return { ...emptyCard(), name: character.name, description: character.text };
}

/**
 * 建两个服务面（共享同一份 store 与扫描账本）。
 *
 * @param input - 角色库目录与配置路径。
 * @returns `{ persona, characters }`：装配根把同一对实例同时注入路由与来源注册。
 */
export function createPersonaServices(input: PersonaServiceInput): {
  persona: PersonaSourceService;
  characters: PersonaCharacterService;
} {
  const ledger = new Map<string, PersonaScanLedgerEntry>();

  /** 成品配置里所有引用某角色的实例（跨条目）。 */
  const referrersOf = (characterId: string): PetRef[] => {
    const merged = readAllConfig(input.configPaths);
    const out: PetRef[] = [];
    for (const [entry, conf] of Object.entries(merged)) {
      const pets = Array.isArray(conf?.pets) ? (conf.pets as Record<string, unknown>[]) : [];
      for (const pet of pets) {
        if (pet.personaCharacter === characterId) out.push({ pet: String(pet.id), entry });
      }
    }
    return out;
  };

  const persona: PersonaSourceService = {
    describe: (options) => describePersonaSources(options),

    lastScan: (sourceId) => ledger.get(sourceId),

    scan: async (sourceId, path) => {
      const source = personaSource(sourceId);
      if (source === undefined) {
        return { ok: false, reason: 'unknown-persona-source', message: `未注册的人设来源: ${sourceId}` };
      }
      if (typeof source.scan !== 'function') {
        return { ok: false, reason: 'bad-request', message: `来源「${source.name}」不支持扫描` };
      }
      const explicit = (path ?? '').trim();
      // `custom` 没有约定目录：不给路径就无从扫起（回 bad-request，而不是「来源未安装」）。
      if (source.kind === 'custom' && explicit === '') {
        return { ok: false, reason: 'bad-request', message: '自定义来源需要指定路径' };
      }
      // 显式路径一律过闸门：绝对路径 + 允许根内。绝不交给 cwd 相对解析（那等于读任意文件）。
      let resolvedPath: string | undefined;
      if (explicit !== '') {
        const roots = input.allowedRoots ?? [dirname(dirname(input.characterDir))];
        const guard = resolveCardPathInput(explicit, roots);
        if (!guard.ok) return { ok: false, reason: guard.reason, message: guard.message };
        resolvedPath = guard.path;
      }
      const options = resolvedPath === undefined ? undefined : { path: resolvedPath };
      if (typeof source.probe === 'function') {
        const availability = await source.probe(options);
        if (!availability.installed) {
          return explicit !== ''
            ? { ok: false, reason: 'not-found', message: `路径不存在: ${explicit}` }
            : {
                ok: false,
                reason: 'persona-source-unavailable',
                message: `来源「${source.name}」还没有可扫描的产物`,
                expectedPath: availability.path,
              };
        }
      }
      const result = await source.scan(options);
      const imported: { id: string; name: string; reused: boolean }[] = [];
      for (const character of result.characters) {
        const sourceKind = character.data === undefined ? 'custom-text' : (source.kind ?? 'soul-card');
        const outcome = await putCharacter(input.characterDir, {
          fields: cardOf(character),
          source: { kind: sourceKind as CharacterRecord['source']['kind'], id: sourceId, path: character.path },
        });
        imported.push({ id: outcome.record.id, name: outcome.record.name, reused: outcome.reused });
      }
      ledger.set(sourceId, {
        at: new Date().toISOString(),
        scanned: result.characters.length,
        imported: imported.filter((item) => !item.reused).length,
        reused: imported.filter((item) => item.reused).length,
      });
      return {
        ok: true,
        source: sourceId,
        installed: true,
        scanned: result.characters.length,
        imported,
        skipped: result.skipped,
      };
    },
  };

  const characters: PersonaCharacterService = {
    list: async () => {
      const listed = await listCharacters(input.characterDir);
      const merged = readAllConfig(input.configPaths);
      const applied = new Map<string, string[]>();
      for (const conf of Object.values(merged)) {
        const pets = Array.isArray(conf?.pets) ? (conf.pets as Record<string, unknown>[]) : [];
        for (const pet of pets) {
          const id = typeof pet.personaCharacter === 'string' ? pet.personaCharacter : '';
          if (id === '') continue;
          const list = applied.get(id);
          if (list) list.push(String(pet.id));
          else applied.set(id, [String(pet.id)]);
        }
      }
      return {
        characters: listed.characters.map((record) => ({
          ...record,
          chars: projectCard(record).length,
          appliedTo: applied.get(record.id) ?? [],
        })),
        skipped: listed.skipped,
      };
    },

    get: (id) => getCharacter(input.characterDir, id),

    put: (putInput) => putCharacter(input.characterDir, putInput),

    apply: async (petId, characterId, options) => {
      const record = await getCharacter(input.characterDir, characterId);
      if (record === undefined) return { status: 'failed', reason: 'unknown-character' };
      return applyCharacter(input.configPaths, input.userConfigPath, record, petId, options);
    },

    remove: async (id) => {
      const record = await getCharacter(input.characterDir, id);
      if (record === undefined) return { ok: false, reason: 'unknown-character' };
      const referrers = referrersOf(id);
      if (referrers.length > 0) return { ok: false, reason: 'character-in-use', referrers };
      await deleteCharacter(input.characterDir, id);
      return { ok: true, deleted: id };
    },
  };

  return { persona, characters };
}
