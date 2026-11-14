/**
 * 「打开文件夹」的平台命令（src/host/open-folder.ts）：目录类别 → 目录由 routes 的测试覆盖，
 * 这里只管**交给谁打开**——Windows 走 ShellExecute（`rundll32 url.dll,FileProtocolHandler`），
 * macOS / Linux 用各自的「默认处理程序」入口。
 * 只算命令描述，不真的拉子进程（不弹窗口）。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { openCommandOf } from './open-folder.ts';

describe('openCommandOf', () => {
  const target = 'D:\\NodeJs\\DSH_home\\dsh-pet\\skin\\layered\\feiyu-05';

  test('Windows：交给 ShellExecute（rundll32 FileProtocolHandler），跟随默认文件管理器', () => {
    const spec = openCommandOf(target, 'win32');
    assert.ok(spec);
    assert.equal(spec.command, 'rundll32.exe');
    assert.deepEqual(spec.args, ['url.dll,FileProtocolHandler', target]);
  });

  test('Windows：不走 powershell Start-Process（隐藏 + detach 会把 SW_HIDE 传给目标窗口）', () => {
    const spec = openCommandOf(target, 'win32');
    assert.ok(spec);
    // 这一条是线上回归的护栏：Start-Process 在宿主的隐藏子进程里会把目录开成隐藏窗口，
    // 表现是「点了没反应」。任何时候都别把它加回来。
    assert.notEqual(spec.command, 'powershell.exe', '不许用 PowerShell 打开文件夹');
    assert.equal(
      spec.args.some((arg) => arg.includes('Start-Process')),
      false,
      '命令行里不许再出现 Start-Process',
    );
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
