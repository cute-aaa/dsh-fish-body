/**
 * 设置备份的浏览器侧客户端（backup-api / backup-card / use-settings-backup）的契约测试。
 *
 * 五条契约：
 *   1. 文件名带日期（同一分钟内稳定），不依赖本地化；
 *   2. 读文件先用共享规则校验形状：「不是备份」「版本更新」「太大」要能分开；
 *   3. 没有 DOM 时不假装下载成功；
 *   4. 卡片只交文件：导出按钮走 onExport，恢复按钮触发隐藏文件框、选中后把 File 交出去；
 *   5. 弹窗确认后才 POST，成功后回填表单与基线；导出/恢复失败都要报出来。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { backupFileName, readBackupJson, restoreBackup, saveTextFile } from './backup-api.ts';
import { makeBackupCard } from './backup-card.ts';
import { useSettingsBackup } from './use-settings-backup.ts';
import type { SettingsRuntime } from './runtime.ts';
import { SETTINGS_BACKUP_KIND, SETTINGS_BACKUP_VERSION, type SettingsBackup } from '../../shared/settings-backup.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: string, props: Record<string, unknown>) => ({ tag, props })) as unknown as SettingsRuntime['h'];

/** 摊平整棵树，便于按标签找节点。 */
function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const json = (files: Record<string, unknown> = {}): string =>
  JSON.stringify({
    kind: SETTINGS_BACKUP_KIND,
    version: SETTINGS_BACKUP_VERSION,
    createdAt: '2026-11-14T03:00:00.000Z',
    pluginVersion: '0.4.7',
    files: { main: '', sessionFish: '', pets: {}, ...files },
  });

/** 读一份一定会通过的备份（失败直接让用例红）。 */
function mustParse(text: string): SettingsBackup {
  const parsed = readBackupJson(text);
  if (!parsed.ok) throw new Error('expected a valid backup: ' + parsed.failure.reason);
  return parsed.backup;
}

describe('backup-api —— 文件名与读文件', () => {
  test('文件名固定格式，同一分钟一致', () => {
    const at = new Date(2026, 10, 14, 3, 7);
    assert.equal(backupFileName(at), 'dsh-pet-settings-20261114-0307.json');
    assert.equal(backupFileName(new Date(at)), backupFileName(at));
  });

  test('合法文件通过；不是备份 / 版本更新 / 太大分别报出来', () => {
    assert.equal(readBackupJson(json()).ok, true);
    assert.deepEqual(readBackupJson('not json').ok ? null : readBackupJson('not json'), {
      ok: false,
      failure: { reason: 'not-backup' },
    });
    assert.deepEqual(readBackupJson(json({ main: 'x', sessionFish: 'x', pets: { ['../x']: '{}' } })).ok, false);
    const newer = JSON.stringify({ ...(JSON.parse(json()) as object), version: 99 });
    assert.deepEqual(readBackupJson(newer).ok ? null : readBackupJson(newer), {
      ok: false,
      failure: { reason: 'unsupported-version', version: 99 },
    });
    const huge = json({ main: 'x'.repeat(600 * 1024) });
    assert.deepEqual(readBackupJson(huge).ok ? null : readBackupJson(huge), {
      ok: false,
      failure: { reason: 'too-large' },
    });
  });

  test('没有 DOM 时不假装下载成功', () => {
    assert.equal(saveTextFile('a.json', '{}'), false);
  });

  test('恢复请求：成功解出成品与设置；业务失败带出宿主原因', async () => {
    const previous = globalThis.fetch;
    const calls: string[] = [];
    try {
      globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
        calls.push(String(input) + ' ' + String(init?.method));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, merged: { main: { pets: [] } }, settings: { enabled: true } }),
        } as Response);
      }) as typeof fetch;
      const ok = await restoreBackup(mustParse(json()));
      assert.equal(ok.ok, true);
      assert.equal(calls[0].endsWith('POST'), true);

      globalThis.fetch = (() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: false, reason: 'bad-request', message: 'not a dsh-pet settings backup' }),
        } as Response)) as typeof fetch;
      const bad = await restoreBackup(mustParse(json()));
      assert.deepEqual(bad, { ok: false, message: 'not a dsh-pet settings backup' });
    } finally {
      globalThis.fetch = previous;
    }
  });
});

describe('BackupCard —— 只交文件', () => {
  const BackupCard = makeBackupCard({
    h,
    t: (key: string) => key,
    useRef: ((init: unknown) => ({ current: init })) as never,
  } as never);

  test('导出按钮走 onExport；文件框只收 JSON 且选中后交出 File', () => {
    const exported: string[] = [];
    const picked: string[] = [];
    const tree = BackupCard({
      busy: false,
      onExport: () => exported.push('export'),
      onPick: (file: File) => picked.push(file.name),
    } as never);
    const buttons = flatten(tree).filter((node) => node.tag === 'button');
    assert.deepEqual(
      buttons.map((node) => node.props.children),
      ['backupExport', 'backupRestore'],
    );
    (buttons[0].props.onClick as () => void)();
    assert.deepEqual(exported, ['export']);

    const file = flatten(tree).find((node) => node.tag === 'input' && node.props.type === 'file');
    assert.ok(file);
    assert.equal(file.props.accept, '.json,application/json');
    (file.props.onChange as (e: unknown) => void)({
      target: { files: [{ name: 'mine.json' }], value: 'mine.json' },
    });
    assert.deepEqual(picked, ['mine.json']);
  });

  test('忙时两个按钮都禁用', () => {
    const tree = BackupCard({ busy: true, onExport: () => {}, onPick: () => {} } as never);
    for (const node of flatten(tree).filter((item) => item.tag === 'button')) {
      assert.equal(node.props.disabled, true);
    }
  });
});

/** 只按调用顺序分配状态槽的假 react（模拟多次渲染共享状态）。 */
function createRuntime() {
  const cells: Array<{ value: unknown }> = [];
  let cursor = 0;
  const useState = ((init: unknown) => {
    const slot = cursor;
    cursor += 1;
    if (cells[slot] === undefined) cells[slot] = { value: init };
    const cell = cells[slot];
    const set = (next: unknown): void => {
      cell.value = typeof next === 'function' ? (next as (previous: unknown) => unknown)(cell.value) : next;
    };
    return [cell.value, set];
  }) as never;
  return {
    useState,
    useCallback: ((fn: unknown) => fn) as never,
    t: (key: string) => key,
    render(deps: Parameters<typeof useSettingsBackup>[1]) {
      cursor = 0;
      // 测试夹具：按顺序调用一遍被测 hook，不是组件也不是自定义 hook。
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return useSettingsBackup(
        { useState, useCallback: ((fn: unknown) => fn) as never, t: (key: string) => key },
        deps,
      );
    },
  };
}

describe('useSettingsBackup —— 预检、确认与导出', () => {
  test('合法文件：只弹确认，不上传；确认后才 POST 并回填', async () => {
    const runtime = createRuntime();
    const dialogs: Array<{ kind: string; name?: string }> = [];
    const reports: string[] = [];
    const restored: string[] = [];
    const previous = globalThis.fetch;
    let posts = 0;
    try {
      globalThis.fetch = (() => {
        posts += 1;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, merged: { main: { pets: [] } }, settings: { enabled: true } }),
        } as Response);
      }) as typeof fetch;

      const state = runtime.render({
        report: (feedback) => reports.push(feedback.kind + ':' + feedback.text),
        setDialog: (dialog) => dialogs.push(dialog as never),
        onRestored: () => restored.push('restored'),
      });
      state.pick({ text: async () => json(), name: 'mine.json' } as unknown as File);
      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.deepEqual(dialogs, [{ kind: 'restore', name: 'mine.json' }]);
      assert.equal(posts, 0, '选文件阶段不该上传');

      const next = runtime.render({
        report: (feedback) => reports.push(feedback.kind + ':' + feedback.text),
        setDialog: (dialog) => dialogs.push(dialog as never),
        onRestored: () => restored.push('restored'),
      });
      next.confirm();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(posts, 1);
      assert.deepEqual(restored, ['restored']);
      assert.deepEqual(reports, ['ok:restoreDone']);
    } finally {
      globalThis.fetch = previous;
    }
  });

  test('不合法的文件：就地报错，不弹确认', async () => {
    const runtime = createRuntime();
    const dialogs: string[] = [];
    const reports: string[] = [];
    const state = runtime.render({
      report: (feedback) => reports.push(feedback.kind + ':' + feedback.text),
      setDialog: (dialog) => dialogs.push((dialog as unknown as { kind: string }).kind),
      onRestored: () => {},
    });
    state.pick({ text: async () => 'not a backup', name: 'x.json' } as unknown as File);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(dialogs, []);
    assert.deepEqual(reports, ['err:backupReadFailed']);
  });

  test('导出：宿主没回话时报错', async () => {
    const runtime = createRuntime();
    const reports: string[] = [];
    const previous = globalThis.fetch;
    try {
      globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch;
      const state = runtime.render({
        report: (feedback) => reports.push(feedback.kind + ':' + feedback.text),
        setDialog: () => {},
        onRestored: () => {},
      });
      state.exportNow();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(reports, ['err:backupExportFailed']);
    } finally {
      globalThis.fetch = previous;
    }
  });
});
