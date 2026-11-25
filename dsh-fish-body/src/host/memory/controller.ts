/**
 * 外部记忆的运行时控制器：自动候选与用户自定义目录共用同一条单槽接线。
 *
 * 切换来源时先释放上一份 provider，再注册下一份；第三方已占用单槽时仍只报告、不抢占。
 * @module dsh-fish-body/src/host/memory/controller
 */
import { wireExternalMemory, type ExternalMemoryLogger, type ExternalMemoryWiring } from '../plugin/external-memory.ts';
import type { MemoryIntegration } from '../../shared/integrations.ts';

/** 当前记忆来源选择。 */
export interface MemorySelection {
  readonly mode: 'auto' | 'custom';
  readonly customDir: string | null;
}

/** 切换记忆来源的结论。 */
export type MemoryApplyResult =
  { readonly ok: true; readonly providerId: string | null } | { readonly ok: false; readonly message: string };

/** 记忆控制器。 */
export interface MemoryController {
  /** 切换来源；失败时保留上一份接线。 */
  apply(selection: MemorySelection): MemoryApplyResult;
  /** 当前接线；未接线时为 null。 */
  current(): ExternalMemoryWiring | null;
  dispose(): void;
}

/**
 * 造记忆控制器并立即接线一次。
 *
 * @param options - 日志、DSH 根、初始配置与时钟。
 * @returns 控制器；dispose 后不可复用。
 */
export function createMemoryController(options: {
  readonly log: ExternalMemoryLogger;
  readonly dshHome?: string;
  readonly initial: MemorySelection;
  readonly now?: () => Date;
}): MemoryController {
  let wiring: ExternalMemoryWiring | null = null;

  const apply = (selection: MemorySelection): MemoryApplyResult => {
    if (selection.mode === 'custom' && (selection.customDir ?? '').trim() === '') {
      return { ok: false, message: '自定义记忆模式需要选择目录' };
    }
    // 先释放自己的旧 provider，否则新接线会把自己当成「槽被第三方占用」。
    wiring?.dispose();
    wiring = null;
    const next = wireExternalMemory({
      log: options.log,
      ...(options.dshHome === undefined ? {} : { dshHome: options.dshHome }),
      ...(selection.mode === 'custom' && selection.customDir !== null ? { customDir: selection.customDir } : {}),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    wiring = next;
    return { ok: true, providerId: next.providerId };
  };

  apply(options.initial);

  return {
    apply,
    current: () => wiring,
    dispose: () => {
      wiring?.dispose();
      wiring = null;
    },
  };
}

/** 从持久化配置取出控制器需要的选择。 */
export function memorySelectionOf(config: MemoryIntegration): MemorySelection {
  return config.mode === 'custom' ? { mode: 'custom', customDir: config.customDir } : { mode: 'auto', customDir: null };
}
