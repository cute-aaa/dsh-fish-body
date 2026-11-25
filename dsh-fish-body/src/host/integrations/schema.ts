/**
 * 接入配置的磁盘 schema：只允许已知键和版本 1。
 * @module dsh-fish-body/src/host/integrations/schema
 */
import { z } from 'zod';
import { INTEGRATIONS_VERSION, MEMORY_MODES, type IntegrationsConfig } from '../../shared/integrations.ts';

/** 磁盘配置的严格形状。 */
export const integrationsConfigSchema = z
  .object({
    version: z.literal(INTEGRATIONS_VERSION),
    persona: z
      .object({
        customPath: z.string().min(1).max(4096).nullable(),
        approvedExternal: z.boolean(),
      })
      .strict(),
    memory: z
      .object({
        mode: z.enum(MEMORY_MODES),
        customDir: z.string().min(1).max(4096).nullable(),
        approvedExternal: z.boolean(),
      })
      .strict(),
  })
  .strict();

/**
 * 解析磁盘上的接入配置。
 *
 * @param value - 已 JSON 解析的任意值。
 * @returns 合法配置；形状不对返回 `undefined`，由调用方按默认值降级并报告。
 */
export function parseIntegrationsConfig(value: unknown): IntegrationsConfig | undefined {
  const parsed = integrationsConfigSchema.safeParse(value);
  return parsed.success ? (parsed.data as IntegrationsConfig) : undefined;
}
