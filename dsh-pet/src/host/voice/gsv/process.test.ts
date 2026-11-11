/**
 * GSV 启停脚本的测试（src/host/voice/gsv/process.ts）。
 *
 * 钉三件事：脚本不存在就拒绝（不猜路径）、停止脚本缺席时明确说「请先配置」（不按端口扫进程）、
 * 配好的脚本真的被跑起来（用临时脚本验证，不碰本机 GSV）。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { startService, stopService } from './process.ts';

const roots: string[] = [];

/** 建临时目录并写一个脚本文件。 */
function scriptFile(name: string, content: string): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pet-gsvproc-'));
  roots.push(root);
  const file = join(root, name);
  writeFileSync(file, content);
  return file;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
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

test('启动：配好的脚本会被跑起来（powershell 隐藏窗口执行）', () => {
  const script = scriptFile('probe.ps1', 'Start-Sleep -Milliseconds 10\n');
  const result = startService(script);
  assert.deepEqual(result, { ok: true });
});

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
