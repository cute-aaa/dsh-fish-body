/**
 * 悬停快捷键的唯一真源：九个动作、它们的默认键、合法键的判定，以及配置里的读写形状。
 *
 * 为什么是「裸键」而不是组合键：这些键只在鼠标停在这只宠物上（或焦点在它自己的弹窗里）时生效，
 * 判据与 `shared/hotkey` 的 `isBareKey` 是同一份——带 Ctrl/Alt/Meta 的组合属于浏览器与宿主，
 * 宠物去抢会直接抢坏复制、撤销这类基本操作。所以合法键只认一个小写字母或一个数字。
 *
 * 配置里是九个**扁平**键（`display.web` 这种点号键）：与 `HotkeyAction` 一一对应，
 * 读、写、校验、界面改绑全都用同一串名字，不需要第二张映射表。
 *
 * 两端共用：网页半边按键帽显示与判定，桌面半边拿同一份去画右键菜单的键帽。
 * @module dsh-fish-body/src/shared/hotkeys
 */

/** 九个可改绑的悬停动作。`display.*` 与 `DISPLAY_ORDER` 的四个显示位置一一对应。 */
export type HotkeyAction =
  'chat' | 'hear' | 'capture' | 'todo' | 'sleep' | 'display.web' | 'display.desktop' | 'display.both' | 'display.none';

/** 全部动作，顺序即设置页里的展示顺序（也是冲突回落时的优先级）。 */
export const HOTKEY_ACTIONS: readonly HotkeyAction[] = [
  'chat',
  'hear',
  'capture',
  'todo',
  'sleep',
  'display.web',
  'display.desktop',
  'display.both',
  'display.none',
];

/** 九个键的当前值；永远齐全、永远互不相同。 */
export type HotkeyMap = Readonly<Record<HotkeyAction, string>>;

/** 出厂键位：与改绑功能出现之前完全一致，老用户升级后手感不变。 */
export const DEFAULT_HOTKEYS: HotkeyMap = {
  chat: 'l',
  hear: 'm',
  capture: 's',
  todo: 'd',
  sleep: 'z',
  'display.web': '1',
  'display.desktop': '2',
  'display.both': '3',
  'display.none': '4',
};

/** 合法键：一个小写字母或一个数字（裸键）。 */
const KEY_PATTERN = /^[a-z0-9]$/;

/** 回落用的候选键：默认键被占用时按这个顺序找第一个没人用的。 */
const FALLBACK_KEYS = 'qwertyuiopasdfghjklzxcvbnm1234567890';

/** 是不是一个合法键（小写字母 / 数字）。 */
export function isHotkeyKey(value: unknown): value is string {
  return typeof value === 'string' && KEY_PATTERN.test(value);
}

/** 一个动作是不是已知动作。 */
export function isHotkeyAction(value: unknown): value is HotkeyAction {
  return typeof value === 'string' && (HOTKEY_ACTIONS as readonly string[]).includes(value);
}

/** 显示位置 → 对应的动作名（`web` → `display.web`）。 */
export function hotkeyActionOfDisplay(display: 'web' | 'desktop' | 'both' | 'none'): HotkeyAction {
  return ('display.' + display) as HotkeyAction;
}

/** 键 → 键帽文案（`L 键` / `1 键`）。与判定用的是同一个字符，不另存一份字符串。 */
export function hotkeyCap(key: string): string {
  return key.toUpperCase() + ' 键';
}

/** 某个动作此刻用的键；map 缺省或字段缺失时给出出厂值。 */
export function hotkeyOf(map: HotkeyMap | undefined, action: HotkeyAction): string {
  return map?.[action] ?? DEFAULT_HOTKEYS[action];
}

/** 某个动作的键帽文案（菜单右侧灰字、设置页卡片共用）。 */
export function hotkeyHint(map: HotkeyMap | undefined, action: HotkeyAction): string {
  return hotkeyCap(hotkeyOf(map, action));
}

/**
 * 把配置里的原始值收成一份合法且唯一的键位表。
 *
 * 规则（顺序即优先级）：
 *   1. 合法的自定义值优先，同一键只认先到的那一项；
 *   2. 没被占用的动作拿自己的出厂键；
 *   3. 出厂键也已被占用时，按 {@link FALLBACK_KEYS} 找第一个空位。
 * 结果永远合法、永远唯一，因此调用方不必再处理「两个动作共用一个键」这种状态。
 *
 * @param raw - 配置里的 `hotkeys`（形状未知，脏值一律忽略）。
 * @returns 完整键位表。
 */
export function normalizeHotkeys(raw: unknown): HotkeyMap {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const picked = new Map<HotkeyAction, string>();
  const used = new Set<string>();
  for (const action of HOTKEY_ACTIONS) {
    const value = source[action];
    if (typeof value !== 'string') continue;
    const key = value.trim().toLowerCase();
    if (!KEY_PATTERN.test(key) || used.has(key)) continue;
    picked.set(action, key);
    used.add(key);
  }
  for (const action of HOTKEY_ACTIONS) {
    if (picked.has(action)) continue;
    const fallback = DEFAULT_HOTKEYS[action];
    const key = used.has(fallback) ? FALLBACK_KEYS.split('').find((item) => !used.has(item)) : fallback;
    // 九个动作、35 个候选键：找不到空位只可能是数据被改坏了，退回出厂值总比抛异常好。
    const final = key ?? fallback;
    picked.set(action, final);
    used.add(final);
  }
  return Object.fromEntries(
    HOTKEY_ACTIONS.map((action) => [action, picked.get(action) ?? DEFAULT_HOTKEYS[action]]),
  ) as Record<HotkeyAction, string>;
}

/**
 * 配置里的 `hotkeys` 能不能收。
 *
 * 只判原始值本身：未知动作、非法键、重复键都算「写坏了」，整包拒绝比静默改用户的键位更好。
 * 缺项是合法的（缺失的动作在 {@link normalizeHotkeys} 里取出厂值）；大写也合法——手写配置
 * 写个 `"K"` 不该被拒，落盘时会收成小写。
 *
 * @param raw - 请求体里的 `hotkeys`。
 * @returns 形状与取值都说得清时为 true。
 */
export function hotkeysValid(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const seen = new Set<string>();
  for (const [action, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isHotkeyAction(action)) return false;
    if (typeof value !== 'string') return false;
    const key = value.trim().toLowerCase();
    if (!KEY_PATTERN.test(key)) return false;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/**
 * 把某个动作的键改成 `key`；若这个键原本属于别的动作，两者**互换**。
 *
 * 互换而不是报冲突：用户想对调的意图一目了然，而「先报错、请先把另一个改走」在只有九个键的小卡片里
 * 只会让人绕圈。结果天然合法唯一，界面不需要处理冲突状态。
 *
 * @param map - 当前键位表。
 * @param action - 要改的动作。
 * @param key - 新键（必须是合法键）。
 * @returns 新的键位表；键非法时原样返回。
 */
export function assignHotkey(map: HotkeyMap, action: HotkeyAction, key: string): HotkeyMap {
  const next = key.trim().toLowerCase();
  if (!KEY_PATTERN.test(next)) return map;
  const owner = HOTKEY_ACTIONS.find((item) => item !== action && hotkeyOf(map, item) === next);
  const previous = hotkeyOf(map, action);
  const out = { ...map, [action]: next } as Record<HotkeyAction, string>;
  if (owner !== undefined) out[owner] = previous;
  return out;
}

// ============================================================================
// 系统级快捷键（带修饰键）：目前只有「全局隐藏 / 暂停」一条
// ============================================================================

/**
 * 「全局隐藏 / 暂停」的出厂组合键。
 *
 * 与上面九个裸键不是同一类东西：那九个只在鼠标停着宠物时生效（宠物被藏起来时按不到），
 * 而这条要在**任何应用前台**都能按下去——所以它必须带修饰键、由桌面端注册成系统级快捷键。
 */
export const DEFAULT_HIDE_ALL_HOTKEY = 'Control+Alt+H';

/** 解析后的组合键：四个修饰位 + 一个主键（大写）。 */
export interface GlobalHotkey {
  readonly control: boolean;
  /** 「主修饰键」：Windows/Linux 上是 Ctrl，macOS 上是 ⌘。 */
  readonly commandOrControl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly super: boolean;
  /** 主键：大写字母 / 数字 / `F1`–`F12`。 */
  readonly key: string;
}

/** 主键白名单：一个字母、一个数字，或 F1–F12。 */
const GLOBAL_KEY_PATTERN = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-2]))$/;

/** 修饰键的各种写法 → 规范名。手写配置里 alt/option、cmd/super/win 都有人写。 */
const MODIFIER_ALIASES: Readonly<Record<string, keyof Omit<GlobalHotkey, 'key'>>> = {
  ctrl: 'control',
  control: 'control',
  cmdorctrl: 'commandOrControl',
  commandorcontrol: 'commandOrControl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'super',
  super: 'super',
  cmd: 'super',
  command: 'super',
  win: 'super',
};

/**
 * 解析一串组合键文本。
 *
 * 规则：用 `+` 分段，最后一段是主键，前面的都当修饰键；**至少要有一个修饰键**——
 * 一个裸字母做系统级快捷键会把这台机器上所有输入框的那个字母抢走。
 *
 * @param raw - 形如 `Control+Alt+H` / `cmdorctrl+shift+k` 的文本。
 * @returns 解析结果；空串、没有修饰键、主键不认识时返回 `null`。
 */
export function parseGlobalHotkey(raw: unknown): GlobalHotkey | null {
  if (typeof raw !== 'string') return null;
  const parts = raw
    .split('+')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== '');
  if (parts.length < 2) return null;
  const key = (parts[parts.length - 1] ?? '').toUpperCase();
  if (!GLOBAL_KEY_PATTERN.test(key)) return null;
  const flags = { control: false, commandOrControl: false, alt: false, shift: false, super: false };
  for (const part of parts.slice(0, -1)) {
    const field = MODIFIER_ALIASES[part];
    if (field === undefined) return null;
    flags[field] = true;
  }
  if (!flags.control && !flags.commandOrControl && !flags.alt && !flags.shift && !flags.super) return null;
  return { ...flags, key };
}

/**
 * 规范成 Electron accelerator 认的写法（`Control+Alt+H`）。
 *
 * 空串 = 明确「关掉这条快捷键」，与「没写」在配置里是同一件事；非法值也回空串——
 * 读侧的落盘值由调用方决定，这里只保证「拿到什么就用什么」。
 *
 * @param raw - 配置里的原始文本。
 * @returns 规范串；无法解析时 `''`。
 */
export function normalizeGlobalHotkey(raw: unknown): string {
  const parsed = parseGlobalHotkey(raw);
  if (parsed === null) return '';
  const parts: string[] = [];
  if (parsed.control) parts.push('Control');
  if (parsed.commandOrControl) parts.push('CommandOrControl');
  if (parsed.alt) parts.push('Alt');
  if (parsed.shift) parts.push('Shift');
  if (parsed.super) parts.push('Super');
  parts.push(parsed.key);
  return parts.join('+');
}

/** 默认按哪个平台解释「主修饰键」：网页端取 navigator，宿主/测试可用第二参数覆盖。 */
function isMacLike(platform?: string): boolean {
  if (platform !== undefined) return /darwin|mac|iphone|ipad/i.test(platform);
  const scope = globalThis as { navigator?: { platform?: string; userAgent?: string } };
  const text = `${scope.navigator?.platform ?? ''} ${scope.navigator?.userAgent ?? ''}`;
  return /mac|iphone|ipad/i.test(text);
}

/** 一次键盘事件的修饰位（只取本判定要用的那几位）。 */
export interface GlobalKeyEvent {
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly key: string;
}

/**
 * 这条键盘事件是不是按下了某个组合键。
 *
 * 网页端没有系统级快捷键可注册，只能在自己的页面上听 `keydown`；判定与桌面端注册的那份
 * 是同一串文本（`normalizeGlobalHotkey` 的产物），所以两边行为一致。
 *
 * @param event - 键盘事件（或同形状的对象）。
 * @param combo - 组合键文本；空串 = 没开这条快捷键，永远不匹配。
 * @param platform - 判「主修饰键」用的平台串（测试注入）。
 * @returns 命中时为 true。
 */
export function matchesGlobalHotkey(event: GlobalKeyEvent, combo: string, platform?: string): boolean {
  const parsed = parseGlobalHotkey(combo);
  if (parsed === null) return false;
  const mac = isMacLike(platform);
  // 主修饰键落到哪个位：mac 上是 ⌘（metaKey），其余平台是 Ctrl。
  const wantCtrl = mac ? parsed.control : parsed.control || parsed.commandOrControl;
  const wantMeta = mac ? parsed.commandOrControl || parsed.super : parsed.super;
  return (
    event.ctrlKey === wantCtrl &&
    event.metaKey === wantMeta &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift &&
    event.key.toUpperCase() === parsed.key
  );
}

/**
 * 键帽文案：`Ctrl + Alt + H`。
 *
 * 按平台挑主修饰键的写法（macOS 用 ⌘），其余修饰键用常见缩写——这一串只用于展示，
 * 判定与注册用的都是 {@link normalizeGlobalHotkey} 的产物。
 *
 * @param combo - 组合键文本。
 * @param platform - 判平台的串（测试注入）。
 * @returns 展示串；空串（= 关闭）时返回空串。
 */
export function globalHotkeyCap(combo: string, platform?: string): string {
  const parsed = parseGlobalHotkey(combo);
  if (parsed === null) return '';
  const mac = isMacLike(platform);
  const parts: string[] = [];
  if (parsed.control) parts.push('Ctrl');
  if (parsed.commandOrControl) parts.push(mac ? '⌘' : 'Ctrl');
  if (parsed.alt) parts.push(mac ? '⌥' : 'Alt');
  if (parsed.shift) parts.push(mac ? '⇧' : 'Shift');
  if (parsed.super) parts.push(mac ? '⌘' : 'Win');
  parts.push(parsed.key);
  return parts.join(' + ');
}
