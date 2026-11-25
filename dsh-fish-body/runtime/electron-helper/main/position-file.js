/**
 * 桌宠位置的**落盘**记忆（主进程侧，同步读写）。
 *
 * 为什么不继续只用渲染端的 `localStorage`：Windows 上宿主重启 Helper 走的是 `child.kill()`
 * （libuv 在 Windows 上就是 TerminateProcess），进程被硬杀时 Chromium 还没来得及把
 * localStorage 刷进 leveldb——实测「拖完 0.4 秒就切皮肤」读回来的仍是上一个位置。
 * 而切皮肤恰恰是「改配置 → 重启 Helper」这条路，于是位置记忆在最需要它的时候失效。
 *
 * 所以这里换成主进程同步写一个小 JSON：渲染端经 `petBridge.savePosition`（`sendSync`）把它落盘，
 * 写完才继续，进程随后被杀也不影响。校验与「位置配置签名」判据复用渲染端那份
 * （`sprite/position-store.js`），两处只保留一套规则。
 *
 * 文件：`<userData>/pet-positions.json`，形如 `{ "main": { "rx": 0.4, "ry": 0.6, "sig": "top-right|24|100" } }`。
 * 读坏 / 写不进一律降级成「没有记忆」，绝不让重启失败。
 * @module dsh-fish-body/runtime/electron-helper/main/position-file
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readPetPosition, signatureOf, writePetPosition, clearPetPosition } = require('../sprite/position-store.js');

/** 文件名（放在 userData 根下）。 */
const FILE_NAME = 'pet-positions.json';

/**
 * 造一个「位置文件」句柄。
 *
 * @param {object} input - 依赖。
 * @param {string} input.dir - 落盘目录（通常是 `app.getPath('userData')`）。
 * @param {object} [input.fileSystem] - fs 替身（单测注入；缺省用 `node:fs`）。
 * @returns {{ read: (petId: string, sig: string) => ({rx: number, ry: number}|null), write: (petId: string, pos: {rx: number, ry: number}, sig: string) => boolean, clear: (petId: string) => boolean, file: string }} 句柄。
 */
function createPositionFile({ dir, fileSystem = fs }) {
  const file = path.join(dir, FILE_NAME);

  /** 读整份表；读不到 / 读坏都当空表（不抛）。 */
  function loadAll() {
    let raw;
    try {
      raw = fileSystem.readFileSync(file, 'utf8');
    } catch {
      return {};
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  }

  /** 同步落盘；失败只返回 false（位置记忆坏了不该影响宠物）。 */
  function saveAll(all) {
    try {
      fileSystem.mkdirSync(dir, { recursive: true });
      fileSystem.writeFileSync(file, JSON.stringify(all), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  return {
    file,
    /**
     * 读某只宠物上次的位置（签名不符视为没有记录——位置配置改过就该落到新角落）。
     *
     * @param {string} petId - 宠物 id。
     * @param {string} sig - 当前位置配置签名。
     * @returns {{rx: number, ry: number}|null} 坐标或 null。
     */
    read(petId, sig) {
      // 复用渲染端那套校验：这里传一个「只含该条记录」的 storage 替身，避免把判据写第二遍。
      const all = loadAll();
      const entry = typeof petId === 'string' && petId !== '' ? all[petId] : undefined;
      if (!entry || typeof entry !== 'object') return null;
      const only = {
        getItem: () => JSON.stringify(entry),
        setItem: () => undefined,
        removeItem: () => undefined,
      };
      return readPetPosition(only, petId, sig);
    },
    /**
     * 写某只宠物当前的位置（同步；返回时磁盘上已经有了）。
     *
     * @param {string} petId - 宠物 id。
     * @param {{rx: number, ry: number}} pos - 归一化中心。
     * @param {string} sig - 位置配置签名。
     * @returns {boolean} 真的写进去了为 true。
     */
    write(petId, pos, sig) {
      const all = loadAll();
      const probe = {
        getItem: () => null,
        setItem: (_key, value) => {
          all[petId] = JSON.parse(value);
        },
        removeItem: () => undefined,
      };
      if (!writePetPosition(probe, petId, pos, sig === '' ? signatureOf(null) : sig)) return false;
      return saveAll(all);
    },
    /**
     * 忘掉某只宠物的位置（菜单「回到原位」）。
     *
     * @param {string} petId - 宠物 id。
     * @returns {boolean} 真的删了（或本来就没有）为 true。
     */
    clear(petId) {
      const all = loadAll();
      if (!Object.hasOwn(all, petId)) return true;
      const probe = {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => {
          delete all[petId];
        },
      };
      clearPetPosition(probe, petId);
      return saveAll(all);
    },
  };
}

module.exports = { createPositionFile, FILE_NAME };
