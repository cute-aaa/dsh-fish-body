# dsh-fish-body 🐟

原生接入 dsh 人设卡的桌宠插件：把 `dsh-fish-soul` 的「大肥鱼」人格直接变成桌面上一只会动、会说话、会按人设互动的鱼。

## 一、选型理由

| 决策 | 选择 | 理由 |
|---|---|---|
| 语言 | 纯 JavaScript（ESM，零构建） | 插件随 DSH 模块系统直接加载，无需 tsdown/pnpm 构建链，安装即用；资源占用最小。 |
| 动画 | webm（VP9-alpha 透明视频）+ layered 分层 PNG | 参考项目（dsh-pet-to-family / dsh-pet）的资源全部是 webm；surfcore 皮肤是「18 张分层 PNG + manifest」，另加了 canvas 2D 合成器，两种都能直接用。 |
| live2d | 可插拔渲染器（预留，需 SDK） | 参考项目里没有 `.moc3`/`.model3.json` 模型，live2d 无法「直接使用」；接口与加载路径已实现，接入 SDK 即用（见 §四）。 |
| 人设接入 | 原生读人设卡（不复制、不解析） | 单一事实来源：桌宠与人格项目读同一张 SillyTavern chara_card_v2。 |
| 语音 | 可插拔 provider（GPT-SoVITS / 通用 TTS / 云端） | 三类都走 HTTP，按需配置，不内置任何 SDK。 |
| 双形态 | 共享渲染内核 `assets/core.js` | 浏览器内（shell.overlay）与桌面独立窗口复用同一份 DOM 渲染；`form=desktop` 时浏览器内那层自动不挂载。 |
| 桌面窗口 | Electron → Chromium `--app=` → 浏览器标签页 | 没装 Electron 时用 Chrome/Edge 的应用模式开独立窗口（无地址栏、随窗口退出），仍然失败才退浏览器标签页；逐级降级，绝不因此失败。 |
| 依赖 | 仅 `@deepseek-ai/schemastery`（可选） | 其余服务（webServer/llm/agentDefaultModel）全部注入；schemastery 缺失时设置页降级，插件本体照常跑。 |

## 二、目录结构

```
lib/
  index.js          宿主入口（装配）
  config.js         配置 schema（volatile 热改）
  paths.js          环境识别（DSH_HOME / profile）
  http.js           路由工具（JSON / 文件 / SSE）
  state.js          状态中枢（单一快照 + 订阅）
  llm.js            LLM 调用助手
  persona/          人格接入（types / card-reader / sources / registry）
  assets.js         资源注册表（webm / 音效 / live2d / layered 皮肤）
  voice.js          语音引擎（GPT-SoVITS / TTS / cloud）
  interaction.js    人设互动
  work-status.js    实时任务状态
  screen.js         屏幕内容识别
  avoidance.js      避让引擎
  desktop.js        桌面独立窗口（Electron → Chromium --app= → 浏览器）
  routes.js         HTTP 路由
client.js           浏览器半区（shell.overlay + settings.section）
assets/core.js      共享渲染内核（webm 双层视频 / layered 挂载 / 气泡 / 拖动 / 点击 / SSE）
assets/layered.js   layered 皮肤渲染器（canvas 2D 合成 18 层 PNG + rigOptions 动画）
assets/standalone.html  桌面独立窗口页面
assets/skins/       内置 layered 皮肤
tools/              仅开发用（预览服务器 / CDP 截图 / 路由探针），不在发布文件里
```

## 三、功能（对应需求 §四～§八）

1. **环境识别**（§四.1）：`lib/paths.js` 读 `DSH_HOME`（优先宿主 `resolveDshHome`）、`DSH_PROFILE`、`DSH_PROFILE_DIR`，经 `GET /api/fish-body/env` 暴露。
2. **人格接入接口**（§四.2）：见下方 §四。
3. **动画资源**（§四.3）：三种渲染后端——webm 透明视频、layered 分层 PNG 皮肤（surfcore 格式）、live2d 占位；点击动画、点击音效、动画音效均可在配置中按名字指定。
4. **资源扩展**（§四.4）：配置 `resourceDirs` 追加目录，递归扫描 `.webm/.mov/.mp4`（动画）、`.wav/.mp3/.ogg`（音效）、`*.model3.json`（live2d）、`manifest.json` 且 `rig: "layered"`（皮肤），`POST /api/fish-body/scan` 重扫。
5. **语音接入**（§四.5）：`voiceProvider` 切 `gpt-sovits` / `tts` / `cloud`。
6. **互动能力**（§五）：按人设发言（`POST /api/fish-body/chat`）；`taskStatus` 实时显示 dsh 任务状态（思考/工作中/等待/完成/出错）；`screenRecognition` 识别屏幕内容并互动；layered 皮肤按 `interaction.regions` 做命中（波奇碗 pot → `pot-hit` 音效 + 摸摸闭眼，身体 → 戳一下）。
7. **设置项**（§六）：`followDsh` 随 dsh 启停；`form` 在 `browser`（集成到 dsh 页面）与 `desktop`（独立窗口）间切换，**运行中改也会即时启停窗口**（不再只在启动时判断），设置页还能手动开关窗口并显示用的是哪个引擎。
8. **避让场景**（§七，多选式）：`avoidance.fullscreen` / `avoidance.dshIdle` / `avoidance.followDsh` / `avoidance.appList`，逐项独立开关。
9. **性能**（§八）：每个功能独立模块；webm 只用两层 `<video>`，动作播放时 idle 淡出（不会透出底下的视频）；layered 用一块 canvas、图层位图按 0.6 预缩放；SSE 只推快照、无变化不推；扫描结果缓存。

## 三之二、layered 皮肤（surfcore 格式）

皮肤目录结构（`assets/skins/feiyu-05` 即示例）：

```
manifest.json     schema 2 / rig: "layered" / canvas / hitbox / display.scale
art/*.png         18 张 1280×1280 分层 PNG（按 manifest.layers 顺序）
sfx/pot-hit.wav   interaction.sounds 里声明的音效
persona.md        persona.prompt 指向的人设补充
```

`assets/layered.js` 用 canvas 2D 合成，按 `rigOptions` 驱动：

- `motion.breath / sway`：body 呼吸缩放 + 摇摆；
- `headPivot + motion.headTurn + headTilt`：转头与倾斜；
- `eyeCenters / gazeCenter + motion.gazeMax`：虹膜位移（视线跟随鼠标）+ 头部朝向；
- `blinkLash`：眨眼时睫毛下移、眼白/虹膜淡出；
- `mouth.open / openCover / openPivot`：说话时张嘴（说话开口度由 `chat` 回复驱动）；
- `jelly`：点击/拖动/跳时的挤压拉伸；
- `interaction.regions`：`ellipse` / `rect` 命中区（先命中先生效，按 manifest 顺序）。

画布只渲染 `hitbox` 区域（自动加 3% 余量）并按容器等比缩放，所以 1280×1280 的皮肤在 200~400px 的桌宠框里也是满幅。命中判定用画布坐标反算，缩放/换尺寸后依然准确。

## 四、人格接入接口（「原生使用人设卡」）

- 接口：`lib/persona/types.js` 的 `PersonaSource`（抽象类），实现类必须 `static get id()` 与 `async readCurrent()`，返回 `PersonaDescriptor`（人设卡的**投影**，含原卡字段引用）。
- **原生使用** = 直接读取该项目自己读的那张人设卡（如 `$DSH_HOME/fish-soul/persona.json` / `persona.png`），**不复制**（= 不同步）、**不另立格式**（= 不解析成别的东西）。单一事实来源，两个消费者读同一张卡。
- 内置实现类：`fish-soul`、`dsh-soul`、`dsh-rofm`、`dsh-suzu-memory`（`lib/persona/sources.js`），各自约定卡路径（`$DSH_HOME/<dir>/persona.{json,png}`）。
- **自行扩展**：继承 `PersonaSource`（或 `SillyTavernCardSource`）实现 `readCurrent`，经 `PersonaRegistry.register(source)` 注册即可。

## 五、live2d / webm / layered 资源直接使用说明

- **webm**：参考目录 `G:\Projnew\git\dsh-body` 下的 `dsh-pet/assets/webm/*.webm`、`dsh-pet-indesktop/assets/characters/*/videos/**/*.webm` 可直接使用——把目录加进 `resourceDirs`，动画名 = 文件名去扩展名（如「点击回应-开心跃动」）。
- **layered**：surfcore 皮肤目录（`manifest.json` + `art/*.png`）加进 `resourceDirs` 或放进 `assets/skins/`，`POST /api/fish-body/scan` 后即可在设置页「动画类型」选 `layered`、「分层皮肤」里挑（如 `feiyu-05`）。
- **多角色（webm 角色包）**：把含 `characters/<id>/videos/**/*.webm` 的目录加进 `resourceDirs`，扫描后角色 id 会出现在设置页「webm 角色包」下拉里；选中后动画名自动解析成 `<id>/<动作名>`（动作名沿用原来的中文名，音效/点击逻辑不变）。
- **导入示例**：`G:\Projnew\git\dsh-body` 里
  | 内容 | 路径 | 能否直接用 |
  |---|---|---|
  | webm 动画集（默认角色） | `dsh-pet\...\assets\webm` | ✅（已内置同名副本） |
  | webm 角色包 `shenshen` | `dsh-pet-indesktop\assets\characters` | ✅ 加进 `resourceDirs` 即可 |
  | layered / 2.5D 模型 | `Coopanion\packages\cortico-world-desktop-pet\web\whale` | ⚠️ 它是网格形变 rig（`model.json`：`grid`/`pivot`/`parent`/`schemes`/`outfits`），不是 surfcore `manifest.json` 的 18 层格式，现有渲染器不支持 |
  | live2d | — | ❌ 整个仓库没有 `.moc3` / `.model3.json` |
  | 逐帧精灵表 | `aboutme-pets\pets\*` | ❌ WebP spritesheet 格式，未实现 |
- **live2d**：参考项目里**没有任何 `.moc3` / `.model3.json` 模型**（它们全部是 webm 或 PSD 自动装配），因此 live2d 模型无法「直接使用」。本插件已实现 live2d 的资源扫描、服务与渲染接口，接入任意 live2d 模型（`*.model3.json` 目录）即可；渲染需 pixi + Cubism SDK，未内置 SDK 时降级为占位符。

## 六、配置项

在 profile 的 `cordis.patch.yml`（或设置页）里配置，字段见 `lib/config.js` 的 `DEFAULTS`。核心：

```yaml
- insert:
    - id: dsh-fish-body
      name: 'dsh-fish-body'
      config:
        enabled: true
        form: browser            # browser | desktop
        size: 200                # 桌宠框逻辑宽度（px），实际宽度 = size × scale
        scale: 1
        modelType: webm          # webm | layered | live2d
        webmSet: shenshen        # modelType=webm 时的角色包（characters/<id>/ 的动画集），空=内置
        layeredSkin: feiyu-05    # modelType=layered 时的皮肤 id
        webmIdle: 待机呼吸休闲
        webmClick: 点击回应-开心跃动
        clickSound: click-duck
        personaSource: fish-soul
        voiceProvider: none      # none | gpt-sovits | tts | cloud
        resourceDirs:
          - 'G:\\Projnew\\git\\dsh-body\\dsh-pet\\assets\\webm'
        taskStatus: true
        screenRecognition: false
        followDsh: true
        avoidance:
          fullscreen: false
          dshIdle: false
          followDsh: true
          appList: []
```

`form: desktop` 时的窗口行为：

1. 启动（`followDsh: true`）或在设置页保存后，宿主会调用 `lib/desktop.js` 开窗；
2. 优先 `DSH_ELECTRON_PATH` / 本地 `electron.exe`（透明无边框置顶）；
3. 否则用 Chrome/Edge 的 `--app=` 应用窗口（独立进程、无地址栏，默认深色底）；
4. 再不行才用系统默认浏览器开标签页；
5. 切成 `browser` 或关闭插件（且 `followDsh`）时窗口会被关掉；
6. 设置页「基本」标签里有窗口状态 + 打开/关闭按钮，并显示当前用的引擎。

## 七、扩展预留（只留架构，不实现）

以下方向**未实现任何具体代码**，但架构已为其预留可插拔边界：

- 表情系统 → `state.persona.moods` 已入快照，可挂「心情→动画」映射；
- 角色卡 / 表情包分类 → 资源注册表 `assets.manifest` 已按 kind 分桶；
- 行为状态扩展 → `work-status.js` 的 `tool` 通道可扩展动作文案；
- 外部平台接入（QQ/B站） → 依赖 DSH 会话事件，可再加 channel 模块；
- 更丰富输入输出 → `POST /api/fish-body/chat` 的 `history`/`voice` 字段已留位；
- 悬浮聊天栏 → `client.js` 可再注册一个 `shell.overlay` 条目；
- 按文件名识别动画语义 → 资源名（中文文件名）已是语义键；
- 语音音色按动画 → `voice` 配置可扩展 per-animation；
- 任务与玩法体系 → `work-status` 事件流可派生任务状态。

## 七之二、开发调试

`tools/` 里的脚本只用于开发，不随包发布：

```bash
# 1) 脱离 dsh 的预览页（同一份 core.js + layered.js，假状态接口）
node tools/preview-server.mjs 3199
#    http://127.0.0.1:3199/                       layered 皮肤
#    http://127.0.0.1:3199/?model=webm&size=320   webm 动画
#    http://127.0.0.1:3199/fish-body/standalone   真实独立窗口页面

# 2) 用真实 Chrome 走 CDP 截图 / 点命中区（会短暂开一个 app 窗口）
node tools/cdp-shot.mjs "http://127.0.0.1:3199/fish-body/standalone" tools/shots/a.png --wait 1500 --size 480x600
node tools/cdp-shot.mjs "http://127.0.0.1:3199/?model=layered&size=320" tools/shots/b.png --click 650,425 --eval "JSON.stringify({pat: window.__fishBodyRig.patTimer})"

# 3) 不开 dsh 直接跑路由（skins / desktop / 静态素材 / 防穿越 / 重复路由）
node tools/routes-probe.mjs

# 4) 验证桌面窗口三级落地（会真的开窗再关掉）
node tools/desktop-probe.mjs

# 5) 冒烟：模拟宿主 ctx，装配 apply() + 构建路由
$env:DSH_HOME='D:\NodeJS\DSH'; node test-smoke.mjs
```

调试用的全局对象（浏览器控制台）：`window.__fishBodyRig`（layered rig：`view`/`layers`/`pat()`/`pokeAt()`/`clientPoint(x,y)`）、`window.__fishBodyState`（最近一帧状态快照）。

## 八、安装

```bash
# 本地目录安装（本仓库即工作目录 G:\Projnew\ai\dsh-fish-body）
dsh plugin --profile fish add G:\Projnew\ai\dsh-fish-body
```

或经 DSH 插件管理页安装本目录 bundle。安装后重启 dsh（或 HMR），硬刷新页面。

## 九、许可

MIT。
