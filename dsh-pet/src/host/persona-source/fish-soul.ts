/**
 * 内置人格来源：dsh-fish-soul 的人设卡（$DSH_HOME/fish-soul/persona.json）。
 * 只是 {@link createCardFileSource} 的一层薄封装——扫卡规则与其它 soul 项目共用一份。
 * @module dsh-fish-body/src/host/persona-source/fish-soul
 */
import { join } from 'node:path';
import { createCardFileSource } from './card-file.ts';
import { BUILTIN_PERSONA_SOURCE_ID, type PersonaSource } from './types.ts';

/**
 * 创建 fish-soul 人格来源。
 *
 * @param dshHome - DSH 数据根（resolveDshHome 的结果）。
 * @returns 来源实现；约定目录 = <dshHome>/fish-soul/。
 */
export function createFishSoulSource(dshHome: string): PersonaSource {
  return createCardFileSource({
    id: BUILTIN_PERSONA_SOURCE_ID,
    name: 'dsh-fish-soul',
    dir: join(dshHome, 'fish-soul'),
  });
}
