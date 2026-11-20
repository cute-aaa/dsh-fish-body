/**
 * 设置页的宠物列表状态：种类标签、当前种类的实例列表与选中项。
 *
 * 两级视图：种类条决定「看哪个种类」，宠物条只渲染该种类的实例。每只实例靠 `assetRoot`
 * 记住自己属于哪个种类，保存时据此决定写回哪个文件。
 * 列表初值来自容器拍平的成品，加载完成前先显示它；删除要确认，所以只发「请求删除」。
 * @module dsh-fish-body/src/client/settings/use-pet-list
 */
import type { Pet } from '../../shared/types.ts';
import type { ConfigEntry, PackWrite } from './config/index.ts';
import { diffPackWrites } from './config/index.ts';
import type { DialogState } from './dialog.ts';
import { petBridge } from './bridge.ts';
import { draftPet, nextPetId } from './pet-draft.ts';
import type { PetPatch } from './pet-card-parts.ts';
import type { SettingsRuntime } from './runtime.ts';
import { settingsTabStorage } from './tab-memory.ts';
import { readPetSelection, resolveSelection, savePetSelection } from './selection-memory.ts';

/** 种类条的一项。 */
export interface PetKind {
  /** 条目名：`main` 或 pet/<前缀>-config.json 的前缀。 */
  readonly entry: string;
  /** `main` 显示为「内置」，其余直接显示前缀。 */
  readonly kind: 'main' | 'pack';
  /** 该种类的实例数（标签上括注）。 */
  readonly count: number;
}

/**
 * 把拍平的实例列表按 `assetRoot` 归纳成种类列表（顺序即首次出现顺序）。
 *
 * @param pets - 全条目的实例列表。
 * @returns 种类列表；没有 `assetRoot` 的实例归到 main。
 */
export function petKinds(pets: readonly Pet[]): PetKind[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const pet of pets) {
    const entry = pet.assetRoot ?? 'main';
    if (!counts.has(entry)) order.push(entry);
    counts.set(entry, (counts.get(entry) ?? 0) + 1);
  }
  return order.map((entry) => ({
    entry,
    kind: entry === 'main' ? 'main' : 'pack',
    count: counts.get(entry) ?? 0,
  }));
}

/**
 * 只属于 main 层的实例。
 *
 * `PUT /config` 写的是用户主配置（`main-config.jsonc`），只能收 main 层的实例：带上其它种类
 * 会把它们复制进 main 层，读回时与该种类自己的文件撞 id，合并器随后跳过种类实例并回落默认宠物。
 *
 * @param pets - 全条目的实例列表。
 * @returns main 层的实例（没有 `assetRoot` 的也算 main）。
 */
export function mainPetsOf(pets: readonly Pet[]): Pet[] {
  return pets.filter((pet) => (pet.assetRoot ?? 'main') === 'main');
}

/** 宠物列表状态与操作。 */
export interface PetList {
  /** 可编辑的宠物列表（全条目，保存时按条目分组）。 */
  pets: Pet[];
  /** 只属于 main 层的实例：`PUT /config` 的提交内容。 */
  mainPets: Pet[];
  /** 种类条的数据源。 */
  kinds: PetKind[];
  /** 当前选中的种类（条目名）。 */
  kind: string;
  /** 当前种类的实例（宠物标签条的数据源）。 */
  visiblePets: Pet[];
  /** 当前选中的宠物 id。 */
  selId: string;
  /** 当前宠物所属条目的人设正文，作为实例人设「留空时跟随什么」的预览。 */
  entryPrompt: string;
  /** 切到另一只宠物。 */
  select: (id: string) => void;
  /** 切到另一个种类，并选中它的第一只。 */
  selectKind: (entry: string) => void;
  /** 改选中宠物的字段。 */
  update: (patch: PetPatch) => void;
  /** 往当前种类加一只并选中它。 */
  add: () => void;
  /** 请求删除当前宠物（交给弹窗确认）。 */
  requestRemove: () => void;
  /** 确认后真的删除；该种类只剩一只时由调用方拦住。 */
  remove: () => void;
  /** 用成品里的条目列表整体替换（加载 / 同步后），尽量保持当前种类与选中项。 */
  replace: (entries: readonly ConfigEntry[]) => void;
  /** 与加载快照比较，算出本次要写回的种类层（main 不在其中）。 */
  packWrites: () => PackWrite[];
}

/**
 * 管理宠物列表状态。
 *
 * @param rt - 只用到 `useState`、`useCallback` 与 `useRef`。
 * @param requestDialog - 打开确认弹窗（`lastOne` / `lastOfKind` / `remove`）。
 * @returns 列表状态与全部操作。
 */
export function usePetList(
  rt: Pick<SettingsRuntime, 'useState' | 'useCallback' | 'useRef'>,
  requestDialog: (dialog: DialogState) => void,
): PetList {
  const { useState, useCallback, useRef } = rt;
  // 初值取容器拍平的成品：加载完成前先显示这份，避免整页闪空白。加载期间整页只读，不会被提交。
  const initial = petBridge.current;
  // 首次渲染就把「上次选中的那只」解析出来（无 IO、无闪烁）：只读一次存储，之后靠 ref 复用。
  // `saved` 单独留着：首帧列表可能还不完整（容器拍平是异步的），那时解析出来的只是回落值，
  // 记忆本身不能丢——`replace()` 要用它再校验一次（E2E 抓到的真实缺口）。
  const firstRef = useRef<{ saved: string | null; petId: string; kind: string } | null>(null);
  const first =
    firstRef.current ??
    (() => {
      const saved = readPetSelection(settingsTabStorage());
      const resolved = resolveSelection(saved, initial, initial[0]?.assetRoot ?? 'main');
      return { saved, petId: resolved.petId, kind: resolved.kind };
    })();
  firstRef.current = first;
  /** 「记住的候选」：用户动作会更新它；`replace()` 只读它，保证权威列表到达时记忆还在。 */
  const savedRef = useRef<string | null>(first.saved);
  /** 写记忆的唯一入口：ref 与存储一起更新，两者不会各说一套。 */
  const remember = (petId: string): void => {
    savedRef.current = petId === '' ? null : petId;
    savePetSelection(settingsTabStorage(), petId);
  };
  const [pets, setPets] = useState<Pet[]>(initial.map((pet) => ({ ...pet, position: { ...pet.position } })));
  const [kind, setKind] = useState<string>(first.kind);
  const [selId, setSelId] = useState<string>(first.petId);
  // 加载快照：写回计划要拿它做比较，放在 ref 里避免多一次渲染。
  const loadedRef = useRef<readonly ConfigEntry[]>([]);
  // 当前种类也要能在 replace 的稳定回调里读到最新值（回调不能依赖 kind 状态）。
  const kindRef = useRef(kind);
  kindRef.current = kind;

  // 更新选中的宠物：size 走顶层；position 子字段整体替换
  const update = (patch: PetPatch): void =>
    setPets((list) =>
      list.map((pet) => {
        if (pet.id !== selId) return pet;
        const { position: posPatch, ...rest } = patch;
        return { ...pet, ...rest, position: posPatch ? { ...pet.position, ...posPatch } : pet.position };
      }),
    );

  const add = (): void => {
    const group = pets.filter((pet) => (pet.assetRoot ?? 'main') === kind);
    const template = group[0];
    if (!template) return;
    const id = nextPetId(pets, kind);
    // 新实例跟着模板走（大小 / 位置 / 显示方式 / 开关），只把身份换成新 id 并挂上种类。
    const draft: Pet = { ...draftPet(template, id), assetRoot: kind };
    setPets((list) => {
      const next = [...list];
      // 插在该种类末尾：宠物条按种类过滤渲染，插到别处会把顺序打散。
      let at = -1;
      for (let i = 0; i < next.length; i += 1) if ((next[i].assetRoot ?? 'main') === kind) at = i;
      next.splice(at + 1, 0, draft);
      return next;
    });
    setSelId(id);
    remember(id);
  };

  const remove = (): void => {
    const list = pets.filter((pet) => pet.id !== selId);
    // 当前种类优先：这一种类还有别的实例就留在它上面；整种类删空了才换种类，
    // 并且把 kind 一起搬过去——否则卡片显示另一只、chip 行还停在已经没有条目的种类上，
    // 要等刷新才自纠（旧实现就是「取全部条目第一只但 kind 不变」）。
    const next = list.find((pet) => (pet.assetRoot ?? 'main') === kind) ?? list[0];
    const nextId = next?.id ?? '';
    const nextKind = next === undefined ? kind : (next.assetRoot ?? 'main');
    setPets(list);
    setKind(nextKind);
    setSelId(nextId);
    // 只在真的落到某一只时才记：空列表记空串会盖掉上一次的记忆，而它下次仍要校验，记了也没意义。
    if (nextId !== '') remember(nextId);
  };

  // 只有 setState，跨渲染稳定：放进 applyConfig 的依赖里不会反复重拉配置。
  const replace = useCallback((entries: readonly ConfigEntry[]): void => {
    loadedRef.current = entries;
    const loaded = entries.flatMap((entry) => entry.pets);
    // 种类可能被删掉（同步回默认）：当前种类不在了就退回第一个。
    const nextKind = entries.some((entry) => entry.key === kindRef.current)
      ? kindRef.current
      : (entries[0]?.key ?? 'main');
    // 回落规则与首帧共用 resolveSelection：还在就留（并纠正种类）、不在就是 nextKind 的第一只。
    // 这里**不写存储**——它是对账而不是用户动作，写了会在每次加载时多制造一次写入。
    const resolved = resolveSelection(savedRef.current, loaded, nextKind);
    setPets(loaded);
    setKind(resolved.kind);
    setSelId(resolved.petId);
  }, []);

  const selectKind = (entry: string): void => {
    setKind(entry);
    const firstOfKind = pets.find((pet) => (pet.assetRoot ?? 'main') === entry);
    if (firstOfKind) {
      setSelId(firstOfKind.id);
      remember(firstOfKind.id);
    }
  };

  const current = pets.find((pet) => pet.id === selId);
  // 人设回落是「跟随所属条目」：main 用 main 那份，文件宠物用各自种类那份，不能串。
  const entryPrompt = loadedRef.current.find((item) => item.key === kind)?.entryPrompt ?? '';
  const requestRemove = (): void => {
    if (!current) return;
    const entry = current.assetRoot ?? 'main';
    const groupSize = pets.filter((pet) => (pet.assetRoot ?? 'main') === entry).length;
    // 每种至少留一只：删到 0 会被宿主按非法拒绝，也会让该种类退回默认宠物列表。
    if (groupSize <= 1) requestDialog(entry === 'main' ? { kind: 'lastOne' } : { kind: 'lastOfKind', entry });
    else requestDialog({ kind: 'remove' });
  };

  return {
    pets,
    mainPets: mainPetsOf(pets),
    kinds: petKinds(pets),
    kind,
    visiblePets: pets.filter((pet) => (pet.assetRoot ?? 'main') === kind),
    selId,
    entryPrompt,
    select: (id: string) => {
      setSelId(id);
      remember(id);
    },
    selectKind,
    update,
    add,
    requestRemove,
    remove,
    replace,
    packWrites: () => diffPackWrites(loadedRef.current, pets),
  };
}
