/**
 * 「打开文件夹」的平台命令（src/host/open-folder.ts）：目录类别 → 目录由 routes 的测试覆盖，
 * 这里只管**交给谁打开**——Windows 走 ShellExecute（PowerShell 的 Start-Process），
 * 路径经环境变量传递而不是拼命令行，macOS / Linux 用各自的「默认处理程序」入口。
 * 只算命令描述，不真的拉子进程（不弹窗口）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { openCommandOf, WINDOWS_OPEN_ENV } from './open-folder.ts';

describe('openCommandOf', () => {
  const target = 'D:\\NodeJs\\DSH_home\\dsh-pet\\skin\\layered\\feiyu-05';

  test('Windows：交给 PowerShell 的 Start-Process（ShellExecute），路径只走环境变量', () => {
    const spec = openCommandOf(target, 'win32');
    assert.ok(spec);
    assert.equal(spec.command, 'powershell.exe');
    assert.equal(spec.env?.[WINDOWS_OPEN_ENV], target);
    const command = spec.args.join(' ');
    assert.ok(command.includes('Start-Process'));
    assert.ok(command.includes('$env:' + WINDOWS_OPEN_ENV));
    // 路径绝不出现在命令行里：否则 & ^ % 与引号都得在这里重写一套转义。
    assert.equal(
      spec.args.some((arg) => arg.includes(target)),
      false,
    );
    assert.ok(spec.args.includes('-NoProfile'));
    assert.ok(spec.args.includes('-NonInteractive'));
  });

  test('macOS：open（LaunchServices，跟随系统默认）', () => {
    const spec = openCommandOf('/Users/me/dsh-pet/skin', 'darwin');
    assert.deepEqual(spec, { args: ['/Users/me/dsh-pet/skin'], command: 'open' });
  });

  test('Linux：xdg-open（跟随 xdg 默认）', () => {
    const spec = openCommandOf('/home/me/dsh-pet/skin', 'linux');
    assert.deepEqual(spec, { args: ['/home/me/dsh-pet/skin'], command: 'xdg-open' });
  });

  test('未知平台：返回 undefined（不猜命令名）', () => {
    assert.equal(openCommandOf('C:\\x', 'aix' as NodeJS.Platform), undefined);
  });
});
