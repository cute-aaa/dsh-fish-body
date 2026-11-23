/**
 * 设置备份的状态与动作：导出、选文件（预检 + 弹确认）、确认后提交恢复。
 *
 * 三件事都只有一个失败模式——宿主不回话或备份不可用——所以状态只有 `busy` 与一条反馈，
 * 结果文案由调用方（外壳）统一显示。选中的备份先存在这里，等用户在外壳的确认弹窗里点「恢复」
 * 才真正写盘：上传这个动作永远发生在明确的确认之后。
 * owns only 备份的读/写编排与等待态，never 表单回填（那由外壳在 `onRestored` 里做）。
 * @module dsh-fish-body/src/client/settings/use-settings-backup
 */
import type { SessionFishSettings } from '../../shared/session-fish.ts';
import type { SettingsBackup } from '../../shared/settings-backup.ts';
import { backupFileName, fetchBackupText, readBackupJson, restoreBackup, saveTextFile } from './backup-api.ts';
import type { MergedConfig } from './config/index.ts';
import type { DialogState } from './dialog.ts';
import type { Feedback } from './feedback.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 设置备份的状态与动作。 */
export interface SettingsBackupState {
  /** 正在导出或恢复。 */
  readonly busy: boolean;
  /** 打开文件框选了文件之后的预检与确认弹窗；不合法的文件就地报错、不弹窗。 */
  pick(file: File): void;
  /** 确认弹窗里点了「恢复」：提交给宿主。 */
  confirm(): void;
  /** 导出并下载一份快照。 */
  exportNow(): void;
}

/** {@link useSettingsBackup} 的依赖。 */
export interface SettingsBackupDeps {
  /** 就地显示结论。 */
  readonly report: (feedback: Feedback) => void;
  /** 打开 / 关闭确认弹窗（恢复要覆盖文件，必须先问）。 */
  readonly setDialog: (dialog: DialogState) => void;
  /** 宿主写盘成功：外壳拿成品与会话鱼设置回填表单、推进基线。 */
  readonly onRestored: (merged: MergedConfig, settings: SessionFishSettings) => void;
}

/**
 * 管理设置备份。
 *
 * @param rt - 只用到 `useState` 与 `useCallback`。
 * @param deps - 反馈、弹窗与回填回调。
 * @returns 等待态与三个动作。
 */
export function useSettingsBackup(
  rt: Pick<SettingsRuntime, 'useState' | 'useCallback' | 't'>,
  deps: SettingsBackupDeps,
): SettingsBackupState {
  const { useState, useCallback, t } = rt;
  const { report, setDialog, onRestored } = deps;
  const [busy, setBusy] = useState(false);
  // 选好但还没确认的备份；确认弹窗关掉后保留也没关系，下一次 pick 会覆盖它。
  const [pending, setPending] = useState<SettingsBackup | null>(null);

  const pick = useCallback(
    (file: File): void => {
      void file.text().then((text) => {
        const parsed = readBackupJson(text);
        if (!parsed.ok) {
          const failure = parsed.failure;
          const key =
            failure.reason === 'unsupported-version'
              ? 'backupUnsupported'
              : failure.reason === 'too-large'
                ? 'backupTooLarge'
                : 'backupReadFailed';
          report({ kind: 'err', text: t(key) });
          return;
        }
        setPending(parsed.backup);
        setDialog({ kind: 'restore', name: file.name });
      });
    },
    [report, setDialog, t],
  );

  const confirm = useCallback((): void => {
    if (pending === null || busy) return;
    setBusy(true);
    void restoreBackup(pending).then((result) => {
      setBusy(false);
      if (!result.ok) {
        report({ kind: 'err', text: t('restoreFailed').replace('{message}', result.message) });
        return;
      }
      // 回填失败（宿主回了半份成品）不该变成未捕获的 promise 异常：就地报错，页面继续可用。
      try {
        onRestored(result.merged, result.settings);
        report({ kind: 'ok', text: t('restoreDone') });
      } catch (error) {
        report({
          kind: 'err',
          text: t('restoreFailed').replace('{message}', error instanceof Error ? error.message : String(error)),
        });
      }
    });
  }, [pending, busy, onRestored, report, t]);

  const exportNow = useCallback((): void => {
    if (busy) return;
    setBusy(true);
    void fetchBackupText().then((text) => {
      setBusy(false);
      if (text === null || !saveTextFile(backupFileName(new Date()), text)) {
        report({ kind: 'err', text: t('backupExportFailed') });
        return;
      }
      report({ kind: 'ok', text: t('backupDone') });
    });
  }, [busy, report, t]);

  return { busy, pick, confirm, exportNow };
}
