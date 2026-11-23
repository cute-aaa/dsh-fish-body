/**
 * 会话鱼设置的草稿状态：加载、皮肤清单、改值、保存与重置默认。
 *
 * 这些字段写的是独立文件 `session-fish.json`，保存语义是「只提交这几项」，所以它不参与主配置的
 * 整包写盘，由外壳在「应用 / 确定」时单独触发一次 `save()`；重置则写 `DEFAULT_SESSION_FISH_SETTINGS`。
 * 加载失败仍给出一份默认草稿（表单可用），但会如实报错——保存会覆盖文件，这一点必须在提示里说清。
 * 服务端权威值到达时回调 `onAuthoritative`，外壳据此推进「未保存改动」的基线。
 * owns only 会话鱼草稿与两个写入口，never 主配置、圆点判定与按钮的可用性。
 * @module dsh-fish-body/src/client/settings/use-session-fish
 */
import { DEFAULT_SESSION_FISH_SETTINGS, type SessionFishSettings } from '../../shared/session-fish.ts';
import {
  loadSessionFishSettings,
  loadSessionFishSkins,
  saveSessionFishSettings,
  type SessionFishSkinOption,
} from '../session-fish/api.ts';
import { clearFishOffsets } from '../session-fish/offsets.ts';
import type { Feedback } from './feedback.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 会话鱼分区的状态与动作。 */
export interface SessionFishState {
  /** 当前草稿；`null` = 还没拿到（此时保存跳过这一块）。 */
  readonly draft: SessionFishSettings | null;
  /** 读取失败：界面就地提示，草稿仍按默认值可用。 */
  readonly loadFailed: boolean;
  /** 可选皮肤；`null` = 还没拉回来。 */
  readonly skins: readonly SessionFishSkinOption[] | null;
  /** 正在重新扫描皮肤目录。 */
  readonly skinBusy: boolean;
  /** 正在写盘。 */
  readonly busy: boolean;
  /** 改一个字段（草稿态，随「应用 / 确定」落盘）。 */
  update<K extends keyof SessionFishSettings>(key: K, value: SessionFishSettings[K]): void;
  /** 用服务端权威值覆盖草稿，并把它交给外壳推进基线（从备份恢复后走这条）。 */
  apply(settings: SessionFishSettings): void;
  /** 重新读一遍设置与皮肤清单（加载失败后的重试）。 */
  reload(): void;
  /** 重新扫描皮肤目录。 */
  rescan(): void;
  /** 清掉每条鱼记住的位置，让它们回到桌宠旁边（只动 localStorage）。 */
  resetPositions(): void;
  /** 提交草稿；成功返回 true（失败已就地报错）。 */
  save(): Promise<boolean>;
  /** 写默认值并回填草稿；成功返回 true。 */
  reset(): Promise<boolean>;
}

/** {@link useSessionFish} 的依赖。 */
export interface SessionFishDeps {
  /** 就地显示结果（成功由外壳说，失败由这里说）。 */
  readonly report: (feedback: Feedback) => void;
  /** 服务端权威值到达时回调：外壳用它推进基线，圆点才不会误报。 */
  readonly onAuthoritative?: (settings: SessionFishSettings) => void;
}

/**
 * 管理会话鱼设置的草稿。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @param deps - 反馈出口与权威值回调。
 * @returns 状态与动作；组件里无条件调用一次。
 */
export function useSessionFish(
  rt: Pick<SettingsRuntime, 'useState' | 'useEffect' | 'useCallback' | 't'>,
  deps: SessionFishDeps,
): SessionFishState {
  const { useState, useEffect, useCallback, t } = rt;
  const { report, onAuthoritative } = deps;
  const [draft, setDraft] = useState<SessionFishSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [skins, setSkins] = useState<SessionFishSkinOption[] | null>(null);
  const [skinBusy, setSkinBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  // 读盘轮次：重试时 +1，触发下面同一个 effect，不必再写一份加载逻辑。
  const [loadTick, setLoadTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoadFailed(false);
    void loadSessionFishSettings().then((settings) => {
      if (!alive) return;
      // 读不到时先给默认值让表单可用，同时如实报错（保存会覆盖文件）。
      const next = settings ?? DEFAULT_SESSION_FISH_SETTINGS;
      setDraft(next);
      setLoadFailed(settings === null);
      if (settings === null) report({ kind: 'err', text: t('fish.loadFailed') });
      else onAuthoritative?.(settings);
    });
    void loadSessionFishSkins().then((items) => {
      if (alive) setSkins(items);
    });
    return () => {
      alive = false;
    };
  }, [loadTick, onAuthoritative, report, t]);

  const update = useCallback(<K extends keyof SessionFishSettings>(key: K, value: SessionFishSettings[K]): void => {
    setDraft((current) => (current === null ? current : { ...current, [key]: value }));
  }, []);

  const apply = useCallback(
    (settings: SessionFishSettings): void => {
      setDraft(settings);
      onAuthoritative?.(settings);
    },
    [onAuthoritative],
  );

  const reload = useCallback((): void => {
    setLoadTick((tick) => tick + 1);
  }, []);

  const rescan = useCallback((): void => {
    setSkinBusy(true);
    void loadSessionFishSkins().then((items) => {
      setSkinBusy(false);
      setSkins(items);
      report(
        items === null
          ? { kind: 'err', text: t('fish.skinRescanFailed') }
          : { kind: 'ok', text: t('fish.skinRescanned') + '：' + String(items.length) },
      );
    });
  }, [report, t]);

  const resetPositions = useCallback((): void => {
    clearFishOffsets();
    report({ kind: 'ok', text: t('fish.positionsReset') });
  }, [report, t]);

  const save = useCallback(async (): Promise<boolean> => {
    if (draft === null) return false;
    setBusy(true);
    try {
      const result = await saveSessionFishSettings(draft);
      if (!result.ok) {
        report({ kind: 'err', text: t('fish.saveFailed') + '：' + result.message });
        return false;
      }
      setDraft(result.settings);
      onAuthoritative?.(result.settings);
      return true;
    } finally {
      setBusy(false);
    }
  }, [draft, onAuthoritative, report, t]);

  const reset = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    try {
      const result = await saveSessionFishSettings(DEFAULT_SESSION_FISH_SETTINGS);
      if (!result.ok) {
        report({ kind: 'err', text: t('fish.saveFailed') + '：' + result.message });
        return false;
      }
      setDraft(result.settings);
      onAuthoritative?.(result.settings);
      return true;
    } finally {
      setBusy(false);
    }
  }, [onAuthoritative, report, t]);

  return {
    draft,
    loadFailed,
    skins,
    skinBusy,
    busy,
    update,
    apply,
    reload,
    rescan,
    resetPositions,
    save,
    reset,
  };
}
