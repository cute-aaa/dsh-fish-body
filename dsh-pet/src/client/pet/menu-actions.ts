/**
 * 右键菜单的动作派发：把菜单叶子（内置动作、第三方项、显示位置、点播动画）翻译成一次副作用。
 * 只做「点了之后发生什么」，不建菜单、不管浮层定位与开关时序——那些归右键入口。
 * 依赖以取值函数注入，避免捕获渲染期的状态快照。
 * @module dsh-pet/src/client/pet/menu-actions
 */
import { isNoMirrorAnimation, isSleepAllowedAction } from '../../shared/menu.ts';
import type { MenuLeaf } from '../../shared/menu.ts';
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { Animations } from '../../shared/types.ts';
import { postAction } from '../../shared/state.ts';
import { setMenuClick } from '../menu-service.ts';

/** 菜单派发的依赖。 */
export interface MenuActionDeps {
  /** 宠物 id：上报、点播与显示位置切换都要带。 */
  petId: string;
  /** 该宠物的动画池（移动池、分类镜像规则都读它）。 */
  animations: () => Animations;
  /** 当前朝向是否为右（文字类动画强制朝左前先看它）。 */
  isFacingRight: () => boolean;
  /** 把朝向改成左，并同步给换源用的事实值。 */
  faceLeft: () => void;
  /** 试发起一次走位；`true` = 占用中，`false` = 无法移动，字符串 = 动作名。 */
  tryMove: (preferredName?: string) => boolean | string;
  /** 停掉走位与位置跟随。 */
  stopMove: () => void;
  /** 停掉抛掷飞行。 */
  stopThrow: () => void;
  /** 提交一次自播切换（once 语义）。 */
  playOnce: (anim: string, playbackId: string | null) => void;
  /** 渲染器自带动作（layered 装配手势 / live2d motion、expression）：直接交给渲染实例，不进动画链。 */
  playRendererAction?: (name: string) => void;
  /** 清掉会话位置，回到配置角落。 */
  resetPosition: () => void;
  /** 打开对话弹窗。 */
  openChat: () => void;
  /** 打开待办面板。 */
  openTodo: () => void;
  /** 上报点播回执。 */
  report: (playbackId: string, status: 'failed', reason: string) => void;
  /** 显示位置切换后，把宿主回的成品聚合交给容器重渲染。 */
  applyMerged: (merged: Record<string, Record<string, unknown>>) => void;
  /** 动作失败时打一行告警（文案自带原因）。 */
  warn: (message: string) => void;
  /** 是否在睡：睡着时任何「打扰类」动作只弹拒绝台词、不执行。缺省视为醒着。 */
  sleeping?: () => boolean;
  /** 是否被占用锁冻结：锁的语义是把控制权交给第三方，此时睡觉闸门让路。缺省视为未持锁。 */
  locked?: () => boolean;
  /** 弹一句气泡（拒绝台词用，不换动画）。缺省 = 不弹。 */
  say?: (text: string) => void;
  /** 睡觉拒绝台词池（条目级配置）。缺省 = 静默拒绝，不弹文字。 */
  sleepRefuseTexts?: () => string[];
}

/** 睡着时仍然放行的菜单动作由 shared/menu 的 isSleepAllowedAction 判定（两端共用一份）。 */

/** 菜单动作派发器。 */
export interface MenuActions {
  /**
   * 执行一个菜单叶子。
   *
   * @param leaf - 菜单叶子：内置动作或一个待点播的动画。
   * @param playbackId - 本次点播编号；自播动画不传。
   * @param keepFacing - 跳过「文字类强制朝左」的镜像修正，显式朝向优先。
   * @param hostInstruction - 这条是宿主写进 `pets.<id>.anim` 的显式指令（不是用户点菜单）：
   *  渲染端不判睡觉，放不放行由宿主闸门按「锁优先」决定。
   */
  run: (leaf: MenuLeaf, playbackId?: string, keepFacing?: boolean, hostInstruction?: boolean) => void;
}

/** 显示位置：写配置后宿主回成品聚合，交给容器重渲染。 */
async function switchDisplay(deps: MenuActionDeps, display: string): Promise<void> {
  try {
    const response = await fetch(ROUTE_PATH + '/pet-display', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: deps.petId, display }),
    });
    if (!response.ok) throw new Error('pet-display HTTP ' + response.status);
    const body = (await response.json()) as Record<string, unknown>;
    // 业务失败是 HTTP 200 + {ok:false, reason}：只看状态码会把失败体当成成品聚合。
    if (body.ok === false) throw new Error('pet-display 被拒：' + String(body.reason ?? ''));
    // 响应体就是改动后的成品聚合，必须交给容器；否则会再拉一次 GET /config，可能拿到旧值。
    deps.applyMerged(body as Record<string, Record<string, unknown>>);
  } catch (error) {
    deps.warn('[dsh-pet] 显示位置切换失败 ' + (error instanceof Error ? error.message : String(error)));
  }
}

/** 渲染方式：写配置后宿主回成品聚合，交给容器重渲染（stage 即时重建）。 */
async function switchRenderer(deps: MenuActionDeps, renderer: string): Promise<void> {
  try {
    const response = await fetch(ROUTE_PATH + '/pet-renderer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: deps.petId, renderer }),
    });
    if (!response.ok) throw new Error('pet-renderer HTTP ' + response.status);
    const body = (await response.json()) as Record<string, unknown>;
    if (body.ok === false) throw new Error('pet-renderer 被拒：' + String(body.reason ?? ''));
    deps.applyMerged(body as Record<string, Record<string, unknown>>);
  } catch (error) {
    deps.warn('[dsh-pet] 渲染方式切换失败 ' + (error instanceof Error ? error.message : String(error)));
  }
}

/** 皮肤/模型：写配置后宿主回成品聚合，交给容器重渲染（live2d/layered 换模型）。 */
async function switchModel(deps: MenuActionDeps, model: string): Promise<void> {
  try {
    const response = await fetch(ROUTE_PATH + '/pet-model', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: deps.petId, model }),
    });
    if (!response.ok) throw new Error('pet-model HTTP ' + response.status);
    const body = (await response.json()) as Record<string, unknown>;
    if (body.ok === false) throw new Error('pet-model 被拒：' + String(body.reason ?? ''));
    deps.applyMerged(body as Record<string, Record<string, unknown>>);
  } catch (error) {
    deps.warn('[dsh-pet] 模型切换失败 ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * 大小：写当前渲染方式的画框宽度，宿主回成品聚合。
 *
 * 不传 renderer——由宿主按该宠物现有渲染方式落键，菜单这里少一个可能与配置不同步的参数。
 *
 * @param deps - 派发依赖（宠物 id 与聚合回填）。
 * @param size - 目标宽度 px；undefined = 删掉该渲染方式的覆盖。
 */
async function switchSize(deps: MenuActionDeps, size: number | undefined): Promise<void> {
  try {
    const payload = size === undefined ? { id: deps.petId, size: null } : { id: deps.petId, size };
    const response = await fetch(ROUTE_PATH + '/pet-size', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error('pet-size HTTP ' + response.status);
    const body = (await response.json()) as Record<string, unknown>;
    if (body.ok === false) throw new Error('pet-size 被拒：' + String(body.reason ?? ''));
    deps.applyMerged(body as Record<string, Record<string, unknown>>);
  } catch (error) {
    deps.warn('[dsh-pet] 改大小失败 ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * 重启插件：POST 一次让宿主重新组合本插件。
 *
 * 有 HMR 时宿主换掉「文件已变」的插件（含 link 进来的包），浏览器再刷新一次拿新的 client.js；
 * 没有 HMR 时进程内换不掉已加载的 ESM，只有桌面窗口会重建——如实提示，不假装成功。
 */
async function restartPlugin(deps: MenuActionDeps): Promise<void> {
  try {
    const response = await fetch(ROUTE_PATH + '/plugin-restart', { method: 'POST' });
    const body = (await response.json()) as { ok?: unknown; mode?: unknown };
    if (!response.ok || body.ok === false) throw new Error('plugin-restart HTTP ' + response.status);
    const mode = body.mode === 'hmr' ? 'hmr' : 'helper';
    console.info('[dsh-pet] 插件重启已触发 pet=' + deps.petId + ' mode=' + mode);
    if (mode === 'hmr') {
      if (typeof window !== 'undefined') window.setTimeout(() => window.location.reload(), 1200);
      return;
    }
    deps.warn('[dsh-pet] 宿主未启用 HMR：宿主代码改动仍需重启 profile，桌面窗口已重建');
  } catch (error) {
    deps.warn('[dsh-pet] 插件重启失败 ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * 造菜单派发器。
 *
 * @param deps - 宠物标识、动画池与各种副作用回调。
 * @returns 单一入口 {@link MenuActions.run}。
 */
export function createMenuActions(deps: MenuActionDeps): MenuActions {
  const { petId } = deps;

  /** 动作端点：POST 一次，失败只留一行 warn——结果由 /state 送回，这里没有返回值可用。 */
  const fireAction = (route: string, label: string): void => {
    postAction(route)
      .then((ok: boolean) => {
        if (!ok) deps.warn('[dsh-pet] ' + label + '失败 pet=' + petId);
      })
      .catch((error: unknown) => deps.warn('[dsh-pet] ' + label + '异常 pet=' + petId + ' ' + String(error)));
  };

  const run = (leaf: MenuLeaf, playbackId?: string, keepFacing = false, hostInstruction = false): void => {
    // 睡觉：打扰类动作在点击这一刻就拒绝——弹一句台词，什么都不执行。
    // 放在最前面是有意的：对话弹窗、待办面板、动作点播都是纯前端行为，宿主闸门拦不到它们。
    // hostInstruction：宿主写进 pets.<id>.anim 的显式指令（第三方带锁点播 / 外部驱动）不在此判——
    // 该不该放行由宿主闸门按「锁优先」决定；渲染端再拦一次会输给叶子到达的时序差。
    if (
      !hostInstruction &&
      deps.sleeping?.() === true &&
      deps.locked?.() !== true &&
      !isSleepAllowedAction(leaf.action)
    ) {
      const pool = deps.sleepRefuseTexts?.() ?? [];
      const text = pool[Math.floor(Math.random() * pool.length)];
      if (text !== undefined) deps.say?.(text);
      return;
    }
    if (leaf.action === 'third-party') {
      // 第三方菜单项只上报 owner、label 与当前宠物 id，具体动作由注册方查询。
      const owner = leaf.owner ?? '';
      if (owner !== '') {
        // 同页消费者（petApi7340.menuEvents）当场就能取到；HTTP 照旧上报，桌面端与老扩展仍读宿主那份。
        setMenuClick(owner, leaf.label, petId);
        postAction(ROUTE_PATH + '/menu/click', { owner, label: leaf.label, pet: petId }).catch((error: unknown) =>
          deps.warn('[dsh-pet] 第三方菜单点击上报失败 ' + String(error)),
        );
      }
      return;
    }
    if (leaf.action === 'sleep' || leaf.action === 'wake') {
      // 睡觉/起来都由宿主定状态：渲染端只发意图，三段动画名与闸门都在宿主那一侧
      const route = leaf.action === 'sleep' ? '/sleep' : '/wake';
      console.info('[dsh-pet] 菜单' + (leaf.action === 'sleep' ? '睡觉' : '起来') + ' pet=' + petId);
      fireAction(ROUTE_PATH + route + '?pet=' + encodeURIComponent(petId), leaf.action === 'sleep' ? '睡觉' : '起来');
      return;
    }
    if (leaf.action === 'show-balance') {
      // 动作端点让宿主刷新并写入 /state，页面什么都不用做。
      console.info('[dsh-pet] 菜单查看余额 pet=' + petId);
      fireAction(ROUTE_PATH + '/balance', '余额刷新动作');
      return;
    }
    if (leaf.action === 'whisper') {
      // 手动碎碎念：文本随长轮询送达，不受 whisperEnabled 限制；surface 必填，本页面就是网页端。
      console.info('[dsh-pet] 菜单触发碎碎念 pet=' + petId + (leaf.image ? ' image=' + leaf.image : ''));
      // 「配图」菜单点的是具体某张 → 带名称让宿主用这张（不在池内宿主会回 unknown-image）；
      // 其余入口不带，仍按配置随机抽图。名称可能含空格与中文，必须编码。
      const pic = leaf.image ? '&image=' + encodeURIComponent(leaf.image) : '';
      fireAction(ROUTE_PATH + '/whisper?pet=' + encodeURIComponent(petId) + '&surface=web' + pic, '碎碎念手动触发');
      return;
    }
    if (leaf.action === 'chat') {
      deps.openChat();
      return;
    }
    if (leaf.action === 'todo') {
      deps.openTodo();
      return;
    }
    if (leaf.action === 'set-display') {
      const display = leaf.display;
      if (!display) return;
      console.info('[dsh-pet] 菜单切换显示位置 pet=' + petId + ' display=' + display);
      void switchDisplay(deps, display);
      return;
    }
    if (leaf.action === 'set-renderer') {
      const renderer = leaf.renderer;
      if (!renderer) return;
      console.info('[dsh-pet] 菜单切换渲染方式 pet=' + petId + ' renderer=' + renderer);
      void switchRenderer(deps, renderer);
      return;
    }
    if (leaf.action === 'set-model') {
      const model = leaf.model;
      if (model === undefined) return;
      console.info('[dsh-pet] 菜单切换模型 pet=' + petId + ' model=' + model);
      void switchModel(deps, model);
      return;
    }
    if (leaf.action === 'set-size') {
      // size 缺省 = 删掉当前渲染方式的覆盖，回落 pets[].size；宿主按该宠物现有 renderer 落键。
      console.info('[dsh-pet] 菜单改大小 pet=' + petId + ' size=' + String(leaf.size ?? '默认'));
      void switchSize(deps, leaf.size);
      return;
    }
    if (leaf.action === 'renderer-action') {
      const action = leaf.rendererAction;
      if (action === undefined) return;
      console.info('[dsh-pet] 菜单渲染器动作 pet=' + petId + ' action=' + action);
      // 直接交给渲染器：这类动作没有 webm 段，不进卡片动画链，也就没有播完回调可言。
      deps.playRendererAction?.(action);
      return;
    }
    if (leaf.action === 'reload-plugin') {
      console.info('[dsh-pet] 菜单重启插件 pet=' + petId);
      void restartPlugin(deps);
      return;
    }
    if (leaf.action === 'home') {
      // 回到初始位置：停漫游与抛掷，清掉会话位置，回配置角落。
      deps.stopThrow();
      deps.stopMove();
      deps.resetPosition();
      return;
    }
    if (!leaf.anim) return;
    const cuePlaybackId = playbackId ?? null;
    // 文字类朝右站姿是镜像的，点播前强制朝左；keepFacing 时跳过，显式朝向优先。
    if (!keepFacing && isNoMirrorAnimation(deps.animations().categories, leaf.anim) && deps.isFacingRight()) {
      deps.faceLeft();
    }
    // 点播移动动画：走真实位移，仅「选哪个动画」由菜单决定；边界内挪不动时退化为纯播放。
    const movies = deps.animations().moves.actions;
    if (movies.some((action) => action.name === leaf.anim)) {
      if (deps.tryMove(leaf.anim) === false) {
        deps.stopMove();
        deps.playOnce(leaf.anim, cuePlaybackId);
      } else if (cuePlaybackId !== null) {
        // 移动系统接管，不换视频源，本段点播不会真的播起来，如实回 failed。
        deps.report(cuePlaybackId, 'failed', 'busy');
      }
      return;
    }
    deps.stopMove();
    deps.playOnce(leaf.anim, cuePlaybackId);
  };

  return { run };
}
