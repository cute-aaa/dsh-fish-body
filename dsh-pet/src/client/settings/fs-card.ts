/**
 * 「文件与目录」卡：数据根、皮肤目录、目录树、运行时与卸载，一张卡讲完「我的东西在哪」。
 *
 * 为什么只有一张卡：位置、目录说明与卸载本来是同一个问题的三个答案。拆成两张折叠卡时，
 * 用户要在两处之间来回对路径，而两条清单里的父目录与子目录还各列一遍。
 * 现在树是唯一表达：一条路径只出现一次，旁边一句「这个目录存什么」，卸载步骤沉到卡底。
 *
 * 树由宿主生成（`GET /config/meta` 的 `layout` / `readonly`）：客户端不拼任何路径字面量，
 * 只按 `depth` 画 `├─ / └─`、按 `key` 取一句说明（见 ./tree-notes）。目录布局怎么改，卡片都不用动。
 *
 * 两处「有动作」的地方：位置（改数据根 / 皮肤目录）与运行时（Electron）。两者都是后台任务，
 * 卡片只负责起步、轮询进度、把结论说清楚——不乐观更新路径，路径一律以重启后宿主给的为准。
 * @module dsh-fish-body/src/client/settings/fs-card
 */
import type { FunctionComponent } from 'react';
import type * as ReactNS from 'react';
import type { ConfigMeta, MetaNode, RuntimeSnapshot, RuntimeStatus } from './config/http.ts';
import { makeFolderButton } from './folder-button.ts';
import { fetchMoveStatus, pickFolder, startMove, type MovableLocation } from './layout-api.ts';
import { requestPluginRestart, schedulePageReload } from '../plugin-restart.ts';
import { fetchRuntime, resetRuntimeDir, saveRuntimeDir, startRuntimeDownload } from './runtime-api.ts';
import type { SettingsRuntime } from './runtime.ts';
import { treePrefixes } from './tree.ts';
import { treeNote } from './tree-notes.ts';
import { MONO_STACK, makeUiKit } from './ui.ts';

/** 卡片的输入：宿主给的那一份元信息。 */
export interface FsCardProps {
  /** 数据根、树、只读参考与运行时状态。 */
  readonly paths: ConfigMeta;
}

/** 折叠正文的 id：与卡头按钮的 `aria-controls` 成对。 */
const BODY_ID = 'pet-cfg-paths-fs';

/** 运行时轮询间隔：下载是分钟级的，2.5s 足够让进度条看起来是活的。 */
const RUNTIME_POLL_MS = 2500;

/** 搬迁轮询间隔：搬迁是秒到分钟级的，700ms 让字节数肉眼可见地走。 */
const MOVE_POLL_MS = 700;

/** 一次编辑的流程状态。 */
type EditState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'picking'; readonly which: MovableLocation }
  | { readonly kind: 'manual'; readonly which: MovableLocation; readonly text: string; readonly message?: string }
  | { readonly kind: 'confirm'; readonly which: MovableLocation; readonly target: string }
  | { readonly kind: 'moving'; readonly which: MovableLocation; readonly target: string }
  | { readonly kind: 'done'; readonly which: MovableLocation; readonly target: string }
  | { readonly kind: 'failed'; readonly which: MovableLocation; readonly message: string };

/** 字节 → `123 MB`（给进度条旁的一行小字）。 */
function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.max(0.1, mb).toFixed(1) + ' MB';
}

/** 镜像地址 → 主机名（弹窗里只显示主机，完整 URL 太长）。 */
function hostOf(mirror: string | undefined): string {
  if (mirror === undefined) return '';
  try {
    return new URL(mirror).host;
  } catch {
    return mirror;
  }
}

/** 进度百分比（总长为 0 时给 0，不猜）。 */
function percentOf(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

/**
 * 造「文件与目录」卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件。
 */
export function makeFsCard(rt: SettingsRuntime): FunctionComponent<FsCardProps> {
  const { h, t, useEffect, useState } = rt;
  const { foldCard, note, section } = makeUiKit({ h, t });
  const FolderButton = makeFolderButton(rt);

  /** 一行树节点：前缀 + 名字 + 说明（+ 只读参考组的徽标 + 「打开」）。 */
  const row = (node: MetaNode, prefix: string, badgeText?: string) => {
    const desc = treeNote(t, node.key);
    return h('div', {
      key: node.key,
      className: 'dsh-pet-cfg__treeRow' + (node.exists ? '' : ' is-missing'),
      children: [
        h('span', { key: 'p', className: 'dsh-pet-cfg__treePrefix', children: prefix }),
        h('span', {
          key: 'n',
          className: 'dsh-pet-cfg__treeName',
          children: node.kind === 'dir' ? node.name + '/' : node.name,
          title: node.path,
        }),
        desc === undefined ? null : h('span', { key: 'd', className: 'dsh-pet-cfg__treeDesc', children: desc }),
        badgeText === undefined
          ? null
          : h('span', { key: 'b', className: 'dsh-pet-cfg__treeBadge', children: badgeText }),
        // 徽标与「打开」都要落在第 4 列：给了徽标就不再给按钮（只读参考本来也打不开）。
        node.open === undefined || badgeText !== undefined ? null : h(FolderButton, { key: 'o', which: node.open }),
      ],
    });
  };

  /** 一格「位置」行：路径 + 来源说明 + 打开 / 更改位置。 */
  const locationRow = (
    key: string,
    path: string,
    hint: string,
    which: MovableLocation,
    source: string | undefined,
    onEdit: () => void,
  ) =>
    h('div', {
      key,
      className: 'dsh-pet-cfg__path',
      children: [
        h('b', { key: 'p', style: { fontFamily: MONO_STACK }, children: path }),
        h(FolderButton, { key: 'o', which: which === 'root' ? 'root' : 'skin-root' }),
        h('button', {
          key: 'e',
          type: 'button',
          className: 'dsh-pet-cfg__btn is-sm',
          onClick: onEdit,
          children: t('fsLocationChange'),
        }),
        source === undefined ? null : h('span', { key: 's', className: 'dsh-pet-cfg__treeDesc', children: source }),
        h('span', { key: 'h', className: 'dsh-pet-cfg__treeDesc', children: hint }),
      ],
    });

  return function FsCard(props: FsCardProps) {
    const { paths } = props;
    const [open, setOpen] = useState(false);
    const [runtime, setRuntime] = useState<RuntimeSnapshot | undefined>(
      paths.runtime === undefined ? undefined : { runtime: paths.runtime },
    );
    const [busy, setBusy] = useState(false);
    const [polling, setPolling] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [edit, setEdit] = useState<EditState>({ kind: 'idle' });

    // 运行时轮询：点了下载 / 检测到正在下载时每 2.5s 问一次，装好就停。
    // effect 里建 timer、清理里拆，切分区 / 关设置页都不会留下一个还在 setState 的定时器。
    useEffect(() => {
      if (!polling) return;
      let alive = true;
      const timer = setInterval(() => {
        void fetchRuntime().then((next) => {
          if (!alive || next === undefined) return;
          setRuntime(next);
          if (next.runtime?.installed === true) {
            setPolling(false);
            setBusy(false);
          }
        });
      }, RUNTIME_POLL_MS);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, [polling]);

    // 搬迁轮询：只在自己的流程里跑，搬完（busy=false）就停并读出结论。
    useEffect(() => {
      if (edit.kind !== 'moving') return;
      let alive = true;
      const timer = setInterval(() => {
        void fetchMoveStatus().then((status) => {
          if (!alive || status === undefined || status.busy) return;
          setEdit(
            status.error === undefined
              ? { kind: 'done', which: edit.which, target: status.movedTo ?? edit.target }
              : { kind: 'failed', which: edit.which, message: status.error },
          );
        });
      }, MOVE_POLL_MS);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, [edit]);

    /** 点「下载运行时」：起一次下载，然后靠轮询看结果。 */
    const download = (): void => {
      setBusy(true);
      setError(null);
      void startRuntimeDownload().then((outcome) => {
        if (outcome.snapshot !== undefined) setRuntime(outcome.snapshot);
        if (outcome.installed) {
          setBusy(false);
          return;
        }
        // `started: false` 也可能是「上一次还在下」：照样轮询，别让按钮点了没反应。
        setPolling(true);
      });
    };

    /** 选一个已下载的 Electron 目录。 */
    const chooseRuntimeDir = (): void => {
      setError(null);
      void pickFolder(t('fsRuntimePick')).then((picked) => {
        if (picked.kind === 'cancelled') return;
        if (picked.kind === 'unsupported') {
          setError(picked.message === '' ? t('fsLocationUnsupported') : picked.message);
          return;
        }
        setBusy(true);
        void saveRuntimeDir(picked.path).then((outcome) => {
          setBusy(false);
          if (outcome.kind === 'ok') {
            if (outcome.snapshot !== undefined) setRuntime(outcome.snapshot);
            return;
          }
          setError(outcome.kind === 'no-electron' ? outcome.message : t('saveError'));
        });
      });
    };

    /** 让运行时回到默认位置（<数据根>/runtime/electron）。 */
    const resetDir = (): void => {
      setBusy(true);
      setError(null);
      void resetRuntimeDir().then((outcome) => {
        setBusy(false);
        if (outcome.kind === 'ok') {
          if (outcome.snapshot !== undefined) setRuntime(outcome.snapshot);
          return;
        }
        setError(t('saveError'));
      });
    };

    /** 弹原生选目录框 → 得到目标后进确认。 */
    const beginEdit = (which: MovableLocation): void => {
      const current = which === 'root' ? paths.root : (paths.skin ?? '');
      setEdit({ kind: 'picking', which });
      void pickFolder(t('fsLocationPick'), current === '' ? undefined : current).then((picked) => {
        if (picked.kind === 'picked') setEdit({ kind: 'confirm', which, target: picked.path });
        else if (picked.kind === 'cancelled') setEdit({ kind: 'idle' });
        else setEdit({ kind: 'manual', which, text: '', message: picked.message });
      });
    };

    /** 确认后真正发起搬迁。 */
    const confirmMove = (which: MovableLocation, target: string): void => {
      void startMove(which, target).then((outcome) => {
        if (outcome.kind === 'started') {
          setEdit({ kind: 'moving', which, target });
          return;
        }
        setEdit({
          kind: 'failed',
          which,
          message: outcome.kind === 'busy' ? t('fsLocationBusy') : outcome.message,
        });
      });
    };

    /** 重启插件让新位置生效。 */
    const restart = (): void => {
      void requestPluginRestart().then((mode) => {
        if (mode === 'hmr') schedulePageReload();
      });
    };

    // 防御：meta 形状不对（老宿主 / 半升级）时按空树渲染，不让一张卡把整个设置页带崩。
    const layout = Array.isArray(paths.layout) ? paths.layout : [];
    const prefixes = treePrefixes(layout);
    const tree = layout.map((node, index) => row(node, prefixes[index] ?? ''));
    const readonly = Array.isArray(paths.readonly) ? paths.readonly : [];
    const readonlyRows = readonly.map((node, index) =>
      row(node, index === readonly.length - 1 ? '└─ ' : '├─ ', t('fsBadgeReadonly')),
    );

    const status: RuntimeStatus | undefined = runtime?.runtime;
    const installed = status?.installed === true;
    const downloading = runtime?.download?.active === true;
    const downloadPercent = percentOf(runtime?.download?.doneBytes ?? 0, runtime?.download?.totalBytes ?? 0);
    const runtimeText = installed
      ? t('fsRuntimeReady') + (status?.version === undefined ? '' : ' v' + status.version)
      : downloading || busy
        ? t('fsRuntimeDownloading').replace('{percent}', String(downloadPercent))
        : t('fsRuntimeMissing');
    const runtimeSource = status?.source === 'custom' ? t('fsRuntimeCustom') : t('fsRuntimeDefault');
    const rootSource =
      paths.rootSource === 'env'
        ? t('fsRootSourceEnv')
        : paths.rootSource === 'pointer'
          ? t('fsRootSourcePointer')
          : t('fsRootSourceDefault');

    /** 确认弹窗：搬目录是不可撤销的重活，必须先把「旧位置会被移除」讲清楚。 */
    const confirmNode =
      edit.kind === 'confirm'
        ? h('div', {
            key: 'confirm',
            className: 'dsh-pet-cfg__mask',
            onClick: () => setEdit({ kind: 'idle' }),
            children: h('div', {
              className: 'dsh-pet-cfg__dialog',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': t('fsLocationConfirmTitle'),
              onClick: (e: ReactNS.MouseEvent<HTMLDivElement>) => e.stopPropagation(),
              children: [
                h('div', { key: 't', className: 'dsh-pet-cfg__dialogTitle', children: t('fsLocationConfirmTitle') }),
                h('div', {
                  key: 'b',
                  className: 'dsh-pet-cfg__dialogBody',
                  children: t('fsLocationConfirmBody')
                    .replace('{from}', edit.which === 'root' ? paths.root : (paths.skin ?? ''))
                    .replace('{to}', edit.target),
                }),
                h('div', {
                  key: 'a',
                  className: 'dsh-pet-cfg__dialogActions',
                  children: [
                    h('button', {
                      key: 'c',
                      type: 'button',
                      className: 'dsh-pet-cfg__btn',
                      onClick: () => setEdit({ kind: 'idle' }),
                      children: t('cancel'),
                    }),
                    h('button', {
                      key: 'ok',
                      type: 'button',
                      className: 'dsh-pet-cfg__btn is-primary',
                      onClick: () => confirmMove(edit.which, edit.target),
                      children: t('fsLocationChange'),
                    }),
                  ],
                }),
              ],
            }),
          })
        : null;

    /** 手输路径：无图形环境时的兜底，永远可达。 */
    const manualNode =
      edit.kind === 'manual'
        ? h('div', {
            key: 'manual',
            className: 'dsh-pet-cfg__path',
            children: [
              h('input', {
                key: 'i',
                type: 'text',
                className: 'dsh-pet-cfg__inp',
                value: edit.text,
                placeholder: t('fsLocationManual'),
                style: { minWidth: '260px' },
                onChange: (e: ReactNS.ChangeEvent<HTMLInputElement>) =>
                  setEdit({
                    kind: 'manual',
                    which: edit.which,
                    text: e.target.value,
                    ...(edit.message === undefined ? {} : { message: edit.message }),
                  }),
              }),
              h('button', {
                key: 'ok',
                type: 'button',
                className: 'dsh-pet-cfg__btn is-sm is-primary',
                disabled: edit.text.trim() === '',
                onClick: () => setEdit({ kind: 'confirm', which: edit.which, target: edit.text.trim() }),
                children: t('ok'),
              }),
              h('button', {
                key: 'c',
                type: 'button',
                className: 'dsh-pet-cfg__btn is-sm',
                onClick: () => setEdit({ kind: 'idle' }),
                children: t('cancel'),
              }),
              edit.message === undefined
                ? null
                : h('span', { key: 'm', className: 'dsh-pet-cfg__treeDesc', children: edit.message }),
            ],
          })
        : null;

    /** 进度 / 结论行：搬家中、搬完（带重启）、失败（带原因）。 */
    const progressNode =
      edit.kind === 'moving'
        ? h('div', {
            key: 'move',
            className: 'dsh-pet-cfg__note is-tight',
            children: [t('fsLocationMoving').replace('{to}', edit.target)],
          })
        : edit.kind === 'done'
          ? h('div', {
              key: 'move',
              className: 'dsh-pet-cfg__path',
              children: [
                h('b', { key: 'b', children: t('fsLocationDone').replace('{to}', edit.target) }),
                h('span', { key: 'n', className: 'dsh-pet-cfg__treeDesc', children: t('fsLocationNeedsRestart') }),
                h('button', {
                  key: 'r',
                  type: 'button',
                  className: 'dsh-pet-cfg__btn is-sm is-primary',
                  onClick: restart,
                  children: t('fsLocationRestart'),
                }),
              ],
            })
          : edit.kind === 'failed'
            ? note(t('fsLocationFailed').replace('{reason}', edit.message), true)
            : null;

    const body = [
      section(t('fsRoot'), [
        locationRow('root', paths.root, t('fsRootHint'), 'root', rootSource, () => beginEdit('root')),
      ]),
      section(t('fsSkin'), [
        locationRow('skin', paths.skin ?? '', t('fsSkinHint'), 'skin', undefined, () => beginEdit('skin')),
      ]),
      progressNode,
      manualNode,
      section(t('fsTree'), [
        h('div', { key: 'tree', className: 'dsh-pet-cfg__tree', children: tree }),
        // 包内只读参考单独起一行小标：它们也在插件包里、不在数据根下，
        // 混进同一棵树会让「哪个是我的、哪个别动」变糊。
        note(t('fsReadonly'), true),
        h('div', { key: 'pkg', className: 'dsh-pet-cfg__tree', children: readonlyRows }),
        note(t('fsTreeHint'), true),
      ]),
      section(t('fsRuntime'), [
        h('div', {
          key: 'rt',
          className: 'dsh-pet-cfg__path',
          children: [
            h('b', { key: 's', children: runtimeText }),
            h('span', { key: 'src', className: 'dsh-pet-cfg__treeDesc', children: runtimeSource }),
            h(FolderButton, { key: 'o', which: 'runtime' }),
            h('button', {
              key: 'p',
              type: 'button',
              className: 'dsh-pet-cfg__btn is-sm',
              disabled: busy,
              onClick: chooseRuntimeDir,
              children: t('fsRuntimePick'),
            }),
            h('button', {
              key: 'd',
              type: 'button',
              className: 'dsh-pet-cfg__btn is-sm' + (installed ? '' : ' is-primary'),
              disabled: busy || downloading,
              onClick: download,
              children: installed ? t('fsRuntimeRedownload') : t('fsRuntimeDownload'),
            }),
            // 只有真的指到别处时才给「回到默认位置」：默认位置的人不需要这个按钮。
            status?.source === 'custom'
              ? h('button', {
                  key: 'r',
                  type: 'button',
                  className: 'dsh-pet-cfg__btn is-sm',
                  disabled: busy,
                  onClick: resetDir,
                  children: t('fsRuntimeReset'),
                })
              : null,
          ],
        }),
        downloading
          ? h('div', {
              key: 'prog',
              className: 'dsh-pet-cfg__note is-tight',
              children: [
                humanBytes(runtime?.download?.doneBytes ?? 0) +
                  ' / ' +
                  humanBytes(runtime?.download?.totalBytes ?? 0) +
                  ' · ' +
                  downloadPercent +
                  '%' +
                  (hostOf(runtime?.download?.mirror) === ''
                    ? ''
                    : ' · ' + t('fsRuntimeMirror').replace('{host}', hostOf(runtime?.download?.mirror))),
              ],
            })
          : null,
        note(t('fsRuntimeHint'), true),
        error === null ? null : note(error, true),
      ]),
      section(t('uninstallTitle'), [
        note(t('uninstallStep1'), true),
        note(t('uninstallStep2'), true),
        h('div', {
          key: 'cmd',
          className: 'dsh-pet-cfg__cmd',
          children: t('uninstallCmd').replace(
            '{profile}',
            paths.profile === undefined || paths.profile === '' ? '<profile>' : paths.profile,
          ),
        }),
        note(t('uninstallStep3').replace('{root}', paths.root), true),
      ]),
    ];

    return h('div', {
      children: [
        foldCard({
          id: BODY_ID,
          title: t('fsTitle'),
          hint: t('fsHint'),
          body,
          open,
          onToggle: () => setOpen(!open),
        }),
        confirmNode,
      ],
    });
  };
}
