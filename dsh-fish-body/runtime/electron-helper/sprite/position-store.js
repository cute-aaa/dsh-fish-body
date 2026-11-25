/**
 * 桌宠自己占的位置（归一化中心）的本地记忆：**换皮肤 / 重启 Helper 之后不能把人挪走**。
 *
 * 为什么需要它：桌面端切渲染方式或模型走的是「改配置 → 重启 Helper」，而 Helper 里的位置是
 * 会话内状态（`this.customPos`），一重启就回角落。用户拖到哪儿、切个皮肤就被弹回配置角落，
 * 看起来就是「切皮肤顺手把我摆的位置重置了」——这是本模块要修的那件事。
 *
 * 为什么不能无脑恢复：位置还有另一个真源——配置里的 `position.{corner,marginX,marginY}`。
 * 用户改角落/边距是明确的「放这里」，此时必须忽略旧位置（网页端同一条规则：位置配置一变就
 * 清掉会话内的拖拽位置，见 `src/client/pet/card/runtime.ts`）。所以记录里带一份**配置签名**，
 * 签名不匹配就当没记过——切皮肤时签名不变 → 恢复；改角落时签名变了 → 落到新角落。
 *
 * 存储：渲染端窗口是 `file://` 页面，`localStorage` 与 DSH 网页不同源，两边各记各的
 * （与 `sprite/fish.js` 里会话鱼的位置记忆同一套做法）。存储可能满、可能被禁用，
 * 一律当成「这次不记」而不是报错——位置记忆坏了不该让宠物起不来。
 *
 * 本文件既是渲染端的经典脚本（挂 `PetPositionStore` 全局），也是 node 侧单测要 require 的模块，
 * 所以导出走双分支；不要在顶层碰 `window`/`document`。
 * @module dsh-fish-body/runtime/electron-helper/sprite/position-store
 */
'use strict';

/** 存储键前缀；每只宠物一条（同一 `file://` 源下所有宠物共用一个 localStorage）。 */
const POSITION_KEY_PREFIX = 'fish-body:pet-pos:';

/**
 * 存储键。
 *
 * @param {string} petId - 宠物 id。
 * @returns {string} 形如 `fish-body:pet-pos:main`。
 */
function positionKeyOf(petId) {
  return POSITION_KEY_PREFIX + String(petId);
}

/**
 * 位置配置的签名：`corner|marginX|marginY`。
 *
 * 签名一变就说明用户改过「摆哪儿」，旧坐标立即失效；只切皮肤时这份配置不动，签名不变。
 *
 * @param {{corner?: unknown, marginX?: unknown, marginY?: unknown}|null|undefined} position - 成品配置里的 position。
 * @returns {string} 签名；取不到时为空串（空串永远不等于记录里的非空签名，等价于「没有记录」）。
 */
function signatureOf(position) {
  if (!position || typeof position !== 'object') return '';
  const corner = typeof position.corner === 'string' ? position.corner : '';
  if (corner === '') return '';
  const marginX = Number(position.marginX);
  const marginY = Number(position.marginY);
  if (!Number.isFinite(marginX) || !Number.isFinite(marginY)) return '';
  return corner + '|' + marginX + '|' + marginY;
}

/**
 * 把一个候选坐标夹进 [0, 1]。
 *
 * 只认**数字**：`null` / 字符串 / 布尔都不认——`Number(null)` 是 0，放过去等于把一条坏记录
 * 悄悄变成「左上角」，宠物会莫名跳到那儿。
 */
function clampRatio(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(Math.max(value, 0), 1);
}

/**
 * 读回本宠物上次的位置。
 *
 * @param {{getItem: (key: string) => (string|null)}|null|undefined} storage - localStorage 形状的存储。
 * @param {string} petId - 宠物 id。
 * @param {string} signature - 当前位置配置签名（见 {@link signatureOf}）。
 * @returns {{rx: number, ry: number}|null} 可用坐标；没记过 / 读坏 / 签名不符一律 null。
 */
function readPetPosition(storage, petId, signature) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  if (!petId || typeof signature !== 'string' || signature === '') return null;
  let raw;
  try {
    raw = storage.getItem(positionKeyOf(petId));
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.sig !== signature) return null;
  const rx = clampRatio(parsed.rx);
  const ry = clampRatio(parsed.ry);
  if (rx === null || ry === null) return null;
  return { rx, ry };
}

/**
 * 记住本次位置。
 *
 * @param {{setItem: (key: string, value: string) => void}|null|undefined} storage - localStorage 形状的存储。
 * @param {string} petId - 宠物 id。
 * @param {{rx: number, ry: number}} pos - 归一化中心。
 * @param {string} signature - 当前位置配置签名。
 * @returns {boolean} 真的写进去了为 true；存储不可用 / 值非法 / 写入抛错为 false（调用方不必处理）。
 */
function writePetPosition(storage, petId, pos, signature) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  if (!petId || typeof signature !== 'string' || signature === '') return false;
  if (!pos || typeof pos !== 'object') return false;
  const rx = clampRatio(pos.rx);
  const ry = clampRatio(pos.ry);
  if (rx === null || ry === null) return false;
  try {
    storage.setItem(positionKeyOf(petId), JSON.stringify({ rx, ry, sig: signature }));
    return true;
  } catch {
    return false;
  }
}

/**
 * 忘掉本宠物的位置（菜单「回到原位」用：回到角落之后再重启也不该跳回旧坐标）。
 *
 * @param {{removeItem: (key: string) => void}|null|undefined} storage - localStorage 形状的存储。
 * @param {string} petId - 宠物 id。
 * @returns {boolean} 真的删了为 true。
 */
function clearPetPosition(storage, petId) {
  if (!storage || typeof storage.removeItem !== 'function') return false;
  if (!petId) return false;
  try {
    storage.removeItem(positionKeyOf(petId));
    return true;
  } catch {
    return false;
  }
}

const PetPositionStore = { positionKeyOf, readPetPosition, signatureOf, writePetPosition, clearPetPosition };

/* 渲染端：经典脚本，挂全局给 sprite/init.js、sprite/motion.js 用；node 侧：走 module.exports 给单测。 */
if (typeof module === 'object' && module.exports) module.exports = PetPositionStore;
else globalThis.PetPositionStore = PetPositionStore;
