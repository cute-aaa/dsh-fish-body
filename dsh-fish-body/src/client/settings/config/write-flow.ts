/**
 * 设置页的写路径编排：保存（主配置 + 会话鱼）、重置、从备份恢复与确认弹窗的派发。
 *
 * 两条写路径都要先过一遍表单校验（同一套规则），再把结果翻译成红字或弹窗——调用方只接状态。
 * 「保存」只写主配置与种类层，「saveAll」再多写一次会话鱼；两者都返回是否成功，
 * 「确定」据此决定关不关设置页，「重启」据此决定要不要真的重启。
 * 传进来的是回调而不是值：`save` 每次渲染重建，直接捕获状态会拿旧值存盘。
 * @module dsh-fish-body/src/client/settings/config/write-flow
 */
import type { SaveFields } from './http.ts';
import type { MergedConfig } from './read.ts';
import type { DialogState } from '../dialog.ts';
import { NO_FEEDBACK, type Feedback } from '../feedback.ts';
import { restoreDefaults, persistSettings } from './persist.ts';
import type { PackWrite } from './pack-writes.ts';
import { validateForm } from './validate-form.ts';

/** 一次保存覆盖的范围：主配置 / 主配置 + 会话鱼。基线按这个范围推进。 */
export type SavedScope = 'main' | 'all';

/** {@link createWriteFlow} 的依赖。 */
export interface WriteFlowDeps {
  /** 现取要提交的全部字段。 */
  fields: () => SaveFields;
  /** 现算有改动的种类层（与加载快照比较，main 不在其中）。 */
  packWrites: () => readonly PackWrite[];
  /** 当前是否正在保存（重入保护）。 */
  busy: () => boolean;
  /** 置保存中标志；写盘期间表单整体禁用。 */
  setBusy: (busy: boolean) => void;
  /** 就地显示保存 / 重置反馈。 */
  setMsg: (feedback: Feedback) => void;
  /** 打开或关闭弹窗。 */
  setDialog: (dialog: DialogState) => void;
  /** 读当前弹窗，确认时才知道该派发哪个动作。 */
  dialog: () => DialogState;
  /** 重置成功后刷新表单。 */
  applyConfig: (merged: MergedConfig) => void;
  /** 宿主没回真实写入路径时的兜底（meta 里的用户配置路径）。 */
  userFile: () => string;
  /** 文案翻译。 */
  t: (key: string) => string;
  /** 真的删掉选中的宠物（校验与确认都过了才会调）。 */
  onRemove: () => void;
  /** 写会话鱼设置；草稿未就绪时由调用方直接回 `true`（这一块跳过）。 */
  saveFish: () => Promise<boolean>;
  /** 把会话鱼设置写回默认值。 */
  resetFish: () => Promise<boolean>;
  /** 保存成功后推进「未保存改动」的基线。 */
  onSaved: (scope: SavedScope) => void;
  /** 确认「从备份恢复」：真正的上传与回填在备份模块里，这里只负责派发。 */
  onRestore: () => void;
}

/** 写路径暴露的入口。 */
export interface WriteFlow {
  /** 保存主配置与种类层；`force` 严格为 `true` 才允许重建损坏文件。 */
  save: (force?: boolean) => Promise<boolean>;
  /** 保存主配置后再写会话鱼（应用 / 确定 / 重启都走这条）。 */
  saveAll: () => Promise<boolean>;
  /** 请求重置：先弹确认（会覆盖用户配置，不能点一下就干）。 */
  requestReset: () => void;
  /** 弹窗确认后的派发。 */
  confirmDialog: () => void;
}

/**
 * 造写路径。
 *
 * @param deps - 状态读取与写入回调。
 * @returns 保存 / 保存全部 / 请求重置 / 确认派发。
 */
export function createWriteFlow(deps: WriteFlowDeps): WriteFlow {
  const { setBusy, setMsg, setDialog, t } = deps;

  const save = async (force = false): Promise<boolean> => {
    if (deps.busy()) return false;
    const fields = deps.fields();
    const invalid = validateForm({
      pets: fields.pets,
      physics: fields.physics,
      whisperModel: fields.whisperModel,
      chatModel: fields.chatModel,
      chatMemory: fields.chatMemoryRounds,
      chatImageLimit: fields.chatImageLimit,
      font: fields.font,
    });
    if (invalid !== null) {
      setMsg({ kind: 'err', text: t(invalid) });
      return false;
    }
    setBusy(true);
    setMsg(NO_FEEDBACK);
    try {
      const result = await persistSettings(fields, deps.packWrites(), force, deps.userFile());
      if (result.kind === 'ok') {
        setMsg({ kind: 'ok', text: t('saved') });
        deps.onSaved('main');
        return true;
      }
      if (result.kind === 'corrupt') {
        setDialog({ kind: 'corrupt', path: result.path });
        return false;
      }
      // main 已落盘、部分种类没写成功：必须如实说，否则用户会以为整包都没保存。
      if (result.kind === 'partial') {
        setMsg({ kind: 'err', text: t('savePartial').replace('{names}', result.failed.join('、')) });
        return false;
      }
      setMsg({ kind: 'err', text: t(result.kind === 'invalid' ? 'saveInvalid' : 'saveError') });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveAll = async (): Promise<boolean> => {
    if (!(await save())) return false;
    // 会话鱼读失败时草稿仍是默认值：那一块照旧会写（与旧分区的语义一致，失败提示已说明）。
    if (!(await deps.saveFish())) return false;
    deps.onSaved('all');
    // 两段都落盘才算「已保存」：主配置那一步只写了半截，别让用户以为会话鱼也进去了。
    setMsg({ kind: 'ok', text: t('saved') });
    return true;
  };

  const doReset = async (): Promise<void> => {
    setBusy(true);
    setMsg(NO_FEEDBACK);
    try {
      // 内置默认整份覆盖用户配置：这条请求不经过表单，也不认「有没有改动」。
      const merged = await restoreDefaults();
      if (merged === null) {
        setMsg({ kind: 'err', text: t('resetError') });
        return;
      }
      // 同一份成品既刷新表单也推进基线；会话鱼那半截由它自己的 resetFish 回填与推进。
      deps.applyConfig(merged);
      const fishOk = await deps.resetFish();
      setMsg(fishOk ? { kind: 'ok', text: t('resetDone') } : { kind: 'err', text: t('resetPartial') });
    } finally {
      setBusy(false);
    }
  };

  return {
    save,
    saveAll,
    requestReset: () => setDialog({ kind: 'reset' }),
    confirmDialog: () => {
      const pending = deps.dialog();
      if (pending === null) return;
      setDialog(null);
      if (pending.kind === 'remove') deps.onRemove();
      else if (pending.kind === 'corrupt') void save(true);
      else if (pending.kind === 'reset') void doReset();
      else if (pending.kind === 'restore') deps.onRestore();
    },
  };
}
