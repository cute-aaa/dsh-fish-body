/**
 * 资源池迁移脚本（A 方案，只搬不删）：把旧布局里的皮肤 / 动画 / 音效**复制**一份进共享资源池。
 *
 * 默认干跑（只打印清单，不动磁盘）；带 `--apply` 才真的复制，且**永不删除**源文件——
 * 旧布局仍然完整可用，「先 pack 后池」的解析顺序保证行为不变，不满意直接删掉池里那份即可。
 *
 * 用法：
 *   node scripts/migrate-pool.mjs                      # 干跑：打印将要复制的清单
 *   node scripts/migrate-pool.mjs --apply              # 真的复制（冲突跳过并报告）
 *   node scripts/migrate-pool.mjs --root D:/x/dsh-pet  # 指定用户根（默认 $DSH_HOME/dsh-pet 或 ~/.dsh/dsh-pet）
 *   node scripts/migrate-pool.mjs --pool D:/shared     # 指定池根（默认 <用户根>/skin）
 *
 * 判定规则：
 *   pet/<pack>-skin/<子目录>/ manifest.json            → <池>/layered/<子目录>/
 *   pet/<pack>-skin/<子目录>/ *.model3.json            → <池>/live2d/<子目录>/
 *   pet/<pack>-skin/<子目录>/ 都没有                    → 跳过（认不出是哪类素材，不猜）
 *   pet/<pack>-animation/webm/*.webm                   → <池>/webm/
 *   <用户根>/main-sound/*                              → <池>/sound/
 * @module dsh-fish-body/scripts/migrate-pool
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** 解析命令行参数（只认三个开关，写错就报错退出，别默默干跑半套）。 */
function parseArgs(argv) {
  const out = { apply: false, pool: '', root: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--pool') out.pool = argv[(i += 1)] ?? '';
    else if (arg === '--root') out.root = argv[(i += 1)] ?? '';
    else if (arg === '--help' || arg === '-h') {
      console.log('用法：node scripts/migrate-pool.mjs [--apply] [--root <用户根>] [--pool <池根>]');
      process.exit(0);
    } else {
      console.error('未知参数：' + arg);
      process.exit(2);
    }
  }
  return out;
}

/** 用户根：显式参数 > $DSH_HOME/dsh-pet > ~/.dsh/dsh-pet。 */
function userRootOf(raw) {
  if (raw !== '') return resolve(raw);
  const home = process.env.DSH_HOME;
  // 新布局的数据根；老用户还没迁移时旧目录仍在，脚本允许 --root 显式指定。
  return home ? resolve(home, 'fish-body') : join(homedir(), '.dsh', 'fish-body');
}

/** 列目录（读不了返回空数组）。 */
function entries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** 目录里有没有指定后缀的文件（只看本层）。 */
function hasFile(dir, predicate) {
  return entries(dir).some((entry) => entry.isFile() && predicate(entry.name));
}

/**
 * 扫出全部迁移项。
 *
 * @param userRoot - 用户根。
 * @param poolRoot - 池根。
 * @returns `{ from, to, kind, note? }` 列表。
 */
function planOf(userRoot, poolRoot) {
  const plan = [];
  const petDir = join(userRoot, 'pet');

  for (const pack of entries(petDir)) {
    const packPath = join(petDir, pack.name);
    if (!statSync(packPath).isDirectory()) continue;

    if (pack.name.endsWith('-skin')) {
      for (const skin of entries(packPath)) {
        const skinPath = join(packPath, skin.name);
        if (!statSync(skinPath).isDirectory()) continue;
        const hasManifest =
          existsSync(join(skinPath, 'manifest.json')) ||
          hasFile(skinPath, (n) => n.endsWith('.json') && !n.endsWith('.model3.json'));
        const hasModel3 = hasFile(skinPath, (n) => n.endsWith('.model3.json'));
        if (hasManifest) {
          plan.push({ from: skinPath, kind: 'layered', to: join(poolRoot, 'layered', skin.name) });
        } else if (hasModel3) {
          plan.push({ from: skinPath, kind: 'live2d', to: join(poolRoot, 'live2d', skin.name) });
        } else {
          plan.push({ from: skinPath, kind: 'skip', note: '认不出结构文件（既没有清单也不是 live2d）', to: '' });
        }
      }
      continue;
    }

    if (pack.name.endsWith('-animation')) {
      const webmDir = join(packPath, 'webm');
      for (const file of entries(webmDir)) {
        if (!file.isFile() || !file.name.endsWith('.webm')) continue;
        plan.push({ from: join(webmDir, file.name), kind: 'webm', to: join(poolRoot, 'webm', file.name) });
      }
    }
  }

  const userSound = join(userRoot, 'main-sound');
  for (const file of entries(userSound)) {
    if (!file.isFile()) continue;
    plan.push({ from: join(userSound, file.name), kind: 'sound', to: join(poolRoot, 'sound', file.name) });
  }

  return plan;
}

/** 一条迁移项 → 可读的一行。 */
function lineOf(item) {
  if (item.kind === 'skip') return '跳过  ' + item.from + '（' + item.note + '）';
  const state = existsSync(item.to) ? '已存在，跳过' : '将复制';
  return state + '  ' + item.from + ' → ' + item.to;
}

const args = parseArgs(process.argv.slice(2));
const userRoot = userRootOf(args.root);
const poolRoot = args.pool !== '' ? resolve(args.pool) : join(userRoot, 'skin');

if (!existsSync(userRoot)) {
  console.error('用户根不存在：' + userRoot);
  process.exit(1);
}

const plan = planOf(userRoot, poolRoot);
const todo = plan.filter((item) => item.kind !== 'skip' && !existsSync(item.to));
const skipped = plan.filter((item) => item.kind === 'skip');
const conflicts = plan.filter((item) => item.kind !== 'skip' && existsSync(item.to));

console.log('用户根：' + userRoot);
console.log('池根  ：' + poolRoot + (existsSync(poolRoot) ? '' : '（不存在，--apply 时会创建）'));
console.log('');
for (const item of plan) console.log('  ' + lineOf(item));
console.log('');
console.log(
  '合计：' +
    plan.length +
    ' 项（复制 ' +
    todo.length +
    '，已存在 ' +
    conflicts.length +
    '，跳过 ' +
    skipped.length +
    '）',
);
console.log(
  JSON.stringify(
    {
      conflicts: conflicts.map((item) => ({ from: item.from, to: item.to })),
      poolRoot,
      skipped: skipped.map((item) => ({ from: item.from, note: item.note })),
      userRoot,
      wouldCopy: todo.map((item) => ({ from: item.from, kind: item.kind, to: item.to })),
    },
    null,
    2,
  ),
);

if (!args.apply) {
  console.log('\n干跑结束：没有动任何文件。加 --apply 才会复制（永不删除源文件）。');
  process.exit(0);
}

let copied = 0;
for (const item of todo) {
  mkdirSync(dirname(item.to), { recursive: true });
  cpSync(item.from, item.to, { recursive: true, errorOnExist: false, force: false });
  copied += 1;
  console.log('已复制 ' + item.from + ' → ' + item.to);
}
console.log('\n完成：复制 ' + copied + ' 项；源文件全部保留（旧布局照常可用）。');
