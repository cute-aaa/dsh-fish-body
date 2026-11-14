/**
 * 原生目录选择（src/host/pick-folder.ts）的契约：
 * 三个平台的命令拼装（Windows 必须 `-STA`，否则 WinForms 直接抛）、无图形环境时直接判 unsupported
 * （不让用户等三分钟超时）。
 * 不出现在这里的：真的弹一个窗口——那条只能在真机手测。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { pickCommandOf, pickFolder } from './pick-folder.ts';

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
