#!/usr/bin/env node
/**
 * 参考皮肤导入：把本机皮肤工程（layered surfcore / live2d 源）落成 fish-body 的文件宠物测试项。
 *
 * 产物约定（与 webm 的 `<id>-animation/` 平行，layered/live2d 渲染器扫 `<id>-skin/`）：
 *   $DSH_HOME/dsh-pet/pet/<id>-config.json   文件宠物配置（renderer: layered|live2d）
 *   $DSH_HOME/dsh-pet/pet/<id>-skin/         皮肤资产（manifest.json + art/*.png / 分层 PNG）
 *
 * 用法：
 *   node scripts/stage-reference-skins.mjs                 # 只导 layered（5 套 surfcore）
 *   node scripts/stage-reference-skins.mjs --with-live2d   # 追加 live2d 源工程（大，默认不含 PSD）
 *   node scripts/stage-reference-skins.mjs --with-psd      # live2d 同时拷贝 PSD
 *   node scripts/stage-reference-skins.mjs --dry-run       # 只打印计划，不落盘
 *   node scripts/stage-reference-skins.mjs --force         # 覆盖已有目标
 * @module dsh-pet/scripts/stage-reference-skins
 */
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 脚本目录（dsh-pet/scripts）与包根（dsh-pet）。 */
const here = fileURLToPath(new URL('.', import.meta.url));
const pkgRoot = resolve(here, '..');

const argv = new Set(process.argv.slice(2));
const dryRun = argv.has('--dry-run');
const force = argv.has('--force');
const withLive2d = argv.has('--with-live2d');
const withPsd = argv.has('--with-psd');

/** DSH_HOME：显式环境变量优先，本机默认。 */
const DSH_HOME = process.env.DSH_HOME ?? 'D:\\NodeJs\\DSH_home';
const petDir = join(DSH_HOME, 'dsh-pet', 'pet');

/** 默认实例字段：layered/live2d 不启用 webm 专属的事件联动。 */
const BASE_PET = {
  size: 462,
  balanceEnabled: false,
  whisperEnabled: false,
  workStatusEnabled: false,
  fixedEnabled: false,
  display: 'web',
  position: { corner: 'bottom-right', marginX: 24, marginY: 100 },
};

/** 皮肤清单：renderer + 源目录 + 显示名。 */
const LAYERED = [
  { id: 'feiyu-01', name: '今天元气一点', src: 'D:\\AI\\FishChi\\body\\skins\\feiyu-01' },
  { id: 'feiyu-02', name: '今天少女一点', src: 'D:\\AI\\FishChi\\body\\skins\\feiyu-02' },
  { id: 'feiyu-03', name: '今天Q弹一点', src: 'D:\\AI\\FishChi\\body\\skins\\feiyu-03' },
  { id: 'feiyu-04', name: '今天穿暖和点', src: 'D:\\AI\\FishChi\\body\\skins\\feiyu-04' },
  { id: 'feiyu-05', name: '今天硬气一点', src: 'D:\\AI\\FishChi\\body\\skins\\feiyu-05' },
].map((item) => ({ ...item, renderer: 'layered' }));

/** 已编译 Live2D 模型（.moc3 + .model3.json + 纹理 + 动作/表情）：T2.4 可直接加载。 */
const LIVE2D_MODEL = [
  { id: 'deepseek-live2d', name: '大肥鱼（DeepSeek 公皮）', src: 'G:\\Download\\DeepSeek免费公皮\\DeepSeek' },
].map((item) => ({ ...item, renderer: 'live2d' }));

/** live2d 源工程（分层 PNG + PSD，未编译 .moc3）：仅作 T2.4 皮肤参考。 */
const LIVE2D = [
  { id: 'live2d-furina', name: '芙宁娜·海', src: 'C:\\Users\\I\\live2d_build\\01_furina_sea' },
  { id: 'live2d-ororon', name: '欧洛伦', src: 'C:\\Users\\I\\live2d_build\\02_ororon' },
  { id: 'live2d-aikefei', name: '艾柯菲', src: 'C:\\Users\\I\\live2d_build\\03_aikefei' },
  { id: 'live2d-yixuan', name: '逸轩', src: 'C:\\Users\\I\\live2d_build\\04_yixuan' },
].map((item) => ({ ...item, renderer: 'live2d' }));

/** 一条导入项落成的配置 JSON（不带动画池：layered/live2d 走皮肤 manifest）。 */
function configOf(item) {
  return (
    JSON.stringify(
      {
        pets: [{ id: item.id, name: item.name, renderer: item.renderer, ...BASE_PET }],
      },
      null,
      2,
    ) + '\n'
  );
}

/** 是否拷贝该文件（live2d 默认跳过 PSD，--with-psd 才带）。 */
function shouldCopyFile(file) {
  if (file.endsWith('.psd') && !withPsd) return false;
  return true;
}

/** 复制目录（按 shouldCopyFile 过滤），dry-run 只打印。 */
function stage(item) {
  const targetDir = join(petDir, `${item.id}-skin`);
  const configPath = join(petDir, `${item.id}-config.json`);
  const exists = existsSync(targetDir) || existsSync(configPath);

  if (exists && !force) {
    console.log(`[skip] ${item.id} 已存在（--force 覆盖）`);
    return 0;
  }

  console.log(`[stage] ${item.id} (${item.renderer})`);
  console.log(`  src   ${item.src}`);
  console.log(`  skin  ${targetDir}`);
  console.log(`  cfg   ${configPath}`);

  if (dryRun) return 0;

  mkdirSync(petDir, { recursive: true });
  if (existsSync(targetDir)) cpSync(targetDir, `${targetDir}.bak-${Date.now()}`, { recursive: true });
  cpSync(item.src, targetDir, { recursive: true, filter: (src) => shouldCopyFile(src) });
  writeFileSync(configPath, configOf(item), 'utf8');
  return 1;
}

/** 主流程：layered 与已编译 live2d 恒导，live2d 源工程按 --with-live2d。 */
function main() {
  if (!existsSync(petDir)) {
    console.log(`[warn] 宠物数据目录不存在：${petDir}`);
    console.log('       请先启动一次 fish 实例，或手动创建后重跑。');
    if (!dryRun) return;
  }
  const items = [...LAYERED, ...LIVE2D_MODEL, ...(withLive2d ? LIVE2D : [])];
  if (items.length === 0) {
    console.log('[info] 没有要导入的项');
    return;
  }
  let staged = 0;
  for (const item of items) {
    staged += stage(item);
  }
  console.log(`\n[done] ${dryRun ? '（dry-run）' : ''}处理 ${items.length} 项，落盘 ${staged} 项`);
  console.log('       重启 fish 实例后 /config 即出现对应条目；右键「渲染方式」切 layered/live2d 测试。');
  console.log(`       包根：${pkgRoot}`);
}

main();
