/**
 * 原生目录选择（src/host/pick-folder.ts）的契约：
 * 三个平台的命令拼装（Windows 必须 `-STA`，否则 WinForms 直接抛）、无图形环境时直接判 unsupported
 * （不让用户等三分钟超时）。
 * 不出现在这里的：真的弹一个窗口——那条只能在真机手测。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { pickCommandOf, pickFile, pickFileCommandOf, pickFolder } from './pick-folder.ts';

describe('pickCommandOf', () => {
  test('Windows：powershell -STA + FolderBrowserDialog，标题里的单引号被转义', () => {
    const spec = pickCommandOf({ platform: 'win32', title: "it's a title", start: 'D:/a' });
    assert.ok(spec);
    assert.equal(spec.command, 'powershell.exe');
    assert.ok(spec.args.includes('-STA'), 'WinForms 的对话框在 MTA 线程上会抛，必须 -STA');
    const script = spec.args[spec.args.length - 1] ?? '';
    assert.ok(script.includes('FolderBrowserDialog'));
    assert.ok(script.includes("it''s a title"), '单引号要按 PowerShell 规则双写');
    assert.ok(script.includes("$d.SelectedPath = 'D:/a'"), '有初始目录就带上');
  });

  test('Windows：stdout 显式设成 UTF-8（否则中文路径变乱码）', () => {
    const spec = pickCommandOf({ platform: 'win32', title: 'pick' });
    assert.ok(spec);
    const script = spec.args[spec.args.length - 1] ?? '';
    assert.ok(
      script.includes('[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false'),
      'stdout 被重定向时默认是控制台代码页，必须显式切 UTF-8',
    );
    assert.ok(
      script.indexOf('[Console]::OutputEncoding') < script.indexOf('FolderBrowserDialog'),
      '切编码要在任何输出之前',
    );
  });

  test('Windows：给对话框一个隐身 TopMost 属主（后台进程弹框默认会开在浏览器后面）', () => {
    const spec = pickCommandOf({ platform: 'win32', title: 'pick' });
    assert.ok(spec);
    const script = spec.args[spec.args.length - 1] ?? '';
    assert.ok(script.includes('$o.TopMost = $true'), '属主要总在最前，否则用户看到的是「点了没反应」');
    assert.ok(script.includes('$d.ShowDialog($o)'), '把属主交给 ShowDialog');
    assert.ok(script.includes('$o.Close()'), '关掉属主，别留下隐形窗口');
    assert.equal(
      script.includes('UseDescriptionForTitle'),
      false,
      '这个属性只在新版 .NET Framework 上存在，老机器上会直接报「找不到该属性」',
    );
  });

  test('macOS：osascript choose folder', () => {
    const spec = pickCommandOf({ platform: 'darwin', title: 'pick' });
    assert.ok(spec);
    assert.equal(spec.command, 'osascript');
    assert.equal(spec.args[0], '-e');
    assert.ok(String(spec.args[1]).includes('choose folder'));
  });

  test('Linux：zenity --file-selection --directory', () => {
    const spec = pickCommandOf({ platform: 'linux', title: 'pick' });
    assert.ok(spec);
    assert.equal(spec.command, 'zenity');
    assert.ok(spec.args.includes('--directory'));
  });

  test('未知平台：没有命令（调用方回 unsupported）', () => {
    assert.equal(pickCommandOf({ platform: 'aix' as NodeJS.Platform }), undefined);
  });
});

describe('pickFolder', () => {
  test('Linux 无显示环境：直接 unsupported，不 spawn', async () => {
    const result = await pickFolder({ platform: 'linux', env: {} });
    assert.equal(result.kind, 'unsupported');
  });

  test('未知平台：unsupported', async () => {
    const result = await pickFolder({ platform: 'aix' as NodeJS.Platform, env: {} });
    assert.equal(result.kind, 'unsupported');
  });
});

describe('pickFileCommandOf —— 选文件框', () => {
  test('Windows：OpenFileDialog + 扩展名过滤 + 初始目录', () => {
    const spec = pickFileCommandOf({ platform: 'win32', title: '权重', start: 'D:/w', extensions: ['.ckpt', '.pth'] });
    assert.ok(spec);
    assert.equal(spec.command, 'powershell.exe');
    assert.ok(spec.args.includes('-STA'));
    const script = spec.args[spec.args.length - 1] ?? '';
    assert.ok(script.includes('OpenFileDialog'));
    assert.ok(script.includes('*.ckpt;*.pth'), '过滤项要按扩展名拼');
    assert.ok(script.includes("$d.InitialDirectory = 'D:/w'"));
    // 与目录框同一套可靠性前提：UTF-8 输出 + 总在最前的属主。
    assert.ok(script.includes('[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false'));
    assert.ok(script.includes('$o.TopMost = $true'));
    assert.ok(script.includes('$d.ShowDialog($o)'));
  });

  test('macOS：osascript choose file', () => {
    const spec = pickFileCommandOf({ platform: 'darwin', title: 'pick' });
    assert.ok(spec);
    assert.equal(spec.command, 'osascript');
    assert.ok(String(spec.args[1]).includes('choose file'));
  });

  test('Linux：zenity --file-selection（不带 --directory），带过滤项', () => {
    const spec = pickFileCommandOf({ platform: 'linux', title: 'pick', extensions: ['.wav'] });
    assert.ok(spec);
    assert.equal(spec.command, 'zenity');
    assert.ok(spec.args.includes('--file-selection'));
    assert.equal(spec.args.includes('--directory'), false);
    assert.ok(spec.args.includes('--file-filter'));
  });

  test('未知平台：没有命令', () => {
    assert.equal(pickFileCommandOf({ platform: 'aix' as NodeJS.Platform }), undefined);
  });
});

describe('pickFile', () => {
  test('Linux 无显示环境 / 未知平台：直接 unsupported，不 spawn', async () => {
    assert.equal((await pickFile({ platform: 'linux', env: {} })).kind, 'unsupported');
    assert.equal((await pickFile({ platform: 'aix' as NodeJS.Platform, env: {} })).kind, 'unsupported');
  });
});
