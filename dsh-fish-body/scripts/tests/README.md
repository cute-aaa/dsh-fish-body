# 设置页浏览器回归

在 `dsh-pet/` 包目录运行：

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
npm run test:ui
```

Linux CI 缺少系统库时用 `pnpm exec playwright install --with-deps chromium`。

测试用真实 React 和 Chromium 渲染设置页，拦截配置与模型接口，验证加载、失败重试、恢复默认与保存，以及中英文窄窗口布局。只访问临时本地服务，不读取或修改用户的 DSH 配置。与 `npm test` 的 Node 单元测试分开运行，普通插件安装不下载浏览器。

可选设置 `DSH_PET_UI_ARTIFACTS` 为输出目录，保存布局截图。桌面 Electron 窗口、操作系统点击穿透和显示器缩放仍需另做运行时测试。

## helper vm 夹具（非浏览器）

`runtime/electron-helper/sprite/*.js` 是经典脚本（挂 `PetSprite.prototype`、靠全局 `S` 取 `shared-core`），不能 `import`，只能经 `node:vm` 覆盖。参考用例：`helper-drag-limits.test.mjs`、`fish-interaction.test.mjs`。

**载体三件**：真 `runtime/electron-helper/shared-core.js` + `sprite/window-fit.js` + `sprite/input.js`，同一 context 依次 `runInContext`。

**context 必需全局**：`PetSprite`、`VIEW`、`WORK_AREAS`、`CONFIG{scale,isWindowClampedToWorkArea}`、`toScreen/toLocal`、`document.createElement`、`window.__dshPetDebug`、`performance.now`、`console`、`setTimeout/clearTimeout`。

**两跳手工接线**：载入 `shared-core.js` 后必须补 `context.window.PetShared = context.PetShared; context.S = context.PetShared`。真机靠 `constants.js` 取全局 `S`，vm 里不载它（它要真 URL 参数）。

**`makeSprite` 桩清单**：位置/尺寸/`hitRect`/`winH`/`el`/`hit`/`dragState` 之外，执行 `onPointerMove` 还差两个易漏桩——`playHookSfx(){}` 与 `animations:{drag:[],idle:[]}`。缺任一条都走不到内侧分支，用例会"通过"却没覆盖到拖拽目标计算。

**约定**：新增 helper 交互用例前，先确认这个分支真的被执行到（用桩计数器或返回值的可观察差异），不要只断言「没抛异常」。资源应力的边界见 [`docs/测试约定.md`](../../../docs/测试约定.md)。
