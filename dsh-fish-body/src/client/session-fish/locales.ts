/**
 * 会话鱼浮层的文案：8 种内置语言各一份。
 *
 * 这里只放浮层文案（新会话 / 关闭 / 打开 / 计数）；设置页文案已并入 `pet.config` 的 `fish.*`。
 * zh 是键集真源，其余语言用 `Record<Key, string>` 锁住，漏翻一个键在类型检查期就报错。
 * 只放本功能的 UI 文案；播报台词由宿主生成，不走这里。
 * @module dsh-fish-body/src/client/session-fish/locales
 */

/** 命名空间：与设置页主字典分开，避免把会话鱼的字塞进「桌宠配置」。 */
export const NS = 'pet.sessionFish';

/** 中文（键集真源）。 */
export const zh = {
  newSession: '新会话',
  closeFish: '关闭这条会话鱼',
  openSession: '打开会话',
  countHint: '当前显示 {n} 条（上限 {max}）。',
} as const;

/** 文案键。 */
export type Key = keyof typeof zh;

/** 英文。 */
export const en: Record<Key, string> = {
  newSession: 'New session',
  closeFish: 'Dismiss this session fish',
  openSession: 'Open session',
  countHint: 'Showing {n} of at most {max}.',
};

/** 日文。 */
export const ja: Record<Key, string> = {
  newSession: '新しいセッション',
  closeFish: 'このセッション魚を閉じる',
  openSession: 'セッションを開く',
  countHint: '表示中 {n} / 上限 {max}。',
};

/** 西班牙语。 */
export const es: Record<Key, string> = {
  newSession: 'Sesión nueva',
  closeFish: 'Cerrar este pez de sesión',
  openSession: 'Abrir sesión',
  countHint: 'Mostrando {n} de {max}.',
};

/** 法语。 */
export const fr: Record<Key, string> = {
  newSession: 'Nouvelle session',
  closeFish: 'Fermer ce poisson de session',
  openSession: 'Ouvrir la session',
  countHint: 'Affichage de {n} sur {max}.',
};

/** 德语。 */
export const de: Record<Key, string> = {
  newSession: 'Neue Sitzung',
  closeFish: 'Diesen Sitzungsfisch schließen',
  openSession: 'Sitzung öffnen',
  countHint: 'Zeige {n} von höchstens {max}.',
};

/** 俄语。 */
export const ru: Record<Key, string> = {
  newSession: 'Новая сессия',
  closeFish: 'Закрыть эту рыбку сессии',
  openSession: 'Открыть сессию',
  countHint: 'Показано {n} из {max}.',
};

/** 葡萄牙语。 */
export const pt: Record<Key, string> = {
  newSession: 'Nova sessão',
  closeFish: 'Fechar este peixe de sessão',
  openSession: 'Abrir sessão',
  countHint: 'Mostrando {n} de no máximo {max}.',
};

/** 宿主按语言 id 取用的整包字典。 */
export const dicts = { zh, en, ja, es, fr, de, ru, pt };
