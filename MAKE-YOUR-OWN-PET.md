# 从零生成你自己的宠物（完整流程）

> 返回 [README](README.md) ｜ 全流程：AI 提示词 → 绿幕视频 → 透明动画 → 插件 → 发布。换角色、换动作、换风格，均可复现。

## ① 提示词 → 源视频

用 AI 视频生成工具（如可灵、Runway、豆包等，本项目素材即由豆包生成），按 `prompts/桌面宠物 10 秒动作提示词.md` 的配方，一个动作生成一段 10 秒绿幕视频：

- 视频比例 16:9，背景纯绿幕（#00FF00）
- 人物位置/大小固定（头顶 ~20% 高度、脚底 ~85% 高度）
- 动作全程在画幅内，首尾帧为标准正面站立
- 每段动画按秒分解（0-10s 各阶段动作）

生成结果按动作各存一个 mp4，放入 `video/`。

> **源视频获取**：为控制仓库体积，`video/` 源视频不入 git。Releases 提供**打包压缩包**，浏览器直接下载即可：
>
> - `assets-videos.zip` —— 全部源视频压缩包（中文名 mp4，解压后放入 `video/`）
>
> 解压：`Expand-Archive assets-videos.zip`（Windows）或 `unzip assets-videos.zip`，把 mp4 放回 `video/` 即可运行素材链。

## ①.5 🌙 多段接力的动作（睡觉）

睡觉不是一个动作，而是**三段接力**：入睡 → 循环（无限）→ 醒来，由右键「睡觉」与点击唤醒驱动。提示词单独放在 [`prompts/睡觉动作提示词.md`](prompts/睡觉动作提示词.md)，与 10 秒动作提示词的区别必须照做：

- 入睡与循环段**结尾不许回到站立**，只有醒来段才回站立；循环段首尾两帧必须完全相同，否则循环处会跳。
- 三段共用同一条地面线、同一角色大小；生成后先比对「入睡尾帧 = 循环首帧 = 醒来首帧」「醒来尾帧 = 入睡首帧」再进素材链。
- 素材链其余步骤不变（同样落 `dsh-pet/assets/webm/`），最后把三个名字写进配置的 `animations.sleep`：一套 = `start` / `loop` / `end` 各一个候选数组，可以配多套（蹲着睡、趴着睡…）；结构见 `dsh-pet/assets/config.jsonc` 里的 `sleep` 注释。

## ② 源视频 → 透明动画（素材链）

step02（透明视频）有**两条路线，按需二选一**（默认自动、人人可复现；效果不佳可用 PR 手工抠像覆盖）：

```sh
cd scripts
# 路线 A（默认）：自动绿幕抠像（HSV 色相，无需人工）
python watermark_step01.py   # 水印遮罩填充 → step01/
python chroma_step02.py      # 绿幕抠像转透明 → step02/

# 路线 B（可选）：PR 手工抠像覆盖（针对含第三方物品/自动抠像效果不佳的动作）
#   1. 在 PR 里手工抠像，导出带 alpha 的透明 .mov（如 ProRes 4444 with Alpha）
#   2. 放入 pr/，文件名与动作名一致（如 吃白饭.mov）
python pr_import_step02.py   # pr/*.mov → step02/（透明 webm，覆盖该动作自动抠像结果）

# 后续步骤两条路线共用：
python normalize_step03.py   # 归一化 2160×1215 统一站立居中 → step03/
python encode_thumbs.py      # 转码 640×360 播放变体 → step04/
```

**依赖**：Python 3 + ffmpeg + numpy + scipy（素材链脚本自动用工作区 `.tools/` 下的 ffmpeg）。

> **本项目全部采用路线 B**（全部动作均为 PR 手工抠像）：对"含第三方物品/透明边缘复杂"的动作，自动 HSV 抠像易残边或误抠，PR 手动遮罩更精细。两条路线产出同一级 `step02/`，后续步骤完全一致；`chroma_step02.py` 保留为自动化兜底，任何动作仍可一键自动生成。

## ②.5 🍎 Safari/HEVC 兼容素材（macOS 专用 mov）

插件默认只发布 `.webm`（VP9-alpha），Safari/WKWebView 不认 webm alpha（黑底），macOS 需要在 GitHub Release 下载官方转码的 **HEVC-with-Alpha `.mov`** 素材使用，两步：

1. **下载**：<https://github.com/PC2005-cloud/dsh-pet/releases/tag/assets-mov>（固定 tag，保持最新；zip 解压后文件名与 webm 一一对应）
2. **放入**：`.mov` 文件放进 `$DSH_HOME/fish-body/assets/animation/mov/`（pet pack 宠物则是 `skin/<种类名>-animation/mov/`）

## ③ 动画 → 插件

```sh
# 把 step04 的播放变体同步进插件包（webm 直接 cp）
cp step04/*.webm dsh-pet/assets/webm/   # 播放格式（VP9-alpha）

# 本地安装插件（--profile 填实际在用的那个：dsh web → web，桌面应用 → desktop；
# 详见 INSTALL.md 的「从源码安装」；
# file: 指向插件目录 dsh-pet/dsh-pet）
dsh plugin --profile web add file:D:/path/to/dsh-pet/dsh-pet
```

> 中间产物（step01-04）由脚本生成、不入仓库；`video/` 源视频和脚本是成果、入库维护。

## 🎯 发布（单一 webm 格式）

插件只发布一个 npm 包、一个素材格式（webm）；`files` 收敛为固定清单（lib / src / assets/webm / runtime/electron-helper / assets/fonts / assets/pic / assets/config.jsonc / scripts/ensure-electron.mjs / cordis.patch.yml，见 `prepare.js`；浏览器与桌面模式共用，包体最小）：

```sh
cd dsh-pet
npm publish --tag latest   # prepack 自动执行构建（完整产物 + 收敛 files），无需手动构建
```

- client 端按运行时判断播放扩展名：macOS WebKit（Safari/WKWebView）自动用 `.mov`，其余用 `.webm`
- 需要 Safari/HEVC 版（macOS）：mov 素材官方发布在 GitHub Release `assets-mov`，下载解压进 `assets/animation/mov/` 即可

## 素材放哪儿：pack 与共享资源池

两条路都能用：

```
<数据根>/                               # 例如 D:\NodeJs\DSH_home\fish-body\
├─ config/                             # 设置：main-config.jsonc / session-fish.json / voice-providers.json
├─ data/                               # 数据：memory.json / todos.json
├─ runtime/electron/                   # Electron 运行时（不属于缓存）
├─ cache/                              # 唯一允许随手删的目录（voice / download / desktop）
├─ skin/                               # 你的皮肤目录：按渲染方式分类（前四行，启动时建）
│  ├─ layered/<皮肤>/manifest.json + art/…   #   分层 PNG 皮肤，一个子目录一套
│  ├─ live2d/<模型>/xx.model3.json
│  ├─ webm/<动作>.webm                 #   平铺：一部动画一个文件
│  ├─ sound/<皮肤>-click.wav           #   皮肤共享音效
│  ├─ pig-config.json                  # 文件宠物：<名>-config.json 定义一种「种类」
│  ├─ pig-skin/character1/…            #   皮肤 / 模型（layered / live2d）
│  ├─ pig-animation/{webm,mov}/…       #   动画
│  └─ pig-sound/…                      #   音效
└─ assets/                             # 素材（所有宠物共用）
   ├─ animation/{webm,mov}/            #   main 的动画（文件名即动作名）
   ├─ sound/                           #   用户级音效：无前缀的 click.wav 对所有宠物生效
   ├─ memes/                           #   用户级表情包
   ├─ session-fish/                    #   会话鱼皮肤
   └─ pet/                             #   内置皮肤池：**扁平**，一套皮肤一个子目录
      ├─ character1/{manifest.json, art/…, character1-click.wav}
      ├─ model1/xx.model3.json + xx-click.wav
      └─ movie1.webm
```

`cache/` 是缓存（语音合成结果、Electron 安装包、桌面窗口 profile），`runtime/` 放 Electron 运行时，`config/` + `data/` 是你的设置与数据（旧根 `<DSH_HOME>/dsh-pet/` 在启动时自动搬进这里，见 `docs/目录布局.md`）。

- 池根由用户配置的 `assets.pool` 决定（默认 `assets/pet`，可写绝对路径），见 `CONFIG.md` 的「资源池」。
- **分工约定：`skin/<素材根>-*` = 随 pack 走的内置素材，`assets/pet/` = 用户自己的素材。**
  换言之「这只宠物自带的那一套」放 `skin/`（安装、升级、迁移都跟着它走），
  「我自己补的皮肤 / 模型 / 动画 / 音效」放 `assets/pet/`（一份所有宠物共用，升级不覆盖、删了不影响别的）。
  宿主对 `pets[].model` 的解析是**先 pack 后池**，所以内置的那套永远优先，用户池只做补充与替换的落点。
- 目录骨架不用手建：插件启动时会把 `<数据根>`、`assets/animation/webm|mov`、`assets/{sound,memes}` 与
  皮肤目录下的 `layered / live2d / webm / sound` 建好，设置页「系统 → 文件与目录」点开就是它们。
  池根 `assets/pet/` **只建它自己**：它是扁平存放的，不会替你建 `layered / live2d / webm / sound` 子目录
  （那样等于把「按渲染方式分类」硬塞给内置素材）。
- `pets[].model` 写 `character1` / `model1/xx.model3.json` 这样就行：宿主**先 pack 后池**——
  `skin/<素材根>-skin/<model>/` 存在就用它，缺失才回落到池里的同名资源（扁平池就是 `assets/pet/<model>/`）。
- 动画同理：先 `skin/<素材根>-animation/webm/`，再池里平铺的 `assets/pet/*.webm`，最后 `assets/animation/webm/` 与包内素材。
- 右键「模型 / 皮肤」子菜单里，池里的条目会标「（池）」，一眼看出它来自哪。
- 想把旧布局搬进池：仓库里跑 `node dsh-pet/scripts/migrate-pool.mjs`（干跑，只打印清单），
  确认后加 `--apply` 复制；**只搬不删**，旧布局照常可用。

## 音效

音效不用写清单：把音频放到下面任意一处，宿主按**文件名**自动匹配事件与动画，匹配不到的事件槽用包内内置默认。

```
# 共享资源池（推荐；一份素材所有宠物共用，池根 = assets.pool，默认 <数据根>/assets/pet）
assets/pet/<皮肤>/<皮肤>-click.wav             # 扁平池：资源目录是皮肤子目录，目录名前缀
assets/pet/<皮肤>/xxx-drag.wav                 #           结构文件叫 xxx.json 时用它的基名
assets/pet/model1/xx-click.wav                 #           live2d：模型基名前缀（也认 model1-click.wav）
assets/pet/sound/click.wav                     # 全局：无前缀优先
assets/pet/sound/common-drag.wav               # 全局：任意前缀次之（同事件多份按文件名排序取第一个）

# 按渲染方式分类的池布局（老布局照旧能用，只是不再自动创建目录）
assets/pet/layered/<皮肤>/<皮肤>-click.wav
assets/pet/layered/sound/layered-click.wav     # 该渲染方式的兜底
assets/pet/webm/webm-click.wav                 # webm 的兜底（也认 assets/pet/webm/sound/webm-click.wav）

# 文件宠物包（skin/<素材根>-*）自带的音效
skin/<素材根>-skin/<皮肤>/click.wav      # 皮肤自带（目录即身份，不需要前缀）
skin/<素材根>-skin/<皮肤>/写代码.wav      #           动作音：基名 = 动画 / 动作 / gesture 名
skin/<素材根>-sound/click.wav            # 该素材根所有皮肤共用
skin/<素材根>-sound/<皮肤>-click.wav      # 同一目录管多套皮肤时的兼容写法
skin/<素材根>-animation/写代码.webm
skin/<素材根>-animation/写代码.wav        # 便捷写法：动作音与动画同目录
assets/sound/click.wav                   # 用户共享（仅 main 链）
```

| 文件名                                         | 何时响                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| `click` / `throw`                              | 点击、甩出（**拖拽成立不出声**：它和随后的点击/甩出只差几十毫秒，两条音叠在一起像破音） |
| `floor` / `wall` / `ceiling` / `pet`           | 落地、撞墙、撞顶、宠物互撞（响度随撞击速度）                                            |
| `bump`                                         | 上面四个碰撞槽的兜底（没有具体文件时才用）                                              |
| `sleep-start` / `sleep-end`（或 `sleepStart`） | 入睡、醒来                                                                              |
| `hook-<名字>`                                  | 自定义 hook，`POST /dsh-pet-7340/sfx/<名字>?pet=<id>` 触发                              |
| `<动画名>`                                     | 该动画 / 动作 / layered 命中区手势播放时（可在配置里加 `at` 偏移与 `everyMs` 重复）     |

内置 hook 点（两端自己在固定时机触发，不需要外部调用；同样没有默认音，放了文件才响）：

| 文件名           | 何时响                                                                    |
| ---------------- | ------------------------------------------------------------------------- |
| `hook-drag`      | 拖拽成立那一下（拖拽本身没有事件音效：它和随后的点击/甩出叠在一起像破音） |
| `hook-whisper`   | 碎碎念出现（气泡弹出时，与动画是否联动无关）                              |
| `hook-chat-open` | 对话窗每次新打开                                                          |

要更多触发点就自己用 `POST /dsh-pet-7340/sfx/<名字>?pet=<id>` 打点：名字先写进 `sfx.hooks` 或用上面的 `hook-` 文件名约定。

优先级（高 → 低）：池资源目录 → 池渲染方式兜底 → 池全局音效 → pack 皮肤目录 → `-sound/` 带皮肤前缀 →
`-sound/` 不带前缀 → 动画同目录 → 用户共享（`assets/sound/`）→ 包内 `assets/sound/` → 内置默认。
也就是说：**新放的东西先响**（池永远排在 pack 自带素材之前），但「用哪套皮肤」仍是先 pack 后池。
格式优先 `.wav`（44.1kHz / 16bit / 单声道、攻击段压在 t=0），也认 `.ogg .mp3 .m4a`；单个文件建议 < 1MB。
要压音量、关掉某个槽或给动画绑时间线，写在 `config.jsonc` 的 `sfx` 段（见 `CONFIG.md`）。
设置页的「音效」分区逐个列出生效文件与命名规则，可以开关与试听；hook 在那里填个名字就能登记（等价于往 `sfx.hooks` 加一条空 cue），不用手改配置。
