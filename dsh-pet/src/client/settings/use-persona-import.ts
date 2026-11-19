/**
 * 设置页「导入文档」数据层：选文件 → base64 → `POST /persona/import` → 预览 → 落库。
 *
 * 三件事在这里划清：① 前端先卡一遍大小与数量（超限直接给 Feedback，**不发请求**）；
 * ② 预览只是本地草稿，名字/描述/性格可以改，改完点「导入角色库」才发 `POST /persona/characters/import`；
 * ③ `cancel()` 只清本地状态，**一个请求都不发**（验收 9 的「不写盘」靠这条）。
 * owns only 一次导入的草稿与两个端点调用，never 角色库列表、宠物配置与卡片渲染。
 * @module dsh-fish-body/src/client/settings/use-persona-import
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { Feedback } from './feedback.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 单文件解码后上限（与宿主一致：768 KiB）。 */
export const IMPORT_FILE_MAX_BYTES = 768 * 1024;
/**
 * 合计上限（与宿主同一口径：768 KiB − 4 KiB）。
 *
 * base64 按 4/3 膨胀：768 KiB 原文恰好压到 1 MiB 请求体，再套一层 JSON（文件名 / 包装）
 * 就会被 413 挡回，所以这里扣掉 4 KiB 预留。客户端先按这个预算拦，绝不把注定 413 的体发出去。
 */
export const IMPORT_TOTAL_MAX_BYTES = 768 * 1024 - 4096;
/** 最多几个文件（与宿主一致：5）。 */
export const IMPORT_MAX_FILES = 5;

/** 浏览器 `File` 的最小子集（测试里给同形的假对象）。 */
export interface ImportFileLike {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** 预览草稿：8 字段里只有三格可编辑，其余随预览透传。 */
export interface ImportPreviewDraft {
  readonly name: string;
  readonly description: string;
  readonly personality: string;
  readonly scenario: string;
  readonly first_mes: string;
  readonly mes_example: string;
  readonly system_prompt: string;
  readonly post_history_instructions: string;
  /** 投影后的正文（宿主算好的，只读）。 */
  readonly text: string;
  readonly chars: number;
}

/** {@link usePersonaImport} 的依赖。 */
export interface PersonaImportDeps {
  readonly petId: string;
  readonly report: (feedback: Feedback) => void;
  /** 落库成功（卡片据此刷新角色列表）。 */
  readonly onImported?: (character: { id: string; name: string; reused: boolean }) => void;
}

/** 状态与动作。 */
export interface PersonaImportState {
  readonly preview: ImportPreviewDraft | null;
  /** 选中的文件名（预览块的标题用）。 */
  readonly files: readonly string[];
  readonly busy: boolean;
  /** 选文件并请求预览；失败只报错，不进入预览态。 */
  pick(files: readonly ImportFileLike[]): Promise<void>;
  /** 改预览里的一个字段（只在本地）。 */
  update(patch: Partial<Pick<ImportPreviewDraft, 'name' | 'description' | 'personality'>>): void;
  /** 落库；成功返回 true。 */
  commit(): Promise<boolean>;
  /** 取消：只清本地草稿，不发任何请求。 */
  cancel(): void;
}

/** 数组缓冲 → base64（分块拼，768 KiB 直接 spread 会爆栈）。 */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/** 发 JSON；返回体或 null。 */
async function postJson(path: string, body: unknown): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(ROUTE_PATH + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 把宿主返回的预览收窄成草稿；形状不对返回 null。 */
function draftOf(raw: unknown): ImportPreviewDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const text = typeof record.text === 'string' ? record.text : '';
  const str = (key: string): string => (typeof record[key] === 'string' ? (record[key] as string) : '');
  return {
    name: str('name'),
    description: str('description'),
    personality: str('personality'),
    scenario: str('scenario'),
    first_mes: str('first_mes'),
    mes_example: str('mes_example'),
    system_prompt: str('system_prompt'),
    post_history_instructions: str('post_history_instructions'),
    text,
    chars: typeof record.chars === 'number' ? record.chars : text.length,
  };
}

/**
 * 文档导入数据层。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @param deps - 当前实例、反馈出口与落库回调。
 * @returns 草稿、预览与四个动作。
 */
export function usePersonaImport(
  rt: Pick<SettingsRuntime, 'useState' | 't'>,
  deps: PersonaImportDeps,
): PersonaImportState {
  const { useState, t } = rt;
  const { petId, report, onImported } = deps;
  const [preview, setPreview] = useState<ImportPreviewDraft | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const pick = async (picked: readonly ImportFileLike[]): Promise<void> => {
    if (picked.length === 0) return;
    if (picked.length > IMPORT_MAX_FILES) {
      report({ kind: 'err', text: t('personaImportTooMany').replace('{n}', String(IMPORT_MAX_FILES)) });
      return;
    }
    const total = picked.reduce((sum, file) => sum + file.size, 0);
    if (picked.some((file) => file.size > IMPORT_FILE_MAX_BYTES) || total > IMPORT_TOTAL_MAX_BYTES) {
      report({ kind: 'err', text: t('personaImportTooLarge') });
      return;
    }
    setBusy(true);
    try {
      const payload = await Promise.all(
        picked.map(async (file) => ({ name: file.name, base64: toBase64(await file.arrayBuffer()) })),
      );
      const body = await postJson('/persona/import', { pet: petId, files: payload });
      if (body === null || body.ok !== true) {
        report({ kind: 'err', text: String(body?.message ?? t('personaImportFailed')) });
        return;
      }
      const draft = draftOf(body.preview);
      if (draft === null) {
        report({ kind: 'err', text: t('personaImportFailed') });
        return;
      }
      setPreview(draft);
      setFiles(picked.map((file) => file.name));
    } finally {
      setBusy(false);
    }
  };

  const update = (patch: Partial<Pick<ImportPreviewDraft, 'name' | 'description' | 'personality'>>): void => {
    setPreview((current) => (current === null ? null : { ...current, ...patch }));
  };

  const commit = async (): Promise<boolean> => {
    if (preview === null) return false;
    setBusy(true);
    try {
      const body = await postJson('/persona/characters/import', {
        character: {
          name: preview.name,
          description: preview.description,
          personality: preview.personality,
          scenario: preview.scenario,
          first_mes: preview.first_mes,
          mes_example: preview.mes_example,
          system_prompt: preview.system_prompt,
          post_history_instructions: preview.post_history_instructions,
        },
        source: { kind: 'document', id: 'import', path: files.join(', ') },
      });
      if (body === null || body.ok !== true) {
        report({ kind: 'err', text: String(body?.message ?? t('personaImportFailed')) });
        return false;
      }
      const character = body.character as { id?: unknown; name?: unknown } | undefined;
      const id = typeof character?.id === 'string' ? character.id : '';
      const name = typeof character?.name === 'string' ? character.name : preview.name;
      const reused = body.reused === true;
      onImported?.({ id, name, reused });
      report({ kind: 'ok', text: t('personaImportDone').replace('{name}', name) });
      setPreview(null);
      setFiles([]);
      return true;
    } finally {
      setBusy(false);
    }
  };

  const cancel = (): void => {
    // 只清本地：不发请求、不写草稿（手写人设一字不动）
    setPreview(null);
    setFiles([]);
  };

  return { preview, files, busy, pick, update, commit, cancel };
}
