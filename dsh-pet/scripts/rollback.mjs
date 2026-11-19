/**
 * 回滚脚本：给「插件构建产物 + 可选配置」拍快照 / 列快照 / 恢复。
 *
 * 默认**干跑**（与 `scripts/migrate-layout.mjs` 同一套习惯）：不加 `--apply` 时只打印会覆盖哪些路径，
 * 一个文件都不动。真正的动作只发生在 `--apply` 之后，且恢复前会先自拍一份 `pre-restore`。
 *
 * 用法：
 *   node scripts/rollback.mjs snapshot [--label <名字>] [--with-config]
 *   node scripts/rollback.mjs list
 *   node scripts/rollback.mjs restore [<id>] [--apply] [--with-config]
 *   node scripts/rollback.mjs prune <id> --apply
 * 公共：--repo <插件目录>  --dsh-home <DSH_HOME>  --dir <快照目录>
 *
 * 收什么：`lib/`、`package.json`、`cordis.patch.yml`（+ `--with-config` 时数据根的 `config/`）。
 * **不收** `data/`、`skin/`、`assets/pet/`、`node_modules/`、`dist-app/`——回滚不碰用户自己的东西。
 * 数据布局的回滚不在这里：走 `node scripts/migrate-layout.mjs --revert --apply`。
 * @module dsh-fish-body/scripts/rollback
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Node 22.6–22.17 需要显式打开类型剥离才能 import .ts；22.18+/24 默认已开（同 migrate-layout）。
if (!process.features.typescript) {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(result.status ?? 1);
}

const {
  createSnapshot,
  listSnapshots,
  planRestore,
  readManifest,
  removeSnapshot,
  restoreSnapshot,
  NODE_FS,
  ROLLBACK_DIR,
} = await import('../src/host/rollback.ts');
const { ROOT_DIR_NAME } = await import('../src/host/user-root.ts');

/** 插件目录（本脚本在 `<插件>/scripts/` 下）。 */
const PLUGIN_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** 解析命令行：未知参数直接报错退出，别默默干跑半套。 */
function parseArgs(argv) {
  const out = { command: '', id: '', label: '', apply: false, withConfig: false, repo: '', dshHome: '', dir: '' };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--with-config') out.withConfig = true;
    else if (arg === '--label') out.label = argv[(i += 1)] ?? '';
    else if (arg === '--repo') out.repo = argv[(i += 1)] ?? '';
    else if (arg === '--dsh-home') out.dshHome = argv[(i += 1)] ?? '';
    else if (arg === '--dir') out.dir = argv[(i += 1)] ?? '';
    else if (arg === '--help' || arg === '-h') {
      console.log(
        '用法：node scripts/rollback.mjs <snapshot|list|restore|prune> [id] ' +
          '[--label <名字>] [--apply] [--with-config] [--repo <插件目录>] [--dsh-home <DSH_HOME>] [--dir <快照目录>]',
      );
      process.exit(0);
    } else if (arg.startsWith('-')) {
      console.error('未知参数：' + arg);
      process.exit(2);
    } else rest.push(arg);
  }
  out.command = rest[0] ?? '';
  out.id = rest[1] ?? '';
  return out;
}

const log = {
  info: (message) => console.log(message),
  warn: (message) => console.warn('注意      ' + message),
};

/**
 * 读 git commit（拿不到就空串）：快照里记一笔，排障时能对上仓库状态。
 *
 * @param repo - 插件目录。
 * @returns 短 commit 或空串。
 */
function gitCommitOf(repo) {
  const result = spawnSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

/** 读插件版本；读不出来按 unknown（不阻塞）。 */
function versionOf(repo) {
  try {
    const raw = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
    return typeof raw.version === 'string' ? raw.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

const args = parseArgs(process.argv.slice(2));
const repo = args.repo === '' ? PLUGIN_DIR : resolve(args.repo);
const dshHome = args.dshHome === '' ? process.env.DSH_HOME || join(homedir(), '.dsh') : resolve(args.dshHome);
const dataRoot = join(dshHome, ROOT_DIR_NAME);
const dir = args.dir === '' ? join(repo, 'artifacts', ROLLBACK_DIR) : resolve(args.dir);

console.log('插件目录  ' + repo);
console.log('数据根    ' + dataRoot);
console.log('快照目录  ' + dir);

if (args.command === 'snapshot') {
  const manifest = createSnapshot({
    repo,
    dir,
    label: args.label === '' ? 'manual' : args.label,
    commit: gitCommitOf(repo),
    version: versionOf(repo),
    dataRoot,
    includeConfig: args.withConfig,
    now: new Date(),
    fs: NODE_FS,
    log,
  });
  console.log('\n完成：' + manifest.id + '（' + manifest.entries.length + ' 个文件）');
  process.exit(0);
}

if (args.command === 'list') {
  const items = listSnapshots(dir);
  if (items.length === 0) {
    console.log('\n还没有任何快照。先拍一份：node scripts/rollback.mjs snapshot --label before-upgrade');
    process.exit(0);
  }
  console.log('\n快照（新的在前）：');
  for (const item of items) {
    if (item.error !== undefined) {
      console.log('  ' + item.id + '  ✗ ' + item.error);
      continue;
    }
    const manifest = item.manifest;
    console.log(
      '  ' +
        item.id +
        '  v' +
        manifest.version +
        (manifest.commit === '' ? '' : ' @' + manifest.commit) +
        '  ' +
        manifest.entries.length +
        ' 个文件 / ' +
        Math.round(manifest.totalBytes / 1024) +
        ' KiB' +
        (manifest.includeConfig ? '（含 config/）' : ''),
    );
  }
  process.exit(0);
}

if (args.command === 'restore') {
  const id = args.id === '' ? (listSnapshots(dir)[0]?.id ?? '') : args.id;
  if (id === '') {
    console.error('没有可恢复的快照。先用 snapshot 拍一份。');
    process.exit(1);
  }
  const manifest = readManifest(dir, id);
  const targets = planRestore(manifest, dir, repo, dataRoot, args.withConfig);
  console.log('\n快照      ' + id + '（v' + manifest.version + '，拍于 ' + manifest.createdAt + '）');
  console.log('将覆盖：');
  for (const target of targets) console.log('  ' + target.rel + '  →  ' + target.to);
  if (!args.apply) {
    console.log('\n干跑结束（没有动任何文件）。加 --apply 真的恢复；恢复前会自动再拍一份 pre-restore。');
    process.exit(0);
  }
  const result = restoreSnapshot({
    repo,
    dir,
    id,
    dataRoot,
    includeConfig: args.withConfig,
    now: new Date(),
    fs: NODE_FS,
    log,
  });
  console.log(
    '\n完成：恢复 ' + result.restored.length + ' 项；回滚前快照 ' + result.preRestore + '（想再退回来用它）。',
  );
  console.log('生效方式：调用 POST ' + '<插件路由>/plugin-restart' + '（HMR 会自动刷新页面），或重启 profile。');
  console.log('数据布局也要退：node scripts/migrate-layout.mjs --revert --apply');
  process.exit(0);
}

if (args.command === 'prune') {
  if (args.id === '') {
    console.error('用法：node scripts/rollback.mjs prune <id> --apply');
    process.exit(2);
  }
  if (!existsSync(join(dir, args.id))) {
    console.error('没有这份快照：' + args.id);
    process.exit(1);
  }
  if (!args.apply) {
    console.log('\n干跑：将删除快照 ' + args.id + '。加 --apply 真的删除。');
    process.exit(0);
  }
  removeSnapshot(dir, args.id);
  console.log('\n已删除快照 ' + args.id);
  process.exit(0);
}

console.error('用法：node scripts/rollback.mjs <snapshot|list|restore|prune> [id] [--apply] [--with-config]');
process.exit(2);
