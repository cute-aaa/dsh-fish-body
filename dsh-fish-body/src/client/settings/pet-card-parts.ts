/**
 * 宠物卡的字段组：身份（名字 / 大小）、显示（位置 / 渲染方式 / 屏宽上限）、
 * 位置（角落与偏移）、按渲染方式的尺寸覆盖。
 *
 * 每组返回「若干格」而不是一整块 DOM：由 `pet-card` 决定放进哪个栅格、哪一段小节，
 * 这样加一格字段只动这里，改版式只动那张卡。补丁形状也定义在这里——补丁就是这些控件产生的。
 * 每个字段的说明都挂悬浮气泡（`data-tip`），卡头保留整卡语境的问号。
 * @module dsh-fish-body/src/client/settings/pet-card-parts
 */
import type { ChangeEvent } from 'react';
import type { jsx } from 'react/jsx-runtime';
import type { Corner, Pet, PetDisplay, RendererKind } from '../../shared/types.ts';
import { PET_DISPLAYS, RENDERERS } from '../../shared/config.ts';
import { SIZE_PERCENT_DEFAULT, SIZE_PERCENT_MIN } from '../../shared/pet-size.ts';
import type { DirtyQuery } from './dirty.ts';
import { makeSelect } from './panel/select.ts';
import type { SettingsRuntime } from './runtime.ts';
import { INPUT_CLASS, makeUiKit, numberInputProps } from './ui.ts';

/** 宠物字段补丁：`position` 只带要改的子字段，其余字段走顶层。 */
export type PetPatch = Partial<Omit<Pet, 'position'>> & { position?: Partial<Pet['position']> };

/** 字段组件的输入。 */
export interface PetFieldsProps {
  /** 当前选中的宠物（字段值的唯一来源）。 */
  readonly pet: Pet;
  /** 保存中或配置未就绪：全部控件禁用。 */
  readonly busy: boolean;
  /** 回传字段补丁。 */
  readonly onChange: (patch: PetPatch) => void;
  /** 这只宠物在快照里的路径前缀（`pets.<下标>`）：每个字段用它拼自己的改动路径。 */
  readonly path: string;
  /** 未保存改动查询口：改动的那一格自己亮圆点。 */
  readonly dirty: DirtyQuery;
}

/** 四个角落的固定顺序；文案走 `corner.<corner>`。 */
const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

/** 一组字段：调用即得到若干格（已翻译、已绑定回调），由调用方摆进栅格。 */
export interface PetFieldGroups {
  /** 名字与画框大小：这一页最常改的两项。 */
  identity(props: PetFieldsProps): ReturnType<typeof jsx>[];
  /** 渲染方式（「外观与手感」的渲染卡第一行左半）。 */
  renderer(props: PetFieldsProps): ReturnType<typeof jsx>[];
  /** 显示位置（web / desktop / both / none）。 */
  display(props: PetFieldsProps): ReturnType<typeof jsx>[];
  /** 人物占屏宽上限（百分比）。 */
  sizePercent(props: PetFieldsProps): ReturnType<typeof jsx>[];
  /** 画框宽度（渲染卡的尺寸折叠里作「基准」）。 */
  size(props: PetFieldsProps): ReturnType<typeof jsx>[];
  /** 角落、水平偏移与垂直偏移。 */
  positions(props: PetFieldsProps): ReturnType<typeof jsx>[];
  /** 每种渲染方式各自的画框宽度（留空 = 跟随 `size`）。 */
  sizeOverrides(props: PetFieldsProps): ReturnType<typeof jsx>[];
}

/**
 * 造宠物卡的字段组。
 *
 * @param rt - 注入的节点工厂、状态与翻译。
 * @returns 四组字段的渲染函数。
 */
export function makePetFieldGroups(rt: SettingsRuntime): PetFieldGroups {
  const { h, t } = rt;
  const Select = makeSelect(rt);

  /**
   * 每组自己的小件集合：`field` 要拿到本页的改动查询口才能标「这一格改过」。
   *
   * 每次调用现造一份没有任何开销（全是闭包，不产生新组件类型），
   * 所以 `Select` 这类**组件**放在工厂里建一次，样式小件随查询口走。
   */
  const kitOf = (dirty: DirtyQuery) => makeUiKit({ h, t }, dirty);

  /** 百分比输入：默认 20；不设上限（超过 100 只在 size 也够大时才生效）。 */
  const percentInput = (value: number, disabled: boolean, setter: (v: number) => void) =>
    h('input', numberInputProps(value, setter, { min: String(SIZE_PERCENT_MIN), step: '1', disabled }));

  /** 偏移量输入：步长 1，不设上下限（可为任意数字）。 */
  const marginInput = (value: number, disabled: boolean, setter: (v: number) => void) =>
    h('input', numberInputProps(value, setter, { step: '1', min: '', disabled }));

  return {
    identity: ({ pet, busy, onChange, path, dirty }) => {
      const { field, sizeControl } = kitOf(dirty);
      const sizeInput = (value: number, disabled: boolean, setter: (v: number) => void) =>
        sizeControl(value, disabled, setter, { 'aria-label': t('sizeLabel') });
      return [
        field(
          t('nameLabel'),
          h('input', {
            type: 'text',
            className: INPUT_CLASS,
            value: String(pet.name ?? ''),
            disabled: busy,
            maxLength: 50,
            onChange: (e: ChangeEvent<HTMLInputElement>) => onChange({ name: e.target.value }),
          }),
          t('nameHint'),
          path + '.name',
        ),
        field(
          t('sizeLabel'),
          sizeInput(pet.size, busy, (v) => onChange({ size: v })),
          t('sizeHint'),
          path + '.size',
        ),
      ];
    },

    renderer: ({ pet, busy, onChange, path, dirty }) => {
      const { field } = kitOf(dirty);
      return [
        field(
          t('rendererLabel'),
          h(Select, {
            label: t('rendererLabel'),
            value: pet.renderer ?? 'webm',
            options: RENDERERS.map((r) => ({ id: r, label: t('renderer.' + r) })),
            disabled: busy,
            onChange: (id: string) => onChange({ renderer: id as RendererKind }),
          }),
          t('rendererHint'),
          path + '.renderer',
        ),
      ];
    },

    display: ({ pet, busy, onChange, path, dirty }) => {
      const { field } = kitOf(dirty);
      return [
        field(
          t('displayLabel'),
          h(Select, {
            label: t('displayLabel'),
            value: pet.display,
            options: PET_DISPLAYS.map((d) => ({ id: d, label: t('display.' + d) })),
            disabled: busy,
            onChange: (id: string) => onChange({ display: id as PetDisplay }),
          }),
          t('displayHint'),
          path + '.display',
        ),
      ];
    },

    sizePercent: ({ pet, busy, onChange, path, dirty }) => {
      const { field } = kitOf(dirty);
      return [
        field(
          t('sizePercentLabel'),
          percentInput(pet.sizePercent ?? SIZE_PERCENT_DEFAULT, busy, (v) => onChange({ sizePercent: v })),
          t('sizePercentHint'),
          path + '.sizePercent',
        ),
      ];
    },

    size: ({ pet, busy, onChange, path, dirty }) => {
      const { field, sizeControl } = kitOf(dirty);
      return [
        field(
          t('sizeLabel'),
          sizeControl(pet.size, busy, (v) => onChange({ size: v }), { 'aria-label': t('sizeLabel') }),
          t('sizeHint'),
          path + '.size',
        ),
      ];
    },

    positions: ({ pet, busy, onChange, path, dirty }) => {
      const { field } = kitOf(dirty);
      return [
        field(
          t('cornerLabel'),
          h(Select, {
            label: t('cornerLabel'),
            value: pet.position.corner,
            options: CORNERS.map((c) => ({ id: c, label: t('corner.' + c) })),
            disabled: busy,
            onChange: (id: string) => onChange({ position: { corner: id as Corner } }),
          }),
          t('cornerHint'),
          path + '.position.corner',
        ),
        field(
          t('marginX'),
          marginInput(pet.position.marginX, busy, (v) => onChange({ position: { marginX: v } })),
          t('marginXHint'),
          path + '.position.marginX',
        ),
        field(
          t('marginY'),
          marginInput(pet.position.marginY, busy, (v) => onChange({ position: { marginY: v } })),
          t('marginYHint'),
          path + '.position.marginY',
        ),
      ];
    },

    sizeOverrides: ({ pet, busy, onChange, path, dirty }) => {
      const { field, sizeControl } = kitOf(dirty);
      return RENDERERS.map((renderer) => {
        const base = pet.size;
        const own = pet.sizes?.[renderer];
        const write = (v: number): void => {
          const next = { ...(pet.sizes ?? {}) };
          // 等于基准值即删除覆盖：滑块很难精准落回 462 这种数，规则由「跟随默认」按钮补一个入口。
          if (v === base || v <= 0) delete next[renderer];
          else next[renderer] = v;
          onChange({ sizes: next });
        };
        const label = t('sizesOf').replace('{renderer}', t('renderer.' + renderer));
        return field(
          label,
          h('div', {
            className: 'dsh-pet-cfg__sizeRow',
            children: [
              sizeControl(own ?? base, busy, write, { 'aria-label': label }),
              own === undefined
                ? null
                : h('button', {
                    key: 'follow',
                    type: 'button',
                    className: 'dsh-pet-cfg__btn is-sm',
                    disabled: busy,
                    onClick: () => write(base),
                    children: t('sizeFollowDefault'),
                  }),
            ],
          }),
          own === undefined ? undefined : t('sizeFollowDefault'),
          path + '.sizes.' + renderer,
        );
      });
    },
  };
}

/** 头像格的输入。 */
export interface PetAvatarCellProps {
  /** 预览地址（已带破缓存版本号）。 */
  readonly avatarSrc: string;
  /** 头像正在上传：遮罩常显且文件框禁用。 */
  readonly avatarBusy: boolean;
  /** 表单整体忙：同样禁用文件框。 */
  readonly busy: boolean;
  /** 选中新头像；`undefined` = 内置条目，只显示图、不可点。 */
  readonly onAvatar: ((file: File) => void) | undefined;
}

/**
 * 造头像格：可换时整块就是按钮（悬浮出遮罩、点它开文件框），内置条目只有图。
 *
 * @param rt - 注入的节点工厂与翻译。
 * @returns 头像格组件。
 */
export function makePetAvatarCell(rt: Pick<SettingsRuntime, 'h' | 't'>) {
  const { h, t } = rt;
  // 说明走页面自己的气泡层（data-tip），不用原生 title：title 会另起一个不可控的浏览器浮框。
  const { tip } = makeUiKit({ h, t });

  /** 头像图：两条分支共用同一份属性。 */
  const image = (src: string) =>
    h('img', { className: 'dsh-pet-cfg__avatarImg', src, alt: t('avatarLabel'), loading: 'lazy' });

  return function PetAvatarCell(props: PetAvatarCellProps) {
    if (props.onAvatar === undefined) {
      return h('div', { className: 'dsh-pet-cfg__avatarCol', children: image(props.avatarSrc) });
    }
    return h('div', {
      className: 'dsh-pet-cfg__avatarCol',
      children: h('div', {
        className: 'dsh-pet-cfg__avatarPick',
        ...tip(t('avatarHint')),
        children: [
          image(props.avatarSrc),
          h('span', {
            key: 'mask',
            className: 'dsh-pet-cfg__avatarMask' + (props.avatarBusy ? ' is-busy' : ''),
            children: props.avatarBusy ? t('avatarUploading') : t('avatarChange'),
          }),
          h('input', {
            key: 'file',
            className: 'dsh-pet-cfg__file',
            type: 'file',
            accept: 'image/png,image/jpeg,image/webp,image/gif',
            disabled: props.avatarBusy || props.busy,
            'aria-label': t('avatarUpload'),
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const file = e.target.files?.[0];
              if (file !== undefined) props.onAvatar?.(file);
              e.target.value = '';
            },
          }),
        ],
      }),
    });
  };
}
