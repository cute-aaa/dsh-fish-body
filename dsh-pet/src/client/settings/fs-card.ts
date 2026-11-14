/**
 * 「文件与目录」卡：数据根、目录树、运行时与卸载，一张卡讲完「我的东西在哪」。
 *
 * 为什么只有一张卡：位置、可删性、卸载本来是同一个问题的三个答案。拆成「高级配置」+「卸载与存储」
 * 两张折叠卡时，用户要在两处之间来回对路径，而两条清单里的父目录与子目录还各列一遍（去重前）。
 * 现在树是唯一表达：一条路径只出现一次，能不能删用徽标说，卸载步骤沉到卡底。
 *
 * 树由宿主生成（`GET /config/meta` 的 `layout` / `readonly`）：客户端不拼任何路径字面量，
 * 只按 `depth` 画 `├─ / └─`。这样目录布局怎么改，卡片都不用动。
 *
 * 运行时那一节是唯一带动作的：Electron 不在 cache 里（删 cache 不该逼用户重下 350 MB），
 * 所以「有没有装 / 装在哪 / 现在装」必须能在这里看见并触发。
 * @module dsh-fish-body/src/client/settings/fs-card
 */
import type { FunctionComponent } from 'react';
import type { ConfigMeta, MetaNode, RuntimeStatus } from './config/http.ts';
import { makeFolderButton } from './folder-button.ts';
import { fetchRuntime, startRuntimeDownload } from './runtime-api.ts';
import type { SettingsRuntime } from './runtime.ts';
import { treePrefixes } from './tree.ts';
import { MONO_STACK, makeUiKit } from './ui.ts';

/** 卡片的输入：宿主给的那一份元信息。 */
export interface FsCardProps {
  /** 数据根、树、只读参考与运行时状态。 */
  readonly paths: ConfigMeta;
}

/** 折叠正文的 id：与卡头按钮的 `aria-controls` 成对。 */
const BODY_ID = 'pet-cfg-paths-fs';

/** 下载轮询间隔：一次下载几分钟，2.5s 足够让「正在下载」看起来是活的。 */
const POLL_MS = 2500;

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

  /** 一行树节点：前缀 + 名字 + 徽标 + 「打开」。 */
  const row = (node: MetaNode, prefix: string, badgeText?: string) =>
    h('div', {
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
        badgeText === undefined
          ? null
          : h('span', {
              key: 'b',
              className: 'dsh-pet-cfg__treeBadge is-' + String(node.badge ?? node.kind),
              children: badgeText,
            }),
        node.open === undefined ? null : h(FolderButton, { key: 'o', which: node.open }),
      ],
    });

  return function FsCard(props: FsCardProps) {
    const { paths } = props;
    const [open, setOpen] = useState(false);
    const [runtime, setRuntime] = useState<RuntimeStatus | undefined>(paths.runtime);
    const [busy, setBusy] = useState(false);
    const [polling, setPolling] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 轮询：点了下载之后每 2.5s 问一次，装好就停。effect 里建 timer、清理里拆，
    // 切分区 / 关设置页都不会留下一个还在 setState 的定时器。
    useEffect(() => {
      if (!polling) return;
      let alive = true;
      const timer = setInterval(() => {
        void fetchRuntime().then((next) => {
          if (!alive || next === undefined) return;
          setRuntime(next);
          if (next.installed) {
            setPolling(false);
            setBusy(false);
          }
        });
      }, POLL_MS);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, [polling]);

    /** 点「下载运行时」：起一次下载，然后靠轮询看结果。 */
    const download = (): void => {
      setBusy(true);
      setError(null);
      void startRuntimeDownload().then((outcome) => {
        if (outcome.runtime !== undefined) setRuntime(outcome.runtime);
        if (outcome.installed) {
          setBusy(false);
          return;
        }
        // `started: false` 也可能是「上一次还在下」：照样轮询，别让按钮点了没反应。
        setPolling(true);
      });
    };

    // 防御：meta 形状不对（老宿主 / 半升级）时按空树渲染，不让一张卡把整个设置页带崩。
    const layout = Array.isArray(paths.layout) ? paths.layout : [];
    const prefixes = treePrefixes(layout);
    const tree = layout.map((node, index) =>
      row(
        node,
        prefixes[index] ?? '',
        node.badge === 'disposable'
          ? t('fsBadgeDisposable')
          : node.badge === 'download'
            ? t('fsBadgeDownload')
            : undefined,
      ),
    );
    const readonly = Array.isArray(paths.readonly) ? paths.readonly : [];
    const readonlyRows = readonly.map((node, index) =>
      row(node, index === readonly.length - 1 ? '└─ ' : '├─ ', t('fsBadgeReadonly')),
    );

    const installed = runtime?.installed === true;
    const runtimeText = installed
      ? t('fsRuntimeReady') + (runtime?.version === undefined ? '' : ' v' + runtime.version)
      : t('fsRuntimeMissing');

    const body = [
      section(t('fsRoot'), [
        h('div', {
          key: 'root',
          className: 'dsh-pet-cfg__path',
          children: [
            h('b', { key: 'p', style: { fontFamily: MONO_STACK }, children: paths.root }),
            h(FolderButton, { key: 'o', which: 'root' }),
          ],
        }),
        note(t('fsRootHint'), true),
      ]),
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
            h('b', { key: 's', children: busy ? t('fsRuntimeDownloading') : runtimeText }),
            h(FolderButton, { key: 'o', which: 'runtime' }),
            h('button', {
              key: 'd',
              type: 'button',
              className: 'dsh-pet-cfg__btn is-sm',
              disabled: busy || installed,
              onClick: download,
              children: t('fsRuntimeDownload'),
            }),
          ],
        }),
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

    return foldCard({
      id: BODY_ID,
      title: t('fsTitle'),
      hint: t('fsHint'),
      body,
      open,
      onToggle: () => setOpen(!open),
    });
  };
}
