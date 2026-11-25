#!/usr/bin/env node
/**
 * 发布前微调：跑完整构建（tsdown → lib、共享层 → shared-core.js、tsc → 类型声明），
 * 再把 package.json 的 files 收敛成发布清单。幂等：跑一次即定格，再跑结果不变，无需备份或恢复。
 *
 * 只发布单一 webm 格式（VP9-alpha），浏览器与桌面 Helper 共用，源码写死 .webm、发布期不做注入；
 * Safari/HEVC 兼容由仓库保留的流水线支持、需 fork 后自行启用，不参与本插件发布链。
 * 依赖 package.json 里的 bundle / build:desktop-core / types 三个脚本与本地 node_modules。
 * @module dsh-pet/scripts/prepare
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PKG = join(ROOT, 'package.json');

// 用 cmd /c 跑整条 npm 命令：Windows 下 npm 是 npm.cmd，spawnSync 无法直接执行 .cmd
// （命令行固定、无用户输入，没有注入风险）。
console.log('[prepare] building (tsdown)...');
const npmRun = process.platform === 'win32' ? 'cmd /c npm run bundle' : 'npm run bundle';
const build = spawnSync(npmRun, { cwd: ROOT, stdio: 'inherit', shell: true });
if (build.status !== 0) {
  console.error(`[prepare] 构建失败 (exit ${build.status})`);
  process.exit(1);
}

// 桌面共享核心与浏览器 bundle 取自同一份 src/shared，产出 window.PetShared（详见 build-desktop-core.mjs）。
console.log('[prepare] building desktop shared-core...');
const coreRun = process.platform === 'win32' ? 'cmd /c npm run build:desktop-core' : 'npm run build:desktop-core';
const buildCore = spawnSync(coreRun, { cwd: ROOT, stdio: 'inherit', shell: true });
if (buildCore.status !== 0) {
  console.error(`[prepare] 桌面 shared-core 构建失败 (exit ${buildCore.status})`);
  process.exit(1);
}

// 类型声明是构建产物、不入 git，克隆后靠这一步补齐；漏跑则 exports 声明的 types 路径全空。
console.log('[prepare] generating types (npm run types)...');
const typesRun = process.platform === 'win32' ? 'cmd /c npm run types' : 'npm run types';
const buildTypes = spawnSync(typesRun, { cwd: ROOT, stdio: 'inherit', shell: true });
if (buildTypes.status !== 0) {
  console.error(`[prepare] 类型声明生成失败 (exit ${buildTypes.status})`);
  process.exit(1);
}

// live2d 的两个浏览器依赖以 UMD 形式随包发布（/vendor 路由），运行期由页面 <script> 加载。
// 必须从依赖的实际安装位置取，不能写死 node_modules 层级：pnpm 的硬链接布局会变。
console.log('[prepare] staging live2d vendor bundles...');
const vendorDir = join(ROOT, 'assets', 'vendor');
mkdirSync(vendorDir, { recursive: true });
const require_ = createRequire(PKG);
/** 由模块入口反推包根：两个包的 exports 都不暴露 package.json，只能从解析出的文件向上找。 */
const packageRootOf = (specifier) => {
  let dir = dirname(require_.resolve(specifier));
  while (!existsSync(join(dir, 'package.json'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error(`[prepare] 找不到包根：${specifier}`);
    dir = up;
  }
  return dir;
};
const vendorFiles = [
  [join(packageRootOf('pixi.js'), 'dist', 'browser', 'pixi.min.js'), 'pixi.min.js'],
  [join(packageRootOf('pixi-live2d-display'), 'dist', 'cubism4.min.js'), 'live2d-cubism4.min.js'],
];
for (const [from, name] of vendorFiles) copyFileSync(from, join(vendorDir, name));
console.log(`[prepare] ✓ assets/vendor: ${vendorFiles.map(([, name]) => name).join(', ')}`);

// files 收敛为发布清单：这是本脚本唯一的写操作，幂等，不备份旧值。
const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
// 动画只发「最小内置包」：逐文件列进 files[]，而不是整目录。
// 这样仓库里仍留着全部 106 段（CI 靠它们打 extras 包），但 npm 包只带这 8 段——
// 想把目录整体加回来会让包重新长到 60MB+（见 assets/core-anims.json 的注释）。
const CORE_ANIMS = JSON.parse(readFileSync(join(ROOT, 'assets', 'core-anims.json'), 'utf8')).core;
if (!Array.isArray(CORE_ANIMS) || CORE_ANIMS.length === 0) {
  console.error('[prepare] assets/core-anims.json 里 core 为空：最小内置包不能为 0 段');
  process.exit(1);
}
const coreAnimFiles = CORE_ANIMS.map((name) => 'assets/webm/' + name + '.webm');
for (const rel of coreAnimFiles) {
  if (!existsSync(join(ROOT, rel))) {
    console.error(`[prepare] 核心动画缺失：${rel}（清单与文件不一致，先补文件或改 core-anims.json）`);
    process.exit(1);
  }
}
// 分层皮肤（layered 渲染）随最小内置包一起发：这是「装完就能试第二种渲染」的唯一一份。
// 两套都按 `<皮肤 id>/manifest.json` 校验——少了清单就只是一堆读不到的 PNG。
const CORE_SKINS = JSON.parse(readFileSync(join(ROOT, 'assets', 'core-skins.json'), 'utf8')).skins;
if (!Array.isArray(CORE_SKINS) || CORE_SKINS.length === 0) {
  console.error('[prepare] assets/core-skins.json 里 skins 为空：layered 将无素材可选');
  process.exit(1);
}
for (const id of CORE_SKINS) {
  const manifest = 'assets/pet/layered/' + id + '/manifest.json';
  if (!existsSync(join(ROOT, manifest))) {
    console.error(`[prepare] 内置皮肤缺失：${manifest}（清单与目录不一致，先补文件或改 core-skins.json）`);
    process.exit(1);
  }
}
const keep = [
  'lib',
  'src',
  ...coreAnimFiles,
  // 内置分层皮肤（整目录随包发）：`<包根>/assets/pet` 是池根序表的最后一项，
  // `/skin/<素材根>/skins` 靠它列出内置皮肤。逐套列太脆（新增一套就漏发），整目录更稳。
  'assets/pet',
  'runtime/electron-helper',
  'assets/pic',
  // 点击音效：宿主半侧的 /sound 路由只读包内这一份，漏掉则点击静音。
  'assets/sound',
  // live2d 的两个浏览器依赖（pixi / pixi-live2d-display UMD）：由本脚本从依赖里拷出，/vendor 路由只读包内这一份。
  'assets/vendor',
  'assets/config.jsonc',
  // 资源包清单：`GET /packs` 读它，缺了就是「没有任何可获取素材」——功能上不崩，
  // 但用户会以为下载入口坏了，所以必须随包发。
  'assets/packs.json',
  // 最小内置包的清单本身也随包发：用户能看出「哪些动画是随包带的、其余要走 extras」。
  'assets/core-anims.json',
  // 内置分层皮肤的清单：与 core-anims.json 同一用途（内置了什么、其余去哪里拿）。
  'assets/core-skins.json',
  // 插件图标：package.json 顶层 icon 指向这张图；缺图时读取方 dsh-app-boot 的 iconOf 会抛错、退回默认插画。
  'assets/logo.png',
  // 角色参考图：/character 的包内兜底只读 `<素材根>-character.<ext>`，漏发则第三方拿不到官方参考图。
  // 新增内置角色时在这里补一行（文件名里的素材根跟着角色走）。
  'assets/main-character.png',
  'scripts/ensure-electron.mjs',
  'cordis.patch.yml',
];
// 有意不进包的三个素材目录——**不要加回上面的白名单**：
//   assets/fonts  —— 商业字体已移除；内置 OFL 字体与用户自备字体都放数据根（`<数据根>/fonts/`），
//                    包内留一份会让「字体授权」重新变成发布风险（见 NOTICE 第 5 节）。
//   assets/memes  —— 表情包走 extras 下载包（NOTICE 第 7 节）；宿主半侧已支持从
//                    `<数据根>/memes/` 优先读，包内不需要这份。
//   assets/cubism —— Cubism Core 由用户从 Live2D 官方取得后指向本地（NOTICE 第 4 节），
//                    随包分发会违反其许可第 6.2 条。
writeFileSync(PKG, JSON.stringify({ ...pkg, files: keep }, null, 2) + '\n', 'utf8');
console.log(`[prepare] ✓ package.json files=[${keep.join(', ')}]`);
console.log('[prepare] ready to publish: npm publish --tag latest');
