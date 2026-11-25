/**
 * 外部项目接入配置：persona 自定义路径与 memory 自动/自定义目录的唯一持久化契约。
 *
 * 配置独立落 `config/integrations.json`，不改带注释的主配置；路径只存规范化后的绝对路径。
 * 外部路径必须由用户显式确认，确认状态与路径一起保存，读取方不得自行扩大允许范围。
 * @module dsh-fish-body/src/shared/integrations
 */
/** 配置文件版本；形状变化时升版并提供相邻迁移。 */
export const INTEGRATIONS_VERSION = 1 as const;

/** 记忆来源模式：自动探测已知项目，或只读用户指定的目录。 */
export const MEMORY_MODES = ['auto', 'custom'] as const;

/** 记忆来源模式。 */
export type MemoryMode = (typeof MEMORY_MODES)[number];

/** persona 接入配置。 */
export interface PersonaIntegration {
  /** 自定义角色文件或目录；null 表示未配置。 */
  readonly customPath: string | null;
  /** 该路径已由用户确认允许读取；数据根 / DSH_HOME 内为 false。 */
  readonly approvedExternal: boolean;
}

/** memory 接入配置。 */
export interface MemoryIntegration {
  /** auto = 探测 dsh-rofm / dsh-suzu-memory；custom = 只读 customDir。 */
  readonly mode: MemoryMode;
  /** 自定义记忆目录；auto 模式下应为 null。 */
  readonly customDir: string | null;
  /** 该目录已由用户确认允许读取；数据根 / DSH_HOME 内为 false。 */
  readonly approvedExternal: boolean;
}

/** `config/integrations.json` 的完整内容。 */
export interface IntegrationsConfig {
  readonly version: typeof INTEGRATIONS_VERSION;
  readonly persona: PersonaIntegration;
  readonly memory: MemoryIntegration;
}

/** 未被用户配置过时的默认值。 */
export const DEFAULT_INTEGRATIONS: IntegrationsConfig = {
  version: INTEGRATIONS_VERSION,
  persona: { customPath: null, approvedExternal: false },
  memory: { mode: 'auto', customDir: null, approvedExternal: false },
};

/** 路径状态：供设置页区分「没配」「可用」「不存在」「需要授权」「形状非法」。 */
export type IntegrationPathState = 'unset' | 'ok' | 'missing' | 'unapproved' | 'invalid';

/** 一条接入配置的只读视图。 */
export interface IntegrationEntryView {
  /** 规范化后的绝对路径；未配置为 null。 */
  readonly path: string | null;
  /** 用户是否确认过外部路径。 */
  readonly approvedExternal: boolean;
  /** 盘点后的状态。 */
  readonly state: IntegrationPathState;
  /** 可直接显示的原因；state=ok/unset 时为空串。 */
  readonly message: string;
}

/** `GET /integrations` 的响应体。 */
export interface IntegrationsView {
  readonly persona: IntegrationEntryView;
  readonly memory: IntegrationEntryView & { readonly mode: MemoryMode };
}
