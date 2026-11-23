/**
 * 插件自重启的唯一实现：把「请求 → 生效方式 → 提示文案」收在一处。
 *
 * 设置页上曾有两条重启路径：维护卡那条先保存再重启、有四种结论；文件与目录卡里另有一条内联实现
 * （不保存、失败静默、自己安排刷新）。同一个动作两种行为，用户看到的提示也就有两种口径——
 * 所以这里只剩一个入口，差别用参数表达：**要不要先存盘**。
 *
 * 「不保存」这条不是疏漏：搬迁完成后的重启只负责让新位置生效，表单里若有校验错误也不该把这件事挡掉。
 * 而维护卡那条必须先把改动落盘，否则重启换掉的是代码、丢掉的是用户刚改的设置。
 * 有 HMR 时宿主已重新组合本插件，刷新一次页面即拿到新的 client；没有 HMR 时只有桌面 Helper 被重建，
 * 两种情况都如实回给调用方，由这里翻成一句话。
 * owns only 重启的请求、模式判定与提示，never 保存实现、按钮与状态落点。
 * @module dsh-fish-body/src/client/settings/use-plugin-restart
 */
import { requestPluginRestart, schedulePageReload, type RestartMode } from '../plugin-restart.ts';
import type { Feedback } from './feedback.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 一次重启的可选项。 */
export interface PluginRestartOptions {
  /**
   * 重启前先存盘。
   *
   * 给了就必须返回 `true` 才继续：保存失败说明这次改动没落盘，换掉正在跑的代码只会让人以为「保存过了」。
   * 不给（缺省）= 直接重启，用于「让已落盘的位置变更生效」这类不经过表单的动作。
   */
  readonly save?: () => Promise<boolean>;
  /**
   * 重启真的生效之后回调（带宿主回的生效方式）。
   *
   * 只在拿到合法响应时调：失败或保存失败都不调，调用方（设置页的「需重启」计数）因此不用自己判断。
   */
  readonly onDone?: (mode: RestartMode) => void;
}

/** 重启入口。 */
export interface PluginRestart {
  /**
   * 触发一次重启。
   *
   * @param options - 是否先保存；缺省不保存。
   */
  restart(options?: PluginRestartOptions): void;
  /** 正在等宿主回话：按钮据此置灰，也用来挡住连点。 */
  readonly busy: boolean;
}

/**
 * 管理一次重启的生命周期。
 *
 * @param rt - 只用到 `useState`、`useRef`、`useCallback` 与翻译。
 * @param report - 就地显示结论（与保存结论共用一个出口，互相覆盖）。
 * @returns 重启入口与进行中标志。
 */
export function usePluginRestart(
  rt: Pick<SettingsRuntime, 'useState' | 'useRef' | 'useCallback' | 't'>,
  report: (feedback: Feedback) => void,
): PluginRestart {
  const { useState, useRef, useCallback, t } = rt;
  const [busy, setBusy] = useState(false);
  // 重入保护走 ref：setState 是异步的，连点两下会同时读到 busy === false 并各发一个请求。
  const running = useRef(false);

  const restart = useCallback(
    (options?: PluginRestartOptions): void => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      void (async () => {
        try {
          // 保存失败就中止：这一步没成就谈不上「重启让改动生效」。
          if (options?.save !== undefined && !(await options.save())) return;
          report({ kind: '', text: t('restarting') });
          const mode = await requestPluginRestart();
          if (mode === null) {
            report({ kind: 'err', text: t('restartFailed') });
            return;
          }
          if (mode === 'hmr') {
            report({ kind: 'ok', text: t('restartHmr') });
            options?.onDone?.(mode);
            schedulePageReload();
            return;
          }
          // 没有 HMR：桌面 Helper 已重建，但宿主代码还在旧模块里——如实说，别让人以为已经换干净了。
          report({ kind: 'ok', text: t('restartHelper') });
          options?.onDone?.(mode);
        } finally {
          running.current = false;
          setBusy(false);
        }
      })();
    },
    [report, t],
  );

  return { restart, busy };
}
