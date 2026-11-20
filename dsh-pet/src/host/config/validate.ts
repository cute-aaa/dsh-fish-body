/**
 * 字段校验：每个字段一个 `xValid`，只管形状与取值范围。
 *
 * 校验失败只记一次告警并返回 false，由调用方回退默认值。
 * 必须始终成立：校验规则与读取侧同一套，写回时不得放宽。
 * @module dsh-fish-body/src/host/config/validate
 */
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '../../shared/fonts.ts';
import { isValidSize } from '../../shared/pet-size.ts';
import {
  AVOID_DELAY_MAX,
  AVOID_DELAY_MIN,
  AVOID_POLL_MAX,
  AVOID_POLL_MIN,
  AVOID_RESTORE_MAX,
  AVOID_RESTORE_MIN,
  SCREEN_IDLE_MAX,
  SCREEN_IDLE_MIN,
  SCREEN_INTERVAL_MAX,
  SCREEN_INTERVAL_MIN,
  parseClockMinutes,
} from '../../shared/screen-config.ts';
import { isKnownVoice } from '../voice/voices.ts';
import { parseGlobalHotkey } from '../../shared/hotkeys.ts';
import { MAX_RESOURCE_DIRS } from '../../shared/pool.ts';
import { FONT_FAMILY_SET, RENDERER_SET } from './constants.ts';
import { sfxValid } from './sfx.ts';

/** 单个素材根路径的长度上限（字符）：正常路径远短于它，超了基本是粘错内容。 */
const MAX_RESOURCE_DIR_CHARS = 1024;

/** 内置玩法动画的槽位数：`animations.baifan` 必须恰好这么多个（顺序是玩法契约，见 shared/types 的 Animations）。 */
const ACTIVITY_SLOTS = 5;

/** animations 段完整性校验（与旧 assertAnimationsHost 同一套规则；不 throw，非法返回 false） */
function animationsValid(a: unknown): boolean {
  if (!a || typeof a !== 'object') return false;
  const anims = a as Record<string, unknown>;
  for (const key of ['idle', 'turn', 'drag', 'clicks']) {
    if (!Array.isArray(anims[key])) return false;
  }
  const moves = anims.moves;
  if (
    !moves ||
    typeof moves !== 'object' ||
    typeof (moves as Record<string, unknown>).default !== 'object' ||
    (moves as Record<string, unknown>).default === null ||
    !Array.isArray((moves as Record<string, unknown>).actions)
  ) {
    return false;
  }
  if (!Array.isArray(anims.categories)) return false;
  const ev = anims.events;
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return false;
  const evEntries = ev as Record<string, unknown>;
  for (const pool of Object.values(evEntries)) {
    if (!Array.isArray(pool) || pool.length === 0) return false;
    for (const slot of pool) {
      // 档位槽位：单个动画名或候选数组（档内随机抽 1，见 shared/pickers pickSlot）；
      // 空字符串 / 空数组 / 成员为空串的数组均非法
      if (typeof slot === 'string') {
        if (slot.length === 0) return false;
      } else if (Array.isArray(slot)) {
        if (slot.length === 0) return false;
        for (const name of slot) {
          if (typeof name !== 'string' || name.length === 0) return false;
        }
      } else {
        return false;
      }
    }
  }
  const balance = evEntries.balance;
  if (!Array.isArray(balance) || balance.length === 0) return false;
  // baifan 可选：没写 = 该条目没有这个玩法。写了才校验形状——槽位数不对会让玩法
  // 按位置取到 undefined，表现成「点了没反应」，比不配更难解释。
  if (anims.baifan !== undefined && !activitySlotsValid(anims.baifan)) return false;
  // sleep 可选：pet pack 不写也合法（不同角色的睡觉素材不一样，不能强求）。
  // 写了才校验形状——一个空套或空段会让状态机「进去了但没动画播」，比不配更难解释。
  return anims.sleep === undefined || sleepValid(anims.sleep);
}

/** sleep 段校验：非空套数组，每套都必须有非空的 start / loop / end 字符串数组。
 *  未写由调用方放行（可选字段）；这里只处理「写了」的形态。 */
function sleepValid(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  for (const set of value) {
    if (!set || typeof set !== 'object' || Array.isArray(set)) return false;
    const entry = set as Record<string, unknown>;
    for (const phase of ['start', 'loop', 'end']) {
      const pool = entry[phase];
      if (!Array.isArray(pool) || pool.length === 0) return false;
      for (const name of pool) {
        if (typeof name !== 'string' || name.length === 0) return false;
      }
    }
  }
  return true;
}

/** baifan 段校验：恰好 {@link ACTIVITY_SLOTS} 个非空动画名。
 *  写少写多都算非法——槽位按索引取，缺一个就是那个时机没有动画可播。 */
function activitySlotsValid(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== ACTIVITY_SLOTS) return false;
  return value.every((name) => typeof name === 'string' && name.length > 0);
}

/** animationWeights 段校验（idle/turn/move 三个非负数字） */
function weightsValid(w: unknown): boolean {
  if (!w || typeof w !== 'object') return false;
  const weights = w as Record<string, unknown>;
  for (const key of ['idle', 'turn', 'move']) {
    const v = Number(weights[key]);
    if (!Number.isFinite(v) || v < 0) return false;
  }
  return true;
}

/** physics 段校验：gravity ≥ 0（0 = 无重力，合法）、restitution ∈ [0,1]、groundFriction ≥ 0（均为有限数字）、
 *  ceilingBounce / petCollision 为布尔、throwPower > 0（有限数字）。
 *  hapticEnabled / tiltGravity / shakeThrow 为可选布尔（旧配置没有这几个键）。 */
export function physicsValid(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  const g = Number(p.gravity);
  const r = Number(p.restitution);
  const f = Number(p.groundFriction);
  const tp = Number(p.throwPower);
  return (
    Number.isFinite(g) &&
    g >= 0 &&
    Number.isFinite(r) &&
    r >= 0 &&
    r <= 1 &&
    Number.isFinite(f) &&
    f >= 0 &&
    typeof p.ceilingBounce === 'boolean' &&
    Number.isFinite(tp) &&
    tp > 0 &&
    typeof p.petCollision === 'boolean' &&
    // 可选：旧配置（与手写配置）没有这三个键，各按默认处理（三个都按开处理），
    // 缺键不算整段非法。
    (p.hapticEnabled === undefined || typeof p.hapticEnabled === 'boolean') &&
    (p.tiltGravity === undefined || typeof p.tiltGravity === 'boolean') &&
    (p.shakeThrow === undefined || typeof p.shakeThrow === 'boolean')
  );
}

/** font 段校验：family ∈ 预设白名单、size 为区间内的有限数字、followPet 为布尔。
 *  与 physics 同口径：整段校验——任一子键缺失/非法即整段非法（告警 + 取默认），
 *  不做「缺子键逐个补默认」；对象字段一律整段替换。 */
export function fontValid(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const f = value as Record<string, unknown>;
  if (typeof f.family !== 'string' || !FONT_FAMILY_SET.has(f.family)) return false;
  const size = Number(f.size);
  if (!Number.isFinite(size) || size < FONT_SIZE_MIN || size > FONT_SIZE_MAX) return false;
  return typeof f.followPet === 'boolean';
}

/** whisperModel / chatModel 段校验：{ provider, model } 两个字符串，
 *  要么都留空（= 跟随当前对话的模型）要么都非空——只填一半会拼出「用 A 家的模型名去问 B 家」
 *  这种必然失败的组合，按非法处理（告警 + 取默认）。 */
export function modelSelectionValid(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const m = value as Record<string, unknown>;
  if (typeof m.provider !== 'string' || typeof m.model !== 'string') return false;
  return (m.provider.trim() === '') === (m.model.trim() === '');
}

/**
 * `pets[].sizes` 段校验：对象，键只能是三种渲染方式，值是 {@link isValidSize} 认的像素。
 *
 * 缺键合法（= 跟随 `size`）；空对象也合法（= 没有覆盖）——设置页清空三项后提交的就是 `{}`。
 * 与 `physics` / `font` 的「整段校验」不同：这里是**逐键**校验，一个渲染方式写错不该把另外两个也丢掉。
 */
export function petSizesValid(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const [key, size] of Object.entries(value as Record<string, unknown>)) {
    if (!RENDERER_SET.has(key)) return false;
    if (size === undefined || size === null) continue;
    if (!isValidSize(size)) return false;
  }
  return true;
}

/** workStatusTexts 段校验：二维数组——外层每项都是非空字符串数组（档位文案，每档可多句随机）；空数组不可用 */ function workStatusTextsValid(
  value: unknown,
): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  for (const group of value) {
    if (!Array.isArray(group) || group.length === 0) return false;
    for (const text of group) {
      if (typeof text !== 'string' || text.length === 0) return false;
    }
  }
  return true;
}

/**
 * `assets` 段校验：对象；`pool` 缺省（= 默认 `<用户根>/assets/pet`）或非空字符串；
 * `resourceDirs` 缺省或「不超过 {@link MAX_RESOURCE_DIRS} 条非空字符串」。
 *
 * 池根与额外素材根都允许绝对路径，所以这里不限制分隔符与字符集——真正的路径守卫生成在
 * host/pool/resolve（每个相对片段都过 insideRoot）。存在性也不在这里判：素材盘拔掉不该让整段配置失效。
 * 未知子键忽略（与 sfx 同口径：不因为多写一个键整段失效）。
 *
 * @param value - 待判定的 `assets` 段。
 * @returns 形状合法返回 true。
 */
export function assetsValid(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const conf = value as Record<string, unknown>;
  const pool = conf.pool;
  if (pool !== undefined && pool !== null && !(typeof pool === 'string' && pool.trim() !== '')) return false;
  const dirs = conf.resourceDirs;
  if (dirs === undefined || dirs === null) return true;
  if (!Array.isArray(dirs) || dirs.length > MAX_RESOURCE_DIRS) return false;
  return dirs.every((item) => typeof item === 'string' && item.trim() !== '' && item.length <= MAX_RESOURCE_DIR_CHARS);
}

/**
 * 数值键是否落在闭区间内（接受 `"120"` 这类字符串写法：手写配置里常见，与 chatMemoryRounds 同口径）。
 *
 * @param value - 待判定值。
 * @param min - 下限（含）。
 * @param max - 上限（含）。
 * @returns 是否合法。
 */
function numberInRange(value: unknown, min: number, max: number): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max;
}

/**
 * 避让白名单是否合法：字符串数组，逐项非空且不超长；条数上限交给写侧严格拒绝。
 *
 * 读侧只按形状判——条数超限也照读（多几条最多是多躲几次），写侧才拒绝。
 *
 * @param value - 待判定值。
 * @returns 是否合法。
 */
function avoidAppsValid(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((item) => typeof item === 'string' && item.trim() !== '' && item.trim().length <= 64);
}

/** 顶层标量字段的合法性（非法与缺失同处理：取默认值 + 告警） */
export function topFieldValid(key: string, value: unknown): boolean {
  switch (key) {
    case 'whisperPrompt':
      return typeof value === 'string' && value.length > 0;
    case 'chatMemoryRounds': {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0;
    }
    case 'chatImageLimit': {
      // 对话配图张数上限：非负数字（0 = 不限制）；小数按消费者 Math.floor 取整
      const n = Number(value);
      return Number.isFinite(n) && n >= 0;
    }
    case 'notificationsEnabled':
      return typeof value === 'boolean';
    case 'petEnabled':
      // 桌宠总开关（全局布尔，只读 main 条目）：false = 桌面不建窗、网页不渲染、定时任务停跑
      return typeof value === 'boolean';
    case 'hideAllHotkey':
      // 全局隐藏 / 暂停的系统级快捷键：空串 = 关掉；非空必须是能解析的组合键（读写出自同一份解析器）
      return typeof value === 'string' && (value.trim() === '' || parseGlobalHotkey(value) !== null);
    case 'sfxEnabled':
      // 音效总开关（全局布尔，只读 main 条目）：与 notificationsEnabled 同一套校验
      return typeof value === 'boolean';
    case 'sfxKeepAlive':
      // 音效常驻预热（全局布尔）：只影响首声保真与设备占用，缺省开
      return typeof value === 'boolean';
    case 'sfxVolume':
      // 音效总音量系数：0–1 的有限数，与 voiceVolume 同量纲；越界即非法
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
    case 'sfx':
      // 音效段（事件槽 / 动作音 / hook / 按渲染方式 / 按皮肤）：整段校验，与 physics 同一口径
      return sfxValid(value);
    case 'clickSoundEnabled':
      // 旧键（读取侧会别名到 sfxEnabled，写入只出新键）：保留判定让老用户配置继续可读
      return typeof value === 'boolean';
    case 'clickSoundKeepAlive':
      // 旧键：别名到 sfxKeepAlive
      return typeof value === 'boolean';
    case 'clickSoundVolume':
      // 旧键：别名到 sfxVolume
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
    case 'whisperImageEnabled':
      return typeof value === 'boolean';
    case 'voiceEnabled':
      // 语音播报开关（全局布尔）：只决定念不念，不影响气泡与记忆
      return typeof value === 'boolean';
    case 'voiceName':
      // 音色必须是白名单内的 id；写错即非法，读取侧回落到默认音色并告警
      return typeof value === 'string' && isKnownVoice(value);
    case 'voiceVolume':
      // 播放音量系数：0–1 的有限数，与 Audio.volume 同量纲；越界即非法（不夹取，读取侧回落默认）
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
    case 'voiceWhisperEnabled':
      // 周期碎碎念的语音开关（全局布尔）：只决定念不念，不影响气泡与记忆
      return typeof value === 'boolean';
    case 'voiceTodoEnabled':
      // 待办提醒的语音开关（全局布尔）：同上
      return typeof value === 'boolean';
    case 'voiceNotifyEnabled':
      // 工作状态播报开关（全局布尔）：只决定完成 / 出错 / 等确认三档念不念，不影响系统通知弹窗
      return typeof value === 'boolean';
    case 'speakStripEmoji':
      // 播报去表情（全局布尔）：只影响念出来的文本，不影响识别结果与气泡
      return typeof value === 'boolean';
    case 'chatImageEnabled':
      return typeof value === 'boolean';
    case 'chatAnimationEnabled':
      return typeof value === 'boolean';
    case 'confineToScreen':
      return typeof value === 'boolean';
    case 'trayEnabled':
      // 桌面模式系统托盘开关（main 条目顶层；helper 读它决定建不建托盘图标）
      return typeof value === 'boolean';
    case 'animations':
      return animationsValid(value);
    case 'animationWeights':
      return weightsValid(value);
    case 'eventsRefreshSec':
      return eventsRefreshSecValid(value);
    case 'physics':
      return physicsValid(value);
    case 'font':
      return fontValid(value);
    case 'whisperModel':
    case 'chatModel':
      return modelSelectionValid(value);
    case 'workStatusTexts':
      return workStatusTextsValid(value);
    case 'assets':
      // 共享资源池的根（`assets.pool`）：字符串、非空；缺省即默认 `<用户根>/skin`。
      return assetsValid(value);
    // 看屏幕 / 避让（十三个键，规则与 shared/screen-config 的归一化同一套区间）：
    // 读侧非法 → 告警一次并回落默认（`screenConfigOf` 读的就是回落后的值）。
    case 'screenReadEnabled':
    case 'screenReadIdleOnly':
    case 'avoidFullscreenEnabled':
    case 'avoidMaximizeEnabled':
    case 'avoidAppsEnabled':
      return typeof value === 'boolean';
    case 'screenReadIntervalSec':
      return numberInRange(value, SCREEN_INTERVAL_MIN, SCREEN_INTERVAL_MAX);
    case 'screenReadIdleSec':
      return numberInRange(value, SCREEN_IDLE_MIN, SCREEN_IDLE_MAX);
    case 'avoidDelayMs':
      return numberInRange(value, AVOID_DELAY_MIN, AVOID_DELAY_MAX);
    case 'avoidRestoreDelayMs':
      return numberInRange(value, AVOID_RESTORE_MIN, AVOID_RESTORE_MAX);
    case 'avoidPollMs':
      return numberInRange(value, AVOID_POLL_MIN, AVOID_POLL_MAX);
    case 'screenReadQuietFrom':
    case 'screenReadQuietTo':
      // 空串 = 不设静默时段（默认就是这个）。
      return typeof value === 'string' && (value.trim() === '' || parseClockMinutes(value) !== null);
    case 'avoidApps':
      return avoidAppsValid(value);
    case 'sleepRefuseTexts':
    case 'sleepStartTexts':
    case 'sleepEndTexts': {
      // 睡觉三组台词（条目级）：非空字符串数组，随机挑一句；空数组/空串会让「说话」变成静默失败
      if (!Array.isArray(value) || value.length === 0) return false;
      return value.every((text) => typeof text === 'string' && text.length > 0);
    }
    default:
      return true;
  }
}

/**
 * eventsRefreshSec 段校验：事件名 → 间隔秒（正的有限数字）。
 * 这是整段替换字段：缺的键由消费端各自兜底（1800 / 300），多写的键原样保留；空对象合法。
 */
function eventsRefreshSecValid(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const v of Object.values(value as Record<string, unknown>)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return false;
  }
  return true;
}

/** 角色 id 的最大长度（含首字符，落成 `data/persona-characters/<id>.json` 的文件名）。 */
const MAX_CHARACTER_ID_LENGTH = 64;

/**
 * 人设角色 id 的合法性（读写共用一份规则：`save.ts` 写、`merge.ts` 读、前端 `validate-form` 同规则）。
 *
 * 允许 Unicode 字母/数字开头（中文角色名归一化后往往仍是中文，`鱼生` 就是合法 id），
 * 其余位置允许 `._-`；**排除** `/ \ : * ? " < > |` 与控制字符——id 会直接当文件名用。
 *
 * @param value - 待判定的值（可能来自用户手改的配置）。
 * @returns 合法返回 true。
 */
export function characterIdValid(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_CHARACTER_ID_LENGTH) return false;
  return /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(value);
}
