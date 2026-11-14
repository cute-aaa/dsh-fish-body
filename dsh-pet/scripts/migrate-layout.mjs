/**
 * 布局迁移脚本：预览 / 执行 / 回滚「dsh-pet 平铺布局 → fish-body 分组布局」。
 *
 * 默认**干跑**（只打印将会发生的搬迁，不动磁盘）。真正的搬迁在插件启动时也会自动跑一次，
 * 这个脚本的用处是：升级前先看清会动哪些目录；或者升级后想把目录搬回去。
 *
 * 用法：
 *   node scripts/migrate-layout.mjs                        # 干跑：打印换名 + 搬迁清单
 *   node scripts/migrate-layout.mjs --apply                # 真的搬（换名 → 内层分组 → Electron 运行时）
 *   node scripts/migrate-layout.mjs --revert --apply       # 按 <数据根>/.layout.json 搬回去
 *   node scripts/migrate-layout.mjs --root D:/x/fish-body  # 指定数据根（默认 $DSH_HOME/fish-body）
 *   node scripts/migrate-layout.mjs --dsh-home D:/x        # 指定 DSH_HOME（默认环境变量或 ~/.dsh）
 *
 * 干跑**不做任何换名**：它只在内存里推导「新根会在哪、旧根还在不在」，动盘只发生在 `--apply`。
 * 搬迁规则（不覆盖、不删源、幂等）见 `src/host/migrate-layout.ts`；这里只做命令行外壳。
 * @module dsh-fish-body/scripts/migrate-layout
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Node 22.6–22.17 需要显式打开类型剥离才能 import .ts；22.18+/24 默认已开。
// 用 process.features.typescript 判断，避免每次多起一个进程。
if (!process.features.typescript) {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(result.status ?? 1);
}

const { migrateElectronRuntime, migrateLayout, readReceipt, revertLayout } =
  await import('../src/host/migrate-layout.ts');
const { LEGACY_ROOT_DIR_NAME, ROOT_DIR_NAME, resolveUserRoot } = await import('../src/host/user-root.ts');

/** 解析命令行：只认四个开关，写错就报错退出（别默默干跑半套）。 */
function parseArgs(argv) {
  const out = { apply: false, revert: false, root: '', dshHome: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--revert') out.revert = true;
    else if (arg === '--root') out.root = argv[(i += 1)] ?? '';
    else if (arg === '--dsh-home') out.dshHome = argv[(i += 1)] ?? '';
    else if (arg === '--help' || arg === '-h') {
      console.log('用法：node scripts/migrate-layout.mjs [--apply|--revert] [--root <数据根>] [--dsh-home <DSH_HOME>]');
      process.exit(0);
    } else {
      console.error('未知参数：' + arg);
      process.exit(2);
    }
  }
  return out;
}

/** 日志出口：前缀统一，方便和 logs.txt 对照。 */
const log = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
};

const args = parseArgs(process.argv.slice(2));
const dshHome = args.dshHome === '' ? process.env.DSH_HOME || join(homedir(), '.dsh') : resolve(args.dshHome);
const plannedRoot = join(dshHome, ROOT_DIR_NAME);
const plannedLegacy = join(dshHome, LEGACY_ROOT_DIR_NAME);

console.log('DSH_HOME  ' + dshHome);

if (args.revert) {
  // 回滚用「实际存在的那一个根」：还没换名时数据就在旧根里。
  const root = args.root === '' ? (existsSync(plannedRoot) ? plannedRoot : plannedLegacy) : resolve(args.root);
  console.log('数据根    ' + root);
  if (readReceipt(root) === undefined) {
    console.error('没有回执 ' + join(root, '.layout.json') + '，无法回滚。');
    process.exit(1);
  }
  const result = revertLayout({ root, log, dryRun: !args.apply });
  for (const move of result.moved) console.log((args.apply ? '已搬回  ' : '将搬回  ') + move.from + '  →  ' + move.to);
  for (const item of result.skipped) {
    console.log('跳过（' + (item.reason === 'missing' ? '源不存在' : '目标已存在，不覆盖') + '）' + item.move.from);
  }
  console.log(
    args.apply
      ? `\n回滚完成：搬回 ${result.moved.length} 项，跳过 ${result.skipped.length} 项，失败 ${result.failed.length} 项。`
      : `\n干跑：${result.moved.length} 项待搬回。加 --apply 真的执行。`,
  );
  process.exit(result.failed.length > 0 ? 1 : 0);
}

// 干跑：不换名，只报告「新根会在哪、旧根要不要搬」。
if (!args.apply) {
  const root = args.root === '' ? plannedRoot : resolve(args.root);
  const willRename = args.root === '' && !existsSync(plannedRoot) && existsSync(plannedLegacy);
  console.log('数据根    ' + root + (willRename ? '（将由 ' + plannedLegacy + ' 换名而来）' : ''));
  const preview = migrateLayout({ root: willRename ? plannedLegacy : root, log, dryRun: true });
  console.log('\n搬迁清单（干跑）：');
  for (const move of preview.moved) console.log('  ' + move.from + '  →  ' + move.to);
  console.log('跳过：');
  for (const item of preview.skipped) {
    console.log('  ' + item.move.from + '（' + (item.reason === 'missing' ? '源不存在' : '目标已存在，不覆盖') + '）');
  }
  const runtimePreview = migrateElectronRuntime({
    dshHome,
    root: willRename ? plannedLegacy : root,
    log,
    dryRun: true,
  });
  console.log(
    'Electron 运行时：' +
      (runtimePreview === 'absent' ? '旧位置没有，无需搬迁' : '会搬到 ' + join(root, 'runtime', 'electron')),
  );
  console.log('\n干跑结束（没有动任何文件）。加 --apply 真的执行。');
  process.exit(0);
}

// 执行：先按插件同样的逻辑选根（只有旧根时换名），再搬内层目录与运行时。
const rootResult = args.root === '' ? resolveUserRoot({ dshHome, log }) : undefined;
const root = rootResult === undefined ? resolve(args.root) : rootResult.root;
console.log('数据根    ' + root + (rootResult?.renamed === true ? '（已从 ' + rootResult.legacyRoot + ' 换名）' : ''));
if (rootResult?.copied === true) console.log('注意      旧根已复制到新位置，旧根保留未删：' + rootResult.legacyRoot);

const result = migrateLayout({ root, log });
const runtimeMove = migrateElectronRuntime({ dshHome, root, log });
console.log(
  `\n完成：搬了 ${result.moved.length} 项，跳过 ${result.skipped.length} 项，失败 ${result.failed.length} 项；Electron 运行时 ${runtimeMove}。`,
);
process.exit(result.failed.length > 0 ? 1 : 0);
