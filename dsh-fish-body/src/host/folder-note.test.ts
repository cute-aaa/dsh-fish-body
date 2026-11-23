/**
 * 文件夹备注（src/host/folder-note.ts）的契约：
 * desktop.ini 的文本形状、非 Windows 直接跳过、内容没变不重写、别人的 desktop.ini 不覆盖。
 * 文件系统用注入替身，不落盘、不 spawn `attrib`。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
  desktopIniText,
  INI_NAME,
  NOTE_MARKER,
  writeFolderNote,
  writeFolderNotes,
  type NoteFs,
} from './folder-note.ts';

/** 内存版 fs：记录写入、保留内容，用来断言「写没写 / 写了几次 / 写了什么」。 */
function memoryFs(initial: Record<string, string> = {}): {
  fs: NoteFs;
  files: Map<string, string>;
  writes: Array<{ file: string; data: string }>;
} {
  const files = new Map(Object.entries(initial));
  const writes: Array<{ file: string; data: string }> = [];
  return {
    files,
    writes,
    fs: {
      existsSync: (path: string) => files.has(path),
      readFileSync: (path: string) => {
        const value = files.get(path);
        if (value === undefined) throw new Error('ENOENT: ' + path);
        return value;
      },
      writeFileSync: (path: string, data: string) => {
        writes.push({ file: path, data });
        files.set(path, data);
      },
    },
  };
}

/** 记录 attrib 的调用（真跑会 spawn 系统 attrib，测试里必须注入）。 */
function attribRecorder(): { calls: string[][]; run: (args: readonly string[]) => void } {
  const calls: string[][] = [];
  return { calls, run: (args: readonly string[]) => calls.push([...args]) };
}

describe('desktopIniText', () => {
  test('含 [.ShellClassInfo] 与 InfoTip=，并带本插件的归属标记行', () => {
    const text = desktopIniText('可随意删除');
    assert.ok(text.includes('[.ShellClassInfo]'));
    assert.ok(text.includes('InfoTip=可随意删除'));
    assert.ok(text.includes(NOTE_MARKER), '没有标记行就无法区分「我们写的」与「用户自己配的」');
    assert.ok(text.includes('ConfirmFileOp=0'));
  });

  test('正文里的换行被压平（InfoTip 只能是一行）', () => {
    assert.ok(desktopIniText('第一行\n第二行').includes('InfoTip=第一行 第二行'));
    assert.ok(desktopIniText('甲\r\n乙').includes('InfoTip=甲 乙'));
    assert.equal(desktopIniText('甲\n乙').includes('InfoTip=甲\n乙'), false);
  });
});

describe('writeFolderNote', () => {
  test('非 Windows：返回 skipped，一个文件都不写（其它平台没有 InfoTip 可读）', () => {
    const { fs, files, writes } = memoryFs();
    const attrib = attribRecorder();
    const dir = join('C:', 'u', 'fish-body', 'config');
    const result = writeFolderNote({ dir, note: '设置目录', platform: 'linux', fs, runAttrib: attrib.run });
    assert.equal(result, 'skipped');
    assert.deepEqual(writes, []);
    assert.equal(files.has(join(dir, INI_NAME)), false);
    assert.deepEqual(attrib.calls, []);
  });

  test('首次写入：落 desktop.ini，并给文件与目录打属性', () => {
    const { fs, files, writes } = memoryFs();
    const attrib = attribRecorder();
    const dir = join('C:', 'u', 'fish-body', 'cache', 'voice');
    const result = writeFolderNote({ dir, note: '语音缓存', platform: 'win32', fs, runAttrib: attrib.run });
    assert.equal(result, 'written');
    assert.equal(writes.length, 1);
    const file = join(dir, INI_NAME);
    assert.equal(files.get(file), desktopIniText('语音缓存'));
    assert.deepEqual(attrib.calls, [
      ['+h', '+s', file],
      ['+s', dir],
    ]);
  });

  test('内容已是最新：unchanged，不重写也不打属性（否则目录时间里一直跳）', () => {
    const dir = join('C:', 'u', 'fish-body', 'data');
    const file = join(dir, INI_NAME);
    const { fs, writes } = memoryFs({ [file]: desktopIniText('数据目录') });
    const attrib = attribRecorder();
    const result = writeFolderNote({ dir, note: '数据目录', platform: 'win32', fs, runAttrib: attrib.run });
    assert.equal(result, 'unchanged');
    assert.deepEqual(writes, []);
    assert.deepEqual(attrib.calls, []);
  });

  test('已存在的 desktop.ini 不含标记行：skipped，且内容一个字都不改', () => {
    const dir = join('C:', 'u', 'fish-body', 'pets');
    const file = join(dir, INI_NAME);
    const foreign = '[.ShellClassInfo]\r\nIconResource=user.ico\r\n';
    const { fs, files, writes } = memoryFs({ [file]: foreign });
    const attrib = attribRecorder();
    const result = writeFolderNote({ dir, note: '文件宠物', platform: 'win32', fs, runAttrib: attrib.run });
    assert.equal(result, 'skipped');
    assert.deepEqual(writes, []);
    assert.equal(files.get(file), foreign, '用户自己配的图标/注释不能被覆盖');
    assert.deepEqual(attrib.calls, []);
  });

  test('标记行在但内容变了：允许重写成新文案', () => {
    const dir = join('C:', 'u', 'fish-body', 'assets');
    const file = join(dir, INI_NAME);
    const { fs, files } = memoryFs({ [file]: desktopIniText('旧文案') });
    const attrib = attribRecorder();
    const result = writeFolderNote({ dir, note: '新文案', platform: 'win32', fs, runAttrib: attrib.run });
    assert.equal(result, 'written');
    assert.equal(files.get(file), desktopIniText('新文案'));
  });

  test('重写既有备注前先摘 隐藏/系统 属性：Windows 上带这两个属性的文件无法被截断重写', () => {
    // 真机症状：desktop.ini 已被打成 隐藏+系统，Node 的 writeFileSync（CREATE_ALWAYS）会被拒 EPERM，
    // 备注文案改了却永远停在旧的那一句。这里钉住「先 -h -s，写完再 +h +s」的顺序。
    const dir = join('C:', 'u', 'fish-body', 'assets', 'pet');
    const file = join(dir, INI_NAME);
    const { fs } = memoryFs({ [file]: desktopIniText('旧文案') });
    const attrib = attribRecorder();
    assert.equal(writeFolderNote({ dir, note: '新文案', platform: 'win32', fs, runAttrib: attrib.run }), 'written');
    assert.deepEqual(attrib.calls, [
      ['-h', '-s', file],
      ['+h', '+s', file],
      ['+s', dir],
    ]);
  });

  test('写盘抛错：failed，不向外抛', () => {
    const fs: NoteFs = {
      existsSync: () => false,
      readFileSync: () => '',
      writeFileSync: () => {
        throw new Error('EACCES');
      },
    };
    const dir = join('C:', 'u', 'fish-body');
    assert.equal(writeFolderNote({ dir, note: 'x', platform: 'win32', fs, runAttrib: attribRecorder().run }), 'failed');
  });
});

describe('writeFolderNotes', () => {
  test('逐个目录记结果；非 Windows 时全是 skipped', () => {
    const { fs } = memoryFs();
    const dirs = ['/u/fish-body/config', '/u/fish-body/data'];
    const result = writeFolderNotes(
      new Map([
        [dirs[0]!, '设置'],
        [dirs[1]!, '数据'],
      ]),
      { platform: 'linux', fs },
    );
    assert.deepEqual(result, { [dirs[0]!]: 'skipped', [dirs[1]!]: 'skipped' });
  });
});
