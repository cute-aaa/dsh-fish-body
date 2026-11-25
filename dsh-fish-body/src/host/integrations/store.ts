/**
 * 外部接入配置的读写与路径判定：persona 自定义路径、memory 自定义目录共用一份规则。
 *
 * 配置固定落 `<数据根>/config/integrations.json`；写入采用同目录临时文件再 rename，
 * 覆盖前保留一份 `.bak-<时间戳>`。这里只判断路径是否可用，不读取 persona 或 memory 的内容。
 * @module dsh-fish-body/src/host/integrations/store
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  DEFAULT_INTEGRATIONS,
  type IntegrationEntryView,
  type IntegrationPathState,
  type IntegrationsConfig,
  type IntegrationsView,
} from '../../shared/integrations.ts';
import { parseIntegrationsConfig } from './schema.ts';

/** 文件名（放在插件数据根的 config 目录）。 */
export const INTEGRATIONS_FILE = 'integrations.json';

/** 一次读取的结果：坏文件按默认值降级，但保留可展示的问题。 */
export interface IntegrationsRead {
  readonly config: IntegrationsConfig;
  /** 文件存在但读不出来时的原因；正常或缺省为空串。 */
  readonly issue: string;
}

/** 路径解析成功。 */
export interface IntegrationPathOk {
  readonly ok: true;
  /** realpath 后的绝对路径。 */
  readonly path: string;
  /** 是否位于数据根 / DSH_HOME 之外。 */
  readonly external: boolean;
}

/** 路径解析失败。 */
export interface IntegrationPathFailure {
  readonly ok: false;
  readonly state: IntegrationPathState;
  readonly message: string;
}

/** 路径解析结果。 */
export type IntegrationPathResult = IntegrationPathOk | IntegrationPathFailure;

/** 设置页补丁失败原因。 */
export type IntegrationPatchFailureReason = 'bad-request' | 'external-approval-required';

/** 规范化路径的比较口径；分隔符按平台规则处理。 */
function insideAny(target: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    const rel = relative(root, target);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  });
}

/** 把一个根解析到真实路径；不存在时保留 resolve 结果，便于生成可读错误。 */
function realRoot(root: string): string {
  const value = root.trim();
  if (value === '') return '';
  try {
    return realpathSync(value);
  } catch {
    return resolve(value);
  }
}

/** 配置文件路径。 */
export function integrationsFile(userRoot: string): string {
  return join(userRoot, 'config', INTEGRATIONS_FILE);
}

/** 读配置；缺文件是正常状态，坏文件降级但不静默覆盖。 */
export function readIntegrations(userRoot: string): IntegrationsRead {
  const file = integrationsFile(userRoot);
  if (!existsSync(file)) return { config: DEFAULT_INTEGRATIONS, issue: '' };
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return { config: DEFAULT_INTEGRATIONS, issue: '接入配置无法读取，已按默认值运行' };
  }
  try {
    const parsed = parseIntegrationsConfig(JSON.parse(raw) as unknown);
    return parsed === undefined
      ? { config: DEFAULT_INTEGRATIONS, issue: '接入配置形状不合法，已按默认值读取' }
      : { config: parsed, issue: '' };
  } catch {
    return { config: DEFAULT_INTEGRATIONS, issue: '接入配置不是合法 JSON，已按默认值读取' };
  }
}

/**
 * 原子写入配置。
 *
 * @param userRoot - 用户数据根。
 * @param config - 已通过 schema 校验的完整配置。
 * @throws {Error} 目录不可写或 rename 失败时；调用方负责映射成 200 + 失败实体。
 */
export function writeIntegrations(userRoot: string, config: IntegrationsConfig): void {
  const file = integrationsFile(userRoot);
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) copyFileSync(file, file + '.bak-' + Date.now());
  const temp = file + '.tmp-' + process.pid + '-' + Date.now();
  try {
    writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', 'utf8');
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/**
 * 校验一条配置路径。
 *
 * @param raw - 用户输入的路径；空串表示未配置。
 * @param roots - 默认允许根（数据根、DSH_HOME）。
 * @param approvedExternal - 用户是否已确认允许读取外部路径。
 * @param expected - 期望的文件系统类型。
 * @returns 规范化路径或可展示的失败原因。
 */
export function inspectIntegrationPath(
  raw: string | null,
  roots: readonly string[],
  approvedExternal: boolean,
  expected: 'file' | 'dir' | 'any',
): IntegrationPathResult {
  const value = (raw ?? '').trim();
  if (value === '') return { ok: false, state: 'unset', message: '' };
  if (!isAbsolute(value)) return { ok: false, state: 'invalid', message: '路径必须是绝对路径' };

  let path: string;
  let stat: ReturnType<typeof statSync>;
  try {
    path = realpathSync(value);
    stat = statSync(path);
  } catch {
    return { ok: false, state: 'missing', message: '路径不存在或无法读取' };
  }
  if (expected === 'file' && !stat.isFile()) return { ok: false, state: 'invalid', message: '这里需要选择文件' };
  if (expected === 'dir' && !stat.isDirectory()) return { ok: false, state: 'invalid', message: '这里需要选择目录' };

  const external = !insideAny(
    path,
    roots.map(realRoot).filter((root) => root !== ''),
  );
  if (external && !approvedExternal) {
    return { ok: false, state: 'unapproved', message: '该路径在数据根 / DSH_HOME 之外，需要先确认读取授权' };
  }
  return { ok: true, path, external };
}

/**
 * 把原始配置收成可在设置页展示的视图。
 *
 * @param userRoot - 用户数据根。
 * @param roots - 默认允许根。
 * @returns 两侧路径与状态；不抛异常。
 */
export function integrationsView(userRoot: string, roots: readonly string[]): IntegrationsView {
  const { config, issue } = readIntegrations(userRoot);
  const personaResult = inspectIntegrationPath(
    config.persona.customPath,
    roots,
    config.persona.approvedExternal,
    'any',
  );
  const memoryResult =
    config.memory.mode === 'auto'
      ? ({ ok: false, state: 'unset', message: '' } as const)
      : inspectIntegrationPath(config.memory.customDir, roots, config.memory.approvedExternal, 'dir');
  const entry = (result: IntegrationPathResult, configured: string | null): IntegrationEntryView => ({
    path: result.ok ? result.path : configured,
    approvedExternal: configured !== null && result.ok ? result.external : false,
    state: result.ok ? 'ok' : result.state,
    message: issue !== '' && configured !== null ? issue : result.ok ? '' : result.message,
  });
  return {
    persona: entry(personaResult, config.persona.customPath),
    memory: {
      ...entry(memoryResult, config.memory.customDir),
      mode: config.memory.mode,
    },
  };
}

/**
 * 取当前 persona 自定义路径；只有配置存在、路径可用且外部授权有效时才返回。
 *
 * @param userRoot - 用户数据根。
 * @param roots - 默认允许根。
 * @returns realpath 后的文件或目录；不可用时 null。
 */
export function configuredPersonaPath(userRoot: string, roots: readonly string[]): string | null {
  const { config } = readIntegrations(userRoot);
  const result = inspectIntegrationPath(config.persona.customPath, roots, config.persona.approvedExternal, 'any');
  return result.ok ? result.path : null;
}

/**
 * 把一次设置页补丁变成可持久化的完整配置；外部路径只在本次显式确认时放行。
 *
 * @param base - 当前配置。
 * @param patch - 请求体里的局部配置。
 * @param roots - 默认允许根。
 * @returns 新配置；路径或补丁不合法时返回失败原因。
 */
export function prepareIntegrationsPatch(
  base: IntegrationsConfig,
  patch: unknown,
  roots: readonly string[],
): { ok: true; config: IntegrationsConfig } | { ok: false; reason: IntegrationPatchFailureReason; message: string } {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, reason: 'bad-request', message: '请求体必须是对象' };
  }
  const raw = patch as Record<string, unknown>;
  const personaRaw = raw.persona;
  const memoryRaw = raw.memory;
  let persona = base.persona;
  let memory = base.memory;

  if (personaRaw !== undefined) {
    if (personaRaw === null || typeof personaRaw !== 'object' || Array.isArray(personaRaw)) {
      return { ok: false, reason: 'bad-request', message: 'persona 必须是对象' };
    }
    const item = personaRaw as Record<string, unknown>;
    const pathChanged = item.customPath !== undefined;
    const customPath =
      item.customPath === null ? null : typeof item.customPath === 'string' ? item.customPath : base.persona.customPath;
    const approve = pathChanged ? item.approvedExternal === true : base.persona.approvedExternal;
    const inspected = inspectIntegrationPath(customPath, roots, approve, 'any');
    if (customPath !== null && !inspected.ok) {
      return {
        ok: false,
        reason: inspected.state === 'unapproved' ? 'external-approval-required' : 'bad-request',
        message: inspected.message,
      };
    }
    persona = {
      customPath: inspected.ok ? inspected.path : null,
      approvedExternal: inspected.ok ? inspected.external : false,
    };
  }

  if (memoryRaw !== undefined) {
    if (memoryRaw === null || typeof memoryRaw !== 'object' || Array.isArray(memoryRaw)) {
      return { ok: false, reason: 'bad-request', message: 'memory 必须是对象' };
    }
    const item = memoryRaw as Record<string, unknown>;
    const mode = item.mode === 'custom' ? 'custom' : item.mode === 'auto' ? 'auto' : base.memory.mode;
    const dirChanged = item.customDir !== undefined;
    const customDir =
      item.customDir === null ? null : typeof item.customDir === 'string' ? item.customDir : base.memory.customDir;
    if (mode === 'custom') {
      const approve = dirChanged ? item.approvedExternal === true : base.memory.approvedExternal;
      const inspected = inspectIntegrationPath(customDir, roots, approve, 'dir');
      if (!inspected.ok) {
        return {
          ok: false,
          reason: inspected.state === 'unapproved' ? 'external-approval-required' : 'bad-request',
          message: inspected.message,
        };
      }
      memory = {
        mode,
        customDir: inspected.path,
        approvedExternal: inspected.external,
      };
    } else {
      memory = { mode: 'auto', customDir: null, approvedExternal: false };
    }
  }

  const next: IntegrationsConfig = { version: 1, persona, memory };
  const parsed = parseIntegrationsConfig(next);
  return parsed === undefined
    ? { ok: false, reason: 'bad-request', message: '接入配置形状不合法' }
    : { ok: true, config: parsed };
}
