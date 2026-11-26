/**
 * GSV 启停脚本的测试（src/host/voice/gsv/process.ts）。
 *
 * 钉四件事：脚本不存在就拒绝（不猜路径）、停止脚本缺席时明确说「请先配置」（不按端口扫进程）、
 * 配好的脚本真的被跑起来（用临时脚本验证，不碰本机 GSV）、
 * 启动的输出接到日志文件而不是控制台（控制台被关掉就没人接 `print`，`/tts` 会整片 400）。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { startLogPath, startService, stopService } from './process.ts';

const roots: string[] = [];

/** 建临时目录并写一个脚本文件。 */
function scriptFile(name: string, content: string): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pet-gsvproc-'));
  roots.push(root);
  const file = join(root, name);
  writeFileSync(file, content);
  return file;
}

/** 等日志里出现某段文本（子进程是异步写文件的）。 */
async function waitForText(file: string, needle: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (readFileSync(file, 'utf8').includes(needle)) return true;
    } catch {
      // 还没建出来：继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

afterEach(() => {
  // Windows 上后台 powershell 可能还开着脚本文件一小会儿：rmSync 带重试，别把清理竞态报成用例失败。
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
});

test('启动：没填脚本 → 拒绝并说明', () => {
  const result = startService('');
  assert.equal(result.ok, false);
  assert.match(result.message ?? '', /未配置脚本路径/);
});

test('启动：脚本不存在 → 拒绝，不尝试 spawn', () => {
  const result = startService(join(tmpdir(), 'definitely-missing-gsv-start.bat'));
  assert.equal(result.ok, false);
  assert.match(result.message ?? '', /脚本不存在/);
});

test('启动：配好的脚本会被跑起来（powershell 隐藏窗口执行）', { skip: process.platform !== 'win32' }, () => {
  const script = scriptFile('probe.ps1', 'Start-Sleep -Milliseconds 10\n');
  const result = startService(script);
  assert.deepEqual(result, { ok: true });
});

test('启动：日志路径按 userRoot 固定（排障时知道去哪儿看）', () => {
  const root = join(tmpdir(), 'dsh-home');
  assert.equal(startLogPath(root, 'gsv'), join(root, 'logs', 'gsv', 'gsv-start.log'));
});

test('启动：给了日志就把输出接过去（fd 打开即建文件，输出不落控制台）', () => {
  const script = scriptFile('silent.bat', '@echo off\r\nexit /b 0\r\n');
  const log = join(dirname(script), 'logs', 'gsv-start.log');
  assert.deepEqual(startService(script, log), { ok: true });
  assert.equal(existsSync(log), true, '日志文件应立刻被建出来（说明 stdio 指向文件而不是控制台）');
});

test(
  '启动：脚本的 stdout 真的写进日志文件（不再建可被关掉的控制台）',
  { skip: process.platform !== 'win32' },
  async () => {
    const script = scriptFile('speak.bat', '@echo off\r\necho gsv-started-marker\r\n');
    const log = join(dirname(script), 'speak.log');
    assert.deepEqual(startService(script, log), { ok: true });
    assert.equal(await waitForText(log, 'gsv-started-marker'), true, '脚本输出应出现在日志里');
  },
);

test('停止：没有停止脚本 → 明确要求先配置（不按端口扫进程）', async () => {
  const result = await stopService('');
  assert.equal(result.ok, false);
  assert.match(result.message ?? '', /停止脚本/);
});

test('停止：脚本存在 → 跑完返回 ok（退出码不影响结论，真实状态以探活为准）', async () => {
  const script = scriptFile('stop.bat', '@echo off\r\nexit /b 0\r\n');
  const result = await stopService(script);
  assert.equal(result.ok, true);
});
