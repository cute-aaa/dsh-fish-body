/**
 * GSV 服务的启停：跑用户指定的启动 / 停止脚本，不自己猜进程树。
 *
 * 为什么不内置 `python api_v2.py`：部署形态太多（vendored api_v2、官方工程、bat/sh/ps1），
 * 参数与环境变量（PYTHONPATH、tts_infer.yaml、CUDA 设备）只有用户自己的脚本知道；
 * 猜错一次就是「启动了但加载了错的权重」。所以这里只做两件事：**校验脚本存在**、**把它跑起来**。
 * 停止同理：优先用用户给的停止脚本；没配就明确拒绝，不按端口扫进程（那是另一种猜法，
 * 且有杀错进程的风险——本机 9880 未必只跑 GSV）。
 * 不做自动启动：GPU 加载要几十秒，插件启动阶段拉起它会把 profile 启动拖慢，且失败要退避重试——留给后续。
 *
 * **启动不建控制台**：以前用 `cmd /c start ""` 起一个独立控制台窗口，窗口一被关掉，
 * 子进程还活着但 stdout 成了废句柄——`api_v2` 的 `/tts` 在合成前有一句 `print()`，于是每句都抛
 * `OSError: [Errno 22] Invalid argument` 变成 400，整条链静默落到 edge（本机 2026-11-14 的真实故障）。
 * 现在把脚本的 stdout/stderr 接到日志文件，且**不创建窗口**：没有可被关掉的东西，
 * 脚本自己再往里重定向（`gsv.bat` 就写了 `>> logs\gsv\api-v2.log`）时两份都落在文件里。
 * @module dsh-fish-body/src/host/voice/gsv/process
 */
import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 脚本跑起来的结论；失败给一句人话（路由直接回给设置页）。 */
export interface ScriptRunResult {
  readonly ok: boolean;
  readonly message?: string;
}

/** 停止脚本的最长等待（ms）：停止通常是杀进程，超过这个时间就当它没成功。 */
const STOP_TIMEOUT_MS = 20_000;

/**
 * 启动脚本的输出落到哪：`<userRoot>/logs/gsv/<providerId>-start.log`。
 *
 * 放在 userRoot 而不是脚本旁边：脚本可能在只读目录或系统路径下，而日志是插件自己产生的数据。
 * @param userRoot - 插件数据根（`<DSH_HOME>/dsh-pet`）。
 * @param providerId - 实现 id（`gsv`）。
 * @returns 日志文件的绝对路径（追加写，不清空）。
 */
export function startLogPath(userRoot: string, providerId: string): string {
  return join(userRoot, 'logs', 'gsv', `${providerId}-start.log`);
}

/**
 * 校验脚本路径可用（存在且是文件）。
 * @param script - 用户填的绝对路径。
 * @returns 不可用时的原因；可用返回 undefined。
 */
function scriptProblem(script: string): string | undefined {
  if (!script) return '未配置脚本路径';
  if (!existsSync(script)) return `脚本不存在：${script}`;
  try {
    if (!statSync(script).isFile()) return `不是文件：${script}`;
  } catch (error) {
    return `脚本不可读：${error instanceof Error ? error.message : String(error)}`;
  }
  return undefined;
}

/**
 * 把脚本的输出接到日志文件的那两个 fd 上；拿不到就退回 `ignore`。
 *
 * @param logFile - 日志路径；不给或打不开就只丢弃输出（不能让日志问题挡住启动）。
 * @returns 传给 `spawn` 的 stdio 与需要收尾的 fd。
 */
function logStdio(logFile: string | undefined): { stdio: StdioOptions; fd?: number } {
  if (!logFile) return { stdio: 'ignore' };
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    const fd = openSync(logFile, 'a');
    // 只复制给子进程，父进程里这份要在 spawn 成功（或失败）后关掉，别让句柄漏在插件进程里。
    return { stdio: ['ignore', fd, fd], fd };
  } catch {
    return { stdio: 'ignore' };
  }
}

/** 子进程拿到 fd 之后（或 spawn 失败）关掉父进程那份，并始终消费异步 error；重复调用无害。 */
function releaseFd(child: ChildProcess, fd: number | undefined): void {
  let closed = false;
  const close = (): void => {
    if (closed || fd === undefined) return;
    closed = true;
    try {
      closeSync(fd);
    } catch {
      // 已经关了：正常路径（spawn 与 error 只会来一个）也可能两头都触发，忽略。
    }
  };
  child.once('spawn', close);
  child.once('error', close);
}

/**
 * 按扩展名选解释器：Windows 的 .bat/.cmd 走 cmd，.ps1 走 powershell，其余当可执行文件/交给 shell。
 *
 * 不用 `cmd /c start`：那是「为了给 `pause`/`timeout` 让路」而建独立控制台的老办法，
 * 代价是那个窗口可被关掉、留下一个 stdout 已失效的孤儿服务（见模块头）。
 * @param script - 脚本绝对路径。
 * @param logFile - 输出日志；undefined = 丢弃输出。
 */
function spawnScript(script: string, logFile: string | undefined): void {
  const lower = script.toLowerCase();
  const { stdio, fd } = logStdio(logFile);
  const options = { detached: true, stdio, windowsHide: true, cwd: dirname(script) };
  let child: ReturnType<typeof spawn>;
  if (lower.endsWith('.bat') || lower.endsWith('.cmd')) {
    child = spawn('cmd.exe', ['/c', script], options);
  } else if (lower.endsWith('.ps1')) {
    child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], options);
  } else {
    // sh / bash / python / 可执行文件：交给 shell 解析（用户脚本自己带 shebang 或解释器）
    child = spawn(script, [], { ...options, shell: true });
  }
  releaseFd(child, fd);
  child.unref();
}

/**
 * 启动 GSV：校验脚本后异步拉起，立刻返回（服务加载要几十秒，不等它）。
 * @param script - 启动脚本绝对路径。
 * @param logFile - 脚本输出落到哪（见 {@link startLogPath}）；缺省丢弃输出。
 * @returns 已拉起 / 拒绝的原因。
 */
export function startService(script: string, logFile?: string): ScriptRunResult {
  const problem = scriptProblem(script);
  if (problem) return { ok: false, message: problem };
  try {
    spawnScript(script, logFile);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 停止 GSV：跑停止脚本并等它退出（最多 {@link STOP_TIMEOUT_MS}）。
 *
 * 没配停止脚本时由路由改走 api_v2 的 `/control?command=exit`（服务自己退），不在这里按端口扫进程——
 * 那样会杀错别的东西（本机 9880 未必只跑 GSV），比「停不掉」更糟。
 *
 * @param script - 停止脚本绝对路径（可为空）。
 * @returns 已停止 / 失败原因。
 */
export async function stopService(script: string): Promise<ScriptRunResult> {
  const problem = scriptProblem(script);
  if (problem) return { ok: false, message: problem + '（请先配置停止脚本）' };
  return new Promise<ScriptRunResult>((resolve) => {
    let settled = false;
    const child = spawn(script, [], {
      shell: true,
      stdio: 'ignore',
      windowsHide: true,
      cwd: dirname(script),
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, message: `停止脚本超时（${STOP_TIMEOUT_MS / 1000}s），可能在等确认` });
    }, STOP_TIMEOUT_MS);
    timer.unref?.();
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, message: error.message });
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // 停止脚本的退出码不决定成败（杀进程时常常非 0），真实状态以 9880 的探测为准
      resolve({ ok: true, ...(code === 0 ? {} : { message: `停止脚本退出码 ${String(code)}` }) });
    });
  });
}
