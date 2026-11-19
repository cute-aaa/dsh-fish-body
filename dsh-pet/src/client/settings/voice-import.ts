/**
 * 音色导入：GSV 接入卡里的「导入音色…」按钮与它打开的弹窗。
 *
 * 流程只有三步，用户只做一个决定：
 * 1. 选一次目录（`GPT_weights*` / `SoVITS_weights*` 所在的那一层）——宿主展开两侧、按文件名配对；
 * 2. 在清单里逐个勾选、挑参考音频与参考文本、选「引用（硬链接）」或「复制」；
 * 3. 点「开始导入」——先整批只读预检（有一条不合法就一条都不写），再批量落盘。
 *
 * 为什么不再有常驻表单：「配一个音色」是一次性动作，常驻六格表单只会让语音分区永远横着它。
 * 为什么勾选才可编辑：清单可能十几行，没勾的行不该抢走注意力，也不该被误导入。
 * 为什么「引用」会置灰：硬链接要求权重与音色包目录同一分区，跨盘必然失败——界面上挡住，
 * 比让用户点一次再读一条 `EXDEV` 报错省事。跨盘时默认改「复制」并标出体积。
 * @module dsh-fish-body/src/client/settings/voice-import
 */
import type { FunctionComponent } from 'react';
import {
  readTextLines,
  readVoicePackBatch,
  readVoicePackPreviews,
  readWeightImportScan,
  type PackErrorView,
  type PlacementView,
  type TextLineView,
  type VoicePackApplyView,
  type WeightImportCandidateView,
  type WeightImportScanView,
} from '../../shared/voice-pack.ts';
import type { SettingsRuntime } from './runtime.ts';
import { INPUT_CLASS, makeUiKit } from './ui.ts';
import { pickFile, pickFolder } from './layout-api.ts';
import { postJson, rescanVoiceProvider } from './voice-api.ts';

/** 「导入音色…」按钮（卡里那一段）的输入。 */
export interface VoiceImportRowProps {
  /** 设置页正忙（保存中）。 */
  readonly busy: boolean;
  /** 打开导入弹窗。 */
  readonly onOpen: () => void;
  /** 重新扫描之后刷新音色下拉与右键菜单。 */
  readonly onScanned: () => void;
}

/** 导入弹窗的输入。 */
export interface VoiceImportDialogProps {
  /** 是否打开；`false` 时组件返回 `null`。 */
  readonly open: boolean;
  /** 设置页正忙（保存中）。 */
  readonly busy: boolean;
  /** 「音色包目录」的当前草稿（只用来提前提示「还没保存」）。 */
  readonly draftVoicesDir: string;
  readonly onClose: () => void;
  /** 导入成功后刷新音色清单（下拉与右键菜单要马上看到新嗓子）。 */
  readonly onRefresh: () => void;
}

/** 参考音频认的扩展名。 */
const AUDIO_EXTS: readonly string[] = ['.wav', '.mp3', '.flac', '.ogg', '.m4a'];
/** 参考文本候选文件扩展名。 */
const TEXT_EXTS: readonly string[] = ['.txt', '.list'];

/** 一行在界面里的编辑态。 */
export interface ImportRowState {
  readonly checked: boolean;
  /** 选中的 GPT 权重（空串 = 这行没有 GPT）。 */
  readonly gpt: string;
  /** 选中的 SoVITS 权重。 */
  readonly sovits: string;
  readonly refAudioPath: string;
  readonly refText: string;
  readonly placement: PlacementView;
}

/** 路径最后一段（清单里显示文件名，不铺整条绝对路径）。 */
function baseNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** 字节数 → 人看的大小。 */
function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * 一条候选的默认编辑态：不勾选；跨盘默认「复制」，同盘默认「引用」。
 *
 * 导出是为了单测：跨盘时「引用」必须置灰（宿主硬链接必失败），默认值就该是复制——
 * 这条判断不该藏在组件闭包里。
 *
 * @param candidate - 宿主给的一行候选。
 * @returns 初始编辑态。
 */
export function rowStateOf(candidate: WeightImportCandidateView): ImportRowState {
  return {
    checked: false,
    gpt: candidate.gptPath ?? '',
    sovits: candidate.sovitsPath ?? '',
    refAudioPath: '',
    refText: '',
    placement: candidate.linkable ? 'hardlink' : 'copy',
  };
}

/**
 * 勾选行 → 请求条目。
 *
 * 有 GPT 就以 GPT 为锚点、SoVITS 放 `counterpartPath`；只有一侧时另一侧留空，
 * 宿主据此写「缺另一侧」音色（导入后置灰，补上再导一次）。
 *
 * @param selected - 勾选的候选（顺序即请求顺序）。
 * @param rows - 各行的编辑态。
 * @param overwrite - 是否覆盖已有参考。
 * @returns 逐条请求体（含 `provider`）。
 */
export function buildImportItems(
  selected: readonly WeightImportCandidateView[],
  rows: Readonly<Record<string, ImportRowState>>,
  overwrite: boolean,
): Record<string, unknown>[] {
  return selected.map((candidate) => {
    const row = rows[candidate.id];
    const gpt = row?.gpt ?? '';
    const sovits = row?.sovits ?? '';
    return {
      provider: 'gsv',
      weightPath: gpt !== '' ? gpt : sovits,
      counterpartPath: gpt !== '' && sovits !== '' ? sovits : '',
      refAudioPath: row?.refAudioPath ?? '',
      refText: row?.refText ?? '',
      id: candidate.id,
      placement: row?.placement ?? 'hardlink',
      overwrite,
    };
  });
}

/**
 * 造「导入音色…」这一段：两个按钮（导入 / 扫描）+ 一句说明 + 音色包目录的结构说明。
 *
 * 结构说明放在这里而不是只塞进字段气泡：气泡要悬浮才看得见，而「这个目录里到底放什么」
 * 是用户点导入之前最需要先建立的模型。
 * 扫描按钮存在的意义：音色包目录里的文件是用户在磁盘上直接加删的，宿主侧的扫描结果有软过期，
 * 不主动重扫就要等 TTL 到点才看得见新嗓子。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 带扫描状态的卡内片段。
 */
export function makeVoiceImportRow(rt: SettingsRuntime): FunctionComponent<VoiceImportRowProps> {
  const { h, t, useState } = rt;

  /** 一行结构说明：前缀 + 名字 + 说明。 */
  const treeRow = (prefix: string, name: string, desc: string) =>
    h('div', {
      key: name,
      className: 'dsh-pet-cfg__treeRow',
      children: [
        h('span', { key: 'p', className: 'dsh-pet-cfg__treePrefix', children: prefix }),
        h('span', { key: 'n', className: 'dsh-pet-cfg__treeName', children: name }),
        h('span', { key: 'd', className: 'dsh-pet-cfg__treeDesc', children: desc }),
      ],
    });

  return function VoiceImportRow(props: VoiceImportRowProps) {
    const [scanning, setScanning] = useState(false);
    const [message, setMessage] = useState('');

    /** 重新扫描音色包目录：宿主丢缓存重扫，再把结论写成一行的结果。 */
    const runScan = (): void => {
      setScanning(true);
      setMessage('');
      void rescanVoiceProvider('gsv', t('voiceScanFailed'))
        .then((result) => {
          const done = t('voiceScanDone')
            .replace('{ready}', String(result.ready))
            .replace('{total}', String(result.total));
          // 一个都没扫到可合成音色时，把宿主给的第一条诊断接在后面：否则只剩一个 0，用户不知道差什么。
          const note = result.ready === 0 && result.notes.length > 0 ? ' · ' + result.notes[0] : '';
          setMessage(done + note);
          props.onScanned();
        })
        .catch((error: unknown) => setMessage('!' + (error instanceof Error ? error.message : String(error))))
        .finally(() => setScanning(false));
    };

    return h('div', {
      className: 'dsh-pet-cfg__section',
      children: [
        h('div', {
          key: 'row',
          className: 'dsh-pet-cfg__actions',
          children: [
            h('button', {
              key: 'open',
              type: 'button',
              className: 'dsh-pet-cfg__btn is-primary is-sm',
              disabled: props.busy,
              onClick: props.onOpen,
              children: t('voiceImportOpen'),
            }),
            h('button', {
              key: 'scan',
              type: 'button',
              className: 'dsh-pet-cfg__btn is-sm',
              disabled: props.busy || scanning,
              onClick: runScan,
              children: scanning ? t('voiceScanBusy') : t('voiceScan'),
            }),
            h('span', {
              key: 'hint',
              className: 'dsh-pet-cfg__msg',
              children: t('voiceImportHint'),
            }),
          ],
        }),
        message === ''
          ? null
          : h('div', {
              key: 'msg',
              className: 'dsh-pet-cfg__msg' + (message.startsWith('!') ? ' is-err' : ''),
              role: 'status',
              children: [message.replace(/^!/, '')],
            }),
        h('div', {
          key: 'treeTitle',
          className: 'dsh-pet-cfg__msg',
          children: t('voiceImportTreeTitle'),
        }),
        h('div', {
          key: 'tree',
          className: 'dsh-pet-cfg__tree',
          children: [
            treeRow('', '<id>/', t('voiceImportTreePack')),
            treeRow('├─ ', 'ref.wav', t('voiceImportTreeRef')),
            treeRow('├─ ', 'ref.txt', t('voiceImportTreeText')),
            // 两份权重是同级的两类文件，不是「任选其一写成同一个通配」：
            // .ckpt 是 GPT、.pth 是 SoVITS，缺哪一份这条音色就合成不出来。
            treeRow('├─ ', '*.ckpt', t('voiceImportTreeGpt')),
            treeRow('└─ ', '*.pth', t('voiceImportTreeSovits')),
          ],
        }),
      ],
    });
  };
}

/**
 * 造导入弹窗。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 弹窗组件；`open === false` 时不渲染。
 */
export function makeVoiceImportDialog(rt: SettingsRuntime): FunctionComponent<VoiceImportDialogProps> {
  const { h, t, useState } = rt;
  const { note } = makeUiKit({ h, t });

  return function VoiceImportDialog(props: VoiceImportDialogProps) {
    // 手输的根路径：原生选择框在某些环境里弹不出来（后台进程、剪贴板里已有路径），
    // 所以输入框是主入口，选择框只是「懒得打字」的快捷方式。
    const [rootDraft, setRootDraft] = useState('');
    const [scan, setScan] = useState<WeightImportScanView | null>(null);
    const [rows, setRows] = useState<Record<string, ImportRowState>>({});
    const [overwrite, setOverwrite] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [lines, setLines] = useState<readonly TextLineView[] | null>(null);
    const [lineTarget, setLineTarget] = useState('');
    const [results, setResults] = useState<readonly VoicePackApplyView[] | null>(null);
    const [errorIds, setErrorIds] = useState<readonly string[]>([]);

    if (!props.open) return null;

    const fail = (error: unknown): void => {
      setMessage('!' + (error instanceof Error ? error.message : String(error)));
    };

    /** 选根 → 宿主展开两侧权重并配对（手输与原生选择框共用这一条）。 */
    const loadRoot = (root: string): void => {
      if (root === '') {
        setMessage('!' + t('voiceImportRootEmpty'));
        return;
      }
      setRootDraft(root);
      setBusy(true);
      setMessage('');
      setResults(null);
      setErrorIds([]);
      void postJson('/voice/voice-pack', { provider: 'gsv', mode: 'weights', root }, 'scan')
        .then((result) => {
          const parsed = readWeightImportScan(result.scan);
          if (parsed === null) throw new Error(t('voiceImportScanInvalid'));
          const next: Record<string, ImportRowState> = {};
          for (const candidate of parsed.candidates) next[candidate.id] = rowStateOf(candidate);
          setScan(parsed);
          setRows(next);
        })
        .catch(fail)
        .finally(() => setBusy(false));
    };

    /**
     * 原生选择框：选到就立刻读；取消什么都不说（那是用户的决定）。
     *
     * 其余情况一定要说话——`unsupported` 与「宿主回了看不懂的东西」都曾表现为「点了没反应」，
     * 所以任何非 picked / 非 cancelled 的结论都落到一句可操作的提示上，并保留手输框。
     */
    const pickRoot = (): void => {
      void pickFolder(t('voiceImportPickRoot')).then((outcome) => {
        if (outcome.kind === 'picked') loadRoot(outcome.path);
        else if (outcome.kind === 'unsupported') setMessage('!' + (outcome.message || t('voiceImportPickUnsupported')));
      });
    };

    const setRow = (id: string, patch: Partial<ImportRowState>): void => {
      setRows((current) => {
        const row = current[id];
        return row === undefined ? current : { ...current, [id]: { ...row, ...patch } };
      });
      setResults(null);
    };

    const pickRef = (id: string): void => {
      void pickFile(t('voiceImportRef'), AUDIO_EXTS).then((outcome) => {
        if (outcome.kind === 'picked') setRow(id, { refAudioPath: outcome.path });
        else if (outcome.kind === 'unsupported')
          setMessage('!' + (outcome.message || t('voiceImportFilePickUnsupported')));
      });
    };

    /** 选一个文本文件，读成候选行；点其中一行填进该行。 */
    const pickLine = (id: string): void => {
      void pickFile(t('voiceImportText'), TEXT_EXTS).then((outcome) => {
        if (outcome.kind !== 'picked') {
          if (outcome.kind === 'unsupported')
            setMessage('!' + (outcome.message || t('voiceImportFilePickUnsupported')));
          return;
        }
        void postJson('/voice/text-lines', { path: outcome.path }, t('voiceImportLinesFailed'))
          .then((result) => {
            const parsed = readTextLines(result);
            if (parsed.length === 0) throw new Error(t('voiceImportLinesEmpty'));
            setLineTarget(id);
            setLines(parsed.slice(0, 20));
          })
          .catch(fail);
      });
    };

    const candidates = scan?.candidates ?? [];
    const checked = candidates.filter((candidate) => rows[candidate.id]?.checked === true);
    const missingRef = checked.filter((candidate) => (rows[candidate.id]?.refAudioPath ?? '') === '');
    const savedDir = scan?.voicesDir ?? '';
    const disabled = props.busy || busy;
    // 音色包目录的真值只认宿主返回值：草稿里填了但没保存，写盘时一样会被拒。
    const canImport = scan !== null && savedDir !== '' && checked.length > 0 && missingRef.length === 0 && !disabled;
    /** 顶部那一行：还没扫描时用草稿提示，扫描后以宿主值为准。 */
    const dirLine =
      (scan === null ? props.draftVoicesDir : savedDir) === ''
        ? t('voiceImportPackMissing')
        : t('voiceImportPackDir').replace('{path}', scan === null ? props.draftVoicesDir : savedDir);
    // 一个 message 状态两个落点：`!` 开头的是失败原因（贴输入框下面），其余是导入结论（页脚）。
    // 早先只有页脚一处，选目录失败时那句话在弹窗最底部，看起来就像「点了没反应」。
    const errorText = message.startsWith('!') ? message.slice(1) : '';
    const doneText = message.startsWith('!') ? '' : message;

    /** 勾选行 → 请求条目。 */
    const itemsOf = (): Record<string, unknown>[] => buildImportItems(checked, rows, overwrite);

    const runImport = (): void => {
      const items = itemsOf();
      setBusy(true);
      setMessage('');
      setResults(null);
      setErrorIds([]);
      void postJson('/voice/voice-pack', { provider: 'gsv', mode: 'plan', items }, t('voiceImportPlanFailed'))
        .then((planned) => {
          const { previews, errors } = readVoicePackPreviews(planned);
          if (errors.length > 0) {
            setErrorIds(
              errors
                .map((error: PackErrorView) => items[error.index]?.id)
                .filter((id): id is string => typeof id === 'string'),
            );
            const first = errors[0];
            throw new Error(first ? `${first.message}` : t('voiceImportPlanFailed'));
          }
          const unwritable = previews.filter((preview) => preview !== null && !preview.pending).length;
          setMessage(unwritable > 0 ? t('voiceImportNothing').replace('{n}', String(unwritable)) : '');
          return postJson('/voice/voice-pack', { provider: 'gsv', mode: 'apply', items }, t('voiceImportApplyFailed'));
        })
        .then((applied) => {
          const { results: appliedResults, errors } = readVoicePackBatch(applied);
          const written = appliedResults.filter((item) => item?.status === 'written').length;
          const skipped = appliedResults.filter((item) => item?.status === 'skipped').length;
          setResults(appliedResults.filter((item): item is VoicePackApplyView => item !== null));
          setErrorIds(
            errors.map((error) => items[error.index]?.id).filter((id): id is string => typeof id === 'string'),
          );
          setMessage(
            t('voiceImportDone')
              .replace('{written}', String(written))
              .replace('{skipped}', String(skipped))
              .replace('{failed}', String(errors.length)),
          );
          if (written > 0) props.onRefresh();
        })
        .catch(fail)
        .finally(() => setBusy(false));
    };

    /** 一行的徽标：已接入 / 缺另一侧 / 跨盘。 */
    const badgesOf = (candidate: WeightImportCandidateView): string[] => {
      const list: string[] = [];
      if (candidate.installed) list.push(t('voiceImportRowInstalled'));
      if (candidate.gptPath === undefined || candidate.sovitsPath === undefined)
        list.push(t('voiceImportRowMissingSide'));
      return list;
    };

    /** 一侧的选择框（多 epoch/多版本时才给下拉，只有一份就显示文件名）。 */
    const sideSelect = (
      id: string,
      kind: 'gpt' | 'sovits',
      files: readonly string[],
      value: string,
      enabled: boolean,
    ) => {
      if (files.length === 0) {
        return h('span', { key: `${id}-${kind}-none`, className: 'dsh-pet-cfg__msg', children: '—' });
      }
      if (files.length === 1) {
        return h('span', {
          key: `${id}-${kind}-one`,
          className: 'dsh-pet-cfg__mono',
          title: value,
          children: baseNameOf(value),
        });
      }
      return h('select', {
        key: `${id}-${kind}-pick`,
        className: INPUT_CLASS,
        value,
        disabled: !enabled,
        onChange: (event: { target: { value: string } }) =>
          setRow(id, kind === 'gpt' ? { gpt: event.target.value } : { sovits: event.target.value }),
        children: files.map((file) => h('option', { key: file, value: file, children: [baseNameOf(file)] })),
      });
    };

    /** 清单的一行。 */
    const rowNode = (candidate: WeightImportCandidateView) => {
      const row = rows[candidate.id] ?? rowStateOf(candidate);
      const result = results?.find((item) => item.id === candidate.id);
      const failed = errorIds.includes(candidate.id);
      const badges = badgesOf(candidate);
      return h('div', {
        key: candidate.id,
        className: 'dsh-pet-cfg__impRow' + (row.checked ? '' : ' is-off'),
        children: [
          h('input', {
            key: 'check',
            type: 'checkbox',
            checked: row.checked,
            disabled,
            'aria-label': candidate.id,
            onChange: (event: { target: { checked: boolean } }) =>
              setRow(candidate.id, { checked: event.target.checked }),
          }),
          h('div', {
            key: 'body',
            className: 'dsh-pet-cfg__impBody',
            children: [
              h('div', {
                key: 'meta',
                className: 'dsh-pet-cfg__impMeta',
                children: [
                  h('span', { key: 'id', className: 'dsh-pet-cfg__rowMain', children: [candidate.id] }),
                  ...badges.map((badge) => h('span', { key: badge, className: 'dsh-pet-cfg__badge', children: badge })),
                  h('span', { key: 'size', className: 'dsh-pet-cfg__mono', children: humanSize(candidate.bytes) }),
                ],
              }),
              h('div', {
                key: 'sub',
                className: 'dsh-pet-cfg__impSub',
                children: [
                  h('span', { key: 'gptLabel', className: 'dsh-pet-cfg__mono', children: 'GPT' }),
                  sideSelect(candidate.id, 'gpt', candidate.gptFiles, row.gpt, row.checked && !disabled),
                  h('span', { key: 'sovitsLabel', className: 'dsh-pet-cfg__mono', children: 'SoVITS' }),
                  sideSelect(candidate.id, 'sovits', candidate.sovitsFiles, row.sovits, row.checked && !disabled),
                ],
              }),
              h('div', {
                key: 'sub2',
                className: 'dsh-pet-cfg__impSub',
                children: [
                  h('button', {
                    key: 'ref',
                    type: 'button',
                    className: 'dsh-pet-cfg__btn is-sm',
                    disabled: disabled || !row.checked,
                    onClick: () => pickRef(candidate.id),
                    children: [t('voiceImportRef'), row.refAudioPath === '' ? '' : `：${baseNameOf(row.refAudioPath)}`],
                  }),
                  h('input', {
                    key: 'text',
                    type: 'text',
                    className: INPUT_CLASS,
                    value: row.refText,
                    placeholder: t('voiceImportTextPlaceholder'),
                    disabled: disabled || !row.checked,
                    onChange: (event: { target: { value: string } }) =>
                      setRow(candidate.id, { refText: event.target.value }),
                  }),
                  h('button', {
                    key: 'line',
                    type: 'button',
                    className: 'dsh-pet-cfg__btn is-sm',
                    disabled: disabled || !row.checked,
                    onClick: () => pickLine(candidate.id),
                    children: t('voiceImportPickLine'),
                  }),
                  h('select', {
                    key: 'placement',
                    className: INPUT_CLASS,
                    value: row.placement,
                    disabled: disabled || !row.checked,
                    onChange: (event: { target: { value: string } }) =>
                      setRow(candidate.id, { placement: event.target.value === 'copy' ? 'copy' : 'hardlink' }),
                    children: [
                      h('option', {
                        key: 'hardlink',
                        value: 'hardlink',
                        disabled: !candidate.linkable,
                        children: t('voiceImportLink'),
                      }),
                      h('option', {
                        key: 'copy',
                        value: 'copy',
                        children: t('voiceImportCopy').replace('{size}', humanSize(candidate.bytes)),
                      }),
                    ],
                  }),
                ],
              }),
              ...candidate.warnings.map((warning, index) =>
                h('div', {
                  key: `w${index}`,
                  className: 'dsh-pet-cfg__impNote',
                  children: [warning],
                }),
              ),
              result === undefined
                ? null
                : h('div', {
                    key: 'result',
                    className: 'dsh-pet-cfg__msg' + (result.status === 'written' ? '' : ' is-err'),
                    children:
                      (result.status === 'written' ? t('voiceImportRowDone') : t('voiceImportRowSkipped')) +
                      (result.placed.length > 0 ? ` · ${result.placed.map(baseNameOf).join('、')}` : '') +
                      (result.notes.length > 0 ? ` · ${result.notes.join('；')}` : ''),
                  }),
              failed
                ? h('div', { key: 'failed', className: 'dsh-pet-cfg__msg is-err', children: t('voiceImportRowFailed') })
                : null,
            ],
          }),
        ],
      });
    };

    return h('div', {
      className: 'dsh-pet-cfg__mask',
      onClick: () => {
        if (!busy) props.onClose();
      },
      children: h('div', {
        className: 'dsh-pet-cfg__dialog is-wide',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('voiceImportTitle'),
        onClick: (e: { stopPropagation(): void }) => e.stopPropagation(),
        children: [
          h('div', { key: 't', className: 'dsh-pet-cfg__dialogTitle', children: t('voiceImportTitle') }),
          // 音色包目录是写入目标：没配/没保存就明说，别让用户配完十行参考音频才被拒。
          note(dirLine, true),
          // 选根：输入框是主入口（可粘贴），选择框是快捷方式。原生框弹不出来时这条路仍然通。
          h('div', {
            key: 'rootInput',
            className: 'dsh-pet-cfg__actions',
            children: [
              h('input', {
                key: 'path',
                type: 'text',
                className: INPUT_CLASS,
                value: rootDraft,
                placeholder: t('voiceImportRootPlaceholder'),
                disabled,
                onChange: (event: { target: { value: string } }) => setRootDraft(event.target.value),
                onKeyDown: (event: { key?: string }) => {
                  if (event.key === 'Enter') loadRoot(rootDraft.trim());
                },
              }),
              h('button', {
                key: 'pick',
                type: 'button',
                className: 'dsh-pet-cfg__btn',
                disabled,
                onClick: pickRoot,
                children: scan === null ? t('voiceImportPickRoot') : t('voiceImportRepick'),
              }),
              h('button', {
                key: 'load',
                type: 'button',
                className: 'dsh-pet-cfg__btn is-primary',
                disabled: disabled || rootDraft.trim() === '',
                onClick: () => loadRoot(rootDraft.trim()),
                children: t('voiceImportRootLoad'),
              }),
            ],
          }),
          // 选根/选文件失败的原因就贴在输入框下面：它离「刚点的那个按钮」最近，不会像页脚那样被忽略。
          errorText === ''
            ? null
            : h('div', {
                key: 'error',
                className: 'dsh-pet-cfg__msg is-err',
                role: 'status',
                children: [errorText],
              }),
          scan === null
            ? null
            : h('div', {
                key: 'root',
                className: 'dsh-pet-cfg__actions',
                children: [
                  h('span', {
                    key: 'summary',
                    className: 'dsh-pet-cfg__msg',
                    children: t('voiceImportRootSummary')
                      .replace('{gpt}', String(scan.gptDirs.length))
                      .replace('{sovits}', String(scan.sovitsDirs.length)),
                  }),
                  h('span', {
                    key: 'adopted',
                    className: 'dsh-pet-cfg__msg',
                    children: t('voiceImportSummary')
                      .replace('{ready}', String(scan.adopted))
                      .replace('{total}', String(scan.candidates.length)),
                  }),
                ],
              }),
          scan === null ? null : h('div', { key: 'rootPath', className: 'dsh-pet-cfg__mono', children: scan.root }),
          ...(scan?.notes ?? []).map((item, index) =>
            h('div', { key: `n${index}`, className: 'dsh-pet-cfg__msg', children: [item] }),
          ),
          scan === null || candidates.length === 0
            ? null
            : h('div', {
                key: 'list',
                className: 'dsh-pet-cfg__section',
                children: [
                  h('div', {
                    key: 'tools',
                    className: 'dsh-pet-cfg__actions',
                    children: [
                      h('button', {
                        key: 'all',
                        type: 'button',
                        className: 'dsh-pet-cfg__btn is-sm',
                        disabled,
                        onClick: () => {
                          const next: Record<string, ImportRowState> = {};
                          for (const candidate of candidates) {
                            next[candidate.id] = { ...(rows[candidate.id] ?? rowStateOf(candidate)), checked: true };
                          }
                          setRows(next);
                        },
                        children: t('voiceImportSelectAll'),
                      }),
                      h('button', {
                        key: 'none',
                        type: 'button',
                        className: 'dsh-pet-cfg__btn is-sm',
                        disabled,
                        onClick: () => {
                          const next: Record<string, ImportRowState> = {};
                          for (const candidate of candidates) {
                            next[candidate.id] = { ...(rows[candidate.id] ?? rowStateOf(candidate)), checked: false };
                          }
                          setRows(next);
                        },
                        children: t('voiceImportSelectNone'),
                      }),
                      h('label', {
                        key: 'overwrite',
                        className: 'dsh-pet-cfg__check',
                        children: [
                          h('input', {
                            type: 'checkbox',
                            checked: overwrite,
                            disabled,
                            onChange: (event: { target: { checked: boolean } }) => {
                              setOverwrite(event.target.checked);
                              setResults(null);
                            },
                          }),
                          h('span', { children: t('voiceImportOverwrite') }),
                        ],
                      }),
                      h('span', {
                        key: 'count',
                        className: 'dsh-pet-cfg__msg',
                        children: t('voiceImportSelected')
                          .replace('{n}', String(checked.length))
                          .replace('{m}', String(missingRef.length)),
                      }),
                    ],
                  }),
                  ...candidates.map(rowNode),
                ],
              }),
          scan !== null && candidates.length === 0
            ? h('div', { key: 'empty', className: 'dsh-pet-cfg__msg', children: t('voiceImportNoRows') })
            : null,
          lines === null
            ? null
            : h('div', {
                key: 'lines',
                className: 'dsh-pet-cfg__section',
                children: [
                  h('div', { className: 'dsh-pet-cfg__msg', children: t('voiceImportLinesTitle') }),
                  h('div', {
                    className: 'dsh-pet-cfg__searchList',
                    children: lines.map((line: TextLineView) =>
                      h('button', {
                        key: `${line.index}`,
                        type: 'button',
                        className: 'dsh-pet-cfg__searchRow',
                        onClick: () => {
                          setRow(lineTarget, { refText: line.text });
                          setLines(null);
                        },
                        children: [line.text],
                      }),
                    ),
                  }),
                  h('button', {
                    type: 'button',
                    className: 'dsh-pet-cfg__btn is-sm',
                    onClick: () => setLines(null),
                    children: t('voiceImportClose'),
                  }),
                ],
              }),
          h('div', {
            key: 'actions',
            className: 'dsh-pet-cfg__actions',
            children: [
              h('button', {
                key: 'import',
                type: 'button',
                className: 'dsh-pet-cfg__btn is-primary',
                disabled: !canImport,
                onClick: runImport,
                children: t('voiceImportStart'),
              }),
              h('button', {
                key: 'close',
                type: 'button',
                className: 'dsh-pet-cfg__btn',
                disabled: busy,
                onClick: props.onClose,
                children: t('voiceImportClose'),
              }),
              doneText === ''
                ? null
                : h('div', {
                    key: 'msg',
                    className: 'dsh-pet-cfg__msg',
                    role: 'status',
                    children: [doneText],
                  }),
            ],
          }),
        ],
      }),
    });
  };
}
