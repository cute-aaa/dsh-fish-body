'use strict';
/**
 * 前台窗口采集（Windows 专用）：一个长驻 PowerShell 每拍打一行 JSON。
 *
 * 为什么不是 Electron API：Electron 没有任何「当前前台窗口是谁」的接口。Windows 上只能过
 * user32（`GetForegroundWindow` / `GetWindowRect` / `GetWindowThreadProcessId`），而本进程
 * 没有原生模块可调，所以借一个长驻 PowerShell 进程做这件事——**一次拉起、按拍打行**，
 * 不是每拍起一个进程（那样 1 秒一次会把自己拖垮）。
 *
 * 判定逻辑不在这里：本模块只负责「拉起来、读行、停掉」，打出来的行交给渲染端的
 * `shared/foreground` + `shared/avoid` 解析与决策（同一份共享代码，浏览器端也能复用）。
 * 非 Windows 平台直接报 unsupported——宁可功能不可用，也不要每次心跳都抛一次错。
 * @module dsh-fish-body/runtime/electron-helper/main/foreground
 */

const { spawn } = require('node:child_process');

/** 轮询脚本：先编译一次 user32 绑定，然后循环打行。 */
const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
# 输出必须是 UTF-8：Node 按 utf8 解码 stdout，而中文 Windows 的 PowerShell 默认是 GBK，
# 不设这一行中文窗口标题会变成乱码——白名单里的中文标题（「哔哩哔哩」这类）就永远匹配不上。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -Namespace DshFg -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@
while ($true) {
  $handle = [DshFg.Win]::GetForegroundWindow()
  if ($handle -ne [IntPtr]::Zero) {
    $rect = New-Object DshFg.Win+RECT
    [void][DshFg.Win]::GetWindowRect($handle, [ref]$rect)
    # $pid 是 PowerShell 的自动变量，不能赋值，这里用 $winPid
    $winPid = 0
    [void][DshFg.Win]::GetWindowThreadProcessId($handle, [ref]$winPid)
    $proc = Get-Process -Id $winPid
    $app = if ($proc) { $proc.ProcessName } else { '' }
    $title = if ($proc -and $proc.MainWindowTitle) { $proc.MainWindowTitle } else { '' }
    $payload = [pscustomobject]@{
      pid = [int]$winPid
      app = [string]$app
      title = [string]$title
      x = [int]$rect.Left
      y = [int]$rect.Top
      w = [int]($rect.Right - $rect.Left)
      h = [int]($rect.Bottom - $rect.Top)
    }
    Write-Output ($payload | ConvertTo-Json -Compress)
  }
  Start-Sleep -Milliseconds POLL_MS
}
`;

/** 当前轮询进程（每个 helper 进程只允许一个）。 */
let child = null;
/** 期望的节拍：变了就重启轮询进程（PowerShell 的 sleep 写在脚本里，改不了） */
let currentPollMs = 0;

/**
 * 拉起轮询。重复调用只会按新节拍重启，不会起第二个进程。
 *
 * @param pollMs - 节拍（毫秒）；非法值按 800 处理。
 * @param onLine - 每收到一行回调（原始字符串，解析交给调用方）。
 * @param onError - 进程级异常（spawn 失败 / 退出码非 0）回调。
 * @returns 是否已经（或刚刚）拉起。
 */
function startForegroundWatch(pollMs, onLine, onError) {
  if (process.platform !== 'win32') return false;
  const ms = Math.max(300, Math.min(5000, Math.round(Number(pollMs) || 800)));
  if (child && currentPollMs === ms) return true;
  stopForegroundWatch();
  currentPollMs = ms;
  const script = PS_SCRIPT.replace('POLL_MS', String(ms));
  try {
    child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        windowsHide: true,
      },
    );
  } catch (e) {
    if (onError) onError(e);
    child = null;
    return false;
  }
  if (!child) return false;
  child.on('error', (e) => {
    child = null;
    if (onError) onError(e);
  });
  child.on('exit', (code) => {
    // 非正常退出（被策略拦住 / 内存不足）也报一次，让上层决定要不要停
    if (child === null) return;
    child = null;
    if (code !== 0 && onError) onError(new Error('foreground poller exited with code ' + String(code)));
  });
  child.stdout.setEncoding('utf8');
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line !== '' && onLine) onLine(line);
      index = buffer.indexOf('\n');
    }
  });
  // stderr 只做进程级日志：PowerShell 的报错对用户没有可执行信息
  child.stderr.on('data', (chunk) => {
    const text = String(chunk).trim();
    if (text !== '') console.error('[fish-body-desktop] foreground poller:', text.split('\n')[0]);
  });
  return true;
}

/**
 * 停掉轮询进程（幂等）。
 */
function stopForegroundWatch() {
  const proc = child;
  child = null;
  currentPollMs = 0;
  if (!proc) return;
  try {
    proc.kill();
  } catch {
    /* 已经退了 */
  }
}

/** 当前是否有轮询在跑。 */
function foregroundWatchRunning() {
  return child !== null;
}

module.exports = { startForegroundWatch, stopForegroundWatch, foregroundWatchRunning };
