/**
 * 渲染卡下方三行皮肤目录：`layered` / `live2d` / `webm` 的存在性、资源数、打开文件夹。
 *
 * 路径与「缺哪个文件」**只来自宿主**（`/skin/{root}/resources` 的 `dir` / `missingFiles`），
 * 客户端不拼目录名——池根被 `assets.pool` 指到别处（含绝对路径）时这三行照样说真话。
 * 说明文案走自己的 `renderDir.*` 键，不塞进 `tree-notes`（那张表按 `/config/meta` 的节点 key 索引）。
 * @module dsh-fish-body/src/client/settings/skin-dirs
 */
import type { FunctionComponent } from 'react';
import type { RendererKind } from '../../shared/types.ts';
import { makeFolderButton } from './folder-button.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeTreeRow } from './tree-row.ts';
import { makeUiKit } from './ui.ts';
import type { RenderResourcesState } from './use-render-resources.ts';

/** 三行的固定顺序与目录前缀。 */
const ROWS: readonly { renderer: RendererKind; prefix: string }[] = [
  { renderer: 'layered', prefix: '├─ ' },
  { renderer: 'live2d', prefix: '├─ ' },
  { renderer: 'webm', prefix: '└─ ' },
];

/** 皮肤目录三行的输入。 */
export interface SkinDirsProps {
  /** 三桶清单与重新扫描。 */
  readonly resources: RenderResourcesState;
  readonly busy: boolean;
}

/**
 * 造皮肤目录三行。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件。
 */
export function makeSkinDirs(rt: SettingsRuntime): FunctionComponent<SkinDirsProps> {
  const { h, t } = rt;
  const FolderButton = makeFolderButton(rt);
  const TreeRow = makeTreeRow(rt);

  return function SkinDirs(props: SkinDirsProps) {
    const { resources, busy } = props;
    const { cardHead } = makeUiKit({ h, t });
    const list = resources.resources?.renderers;

    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(
          t('skinDirsTitle'),
          t('skinDirsHint'),
          undefined,
          h(FolderButton, { key: 'root', which: 'skin-root', disabled: busy }),
        ),
        ...ROWS.map(({ renderer, prefix }) => {
          const bucket = list?.[renderer];
          const status = bucket?.status ?? 'missing';
          const missingFiles = bucket?.missingFiles ?? [];
          // 缺失行把「缺什么」与 expect 清单都写进行内正文（不只塞 title）：窄屏与触摸设备看不到悬浮提示。
          const expected = missingFiles.length > 0 ? missingFiles : (bucket?.expect ?? []);
          // 行名写成 skin/<渲染方式>：路径由宿主给（用户皮肤目录），但用户第一眼要看出这是 skin/ 下的哪一类。
          const label = 'skin/' + renderer;
          const count = label + ' · ' + t('skinDirsCount').replace('{n}', String(bucket?.count ?? 0));
          const expectText =
            expected.length === 0 ? '' : ' · ' + t('skinDirsExpect').replace('{list}', expected.join('、'));
          // 「目录不在」（missing）与「目录在、没资源」（empty）是两件事：文案、徽标、行样式都分开。
          const detail =
            status === 'ok'
              ? count
              : status === 'empty'
                ? label + ' · ' + t('skinDirsEmpty') + expectText
                : label + ' · ⚠️ ' + t('skinDirsMissing').replace('{file}', expected.join('、')) + expectText;
          const badge =
            status === 'empty' ? t('skinDirsBadgeEmpty') : status === 'missing' ? t('skinDirsBadgeMissing') : undefined;
          return TreeRow({
            key: renderer,
            prefix,
            name: renderer + '/',
            path: bucket?.dir ?? '',
            desc: detail,
            ...(badge === undefined ? {} : { badgeText: badge }),
            keepOpenWithBadge: true,
            exists: status !== 'missing',
            open: h(FolderButton, { key: 'open', which: ('pool-bucket-' + renderer) as never, disabled: busy }),
          });
        }),
      ],
    });
  };
}
