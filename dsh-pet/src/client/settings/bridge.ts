/**
 * 容器（宠物页面）与设置页共享的桥：同一 bundle 内的单例，交换当前宠物列表与重载入口。
 * `current` 是最新成品拍平列表，只有容器写入；`reload` 由容器注册，缺省为空函数，设置页可在容器装配前先保存。
 * `template` 是 main 条目的首只宠物，给「添加宠物」当新实例的初值。
 * `ready` 表示成品配置已经拍平过一次：区分「还没加载」与「配置里确实没有宠物」——
 * 显示面判定（会话鱼跟着桌宠走）必须能分开这两件事，否则首帧会把浮层闪一下。
 * @module dsh-pet/src/client/settings/bridge
 */
import type { Pet } from '../../shared/types.ts';

/** 桥的唯一实例；字段是可变的，写入方各自固定（容器写 current / reload / ready，设置页只读）。 */
export const petBridge: {
  current: Pet[];
  reload: (merged?: Record<string, Record<string, unknown>>) => void;
  template: Pet | undefined;
  ready: boolean;
} = {
  current: [],
  reload: () => {},
  template: undefined,
  ready: false,
};

/** 「成品配置刚被重新拍平」的订阅者。 */
const listeners = new Set<() => void>();

/**
 * 订阅成品配置重新拍平。
 *
 * 显示面相关的浮层（会话鱼）要靠它立刻跟着 `display` 变化：只等 `/state` 轮询的话，
 * 改完设置最长要等一次长轮询超时（10s）才生效。
 *
 * @param listener - 配置更新回调。
 * @returns 取消订阅；组件卸载时必须调用。
 */
export function subscribePetBridge(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 通知订阅者配置已重新拍平（只有容器调用）；单个订阅者抛错不挡住其余。 */
export function notifyPetBridge(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn('[dsh-pet] 配置订阅者抛错：', error);
    }
  }
}
