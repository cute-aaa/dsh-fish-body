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
- **种类（pet pack）**：`skin/` 目录里的角色包也会列在宠物列表里（按种类分组），同样能改名称/大小/位置/显示方式/四个开关/实例人设；每组的「+」在该种类下新建实例。保存时 main 写 `config/main-config.jsonc`，文件宠物写回各自角色包配置（顶层动画池与人设原样保留）；每种至少留一只，删最后一只会被拒绝
- **物理参数**：拖拽抛掷手感（重力 / 弹性 / 地面摩擦 / 总力度 / 顶部反弹 / 宠物互撞 / 碰撞震动 / 倾斜控制重力 / 摇一摇抛出）也能在设置页图形化改，不用去手改配置文件。碰撞震动（`physics.hapticEnabled`，默认开）在撞墙、落地、撞顶与宠物互撞时各震一下：Chrome / Edge 等浏览器可用，iOS 与 Via 这类 WebView 套壳浏览器不生效，系统勿扰模式会挡住振动。宠物互撞（`physics.petCollision`，默认开）按动量守恒弹开（质量 ∝ 尺寸²）。体感拆成两个开关：倾斜控制重力（`physics.tiltGravity`，默认关）用手机倾斜方向代替固定向下的重力（`gravity` 为 0 时无从取值，等同关闭）；摇一摇抛出（`physics.shakeThrow`，默认关）沿甩动方向把宠物甩出去（力度 = 基准 × `throwPower`），与重力大小无关，`gravity` 设 0 也能甩着玩。两个都只在 HTTPS 或 localhost 下有效
- **AI 模型**：碎碎念与对话可以**各自指定模型**——设置页「AI 模型」每项一个下拉框（与 DSH 对话框右下角的模型选择器同款：搜索框 + 按服务商分组的清单，选项同源）；选「跟随当前对话」= 用当前对话的模型，指定了但调用失败会自动回落到当前对话的模型重试一次
- 点「保存」**即时生效**（无需刷新）；「同步」把包内 `config.jsonc` 的**原文**（含注释与全部高级字段）整份写入用户配置——既回到默认，又留下一份可直接编辑的完整配置
- **需要重建桌面窗口的项**：渲染方式、皮肤 / 模型、显示位置、大小（含按渲染方式的 `sizes` 与屏幕宽度百分比）、增删宠物、锁定屏幕、宠物固定、系统托盘、系统通知。保存时宿主会重建一次桌面 Helper；设置页在改动那一刻就在对应字段下方标「需重启插件后生效」，保存后底部栏给出「其中 n 项需重启插件后生效」+「立即重启」。数据根 / 皮肤目录 / 运行时目录的迁移则**必须**重启插件（迁移完成处直接给「立即重启」）
- **语音**：碎碎念与对话回复可以念出来（默认关闭），音色四选一、默认晓伊（女声 · 活泼）；音色列表来自宿主 `/voice/voices`，不在页面里硬编码。云端语音接任意 TTS 服务：`config/voice-providers.json` 的 `cloud` 段用**四轴**声明——endpoint（`baseURL` + `path`，路径可用 `{voice}`/`{key}`）、auth（`authStyle` = `bearer`/`api-key-header`/`x-api-key`/`query`/`none`，可配 `authHeader`）、body（`bodyKind` = `json`/`form`/`ssml` + `bodyTemplate`，占位符 `{text}`/`{model}`/`{voice}`/`{format}`/`{key}`）、response（`responseKind` = `audio`/`json-base64`/`json-hex`/`json-url` + `responsePath`）；`preset` 只是把四轴**预填**好（`openai-speech` / `mimo` / `deepseek` / `azure` / `elevenlabs` / `google`），选完仍可逐项覆盖，清空某项就回到预设默认值。`protocol` 只剩 `openai` / `custom`，老配置里的 `protocol: 'deepseek'` 会自动映射到同名预设、请求逐字节不变。密钥存 DSH 凭据库，**只有最终生效预设是 `deepseek`** 时才复用本机的 `DEEPSEEK_API_KEY`，其余预设只认自己填的那把——**第三方 baseURL 永不复用宿主的 DeepSeek 密钥**。四轴与预设表见 `API.md` 第九节 **本机 GSV（原生 GPT-SoVITS 的 `api_v2`）**同样可用时优先用它：本机 GSV（原生 GPT-SoVITS 的 `api_v2`）可用时优先用它：填服务地址 + **音色包目录**即可，音色包目录里一个子目录就是一个音色（`ref.wav` + 可选 `ref.txt` + 两侧权重真文件），缺权重或参考音频的音色会列出来但置灰（原因见「声音 → 语音接入」卡上的诊断）。接入卡里只有一个「导入音色…」按钮：每次选一次 `GPT_weights*` / `SoVITS_weights*` 所在的目录 → 清单逐行勾选 → 挑参考音频与文本 → 选「引用（硬链接）」或「复制」→ 整批预检后导入到 `<音色包目录>/<id>/`。`gsv` 段只剩 `baseURL` / `voice` / `voicesDir` / `textLang` / `promptLang` / `startScript` / `stopScript`；已移除的 `refsDir` / `gptWeightsDir` / `sovitsWeightsDir` 与 `<id>/voice.json` 一律不读（老配置里的残留值原样留着，不影响运行）

## 方式二：config.jsonc（单一来源）

插件包内 `dsh-pet/assets/config.jsonc` 的 `pets` 数组定义**默认宠物**：

```jsonc
"pets": [
  { "id": "main", "size": 462, "balanceEnabled": true, "display": "both", "position": { "corner": "top-right", "marginX": 24, "marginY": 100 } }
]
```

- 每只宠物：`id`（标识）／`size`（宽度 px）／`sizePercent`（可选，屏幕宽度百分比 1–100；写了就按窗口宽收口、`size` 作上限）／`sizes`（可选，按渲染方式覆盖宽度：`{ "webm": 500, "layered": 620, "live2d": 620 }`，缺键回落 `size`；三种素材的人物占框比例不同，右键「大小」写的就是它）／`clickThrough`（可选，`true` = 桌面端这只宠物的窗口整窗忽略鼠标、点击落到下层应用；仅桌面端生效，开启后窗内右键菜单点不到，出口是设置页的同一勾选框）／`renderer`（可选，`webm`/`layered`/`live2d`）／`model`（可选，live2d 的 `.model3.json` 路径或 layered 的皮肤 id）／`balanceEnabled`（是否启用余额功能，必填布尔）／`display`（web/desktop/both/none，必填，见上）／`position`（corner 四角之一 + marginX/marginY 边距）
- 余额刷新周期：`eventsRefreshSec.balance`（秒）——余额数据刷新与余额动画触发的间隔，启动时立即触发一次，之后按此周期循环（默认 1800）
- 设置页的修改保存到用户层 `$DSH_HOME/fish-body/config/main-config.jsonc`（**完整宠物列表**，覆盖包内默认）；「同步」把包内 `config.jsonc` 原文整份写入该文件（等价于回落默认，但文件保留下来、可直接编辑）

## 方式三：手动编辑配置文件（高级，任意自由配置）

用户层配置文件位于 `$DSH_HOME/fish-body/config/main-config.jsonc`。**它和包内默认配置是同一套格式**——想改什么直接照着 `assets/config.jsonc` 的结构写即可，写错的字段/缺失的字段回落默认，无需（也无法）写完整份。设置页「同步」可直接生成这份完整文件（原文复制包内 `config.jsonc`，注释齐全）：

| 字段                   | 作用                                                                                                                                       | 格式与默认一致即可                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `pets`                 | 宠物列表（大小/位置/多开/余额开关）                                                                                                        | 数组，每项同 `pets[]` 结构           |
| `animations`           | **动画池**：idle / turn / drag / clicks / moves / categories / events（余额等事件动画）/ sleep（睡觉套，可选）                             | 同 `animations` 结构                 |
| `animationWeights`     | 动画链播放权重（idle / turn / move）                                                                                                       | 同 `animationWeights` 结构           |
| `eventsRefreshSec`     | 事件刷新周期（秒）：`whisper` 碎碎念、`sleepTalk` 梦话、`balance` 余额                                                                     | 同 `eventsRefreshSec` 结构           |
| `sleepStartTexts`      | **入睡台词**（条目级，随机挑一句；播「开始」时弹气泡）                                                                                     | 非空字符串数组                       |
| `sleepEndTexts`        | **醒来台词**（条目级，随机挑一句；播「起来」时弹气泡）                                                                                     | 非空字符串数组                       |
| `sleepRefuseTexts`     | **睡着被打扰时的拒绝台词**（条目级，随机挑一句）                                                                                           | 非空字符串数组                       |
| `notificationsEnabled` | 系统通知总开关（布尔）                                                                                                                     | 同 `notificationsEnabled`            |
| `petEnabled`           | **桌宠总开关**：`false` = 全部宠物一起收起（桌面不建窗、网页不渲染、碎碎念/余额/待办提醒停跑），与每只的 `display` 正交（布尔，默认 true） | 只读 `main` 条目，宠物文件里写它无效 |
| `hideAllHotkey`        | **全局隐藏 / 暂停的系统级快捷键**（Electron accelerator，如 `Control+Alt+H`；空串 = 关掉）。按下后全部桌宠藏起来 + 语音暂停，再按恢复      | 只读 `main` 条目                     |
| `chatAnimationEnabled` | **对话动作联动**：开启后对话时把 `animations.categories` 下的动作清单交给模型，由它按语境挑一个当场表演（布尔，默认 true）                 | 布尔，默认即可                       |

> 覆盖语义：用户层给出即**整体替换**该字段（如写了 `animations` 就用你的整份动画池，替代默认），没写的字段回落包内默认。校验在插件加载时执行——格式错误会在 DSH 控制台显式报错，不会静默运行残缺配置。

## 方式三之二：会话鱼设置（`session-fish.json`）

会话鱼不写进 `main-config.jsonc`：它是一组独立的小偏好，单独存在 `$DSH_HOME/fish-body/config/session-fish.json`（普通 JSON，不带注释；写坏了逐字段回落默认）。设置页「桌宠配置 → 会话鱼」改的就是它，点底部「应用 / 确定」后浮层立即生效。

> 设置页底部的「重置设置」= 用内置默认整份覆盖用户配置（`main-config.jsonc` 的注释、宠物列表、自定义人设都会回到默认），并把 `session-fish.json` 写回默认值；确认后立即写盘，不可撤销。只想改回个别字段时用「应用 / 确定」，别用重置。

### 备份与恢复

设置页「系统 → 备份与恢复」把三份**可编辑设置的原文**打成一份 JSON：`main-config.jsonc`（主配置与宠物列表）、`skin/<名>-config.json(c)`（每个文件宠物）、`session-fish.json`（会话鱼）。导出再恢复之后，注释与字段顺序都不变。

- **不含**：宠物头像图片、对话记忆 `memory.json`、待办数据、日志，以及浏览器 `localStorage` 里的位置记忆。
- **恢复是覆盖**：同名文件被写回快照内容，写之前每个被覆盖的文件会在同目录留一份 `<文件>.bak-<时间戳>`；备份里没有的种类文件不会被删除。
- 主配置或会话鱼那一层在快照里是空串时，表示「拍摄时没有这一层」——恢复会删掉现有文件，回落到内置默认 / 默认设置。
- 恢复前会先整体预检：任一份原文解析不了就一个文件都不写。

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

小鱼默认**围着桌宠转**：桌宠走位、被拖走、被甩飞时鱼群跟着移动，鱼与鱼、鱼与桌宠之间有碰撞分离。拖住一条鱼可以挪位置——拖的时候就看得见「牵引绳」边界（环半径的 3 倍），鱼停在边界上，**松手就停在松手处**，不会再被拽回环位；位置以「相对槽位的偏移」按会话记在浏览器 `localStorage`（`dsh-pet:session-fish-offsets`），刷新后仍在你放它的方向。「桌宠配置 → 会话鱼」里的「重置鱼的位置」会把它们放回桌宠旁边；`followPet=false` 时回到右下角竖排（同一套拖拽与位置记忆）。

**显示在哪里跟着桌宠走**：`pets[].display` 含 `web` 时网页浮层里有鱼，含 `desktop` 时桌面 Helper 的窗口里也有鱼；两端同时显示时只有一端出声（宿主按 `(会话, 序号)` 裁决）。桌面端的鱼画在桌宠**同一个窗口**里——不新增窗口 / 进程、不加第二条轮询；窗口只在真有鱼时按环位把透明余量撑大，鱼没了立刻收回。桌面上的鱼可拖、可关、带播报气泡：**悬停到某条鱼**才把窗口翻成可交互，其余区域继续点击穿透；拖到哪停在哪，位置记在桌面窗口自己的 `localStorage`（`file://` 与网页不同源，两份互不覆盖）；右上角 × 关掉这一条。`followPet` 只影响网页端（桌面没有「右下角竖排」这一说）。

**换皮肤**：把图片 / 动图（`.png` / `.jpg` / `.jpeg` / `.gif` / `.webp`）或视频（`.webm` / `.mp4`）放进用户数据根下的 `assets/session-fish/` 目录（设置页「打开皮肤文件夹」会建好并打开），回到设置页点「重新扫描」即可在下拉里选中；包内 `assets/webm/` 的一百多段小动作也都在列表里。素材按原比例显示，太扁或太长的会被夹在 0.5–2 倍宽之间；文件删掉后那一条自动回落到内嵌的小鱼画法。

未知键、类型错、越界、非法皮肤名在保存时会被宿主拒绝（`PUT /session-fish` 回 `bad-request`）；手工改文件后需要重载插件才生效。字段与状态机见 [`API.md`](API.md) 与 [`openapi.yaml`](openapi.yaml)。

## 方式四：额外宠物（pet pack）——添加新「种类」

方式一~三都只调整**默认宠物的实例**（数量/大小/位置），动画池始终是全局一份。要添加**全新种类的宠物**（独立动画池 + 自己的素材），在用户数据根下建 `skin/` 目录：

```
$DSH_HOME/fish-body/
├─ config/main-config.jsonc         ← 主宠物配置（现有，不动）
├─ assets/animation/webm/*.webm     ← 主宠物素材（现有，只属于 main）
└── skin/
   ├── pig-config.json          ← 额外宠物 pig 的配置（命名词干 = 种类名，实例 id 任意）
   └── pig-animation/*.webm     ← pig 自己的动画素材（直接平铺，仿 assets/animation）
```

每只额外宠物 = 一个 `-config.json` + 一个 `-animation/` 目录，同前缀配对；扫描 `skin/` 自动发现，浏览器与桌面同时生效。一个 `-config.json` 定义**一个「种类」**（动画池 + 素材目录），`pets` 数组可放该种类的**任意多只实例**（共享动画池与素材）：

```jsonc
// skin/pig-config.json —— 与 main-config.jsonc 同构的完整配置
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

- **素材只查自己的**：素材目录名 = 文件名前缀（`skin/pig-config.json` → `skin/pig-animation/`），该种类所有实例共用；动画 URL `/thumb/<前缀>/<名>.webm`，查不到即 404——绝不落到 `assets/animation` 或包内素材
- **动画池不回落全局**：`animations` / `animationWeights` 必须写全（缺失即配置错误）
- **`animations.sleep` 是可选段**（睡觉动作）：不写 = 该种类没有睡觉功能，右键菜单不出现「睡觉」，其余动画不受影响。写了就是「套」的数组，每套 `{ start, loop, end }` 三段各是候选数组；入睡时整套随机挑一套，三段都从这套里取，进段时再在段内随机挑一个（避开刚播完的那个）。结构见包内 `assets/config.jsonc` 的 `sleep` 注释
- **睡觉文案按种类各写一份**：`sleepStartTexts` / `sleepEndTexts` / `sleepRefuseTexts`，不写就跟随内置那份；`eventsRefreshSec.sleepTalk` 是梦话周期（秒，默认 60）
- 与主配置同构的约束：`pets` 每只字段完整合法、数组内 id 唯一、`animations` / `animationWeights` 结构校验同一套规则；`notificationsEnabled` / `eventsRefreshSec` 是全局属性，不归宠物文件管（写了忽略、不写不报错）
- 配置非法 / 缺少 `-animation/` 目录 / 实例 id 与主宠物冲突 → 加载时显式报错并跳过（不影响其他宠物）
- 设置页**会列出**文件宠物（按种类分组）：改名称/大小/位置/显示方式/四个开关/实例人设后保存，写回该种类自己的配置文件——不混进 `main-config.jsonc`，文件顶层的动画池与人设原样保留；「+」可在该种类下新建实例，每种至少留一只
- 余额档位动画按各宠物自己的 `events.balance`

## 角色引用（`pets[].personaCharacter`）

人设现在分两层：**角色库存角色，宠物只存引用**。设置页「桌宠 → 角色」里扫描/导入出来的角色落在
`<数据根>/data/persona-characters/<id>.json`（一角色一个文件，普通 JSON，可直接拷走或整目录删除）；
点「应用到此宠物」时宿主把角色正文写进**那一只**的 `whisperPrompt`，同时写一个实例字段：

```jsonc
{
  "pets": [
    {
      "id": "a",
      "whisperPrompt": "人设：…（角色正文的快照）",
      "personaCharacter": "鱼生", // ← 角色 id（实例字段，不是顶层键）
    },
  ],
}
```

规则：

- **实例字段，没有顶层键**：它和 `whisperPrompt` 同级挂在 `pets[i]` 上；配置里**没有**
  `personaSource` / `personaCardPath` 这两个键（上一版的「按实例绑定来源」已移除，老文件里若还有会被忽略）。
- **缺键 = 不引用任何角色**：正文由用户手写，或回落到条目级 `whisperPrompt`。删掉这个键就是「解除引用」，
  正文保持现值（只覆盖、不清理）。
- **值是角色 id**：规则是 `/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,63}$/u`——允许中文（`鱼生` 就是合法 id），
  排除 `/ \ : * ? " < > |` 与控制字符（id 会直接当文件名用）。**非法 id 整包 400**；读侧宽松
  （告警后忽略该字段，页面仍能打开）。
- **读侧不校验「角色还在不在库里」**：手工删过角色库后，这个键会作为「失效引用」如实回显，
  设置页显示「引用的角色已不存在」，`apply` 时回 `unknown-character`。
- **只有主条目的实例可应用**：文件宠物（`skin/<名>-config.json`）的实例属于那个条目
  （`entry !== 'main'`），`POST /persona/characters/apply` 回 `persona-readonly-entry`，
  设置页把「应用 / 删除」置灰。
- **保存语义**：`PUT /config` 是白名单整包重建，`personaCharacter` 必须出现在重建里才不会被丢；
  代码侧已保证（`host/config/save.ts` 的实例重建），手工改文件时也请只写合法 id。

换角色不会动别的宠物：应用只替换 `id === pet` 的那一只，其余实例原样带回。想回退到「没有角色」，
把该实例的 `personaCharacter` 删掉即可；误覆盖了手写正文，用「系统 → 备份与恢复」回滚整包。

## 资源池（assets）——共享皮肤 / 模型 / 动画 / 音效

旧的平铺布局（`pet/<材料根>-skin|sound|animation`）在启动时**自动搬进 `skin/` 与 `assets/`**（不覆盖、不删源，见 `docs/目录布局.md`）；在此之外还有一个可选的共享池：
放一份素材，所有宠物都能用。池根由 `assets.pool` 决定（只读 `main` 条目）：

```jsonc
"assets": { "pool": "assets/pet" }   // 相对数据根（默认），也可以写绝对路径，例如 "D:/skin/shared"
```

目录约定（`<数据根>` 例如 `D:\NodeJs\DSH_home\fish-body\`；完整树与迁移表见 `docs/目录布局.md`）：

```
<数据根>/
├─ config/                        # 设置
├─ data/                          # 对话记忆与待办
├─ runtime/electron/              # Electron 运行时（桌面窗口的可执行文件）
├─ cache/                         # 缓存：voice（语音合成结果）/ download（安装包）/ desktop（窗口 profile）
├─ skin/                          # 你自己的皮肤：<名>-config.json + <名>-animation/ + <名>-sound/ + <名>-memes/
└─ assets/                        # 素材（所有宠物共用）
   ├─ animation/{webm,mov}/       # main 的动画
   ├─ sound/                      # 用户级共享音效
   ├─ memes/                      # 用户级表情包
   ├─ session-fish/               # 会话鱼皮肤
   └─ pet/                        # 内置皮肤池（assets.pool 的默认值）
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

- **`pets[].model` 语义不变**，宿主按「先 pack 后池」解析：`skin/<素材根>-skin/<model>/` 存在就用它，
  缺失才回落到 `assets/pet/layered/<model>/`（live2d 同理回落到 `assets/pet/live2d/<model 所在目录>`）。
  动画同理：先 `skin/<素材根>-animation/webm/`，再 `assets/pet/webm/`，最后用户目录（`assets/animation/webm`）与包内素材。
- **`pool` 是保留字**：不能当 pet pack 的文件名前缀（`skin/pool-config.json` 会被跳过并告警一次，
  `POST /pet-config` 里传 `entry: "pool"` 会被拒）。
- **`assets/pet` 不存在 = 空池**：不报错、不告警，行为与没有这段配置完全一样。
  （插件启动时会把池根与 `layered / live2d / webm / sound` 建出来，所以「刚装好」看到的是空目录而不是不存在。）
- **启动时初始化的目录**：数据根下六个分组（`config` / `data` / `cache` / `runtime` / `skin` / `assets`）、
  `assets/animation/{webm,mov}`、`assets/{sound,memes,session-fish}`、池根的 `layered` / `live2d` / `webm` / `sound`
  四个目录，以及各渲染方式的兜底音效目录（`<池>/layered/sound` 等）。只建目录、不写占位文件；
  每个目录在 Windows 上还会写一句备注（`desktop.ini` 的 `InfoTip`，说明它存什么）。
  建不出来的只记一行日志，插件照常可用。
- **`skin/<素材根>-*` 是内置素材，`assets/pet/` 是用户素材**：`skin/` 跟着 pack 安装/升级/迁移走，
  `assets/pet/` 是「我自己补的，一份给所有宠物用」。解析顺序仍是**先 pack 后池**，所以内置那套优先、
  池只做补充与替换的落点；右键「皮肤 / 模型」菜单里池里的条目带「（池）」标记。
- 池里的音效**必须带前缀**（结构文件基名 / 目录名 / 渲染方式名 / 任意前缀）——池是共享的，
  裸 `click.wav` 会串到别的宠物头上；只有 `assets/pet/sound/` 认无前缀写法。
- 设置页「音效」分区每行第二行显示**实际命中的绝对路径**；没命中池时会提示「建议放这里：
  `assets/pet/layered/<皮肤>/<皮肤>-click.wav`」。每行右侧都有「打开文件夹」：命中时打开该文件所在的
  那一类目录，未命中时打开建议落点；目录不存在会先问是否创建。
- 设置页「系统 → 文件与目录」整棵树每行都有「打开文件夹」
  （走 `POST /open-folder?which=root|config|data|cache|runtime|skin-root|assets|…`，不需要宠物参数；
  `pets` 是 `skin-root` 的旧名，仍可用）。
- 「打开文件夹」交给**系统的默认处理程序**（Windows 走 ShellExecute，macOS 走 LaunchServices，Linux 走
  `xdg-open`），不是写死资源管理器：把默认文件管理器换成第三方工具时照样生效。
- 全部路径都过「规范化 + 池根内校验」：`..`、绝对路径片段一律拒绝，池根配到别的盘也只在池根内解析。

### 位置可以改到哪里

三处位置都能指到别处（设置页「系统 → 文件与目录」里各有入口，也可以手写）：

| 想改什么        | 记在哪                                                                            | 缺省                        |
| --------------- | --------------------------------------------------------------------------------- | --------------------------- |
| 整个数据根      | `$DSH_HOME/fish-body-root.json`（`{ "schema": 1, "root": "D:/data/fish-body" }`） | `$DSH_HOME/fish-body`       |
| 用户皮肤目录    | `<数据根>/config/locations.json` 的 `skin`                                        | `<数据根>/skin`             |
| Electron 运行时 | 同上的 `runtime`（也可 `POST /desktop/runtime { action: "dir" }`）                | `<数据根>/runtime/electron` |

优先级固定：环境变量 `DSH_PET_USER_ROOT` > 指针文件 > 缺省。指针指向的目录不存在时**回落到缺省位置**
并在日志里说明——「换盘后没挂载」不该变成一次空数据启动。搬动由 `POST /layout/location` 完成：
复制 → 核对文件数与字节数 → 通过才删旧位置（失败两份都留），成功后需要重启插件生效。
点「更改位置…」会先出一道说明（`GET /layout/size?which=root|skin` 给出文件数与体积），
选好目录后再出一次「旧 → 新」确认，两步都讲明「整体迁移、旧位置会被移除」。

## 悬停快捷键（`hotkeys`）

九个键写在**主配置（`main` 条目）顶层**，改绑在设置页「系统 → 快捷键」卡里点键帽：

```jsonc
"hotkeys": {
  "chat": "l",            // 打开对话
  "hear": "m",            // 按住说话
  "capture": "s",         // 截图到对话
  "todo": "d",            // 待办面板
  "sleep": "z",           // 睡觉 / 起来
  "display.web": "1",     // 只显示在网页
  "display.desktop": "2", // 只显示在桌面
  "display.both": "3",    // 两边都显示
  "display.none": "4"     // 两边都不显示（单向门，恢复入口在设置页）
}
```

四条硬规则（校验与归一见 `shared/hotkeys`，读写共用同一份）：

- **只接受裸键**：一个小写字母或一个数字。这些键只在鼠标停在宠物上时生效，带 `Ctrl`/`Alt`/`Meta`
  的组合属于浏览器与宿主（复制、撤销、切标签…），宠物去抢会直接抢坏基本操作。
- **不在输入框里生效**：`input` / `textarea` / `select` / `contenteditable` 里打字属于输入法。
- **九个键互不相同**：手写配置写重了，重复的那一项回落到它的出厂键；出厂键也被占用则顺延到下一个空位
  （`qwerty…` 顺序）。界面里改绑到别人占着的键时**两者互换**，所以不存在「冲突」这种中间状态。
- **缺项 = 出厂键**：整段删掉就回到上面这张表；大写会被收成小写。

生效方式：网页端在 `PUT /config` 保存成功后由 `petBridge.reload` 立刻换上新键位（不必重启）；
桌面窗口的右键菜单键帽在宿主写盘后触发的那次 Helper 重启里同步。菜单项右侧的灰字与真正生效的判定
读的是同一个字符，不会出现「菜单写 L、按 L 没反应」。

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
