/**
 * 「对话」分区：模型选择、对话历史条数与配图上限，以及三个对话开关（都在一张卡里）。
 *
 * 候选清单是页面级的一次性拉取（`RemoteData`），拉取失败只影响下拉框，不影响已有值；
 * 所以这张卡同时吃「编辑态」与「远端结果」两样东西，但都不归它拥有。
 * owns only 这一块的装配，never 拉取与字段的编辑态。
 * @module dsh-pet/src/client/settings/model-tab
 */
import type { FunctionComponent } from 'react';
import type { DirtyQuery } from './dirty.ts';
import { makeModelCard } from './model-card.ts';
import { makeModelPicker } from './picker/index.ts';
import type { SettingsRuntime } from './runtime.ts';
import type { ModelSettings } from './use-model-settings.ts';
import type { RemoteData } from './use-remote-data.ts';

/** 对话分区的输入。 */
export interface ModelTabProps {
  /** 表单是否禁用（保存中或配置还没加载好）。 */
  readonly busy: boolean;
  /** 对话分区的全部状态与改值入口。 */
  readonly model: ModelSettings;
  /** 页面级一次性拉取的结果：候选模型清单与它的失败标志。 */
  readonly remote: RemoteData;
  /** 未保存改动查询口。 */
  readonly dirty: DirtyQuery;
}

/**
 * 造对话分区。
 *
 * @param rt - 注入的 react 能力、hooks 与翻译函数。
 * @returns 分区组件。
 */
export function makeModelTab(rt: SettingsRuntime): FunctionComponent<ModelTabProps> {
  const { h, useState, useEffect, useRef, t } = rt;
  const ModelPicker = makeModelPicker({ h, useState, useEffect, useRef, t });
  const ModelCard = makeModelCard(rt, ModelPicker);

  return function ModelTab(props: ModelTabProps) {
    const { busy, model, remote, dirty } = props;
    return h(ModelCard, {
      busy,
      catalog: remote.catalog,
      failed: remote.catalogFailed,
      whisperModel: model.whisperModel,
      chatModel: model.chatModel,
      onModelChange: model.setModel,
      chatMemory: model.chatMemory,
      chatImageLimit: model.chatImageLimit,
      onChatMemoryChange: model.setChatMemory,
      onChatImageLimitChange: model.setChatImageLimit,
      values: model.chatFlags,
      onFlagChange: model.setChatFlag,
      dirty,
    });
  };
}
