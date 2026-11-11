/**
 * GSV 服务的启停：跑用户指定的启动 / 停止脚本，不自己猜进程树。
 *
 * 为什么不内置 `python api_v2.py`：部署形态太多（vendored api_v2、官方工程、bat/sh/ps1），
 * 参数与环境变量（PYTHONPATH、tts_infer.yaml、CUDA 设备）只有用户自己的脚本知道；
 * 猜错一次就是「启动了但加载了错的权重」。所以这里只做两件事：**校验脚本存在**、**把它跑起来**。
 * 停止同理：优先用用户给的停止脚本；没配就明确拒绝，不按端口扫进程（那是另一种猜法，
 * 且有杀错进程的风险——本机 9880 未必只跑 GSV）。
 * 不做自动启动：GPU 加载要几十秒，插件启动阶段拉起它会把 profile 启动拖慢，且失败要退避重试——留给后续。
 * @module dsh-pet/src/host/voice/gsv/process
 */
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

/** 脚本跑起来的结论；失败给一句人话（路由直接回给设置页）。 */
export interface ScriptRunResult {
  readonly ok: boolean;
  readonly message?: string;
}

/** 停止脚本的最长等待（ms）：停止通常是杀进程，超过这个时间就当它没成功。 */
const STOP_TIMEOUT_MS = 20_000;

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

/** 按扩展名选解释器：Windows 的 .bat/.cmd 走 cmd，.ps1 走 powershell，其余当可执行文件/交给 shell。 */
function spawnScript(script: string): void {
  const lower = script.toLowerCase();
  const options = { detached: true, stdio: 'ignore' as const, windowsHide: true, cwd: dirname(script) };
  if (lower.endsWith('.bat') || lower.endsWith('.cmd')) {
    // 用 cmd /c start 起一个独立控制台：脚本里的 `start`/`timeout`/`pause` 才不会占住本进程的管道
    const child = spawn('cmd.exe', ['/c', 'start', '', script], options);
    child.unref();
    return;
  }
  if (lower.endsWith('.ps1')) {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], options);
    child.unref();
    return;
  }
  // sh / bash / python / 可执行文件：交给 shell 解析（用户脚本自己带 shebang 或解释器）
  const child = spawn(script, [], { ...options, shell: true });
  child.unref();
}

/**
 * 启动 GSV：校验脚本后异步拉起，立刻返回（服务加载要几十秒，不等它）。
 * @param script - 启动脚本绝对路径。
 * @returns 已拉起 / 拒绝的原因。
 */
export function startService(script: string): ScriptRunResult {
  const problem = scriptProblem(script);
  if (problem) return { ok: false, message: problem };
  try {
    spawnScript(script);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 停止 GSV：跑停止脚本并等它退出（最多 {@link STOP_TIMEOUT_MS}）。
 *
 * 没有停止脚本就明确拒绝：按端口扫进程会杀错别的东西，比「停不掉」更糟。
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
