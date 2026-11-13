/**
 * 「撤销改动」：把这一页没保存的编辑丢掉，回到服务端权威值。
 *
 * 实现是「重新拉一次配置」而不是本地回滚快照：快照要维护一份从路径到控件状态的还原映射，
 * 而重新加载本来就是这条链路已有的能力——加载成功会走同一个 `applyConfig` 推进基线，
 * 圆点、字段与宠物列表一起归位，不会出现「一半回滚了、另一半没回」。
 * 代价是它依赖服务端可达：拉不到就把失败如实说出来，页面保持原样（不做本地猜测）。
 * owns only 这次「重读」的状态机，never 加载、写盘与基线的实现。
 * @module dsh-pet/src/client/settings/use-revert
 */
import type { LoadState } from './config/index.ts';
import type { Feedback } from './feedback.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 撤销的依赖。 */
export interface RevertDeps {
  /** 当前加载状态：撤销期间会短暂回到 `loading`，成功 / 失败由它落地。 */
  readonly loadState: LoadState;
  /** 重新拉主配置（`useConfigLoad.retry`）。 */
  retry(): void;
  /** 重新拉会话鱼设置（它不在成品配置里，要单独重读一次）。 */
  reloadFish(): void;
  /** 就地显示结果。 */
  report(feedback: Feedback): void;
}

/** 撤销入口与它的进行中标志。 */
export interface RevertState {
  /** 请求撤销；重复点无效（按钮在 pending 期间已被 loadState 带成禁用）。 */
  revert(): void;
  /** 撤销正在进行：外壳据此把按钮留在禁用态。 */
  readonly pending: boolean;
}

/**
 * 管理「撤销改动」的一次往返。
 *
 * @param rt - 注入的 `useState` / `useEffect` 与翻译函数。
 * @param deps - 加载状态与两个重读入口。
 * @returns 撤销入口与进行中标志。
 */
export function useRevert(rt: Pick<SettingsRuntime, 'useState' | 'useEffect' | 't'>, deps: RevertDeps): RevertState {
  const { useState, useEffect, t } = rt;
  const [pending, setPending] = useState(false);
  const { loadState, report } = deps;

  useEffect(() => {
    if (!pending) return;
    // 只有「这次撤销引发的重读」才落到这两条分支：pending 期间别的事件不会把它置回 false。
    if (loadState === 'ready') {
      setPending(false);
      report({ kind: '', text: t('revertDone') });
      return;
    }
    if (loadState === 'error') {
      setPending(false);
      report({ kind: 'err', text: t('revertFailed') });
    }
  }, [pending, loadState, report, t]);

  const revert = (): void => {
    setPending(true);
    report({ kind: '', text: t('loading') });
    deps.reloadFish();
    deps.retry();
  };

  return { revert, pending };
}
