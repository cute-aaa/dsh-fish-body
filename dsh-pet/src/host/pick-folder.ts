/**
 * 原生「选一个目录」对话框：设置页要改数据根 / 皮肤目录 / 运行时目录时用它拿到绝对路径。
 *
 * 为什么必须在宿主侧弹：浏览器端 `<input type="file" webkitdirectory>` 拿不到绝对路径（只给相对路径与
 * File 句柄），而这三处改的都是磁盘上的真实位置。宿主所在的机器就是用户操作的机器，弹在那台机器上。
 *
 * 每个平台用系统自带的那个对话框，不额外装 GUI 依赖：
 * - Windows：PowerShell + `System.Windows.Forms.FolderBrowserDialog`（`-STA` 是 WinForms 的硬要求）；
 * - macOS：`osascript -e 'POSIX path of (choose folder …)'`；
 * - Linux：`zenity` 或 `kdialog`，都没有就报 `unsupported`。
 *
 * 没有图形环境（服务器 / 容器）时同样是 `unsupported`——此时界面回落到手输路径，功能不丢。
 * @module dsh-fish-body/src/host/pick-folder
 */
import { spawn } from 'node:child_process';

/** 选择结果：选到了 / 用户取消 / 这台机器弹不出来。 */
export type PickFolderResult =
  | { readonly kind: 'picked'; readonly path: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unsupported'; readonly message: string };

/** 一次对话框调用的选项。 */
export interface PickFolderOptions {
  /** 对话框标题（默认「选择目录」）。 */
  readonly title?: string;
  /** 初始目录（浏览器不认时就忽略）。 */
  readonly start?: string;
  /** 平台与超时（测试注入）。 */
  readonly platform?: NodeJS.Platform;
  /** 用户思考时间也算在超时里：默认 3 分钟。 */
  readonly timeoutMs?: number;
  /** 环境变量（测试注入；Linux 上用来判有没有 DISPLAY）。 */
  readonly env?: NodeJS.ProcessEnv;
}

/** 默认超时：够用户慢慢找目录，又不至于把请求永远挂着。 */
export const PICK_TIMEOUT_MS = 3 * 60 * 1000;

/** 一次「弹对话框」的命令描述（把平台差异收敛成可断言的值，测试不必真的弹窗口）。 */
export interface PickCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * Windows 上的 PowerShell 脚本。
 *
 * 只做三件事：建对话框、显示、把结果按 UTF-8 写到 stdout（`cancelled` 表示用户点了取消）。
 * 用 `-STA` 是因为 `FolderBrowserDialog` 是 COM 组件，MTA 线程上会直接抛。
 *
 * @param title - 对话框描述文字。
 * @param start - 初始目录。
 * @returns 可直接交给 `powershell -NoProfile -STA -Command` 的脚本。
 */
function windowsScript(title: string, start: string | undefined): string {
  const quotedTitle = title.replace(/'/g, "''");
  const initial = (start ?? '').replace(/'/g, "''");
  const lines = [
    'Add-Type -AssemblyName System.Windows.Forms;',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog;',
    `$d.Description = '${quotedTitle}';`,
    '$d.UseDescriptionForTitle = $true;',
    ...(initial === '' ? [] : [`$d.SelectedPath = '${initial}';`]),
    'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  [Console]::Out.Write($d.SelectedPath)',
    '} else {',
    "  [Console]::Out.Write('__CANCELLED__')",
    '}',
  ];
  return lines.join(' ');
}

/**
 * 平台 → 对话框命令。
 *
 * @param options - 标题、初始目录与平台。
 * @returns 命令描述；平台不支持时 `undefined`。
 */
export function pickCommandOf(options: PickFolderOptions): PickCommand | undefined {
  const platform = options.platform ?? process.platform;
  const title = options.title ?? '选择目录';
  if (platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', windowsScript(title, options.start)],
    };
  }
  if (platform === 'darwin') {
    const safe = title.replace(/"/g, '\\"');
    return { command: 'osascript', args: ['-e', `POSIX path of (choose folder with prompt "${safe}")`] };
  }
  if (platform === 'linux') {
    return {
      command: 'zenity',
      args: [
        '--file-selection',
        '--directory',
        '--title',
        title,
        ...(options.start === undefined ? [] : ['--filename', options.start + '/']),
      ],
    };
  }
  return undefined;
}

/**
 * 弹一次目录选择框。
 *
 * @param options - 标题、初始目录、平台与超时。
 * @returns 选择结果；取消与「弹不出来」分开，界面据此决定要不要展开手输框。
 */
export async function pickFolder(options: PickFolderOptions = {}): Promise<PickFolderResult> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  // Linux 无显示环境时 zenity 会立刻失败并打印一堆 GTK 警告：直接判 unsupported，别让用户等超时。
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return { kind: 'unsupported', message: '当前没有图形显示环境，请直接填写路径' };
  }
  const spec = pickCommandOf({ ...options, platform });
  if (spec === undefined) return { kind: 'unsupported', message: '当前平台不支持系统目录选择框，请直接填写路径' };

  const timeoutMs = options.timeoutMs ?? PICK_TIMEOUT_MS;
  return await new Promise<PickFolderResult>((resolvePromise) => {
    let stdout = '';
    let settled = false;
    // 两个句柄都只在 finish 里用，而 finish 要在它们赋值之前定义（spawn 的 error 事件可能同步到不了，
    // 但 close 一定在赋值之后），所以放进一个可变容器而不是两个 `let`。
    const handles: { timer?: ReturnType<typeof setTimeout>; child?: ReturnType<typeof spawn> } = {};
    const finish = (result: PickFolderResult): void => {
      if (settled) return;
      settled = true;
      if (handles.timer !== undefined) clearTimeout(handles.timer);
      handles.child?.kill();
      resolvePromise(result);
    };
    const child = spawn(spec.command, [...spec.args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    handles.child = child;
    handles.timer = setTimeout(() => finish({ kind: 'unsupported', message: '选择框超时，请直接填写路径' }), timeoutMs);
    handles.timer.unref?.();
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.on('error', (error: Error) => finish({ kind: 'unsupported', message: error.message }));
    child.on('close', () => {
      const path = stdout.trim();
      if (path === '' || path === '__CANCELLED__') finish({ kind: 'cancelled' });
      else finish({ kind: 'picked', path });
    });
  });
}
