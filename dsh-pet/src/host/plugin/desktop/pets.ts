/**
 * 桌面宠物判定：按成品配置回答「现在要不要桌面窗、托盘要不要、窗口列表是什么」。
 * 三个取值函数每次现读配置，不缓存判定结果——缓存后下游拿到的是解构那一刻的快照，会一直用旧结论。
 * 读配置失败一律保守降级：按没有桌面宠物处理，托盘按仍要处理。
 * 不拉进程、不管重启时序（归 ./spawn 与 ./sync）。
 * @module dsh-pet/src/host/plugin/desktop/pets
 */
import { flattenPetList, readAllConfig } from '../../config.ts';
import { renderSizeOf } from '../../../shared/pet-size.ts';
import type { ConfigPaths } from '../../config.ts';
import type { DesktopHelperDeps } from './types.ts';

/** DesktopPets的输入。 */
export type DesktopPetsInput = Pick<DesktopHelperDeps, 'configPaths' | 'effectivePetList' | 'log'>;

/** 该宠物是否参与桌面模式（Electron 透明窗）。 */
const isDesktopVisible = (display: unknown): boolean => display === 'desktop' || display === 'both';

/** 一次现读的判定结果（`flattenPetList` 的元素形状由配置层决定，这里只关心数量与 display）。 */
interface DesktopDecision {
  /** 配置里的全部宠物。 */
  pets: Array<Record<string, unknown>>;
  /** 参与桌面模式的宠物。 */
  desktopPets: Array<Record<string, unknown>>;
}

/** 现读配置并算出判定；读不出来时抛出，由各取值函数决定降级方式。 */
function readDecision(configPaths: ConfigPaths): DesktopDecision {
  const merged = readAllConfig(configPaths);
  const pets = flattenPetList(merged);
  return { pets, desktopPets: pets.filter((pet) => isDesktopVisible(pet.display)) };
}

/**
 * 造桌面判定：三个取值函数 + 一行判定日志，都不持有状态。
 *
 * @param deps - 配置路径、桌面窗用的宠物列表来源与日志。
 * @returns 取值函数与诊断日志入口。
 */
export function createDesktopPets(deps: DesktopPetsInput) {
  const { configPaths, effectivePetList, log } = deps;

  /** 现在有没有桌面宠物；读配置失败按「没有」处理——宁可不起 helper，也不起一个没有宠物的空进程。 */
  const getHasDesktopPet = (): boolean => {
    try {
      return readDecision(configPaths).desktopPets.length > 0;
    } catch {
      return false;
    }
  };

  /** 托盘开关的当前值；读失败按「仍要托盘」处理（保守保留常驻图标）。 */
  const getTrayOn = (): boolean => {
    try {
      return readAllConfig(configPaths).main?.trayEnabled !== false;
    } catch {
      return true;
    }
  };

  /** 参与桌面窗的宠物（给 helper 的启动参数）；读失败返回空列表。
   *  尺寸按该宠物的渲染方式解析（`sizes[renderer]` 优先）：窗口首帧就按这套素材的大小建，
   *  等渲染端上报再纠正会先闪一下错尺寸。 */
  const desktopPetList = (): Array<{ id: string; size: number }> => {
    try {
      return effectivePetList()
        .filter((pet) => isDesktopVisible(pet.display))
        .map((pet) => ({ id: String(pet.id), size: renderSizeOf(pet) }));
    } catch {
      return [];
    }
  };

  /** 打一行判定日志（诊断用）：设置页显示「仅桌面」却没有 helper 进程时，这行能分辨宿主读到的是 web 还是 desktop。 */
  const logDesktopDecision = (): void => {
    try {
      const { pets, desktopPets } = readDecision(configPaths);
      const trayOn = readAllConfig(configPaths).main?.trayEnabled !== false;
      log.info(
        `[dsh-pet] 桌面判定：pets=${pets.length}，桌面可见=${desktopPets.length}` +
          `（${desktopPets.map((pet) => String(pet.id)).join(',') || '无'}）→` +
          ` hasDesktopPet=${desktopPets.length > 0} tray=${trayOn}`,
      );
      // 桌面 Helper 的三种渲染后端现在都落地了（webm 视频 / layered 画布 / live2d pixi），
      // 这里只留一行判定信息；挂载失败由渲染端自己的 warn 暴露（见 runtime/electron-helper/sprite/backend.js）。
      const renderers = desktopPets.map((pet) => `${String(pet.id)}=${String(pet.renderer ?? 'webm')}`).join('、');
      if (renderers !== '') log.info('[dsh-pet] 桌面渲染方式：' + renderers);
    } catch (e) {
      log.warn(`[dsh-pet] 宠物配置非法，桌面模式已跳过：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // 装配时先打一行，便于对照「这次进程起来时判定成了什么」。
  logDesktopDecision();

  return { getHasDesktopPet, getTrayOn, desktopPetList, logDesktopDecision };
}

/** DesktopPets的产出。 */
export type DesktopPets = ReturnType<typeof createDesktopPets>;
