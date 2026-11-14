/**
 * 文件夹备注：给插件建出来的每个目录写一句「这是干什么的、能不能删」。
 *
 * 为什么要写：目录名只能表达一半（`cache/voice` 说得清，`pets` 与 `assets` 的边界说不清）。
 * Windows 资源管理器的「备注」列读的是目录里 `desktop.ini` 的 `InfoTip`——写在这里，用户点开文件夹就看到了，
 * 不必回设置页对照。这条备注跟着目录走，所以用中文写死（界面语言切了它也不会跟着变，见 `LAYOUT_NOTES`）。
 *
 * 三条硬约束：
 * - **不碰别人的 desktop.ini**：文件存在但不含本插件的标记行 → 直接跳过，不覆盖；
 * - **内容没变就不写**：每次启动都重写会让 Explorer 的目录时间一直跳；
 * - **写不进去不算错**：只读盘、受控目录、非 Windows 都只跳过（备注是锦上添花，不该让启动失败）。
 * @module dsh-fish-body/src/host/folder-note
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** `desktop.ini` 里的归属标记行：没有它就不认这个文件是我们的。 */
export const NOTE_MARKER = '; dsh-fish-body folder note (managed; rewritten on start)';

/** 备注文件名（Windows 资源管理器的固定约定）。 */
export const INI_NAME = 'desktop.ini';

/**
 * 生成 `desktop.ini` 的内容。
 *
 * `InfoTip` 就是「备注」列；`ConfirmFileOp=0` 顺手去掉「确认删除」的多余提示。
 *
 * @param note - 一句话说明。
 * @returns 文件全文（CRLF：Windows 记事本与 Explorer 都按这个读）。
 */
export function desktopIniText(note: string): string {
  return [NOTE_MARKER, '[.ShellClassInfo]', 'InfoTip=' + note.replace(/[\r\n]+/g, ' '), 'ConfirmFileOp=0', ''].join(
    '\r\n',
  );
}

/** 备注写入用到的文件系统能力（测试注入替身）。 */
export interface NoteFs {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string, encoding: 'utf8'): void;
}

/** 生产实现。 */
const NODE_FS: NoteFs = {
  existsSync,
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  writeFileSync: (path, data, encoding) => writeFileSync(path, data, encoding),
};

/** 写备注的结果。 */
export type FolderNoteResult = 'written' | 'unchanged' | 'skipped' | 'failed';

/** 写备注的输入。 */
export interface FolderNoteInput {
  /** 目标目录（调用方保证已存在）。 */
  readonly dir: string;
  /** 一句话说明。 */
  readonly note: string;
  /** 平台，默认 `process.platform`（测试注入）。 */
  readonly platform?: NodeJS.Platform;
  /** 文件系统替身。 */
  readonly fs?: NoteFs;
  /** 打属性命令的执行器（测试注入，缺省 spawnSync `attrib`）。 */
  readonly runAttrib?: (args: readonly string[]) => void;
}

/**
 * 给目录写（或更新）备注。
 *
 * @param input - 目录、说明、平台与替身。
 * @returns `written` 写入 / `unchanged` 已是最新 / `skipped` 不该写 / `failed` 写失败。
 */
export function writeFolderNote(input: FolderNoteInput): FolderNoteResult {
  const platform = input.platform ?? process.platform;
  // 只有 Windows 的 Explorer 读 InfoTip；其它平台不制造无意义的隐藏文件。
  if (platform !== 'win32') return 'skipped';
  const fs = input.fs ?? NODE_FS;
  const file = join(input.dir, INI_NAME);
  const text = desktopIniText(input.note);
  try {
    if (fs.existsSync(file)) {
      const current = fs.readFileSync(file, 'utf8');
      if (current === text) return 'unchanged';
      // 别人的 desktop.ini：内容不是我们写的，就别覆盖（用户可能自己配了图标或注释）。
      if (!current.includes(NOTE_MARKER)) return 'skipped';
    }
    fs.writeFileSync(file, text, 'utf8');
    // 属性是 Windows 让 Explorer 认这个文件的必要动作：desktop.ini 要隐藏+系统，目录要带系统位。
    // 失败无所谓（有的盘不认属性），所以只做 best-effort。
    const run = input.runAttrib ?? runAttribSync;
    try {
      run(['+h', '+s', file]);
      run(['+s', input.dir]);
    } catch {
      /* 属性失败不影响文件存在 */
    }
    return 'written';
  } catch {
    return 'failed';
  }
}

/**
 * 用系统 `attrib` 打属性（GUI 子系统工具，不会闪控制台）。
 *
 * @param args - attrib 参数（不含可执行文件名）。
 */
function runAttribSync(args: readonly string[]): void {
  spawnSync('attrib', [...args], { windowsHide: true, stdio: 'ignore' });
}

/**
 * 批量写备注：目录 → 说明。
 *
 * 单条失败不打断其余条目（每个目录独立，备注之间没有依赖）。
 *
 * @param notes - `目录绝对路径 → 说明`。
 * @param options - 平台与替身。
 * @returns 按目录记结果。
 */
export function writeFolderNotes(
  notes: ReadonlyMap<string, string>,
  options: {
    readonly platform?: NodeJS.Platform;
    readonly fs?: NoteFs;
    readonly runAttrib?: (a: readonly string[]) => void;
  } = {},
): Record<string, FolderNoteResult> {
  const out: Record<string, FolderNoteResult> = {};
  for (const [dir, note] of notes) {
    out[dir] = writeFolderNote({
      dir,
      note,
      ...(options.platform === undefined ? {} : { platform: options.platform }),
      ...(options.fs === undefined ? {} : { fs: options.fs }),
      ...(options.runAttrib === undefined ? {} : { runAttrib: options.runAttrib }),
    });
  }
  return out;
}
