/**
 * 数据根内部的布局迁移：把继承自 dsh-pet 的平铺目录搬进 `config/ data/ cache/ runtime/ skin/ assets/`。
 *
 * 规则只有一条硬约束：**绝不覆盖、绝不删除源**。
 * - 目标已存在 → 跳过并记一条 warn（谁新谁旧无从判断，猜错就是丢配置）；
 * - 源不存在 → 跳过（幂等：第二次启动什么都不会做）；
 * - 单个条目失败 → 记录后继续搬下一个（半迁移好过整次失败，下次启动会接着搬）。
 *
 * 迁移完写一份回执 `<root>/.layout.json`（相对路径），供 `scripts/migrate-layout.mjs --revert` 搬回。
 * @module dsh-fish-body/src/host/migrate-layout
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { POOL_LAYER_DIR, POOL_SOUND_DIR } from '../shared/pool.ts';

/** 一份搬迁：`from` 与 `to` 都是相对数据根的路径。 */
export interface LayoutMove {
  readonly from: string;
  readonly to: string;
  /**
   * 只从旧根搬（整组搬迁用）：`from === to` 时不能去新根里找源，否则「源与目标同一个路径」会被
   * 判成「目标已存在」而刷一堆没意义的 warn。
   */
  readonly legacyOnly?: boolean;
  /**
   * 结构守门：只有源目录「长得像」它该有的样子才搬。
   *
   * 目前只有一条用到它：`<根>/skin` 在旧布局里是**池**，在新布局里是**用户皮肤目录**——
   * 不加守门，一次重启就会把用户的皮肤搬进 `assets/pet/`。
   */
  readonly guard?: 'pool';
}

/** 迁移过程中用到的文件系统能力（测试注入替身）。 */
export interface MigrateFs {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: boolean }): void;
  renameSync(from: string, to: string): void;
  cpSync(from: string, to: string, options: { recursive: boolean }): void;
  writeFileSync(path: string, data: string): void;
  readFileSync(path: string): string;
  /** 目录项名（结构守门用）；缺省时守门按「不搬」处理——猜错方向的代价是丢用户皮肤。 */
  readdirSync?(path: string): string[];
}

/** 生产实现。 */
const NODE_FS: MigrateFs = {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync: (path) => readdirSync(path),
  readFileSync: (path) => readFileSync(path, 'utf8'),
  renameSync,
  writeFileSync,
};

/** 池的三个渲染方式层目录名（结构守门用）。 */
const POOL_MARKERS: readonly string[] = [...Object.values(POOL_LAYER_DIR), POOL_SOUND_DIR];

/** 用户皮肤的特征文件名（顶层出现 `*-config.json` / `*-config.jsonc` 就说明这是皮肤目录，不是池）。 */
const SKIN_MARKER = /-config\.jsonc?$/i;

/**
 * 这个目录看起来是不是旧布局的池（`layered/ live2d/ webm/ sound/`）。
 *
 * 判据刻意宽松在「池」这一侧、严格在「皮肤」这一侧：宁可把池留成没搬的空目录（用户顶多重新填一次），
 * 也不能把用户的皮肤当成池搬走（那是真的找不到自己的东西了）。
 *
 * @param dir - 目录绝对路径。
 * @param fs - 文件系统（替身或生产）。
 * @returns 像是池时为 true。
 */
export function looksLikePool(dir: string, fs: Pick<MigrateFs, 'existsSync' | 'readdirSync'> = NODE_FS): boolean {
  if (fs.readdirSync === undefined) return false;
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return false;
  }
  if (entries.some((name) => SKIN_MARKER.test(name))) return false;
  return entries.some((name) => POOL_MARKERS.includes(name));
}

/** 迁移用的日志出口。 */
export interface MigrateLog {
  info(message: string): void;
  warn(message: string): void;
}

/** 回执文件名（放在数据根下，`--revert` 靠它搬回）。 */
export const RECEIPT_FILE = '.layout.json';

/** 回执内容。 */
export interface LayoutReceipt {
  readonly schema: 1;
  /** ISO 时间戳。 */
  readonly at: string;
  /** 本回执涉及的搬迁（相对路径）。 */
  readonly moves: readonly LayoutMove[];
}

/**
 * 从旧平铺布局到新分组的搬迁清单（相对数据根，文件在前、目录在后）。
 *
 * 日志文件 `logs.txt` 不动：它在根上、只有一个，挪进 `data/` 反而更难找（排障第一件事就是找它）。
 *
 * 前两条的顺序**不能换**：旧布局里 `<根>/skin` 是池，新布局里 `<根>/skin` 是用户皮肤目录。
 * 先把「像是池」的那份搬进 `assets/pet`，才轮到 `pet/`、`pets/` 往 `skin/` 搬；
 * 反过来执行的话，池会被当成皮肤目录（或皮肤被当成池）搬走。
 *
 * @returns 搬迁清单。
 */
export function layoutMoves(): readonly LayoutMove[] {
  return [
    // 文件：小、便宜，先搬完，后面目录搬不动也不影响配置能读。
    { from: 'main-config.jsonc', to: 'config/main-config.jsonc' },
    { from: 'main-config.json', to: 'config/main-config.json' },
    { from: 'session-fish.json', to: 'config/session-fish.json' },
    { from: 'voice-providers.json', to: 'config/voice-providers.json' },
    { from: 'memory.json', to: 'data/memory.json' },
    { from: 'todos.json', to: 'data/todos.json' },
    // 目录：池先走（带结构守门），再轮到用户皮肤，最后是其余素材。
    { from: 'skin', to: 'assets/pet', guard: 'pool' },
    // 上一版的池就在 `assets/skin`（`assets.pool` 的旧默认值）：它没有歧义，直接改名。
    { from: 'assets/skin', to: 'assets/pet' },
    { from: 'pet', to: 'skin' },
    { from: 'pets', to: 'skin' },
    { from: 'main-animation', to: 'assets/animation' },
    { from: 'main-sound', to: 'assets/sound' },
    { from: 'memes', to: 'assets/memes' },
    { from: 'session-fish-skin', to: 'assets/session-fish' },
    { from: 'voice-cache', to: 'cache/voice' },
    { from: 'electron', to: 'runtime/electron' },
  ];
}

/** 迁移结果。 */
export interface MigrationResult {
  /** 真的搬过去的条目（相对路径 `from → to`）。 */
  readonly moved: readonly LayoutMove[];
  /** 跳过的条目与原因（源不存在 / 目标已存在 / 结构守门不通过）。 */
  readonly skipped: readonly { readonly move: LayoutMove; readonly reason: 'missing' | 'occupied' | 'not-pool' }[];
  /** 搬失败的条目与原因。 */
  readonly failed: readonly { readonly move: LayoutMove; readonly error: string }[];
}

/**
 * 旧根**已经**整理成新布局时的整组搬迁（`config/`、`data/` 等直接整个搬过来）。
 *
 * 场景：一次启动里换名失败、回落到旧根并把内层整理好了；下一次启动换名又成功（或能复制）时，
 * 旧根里已经是 `config/ data/ skin/ assets/`，再按老的平铺名单去找 `main-animation` 就一个也找不到。
 * 所以先按「同名分组」搬一轮——两层结构对两层结构，搬过去就完事。
 *
 * `cache` 只搬 `cache/voice`：新根里 `cache/desktop`（桌面 profile）与 `cache/download` 往往已经存在，
 * 整组搬会被 occupied 挡掉，连语音缓存也一起丢掉（那 20 MB 是可以复用的）。
 *
 * `skin` 同样带池守门：旧根整理成新布局时 `skin/` 已经是用户皮肤，但更早的半迁移状态下它可能还是池。
 *
 * @returns 整组搬迁清单。
 */
export function legacyGroupMoves(): readonly LayoutMove[] {
  return [
    { from: 'config', to: 'config', legacyOnly: true },
    { from: 'data', to: 'data', legacyOnly: true },
    { from: 'skin', to: 'assets/pet', legacyOnly: true, guard: 'pool' },
    { from: 'skin', to: 'skin', legacyOnly: true },
    { from: 'pets', to: 'skin', legacyOnly: true },
    { from: 'assets', to: 'assets', legacyOnly: true },
    { from: 'cache/voice', to: 'cache/voice', legacyOnly: true },
    // 旧根里可能已经有一份 Electron（老版本把运行时也放在数据根里）：同盘搬比让用户重下 350 MB 好。
    { from: 'runtime/electron', to: 'runtime/electron', legacyOnly: true },
    { from: 'logs.txt', to: 'logs.txt', legacyOnly: true },
  ];
}

/** 迁移输入。 */
export interface MigrationInput {
  /** 数据根（`resolveUserRoot` 的结果）。 */
  readonly root: string;
  /**
   * 旧根（`<DSH_HOME>/dsh-pet`）：两个根并存时的第二个来源。
   *
   * 为什么需要它：桌面 Helper 比宿主先一步起来时，会用到新位置的 `cache/desktop` 而把新根「先建出来」，
   * 于是换名那一步不走（新根已存在），真正的数据全在旧根里。这时不能只认新根，
   * 而要按同一张搬迁表从旧根搬进来——否则用户看到的就是「配置全没了」。
   */
  readonly legacyRoot?: string;
  /** 日志出口；缺省静默。 */
  readonly log?: MigrateLog;
  /** 文件系统替身（测试注入）。 */
  readonly fs?: MigrateFs;
  /** 只算清单不动盘（`scripts/migrate-layout.mjs` 的干跑）。 */
  readonly dryRun?: boolean;
}

/** 静默日志。 */
const SILENT: MigrateLog = { info: () => undefined, warn: () => undefined };

/**
 * 逐条执行搬迁（迁移与回滚共用）：不覆盖、不删源、单条失败不影响其余。
 *
 * @param root - 数据根。
 * @param moves - 搬迁清单（顺序执行）。
 * @param fs - 文件系统。
 * @param log - 日志出口。
 * @param dryRun - 只算清单不动盘。
 * @returns 结果。
 */
function applyMoves(
  root: string,
  moves: readonly LayoutMove[],
  fs: MigrateFs,
  log: MigrateLog,
  dryRun: boolean,
  legacyRoot?: string,
): MigrationResult {
  const moved: LayoutMove[] = [];
  const skipped: { move: LayoutMove; reason: 'missing' | 'occupied' | 'not-pool' }[] = [];
  const failed: { move: LayoutMove; error: string }[] = [];

  for (const move of moves) {
    const primary = join(root, move.from);
    const legacy = legacyRoot === undefined ? undefined : join(legacyRoot, move.from);
    // 源优先在自己的根里找；找不到再看旧根（两个根并存时数据可能还在旧根）。
    const from =
      move.legacyOnly === true
        ? legacy !== undefined && fs.existsSync(legacy)
          ? legacy
          : undefined
        : fs.existsSync(primary)
          ? primary
          : legacy !== undefined && fs.existsSync(legacy)
            ? legacy
            : undefined;
    const to = join(root, move.to);
    if (from === undefined) {
      skipped.push({ move, reason: 'missing' });
      continue;
    }
    // 结构守门：`<根>/skin` 只在「长得像池」时才搬进 assets/pet，否则它是用户皮肤目录。
    if (move.guard === 'pool' && !looksLikePool(from, fs)) {
      skipped.push({ move, reason: 'not-pool' });
      continue;
    }
    if (fs.existsSync(to)) {
      skipped.push({ move, reason: 'occupied' });
      log.warn(`[fish-body] 布局迁移跳过 ${move.from}：${move.to} 已存在（不合并、不覆盖）`);
      continue;
    }
    if (from !== primary) log.info(`[fish-body] 从旧根搬入 ${move.from} → ${move.to}`);
    if (dryRun) {
      moved.push(move);
      continue;
    }
    try {
      fs.mkdirSync(dirname(to), { recursive: true });
      try {
        fs.renameSync(from, to);
      } catch {
        // 跨盘 / 被占用：退回复制。源保留（日志里说清楚）。
        fs.cpSync(from, to, { recursive: true });
      }
      moved.push(move);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ move, error: message });
      log.warn(`[fish-body] 布局迁移失败 ${move.from} → ${move.to}：${message}`);
    }
  }
  return { moved, skipped, failed };
}

/**
 * 执行内层布局迁移（幂等）。
 *
 * @param input - 数据根（可带旧根）、日志、可选替身与干跑开关。
 * @returns 搬了哪些、跳过哪些、失败哪些。
 */
export function migrateLayout(input: MigrationInput): MigrationResult {
  const fs = input.fs ?? NODE_FS;
  const log = input.log ?? SILENT;
  // 两个根并存时先按「同名分组」搬一轮（旧根可能已经整理过），再按平铺名单兜底；
  // 根自己就是旧根时整组搬迁毫无意义（from 与 to 同一个路径），跳过。
  const groups = input.legacyRoot === undefined || input.legacyRoot === input.root ? [] : legacyGroupMoves();
  const result = applyMoves(
    input.root,
    [...groups, ...layoutMoves()],
    fs,
    log,
    input.dryRun === true,
    input.legacyRoot,
  );
  if (result.moved.length > 0 && input.dryRun !== true) {
    log.info(`[fish-body] 布局迁移完成：${result.moved.map((m) => `${m.from}→${m.to}`).join('、')}`);
    writeReceipt(input.root, result.moved, fs);
  }
  return result;
}

/**
 * 按回执反向搬回（`scripts/migrate-layout.mjs --revert`）。
 *
 * 反向顺序执行，同样「目标已存在就跳过」——用户中途手动挪过东西时，猜谁新谁旧只会错。
 *
 * @param input - 数据根、日志、替身与干跑开关。
 * @returns 结果（`moved` 里的 `from/to` 是反向后的：`to` 是原来的位置）。
 */
export function revertLayout(input: MigrationInput): MigrationResult {
  const fs = input.fs ?? NODE_FS;
  const log = input.log ?? SILENT;
  const receipt = readReceipt(input.root, fs);
  if (receipt === undefined) return { moved: [], skipped: [], failed: [] };
  const reversed = [...receipt.moves].reverse().map((move) => ({ from: move.to, to: move.from }));
  return applyMoves(input.root, reversed, fs, log, input.dryRun === true);
}

/**
 * 写迁移回执（失败只告警：回执是给 `--revert` 用的便利，不能因为写不了它就让迁移算失败）。
 *
 * @param root - 数据根。
 * @param moves - 本次真的搬过的条目。
 * @param fs - 文件系统（替身或生产）。
 */
function writeReceipt(root: string, moves: readonly LayoutMove[], fs: MigrateFs): void {
  try {
    const receipt: LayoutReceipt = {
      schema: 1,
      at: new Date().toISOString(),
      // 回执只留 from/to：legacyOnly 与 guard 是执行期的内部标记，不该出现在可回滚的数据里
      // （`--revert` 按 from/to 反向搬，不需要也不该重跑去重守门）。
      moves: moves.map((move) => ({ from: move.from, to: move.to })),
    };
    fs.writeFileSync(join(root, RECEIPT_FILE), JSON.stringify(receipt, null, 2) + '\n');
  } catch {
    /* 回执写不了不影响插件运行 */
  }
}

/**
 * 读回执（`--revert` 与测试用）。
 *
 * @param root - 数据根。
 * @param fs - 文件系统（替身或生产）。
 * @returns 回执；没有或损坏时 `undefined`。
 */
export function readReceipt(root: string, fs: MigrateFs = NODE_FS): LayoutReceipt | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(join(root, RECEIPT_FILE))) as LayoutReceipt;
    if (raw.schema !== 1 || !Array.isArray(raw.moves)) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

/** 把旧的 `$DSH_HOME/electron` 搬进 `<数据根>/runtime/electron` 的结果。 */
export type RuntimeMoveResult = 'moved' | 'copied' | 'absent' | 'occupied' | 'failed';

/**
 * 搬迁 Electron 运行时（`$DSH_HOME/electron` → `<数据根>/runtime/electron`）。
 *
 * 这项跟内层迁移分开，因为**源在数据根之外**：它是当年为了「多个插件共用一份 Electron」才放在 DSH 根下的，
 * 而实际上只有本插件在用。347 MB 的东西不适合放 cache（删了要重下），所以归 `runtime/`。
 *
 * 目标已存在 → 不动（`occupied`）；源不存在 → `absent`；同盘 rename，失败退回复制（源保留）。
 *
 * @param input - `$DSH_HOME`、数据根、日志、替身与干跑开关。
 * @returns 结果标签。
 */
export function migrateElectronRuntime(
  input: { readonly dshHome: string; readonly root: string; readonly log?: MigrateLog; readonly fs?: MigrateFs } & {
    readonly dryRun?: boolean;
  },
): RuntimeMoveResult {
  const fs = input.fs ?? NODE_FS;
  const log = input.log ?? SILENT;
  const from = join(input.dshHome, 'electron');
  const to = join(input.root, 'runtime', 'electron');
  if (!fs.existsSync(from)) return 'absent';
  if (fs.existsSync(to)) return 'occupied';
  if (input.dryRun === true) return 'moved';
  try {
    fs.mkdirSync(dirname(to), { recursive: true });
    try {
      fs.renameSync(from, to);
      return 'moved';
    } catch {
      fs.cpSync(from, to, { recursive: true });
      log.warn(`[fish-body] Electron 运行时已复制到 ${to}；旧的 ${from} 保留未删，确认无误后可手动删除`);
      return 'copied';
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[fish-body] Electron 运行时搬迁失败（${message}）；本次仍从旧位置使用`);
    return 'failed';
  }
}
