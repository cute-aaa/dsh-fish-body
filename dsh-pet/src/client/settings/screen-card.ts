/**
 * 「系统」分区的「看屏幕与避让」卡：十三个可配项分两段摆。
 *
 * 为什么一张卡而不是两张：这十三项服务同一件事（让桌宠看一眼屏幕、并在别人占满屏幕时躲开），
 * 拆成两张卡会让「识屏间隔」与「躲开延迟」看起来互不相干；分两段（看屏幕 / 躲开）就够读了。
 *
 * 时机项是这张卡的重点：间隔、只在空闲时拍、静默时段、躲开延迟、恢复延迟、轮询节拍全在界面上，
 * 改完随「保存」整包写入（不做即时写盘——那会重启桌面 Helper、重建全部窗口）。
 * owns only 这一块的渲染，never 状态与写盘。
 * @module dsh-fish-body/src/client/settings/screen-card
 */
import type { FunctionComponent } from 'react';
import type { DirtyQuery } from './dirty.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';
import {
  SCREEN_NUMBER_RANGE,
  type ScreenClockField,
  type ScreenNumberField,
  type ScreenSettings,
} from './use-screen-settings.ts';

/** 「看屏幕与避让」卡的输入。 */
export interface ScreenCardProps {
  /** 保存中或配置未就绪时禁用全部控件。 */
  readonly busy: boolean;
  /** 十三项的状态与改值入口。 */
  readonly screen: ScreenSettings;
  /** 未保存改动查询口。 */
  readonly dirty: DirtyQuery;
}

/** 数字字段 → 文案键（卡片与字典各写一份必然漂移，所以只留这一处映射）。 */
const NUMBER_LABELS: Readonly<Record<ScreenNumberField, string>> = {
  intervalSec: 'screenIntervalLabel',
  idleSec: 'screenIdleSecLabel',
  avoidDelayMs: 'screenAvoidDelayLabel',
  avoidRestoreMs: 'screenAvoidRestoreLabel',
  avoidPollMs: 'screenAvoidPollLabel',
};

/** 时段字段 → 文案键。 */
const CLOCK_LABELS: Readonly<Record<ScreenClockField, string>> = {
  quietFrom: 'screenQuietFromLabel',
  quietTo: 'screenQuietToLabel',
};

/**
 * 造「看屏幕与避让」卡。
 *
 * @param rt - 注入的节点工厂与翻译函数。
 * @returns 卡片组件。
 */
export function makeScreenCard(rt: SettingsRuntime): FunctionComponent<ScreenCardProps> {
  const { h, t } = rt;

  return function ScreenCard(props: ScreenCardProps) {
    const { busy, screen, dirty } = props;
    const { cardHead, field, note, section, toggleCell, switchGrid } = makeUiKit({ h, t }, dirty);
    const v = screen.values;

    /** 一个数字输入：区间与宿主校验同一份，越界在 setter 里夹取。 */
    const numberInput = (key: ScreenNumberField): ReturnType<typeof h> => {
      const [min, max] = SCREEN_NUMBER_RANGE[key];
      return h('input', {
        className: 'dsh-pet-cfg__inp',
        type: 'number',
        min,
        max,
        step: 1,
        value: String(v[key]),
        disabled: busy,
        'aria-label': t(NUMBER_LABELS[key]),
        onChange: (event: { target: { value: string } }) => screen.setNumber(key, Number(event.target.value)),
      });
    };

    /** 一个 `HH:MM` 输入：空串 = 不设静默时段。 */
    const clockInput = (key: ScreenClockField): ReturnType<typeof h> =>
      h('input', {
        className: 'dsh-pet-cfg__inp',
        type: 'text',
        inputMode: 'numeric',
        placeholder: '23:00',
        value: v[key],
        disabled: busy,
        'aria-label': t(CLOCK_LABELS[key]),
        onChange: (event: { target: { value: string } }) => screen.setClock(key, event.target.value),
      });

    /** 数字字段 + 单位后缀的标签。 */
    const numberField = (key: ScreenNumberField, unitKey: string): ReturnType<typeof field> =>
      field(t(NUMBER_LABELS[key]) + '（' + t(unitKey) + '）', numberInput(key), undefined, 'screen.' + key);

    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('screenTitle'), t('screenHint'), [
          'screen.readEnabled',
          'screen.avoidFullscreen',
          'screen.avoidAppsEnabled',
        ]),
        note(t('screenDesktopOnly')),
        section(t('screenSectionRead'), [
          switchGrid([
            toggleCell(
              t('screenReadToggle'),
              v.readEnabled,
              busy,
              (value) => screen.setFlag('readEnabled', value),
              'screen.readEnabled',
            ),
            toggleCell(
              t('screenIdleOnlyLabel'),
              v.idleOnly,
              busy,
              (value) => screen.setFlag('idleOnly', value),
              'screen.idleOnly',
            ),
          ]),
          numberField('intervalSec', 'screenUnitSec'),
          numberField('idleSec', 'screenUnitSec'),
          field(
            t('screenQuietLabel'),
            h('div', {
              className: 'dsh-pet-cfg__row',
              children: [clockInput('quietFrom'), clockInput('quietTo')],
            }),
            t('screenQuietHint'),
            'screen.quietFrom',
          ),
        ]),
        section(t('screenSectionAvoid'), [
          switchGrid([
            toggleCell(
              t('screenAvoidFullscreenLabel'),
              v.avoidFullscreen,
              busy,
              (value) => screen.setFlag('avoidFullscreen', value),
              'screen.avoidFullscreen',
            ),
            toggleCell(
              t('screenAvoidMaximizeLabel'),
              v.avoidMaximize,
              busy,
              (value) => screen.setFlag('avoidMaximize', value),
              'screen.avoidMaximize',
            ),
            toggleCell(
              t('screenAvoidAppsLabel'),
              v.avoidAppsEnabled,
              busy,
              (value) => screen.setFlag('avoidAppsEnabled', value),
              'screen.avoidAppsEnabled',
            ),
          ]),
          field(
            t('screenAppsLabel'),
            h('input', {
              className: 'dsh-pet-cfg__inp',
              type: 'text',
              placeholder: 'chrome.exe, 哔哩哔哩',
              value: screen.appsText,
              disabled: busy || !v.avoidAppsEnabled,
              'aria-label': t('screenAppsLabel'),
              onChange: (event: { target: { value: string } }) => screen.setAppsText(event.target.value),
            }),
            t('screenAppsHint'),
            'screen.avoidApps',
          ),
          numberField('avoidDelayMs', 'screenUnitMs'),
          numberField('avoidRestoreMs', 'screenUnitMs'),
          numberField('avoidPollMs', 'screenUnitMs'),
        ]),
        note(t('screenNote'), true),
      ],
    });
  };
}
