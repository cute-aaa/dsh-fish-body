/**
 * 设置页「角色」数据层：按当前实例拉来源与角色库，并提供扫描 / 应用 / 删除三个动作。
 *
 * 作用域是 `petId`：切 chip 就换作用域（重发 `?pet=`），旧请求由 AbortController 取消，迟到的响应不会
 * 盖掉新实例的数据。任何一次读失败都**降级**成「只有内置编辑」并报一条 Feedback，不把异常抛给 React。
 * 应用成功后必须回填草稿与基线（否则下次保存会把角色正文盖回旧值）：这里只负责把宿主写进去的那一份
 * 交给 `onApplied`，草稿与基线由装配根推进。
 * owns only 角色库的数据与三个动作，never 草稿写盘、基线推进与卡片渲染。
 * @module dsh-fish-body/src/client/settings/use-persona-characters
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { Feedback } from './feedback.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 一个来源的可用性描述（与 `GET /persona/sources` 同形）。 */
export interface PersonaSourceView {
  readonly id: string;
  readonly name: string;
  readonly kind: 'soul-card' | 'custom' | 'editor';
  readonly installed: boolean;
  readonly expectedPath: string | null;
  readonly path: string | null;
  readonly scannable: boolean;
  readonly lastScan: { at: string; scanned: number; imported: number; reused: number } | null;
}

/** 角色库里的一条（与 `GET /persona/characters` 同形）。 */
export interface PersonaCharacterView {
  readonly id: string;
  readonly name: string;
  readonly source: { kind: string; id: string; path: string };
  readonly importedAt: string;
  readonly chars: number;
  readonly appliedTo: readonly string[];
}

/** 当前实例的作用域（`writable:false` = pet pack 实例，只能浏览不能应用）。 */
export interface PersonaScopeView {
  readonly id: string;
  readonly entry: string;
  readonly writable: boolean;
  readonly character: string | null;
}

/** {@link usePersonaCharacters} 的依赖。 */
export interface PersonaCharactersDeps {
  /** 当前选中的实例 id（作用域）。 */
  readonly petId: string;
  readonly report: (feedback: Feedback) => void;
  /** 应用成功后把宿主写进配置的那一份交给装配根（只回填这一只）。 */
  readonly onApplied?: (
    petId: string,
    fields: { whisperPrompt: string; name?: string; personaCharacter: string },
  ) => void;
}

/** 扫描的回执。 */
export interface PersonaScanOutcome {
  readonly scanned: number;
  readonly imported: { id: string; name: string; reused: boolean }[];
  readonly skipped: { path: string; reason: string }[];
}

/** 应用的回执（`unchanged` = 三个键都已是目标值、没有写盘）。 */
export type PersonaApplyOutcome = 'applied' | 'unchanged' | null;

/** 状态与动作。 */
export interface PersonaCharactersState {
  readonly sources: readonly PersonaSourceView[];
  readonly characters: readonly PersonaCharacterView[];
  readonly scope: PersonaScopeView | null;
  /** 首次加载完成（false 时卡片显示骨架，动作按钮禁用）。 */
  readonly ready: boolean;
  readonly busy: boolean;
  /** 读失败已降级成「只有内置编辑」。 */
  readonly degraded: boolean;
  scan(sourceId: string, path?: string): Promise<PersonaScanOutcome | null>;
  /**
   * 应用角色。
   *
   * @param characterId - 要应用的角色。
   * @param writeName - 是否同时把实例名改成角色名。
   * @param draftText - 应用前的草稿正文；非空且与角色正文不同时，状态行会明说「被覆盖」。
   */
  apply(characterId: string, writeName: boolean, draftText?: string): Promise<PersonaApplyOutcome>;
  remove(characterId: string): Promise<boolean>;
  /** 重新拉来源与角色库（同实例重试）。 */
  reload(): void;
}

/** 降级时唯一可用的来源：内置人设编辑（不引用任何角色）。 */
function editorOnlyView(name: string): PersonaSourceView {
  return {
    id: 'editor',
    name,
    kind: 'editor',
    installed: true,
    expectedPath: null,
    path: null,
    scannable: false,
    lastScan: null,
  };
}

/** 读 JSON；网络失败 / 非 2xx / `ok:false` 都返回 null。 */
async function getJson(path: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(ROUTE_PATH + path, signal === undefined ? {} : { signal });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    return body.ok === false ? null : body;
  } catch {
    return null;
  }
}

/** 发 JSON；返回体（失败也回，调用方按 `ok` 判）。 */
async function postJson(path: string, body: unknown, method = 'POST'): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(ROUTE_PATH + path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'DELETE' ? undefined : JSON.stringify(body),
    });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 角色库数据层。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @param deps - 当前实例、反馈出口与应用成功回调。
 * @returns 来源 / 角色 / 作用域与三个动作。
 */
export function usePersonaCharacters(
  rt: Pick<SettingsRuntime, 'useState' | 'useEffect' | 't'>,
  deps: PersonaCharactersDeps,
): PersonaCharactersState {
  const { useState, useEffect, t } = rt;
  const { petId, report, onApplied } = deps;
  const [sources, setSources] = useState<PersonaSourceView[]>([]);
  const [characters, setCharacters] = useState<PersonaCharacterView[]>([]);
  const [scope, setScope] = useState<PersonaScopeView | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    void (async () => {
      const [sourcesBody, charactersBody] = await Promise.all([
        getJson('/persona/sources?pet=' + encodeURIComponent(petId), controller.signal),
        getJson('/persona/characters', controller.signal),
      ]);
      if (!alive) return;
      if (sourcesBody === null) {
        // 降级：只有内置编辑，页面仍能渲染（不影响手写人设）
        setSources([editorOnlyView(t('personaEditorSource'))]);
        setCharacters([]);
        setScope(null);
        setDegraded(true);
        setReady(true);
        report({ kind: 'err', text: t('personaLoadFailed') });
        return;
      }
      setSources(Array.isArray(sourcesBody.sources) ? (sourcesBody.sources as PersonaSourceView[]) : []);
      setScope(
        sourcesBody.pet !== undefined && sourcesBody.pet !== null ? (sourcesBody.pet as PersonaScopeView) : null,
      );
      setCharacters(
        charactersBody !== null && Array.isArray(charactersBody.characters)
          ? (charactersBody.characters as PersonaCharacterView[])
          : [],
      );
      setDegraded(false);
      setReady(true);
    })();
    return () => {
      alive = false;
      controller.abort();
    };
    // report / t 由装配根保证稳定；进依赖会让每次渲染都重拉一次来源。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petId, tick]);

  /** 重新拉一次列表（动作成功后用）。 */
  const refresh = async (): Promise<void> => {
    const body = await getJson('/persona/characters');
    if (body !== null && Array.isArray(body.characters)) {
      setCharacters(body.characters as PersonaCharacterView[]);
    }
  };

  const scan = async (sourceId: string, path?: string): Promise<PersonaScanOutcome | null> => {
    setBusy(true);
    try {
      const body = await postJson(
        '/persona/scan',
        path === undefined ? { source: sourceId } : { source: sourceId, path },
      );
      if (body === null || body.ok !== true) {
        report({ kind: 'err', text: String(body?.message ?? t('personaScanFailed')) });
        return null;
      }
      await refresh();
      // 扫描账本也跟着更新：来源下拉上的「上次扫描」要与角色库一致
      const sourcesBody = await getJson('/persona/sources?pet=' + encodeURIComponent(petId));
      if (sourcesBody !== null && Array.isArray(sourcesBody.sources)) {
        setSources(sourcesBody.sources as PersonaSourceView[]);
      }
      const outcome: PersonaScanOutcome = {
        scanned: typeof body.scanned === 'number' ? body.scanned : 0,
        imported: Array.isArray(body.imported) ? (body.imported as PersonaScanOutcome['imported']) : [],
        skipped: Array.isArray(body.skipped) ? (body.skipped as PersonaScanOutcome['skipped']) : [],
      };
      report({
        kind: 'ok',
        text: (outcome.scanned === 0 ? t('personaScanNothing') : t('personaScanDone')).replace(
          '{n}',
          String(outcome.scanned),
        ),
      });
      return outcome;
    } finally {
      setBusy(false);
    }
  };

  const apply = async (characterId: string, writeName: boolean, draftText = ''): Promise<PersonaApplyOutcome> => {
    setBusy(true);
    try {
      const body = await postJson('/persona/characters/apply', { pet: petId, characterId, writeName });
      if (body === null || body.ok !== true) {
        report({ kind: 'err', text: String(body?.message ?? t('personaApplyFailed')) });
        return null;
      }
      const unchanged = body.unchanged === true;
      // 回填要用**宿主写进去的那一份**：再读一次配置，只取这一只（不整页重读，用户别处未保存的改动不受影响）。
      const config = await getJson('/config');
      const pets = config !== null && config.main !== undefined ? (config.main as { pets?: unknown }).pets : undefined;
      const target = Array.isArray(pets)
        ? (pets as Array<Record<string, unknown>>).find((item) => item.id === petId)
        : undefined;
      if (target !== undefined && onApplied !== undefined) {
        onApplied(petId, {
          whisperPrompt: typeof target.whisperPrompt === 'string' ? target.whisperPrompt : '',
          ...(typeof target.name === 'string' ? { name: target.name } : {}),
          personaCharacter: typeof target.personaCharacter === 'string' ? target.personaCharacter : characterId,
        });
      }
      await refresh();
      const chars = typeof body.chars === 'number' ? body.chars : 0;
      // 草稿里本来写了别的人设、这次被角色正文盖掉：状态行要说清楚，别让用户以为只是「应用成功」。
      const overwrote =
        !unchanged && draftText.trim() !== '' && target !== undefined && draftText !== target.whisperPrompt;
      report({
        kind: 'ok',
        text: (unchanged
          ? t('personaApplyUnchanged')
          : overwrote
            ? t('personaApplyOverwrote')
            : t('personaApplyDone')
        ).replace('{n}', String(chars)),
      });
      return unchanged ? 'unchanged' : 'applied';
    } finally {
      setBusy(false);
    }
  };

  const remove = async (characterId: string): Promise<boolean> => {
    setBusy(true);
    try {
      const body = await postJson('/persona/characters/' + encodeURIComponent(characterId), undefined, 'DELETE');
      if (body === null || body.ok !== true) {
        report({ kind: 'err', text: String(body?.message ?? t('personaRemoveFailed')) });
        return false;
      }
      await refresh();
      report({ kind: 'ok', text: t('personaRemoveDone') });
      return true;
    } finally {
      setBusy(false);
    }
  };

  return {
    sources,
    characters,
    scope,
    ready,
    busy,
    degraded,
    scan,
    apply,
    remove,
    reload: () => setTick((value) => value + 1),
  };
}
