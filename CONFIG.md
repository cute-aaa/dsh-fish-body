# 配置（大小 / 位置 / 多开）

> 返回 [README](README.md)

桌宠的大小、位置、多开均可配置，两条途径：

> 💡 **两条途径只是编辑入口不同，最终都是同一份用户配置**——配置能力远不止设置页那几个选项：设置页可改大小/位置/边距/显示位置/余额开关/多开，但**手动编写配置文件可以任意自由配置**（动画池、播放权重、事件动画、刷新周期……），只要**格式与包内默认配置 `config.jsonc` 一致**即可，用户配置会**整体覆盖**对应字段的默认值。

## 方式一：设置页（推荐）

DSH 设置 → 「桌宠配置」：

- **大小**：宽度 px（高度自动 = 宽度 × 9/16）；另有**屏幕宽度上限**（%，默认 100，不设上限）：按人物本体占屏宽收口、px 作画框上限——100 ≈ 不限制（桌面观感与纯 px 一致），填 30–50 可让手机竖屏明显变小，填 150 人物会比屏还宽（画框仍受 px 夹住）。只在页面加载时算一次，改完窗口大小要刷新才生效。三个入口：设置页滑块 + 数字框（精确到 1px）、桌宠右键「大小」滑块（松手才生效，随后窗口重建一次）、系统托盘「大小」（原生菜单放不了滑块，给 ±40px 步进 + 小/中/大/特大四档）
- **位置**：四角（corner）＋ 水平/垂直边距（marginX / marginY）
- **显示位置**（display）：web=仅浏览器 / desktop=仅桌面 / both=两者都显示 / none=都不显示
- **余额功能**：勾选后该宠物才会触发余额动画并显示余额气泡（服务商未登记余额接口时改为弹文字说明气泡）
- **多开**：添加/删除宠物，每只宠物独立 id、大小、位置
- **种类（pet pack）**：`pet/` 目录里的角色包也会列在宠物列表里（按种类分组），同样能改名称/大小/位置/显示方式/四个开关/实例人设；每组的「+」在该种类下新建实例。保存时 main 写 `main-config.jsonc`，文件宠物写回各自角色包配置（顶层动画池与人设原样保留）；每种至少留一只，删最后一只会被拒绝
- **物理参数**：拖拽抛掷手感（重力 / 弹性 / 地面摩擦 / 总力度 / 顶部反弹 / 宠物互撞 / 碰撞震动 / 倾斜控制重力 / 摇一摇抛出）也能在设置页图形化改，不用去手改配置文件。碰撞震动（`physics.hapticEnabled`，默认开）在撞墙、落地、撞顶与宠物互撞时各震一下：Chrome / Edge 等浏览器可用，iOS 与 Via 这类 WebView 套壳浏览器不生效，系统勿扰模式会挡住振动。宠物互撞（`physics.petCollision`，默认开）按动量守恒弹开（质量 ∝ 尺寸²）。体感拆成两个开关：倾斜控制重力（`physics.tiltGravity`，默认关）用手机倾斜方向代替固定向下的重力（`gravity` 为 0 时无从取值，等同关闭）；摇一摇抛出（`physics.shakeThrow`，默认关）沿甩动方向把宠物甩出去（力度 = 基准 × `throwPower`），与重力大小无关，`gravity` 设 0 也能甩着玩。两个都只在 HTTPS 或 localhost 下有效
- **AI 模型**：碎碎念与对话可以**各自指定模型**——设置页「AI 模型」每项一个下拉框（与 DSH 对话框右下角的模型选择器同款：搜索框 + 按服务商分组的清单，选项同源）；选「跟随当前对话」= 用当前对话的模型，指定了但调用失败会自动回落到当前对话的模型重试一次
- 点「保存」**即时生效**（无需刷新）；「同步」把包内 `config.jsonc` 的**原文**（含注释与全部高级字段）整份写入用户配置——既回到默认，又留下一份可直接编辑的完整配置
- **语音**：碎碎念与对话回复可以念出来（默认关闭），音色四选一、默认晓伊（女声 · 活泼）；音色列表来自宿主 `/voice/voices`，不在页面里硬编码

## 方式二：config.jsonc（单一来源）

插件包内 `dsh-pet/assets/config.jsonc` 的 `pets` 数组定义**默认宠物**：

```jsonc
"pets": [
  { "id": "main", "size": 462, "balanceEnabled": true, "display": "both", "position": { "corner": "top-right", "marginX": 24, "marginY": 100 } }
]
```

- 每只宠物：`id`（标识）／`size`（宽度 px）／`sizePercent`（可选，屏幕宽度百分比 1–100；写了就按窗口宽收口、`size` 作上限）／`sizes`（可选，按渲染方式覆盖宽度：`{ "webm": 500, "layered": 620, "live2d": 620 }`，缺键回落 `size`；三种素材的人物占框比例不同，右键「大小」写的就是它）／`clickThrough`（可选，`true` = 桌面端这只宠物的窗口整窗忽略鼠标、点击落到下层应用；仅桌面端生效，开启后窗内右键菜单点不到，出口是设置页的同一勾选框）／`renderer`（可选，`webm`/`layered`/`live2d`）／`model`（可选，live2d 的 `.model3.json` 路径或 layered 的皮肤 id）／`balanceEnabled`（是否启用余额功能，必填布尔）／`display`（web/desktop/both/none，必填，见上）／`position`（corner 四角之一 + marginX/marginY 边距）
- 余额刷新周期：`eventsRefreshSec.balance`（秒）——余额数据刷新与余额动画触发的间隔，启动时立即触发一次，之后按此周期循环（默认 1800）
- 设置页的修改保存到用户层 `$DSH_HOME/dsh-pet/main-config.jsonc`（**完整宠物列表**，覆盖包内默认）；「同步」把包内 `config.jsonc` 原文整份写入该文件（等价于回落默认，但文件保留下来、可直接编辑）

## 方式三：手动编辑配置文件（高级，任意自由配置）

用户层配置文件位于 `$DSH_HOME/dsh-pet/main-config.jsonc`。**它和包内默认配置是同一套格式**——想改什么直接照着 `assets/config.jsonc` 的结构写即可，写错的字段/缺失的字段回落默认，无需（也无法）写完整份。设置页「同步」可直接生成这份完整文件（原文复制包内 `config.jsonc`，注释齐全）：

| 字段                   | 作用                                                                                                                       | 格式与默认一致即可         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `pets`                 | 宠物列表（大小/位置/多开/余额开关）                                                                                        | 数组，每项同 `pets[]` 结构 |
| `animations`           | **动画池**：idle / turn / drag / clicks / moves / categories / events（余额等事件动画）/ sleep（睡觉套，可选）             | 同 `animations` 结构       |
| `animationWeights`     | 动画链播放权重（idle / turn / move）                                                                                       | 同 `animationWeights` 结构 |
| `eventsRefreshSec`     | 事件刷新周期（秒）：`whisper` 碎碎念、`sleepTalk` 梦话、`balance` 余额                                                     | 同 `eventsRefreshSec` 结构 |
| `sleepStartTexts`      | **入睡台词**（条目级，随机挑一句；播「开始」时弹气泡）                                                                     | 非空字符串数组             |
| `sleepEndTexts`        | **醒来台词**（条目级，随机挑一句；播「起来」时弹气泡）                                                                     | 非空字符串数组             |
| `sleepRefuseTexts`     | **睡着被打扰时的拒绝台词**（条目级，随机挑一句）                                                                           | 非空字符串数组             |
| `notificationsEnabled` | 系统通知总开关（布尔）                                                                                                     | 同 `notificationsEnabled`  |
| `chatAnimationEnabled` | **对话动作联动**：开启后对话时把 `animations.categories` 下的动作清单交给模型，由它按语境挑一个当场表演（布尔，默认 true） | 布尔，默认即可             |

> 覆盖语义：用户层给出即**整体替换**该字段（如写了 `animations` 就用你的整份动画池，替代默认），没写的字段回落包内默认。校验在插件加载时执行——格式错误会在 DSH 控制台显式报错，不会静默运行残缺配置。

## 方式三之二：会话鱼设置（`session-fish.json`）

会话鱼不写进 `main-config.jsonc`：它是一组独立的小偏好，单独存在 `$DSH_HOME/dsh-pet/session-fish.json`（普通 JSON，不带注释；写坏了逐字段回落默认）。设置页「会话鱼」分区改的就是它，保存后浮层立即生效。

```jsonc
{
  "enabled": true, // 总开关；关掉会清空现有鱼并隐藏浮层
  "sizePx": 96, // 皮肤的显示宽度（px），48–160；高度按素材比例算（夹在 0.5–2 倍宽之间）
  "maxCount": 6, // 同时最多几条，1–12；超出先淘汰最早完成的
  "bubbleMs": 12000, // 气泡停留时长（ms），4000–60000
  "skin": "", // 皮肤 id（素材名）；空串 = 默认的 写代码.webm
  "followPet": true, // 围着桌宠转；关掉后回到右下角竖排
  "speakEnabled": true, // 语音播报总开关；关掉后三类都不出声（气泡照常）
  "speakProgress": true, // 念出思考 / 干活 / 整理
  "speakTurnEnd": true, // 念出每一轮的结束
  "speakWaiting": true, // 念出等待确认（审批 / 计划审查）
  "progressGapMs": 15000, // 同一会话两条进度播报的最小间隔（ms），5000–600000
}
```

小鱼默认**围着桌宠转**：桌宠走位、被拖走、被甩飞时鱼群跟着移动，鱼与鱼、鱼与桌宠之间有碰撞分离；拖住一条鱼可以挪位置，松手会甩一下再回到自己的位置，位置以「相对槽位的偏移」按会话记在浏览器 `localStorage`（`dsh-pet:session-fish-offsets`），刷新后仍在你放它的方向。设置页「会话鱼」分区的「重置鱼的位置」会把它们放回桌宠旁边；`followPet=false` 时回到右下角竖排（同一套拖拽与位置记忆）。

**换皮肤**：把图片 / 动图（`.png` / `.jpg` / `.jpeg` / `.gif` / `.webp`）或视频（`.webm` / `.mp4`）放进用户数据根下的 `session-fish-skin/` 目录（设置页「打开皮肤文件夹」会建好并打开），回到设置页点「重新扫描」即可在下拉里选中；包内 `assets/webm/` 的一百多段小动作也都在列表里。素材按原比例显示，太扁或太长的会被夹在 0.5–2 倍宽之间；文件删掉后那一条自动回落到内嵌的小鱼画法。

未知键、类型错、越界、非法皮肤名在保存时会被宿主拒绝（`PUT /session-fish` 回 `bad-request`）；手工改文件后需要重载插件才生效。字段与状态机见 [`API.md`](API.md) 与 [`openapi.yaml`](openapi.yaml)。

## 方式四：额外宠物（pet pack）——添加新「种类」

方式一~三都只调整**默认宠物的实例**（数量/大小/位置），动画池始终是全局一份。要添加**全新种类的宠物**（独立动画池 + 自己的素材），在用户数据根下建 `pet/` 目录：

```
$DSH_HOME/dsh-pet/
├─ main-config.jsonc           ← 主宠物配置（现有，不动）
├─ main-animation/webm/*.webm  ← 主宠物素材（现有，只属于 main）
└── pet/
   ├── pig-config.json          ← 额外宠物 pig 的配置（命名词干 = 种类名，实例 id 任意）
   └── pig-animation/*.webm     ← pig 自己的动画素材（直接平铺，仿 main-animation）
```

每只额外宠物 = 一个 `-config.json` + 一个 `-animation/` 目录，同前缀配对；扫描 `pet/` 自动发现，浏览器与桌面同时生效。一个 `-config.json` 定义**一个「种类」**（动画池 + 素材目录），`pets` 数组可放该种类的**任意多只实例**（共享动画池与素材）：

```jsonc
// pet/pig-config.json —— 与 main-config.jsonc 同构的完整配置
{
  "notificationsEnabled": true,
  "pets": [
    {
      "id": "pig1", // 实例 id（可多只；不必等于文件名前缀）
      "size": 420,
      "balanceEnabled": true,
      "display": "both", // web / desktop / both / none
      "position": { "corner": "top-right", "marginX": 24, "marginY": 100 },
    },
    {
      "id": "pig2",
      "size": 360,
      "balanceEnabled": false,
      "display": "web",
      "position": { "corner": "top-left", "marginX": 24, "marginY": 100 },
    },
  ],
  "animations": {
    "idle": ["待机"],
    "turn": [],
    "drag": [],
    "clicks": ["打滚"],
    "moves": {
      "default": {
        "minDist": 80,
        "maxDist": 360,
        "margin": 20,
        "leadSec": 2,
        "tailSec": 2,
      },
      "actions": [],
    },
    "categories": [],
    "events": {
      "balance": [
        "余额-钱袋满溢",
        "余额-金袋叮当",
        "余额-钱袋如常",
        "余额-数金皱眉",
        "余额-袋空如洗",
        "余额-分文不剩",
      ],
    },
  },
  "animationWeights": { "idle": 80, "turn": 0, "move": 0 },
  "eventsRefreshSec": { "balance": 1800 },
}
```

规则（与主宠物**严格隔离**，绝不混用）：

- **素材只查自己的**：素材目录名 = 文件名前缀（`pet/pig-config.json` → `pet/pig-animation/`），该种类所有实例共用；动画 URL `/thumb/<前缀>/<名>.webm`，查不到即 404——绝不落到 `main-animation` 或包内素材
- **动画池不回落全局**：`animations` / `animationWeights` 必须写全（缺失即配置错误）
- **`animations.sleep` 是可选段**（睡觉动作）：不写 = 该种类没有睡觉功能，右键菜单不出现「睡觉」，其余动画不受影响。写了就是「套」的数组，每套 `{ start, loop, end }` 三段各是候选数组；入睡时整套随机挑一套，三段都从这套里取，进段时再在段内随机挑一个（避开刚播完的那个）。结构见包内 `assets/config.jsonc` 的 `sleep` 注释
- **睡觉文案按种类各写一份**：`sleepStartTexts` / `sleepEndTexts` / `sleepRefuseTexts`，不写就跟随内置那份；`eventsRefreshSec.sleepTalk` 是梦话周期（秒，默认 60）
- 与主配置同构的约束：`pets` 每只字段完整合法、数组内 id 唯一、`animations` / `animationWeights` 结构校验同一套规则；`notificationsEnabled` / `eventsRefreshSec` 是全局属性，不归宠物文件管（写了忽略、不写不报错）
- 配置非法 / 缺少 `-animation/` 目录 / 实例 id 与主宠物冲突 → 加载时显式报错并跳过（不影响其他宠物）
- 设置页**会列出**文件宠物（按种类分组）：改名称/大小/位置/显示方式/四个开关/实例人设后保存，写回该种类自己的配置文件——不混进 `main-config.jsonc`，文件顶层的动画池与人设原样保留；「+」可在该种类下新建实例，每种至少留一只
- 余额档位动画按各宠物自己的 `events.balance`

## 资源池（assets）——共享皮肤 / 模型 / 动画 / 音效

旧布局（`pet/<材料根>-skin|sound|animation`）**原样保留、零迁移**；在此之外多了一个可选的共享池：
放一份素材，所有宠物都能用。池根由 `assets.pool` 决定（只读 `main` 条目）：

```jsonc
"assets": { "pool": "skin" }   // 相对用户根（默认），也可以写绝对路径，例如 "D:/pets/shared"
```

目录约定（`<用户根>` 例如 `D:\NodeJs\DSH_home\dsh-pet\`）：

```
<用户根>/
├─ pet/                          # 【旧】按 pack 分，保持原样
│  ├─ main-skin/character1/…     #   旧皮肤（layered / live2d）
│  ├─ main-animation/webm/…      #   旧动画
│  └─ main-sound/…               #   旧音效
├─ main-sound/                   # 【旧】用户级全局音效
└─ skin/                         # 【新】共享资源池（assets.pool 的默认值）
   ├─ layered/
   │  ├─ character1/
   │  │  ├─ manifest.json        # 结构文件（任意名；manifest.json 优先，其次含 rig/schema 的 json）
   │  │  ├─ art/…
   │  │  ├─ character1-click.wav # 目录名前缀
   │  │  └─ xxx-drag.wav         # 结构文件基名前缀（结构文件叫 xxx.json 时）
   │  └─ sound/layered-click.wav # 该渲染方式的兜底音效
   ├─ live2d/
   │  ├─ model1/xx.model3.json
   │  │  └─ xx-click.wav         # 模型基名前缀（也认 model1-click.wav）
   │  └─ sound/live2d-click.wav
   ├─ webm/                       # 平铺：一部动画一个文件，不建子目录
   │  ├─ movie1.webm
   │  └─ webm-click.wav           # 该渲染方式的兜底音效（也认 webm/sound/webm-click.wav）
   └─ sound/
      ├─ click.wav                # 全局音效：无前缀优先
      └─ common-drag.wav          # 任意前缀次之（同事件多份按文件名排序取第一个）
```

- **`pets[].model` 语义不变**，宿主按「先 pack 后池」解析：`pet/<素材根>-skin/<model>/` 存在就用它，
  缺失才回落到 `skin/layered/<model>/`（live2d 同理回落到 `skin/live2d/<model 所在目录>`）。
  动画同理：先 `pet/<素材根>-animation/webm/`，再 `skin/webm/`，最后用户目录与包内素材。
- **`pool` 是保留字**：不能当 pet pack 的文件名前缀（`pet/pool-config.json` 会被跳过并告警一次，
  `POST /pet-config` 里传 `entry: "pool"` 会被拒）。
- **`skin/` 不存在 = 空池**：不报错、不告警，行为与没有这段配置完全一样。
  （插件启动时会把池根与 `layered / live2d / webm / sound` 建出来，所以「刚装好」看到的是空目录而不是不存在。）
- **启动时初始化的目录**：`<用户根>`、`main-animation/webm`、`main-animation/mov`、`memes/`、
  池根的 `layered` / `live2d` / `webm` / `sound` 四个目录，以及各渲染方式的兜底音效目录
  （`<池>/layered/sound` 等）。只建目录、不写占位文件；建不出来的只记一行日志，插件照常可用。
- **`pet/<素材根>-*` 是内置素材，`skin/` 是用户素材**：`pet/` 跟着 pack 安装/升级/迁移走，
  `skin/` 是「我自己补的，一份给所有宠物用」。解析顺序仍是**先 pack 后池**，所以内置那套优先、
  池只做补充与替换的落点；右键「皮肤 / 模型」菜单里池里的条目带「（池）」标记。
- 池里的音效**必须带前缀**（结构文件基名 / 目录名 / 渲染方式名 / 任意前缀）——池是共享的，
  裸 `click.wav` 会串到别的宠物头上；只有 `skin/sound/` 认无前缀写法。
- 设置页「音效」分区每行第二行显示**实际命中的绝对路径**；没命中池时会提示「建议放这里：
  `skin/layered/<皮肤>/<皮肤>-click.wav`」。每行右侧都有「打开文件夹」：命中时打开该文件所在的
  那一类目录，未命中时打开建议落点；目录不存在会先问是否创建。
- 设置页「高级配置」卡的动画目录 / 表情包目录 / 资源池目录右侧也有「打开文件夹」
  （走 `POST /open-folder?which=animations|memes|pool-root`，不需要宠物参数）。
- 「打开文件夹」交给**系统的默认处理程序**（Windows 走 ShellExecute，macOS 走 LaunchServices，Linux 走
  `xdg-open`），不是写死资源管理器：把默认文件管理器换成第三方工具时照样生效。
- 全部路径都过「规范化 + 池根内校验」：`..`、绝对路径片段一律拒绝，池根配到别的盘也只在池根内解析。

## 音效段（sfx）

素材靠目录与文件名自动匹配（见 `MAKE-YOUR-OWN-PET.md` 的「音效」），`sfx` 段只写**要改的东西**：

```jsonc
"sfxEnabled": true,        // 总开关
"sfxKeepAlive": true,      // 常驻预热：久不发声后的第一下也不缺音头（代价：设备不空闲）
"sfxVolume": 0.5,          // 总音量，乘在每条 cue 自己的 volume 上
"sfx": {
  "events": { "click": { "file": "my-click.wav", "volume": 0.8, "lane": "web" },
              "floor": { "enabled": false } },
  "animations": { "写代码": [{ "file": "keypress.wav", "at": 0 }, { "file": "ding.wav", "at": 1200 }] },
  "hooks": { "ding": { "file": "ding.wav" } },
  "renderers": { "layered": { "events": { "throw": { "volume": 0.6 } } } },
  "skins": { "beiluoye": { "events": { "click": { "file": "beiluoye-click.wav" } } } }
}
```

- `file` 省略 = 用自动匹配到的文件；`enabled:false` = 关掉该槽（自动匹配到的也不播）。
- `hooks` 里的空对象 `{ "ding": {} }` 也是合法写法：只登记名字，文件靠命名规则自动匹配。
- 内置 hook 点 `drag / whisper / chat-open` 由两端自己在固定时机触发（拖拽成立、碎碎念出现、对话窗打开），
  同样没有默认音：放 `hook-<名字>.wav` 或在这里登记才响。
- `animations` 的数组是时间线（各自 `at`）；`events` 的数组是变体（随机抽一个）。
- 冲突时后者赢：`skins[model]` > 皮肤清单 `manifest.sfx` > `renderers[kind]` > 基座 > 自动匹配 > 内置默认。
- 事件槽共八个（`click / throw / floor / wall / ceiling / pet / sleepStart / sleepEnd`）：拖拽成立不出声，
  它和随后的点击或甩出只差几十毫秒，两条音叠在一起像破音。
- 设置页的音效分区只调开关与登记 hook；分项 `volume` 由总音量 `sfxVolume` 统一压，不提供逐槽滑块。
- 旧键 `clickSoundEnabled / clickSoundKeepAlive / clickSoundVolume` 仍可读（映射到上面三项），保存时只写新键。
