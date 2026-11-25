#!/usr/bin/env node
/**
 * 发布前健康检查，由 package.json 的 prepack 触发，任何一项失败都以非零退出码阻断发布。
 *
 * 查必需文件、待机动画素材、原始母版是否误入包、client.js 的官方 bundle 形态、
 * package.json 的 dsh.bundle 与 dsh.client 声明、表情包图片与配置键是否对齐、包体积上限，
 * 以及构建产物有没有引入未声明的 @oxc-project/runtime helper。
 * 只读检查，不构建、不打包、不改任何文件，依赖已构建好的 lib 与 assets。
 * @module dsh-fish-body/scripts/prepack-check
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 包根目录（scripts/ 的上一级）
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
// 失败与通过两种输出的辅助函数。
const fail = (msg) => {
  console.error(`[prepack-check] FAIL: ${msg}`);
  process.exitCode = 1;
};
const ok = (msg) => console.log(`[prepack-check] ok: ${msg}`);
/** JSONC → JSON：字符串感知地剥离行注释与块注释（config.jsonc 里有行尾注释）。 */
const stripJsonc = (s) => {
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (c === '\\') out += s[++i] ?? '';
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += c;
  }
  return out;
};

// 缺任一件，装上就是运行期报错，所以在发布前逐个点名。
const required = [
  'lib/index.js', // 宿主半侧
  'lib/client.js', // 浏览器半侧
  'lib/types/index.d.ts', // 宿主类型声明
  'lib/types/client/index.d.ts', // 客户端类型声明
  'cordis.patch.yml', // bundle patch（挂载声明）
  'runtime/electron-helper/main.js', // 桌面模式 Electron 主进程
  'runtime/electron-helper/main/smoke.js', // 桌面模式冒烟自检（main.js require，缺了启动即崩）
  'runtime/electron-helper/main/dpi.js', // 桌面模式 DPI 与指针（main.js require，缺了启动即崩）
  'runtime/electron-helper/main/bridge.js', // 桌面模式与宿主通道（同上）
  'runtime/electron-helper/main/tray.js', // 桌面模式托盘（同上）
  'runtime/electron-helper/main/windows.js', // 桌面模式窗口与两条实时泵（同上）
  'runtime/electron-helper/main/ipc.js', // 桌面模式 ipc 处理器（同上）
  'runtime/electron-helper/main/displays.js', // 桌面模式显示器热更新（同上）
  'runtime/electron-helper/main/user-data.js', // 桌面模式 userData 回退决策（main.js require，缺了会启动即崩）
  'runtime/electron-helper/pointer-target.js', // 桌面模式点击穿透兜底判定（main.js require，缺了会启动即崩）
  'runtime/electron-helper/host-liveness.js', // 桌面模式宿主存活判定（main.js require，缺了会启动即崩）
  'runtime/electron-helper/topmost-watchdog.js', // 桌面模式置顶看门狗判定（main.js require，缺了会启动即崩）
  'runtime/electron-helper/taskbar-watchdog.js', // 桌面模式任务栏看门狗判定（main.js require，缺了会启动即崩）
  'runtime/electron-helper/dpi-linearization.js', // 桌面模式 DPI 线性化判定与换算（main.js require，缺了会启动即崩）
  'runtime/electron-helper/tray-platform.js', // 桌面模式托盘平台差异判定（main.js require，缺了会启动即崩）
  'runtime/electron-helper/desktop-geometry.js', // 活动边界与菜单工作区分离
  'runtime/electron-helper/preload.js', // 桌面模式 preload 桥
  'runtime/electron-helper/renderer.js', // 桌面模式渲染端（宠物本体）
  'runtime/electron-helper/sprite/bubble.js', // 桌面模式气泡与提示渲染（sprite.js 的原型扩展，须在其后加载）
  'runtime/electron-helper/sprite/menu.js', // 桌面模式右键菜单（sprite.js 的原型扩展，须在其后加载）
  'runtime/electron-helper/sprite/playback.js', // 桌面模式播放状态机（同上）
  'runtime/electron-helper/sprite/motion.js', // 桌面模式运动驱动（同上）
  'runtime/electron-helper/sprite/input.js', // 桌面模式指针与命中（同上）
  'runtime/electron-helper/sprite/init.js', // 桌面模式构建期初始化（同上）
  'runtime/electron-helper/sprite/window-fit.js', // 桌面模式窗口落位与钳制补偿（sprite.js 的原型扩展，须在其后加载）
  'runtime/electron-helper/shared-core.js', // 桌面模式共享纯逻辑（src/shared 构建产物，window.PetShared）
  'runtime/electron-helper/index.html', // 桌面模式页面壳
];
for (const f of required) {
  existsSync(join(ROOT, f)) ? ok(`exists ${f}`) : fail(`missing ${f}`);
}

// 待机动画是播放链的起点，缺了宠物立不起来；浏览器与桌面 Helper 共用这一份 webm。
const idleWebm = join(ROOT, 'assets', 'webm', '待机呼吸休闲.webm');
existsSync(idleWebm) ? ok('idle webm present') : fail('missing 待机呼吸休闲.webm thumb');

// 原始母版（1200×1200）体积超限，应放 GitHub Releases，不进 npm 包。
// assets/ 根下若有 .webm 就是原始母版，播放素材在 assets/webm|mov 子目录。
const originals = [];
const assetsRoot = join(ROOT, 'assets');
for (const name of readdirSync(assetsRoot)) {
  if (name.endsWith('.webm')) originals.push(name);
}
if (originals.length > 0)
  fail(`original masters must not ship in npm package: ${originals.join(', ')} (move them to GitHub Releases)`);
else ok('no original masters in assets/');

// 宿主加载器只认官方 bundle 形态；形制不对，插件在浏览器半侧根本注册不上。
const client = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
client.includes('__ModuleLoader__.load')
  ? ok('client bundle shell OK')
  : fail('client.js missing __ModuleLoader__.load');
const exportsPlugin =
  /exports\.(apply|inject|name)/.test(client) || /module\.exports\s*=\s*\{[^}]*apply[^}]*inject[^}]*name/.test(client);
exportsPlugin ? ok('client exports apply/inject/name') : fail('client.js missing apply/inject/name exports');

// 两项声明缺任一个都装不进宿主：bundle 声明决定挂载声明，client 声明决定浏览器半侧注入。
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (pkg.dsh?.bundle?.patch) ok('dsh.bundle.patch declared');
else fail('package.json missing dsh.bundle.patch');
if (pkg.dsh?.client?.platform === 'web') ok('dsh.client.web declared');
else fail('package.json missing dsh.client platform web');

// 配图（memes）、字体（fonts）、Cubism Core 自开源改造起一律**不进包**：
// 它们改由运行期获取（extras 下载包 / 用户自备 / Live2D 官方 SDK），见 NOTICE 第 4、5 节。
// 因此这里不再断言「必须在 files[] 里」；本地开发机可能还留着这些文件，只做提示。
const memesDir = join(ROOT, 'assets', 'memes');
const memePngs = existsSync(memesDir) ? readdirSync(memesDir).filter((n) => n.endsWith('.png')) : [];
if (memePngs.length === 0) {
  console.log('[prepack-check] note: 包内不含 memes 图片 —— 由 extras 下载包提供，用户未下载前配图不可用');
} else if (!Array.isArray(pkg.files) || !pkg.files.includes('assets/memes')) {
  console.log(
    `[prepack-check] note: 本地有 ${memePngs.length} 张 memes 图片，但不进包（extras 渠道分发）；` +
      '若确实要随包发布，需同时改 scripts/prepare.js 的白名单',
  );
} else {
  ok(`meme images shipped (${memePngs.length} png)`);
}
// memes 键 ↔ 图片文件对齐：缺图条目会被 host 静默剔除（设计如此，不阻断发布），
// 但数字对不上值得发布前看一眼，故只提示。仅在有图时才有意义。
if (memePngs.length > 0) {
  try {
    const conf = JSON.parse(stripJsonc(readFileSync(join(ROOT, 'assets', 'config.jsonc'), 'utf8')));
    const keys = Object.keys(conf.memes ?? {});
    const onDisk = new Set(memePngs.map((n) => n.slice(0, -'.png'.length)));
    const missing = keys.filter((k) => !onDisk.has(k));
    const extra = [...onDisk].filter((k) => !keys.includes(k));
    if (!missing.length && !extra.length) ok(`memes mapping aligned (${keys.length} keys = ${memePngs.length} png)`);
    else
      console.log(
        `[prepack-check] note: memes 键与图片不齐 —— 缺图 ${missing.length} 条${
          missing.length ? `（${missing.join('、')}）` : ''
        }；没写进配置的图 ${extra.length} 张${extra.length ? `（${extra.join('、')}）` : ''}`,
      );
  } catch (e) {
    console.log(`[prepack-check] note: 跳过 memes 键对齐核对（config.jsonc 解析失败：${e.message}）`);
  }
}

// 角色参考图：/character 的包内兜底只读这张图，漏发则第三方拿不到任何官方参考图。
// 与 memes 同一类问题——prepare.js 的白名单才是真源，这里显式断言防止再次静默漏发。
const characterFile = 'assets/main-character.png';
if (Array.isArray(pkg.files) && pkg.files.includes(characterFile)) ok(`files includes ${characterFile}`);
else fail(`package.json files must include ${characterFile} (character reference would not ship)`);

// 内置分层皮肤：`<包根>/assets/pet` 是池根序表的最后一项，漏发则「装完就能试 layered」落空——
// 而这类漏发不会让任何东西报错，只会让右键「皮肤」菜单空着，所以发布前点名。
const coreSkinsPath = join(ROOT, 'assets', 'core-skins.json');
const petDir = join(ROOT, 'assets', 'pet');
if (!existsSync(coreSkinsPath)) {
  console.log('[prepack-check] note: 没有 assets/core-skins.json —— 包内不含内置分层皮肤');
} else {
  const declared = JSON.parse(readFileSync(coreSkinsPath, 'utf8')).skins;
  const ids = Array.isArray(declared) ? declared.filter((id) => typeof id === 'string') : [];
  const missing = ids.filter((id) => !existsSync(join(petDir, 'layered', id, 'manifest.json')));
  if (missing.length > 0) fail(`core-skins.json 声明的皮肤缺清单：${missing.join('、')}`);
  else if (!Array.isArray(pkg.files) || !pkg.files.includes('assets/pet'))
    fail('package.json files must include assets/pet (built-in layered skins would not ship)');
  else ok(`built-in layered skins shipped (${ids.length}: ${ids.join(', ')})`);
}

// 估算将进包的总大小：直接按 `files` 清单统计，不再扫全仓。
// 素材改为运行期获取后，本地目录与「将进包的内容」不再一致（本机可能留着字体 / Cubism / 表情包），
// 扫全仓会把没进包的文件算进体积，给出的数字反而误导。
let total = 0;
const walkPkgEntry = (abs) => {
  const st = statSync(abs, { throwIfNoEntry: false });
  if (!st) return;
  if (st.isDirectory()) {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const p = join(abs, entry.name);
      if (entry.isDirectory()) walkPkgEntry(p);
      else if (!entry.name.endsWith('.map') && !entry.name.endsWith('.tgz')) total += statSync(p).size;
    }
  } else if (!abs.endsWith('.map') && !abs.endsWith('.tgz')) total += st.size;
};
for (const rel of Array.isArray(pkg.files) ? pkg.files : []) walkPkgEntry(join(ROOT, rel));
const mb = (total / 1e6).toFixed(1);
if (total > 200e6) fail(`package too large: ${mb}MB (limit 200MB)`);
else ok(`package size ${mb}MB`);

// rolldown 在 target es2020 下会为「带初始化器的类字段」产出降级语法，
// 打包结果里就会多出 `import _defineProperty from "@oxc-project/runtime/helpers/defineProperty"`；
// 该包既不在 dependencies 也不随包发布，宿主加载插件树时会 ERR_MODULE_NOT_FOUND，整个 profile 起不来。
// 约定是类字段一律 declare 加构造器赋值，避免降级出外部 helper（见 src/host/helper-process.ts）。
const OXC_RUNTIME = '@oxc-project/runtime';
const oxcBundles = ['lib/index.js', 'lib/client.js'].filter((f) => {
  const p = join(ROOT, f);
  return existsSync(p) && readFileSync(p, 'utf8').includes(OXC_RUNTIME);
});
if (oxcBundles.length > 0)
  fail(
    `bundle imports undeclared helper ${OXC_RUNTIME} (${oxcBundles.join(', ')}) — ` +
      '类字段改用 declare + 构造器赋值（见 src/host/helper-process.ts 的约定）',
  );
else ok(`no undeclared ${OXC_RUNTIME} import in bundles`);

if (process.exitCode) console.error('\n[prepack-check] fix the failures above before publishing.');
else console.log('\n[prepack-check] all checks passed — ready to pack/publish.');
