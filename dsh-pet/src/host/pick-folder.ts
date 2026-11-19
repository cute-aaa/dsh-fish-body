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
 * 只做四件事：把 stdout 切成 UTF-8、建对话框、把它顶到最前、把结果写出去（`cancelled` 表示取消）。
 *
 * - `-STA` 是因为 `FolderBrowserDialog` 是 COM 组件，MTA 线程上会直接抛。
 * - `[Console]::OutputEncoding` 必须显式设成 UTF-8：stdout 被 Node 重定向时它默认是控制台代码页（简中
 *   Windows 上是 GBK），而 Node 按 UTF-8 解码——路径里有中文就会变成乱码，宿主随即报「目录不存在」。
 * - 隐身 `TopMost` 宿主窗体：后台进程（宿主）弹的对话框默认可能开在浏览器窗口**后面**，用户看到的是
 *   「点了没反应」。给它一个总在最前的属主，框就一定冒到前台。
 * - 不设 `UseDescriptionForTitle`：这个属性只在较新的 .NET Framework 上存在，老机器上直接报
 *   「找不到该属性」并把错误写进 stderr。
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
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false;',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog;',
    `$d.Description = '${quotedTitle}';`,
    ...(initial === '' ? [] : [`$d.SelectedPath = '${initial}';`]),
    '$o = New-Object System.Windows.Forms.Form;',
    '$o.TopMost = $true;',
    '$o.ShowInTaskbar = $false;',
    '$o.Opacity = 0;',
    "$o.WindowState = 'Minimized';",
    '$o.Show();',
    '$o.Activate();',
    'try {',
    '  $r = $d.ShowDialog($o)',
    '} finally {',
    '  $o.Close()',
    '}',
    'if ($r -eq [System.Windows.Forms.DialogResult]::OK) {',
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
  return pickPath({ ...options, directory: true });
}

/** 文件选择框的选项：`extensions` 形如 `['.ckpt', '.pth']`，用来生成系统过滤项。 */
export interface PickFileOptions extends PickFolderOptions {
  /** 允许的扩展名（含点）；空 = 不过滤。 */
  readonly extensions?: readonly string[];
}

/**
 * 文件选择框的平台命令。
 *
 * @param options - 标题、初始目录、扩展名与平台。
 * @returns 命令描述；平台不支持时 `undefined`。
 */
export function pickFileCommandOf(options: PickFileOptions): PickCommand | undefined {
  const platform = options.platform ?? process.platform;
  const title = (options.title ?? '选择文件').replace(/'/g, "''");
  const extensions = (options.extensions ?? []).filter((ext) => /^\.[A-Za-z0-9]+$/.test(ext));
  const patterns = extensions.map((ext) => '*' + ext).join(';');
  if (platform === 'win32') {
    const initial = (options.start ?? '').replace(/'/g, "''");
    const filter = extensions.length > 0 ? `文件 (${patterns})|${patterns}|所有文件 (*.*)|*.*` : '所有文件 (*.*)|*.*';
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      // 与目录框同一套理由：stdout 被重定向时默认是控制台代码页，中文路径会变乱码。
      '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false;',
      '$d = New-Object System.Windows.Forms.OpenFileDialog;',
      `$d.Title = '${title}';`,
      `$d.Filter = '${filter.replace(/'/g, "''")}';`,
      ...(initial === '' ? [] : [`$d.InitialDirectory = '${initial}';`]),
      // 隐身 TopMost 宿主：后台进程弹的框默认可能开在浏览器后面（用户以为「点了没反应」）。
      '$o = New-Object System.Windows.Forms.Form;',
      '$o.TopMost = $true;',
      '$o.ShowInTaskbar = $false;',
      '$o.Opacity = 0;',
      "$o.WindowState = 'Minimized';",
      '$o.Show();',
      '$o.Activate();',
      'try {',
      '  $r = $d.ShowDialog($o)',
      '} finally {',
      '  $o.Close()',
      '}',
      'if ($r -eq [System.Windows.Forms.DialogResult]::OK) {',
      '  [Console]::Out.Write($d.FileName)',
      '} else {',
      "  [Console]::Out.Write('__CANCELLED__')",
      '}',
    ];
    return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', script.join(' ')] };
  }
  if (platform === 'darwin') {
    const safe = (options.title ?? '选择文件').replace(/"/g, '\\"');
    return { command: 'osascript', args: ['-e', `POSIX path of (choose file with prompt "${safe}")`] };
  }
  if (platform === 'linux') {
    return {
      command: 'zenity',
      args: [
        '--file-selection',
        '--title',
        options.title ?? '选择文件',
        ...(options.start === undefined ? [] : ['--filename', options.start + '/']),
        ...(extensions.length === 0 ? [] : ['--file-filter', extensions.map((ext) => '*' + ext).join(' ')]),
      ],
    };
  }
  return undefined;
}

/**
 * 弹一次文件选择框（与 {@link pickFolder} 同一套「取消 / 弹不出来」语义）。
 *
 * @param options - 标题、初始目录、允许的扩展名、平台与超时。
 * @returns 选择结果。
 */
export async function pickFile(options: PickFileOptions = {}): Promise<PickFolderResult> {
  return pickPath({ ...options, directory: false });
}

/** `pickPath` 的选项：在目录/文件两种对话框之间切换。 */
interface PickPathOptions extends PickFileOptions {
  readonly directory: boolean;
}

/**
 * 一次弹框要试哪些可执行文件。
 *
 * Windows 上先试 `powershell.exe`（Windows PowerShell 5.1，系统自带），再退到 PowerShell 7 的两种叫法：
 * 有的机器只有 pwsh（精简镜像 / 卸载了 5.1），也有的只认 `pwsh` 不认 `pwsh.exe`。
 * 其它平台只有一个命令，原样返回。
 *
 * @param spec - 平台命令描述。
 * @param platform - 当前平台（测试注入）。
 * @returns 按优先级排列的可执行文件名。
 */
function interpretersOf(spec: PickCommand, platform: NodeJS.Platform): readonly string[] {
  if (platform === 'win32' && spec.command === 'powershell.exe') return ['powershell.exe', 'pwsh.exe', 'pwsh'];
  return [spec.command];
}

/**
 * 目录/文件选择框的统一实现：只差一个平台命令。
 *
 * @param options - 标题、初始目录、扩展名、平台与超时。
 * @returns 选择结果。
 */
async function pickPath(options: PickPathOptions): Promise<PickFolderResult> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  // Linux 无显示环境时 zenity 会立刻失败并打印一堆 GTK 警告：直接判 unsupported，别让用户等超时。
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return { kind: 'unsupported', message: '当前没有图形显示环境，请直接填写路径' };
  }
  const spec = options.directory
    ? pickCommandOf({ ...options, platform })
    : pickFileCommandOf({ ...options, platform });
  if (spec === undefined) return { kind: 'unsupported', message: '当前平台不支持系统选择框，请直接填写路径' };

  const timeoutMs = options.timeoutMs ?? PICK_TIMEOUT_MS;
  const interpreters = interpretersOf(spec, platform);
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
    /** 起一个解释器；`ENOENT` / `EACCES` 时换下一个（机器上没有这解释器，不是用户的问题）。 */
    const attempt = (index: number): void => {
      const command = interpreters[index] ?? interpreters[0] ?? spec.command;
      stdout = '';
      const child = spawn(command, [...spec.args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      handles.child = child;
      handles.timer = setTimeout(
        () => finish({ kind: 'unsupported', message: '选择框超时，请直接填写路径' }),
        timeoutMs,
      );
      handles.timer.unref?.();
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.on('error', (error: NodeJS.ErrnoException) => {
        if ((error.code === 'ENOENT' || error.code === 'EACCES') && index + 1 < interpreters.length) {
          if (handles.timer !== undefined) clearTimeout(handles.timer);
          attempt(index + 1);
          return;
        }
        finish({ kind: 'unsupported', message: error.message });
      });
      child.on('close', () => {
        if (settled) return;
        const path = stdout.trim();
        if (path === '' || path === '__CANCELLED__') finish({ kind: 'cancelled' });
        else finish({ kind: 'picked', path });
      });
    };
    attempt(0);
  });
}
