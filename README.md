# dsh-pet 🐾

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-pet"><img alt="npm version" src="https://img.shields.io/npm/v/dsh-pet?label=npm&color=blue"></a>
  <a href="https://www.npmjs.com/package/dsh-pet"><img alt="npm monthly downloads" src="https://img.shields.io/npm/dm/dsh-pet?label=%E6%9C%88%E4%B8%8B%E8%BD%BD&color=brightgreen"></a>
  <a href="https://www.npmjs.com/package/dsh-pet"><img alt="total downloads" src="https://img.shields.io/npm/dt/dsh-pet?label=%E6%80%BB%E4%B8%8B%E8%BD%BD&color=success"></a>
  <a href="https://github.com/PC2005-cloud/dsh-pet/releases"><img alt="release downloads" src="https://img.shields.io/github/downloads/PC2005-cloud/dsh-pet/total?label=Release%20%E4%B8%8B%E8%BD%BD&color=5C6BC0"></a>
  <a href="https://github.com/PC2005-cloud/dsh-pet"><img alt="stars" src="https://img.shields.io/github/stars/PC2005-cloud/dsh-pet?style=social"></a>
  <a href="https://github.com/PC2005-cloud/dsh-pet/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/github/license/PC2005-cloud/dsh-pet?color=orange"></a>
  <a href="https://awesome-dsh-plugin.com"><img alt="awesome dsh plugin" src="https://awesome-dsh-plugin.com/badge.svg"></a>
  <a href="https://github.com/PC2005-cloud/dsh-pet"><img alt="repo size" src="https://img.shields.io/github/repo-size/PC2005-cloud/dsh-pet"></a>
  <a href="https://github.com/PC2005-cloud/dsh-pet/issues"><img alt="issues" src="https://img.shields.io/github/issues/PC2005-cloud/dsh-pet"></a>
  <img alt="platform" src="https://img.shields.io/badge/platform-DeepSeek%20Harness%20Web-8A2BE2">
  <img alt="assets" src="https://img.shields.io/badge/assets-dynamic%20animations-ff69b4">
</p>

一只住在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 里的桌面宠物：待机呼吸、随机动作（打瞌睡、玩魔方、吃火锅……）、左右转向、屏幕漫游、点击 Q 弹、拖拽甩抛反弹、右键菜单点播——一百余个透明动画随时无缝衔接；还能跟随 DSH 会话事件切换工作状态动画、按档位播放余额动画 + 头顶气泡、碎碎念与对话聊天、窗口失焦时弹系统通知。可多开同屏，能脱离浏览器住上**桌面**（透明置顶小窗），也能自己添加**全新宠物种类**（pet pack）。

这不是一个普通插件，而是**完整的三件套项目**：

```
① 提示词（配方）    →  ② 素材生成链（引擎）  →  ③ 插件（成品）
AI 生成动画的配方     源视频 → 透明动画的管线    运行在 DSH 里的宠物
```

任何人 clone 本仓库，都可以**从零生成自己的桌面宠物**——换角色、换动作、换风格，全流程可复现。

---

## 本仓库：`dsh-fish-body`（`dsh-pet` 的 fork）

本仓库不是上游的发布分支，而是**本地 fork**：包名与插件 entry id 改为 `dsh-fish-body`，在 `dsh-pet v0.4.7` 之上加了下面这些能力。上游的素材链（① 提示词 → ② 素材生成 → ③ 插件）原样保留。

| 相对上游的差异 | 说明                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 三种渲染后端   | `webm` / `layered`（分层 PNG 皮肤）/ `live2d`（Cubism 模型），统一的 `Renderer` 接口 + 注册表，右键「渲染方式」与设置页切换即时重建舞台                           |
| 语音           | 免费链 = 本地 GSV（GPT-SoVITS `api_v2`）+ 在线 edge；**云端 DeepSeek TTS** 是显式开关（按量计费，默认关），可用时排链首、失败自动回落免费链，**永不进自动回退链** |
| 看屏幕与避让   | 桌面端定时截图 → 一句话（默认关）；前台全屏 / 白名单程序时自动躲开                                                                                                |
| 多素材根       | `assets.resourceDirs`：主池根之外再挂最多 8 个素材根，顺序即优先级，同 id 先到先得                                                                                |
| 独立模式       | `dsh-pet-standalone` CLI：不起 DSH 直接跑桌宠（宿主半边跑在伪 ctx 上）                                                                                            |
| 桌面壳         | 按需下载 Electron 运行时（不随包分发），支持自选运行时目录                                                                                                        |

### 构建与部署

```sh
cd dsh-pet
npm install          # 首次
npm run build        # tsdown → lib/、desktop shared-core、tsc → lib/types
```

挂载到 DSH 的方式（一次性）：

1. `$DSH_HOME/plugins/dsh-fish-body` 做 junction / 软链指向本仓库的 `dsh-pet/`（跨盘请用联结点，pnpm 的 `link:` 跨盘会拼坏路径）；
2. profile 的 `package.json` 依赖写成 `link:../../plugins/dsh-fish-body`，并在 `dsh.profile.bundles` 里登记 `dsh-fish-body`；
3. 重启该 profile。改 `src/host/**` 或 `src/shared/**` 后必须 `npm run build` **并重启 profile**；只改 `src/client/**` 也要 build（`lib/client.js` 没有 HMR），再刷新页面。

### 维护与回滚

| 想做的事                       | 怎么做                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 重启插件（免重启整个 profile） | 设置页「系统 → 维护动作」的「重启」，或 `POST <插件路由>/plugin-restart`                                               |
| 升级前留一份底                 | `cd dsh-pet && npm run rollback -- snapshot --label before-upgrade`（可选 `--with-config` 连 `config/` 一起拍）        |
| 看有哪些底                     | `npm run rollback -- list`                                                                                             |
| 退回上一个可用状态             | `npm run rollback -- restore <id>`（默认干跑，看清将覆盖哪些路径后再加 `--apply`；恢复前会自动再拍一份 `pre-restore`） |
| 数据布局回滚                   | `node scripts/migrate-layout.mjs --revert` 先干跑，确认后加 `--apply`                                                  |
| 把设置恢复为内置默认           | 设置页「系统 → 维护动作 → 重置设置」                                                                                   |

回滚只碰 `lib/`、`package.json`、`cordis.patch.yml`（可选 `config/`），**不碰** `data/`、`skin/`、`assets/pet/` 这些用户自己的东西。

---

## 快速开始（安装插件）

两种装法，任选一种：

- **图形化（桌面应用内）**：打开「插件管理」页，在安装框里填 `dsh-pet`，不用开终端。
- **命令行**：`dsh plugin --profile <profile> add dsh-pet`，`<profile>` 按你在用的界面填——`dsh web` 填 `web`，桌面应用（Electron 版）填 `desktop`。

**不想装 DSH？** Release 里提供 Windows x64 绿色包 `dsh-pet-win-x64.zip`，解压后双击 `dsh-pet.exe` 就能跑——那是独立模式，不依赖 DSH 环境。

装完**重开 DSH**（`dsh web` 用户则重启 `dsh web`）才生效——运行中的进程持有内存里的旧插件。宠物默认落在界面右上角。

前置要求、源码安装、独立模式的用法与打包、Electron 首次下载、装完会看到什么，见 **[INSTALL.md](INSTALL.md)**。

## 插件功能

只做桌宠本身，不碰 DSH 内核；能力就下面这些。

- **100+ 段动画资产**：待机、走动漫游、玩耍、工作、对话等全部表现都由视频动画驱动，按权重首尾相接，也可换成自己的素材。
- **多开与种类**：同时养多只，各自大小与位置；也能自定义宠物种类（pet pack），一类一套动画与素材。
- **三种运行形态**：DSH web 的浏览器 overlay、DSH 桌面应用的透明置顶窗、完全不依赖 DSH 的独立模式。
- **总开关**：设置页「系统与桌面」一个「桌宠总开关」，关掉＝所有宠物一起收起（桌面不建窗、网页不渲染、碎碎念/余额/待办也停跑），与每只宠物自己的显示位置互不干扰，开回来还是原样。另有「全局隐藏 / 暂停」的系统级快捷键（默认 `Ctrl+Alt+H`）：按一下全部藏起来并静音，再按一下放回来；全屏应用在前台触发避让时也会自动暂停语音。
- **交互与物理**：点击回应、拖拽甩抛、双击弹弓、宠物互撞，同一套物理与 Q 弹挤压手感，参数可调。
- **手机与触屏**：触屏直接拖拽甩抛，与鼠标共用同一套物理与挤压手感；手机浏览器上还能倾斜手机改变重力方向、摇一摇把宠物甩出去、碰撞时震动反馈——三项可在设置页「移动端效果」里分别关闭。传感器只在 HTTPS 或 localhost 下可用（iOS 还需点一次授权），iOS 与桌面端没有振动 API，会自动跳过。
- **碎碎念与对话**：按周期自动说一句，也能随时聊；记忆持久化、可配图、可念出来。
- **语音（说与听）**：对话回复与手动碎碎念会念出来，音色、音量与总开关可配；按住对话窗的话筒说一句，录音转成文字直接填进输入框。合成链只收不花钱的实现（本地 GSV、在线 edge），云端 **DeepSeek TTS** 作为可选来源单独开关（按字符计费，默认关，失败自动回落免费语音）。本地 GSV 对接原生 GPT-SoVITS 的 `api_v2`：填服务地址 + 音色包目录即可，音色 = 音色包目录里的一个子目录（缺权重或参考音频的音色会列出来但置灰，并写明缺哪份文件）；接入卡里的「导入音色…」一次选好 `GPT_weights` / `SoVITS_weights` 所在的目录（也能直接粘贴路径；弹的是系统选择框、会记住上次选过的目录，选错的参考音频或文本可以 × 掉重选），就能逐行勾选、配参考音频与文本、选「引用」或「复制」批量导入，旁边的「扫描音色」一点就重新同步目录里现有的音色。
- **余额展示**：内置常见服务商的余额 / 额度查询，按剩余额度分档播动画并弹气泡；也可以登记自己的服务商。
- **工作状态联动**：跟随 DSH 会话状态切档位动画，并在头顶常驻一句话。
- **会话鱼**：每条新建 / 进行中 / 刚结束还没点开的会话各派一条小鱼，默认**围着桌宠转**、跟着它走，鱼与鱼 / 鱼与桌宠会碰撞弹开（轻量版桌宠）；皮肤可自定义（图片 / 动图 / webm，放进 `<数据根>/assets/session-fish/` 即可），可逐条拖拽、**松手就停在松手处**、位置本地记住；能播报任务进度与轮次结束（语音有总开关，多鱼串行不抢麦，网页与桌面同时显示时同一条播报全机器只念一次），任务结束、你点进那条会话后鱼消失（plan 等待确认不算结束），再对话又回来；每条可单独关掉。**显示面跟着桌宠的 `display` 走**：网页浮层与桌面窗口里都有，桌面端画在桌宠同一个窗口内（不新增窗口 / 进程），鱼可拖、可关、带播报气泡，只有悬停到鱼身上时才接鼠标、其余区域照旧穿透。设置页「桌宠配置 → 会话鱼」可调开关、围着桌宠转、皮肤、大小、数量与语音（和其它设置一起在底部「应用 / 确定」落盘）。「系统 → 备份与恢复」可导出/恢复一份设置快照（主配置 + 种类配置 + 会话鱼原文，覆盖前自动留 `.bak`）。
- **待办事项**：一句话加可选到期时间，清单挂在宠物头顶；越临近到期提醒越密，由宠物说出来。
- **睡觉**：右键「睡觉」让它睡下，点一下或右键「起来」叫醒；睡着时完全安静——随机动作、碎碎念、余额、待办与工作状态都不打扰，还会按周期说梦话；睡姿可用 `animations.sleep` 配多套（蹲着睡、趴着睡…）。
- **看屏幕与避让**（默认全关）：开着时每隔一段时间截一张屏幕，交给当前模型看一眼、一句话弹气泡说出来（只出气泡不念）；间隔、是否只在 DSH 空闲时拍、空闲阈值、静默时段都可配，右键「看一眼屏幕」可手动触发。避让则是全屏程序或你指定的程序（`.exe` 进程名或窗口标题）在前台时把桌面宠物藏起来，切走再回来；躲开延迟、恢复延迟、轮询节拍、最大化算不算触发都可配，多屏时只按自己所在那块屏判断。十三个键都在「设置 → 系统 → 看屏幕与避让」一张卡里，仅桌面模式（Windows）生效。
- **系统通知**：任务完成或需要确认时弹系统通知，点一下回到对应会话。- **右键菜单**：换动画、开聊、回到原位、打开 DSH / 网站、重载配置。
- **其他**：点击音效、系统托盘（显示位置 / 大小 / 鼠标穿透 / 音量）与每只宠物的显示位置。

各项能力的详细说明见 **[FEATURES.md](FEATURES.md)**；配置（大小 / 位置 / 多开 / 物理 / 模型 / 人设 / 宠物种类）见 **[CONFIG.md](CONFIG.md)**。

## 🔌 对外接口（供其他插件调用）

桌宠不只自己玩，也**对外开放两条调用通道**，让别的插件或脚本能驱动它、读它的状态。

- **能做什么**：让它说一句指定的话、播一段指定动画、与它对话；读它当前说的话、工作状态、系统通知与余额
- **为什么开放**：桌宠不该只是个摆设——比如一个「女仆」插件巡检验完想说句话，就能让桌宠当它的「实体」开口；也方便任何人基于它做二次开发
- **通道一 · HTTP**：挂在 DSH 自己的 Web 服务上（前缀 `/dsh-pet-7340`，只监听本机、无鉴权），跨进程、脚本可直接调。动作类接口只回 `{ok}`，数据统一从 `GET /state` 读
- **通道二 · Cordis 服务**：客户端半侧在 DSH web 页面内注册，同页客户端插件用 `ctx.get('petApi7340')` 直接取，零网络、零端口；只在该页面实例内有效，方法与返回见 [`CORDIS.md`](CORDIS.md)

相关文件（HTTP 与 Cordis 各一套）：

- [`API.md`](API.md) —— HTTP 接口一览（每个接口一句话，功能预览）
- [`openapi.yaml`](openapi.yaml) —— 完整契约（OpenAPI 3.1，可直接导入 Swagger UI / Postman）
- [`CORDIS-API.md`](CORDIS-API.md) —— Cordis 服务一览（每个成员一句话，功能预览）
- [`CORDIS.md`](CORDIS.md) —— 对外 Cordis 服务（客户端半侧，页面内 `ctx.get('petApi7340')`，不走网络）
- [`tools/api-tester.html`](tools/api-tester.html) —— HTTP 侧示例：桌宠控制台，扮演第三方消费方，可直观试用（`node tools/api-tester.cjs` 启动）
- [`tools/cordis-probe`](tools/cordis-probe/README.md) —— Cordis 侧示例：扮演同页客户端插件，用 `ctx.get()` 消费服务

## 兼容性

- **操作系统**：Windows / Linux / macOS 三端均可运行——浏览器 overlay 与桌面模式（Electron 透明置顶窗）行为完全一致；Electron 按平台自动探测/下载（`electron.exe` / `Electron.app` / linux 单文件），无需手动安装
- **无头 / 无桌面环境**：支持 Linux headless 等无图形会话——桌面模式自动检测显示环境（Linux 无 `DISPLAY` / `WAYLAND_DISPLAY` 时判定无显示、跳过桌面窗口，仅日志告警），浏览器 overlay 不受影响
- **浏览器**：浏览器 overlay 兼容 **Chromium 内核（Chrome / Edge 等）与 Firefox**——透明动画依赖 VP9-Alpha webm，三者均已实测透明确认；**不支持 Safari**（macOS 不认 webm alpha，透明渲染为黑底）——macOS 用 `.mov` 素材（GitHub Release `assets-mov`），下载放入即可（见「②.5 Safari/HEVC 兼容素材」）
- **多显示器**：支持多屏环境——跨屏漫游/抛掷以各屏工作区为界，异构缩放（各屏 DPI 不同）、任务栏条带、屏幕之间空洞均正确判定（横屏 / 竖屏 / 上下叠放皆可）；设置页「锁定在当前屏幕」可让宠物（抛掷与漫游）只在当前所在那块屏内活动

## 运行效果

宠物实际运行在 DSH Web 界面中的样子：

<p>
  <img src="assets/screenshots/dsh-pet-running-1.png" width="380" alt="dsh-pet 运行效果 1" title="dsh-pet 运行效果 1">
  <img src="assets/screenshots/dsh-pet-running-2.png" width="380" alt="dsh-pet 运行效果 2" title="dsh-pet 运行效果 2">
  <img src="assets/screenshots/dsh-pet-running-3.png" width="380" alt="dsh-pet 运行效果 3" title="dsh-pet 运行效果 3">
  <img src="assets/screenshots/dsh-pet-running-4.png" width="380" alt="dsh-pet 运行效果 4" title="dsh-pet 运行效果 4">
  <img src="assets/screenshots/dsh-pet-running-5.png" width="380" alt="dsh-pet 运行效果 5" title="dsh-pet 运行效果 5">
  <img src="assets/screenshots/dsh-pet-running-6.png" width="380" alt="dsh-pet 运行效果 6" title="dsh-pet 运行效果 6">
  <img src="assets/screenshots/dsh-pet-running-7.png" width="380" alt="dsh-pet 运行效果 7" title="dsh-pet 运行效果 7">
  <img src="assets/screenshots/dsh-pet-running-8.png" width="380" alt="dsh-pet 运行效果 8" title="dsh-pet 运行效果 8">
</p>

## 效果预览

全部动画（640×360，插件实际播放用的资源）——GIF 预览存放于仓库 `dsh-pet/assets/preview/`（raw 直链渲染，文件名采用拼音便于跨平台）；完整透明视频见插件包 `dsh-pet/assets/webm/`（VP9-alpha，唯一发布格式）：

**待机 / 转向**

<p>
  <img src="dsh-pet/assets/preview/daiji-huxi-xiuxian.gif" width="160" alt="待机呼吸休闲" title="待机呼吸休闲">
  <img src="dsh-pet/assets/preview/dongzhangxiwang.gif" width="160" alt="东张西望" title="东张西望">
</p>

**移动**

<p>
  <img src="dsh-pet/assets/preview/pangxie-zoulu.gif" width="160" alt="螃蟹走路" title="螃蟹走路">
  <img src="dsh-pet/assets/preview/yuandi-piaofu-tabu.gif" width="160" alt="原地漂浮踏步" title="原地漂浮踏步">
  <img src="dsh-pet/assets/preview/yuandi-zuozhuan-benpao.gif" width="160" alt="原地左转奔跑" title="原地左转奔跑">
</p>

**小动作**

<p>
  <img src="dsh-pet/assets/preview/youxian-hengga.gif" width="160" alt="悠闲哼歌" title="悠闲哼歌">
  <img src="dsh-pet/assets/preview/chaoda-shenlanyao.gif" width="160" alt="超大伸懒腰" title="超大伸懒腰">
  <img src="dsh-pet/assets/preview/yuandi-qiaoji-zhuomian-hudong.gif" width="160" alt="原地敲击桌面互动" title="原地敲击桌面互动">
  <img src="dsh-pet/assets/preview/yuandi-zhongli-xiadun-yasuo.gif" width="160" alt="原地重力下蹲压缩" title="原地重力下蹲压缩">
  <img src="dsh-pet/assets/preview/haqian-liantian.gif" width="160" alt="哈欠连天" title="哈欠连天">
  <img src="dsh-pet/assets/preview/yuandi-xiaoqi-chenmian.gif" width="160" alt="原地小憩沉眠" title="原地小憩沉眠">
  <img src="dsh-pet/assets/preview/nvpu-quxi-liyi.gif" width="160" alt="女仆屈膝礼仪" title="女仆屈膝礼仪">
  <img src="dsh-pet/assets/preview/beixiayitiao-zhamao.gif" width="160" alt="被吓一跳" title="被吓一跳">
  <img src="dsh-pet/assets/preview/xiaofudu-yuandi-360du-xuanzhuan-zhanshi.gif" width="160" alt="小幅度原地360度旋转展示" title="小幅度原地360度旋转展示">
  <img src="dsh-pet/assets/preview/touchi-lingshi-bei-zhuazhu.gif" width="160" alt="偷吃零食被抓住" title="偷吃零食被抓住">
  <img src="dsh-pet/assets/preview/yong-jingyu-weiba-paidadi.gif" width="160" alt="用鲸鱼尾巴拍打地面" title="用鲸鱼尾巴拍打地面">
  <img src="dsh-pet/assets/preview/da-keshui-bei-jingxing.gif" width="160" alt="打瞌睡被惊醒" title="打瞌睡被惊醒">
  <img src="dsh-pet/assets/preview/zhao-jingzi.gif" width="160" alt="照镜子" title="照镜子">
  <img src="dsh-pet/assets/preview/zhengti-huanzhuang-shise.gif" width="160" alt="整体换装试色" title="整体换装试色">
  <img src="dsh-pet/assets/preview/qingkuai-jilu.gif" width="160" alt="轻快记录" title="轻快记录">
  <img src="dsh-pet/assets/preview/xie-daima.gif" width="160" alt="写代码" title="写代码">
  <img src="dsh-pet/assets/preview/yaoshan-naliang.gif" width="160" alt="摇扇纳凉" title="摇扇纳凉">
  <img src="dsh-pet/assets/preview/chenjian-shuaya.gif" width="160" alt="晨间刷牙" title="晨间刷牙">
</p>

**玩耍**

<p>
  <img src="dsh-pet/assets/preview/yuandi-zhuanxin-wan-mofang.gif" width="160" alt="原地专心玩魔方" title="原地专心玩魔方">
  <img src="dsh-pet/assets/preview/yuandi-dunxia-wan-wanju-qiche.gif" width="160" alt="原地蹲下玩玩具汽车" title="原地蹲下玩玩具汽车">
  <img src="dsh-pet/assets/preview/jingyu-tu-paopao-texiao.gif" width="160" alt="鲸鱼吐泡泡特效" title="鲸鱼吐泡泡特效">
  <img src="dsh-pet/assets/preview/yuandi-tiaoyue-zhuasui-touding-wupin.gif" width="160" alt="原地跳跃抓碎头顶物品" title="原地跳跃抓碎头顶物品">
  <img src="dsh-pet/assets/preview/wan-youxi-qijibaituai.gif" width="160" alt="玩游戏气急败坏" title="玩游戏气急败坏">
  <img src="dsh-pet/assets/preview/wan-shuiqiang.gif" width="160" alt="玩水枪" title="玩水枪">
  <img src="dsh-pet/assets/preview/xiaotiqin-yanzou.gif" width="160" alt="小提琴演奏" title="小提琴演奏">
  <img src="dsh-pet/assets/preview/lanjing-xianshi.gif" width="160" alt="蓝鲸现世" title="蓝鲸现世">
  <img src="dsh-pet/assets/preview/youya-nvpuwu.gif" width="160" alt="优雅女仆舞" title="优雅女仆舞">
  <img src="dsh-pet/assets/preview/qingkuai-yaobaiwu.gif" width="160" alt="轻快摇摆舞" title="轻快摇摆舞">
  <img src="dsh-pet/assets/preview/keai-zhaiwu.gif" width="160" alt="可爱宅舞" title="可爱宅舞">
  <img src="dsh-pet/assets/preview/chui-qiqiu.gif" width="160" alt="吹气球" title="吹气球">
  <img src="dsh-pet/assets/preview/dongwu-huanrao.gif" width="160" alt="动物环绕" title="动物环绕">
  <img src="dsh-pet/assets/preview/fang-fengzheng.gif" width="160" alt="放风筝" title="放风筝">
  <img src="dsh-pet/assets/preview/chai-liwu.gif" width="160" alt="拆礼物" title="拆礼物">
  <img src="dsh-pet/assets/preview/bian-gezi.gif" width="160" alt="变鸽子" title="变鸽子">
  <img src="dsh-pet/assets/preview/puke-moshu.gif" width="160" alt="扑克魔术" title="扑克魔术">
  <img src="dsh-pet/assets/preview/chou-tuoluo.gif" width="160" alt="抽陀螺" title="抽陀螺">
  <img src="dsh-pet/assets/preview/chui-dizi.gif" width="160" alt="吹笛子" title="吹笛子">
  <img src="dsh-pet/assets/preview/hudie-mifeng-huanrao-touding-kaihua.gif" width="160" alt="蝴蝶蜜蜂环绕头顶开花" title="蝴蝶蜜蜂环绕头顶开花">
  <img src="dsh-pet/assets/preview/lu-mao.gif" width="160" alt="撸猫" title="撸猫">
  <img src="dsh-pet/assets/preview/pingkong-shenghua.gif" width="160" alt="凭空生花" title="凭空生花">
  <img src="dsh-pet/assets/preview/qi-muma.gif" width="160" alt="骑木马" title="骑木马">
  <img src="dsh-pet/assets/preview/sanqiu-paojie.gif" width="160" alt="三球抛接" title="三球抛接">
  <img src="dsh-pet/assets/preview/ti-jianzi.gif" width="160" alt="踢毽子" title="踢毽子">
  <img src="dsh-pet/assets/preview/xiawuziqi.gif" width="160" alt="下五子棋" title="下五子棋">
  <img src="dsh-pet/assets/preview/dangqiuqian.gif" width="160" alt="荡秋千" title="荡秋千">
</p>

**吃什么**

<p>
  <img src="dsh-pet/assets/preview/chi-baifan.gif" width="160" alt="吃白饭" title="吃白饭">
  <img src="dsh-pet/assets/preview/dakou-chi-lingshi.gif" width="160" alt="大口吃零食" title="大口吃零食">
  <img src="dsh-pet/assets/preview/chi-token.gif" width="160" alt="吃Token" title="吃Token">
  <img src="dsh-pet/assets/preview/chi-zaocan.gif" width="160" alt="吃早餐" title="吃早餐">
  <img src="dsh-pet/assets/preview/chi-wucan.gif" width="160" alt="吃午餐" title="吃午餐">
  <img src="dsh-pet/assets/preview/chi-wancan.gif" width="160" alt="吃晚餐" title="吃晚餐">
  <img src="dsh-pet/assets/preview/chi-bingqilin-ronghua.gif" width="160" alt="吃冰淇淋融化" title="吃冰淇淋融化">
  <img src="dsh-pet/assets/preview/chi-dazhaxie.gif" width="160" alt="吃大闸蟹" title="吃大闸蟹">
  <img src="dsh-pet/assets/preview/chi-tanghulu.gif" width="160" alt="吃糖葫芦" title="吃糖葫芦">
  <img src="dsh-pet/assets/preview/chi-changshoumian.gif" width="160" alt="吃长寿面" title="吃长寿面">
  <img src="dsh-pet/assets/preview/chi-xigua.gif" width="160" alt="吃西瓜" title="吃西瓜">
  <img src="dsh-pet/assets/preview/shuan-huoguo.gif" width="160" alt="涮火锅" title="涮火锅">
</p>

**时节**

<p>
  <img src="dsh-pet/assets/preview/beiluoye-yanmo.gif" width="160" alt="被落叶淹没" title="被落叶淹没">
  <img src="dsh-pet/assets/preview/zhongqiu-shangyue-chi-yuebing.gif" width="160" alt="中秋赏月吃月饼" title="中秋赏月吃月饼">
  <img src="dsh-pet/assets/preview/duixueren.gif" width="160" alt="堆雪人" title="堆雪人">
  <img src="dsh-pet/assets/preview/fang-yanhua.gif" width="160" alt="放烟花" title="放烟花">
  <img src="dsh-pet/assets/preview/chi-zongzi.gif" width="160" alt="吃粽子" title="吃粽子">
  <img src="dsh-pet/assets/preview/chi-niangao.gif" width="160" alt="吃年糕" title="吃年糕">
  <img src="dsh-pet/assets/preview/chi-qingtuan.gif" width="160" alt="吃青团" title="吃青团">
  <img src="dsh-pet/assets/preview/chi-labazhou.gif" width="160" alt="吃腊八粥" title="吃腊八粥">
  <img src="dsh-pet/assets/preview/chi-chongyanggao.gif" width="160" alt="吃重阳糕" title="吃重阳糕">
  <img src="dsh-pet/assets/preview/shou-hongbao.gif" width="160" alt="收红包" title="收红包">
  <img src="dsh-pet/assets/preview/xie-fuzi.gif" width="160" alt="写福字" title="写福字">
  <img src="dsh-pet/assets/preview/chuanzhenqiqiao.gif" width="160" alt="穿针乞巧" title="穿针乞巧">
  <img src="dsh-pet/assets/preview/wu-shitou.gif" width="160" alt="舞狮头" title="舞狮头">
  <img src="dsh-pet/assets/preview/taotang-nanguadeng.gif" width="160" alt="讨糖南瓜灯" title="讨糖南瓜灯">
  <img src="dsh-pet/assets/preview/cha-zhuyu-shangju.gif" width="160" alt="插茱萸赏菊" title="插茱萸赏菊">
  <img src="dsh-pet/assets/preview/fanghedeng.gif" width="160" alt="放河灯" title="放河灯">
  <img src="dsh-pet/assets/preview/menghua-xiaoyouling.gif" width="160" alt="萌化小幽灵" title="萌化小幽灵">
  <img src="dsh-pet/assets/preview/zhuangdian-shengdanshu.gif" width="160" alt="装点圣诞树" title="装点圣诞树">
  <img src="dsh-pet/assets/preview/fang-kongmingdeng.gif" width="160" alt="放孔明灯" title="放孔明灯">
  <img src="dsh-pet/assets/preview/chitangyuan.gif" width="160" alt="吃汤圆" title="吃汤圆">
  <img src="dsh-pet/assets/preview/chijiaozi.gif" width="160" alt="吃饺子" title="吃饺子">
</p>

**文字**

<p>
  <img src="dsh-pet/assets/preview/shia-chishenme.gif" width="160" alt="是啊，吃什么" title="是啊，吃什么">
  <img src="dsh-pet/assets/preview/shendu-sikao-suisuinian.gif" width="160" alt="深度思考碎碎念" title="深度思考碎碎念">
</p>

**点击回应**

<p>
  <img src="dsh-pet/assets/preview/dianji-huiying-kaixin-yuedong.gif" width="160" alt="点击回应-开心跃动" title="点击回应-开心跃动">
  <img src="dsh-pet/assets/preview/dianji-huiying-haixiu-jingya.gif" width="160" alt="点击回应-害羞惊讶" title="点击回应-害羞惊讶">
  <img src="dsh-pet/assets/preview/dianji-huiying-aojiao-shengqi-ceshen-zhanshi.gif" width="160" alt="点击回应-傲娇生气" title="点击回应-傲娇生气">
  <img src="dsh-pet/assets/preview/dianji-huiying-naoyang-gegexiao.gif" width="160" alt="点击回应-挠痒咯咯笑" title="点击回应-挠痒咯咯笑">
  <img src="dsh-pet/assets/preview/dianji-huiying-yuanqi-huishou.gif" width="160" alt="点击回应-元气挥手" title="点击回应-元气挥手">
</p>

**拖拽**

<p>
  <img src="dsh-pet/assets/preview/beishubiao-tuozhuai-xuankong-fankui.gif" width="160" alt="被鼠标拖拽悬空反馈" title="被鼠标拖拽悬空反馈">
</p>

**余额事件**（按余额已用百分比分档，满格 → 告急 → 耗尽）

<p>
  <img src="dsh-pet/assets/preview/qian-dai-man-yi.gif" width="160" alt="余额-钱袋满溢" title="余额-钱袋满溢">
  <img src="dsh-pet/assets/preview/jin-dai-ding-dang.gif" width="160" alt="余额-金袋叮当" title="余额-金袋叮当">
  <img src="dsh-pet/assets/preview/qian-dai-ru-chang.gif" width="160" alt="余额-钱袋如常" title="余额-钱袋如常">
  <img src="dsh-pet/assets/preview/shu-jin-zhou-mei.gif" width="160" alt="余额-数金皱眉" title="余额-数金皱眉">
  <img src="dsh-pet/assets/preview/dai-kong-ru-xi.gif" width="160" alt="余额-袋空如洗" title="余额-袋空如洗">
  <img src="dsh-pet/assets/preview/fen-wen-bu-sheng.gif" width="160" alt="余额-分文不剩" title="余额-分文不剩">
</p>

**碎碎念说话动画**（碎碎念 / 对话回复触发，随机抽 1 段）

<p>
  <img src="dsh-pet/assets/preview/suisuinian-cazhuo-suisuinian.gif" width="160" alt="碎碎念-擦桌碎碎念" title="碎碎念-擦桌碎碎念">
  <img src="dsh-pet/assets/preview/suisuinian-fadai-suisuinian.gif" width="160" alt="碎碎念-发呆碎碎念" title="碎碎念-发呆碎碎念">
  <img src="dsh-pet/assets/preview/suisuinian-duiping-suisuinian.gif" width="160" alt="碎碎念-对屏碎碎念" title="碎碎念-对屏碎碎念">
</p>

**工作状态动画**（跟随 DSH 会话事件，六档：思考 / 工作 / 整理 / 等待 / 成功 / 出错）

<p>
  <img src="dsh-pet/assets/preview/gongzuozhuangtai-sikao-maopao.gif" width="160" alt="工作状态-思考冒泡" title="工作状态-思考冒泡">
  <img src="dsh-pet/assets/preview/gongzuozhuangtai-manglu-dianan.gif" width="160" alt="工作状态-忙碌点按" title="工作状态-忙碌点按">
  <img src="dsh-pet/assets/preview/gongzuozhuangtai-qingdian-guidang.gif" width="160" alt="工作状态-清点归档" title="工作状态-清点归档">
  <img src="dsh-pet/assets/preview/gongzuozhuangtai-yuandi-duobu-zhangwang.gif" width="160" alt="工作状态-原地踱步张望" title="工作状态-原地踱步张望">
  <img src="dsh-pet/assets/preview/gongzuozhuangtai-queyue-qingzhu.gif" width="160" alt="工作状态-雀跃庆祝" title="工作状态-雀跃庆祝">
  <img src="dsh-pet/assets/preview/gongzuozhuangtai-chuitou-tanqi-maohan.gif" width="160" alt="工作状态-垂头叹气冒汗" title="工作状态-垂头叹气冒汗">
</p>

**睡觉**（右键「睡觉」或鼠标停上去按 `S`；睡着时点一下叫醒）

<p>
  <img src="dsh-pet/assets/preview/shuijiao-kaishi.gif" width="160" alt="睡觉-开始" title="睡觉-开始">
  <img src="dsh-pet/assets/preview/shuijiao-xunhuan.gif" width="160" alt="睡觉-循环" title="睡觉-循环">
  <img src="dsh-pet/assets/preview/shuijiao-qilai.gif" width="160" alt="睡觉-起来" title="睡觉-起来">
</p>

> 注：动画为透明背景；GIF 预览中透明部分显示为页面底色，实际 webm 播放为透明。

## 从零生成你自己的宠物

AI 提示词 → 绿幕视频 → 透明动画 → 插件，换角色、换动作、换风格，全流程可复现。

完整步骤见 **[MAKE-YOUR-OWN-PET.md](MAKE-YOUR-OWN-PET.md)**（提示词配方、素材链、Safari 兼容、发布）。

## 数据放在哪里

所有落到这台机器上的东西都在**一个数据根**里：`<DSH_HOME>/fish-body/`（Windows 上例如 `D:\NodeJs\DSH_home\fish-body\`）。删掉它 = 除插件本体外全清；删掉其中的 `cache/` = 什么都不影响。

```
<DSH_HOME>/fish-body/
├─ config/                    设置（用户的东西，删了等于重置）
│  ├─ main-config.jsonc       主配置：JSONC 带注释，可手改；设置页「同步」写的就是它
│  ├─ session-fish.json       会话鱼设置（独立文件，整份重写不碰主配置的注释）
│  └─ voice-providers.json    语音接入（服务地址 / 音色 / 音色包目录；API Key 在 DSH 凭据库，不在这份文件里）
├─ data/                      数据（用户的东西）
│  ├─ memory.json             对话记忆（按宠物分桶）
│  └─ todos.json              待办清单
├─ runtime/                   运行时（不属于缓存）
│  └─ electron/               Electron 运行时（约 350 MB，桌面窗口用）
├─ cache/                     唯一允许随手删的目录
│  ├─ voice/                  语音合成缓存（命中即免合成）
│  ├─ download/               Electron 安装包下载缓存
│  └─ desktop/                桌面窗口的 Chromium profile
├─ skin/                      文件宠物：一种一套
│  ├─ pig-config.json         <名>-config.json 定义一种「种类」
│  ├─ pig-animation/{webm,mov} 同一前缀的动画目录
│  ├─ pig-sound/              同一前缀的音效目录（可选）
│  └─ pig-memes/              同一前缀的表情包目录（可选）
└─ assets/                    素材（所有宠物共用）
   ├─ animation/{webm,mov}/   main 的动画（文件名即动作名）
   ├─ sound/                  用户级音效：无前缀的 click.wav 对所有宠物生效
   ├─ memes/                  用户级表情包图片
   ├─ skin/                   共享皮肤池（layered / live2d / webm / sound）
   └─ session-fish/           会话鱼皮肤（图片 / 动图 / 视频）
```

`cache/` 是缓存（语音合成结果、Electron 安装包、桌面窗口 profile），`runtime/` 放 Electron 运行时，`config/` + `data/` 是你的设置与数据。设置页「系统 → 文件与目录」显示的就是这棵树，每行一个「打开文件夹」。

## 项目结构

只列代码与发布相关目录；素材链的 video / scripts / step / pr 见 [MAKE-YOUR-OWN-PET.md](MAKE-YOUR-OWN-PET.md) 的 ② 章节（gitignore 的本地目录不列）：

```
├── README.md  INSTALL.md  FEATURES.md  MAKE-YOUR-OWN-PET.md  CONFIG.md  API.md  CORDIS.md  openapi.yaml   # 说明 / 安装 / 功能详解 / 宠物制作指南 / 配置 / HTTP 接口 / Cordis 服务 / OpenAPI 规范
├── prompts/           # ① 动画生成提示词配方（绿幕规范 + 按秒分解）
├── assets/            # 仓库展示用截图
├── tools/             # 开发工具：API 调试页、cordis-probe mock 服务商、DPI 探针
├── .github/workflows/ # CI：Safari/HEVC 转码流水线（macOS runner，手动触发 → 发布 assets-mov Release）
├── dsh-pet/           # ③ 插件（可独立 npm 发布）
│   ├── src/
│   │   ├── host/       # 宿主半侧：配置 / 路由 / 余额 / 工作状态
│   │   ├── client/     # 浏览器半侧：宠物渲染 / 动画链 / 设置页
│   │   ├── shared/     # 双端共用纯逻辑（物理 / 菜单 / 取数）
│   │   └── standalone/ # 独立模式 CLI（不依赖 DSH 直接跑桌宠）
│   ├── lib/            # 构建产物（npm run build 生成，不入库）
│   ├── runtime/        # 桌面模式运行壳（Electron 透明窗）
│   ├── assets/         # webm 动画 / preview GIF / 字体 / 图标 / config.jsonc 默认配置
│   └── scripts/        # 构建、发布与开发脚本
└── LICENSE             # MIT
```

## 相关项目

- **[aipets](https://github.com/kallen-noelle/aipets)** —— Windows 11 桌面宠物，五个角色可多开，透明置顶、点击穿透、甩动带惯性。特色在**动作由大模型决定**：每轮对话后模型结合时间、天气、电量与好感度挑动作，无人说话时还能排出接近一整天的编排，模型不可用时回退内置规则。聊天接任意 OpenAI 兼容接口，带长期记忆、贴纸、画图与工具调用（联网搜索 / Home Assistant / MCP），支持语音朗读与语音输入；同一套代码既有单文件 `aipets.exe` 桌面版，也有浏览器里的整页舞台版。

## 💬 反馈与发版节奏

欢迎提 [issue](https://github.com/PC2005-cloud/dsh-pet/issues) 与 PR——bug、体验问题随时反馈。**新功能请先开 issue** 说明使用场景，确认后再动手，不要在确认前直接提交实现 PR。这个插件专注桌宠与 DSH 本身，偏离太远的需求一般不会做。动手前也请先翻一眼 [提交记录](https://github.com/PC2005-cloud/dsh-pet/commits/main)，确认不是已经修掉的同款问题（有些问题可能已经在 `main` 上修好了，只是还没发版）。

- **小修不单独发版**：不影响使用的小 bug 与优化会**累计**到下一个版本一起发，避免版本更迭过于频繁。所以「`main` 上已经修了」不等于「你装的这版已经包含」——`latest` 没更新时，以 `main` 的提交记录为准。
- **想立刻用上未发布的修复**：按 [INSTALL.md](INSTALL.md) 的「从源码安装」把插件指向本地仓库即可；注意**宿主半侧**的代码改动要**重开 DSH** 才生效（浏览器半侧刷新页面即可）。
- **报 bug 时请带上**：插件版本、`dsh` 版本、操作系统、复现步骤（有日志或截图更好）。

## 许可

- 代码：MIT
- **素材（动画 / 提示词 / 源视频 / 分层皮肤 / live2d 模型 / 音效 / 表情包 / 图集）：不随 MIT，禁止商用**；允许开源使用，具体授权参考角色原型的形象授权（见下方「形象授权」）。第三方组件、字体与 Live2D Cubism Core 的许可逐项写在 [NOTICE](NOTICE) 里
- **二次创作（二创）约定**：基于本项目的衍生 / 改版 / 换皮作品，在 **GitHub 仓库、产品官网等公开渠道**上须附上原作者 GitHub 地址：<https://github.com/PC2005-cloud/dsh-pet>
- **形象出处**：宠物形象为社区二创的 DeepSeek「大肥鱼」（鲸鱼娘），**非 DeepSeek 官方形象**；原型「溟月」出自 B 站 [@上善无形](https://space.bilibili.com/4456176)，DeepSeek 版（女仆鲸鱼娘）设计出自 B 站 [@ZipZipPipe](https://space.bilibili.com/4168597)
- **形象授权**：[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)（署名 · 非商业 · 相同方式共享），[声明原文](https://www.bilibili.com/opus/1247156596114456581)：「大肥鱼是遵守CC BY-NC-SA 4.0协议的形象，不可以以任何形式商业化。若您非常喜爱该形象，希望其拥有实体，您可以自行定制。」
