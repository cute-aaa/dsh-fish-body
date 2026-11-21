#!/usr/bin/env node
/**
 * `design` 门禁：DESIGN.md 与代码/契约的对齐校验。
 *
 * 三件事：
 * 1. 入口覆盖——`openapi.yaml` 里 `/dsh-pet-7340/<前缀>` 的每个前缀都要在 DESIGN.md 出现，
 *    新增端点却不在设计清单登记 → 失败（这正是「功能被悄悄覆盖/遗漏」的入口）；
 * 2. owner 文件存在——DESIGN.md 里出现的 `path/to/file.ts` 引用必须真实存在；
 * 3. 必备小节存在。
 *
 * 只读脚本：不写文件、不联网，退出码 0/1。用法：`npm run check:design`。
 * @module dsh-fish-body/scripts/check-design
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(here, '..');
const repoRoot = resolve(pluginRoot, '..');
const designPath = join(repoRoot, 'DESIGN.md');
const openapiPath = join(repoRoot, 'openapi.yaml');

/** 必备小节标题（顺序无关）。 */
const REQUIRED_SECTIONS = ['能力清单', '状态真源规则', '变更前检查清单', '可执行门禁'];

/**
 * 高风险入口：这些路径必须逐字出现在 DESIGN.md。
 *
 * 前缀级覆盖只能发现「整块新端点」，发现不了「老前缀下新增一个危险端点」；这里手挑出
 * 会写盘 / 会改运行期状态 / 会读外部服务的那几条，作为逐字校验的对象。
 */
const CRITICAL_PATHS = [
  '/persona/characters/apply',
  '/persona/import',
  '/persona/polish',
  '/voice/provider-config',
  '/voice/voice-pack',
  '/voice/speak',
  '/skin/{root}/resources',
  '/pet-click-through',
  '/settings-backup',
  '/open-folder',
  // 选择器：A 主（helper 系统对话框）→ B 兜底（PowerShell），两条路的字段/取消/超时都要在设计里写死。
  '/pick-file',
  '/pick-folder',
];

/** 从 openapi.yaml 抽出 `/dsh-pet-7340/<前缀>` 的前缀集合。 */
function prefixesOf(openapi) {
  const out = new Set();
  const re = /^\s{2}\/dsh-pet-7340\/([^:{\s/]+)/gm;
  for (const match of openapi.matchAll(re)) out.add(match[1]);
  return [...out].sort();
}

/** DESIGN.md 里以反引号包起来的、看起来是仓内源文件路径的引用。 */
function ownerRefsOf(design) {
  const out = new Set();
  for (const match of design.matchAll(
    /`((?:dsh-pet\/|docs\/|scripts\/)?[\w./-]+\.(?:ts|tsx|mjs|js|json|jsonc|yaml|yml|md))`/g,
  )) {
    const rel = match[1];
    // 只校验看起来像路径的引用（含 `/`），纯文件名不算。
    if (rel.includes('/')) out.add(rel);
  }
  return [...out].sort();
}

const problems = [];

if (!existsSync(designPath)) {
  console.error('✗ DESIGN.md 不存在：' + designPath);
  process.exit(1);
}
const design = readFileSync(designPath, 'utf8');

if (!existsSync(openapiPath)) {
  problems.push('openapi.yaml 不存在：' + openapiPath);
} else {
  const openapi = readFileSync(openapiPath, 'utf8');
  const missing = prefixesOf(openapi).filter((prefix) => !design.includes('/' + prefix));
  for (const prefix of missing) problems.push('入口未在 DESIGN.md 登记：/dsh-pet-7340/' + prefix);
}

/** 递归列出某个目录下的文件（相对给定根），用于「只写了尾部路径」的引用匹配。 */
function filesUnder(root) {
  const out = [];
  const walk = (dir, prefix) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix === '' ? entry.name : prefix + '/' + entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else out.push(rel);
    }
  };
  walk(root, '');
  return out;
}

const knownPaths = [
  ...filesUnder(join(repoRoot, 'docs')).map((rel) => 'docs/' + rel),
  ...filesUnder(join(pluginRoot, 'src')).map((rel) => 'src/' + rel),
  ...filesUnder(join(pluginRoot, 'scripts')).map((rel) => 'scripts/' + rel),
  ...filesUnder(join(pluginRoot, 'runtime')).map((rel) => 'runtime/' + rel),
];

for (const rel of ownerRefsOf(design)) {
  // 示例占位（`path/to/*`）不校验；运行期数据文件（`config/*`、`data/*`）与流程产物（`03-code/*`）不是仓内源码。
  if (rel.startsWith('path/to/')) continue;
  if (rel.startsWith('config/') || rel.startsWith('data/') || /^0\d-/.test(rel)) continue;
  const direct = [join(repoRoot, rel), join(pluginRoot, rel), join(pluginRoot, 'src', rel)];
  const bySuffix = knownPaths.some((known) => known === rel || known.endsWith('/' + rel));
  if (!direct.some((path) => existsSync(path)) && !bySuffix) {
    problems.push('DESIGN.md 引用的文件不存在：' + rel);
  }
}

for (const path of CRITICAL_PATHS) {
  if (!design.includes(path)) problems.push('高风险入口未在 DESIGN.md 逐字登记：' + path);
}

for (const section of REQUIRED_SECTIONS) {
  if (!design.includes(section)) problems.push('DESIGN.md 缺少必备小节：' + section);
}

if (problems.length > 0) {
  console.error('✗ check:design 失败（' + problems.length + ' 项）');
  for (const problem of problems) console.error('  - ' + problem);
  process.exit(1);
}
console.log('✓ check:design 通过：入口前缀齐全、owner 文件存在、四个必备小节齐备');
