/**
 * 原生「选一个目录 / 选一个文件」对话框：设置页要改数据根 / 皮肤目录 / 运行时目录，
 * 语音导入要选权重目录与参考音频时用它拿到绝对路径。
 *
 * 为什么必须在宿主侧弹：浏览器端 `<input type="file" webkitdirectory>` 拿不到绝对路径（只给相对路径与
 * File 句柄），而这三处改的都是磁盘上的真实位置。宿主所在的机器就是用户操作的机器，弹在那台机器上。
 *
 * 每个平台用系统自带的那个对话框，不额外装 GUI 依赖：
 * - Windows：PowerShell（目录框走内联 C# 的 `IFileOpenDialog`，文件框走 `OpenFileDialog`；`-STA` 是硬要求）；
 * - macOS：`osascript -e 'POSIX path of (choose folder …)'`；
 * - Linux：`zenity` 或 `kdialog`，都没有就报 `unsupported`。
 *
 * 没有图形环境（服务器 / 容器）时同样是 `unsupported`——此时界面回落到手输路径，功能不丢。
 *
 * **不设任何超时**：用户在框里待多久都不算失败。结局只有四个，且都由「确定的事实」触发：
 * 选中（子进程 `close` + stdout 是路径）/ 取消（`__CANCELLED__` 或空）/ 弹不出来（`error` / 平台不支持）/
 * 调用方断开（`options.signal` abort → `kill()` 子进程 → `aborted`）。
 * `PICK_WAIT_HEARTBEAT_MS` 那个定时器**只写日志**，绝不参与结局（见 `attempt`）。
 * @module dsh-fish-body/src/host/pick-folder
 */
import { spawn } from 'node:child_process';
import type { NativePicker, NativePickerOutcome } from './helper/dialog.ts';

/**
 * 选择结果：选到了 / 用户取消 / 这台机器弹不出来 / 调用方中途走了。
 *
 * `via` 只用于日志排障（「这个结论是 helper 的系统框给的，还是 PowerShell 兜底给的」），
 * 不参与任何应答构造：路由只读 `kind` / `path` / `message`，对外 JSON 与改造前逐字一致。
 * `aborted` 是「调用方已经走了」——路由对它回 `{kind:'none'}`（不写响应），与 `/playback`、`/state`
 * 的取消先例一致；它不是失败，也没有文案。
 */
export type PickFolderResult =
  | { readonly kind: 'picked'; readonly path: string; readonly via?: 'native' | 'shell' }
  | { readonly kind: 'cancelled'; readonly via?: 'native' | 'shell' }
  | { readonly kind: 'unsupported'; readonly message: string; readonly via?: 'native' | 'shell' }
  | { readonly kind: 'aborted'; readonly via?: 'native' | 'shell' };

/** 一次对话框调用的选项。 */
export interface PickFolderOptions {
  /** 对话框标题（默认「选择目录」）。 */
  readonly title?: string;
  /** 初始目录（浏览器不认时就忽略）。 */
  readonly start?: string;
  /** 平台（测试注入）。 */
  readonly platform?: NodeJS.Platform;
  /**
   * 调用方断开信号（`RouteInput.signal`，由 `res.on('close')` 触发）。
   *
   * abort 时：A 通道把 signal 挂到那次 `node:http` 请求上（helper 侧连接断掉），B 通道 `kill()` 子进程
   * （框随进程消失）→ 回 `aborted`。**这是 B 路径唯一的提前退出机制**——没有计时器。
   */
  readonly signal?: AbortSignal;
  /** 等待心跳的落点（默认不注入 = 不打日志；路由把 `deps.log` 传进来）。 */
  readonly log?: { readonly warn: (message: string) => void };
  /** 环境变量（测试注入；Linux 上用来判有没有 DISPLAY）。 */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * 优先尝试的系统选择框（helper 的 `dialog.showOpenDialog`）。
   *
   * 不注入 = 直接走 PowerShell / osascript / zenity 兜底（与改造前完全一致）。
   * 只有它回 `unavailable` 才回落 B——`unsupported`（忙 / 通道中断 / 明确弹不出来）**不回落**，
   * 否则会同时弹出两个框；`aborted` 也不回落（调用方已经走了）。
   */
  readonly native?: NativePicker;
  /** spawn 的替身（测试用）：不注入就是真的 `node:child_process.spawn`。 */
  readonly spawnImpl?: typeof spawn;
}

/**
 * 等待心跳的间隔：10 分钟打一行「仍在等待用户选择」，只为排障。
 *
 * 它**不是**超时：`unref()` 过，不结束 Promise、不释放互斥、不改变任何结论。
 * 设计里刻意没有把它做成可配的「逃生阀」——那会重新引入「按时间判失败」。
 */
export const PICK_WAIT_HEARTBEAT_MS = 10 * 60 * 1000;

/** 心跳文案。写明「不是失败」，免得排障的人把它当成超时日志。 */
export const PICK_WAIT_HEARTBEAT_MESSAGE = '仍在等待用户选择（不是失败，无超时）';

/** 一次「弹对话框」的命令描述（把平台差异收敛成可断言的值，测试不必真的弹窗口）。 */
export interface PickCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * 用 `IFileOpenDialog` 选目录的内联 C#（Vista+ 的现代资源管理器风格对话框）。
 *
 * 为什么必须内联：`FolderBrowserDialog` 是 2001 年的老树控件（不能粘贴路径、不能拖放、不能看缩略图），
 * 而选目录的现代形态在 Win32 API 里就是 `IFileOpenDialog` + `FOS_PICKFOLDERS`——.NET Framework 的
 * `System.Windows.Forms` 没有托管包装，只能自己声明 COM 接口。
 *
 * 接口声明顺序是**硬约束**：COM 走 vtable，声明顺序必须与 `shobjidl_core.h` 一致（多一个少一个都会
 * 调到错误的方法）。这里只声明到 `SetFilter` 为止，与 SDK 的 IFileDialog 完全对齐；
 * `PreserveSig` 只加在 `Show` 上（我们需要拿到它的 HRESULT 判断「用户取消」）。
 *
 * 字符串用数组 + `[char]10` 拼：整段脚本是单行（`-Command` 只能给一段），而 C# 需要换行；
 * 同时刻意**不含单引号**，这样在 PowerShell 单引号串里不用转义。
 */
const FOLDER_PICKER_CSHARP: readonly string[] = [
  'using System;',
  'using System.Runtime.InteropServices;',
  'public static class DshPickFolder {',
  '  private const uint FOS_PICKFOLDERS = 0x00000020;',
  '  private const uint FOS_FORCEFILESYSTEM = 0x00000040;',
  '  private const uint FOS_PATHMUSTEXIST = 0x00000008;',
  '  private const uint SIGDN_FILESYSPATH = 0x80058000;',
  '  private static readonly Guid IShellItemGuid = new Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe");',
  '  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  '  private interface IFileOpenDialog {',
  '    [PreserveSig] int Show(IntPtr parent);',
  '    void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);',
  '    void SetFileTypeIndex(uint iFileType);',
  '    void GetFileTypeIndex(out uint piFileType);',
  '    void Advise(IntPtr pfde, out uint pdwCookie);',
  '    void Unadvise(uint dwCookie);',
  '    void SetOptions(uint fos);',
  '    void GetOptions(out uint pfos);',
  '    void SetDefaultFolder(IntPtr psi);',
  '    void SetFolder(IShellItem psi);',
  '    void GetFolder(out IntPtr ppsi);',
  '    void GetCurrentSelection(out IntPtr ppsi);',
  '    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);',
  '    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);',
  '    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);',
  '    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);',
  '    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);',
  '    void GetResult(out IShellItem ppsi);',
  '    void AddPlace(IntPtr psi, int fdap);',
  '    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);',
  '    void Close(int hr);',
  '    void SetClientGuid(ref Guid guid);',
  '    void ClearClientData();',
  '    void SetFilter(IntPtr pFilter);',
  // IFileOpenDialog 在 IFileDialog 之后追加的两个方法：这里不用，但声明必须补齐以保持接口完整。
  '    void GetResults(out IntPtr ppenum);',
  '    void GetSelectedItems(out IntPtr ppsai);',
  '  }',
  '  [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  '  private interface IShellItem {',
  '    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);',
  '    void GetParent(out IShellItem ppsi);',
  '    void GetDisplayName(uint sigdnName, out IntPtr ppszName);',
  '    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);',
  '    void Compare(IShellItem psi, uint hint, out int piOrder);',
  '  }',
  '  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]',
  '  private class FileOpenDialog { }',
  '  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]',
  '  private static extern IShellItem SHCreateItemFromParsingName(string pszPath, IntPtr pbc, ref Guid riid);',
  '  [DllImport("ole32.dll")]',
  '  private static extern void CoTaskMemFree(IntPtr pv);',
  '  public static string Show(string title, string start, IntPtr owner) {',
  '    IFileOpenDialog dialog = (IFileOpenDialog)(new FileOpenDialog());',
  '    try {',
  '      uint options;',
  '      dialog.GetOptions(out options);',
  '      dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);',
  '      if (!string.IsNullOrEmpty(title)) { dialog.SetTitle(title); }',
  '      if (!string.IsNullOrEmpty(start)) {',
  '        try {',
  '          Guid iid = IShellItemGuid;',
  '          dialog.SetFolder(SHCreateItemFromParsingName(start, IntPtr.Zero, ref iid));',
  '        } catch { }',
  '      }',
  '      if (dialog.Show(owner) != 0) { return string.Empty; }',
  '      IShellItem item;',
  '      dialog.GetResult(out item);',
  '      try {',
  '        IntPtr namePtr;',
  '        item.GetDisplayName(SIGDN_FILESYSPATH, out namePtr);',
  '        try { return Marshal.PtrToStringUni(namePtr); } finally { CoTaskMemFree(namePtr); }',
  '      } finally { Marshal.ReleaseComObject(item); }',
  '    } finally { Marshal.ReleaseComObject(dialog); }',
  '  }',
  '}',
];

/**
 * Windows 上的 PowerShell 脚本（选目录）。
 *
 * 只做五件事：把 stdout 切成 UTF-8、建隐身属主、弹 Vista+ 目录框、弹不出来时回落老框、把结果写出去
 * （`__CANCELLED__` 表示取消）。
 *
 * - `-STA` 是因为这两个对话框都是 COM 组件，MTA 线程上会直接抛。
 * - `[Console]::OutputEncoding` 必须显式设成 UTF-8：stdout 被 Node 重定向时它默认是控制台代码页（简中
 *   Windows 上是 GBK），而 Node 按 UTF-8 解码——路径里有中文就会变成乱码，宿主随即报「目录不存在」。
 * - 隐身 `TopMost` 宿主窗体：后台进程（宿主）弹的对话框默认可能开在浏览器窗口**后面**，用户看到的是
 *   「点了没反应」。给它一个总在最前的属主，框就一定冒到前台；`IFileOpenDialog.Show($o.Handle)`
 *   与回落分支的 `$d.ShowDialog($o)` 都用它。
 * - **回落不是可选优化**：`Add-Type -TypeDefinition` 要有编译器，且受限语言模式（ConstrainedLanguage）
 *   下直接不可用。那种机器上必须还能弹老框，否则「选目录」这个功能整块消失。
 * - 不设 `UseDescriptionForTitle`：这个属性只在较新的 .NET Framework 上存在，老机器上直接报
 *   「找不到该属性」并把错误写进 stderr。
 *
 * @param title - 对话框描述文字（COM 用 `SetTitle`，回落分支用 `Description`）。
 * @param start - 初始目录。
 * @returns 可直接交给 `powershell -NoProfile -STA -Command` 的脚本。
 */
function windowsScript(title: string, start: string | undefined): string {
  const quotedTitle = title.replace(/'/g, "''");
  const initial = (start ?? '').replace(/'/g, "''");
  const lines = [
    'Add-Type -AssemblyName System.Windows.Forms;',
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false;',
    '$o = New-Object System.Windows.Forms.Form;',
    '$o.TopMost = $true;',
    '$o.ShowInTaskbar = $false;',
    '$o.Opacity = 0;',
    "$o.WindowState = 'Minimized';",
    '$o.Show();',
    '$o.Activate();',
    '$picked = $null;',
    'try {',
    // 优先现代目录框：一次性编译内联 C#（同一进程里只编一次）。
    '  $src = @(' + FOLDER_PICKER_CSHARP.map((line) => `'${line}'`).join(',') + ') -join [char]10;',
    "  if (-not ('DshPickFolder' -as [type])) { Add-Type -TypeDefinition $src };",
    `  $picked = [DshPickFolder]::Show('${quotedTitle}', '${initial}', $o.Handle);`,
    '} catch {',
    // 回落：老式 FolderBrowserDialog（没有 csc / 受限语言模式 / COM 注册缺失都会走到这里）。
    '  $d = New-Object System.Windows.Forms.FolderBrowserDialog;',
    `  $d.Description = '${quotedTitle}';`,
    ...(initial === '' ? [] : [`  $d.SelectedPath = '${initial}';`]),
    '  if ($d.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK) { $picked = $d.SelectedPath }',
    '} finally {',
    '  $o.Close()',
    '}',
    "if ([string]::IsNullOrEmpty($picked)) { [Console]::Out.Write('__CANCELLED__') } else { [Console]::Out.Write($picked) }",
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
 * @param options - 标题、初始目录、平台与调用方断开信号。
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
      // .NET Framework 上 `AutoUpgradeEnabled` 默认就是 true（等于 Vista+ 的 IFileOpenDialog），
      // 这里把它**写成契约**：某天有人为了「修」老框问题把它设成 false，这一行会立刻被 diff 看见。
      '$d.AutoUpgradeEnabled = $true;',
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

/** 兜底通道（B）的结论：不含 `via`，由 `finish` 统一打上 `'shell'`。 */
type ShellResult =
  | { readonly kind: 'picked'; readonly path: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unsupported'; readonly message: string }
  | { readonly kind: 'aborted' };

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
 * 进程级「已经有一个选择框开着」标记。
 *
 * 为什么在 `pickPath` 入口而不是包住 `spawn`：A（helper）与 B（PowerShell）两条路都会弹框，
 * 连点两次「选择…」的第二个请求必须**在两条路的入口**就被挡住——只包 spawn 的话，
 * A 通道会同时弹两个系统框，用户点到那个已经没有返回值的框就会以为「选了没用」。
 *
 * 语义与 helper 的 `busy` 一致（界面已有 `unsupported` 的提示分发），响应仍然走业务失败 200。
 *
 * **生命周期 = 一次请求**，刻意与 helper 的 `inFlight`（= 一个真实存在的原生对话框）**不等**：
 * 页面关掉时宿主这边的请求已经结束（本标记释放），而 helper 那边的框可能还开着、继续回 `busy`。
 * 二者不相等正是两层保险的来源，不要「顺手」把它们同步成一个。
 */
let pickInFlight = false;

/**
 * 并发时的结论：与 helper 的 `busy` 同语义、同文案，界面不需要为它多写一条分支。
 *
 * 文案可操作：告诉用户下一步（关掉已打开的那个框），否则「忙」只会让人反复点。
 */
const PICK_BUSY_MESSAGE = '另一个选择框还开着，请先关掉已打开的选择框再点';

/**
 * 目录/文件选择框的统一实现：只差一个平台命令。
 *
 * 顺序是硬约定：**先试 A（helper 的系统框），只有 `unavailable` 才走 B（PowerShell 等）**。
 * `unsupported` 不回落——helper 已经明确说过「忙 / 通道中断 / 弹不出来」，再弹一个 PowerShell 框
 * 就是两个框竞态，用户会点错那个已经没有返回值的。`aborted` 也不回落（调用方已经走了）。
 *
 * 入口处还有一道进程级互斥：已有调用在飞时立刻回 `busy`，不再弹第二个框。
 *
 * @param options - 标题、初始目录、扩展名、平台、调用方断开信号与可选的 A 通道。
 * @returns 选择结果。
 */
async function pickPath(options: PickPathOptions): Promise<PickFolderResult> {
  if (pickInFlight) return { kind: 'unsupported', message: PICK_BUSY_MESSAGE };
  pickInFlight = true;
  try {
    return await pickPathOnce(options);
  } finally {
    // 必须无条件释放：正常选中 / 取消 / 抛错 / 调用方断开都不能把守卫留在「占用」状态，
    // 否则一次异常之后再也弹不出框。**这里没有、也不许有**任何计时器。
    pickInFlight = false;
  }
}

/**
 * 单个选择框的实际流程（A 优先、B 兜底）。只由 {@link pickPath} 调用，互斥交给它。
 *
 * @param options - 同 {@link pickPath}。
 * @returns 选择结果。
 */
async function pickPathOnce(options: PickPathOptions): Promise<PickFolderResult> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const defaultTitle = options.directory ? '选择目录' : '选择文件';
  // A：helper 的系统对话框（Electron `dialog.showOpenDialog`）。放在 Linux 无显示环境短路之前：
  // 能连上 helper 就说明那台机器有图形会话，不该因为宿主自己的 DISPLAY 变量缺失而放弃。
  if (options.native !== undefined) {
    let native: NativePickerOutcome;
    try {
      native = await options.native({
        kind: options.directory ? 'folder' : 'file',
        title: options.title ?? defaultTitle,
        ...(options.start === undefined ? {} : { start: options.start }),
        ...(options.directory ? {} : { extensions: options.extensions ?? [] }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch {
      // NativePicker 按契约不抛错；真抛了（自定义实现）按「这条通道不可用」处理，回落 B 不让功能丢。
      native = { kind: 'unavailable' };
    }
    if (native.kind === 'picked') return { kind: 'picked', path: native.path, via: 'native' };
    if (native.kind === 'cancelled') return { kind: 'cancelled', via: 'native' };
    // 调用方走了：不回落、不给文案（路由对它回 `{kind:'none'}`）。
    if (native.kind === 'aborted') return { kind: 'aborted', via: 'native' };
    if (native.kind === 'unsupported') return { kind: 'unsupported', message: native.message, via: 'native' };
    // unavailable：往下走 B。
  }
  // Linux 无显示环境时 zenity 会立刻失败并打印一堆 GTK 警告：直接判 unsupported，
  // 别让用户去等一个永远不会出现的框。
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return { kind: 'unsupported', message: '当前没有图形显示环境，请直接填写路径', via: 'shell' };
  }
  const spec = options.directory
    ? pickCommandOf({ ...options, platform })
    : pickFileCommandOf({ ...options, platform });
  if (spec === undefined) {
    return { kind: 'unsupported', message: '当前平台不支持系统选择框，请直接填写路径', via: 'shell' };
  }
  const spawnChild = options.spawnImpl ?? spawn;
  const signal = options.signal;
  const log = options.log;
  const interpreters = interpretersOf(spec, platform);
  return await new Promise<PickFolderResult>((resolvePromise) => {
    let stdout = '';
    let settled = false;
    // 句柄只在 finish / abort 里用，而它们都在赋值之前就要定义（error 事件可能来得比赋值早），
    // 所以放进一个可变容器而不是几个 `let`。
    const handles: {
      heartbeat?: ReturnType<typeof setInterval>;
      child?: ReturnType<typeof spawn>;
    } = {};
    /**
     * 收尾：只认第一次（选中 / 取消 / 弹不出来 / 调用方断开 都可能先后到达）。
     *
     * 这里是 B 路径**唯一**的结局入口：没有计时器参与，`heartbeat` 只被清掉、从不决定结论。
     */
    const finish = (result: ShellResult): void => {
      if (settled) return;
      settled = true;
      if (handles.heartbeat !== undefined) {
        clearInterval(handles.heartbeat);
        handles.heartbeat = undefined;
      }
      signal?.removeEventListener('abort', onAbort);
      // 子进程 = 那个框：走到这里就没有「还在等它」的人了，一起收掉。
      handles.child?.kill();
      resolvePromise({ ...result, via: 'shell' } as PickFolderResult);
    };
    /**
     * 调用方断开：框随进程消失，结论是 `aborted`。
     *
     * **不在这里先 `kill()`**：杀了之后子进程可能立刻发 `close`，那一路会拿空 stdout 得出
     * `cancelled`（用户没取消，只是没人等了）。所以先定局（`finish` 内部第一步就是置 `settled`），
     * 再由 `finish` 统一收掉子进程——顺序反过来就会把 `aborted` 误写成 `cancelled`。
     */
    const onAbort = (): void => {
      finish({ kind: 'aborted' });
    };
    /** 起一个解释器；`ENOENT` / `EACCES` 时换下一个（机器上没有这解释器，不是用户的问题）。 */
    const attempt = (index: number): void => {
      // 已经定局（abort / 用户关框）之后不得再起进程：否则留下一个没人等的框，还会被当成新的结局。
      if (settled) return;
      const command = interpreters[index] ?? interpreters[0] ?? spec.command;
      stdout = '';
      const child = spawnChild(command, [...spec.args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      handles.child = child;
      // 排障心跳：10 分钟一行日志，`unref()` 过，**只写日志**。
      // 它不是超时——删掉它、让它永不触发，结局也一模一样（别有人把它改成 finish）。
      if (handles.heartbeat === undefined) {
        handles.heartbeat = setInterval(() => {
          log?.warn(PICK_WAIT_HEARTBEAT_MESSAGE);
        }, PICK_WAIT_HEARTBEAT_MS);
        handles.heartbeat.unref?.();
      }
      /**
       * 事件归属校验：**只有「当前这一个子进程」的事件**才允许改变结局。
       *
       * 为什么必须有（review-report P2-1 的实测）：换解释器是「同一个 Promise 里起了第二个进程」，
       * 而真实 Node 给 spawn 失败的那次**也会补一个 `close`**（事件序是 `error(ENOENT)` → `close(-4058)`，
       * 不是二选一）。没有这道校验时，第一个 `powershell.exe` 迟到的 `close` 会落进下面同一个处理器：
       * `settled` 还是 `false`、`stdout` 已被 `attempt` 重置成 `''` → 得出 `cancelled`（用户什么都没做），
       * 再由 `finish` 里的 `kill()` 把**正在弹框的 `pwsh.exe`** 一起杀掉——用户看到框一闪而过。
       *
       * 注意 `settled` 挡不住这个场景：它是「已经定局」，而这里是「这个事件根本不属于这次定局」。
       */
      const isCurrent = (): boolean => handles.child === child;
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        // 同理：旧进程迟到的输出不得混进当前解释器的 stdout 缓冲区。
        if (!isCurrent()) return;
        stdout += chunk;
      });
      child.on('error', (error: NodeJS.ErrnoException) => {
        if (!isCurrent()) return;
        // 定局之后迟到的 `error`（abort 已先把这次调用收成 `aborted`）不得再换解释器：
        // 那条路径会 `attempt(index + 1)` 起一个**没人等**的框，用户看到的是「关掉又冒出来一个」。
        if (settled) return;
        if ((error.code === 'ENOENT' || error.code === 'EACCES') && index + 1 < interpreters.length) {
          // 换解释器仍属同一次调用：`signal` 监听挂在 Promise 上，不需要重挂；心跳也不要重建。
          attempt(index + 1);
          return;
        }
        finish({ kind: 'unsupported', message: error.message });
      });
      child.on('close', () => {
        if (!isCurrent()) return;
        if (settled) return;
        const path = stdout.trim();
        if (path === '' || path === '__CANCELLED__') finish({ kind: 'cancelled' });
        else finish({ kind: 'picked', path });
      });
    };
    // 已经断开就别起进程了（页面在点之前就关了）。
    if (signal?.aborted === true) {
      onAbort();
      return;
    }
    // 监听挂在 Promise 作用域上：一次注册覆盖「换解释器 / 多次 spawn」，`finish` 里摘掉。
    signal?.addEventListener('abort', onAbort);
    attempt(0);
  });
}
