/**
 * 外部记忆接线：探测记忆插件 → 注册进单槽 → 记账供 `GET /memory` 查。
 *
 * 三条决策：
 * 1. **单槽只填一次**：`ChatMemoryProvider` 的设计就是「同时只有一个后端在改内容」，
 *    所以候选里只有第一个 installed 的会被注册；其余在 `GET /memory` 的 candidates 里可见（`installed:true`
 *    但没被选中会显得奇怪，所以视图里同时给出 `provider.id` 供对照）。
 * 2. **不抢占**：槽里已经有别的东西（第三方插件抢先注册）时**不覆盖**，只标 `slotTakenByOther`。
 *    静默顶掉别人的记忆后端是比「不生效」更糟的故障。
 * 3. **读一次再记账**：注册后立刻读一遍，把条数写进状态——用户点开设置页就能看到
 *    「接上了、读到 N 条」，而不是只有一个 id。
 * @module dsh-fish-body/src/host/plugin/external-memory
 */
import { activeChatMemoryProvider, registerChatMemoryProvider } from '../chat-memory-provider.ts';
import { readMemoryNotes } from '../memory/external.ts';
import { createExternalMemoryProvider, type ExternalMemoryProvider } from '../memory/external.ts';
import {
  detectMemoryCandidates,
  hasMemoryFiles,
  resetMemoryStatus,
  setMemoryCandidates,
  setMemoryProviderStatus,
  setMemorySlotTaken,
  updateMemoryReadResult,
} from '../memory/status.ts';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';

/** 接线结果。 */
export interface ExternalMemoryWiring {
  /** 生效的来源 id；没接上为 null。 */
  readonly providerId: string | null;
  /** 撤销注册并清状态（插件卸载 / 热重载时调）。 */
  dispose(): void;
}

/** 日志口径（与其它 plugin 装配一致：只收一条字符串）。 */
export interface ExternalMemoryLogger {
  info(message: string): void;
  warn(message: string): void;
}

/**
 * 探测并接上一个外部记忆来源。
 *
 * @param options.log - 日志出口。
 * @param options.dshHome - DSH 数据根；缺省现算（测试注入临时目录）。
 * @param options.now - 取当前时刻（测试注入固定时钟）。
 * @returns 接线结果；一个都没装时 `providerId` 为 null，但仍然写入了 candidates 供 UI 展示。
 */
export function wireExternalMemory(options: {
  readonly log: ExternalMemoryLogger;
  readonly dshHome?: string;
  /** 自定义记忆目录；给了就只走这一份，不再回落到自动候选。 */
  readonly customDir?: string;
  readonly now?: () => Date;
}): ExternalMemoryWiring {
  const { log } = options;
  const now = options.now ?? ((): Date => new Date());
  const customDir = options.customDir?.trim() ?? '';
  let dshHome = '';
  if (customDir === '') {
    try {
      dshHome = options.dshHome ?? resolveDshHome();
    } catch (error) {
      log.warn('[fish-body] 外部记忆：取不到 DSH 数据根，跳过（' + errorText(error) + '）');
      return { providerId: null, dispose: () => undefined };
    }
  }
  const customInstalled = customDir !== '' && hasMemoryFiles(customDir);
  const candidates =
    customDir === ''
      ? detectMemoryCandidates(dshHome)
      : [
          {
            id: 'custom-memory',
            label: '自定义记忆目录',
            dir: customDir,
            installed: customInstalled,
            evidence: customInstalled ? '自定义目录' : '没有记忆文件',
          },
        ];
  setMemoryCandidates(candidates);
  const hit = candidates.find((item) => item.installed);
  if (hit === undefined) {
    log.info(
      customDir === ''
        ? '[fish-body] 外部记忆：没有可用的记忆来源（rofm / suzu-memory 都未装）'
        : '[fish-body] 外部记忆：自定义目录里没有可用记忆文件',
    );
    return {
      providerId: null,
      dispose: () => {
        resetMemoryStatus();
      },
    };
  }

  // 不抢占：槽里已有别人的实现时只记录，不覆盖
  const existing = activeChatMemoryProvider();
  if (existing !== null) {
    setMemorySlotTaken(true);
    log.warn('[fish-body] 外部记忆：记忆槽已被 ' + existing.id + ' 占用，' + hit.id + ' 不生效');
    return {
      providerId: null,
      dispose: () => {
        resetMemoryStatus();
      },
    };
  }

  const provider: ExternalMemoryProvider = createExternalMemoryProvider({ id: hit.id, dir: hit.dir });
  const unregister = registerChatMemoryProvider(provider);
  setMemoryProviderStatus({
    id: hit.id,
    dir: hit.dir,
    registeredAt: now().toISOString(),
    notes: 0,
    skipped: 0,
    lastReadAt: '',
  });

  // 立刻读一遍：把「读到几条」写进状态，设置页才不是只有一个 id
  void readMemoryNotes(hit.dir)
    .then((result) => {
      updateMemoryReadResult(result.notes.length, result.skipped.length, now().toISOString());
      log.info(
        '[fish-body] 外部记忆已接上 ' +
          hit.id +
          '：' +
          String(result.notes.length) +
          ' 条（跳过 ' +
          String(result.skipped.length) +
          '），目录 ' +
          hit.dir,
      );
    })
    .catch((error: unknown) => {
      log.warn('[fish-body] 外部记忆首次读取失败：' + errorText(error));
    });

  return {
    providerId: hit.id,
    dispose: () => {
      unregister();
      resetMemoryStatus();
    },
  };
}

/** 错误 → 一句话。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
