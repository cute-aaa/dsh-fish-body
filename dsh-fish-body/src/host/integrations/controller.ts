/**
 * 接入配置控制器：把路径校验、持久化与 memory 运行时重连收在一条写链里。
 *
 * 写链顺序是「校验 → 重连 memory → 原子写配置」；写盘失败时把 memory 恢复到上一份选择。
 * persona 不持有运行时 provider，扫描时现读配置即可。
 * @module dsh-fish-body/src/host/integrations/controller
 */
import {
  readIntegrations,
  integrationsView,
  prepareIntegrationsPatch,
  type IntegrationPathResult,
  type IntegrationPatchFailureReason,
  inspectIntegrationPath,
  writeIntegrations,
} from './store.ts';
import type { IntegrationsView } from '../../shared/integrations.ts';
import { memorySelectionOf, type MemoryApplyResult, type MemorySelection } from '../memory/controller.ts';

/** 设置页更新接入配置的结论。 */
export type IntegrationsUpdateResult =
  | { readonly ok: true; readonly view: IntegrationsView }
  | {
      readonly ok: false;
      readonly reason: IntegrationPatchFailureReason | 'integration-unavailable' | 'settings-write-failed';
      readonly message: string;
    };

/** 接入配置控制器。 */
export interface IntegrationsController {
  /** 当前视图（读盘后的可用性与原因）。 */
  view(): IntegrationsView;
  /** 应用一次局部更新。 */
  update(patch: unknown): IntegrationsUpdateResult;
  /** persona 自定义来源当前可用的真实路径；未配置或不可用为 null。 */
  personaPath(): string | null;
  /** 当前 memory 选择。 */
  memorySelection(): MemorySelection;
}

/**
 * 造接入配置控制器。
 *
 * @param options - 数据根、默认允许根和 memory 切换口。
 * @returns 控制器；不持有额外资源。
 */
export function createIntegrationsController(options: {
  readonly userRoot: string;
  readonly roots: readonly string[];
  readonly applyMemory: (selection: MemorySelection) => MemoryApplyResult;
}): IntegrationsController {
  const { userRoot, roots, applyMemory } = options;

  const personaPath = (): string | null => {
    const { config } = readIntegrations(userRoot);
    const result: IntegrationPathResult = inspectIntegrationPath(
      config.persona.customPath,
      roots,
      config.persona.approvedExternal,
      'any',
    );
    return result.ok ? result.path : null;
  };

  return {
    view: () => integrationsView(userRoot, roots),
    memorySelection: () => memorySelectionOf(readIntegrations(userRoot).config.memory),
    personaPath,
    update: (patch) => {
      const before = readIntegrations(userRoot).config;
      const prepared = prepareIntegrationsPatch(before, patch, roots);
      if (!prepared.ok) return prepared;
      const next = prepared.config;
      const memoryChanged =
        before.memory.mode !== next.memory.mode ||
        before.memory.customDir !== next.memory.customDir ||
        before.memory.approvedExternal !== next.memory.approvedExternal;
      if (memoryChanged) {
        const rewired = applyMemory(memorySelectionOf(next.memory));
        if (!rewired.ok) return { ok: false, reason: 'integration-unavailable', message: rewired.message };
      }
      try {
        writeIntegrations(userRoot, next);
      } catch (error) {
        if (memoryChanged) applyMemory(memorySelectionOf(before.memory));
        return {
          ok: false,
          reason: 'settings-write-failed',
          message: error instanceof Error ? error.message : String(error),
        };
      }
      return { ok: true, view: integrationsView(userRoot, roots) };
    },
  };
}
