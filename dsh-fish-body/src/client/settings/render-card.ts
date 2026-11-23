/**
 * 渲染卡：「渲染方式 + 模型/皮肤」同一行 → 缺文件提示（含目录与缺哪个文件）→ 位置组 → 每渲染尺寸（折叠）。
 *
 * 写回仍走 `onChange({renderer}) / ({model}) / ({sizes}) / ({display|position|size|sizePercent})`，
 * 随底部栏 `PUT /config` 整包落盘；不复用 `/pet-renderer`、`/pet-model` 的即时写。
 * 缺什么文件、该放到哪个目录**只由宿主给**（`/skin/{root}/resources` 的 `dir` / `missingFiles`），
 * 客户端只做模板插值——池根一改，这一行就跟着说真话。
 * @module dsh-fish-body/src/client/settings/render-card
 */
import type { FunctionComponent } from 'react';
import type { Pet, RendererKind } from '../../shared/types.ts';
import { RENDERERS } from '../../shared/config.ts';
import type { DirtyQuery } from './dirty.ts';
import { makeFolderButton } from './folder-button.ts';
import { makePetFieldGroups, type PetPatch } from './pet-card-parts.ts';
import { makeSelect } from './panel/select.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';
import type { RenderResourcesState } from './use-render-resources.ts';

/** 折叠正文的 id。 */
const SIZES_BODY_ID = 'pet-cfg-render-sizes';

/** 渲染卡的输入。 */
export interface RenderCardProps {
  readonly pet: Pet;
  readonly petIndex: number;
  readonly busy: boolean;
  readonly dirty: DirtyQuery;
  /** 三桶清单与「重新扫描」。 */
  readonly resources: RenderResourcesState;
  readonly onChange: (patch: PetPatch) => void;
}

/**
 * 造渲染卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件。
 */
export function makeRenderCard(rt: SettingsRuntime): FunctionComponent<RenderCardProps> {
  const { h, t, useState } = rt;
  const Select = makeSelect(rt);
  const FolderButton = makeFolderButton(rt);
  const groups = makePetFieldGroups(rt);

  return function RenderCard(props: RenderCardProps) {
    const { pet, busy, dirty, resources } = props;
    const { cardHead, section, field, foldCard, pair } = makeUiKit({ h, t }, dirty);
    const [sizesOpen, setSizesOpen] = useState(false);
    const at = 'pets.' + props.petIndex;
    const renderer: RendererKind = pet.renderer ?? 'webm';
    const bucket = resources.resources?.renderers?.[renderer];
    const fields = { pet, busy, dirty, onChange: props.onChange, path: at };

    /** 模型/皮肤选项：按当前渲染方式取对应桶；webm 不适用（置灰并说明按动画池平铺）。 */
    const modelOptions =
      renderer === 'webm'
        ? []
        : // 选择器要「用户能选什么」：行目录 + 回落来源（`available`），只用 `items` 会把内置皮肤判成已失效。
          (bucket?.available ?? bucket?.items ?? []).map((item) => ({
            id: item.id,
            label: item.label + ' · ' + item.source,
          }));
    const currentModel = String(pet.model ?? '');
    if (renderer !== 'webm' && currentModel !== '' && !modelOptions.some((item) => item.id === currentModel)) {
      // 已失效：当前 model 不在清单里（皮肤被删了 / 池根改了）——插一条显式项，别让下拉显示成空。
      modelOptions.unshift({ id: currentModel, label: currentModel + ' · ' + t('renderModelStale') });
    }

    const missing = bucket !== undefined && bucket.status !== 'ok' ? bucket : null;

    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('renderCardTitle'), t('renderCardHint'), 'pets'),

        // 渲染方式 + 模型/皮肤：同一行（宽容器并排、窄容器堆叠）。
        pair(
          field(
            t('rendererLabel'),
            h(Select, {
              label: t('rendererLabel'),
              value: renderer,
              options: RENDERERS.map((r) => ({ id: r, label: t('renderer.' + r) })),
              disabled: busy,
              onChange: (id: string) => props.onChange({ renderer: id as RendererKind }),
            }),
            t('rendererHint'),
            at + '.renderer',
          ),
          field(
            t('renderModelLabel'),
            h(Select, {
              label: t('renderModelLabel'),
              value: renderer === 'webm' ? '' : currentModel,
              options: modelOptions,
              disabled: busy || renderer === 'webm',
              onChange: (id: string) => props.onChange({ model: id }),
            }),
            renderer === 'webm' ? t('renderModelWebmHint') : t('renderModelHint'),
            at + '.model',
          ),
        ),

        // 缺文件提示：目录与文件名都由宿主给，客户端只插值。
        missing === null
          ? null
          : h('div', {
              key: 'missing',
              className: 'dsh-pet-cfg__banner is-warn',
              children: [
                h('span', {
                  key: 'text',
                  children: t('renderMissingFiles')
                    .replace('{files}', missing.missingFiles.join('、'))
                    .replace('{path}', missing.dir),
                }),
                h('button', {
                  key: 'rescan',
                  type: 'button',
                  className: 'dsh-pet-cfg__btn is-sm',
                  disabled: resources.busy,
                  onClick: resources.reload,
                  children: t('renderRescan'),
                }),
                h(FolderButton, {
                  key: 'open',
                  which: ('pool-bucket-' + renderer) as never,
                  disabled: busy,
                }),
              ],
            }),

        section(t('secPosition'), [
          h('div', { key: 'display', className: 'dsh-pet-cfg__grid2', children: groups.display(fields) }),
          h('div', { key: 'pos', className: 'dsh-pet-cfg__grid3', children: groups.positions(fields) }),
        ]),

        // 每渲染尺寸：基准（画框宽 + 占屏比）+ 三档覆盖；等于基准即删键。
        foldCard({
          id: SIZES_BODY_ID,
          title: t('sizesTitle'),
          hint: t('sizeHint'),
          open: sizesOpen,
          onToggle: () => setSizesOpen(!sizesOpen),
          body: [
            h('div', {
              key: 'base',
              className: 'dsh-pet-cfg__grid2',
              children: [...groups.size(fields), ...groups.sizePercent(fields)],
            }),
            ...groups.sizeOverrides(fields),
          ],
        }),
      ],
    });
  };
}
