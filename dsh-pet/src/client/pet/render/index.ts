/**
 * 渲染后端装配：把三种实现注册进注册表，供宠物卡按 pets[].renderer 选一个。
 * layered / live2d 尚未落地，先挂占位实现（可见提示，不黑屏）；webm 是当前唯一完整实现。
 * 注册返回 disposer 由调用方决定生命周期；本模块只做一次性登记，不挂载、不读配置。
 * @module dsh-pet/src/client/pet/render
 */
import { registerRenderer } from './registry.ts';
import { createWebmRenderer } from './webm.ts';
import { createLayeredRenderer } from './layered.ts';
import { createPlaceholderRenderer } from './placeholder.ts';

/**
 * 注册全部渲染后端；重复调用会因 kind 重复而抛错，由调用方保证只调一次。
 *
 * @returns 一次性注销全部后端的函数。
 */
export function registerRenderers(): () => void {
  const disposers = [
    registerRenderer('webm', createWebmRenderer),
    registerRenderer('layered', createLayeredRenderer),
    registerRenderer('live2d', () => createPlaceholderRenderer('live2d')),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
