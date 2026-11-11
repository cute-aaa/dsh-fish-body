/**
 * 宠物卡的子部件：头像格，以及「身份」与「位置」两组字段。
 *
 * 从 pet-card 拆出来的唯一原因是那张卡超长；这些部件只被它使用，不与别处共享。
 * 字段补丁的形状定义在这里——补丁就是这些控件产生的。
 * @module dsh-pet/src/client/settings/pet-card-parts
 */
import type { ChangeEvent } from 'react';
import type { Corner, Pet, PetDisplay, RendererKind } from '../../shared/types.ts';
import { PET_DISPLAYS, RENDERERS } from '../../shared/config.ts';
import { SIZE_PERCENT_DEFAULT, SIZE_PERCENT_MIN } from '../../shared/pet-size.ts';
import type { SettingsRuntime } from './runtime.ts';
import { INPUT_CLASS, makeUiKit, numberInputProps } from './ui.ts';
import { makeSelect } from './panel/select.ts';

/** 宠物字段补丁：`position` 只带要改的子字段，其余字段走顶层。 */
export type PetPatch = Partial<Omit<Pet, 'position'>> & { position?: Partial<Pet['position']> };

/** 字段类部件的输入。 */
export interface PetFieldsProps {
  /** 当前选中的宠物（字段值的唯一来源）。 */
  readonly pet: Pet;
  /** 保存中或配置未就绪：全部控件禁用。 */
  readonly busy: boolean;
  /** 回传字段补丁。 */
  readonly onChange: (patch: PetPatch) => void;
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

/** 四个角落的固定顺序；文案走 `corner.<corner>`。 */
const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

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

/**
 * 造「名字 / 大小 / 屏幕宽度上限 / 显示位置」四格（2×2）。
 *
 * @param rt - 注入的 react 能力与翻译。
 * @returns 身份字段组件。
 */
export function makePetIdentityFields(rt: SettingsRuntime) {
  const { h, t } = rt;
  const { field, sizeControl } = makeUiKit({ h, t });
  const Select = makeSelect(rt);

  /** 宠物画框大小：滑块（SIZE_MIN~SIZE_MAX）+ 数字框，两处写同一个值。 */
  const sizeInput = (value: number, disabled: boolean, setter: (v: number) => void) =>
    sizeControl(value, disabled, setter, { 'aria-label': t('sizeLabel') });

  /** 百分比输入：默认 20；不设上限（超过 100 只在 size 也够大时才生效）。 */
  const percentInput = (value: number, disabled: boolean, setter: (v: number) => void) =>
    h('input', numberInputProps(value, setter, { min: String(SIZE_PERCENT_MIN), step: '1', disabled }));

  /** 四格各自成函数：都只读 props，拼在一起才是组件。 */
  const cells = (props: PetFieldsProps) => {
    const { pet, busy, onChange } = props;
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
      ),
      field(
        t('sizeLabel'),
        sizeInput(pet.size, busy, (v) => onChange({ size: v })),
        t('sizeHint'),
      ),
      field(
        t('sizePercentLabel'),
        percentInput(pet.sizePercent ?? SIZE_PERCENT_DEFAULT, busy, (v) => onChange({ sizePercent: v })),
        t('sizePercentHint'),
      ),
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
      ),
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
      ),
    ];
  };

  return function PetIdentityFields(props: PetFieldsProps) {
    return h('div', { className: 'dsh-pet-cfg__grid2', children: cells(props) });
  };
}

/**
 * 造「按渲染方式的大小」三格：每种素材一套画框宽度，留空 = 跟随上面的 `size`。
 *
 * 三种素材的人物占框比例不同（webm 只占中间 37.5%，方形画布几乎铺满），
 * 一个数字跨不过来——所以这里允许分开填，右键「大小」菜单写的是同一份字段。
 *
 * @param rt - 注入的 react 能力与翻译。
 * @returns 三格组件。
 */
export function makePetSizeFields(rt: Pick<SettingsRuntime, 'h' | 't'>) {
  const { h, t } = rt;
  const { field, sizeControl } = makeUiKit({ h, t });

  /**
   * 单格：滑块显示该渲染方式当前生效的宽度；拖成与 `size` 相同、或点「跟随默认」= 删掉覆盖。
   *
   * 为什么要那个按钮：滑块能给手感，却很难精准落回基准值（462 这类数字不是整十数），
   * 而「等于基准值即删除」的规则又不该逼用户去数字框里对齐——两个入口，一条规则。
   */
  const cell = (props: PetFieldsProps, renderer: RendererKind) => {
    const base = props.pet.size;
    const own = props.pet.sizes?.[renderer];
    const write = (v: number): void => {
      const next = { ...(props.pet.sizes ?? {}) };
      if (v === base || v <= 0) delete next[renderer];
      else next[renderer] = v;
      props.onChange({ sizes: next });
    };
    const label = t('sizesOf').replace('{renderer}', t('renderer.' + renderer));
    return field(
      label,
      h('div', {
        className: 'dsh-pet-cfg__sizeCell',
        children: [
          sizeControl(own ?? base, props.busy, write, { 'aria-label': label }),
          own === undefined
            ? null
            : h('button', {
                key: 'follow',
                type: 'button',
                className: 'dsh-pet-cfg__btn is-sm',
                disabled: props.busy,
                onClick: () => write(base),
                children: t('sizeFollowDefault'),
              }),
        ],
      }),
    );
  };

  return function PetSizeFields(props: PetFieldsProps) {
    return h('div', { className: 'dsh-pet-cfg__grid3', children: RENDERERS.map((r) => cell(props, r)) });
  };
}

/**
 * 造「角落 / 水平偏移 / 垂直偏移」三格。
 *
 * @param rt - 注入的 react 能力与翻译。
 * @returns 位置字段组件。
 */
export function makePetPositionFields(rt: SettingsRuntime) {
  const { h, t } = rt;
  const { field } = makeUiKit({ h, t });
  const Select = makeSelect(rt);

  /** 偏移量输入：步长 1，不设上下限（可为任意数字）。 */
  const marginInput = (value: number, disabled: boolean, setter: (v: number) => void) =>
    h('input', numberInputProps(value, setter, { step: '1', min: '', disabled }));

  return function PetPositionFields(props: PetFieldsProps) {
    const { pet, busy, onChange } = props;
    return h('div', {
      className: 'dsh-pet-cfg__grid3',
      children: [
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
        ),
        field(
          t('marginX'),
          marginInput(pet.position.marginX, busy, (v) => onChange({ position: { marginX: v } })),
          t('marginXHint'),
        ),
        field(
          t('marginY'),
          marginInput(pet.position.marginY, busy, (v) => onChange({ position: { marginY: v } })),
          t('marginYHint'),
        ),
      ],
    });
  };
}
