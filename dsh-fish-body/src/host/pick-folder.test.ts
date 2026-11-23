/**
 * 原生目录选择（src/host/pick-folder.ts）的契约：
 * 三个平台的命令拼装（Windows 必须 `-STA`，否则 WinForms 直接抛）、无图形环境时直接判 unsupported
 * （不让用户等三分钟超时）。
 * 不出现在这里的：真的弹一个窗口——那条只能在真机手测。
 *
 * R2 起多了一层「A 通道（helper 的 Electron 系统框）优先，只有它 unavailable 才回落 B」：
 * 六条路径都在本文件里用假 `native` + 假 `spawn` 覆盖，判据是「有没有真的落到 B」。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';

import {
  PICK_WAIT_HEARTBEAT_MESSAGE,
  PICK_WAIT_HEARTBEAT_MS,
  pickCommandOf,
  pickFile,
  pickFileCommandOf,
  pickFolder,
} from './pick-folder.ts';
import { createHelperDialog } from './helper/dialog.ts';
import type { NativePicker, NativePickerOutcome } from './helper/dialog.ts';

/**
 * 假 `spawn`：记录要起的命令，下一拍把结论从 stdout 回给调用方。
 *
 * `stdout` 传 `'__CANCELLED__'` 表示用户取消，传空串表示「什么也没说」。
 * `hold: true` 表示「框一直开着」：不在下一拍收尾，只有 `kill()` / `release()` 才会让它 `close`
 * （并发守卫的用例需要这个——否则第一次调用会在断言之前就结束）。
 * 选择框已经**没有超时**了，所以「hold 的那次怎么收尾」只能由 `release()`（≈ 用户关掉框）决定。
 */
function fakeSpawn(stdout: string, opts: { hold?: boolean } = {}) {
  const calls: { command: string; args: readonly string[] }[] = [];
  const children: EventEmitter[] = [];
  /** 每次 `kill()` 都记一笔：用来断言「调用方断开时子进程真的被收掉」。 */
  const kills: number[] = [];
  const spawnImpl = ((command: string, args: readonly string[]) => {
    calls.push({ command, args });
    const child = new EventEmitter() as unknown as {
      stdout: EventEmitter & { setEncoding: () => void };
      kill: () => void;
    } & EventEmitter;
    (child as unknown as { stdout: unknown }).stdout = Object.assign(new EventEmitter(), {
      setEncoding: () => undefined,
    });
    children.push(child as unknown as EventEmitter);
    const close = (): void => {
      child.emit('close', 0);
    };
    (child as unknown as { kill: unknown }).kill = () => {
      kills.push(calls.length - 1);
      if (opts.hold === true) close();
    };
    if (opts.hold !== true) {
      setTimeout(() => {
        if (stdout !== '') child.stdout.emit('data', stdout);
        close();
      }, 0);
    }
    return child;
  }) as unknown as typeof spawn;
  /** 用户终于关掉了那个框（或进程自己退出）：发出 `close`，让还在飞的那次调用收尾。 */
  const release = (): void => {
    for (const child of children) child.emit('close', 0);
  };
  return { calls, spawnImpl, release, kills, children };
}

/** 一个固定结论的 A 通道。 */
const nativeOf =
  (outcome: NativePickerOutcome): NativePicker =>
  async () =>
    outcome;

describe('pickCommandOf', () => {
  test('Windows 目录框：走 Vista+ IFileOpenDialog + FOS_PICKFOLDERS，标题里的单引号被转义', () => {
    const spec = pickCommandOf({ platform: 'win32', title: "it's a title", start: 'D:/a' });
    assert.ok(spec);
    assert.equal(spec.command, 'powershell.exe');
    assert.ok(spec.args.includes('-STA'), 'WinForms / COM 对话框在 MTA 线程上会抛，必须 -STA');
    const script = spec.args[spec.args.length - 1] ?? '';
    // 现状锁：现代目录框靠内联 COM 互操作 + FOS_PICKFOLDERS，不再是 FolderBrowserDialog 老树控件。
    assert.ok(script.includes('IFileOpenDialog'), 'Vista+ 的目录框是 IFileOpenDialog');
    assert.ok(script.includes('FOS_PICKFOLDERS'), '不设 FOS_PICKFOLDERS 就变成「选文件」了');
    assert.ok(script.includes('Add-Type -TypeDefinition'), '托管侧没有包装，必须内联编译 COM 互操作');
    assert.ok(script.includes("it''s a title"), '单引号要按 PowerShell 规则双写');
    // 三条不变量之一：初始目录必须**真的**进对话框。
    // 这里钉两个位置，缺一个都算回归（review-report P2-2：`script.includes("'D:/a'")` 这种子串断言
    // 只要脚本里还残留着给回落分支的那一行就绿，现代框丢初始目录也不会红）：
    //   1. 现代框：`Show(<title>, <start>, <owner>)` 的第二实参（C# 侧把它喂给 SetFolder(SHCreateItemFromParsingName)）；
    //   2. 回落框：`$d.SelectedPath = '<start>';` 这条**完整赋值语句**（少了分号就不是一条语句）。
    const showCall = script.slice(script.indexOf('[DshPickFolder]::Show('));
    const showArgs = showCall.slice(0, showCall.indexOf(')') + 1);
    assert.ok(
      showArgs.endsWith(", 'D:/a', $o.Handle)"),
      '初始目录要当 Show 的第二实参交进去（SetFolder），否则现代框会停在「上次目录」：' + showArgs,
    );
    assert.match(
      script,
      /\$d\.SelectedPath = 'D:\/a';/,
      '回落分支（FolderBrowserDialog）同样要落初始目录，且必须是完整赋值语句',
    );
    assert.equal(
      script.includes('$d.InitialDirectory'),
      false,
      '`$d.InitialDirectory` 是选文件框的写法；目录脚本里出现它说明两条命令串了',
    );
  });

  test('Windows 目录框：没给初始目录时两处都不写（不塞空串、不留残留赋值）', () => {
    const spec = pickCommandOf({ platform: 'win32', title: 'pick' });
    assert.ok(spec);
    const script = spec.args[spec.args.length - 1] ?? '';
    assert.ok(
      script.includes("[DshPickFolder]::Show('pick', '', $o.Handle)"),
      '没有初始目录就传空串，交给系统「上次目录」',
    );
    // 注意别断言 `$d.SelectedPath`：回落分支成功时本来就会**读**它（`$picked = $d.SelectedPath`）。
    assert.equal(script.includes('$d.SelectedPath ='), false, '没有初始目录就不该出现这条赋值语句');
  });

  test('Windows 目录框：拿不到编译器 / 受限语言模式时回落 FolderBrowserDialog（两条分支都在）', () => {
    const spec = pickCommandOf({ platform: 'win32', title: 'pick' });
    assert.ok(spec);
    const script = spec.args[spec.args.length - 1] ?? '';
    // 回落分支必须真的存在：Add-Type 失败时 try/catch 里要能弹老框，否则「选目录」在那些机器上整块消失。
    assert.ok(script.includes('FolderBrowserDialog'), '回落分支：老式 FolderBrowserDialog 仍在');
    assert.ok(script.includes('$d.ShowDialog($o)'), '回落分支同样带属主');
    assert.ok(/catch\s*\{/.test(script), '要有 catch 才能回落');
    assert.ok(script.indexOf('IFileOpenDialog') < script.indexOf('FolderBrowserDialog'), '先试新的，再回落老的');
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
      script.indexOf('[Console]::OutputEncoding') < script.indexOf('IFileOpenDialog'),
      '切编码要在任何输出之前',
    );
  });

  test('Windows：给对话框一个隐身 TopMost 属主（后台进程弹框默认会开在浏览器后面）', () => {
    const spec = pickCommandOf({ platform: 'win32', title: 'pick' });
    assert.ok(spec);
    const script = spec.args[spec.args.length - 1] ?? '';
    assert.ok(script.includes('$o.TopMost = $true'), '属主要总在最前，否则用户看到的是「点了没反应」');
    assert.ok(script.includes('$o.Handle'), '现代框要把属主句柄交给 Show');
    assert.ok(script.includes('$d.ShowDialog($o)'), '回落分支同样把属主交给 ShowDialog');
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

describe('pick-path：A（helper 系统框）优先，只有 unavailable 才回落 B', () => {
  test('A 返回 picked：直接给出路径，一根 PowerShell 都不 spawn', async () => {
    const { calls, spawnImpl } = fakeSpawn('D:/never-used');
    const result = await pickFile({
      platform: 'win32',
      native: nativeOf({ kind: 'picked', path: 'D:/voice/ref.txt' }),
      spawnImpl,
    });
    assert.deepEqual(result, { kind: 'picked', path: 'D:/voice/ref.txt', via: 'native' });
    assert.equal(calls.length, 0, 'A 成功时不该再起兜底命令');
  });

  test('A 返回 cancelled：原样给 cancelled（用户的决定，不是失败）', async () => {
    const { calls, spawnImpl } = fakeSpawn('D:/never-used');
    const result = await pickFolder({ platform: 'win32', native: nativeOf({ kind: 'cancelled' }), spawnImpl });
    assert.deepEqual(result, { kind: 'cancelled', via: 'native' });
    assert.equal(calls.length, 0);
  });

  test('A 返回 unavailable：回落 B，命令里仍带 powershell.exe / -STA / 扩展名过滤', async () => {
    const { calls, spawnImpl } = fakeSpawn('D:/voice/ref.txt');
    const result = await pickFile({
      platform: 'win32',
      title: '选择参考文本',
      extensions: ['.ckpt', '.pth'],
      native: nativeOf({ kind: 'unavailable' }),
      spawnImpl,
    });

    assert.equal(calls.length, 1, 'A 不可用时要真的走 B');
    assert.equal(calls[0]?.command, 'powershell.exe');
    const args = calls[0]?.args ?? [];
    assert.ok(args.includes('-STA'), 'WinForms 的对话框必须 -STA');
    const script = args[args.length - 1] ?? '';
    assert.ok(script.includes('*.ckpt;*.pth'), '扩展名过滤不能丢');
    assert.ok(script.includes('OpenFileDialog'));
    assert.deepEqual(result, { kind: 'picked', path: 'D:/voice/ref.txt', via: 'shell' });
  });

  test('A 抛错（连接类异常）：按「这条通道不可用」处理并回落 B', async () => {
    const { calls, spawnImpl } = fakeSpawn('D:/voice/folder');
    const native: NativePicker = async () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:1') as NodeJS.ErrnoException;
      error.code = 'ECONNREFUSED';
      throw error;
    };
    const result = await pickFolder({ platform: 'win32', native, spawnImpl });

    assert.equal(calls.length, 1, 'A 抛错也要走 B，别把异常透给路由');
    assert.deepEqual(result, { kind: 'picked', path: 'D:/voice/folder', via: 'shell' });
  });

  test('A 返回 unsupported（明确弹不出来）：不 spawn，原样把原因透出去', async () => {
    const { calls, spawnImpl } = fakeSpawn('D:/never-used');
    const result = await pickFolder({
      platform: 'win32',
      native: nativeOf({ kind: 'unsupported', message: '当前 helper 没有 dialog.showOpenDialog' }),
      spawnImpl,
    });

    assert.equal(calls.length, 0, 'A 已经明确说过弹不出来，再弹一个 B 就是两个框竞态');
    assert.deepEqual(result, {
      kind: 'unsupported',
      message: '当前 helper 没有 dialog.showOpenDialog',
      via: 'native',
    });
  });

  test('A 超时（unsupported + 超时文案）：不 spawn，文案与 B 的超时提示同款', async () => {
    const { calls, spawnImpl } = fakeSpawn('D:/never-used');
    const result = await pickFolder({
      platform: 'win32',
      native: nativeOf({ kind: 'unsupported', message: '选择框超时，请直接填写路径' }),
      spawnImpl,
    });

    assert.equal(calls.length, 0);
    assert.equal(result.kind, 'unsupported');
    assert.equal(result.kind === 'unsupported' ? result.message : '', '选择框超时，请直接填写路径');
  });

  test('解释器链：powershell.exe 不存在（ENOENT）→ 换 pwsh.exe；旧进程迟到的 close 不得收尾', async () => {
    /** 假子进程：`stdout` 与 `kill` 都记在自己的名下，能精确打到某一个解释器上。 */
    interface FakeChild extends EventEmitter {
      stdout: EventEmitter & { setEncoding: () => void };
      kill: () => void;
    }
    const tried: string[] = [];
    const children = new Map<string, FakeChild>();
    /** 谁被 kill 了：旧进程迟到的 `close` 若误收尾，这里会多出一次（打在正在弹框的 `pwsh.exe` 上）。 */
    const kills: string[] = [];
    const spawnImpl = ((command: string) => {
      tried.push(command);
      const child = new EventEmitter() as unknown as FakeChild;
      (child as unknown as { stdout: unknown }).stdout = Object.assign(new EventEmitter(), {
        setEncoding: () => undefined,
      });
      (child as unknown as { kill: unknown }).kill = () => kills.push(command);
      children.set(command, child);
      return child;
    }) as unknown as typeof spawn;

    const pending = pickFolder({ platform: 'win32', native: nativeOf({ kind: 'unavailable' }), spawnImpl });
    await tick();
    const powershell = children.get('powershell.exe');
    assert.ok(powershell !== undefined, '第一个解释器已经真的起来了');

    // 真实事件序的第一半：`error(ENOENT)`。此时同一次调用里换到下一个解释器。
    const missing = new Error('spawn powershell.exe ENOENT') as NodeJS.ErrnoException;
    missing.code = 'ENOENT';
    powershell.emit('error', missing);
    await tick();
    assert.deepEqual(tried, ['powershell.exe', 'pwsh.exe'], '机器上没有 5.1 就退到 pwsh（不是用户的问题）');
    const pwsh = children.get('pwsh.exe');
    assert.ok(pwsh !== undefined, '第二个解释器已经在弹框');

    // 真实事件序的第二半：spawn 失败的那次**也会**收到 `close`（不是二选一），而且它是迟到的。
    // 没有身份校验时，它落进同一个处理器：`settled` 仍为 false、stdout 已被重置成空 →
    // 得出 `cancelled`（用户什么都没做），并把正在弹框的 pwsh.exe kill 掉。
    powershell.emit('close', -4058, null);
    await tick();
    await tick();
    assert.deepEqual(
      kills,
      [],
      '旧解释器迟到的 close 不得收尾：正在弹框的 pwsh.exe 不能被 kill（修前这里会多出一次 kill）',
    );
    assert.equal(
      await settlesWithin(pending, 60),
      false,
      '旧解释器的 close 不得定局：修前这里会提前回 {kind:"cancelled"}（用户什么都没做）',
    );

    // 用户终于在新起的那个框里选了：这才是这次调用唯一的结局。
    pwsh.stdout.emit('data', 'D:/voice/via-pwsh');
    pwsh.emit('close', 0, null);
    assert.deepEqual(await pending, { kind: 'picked', path: 'D:/voice/via-pwsh', via: 'shell' });
    assert.deepEqual(kills, ['pwsh.exe'], '收尾只 kill 当前这一个子进程，且只 kill 一次');
  });

  test('换解释器期间 signal 仍然有效：abort 照样 kill 并回 aborted', async () => {
    const children: EventEmitter[] = [];
    const spawnImpl = ((command: string) => {
      const child = new EventEmitter() as unknown as {
        stdout: EventEmitter & { setEncoding: () => void };
        kill: () => void;
      } & EventEmitter;
      (child as unknown as { stdout: unknown }).stdout = Object.assign(new EventEmitter(), {
        setEncoding: () => undefined,
      });
      (child as unknown as { kill: unknown }).kill = () => undefined;
      children.push(child as unknown as EventEmitter);
      if (command === 'powershell.exe') {
        setTimeout(() => {
          const error = new Error('ENOENT') as NodeJS.ErrnoException;
          error.code = 'ENOENT';
          child.emit('error', error);
        }, 0);
      }
      // pwsh 那次一直开着（hold）：只能靠 abort 收尾。
      return child;
    }) as unknown as typeof spawn;

    const controller = new AbortController();
    const pending = pickFolder({
      platform: 'win32',
      native: nativeOf({ kind: 'unavailable' }),
      spawnImpl,
      signal: controller.signal,
    });
    // 等到「已经换到第二个解释器」（轮询，不靠 tick 次数猜时序）。
    for (let i = 0; i < 100 && children.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      assert.equal(children.length, 2, '已经换到第二个解释器');
      controller.abort();
      assert.deepEqual(await pending, { kind: 'aborted', via: 'shell' }, '监听挂在 Promise 上：换解释器不用重挂');
    } finally {
      // abort 是幂等的：无论上面断言是否通过，都要把那一次收尾，别把模块级守卫漏给后面的用例。
      controller.abort();
      await pending.catch(() => undefined);
    }
  });

  test('A 说 unavailable 而这块平台又没有兜底：结论仍是 unsupported，内部态不泄漏', async () => {
    // `unavailable` 只是「这条路这次不能用」的内部信号（helper/dialog.ts 的注释），不是给用户看的结论。
    // 平台没有 B 通道时它必须被翻成 unsupported，而不是原样冒出响应（路由只认三态）。
    const result = await pickFolder({
      platform: 'aix' as NodeJS.Platform,
      env: {},
      native: nativeOf({ kind: 'unavailable' }),
    });
    assert.deepEqual(result, {
      kind: 'unsupported',
      message: '当前平台不支持系统选择框，请直接填写路径',
      via: 'shell',
    });
  });
});

/**
 * 两半合起来跑：宿主侧 `createHelperDialog`（协议映射）→ `pickPath`（要不要回落 B）。
 *
 * 这两半各自都有单测，但「连弹两个框」只会在它们的**交界处**发生：
 * helper 已经明确说 busy/超时，宿主却当成「这条路不可用」又弹了一个 PowerShell 框。
 */
describe('A/B 边界的合成用例：helper 的结论真的决定了要不要 spawn', () => {
  /** 一个「已经回过话」的 helper：`payload` 就是它在 `POST /pick` 的应答体。 */
  const helperOf = (payload: unknown): NativePicker =>
    createHelperDialog({
      endpoint: () => 'http://127.0.0.1:1',
      requestImpl: async () => new Response(JSON.stringify(payload), { status: 200 }),
    });

  /** 一个「连不上」的 helper：注入的传输实现直接抛连接类错误（`TypeError: fetch failed` 同形）。 */
  const deadHelper = (): NativePicker =>
    createHelperDialog({
      endpoint: () => 'http://127.0.0.1:1',
      requestImpl: () => {
        throw new TypeError('fetch failed');
      },
    });

  test('helper 回 busy → unsupported 且不 spawn（用户不会被丢到第二个框上）', async () => {
    const { calls, spawnImpl } = fakeSpawn('D:/never-used');
    const result = await pickFolder({
      platform: 'win32',
      native: helperOf({ ok: false, reason: 'busy', message: '另一个选择框还开着' }),
      spawnImpl,
    });

    assert.deepEqual(result, {
      kind: 'unsupported',
      message: '另一个选择框还开着，请先关掉已打开的选择框再点',
      via: 'native',
    });
    assert.equal(calls.length, 0, 'helper 已经明确说忙，再起一个 PowerShell 框就是两个框');
  });

  test('helper 回 timeout（老 helper 仍有限时）→ 新提示「版本较旧」且不 spawn', async () => {
    const { calls, spawnImpl } = fakeSpawn('D:/never-used');
    const result = await pickFolder({
      platform: 'win32',
      native: helperOf({ ok: false, reason: 'timeout', message: '选择框超时' }),
      spawnImpl,
    });

    assert.deepEqual(result, {
      kind: 'unsupported',
      message: 'helper 版本较旧仍在限时；请重启插件后再试，或直接填写路径',
      via: 'native',
    });
    assert.equal(calls.length, 0);
  });

  test('helper 连不上（连接类错误）→ unavailable → 回落 B，功能不丢', async () => {
    const { calls, spawnImpl } = fakeSpawn('D:/voice/fallback');
    const result = await pickFolder({ platform: 'win32', native: deadHelper(), spawnImpl });

    assert.deepEqual(result, { kind: 'picked', path: 'D:/voice/fallback', via: 'shell' });
    assert.equal(calls.length, 1, '这条路断了才轮到 PowerShell');
  });

  test('helper 还活着但连接断了 → unsupported（通道中断），**不**回落 B', async () => {
    const { calls, spawnImpl } = fakeSpawn('D:/never-used');
    const broken: NativePicker = createHelperDialog({
      endpoint: () => 'http://127.0.0.1:1',
      isPeerAlive: () => true,
      requestImpl: () => {
        throw new TypeError('fetch failed');
      },
    });

    const result = await pickFolder({ platform: 'win32', native: broken, spawnImpl });

    assert.deepEqual(result, {
      kind: 'unsupported',
      message: '选择框通道中断，请直接填写路径',
      via: 'native',
    });
    assert.equal(calls.length, 0, 'helper 活着 = 框可能还在屏幕上：再弹一个 PowerShell 框就是叠框');
  });
});

describe('无超时：B 路径的结局只由「确定的事实」决定', () => {
  test('框一直开着 → Promise 保持 pending（没有任何计时器能把它判死）', async () => {
    const { calls, spawnImpl, release } = fakeSpawn('', { hold: true });
    const pending = pickFolder({ platform: 'win32', native: nativeOf({ kind: 'unavailable' }), spawnImpl });

    await tick();
    assert.equal(calls.length, 1, '框已经真的起了');
    assert.equal(await settlesWithin(pending, 120), false, '120ms 内不该有结论：改造前这里会按 3 分钟超时收尾');
    release();
    assert.deepEqual(await pending, { kind: 'cancelled', via: 'shell' }, '只有「用户关框」才收尾');
  });

  test('心跳到点只写日志、不判失败：10 分钟过去 Promise 仍未落地', async (t) => {
    const warns: string[] = [];
    const { spawnImpl, release } = fakeSpawn('', { hold: true });
    // 只 mock setInterval：假 spawn 的 setTimeout(0) 与哨兵的 setTimeout 都还是真的。
    t.mock.timers.enable({ apis: ['setInterval'] });
    const pending = pickFolder({
      platform: 'win32',
      native: nativeOf({ kind: 'unavailable' }),
      spawnImpl,
      log: { warn: (message: string) => warns.push(message) },
    });

    await tick();
    assert.equal(await settlesWithin(pending, 60), false, '心跳之前本来就是 pending');
    t.mock.timers.tick(PICK_WAIT_HEARTBEAT_MS);
    assert.deepEqual(warns, [PICK_WAIT_HEARTBEAT_MESSAGE], '10 分钟：只写一行「仍在等待用户选择（不是失败，无超时）」');
    assert.equal(await settlesWithin(pending, 40), false, '心跳**不参与结局**：打完日志仍然 pending');

    release();
    assert.deepEqual(await pending, { kind: 'cancelled', via: 'shell' });
  });

  test('没注入 log 时心跳静默，但仍然不影响结局', async (t) => {
    const { spawnImpl, release } = fakeSpawn('', { hold: true });
    t.mock.timers.enable({ apis: ['setInterval'] });
    const pending = pickFolder({ platform: 'win32', native: nativeOf({ kind: 'unavailable' }), spawnImpl });
    await tick();
    t.mock.timers.tick(PICK_WAIT_HEARTBEAT_MS * 2);
    assert.equal(await settlesWithin(pending, 40), false);
    release();
    assert.equal((await pending).kind, 'cancelled');
  });
});

describe('调用方断开（signal）：B 路径唯一的提前退出机制', () => {
  test('abort → aborted（不回落、无文案）、子进程被收掉、互斥已释放', async () => {
    const { calls, spawnImpl, kills } = fakeSpawn('D:/never-used', { hold: true });
    const controller = new AbortController();
    const pending = pickFolder({
      platform: 'win32',
      native: nativeOf({ kind: 'unavailable' }),
      spawnImpl,
      signal: controller.signal,
    });

    await tick();
    assert.equal(calls.length, 1, '框已经真的起了');
    controller.abort();
    assert.deepEqual(await pending, { kind: 'aborted', via: 'shell' }, '调用方走了：不是失败，也没有文案');
    assert.equal(kills.length, 1, '框随进程消失：子进程必须被 kill（否则留下一个没人收的窗口）');

    // 互斥必须已释放：下一次调用能真的再起一个框（否则页面关一次就永久锁死）。
    const again = fakeSpawn('D:/voice/after-abort');
    const result = await pickFile({
      platform: 'win32',
      native: nativeOf({ kind: 'unavailable' }),
      spawnImpl: again.spawnImpl,
    });
    assert.equal(again.calls.length, 1);
    assert.deepEqual(result, { kind: 'picked', path: 'D:/voice/after-abort', via: 'shell' });
  });

  test('signal 在点之前就已经 abort：直接 aborted，一个进程都不起', async () => {
    const controller = new AbortController();
    controller.abort();
    const { calls, spawnImpl } = fakeSpawn('D:/never-used');
    const result = await pickFolder({
      platform: 'win32',
      native: nativeOf({ kind: 'unavailable' }),
      spawnImpl,
      signal: controller.signal,
    });

    assert.deepEqual(result, { kind: 'aborted', via: 'shell' });
    assert.equal(calls.length, 0, '页面在点之前就关了，别再起一个孤儿子进程');
  });
});

/** 让「已经进入 pickPath、但还在 await A 通道」的那次调用推进到 spawn 之后。 */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * 哨兵：`ms` 毫秒内这次调用有没有落地。
 *
 * `false` = 还在挂起（正确：选择框没有超时）；`true` = 有人按时间把它判死了（错误）。
 * 它自己不是超时逻辑，只提供「这一刻还没结论」这个可观察窗口。
 *
 * @param promise - 被观察的调用。
 * @param ms - 观察窗口（毫秒）。
 * @returns 窗口内是否落地。
 */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return await Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

describe('选择器并发守卫：连点两次不弹两个框', () => {
  test('第一次还在飞时第二次立即回 unsupported，且不再 spawn', async () => {
    const { calls, spawnImpl, release } = fakeSpawn('', { hold: true });
    // `hold`：框一直开着（选择框没有超时，它只会等用户），正好占住守卫。
    const first = pickFolder({ platform: 'win32', native: nativeOf({ kind: 'unavailable' }), spawnImpl });
    try {
      await tick();
      assert.equal(calls.length, 1, '第一次已经真的起了框');

      const second = await pickFolder({ platform: 'win32', native: nativeOf({ kind: 'unavailable' }), spawnImpl });
      assert.deepEqual(
        second,
        { kind: 'unsupported', message: '另一个选择框还开着，请先关掉已打开的选择框再点' },
        '与 helper 的 busy 同语义，且文案告诉用户下一步',
      );
      assert.equal(calls.length, 1, '第二次不该起第二个进程（否则用户会点到没有返回值的那个框）');
    } finally {
      // 必须收尾：守卫还在飞的时候别把状态漏给下一个用例。`release()` ≈ 用户关掉那个框。
      release();
      const done = await first;
      assert.deepEqual(done, { kind: 'cancelled', via: 'shell' }, '关框后按真实结论收尾（空 stdout = 用户取消）');
    }
  });

  test('释放：上一次结束（含提前返回）之后，下一次能正常进入', async () => {
    // 先走一条「A 明确说弹不出来」的提前返回路径：守卫必须在 finally 里释放，不能只在成功路径释放。
    const blocked = await pickFile({
      platform: 'win32',
      native: nativeOf({ kind: 'unsupported', message: '弹不出来' }),
      spawnImpl: fakeSpawn('D:/never-used').spawnImpl,
    });
    assert.equal(blocked.kind, 'unsupported');

    const again = fakeSpawn('D:/voice/second');
    const result = await pickFile({
      platform: 'win32',
      native: nativeOf({ kind: 'unavailable' }),
      spawnImpl: again.spawnImpl,
    });
    assert.equal(again.calls.length, 1, '守卫必须已经释放，第二次要真的能弹框');
    assert.deepEqual(result, { kind: 'picked', path: 'D:/voice/second', via: 'shell' });
  });

  test('抛错路径也释放：spawn 同步抛错之后，守卫不能留在占用态', async () => {
    // 守卫写在 `try { … } finally { pickInFlight = false }` 里，这里验证的正是 finally。
    // 不声明「异常必须冒到调用方」——将来若改成内部兜成 unsupported 也不该影响这条用例，
    // 所以只吞掉异常，判据是「下一次还能进」。
    const boom = (() => {
      throw new Error('spawn 直接抛了');
    }) as unknown as typeof spawn;
    await pickFolder({ platform: 'win32', native: nativeOf({ kind: 'unavailable' }), spawnImpl: boom }).catch(
      () => undefined,
    );

    const again = fakeSpawn('D:/voice/after-throw');
    const result = await pickFile({
      platform: 'win32',
      native: nativeOf({ kind: 'unavailable' }),
      spawnImpl: again.spawnImpl,
    });
    assert.equal(again.calls.length, 1, '一次异常之后再也弹不出框，是守卫只写在成功路径上的典型症状');
    assert.deepEqual(result, { kind: 'picked', path: 'D:/voice/after-throw', via: 'shell' });
  });
});

describe('定局之后迟到的事件：不得再起一个没人等的框（review P3-2 / P3-11）', () => {
  test('abort 之后迟到的 ENOENT：不再换解释器、不多杀、结论仍是 aborted', async () => {
    const { calls, spawnImpl, kills, children } = fakeSpawn('', { hold: true });
    const controller = new AbortController();
    const pending = pickFolder({
      platform: 'win32',
      native: nativeOf({ kind: 'unavailable' }),
      spawnImpl,
      signal: controller.signal,
    });

    await tick();
    assert.equal(calls.length, 1, '框已经起了（第一个解释器）');

    controller.abort();
    assert.deepEqual(await pending, { kind: 'aborted', via: 'shell' }, '调用方走了：abort 先定局');
    assert.equal(kills.length, 1, '收掉的是自己那个框');

    // 真实 Node 的事件序：`error(ENOENT)` 可能比 abort 更晚到达同一个 child。
    children[0]?.emit('error', Object.assign(new Error('spawn powershell.exe ENOENT'), { code: 'ENOENT' }));
    await tick();

    assert.equal(calls.length, 1, '定局之后不得 `attempt(index + 1)`：那是一个没人等的框');
    assert.equal(kills.length, 1, '也不该再 kill 一次（没有新进程可杀）');
  });

  test('反向序不变：先 ENOENT（未定局）仍会换下一个解释器', async () => {
    const { calls, children, release, spawnImpl } = fakeSpawn('D:/voice/second', { hold: true });
    const pending = pickFolder({ platform: 'win32', native: nativeOf({ kind: 'unavailable' }), spawnImpl });

    await tick();
    assert.equal(calls.length, 1);
    children[0]?.emit('error', Object.assign(new Error('spawn powershell.exe ENOENT'), { code: 'ENOENT' }));
    await tick();
    assert.equal(calls.length, 2, '没定局时换解释器是正确行为：机器上可能只有 pwsh');

    release();
    assert.deepEqual(await pending, { kind: 'cancelled', via: 'shell' });
  });
});

describe('A/B 合成（真 createHelperDialog + 真 pickFolder）：等待类超时不回落、不 spawn', () => {
  test('helper 活着 + 注入等待类超时 → 一直 pending（不回落 B、不判失败），abort 才收尾', async () => {
    const { calls, spawnImpl } = fakeSpawn('D:/never-used');
    const controller = new AbortController();
    const native = createHelperDialog({
      endpoint: () => 'http://127.0.0.1:1',
      isPeerAlive: () => true,
      requestImpl: () => rejectAfter(50, waitingTimeoutError()),
    });
    const pending = pickFolder({ platform: 'win32', native, spawnImpl, signal: controller.signal });

    assert.equal(await settlesWithin(pending, 800), false, '等待不以时间为条件：既不 unsupported 也不回落 B');
    assert.equal(calls.length, 0, '不 spawn：回落就会和还在屏幕上的框叠成两个');

    controller.abort();
    assert.deepEqual(await pending, { kind: 'aborted', via: 'native' });
  });

  test('helper 活着 + 注入连接中断 → unsupported（通道中断），不 spawn', async () => {
    const { calls, spawnImpl } = fakeSpawn('D:/never-used');
    const native = createHelperDialog({
      endpoint: () => 'http://127.0.0.1:1',
      isPeerAlive: () => true,
      requestImpl: () => Promise.reject(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })),
    });

    const result = await pickFolder({ platform: 'win32', native, spawnImpl });

    assert.deepEqual(result, { kind: 'unsupported', message: '选择框通道中断，请直接填写路径', via: 'native' });
    assert.equal(calls.length, 0, 'helper 活着 = 框可能还在屏幕上：再弹一个就是叠框');
  });

  test('helper 死了 + 注入连接中断 → unavailable → 回落 B（powershell.exe -STA）', async () => {
    const { calls, spawnImpl } = fakeSpawn('D:/voice/fallback');
    const native = createHelperDialog({
      endpoint: () => 'http://127.0.0.1:1',
      isPeerAlive: () => false,
      requestImpl: () => Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
    });

    const result = await pickFolder({ platform: 'win32', native, spawnImpl });

    assert.deepEqual(result, { kind: 'picked', path: 'D:/voice/fallback', via: 'shell' });
    assert.equal(calls.length, 1, 'helper 死了框也随进程消失，回落 B 是安全的');
    assert.equal(calls[0]?.command, 'powershell.exe');
    assert.ok(calls[0]?.args.includes('-STA'), 'WinForms / COM 对话框必须在 STA 线程上弹，否则直接抛');
  });

  test('signal abort 贯穿 A 通道：aborted，且互斥已释放（下一次能真的弹框）', async () => {
    const { calls, spawnImpl } = fakeSpawn('D:/never-used');
    const controller = new AbortController();
    const native = createHelperDialog({
      endpoint: () => 'http://127.0.0.1:1',
      // 替身也必须尊重调用方 `signal`：宿主侧没有自己的计时器，abort 是唯一出口。
      requestImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () =>
              reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' })),
            { once: true },
          );
        }),
    });
    const pending = pickFolder({ platform: 'win32', native, spawnImpl, signal: controller.signal });

    await tick();
    assert.equal(calls.length, 0, 'A 通道还在等用户，没有理由起 B');
    controller.abort();
    assert.deepEqual(await pending, { kind: 'aborted', via: 'native' }, '路由层据此回 `{kind:"none"}`（layout.ts）');

    // 守卫必须已在 finally 里释放：页面关一次不能把选择框永久锁死。
    const again = fakeSpawn('D:/voice/after-native-abort');
    const result = await pickFile({
      platform: 'win32',
      native: nativeOf({ kind: 'unavailable' }),
      spawnImpl: again.spawnImpl,
    });
    assert.deepEqual(result, { kind: 'picked', path: 'D:/voice/after-native-abort', via: 'shell' });
    assert.equal(again.calls.length, 1);
  });
});

/** 形似 undici 的「等待类超时」：外层 `TypeError`，真正原因在 `cause` 上。 */
function waitingTimeoutError(): TypeError {
  const cause = Object.assign(new Error('Headers Timeout Error'), {
    code: 'UND_ERR_HEADERS_TIMEOUT',
    name: 'HeadersTimeoutError',
  });
  return new TypeError('fetch failed', { cause });
}

/** 在 `ms` 之后 reject 的一次传输（`requestImpl` 替身；计时器只在测试里）。 */
function rejectAfter(ms: number, error: unknown): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    setTimeout(() => reject(error), ms);
  });
}
