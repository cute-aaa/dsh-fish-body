# dsh-pet 对外 HTTP 接口一览

dsh-pet 的宿主半侧向 DSH 自己的 Web 服务注册了**一条前缀路由** `/dsh-pet-7340`，浏览器端、
桌面端、设置页与第三方插件全都访问同一份实现。本文只做**功能预览**（接口名 + 一句话），
完整契约——参数、响应体、字段含义、错误码与示例——见根目录的 [`openapi.yaml`](openapi.yaml)。

- **基址**：`http://127.0.0.1:<port>/dsh-pet-7340`，`<port>` 是 DSH Web 服务实际监听的端口
- **只监听 127.0.0.1，且没有鉴权**：任何能访问本机该端口的进程都能调用，请勿转发到公网

---

## 一、读状态

| 接口                            | 功能                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /dsh-pet-7340/state`       | **轮询唯一数据源**：所有状态位都在这里；带 `?since=&timeout=` 可长轮询                                     |
| `GET /dsh-pet-7340/config`      | 读合并后的成品配置（内置默认 + 用户层，字段已填满）                                                        |
| `GET /dsh-pet-7340/config/meta` | 配置文件路径、日志文件路径、各类数据落盘位置、卸载该用哪个 profile                                         |
| `GET /dsh-pet-7340/models`      | 可用服务商与模型清单（与 DSH 自己的模型选择器同源）                                                        |
| `GET /dsh-pet-7340/chat?pet=`   | 读某只桌宠最近的对话记忆窗口；带 `?rounds=` 可指定本次读取的轮数（0–200，不传用配置的 `chatMemoryRounds`） |
| `GET /dsh-pet-7340/pose?pet=`   | 读**桌面端**宠物的实况（位置 + 朝向）；网页端用客户端服务 `petApi7340`，不走这条路                         |

## 二、占用锁

| 接口                                   | 功能                                                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /dsh-pet-7340/lock?pet=`         | **占用锁**：联动演出期间独占这只宠物（除持锁者外全静音）；取锁会先把它叫醒，占用期间不能再睡下；`lockId` 给了=续期、没给=新建，回 `lockId` + `expiresAt` |
| `POST /dsh-pet-7340/lock/release?pet=` | **释放占用**：`lockId`=持锁者收工 / `force`=用户接管（渲染端上报，第三方不用调）                                                                         |

**锁占用期间，桌宠完全静止**：它自己不动、也不弹气泡——余额、碎碎念、工作状态这些全都让路。

标了「（需锁）」的接口，第三方调用时**必须带上 `?lock=<lockId>`**。锁就是给第三方用的：带上它，
才能保证这段时间归你控制，不被别的插件、也不被桌宠自己的事件打断。没带 → `lock-required`；
编号不对 → `lock-lost`（附 `cause`：过期 / 已释放 / 被用户抢走）。

两条边界：

- **没有锁时**：不传 `?lock=` 一切照旧；传了 `?lock=` 说明你以为自己还持有 → 回 `lock-lost`，
  `cause` 告诉你锁是怎么没的（过期 / 已释放 / 被用户抢走）；
- **用户优先**：用户拖一下宠物、或把它隐藏 / 关闭，锁会立刻被撤掉。`/whisper`、`/balance`、`/chat`
  是用户自己点的入口（右键菜单 / 斜杠命令），占用期间照常可用。

## 三、让它说话（气泡）

| 接口                                   | 功能                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /dsh-pet-7340/whisper?pet=`      | 让桌宠**生成**一句碎碎念（走当前模型）；响应带 `text`（配图时另有 `image`），同时照旧写进气泡                                                                                                                                                                                                                                               |
| `POST /dsh-pet-7340/broadcast?pet=`    | **第三方投喂**（需锁）：把外部给定的文本写进气泡（不生成，只搬运）；配图（`image` 池内名 / `url` 自带地址）、时长、动画联动、是否念（`speak`，缺省不念）可选                                                                                                                                                                                |
| `POST /dsh-pet-7340/bubble/clear?pet=` | **清空气泡**（需锁）：提前收起说话气泡（只动气泡，不动动画）                                                                                                                                                                                                                                                                                |
| `POST /dsh-pet-7340/chat?pet=`         | 对桌宠说一句话并生成回复，同时写入对话记忆；响应带 `text`（配图时另有 `image`），同时照旧写进气泡。可选 `attachment`（`mediaType` + base64）随本轮送一张图：图片**记进记忆**（存附件引用，不存本体），但只影响这一轮、不进气泡；不传时行为与旧版逐字一致。配置 `chatAnimationEnabled` 时回复可带 `[动作:名称]`，采纳后与 `/anim` 同链路点播 |
| `DELETE /dsh-pet-7340/chat?pet=`       | **删除对话记忆**：带 `?ts=`（可重复，取自 `GET /chat` 的 `messages[].ts`）只删这些轮——一轮两条共享 `ts`，成对删；不带 `ts` 清空整只。响应 `{ ok: true, removed }`，删空后不留空对象                                                                                                                                                         |
| `GET /dsh-pet-7340/chat/memory`        | 列出**已删宠物**残留的对话历史（宠物删了但历史还在，`GET /chat` 读不到）；只给条数与最后时间                                                                                                                                                                                                                                                |
| `DELETE /dsh-pet-7340/chat/memory`     | 一次清空这些残留历史                                                                                                                                                                                                                                                                                                                        |
| `POST /dsh-pet-7340/balance`           | 立即刷新一次余额（可见效果同样是弹气泡 + 档位动画）                                                                                                                                                                                                                                                                                         |

## 四、让它做动作

| 接口                                      | 功能                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /dsh-pet-7340/anim?pet=`            | **点播动画**（需锁）：播池内名字（同右键「动作」菜单）或第三方自带的 `url`；`facing` 可选指定朝向（`left`/`right`，不传则不动朝向）；回 `playbackId`                           |
| `GET /dsh-pet-7340/playback/{id}`         | **播放回执**：查那次点播的真实状态；带 `?wait=&timeout=` 可挂起等待                                                                                                            |
| `POST /dsh-pet-7340/playback/{id}/report` | 渲染端上报播放状态（**内部通道**，第三方不用调）                                                                                                                               |
| `POST /dsh-pet-7340/pose/report?pet=`     | 桌面渲染端上报实况（**内部通道**，第三方不用调）                                                                                                                               |
| `POST /dsh-pet-7340/position?pet=`        | **位置控制**（需锁）：挪到归一化坐标，`mode` = 直接/弹簧/直线；不碰动画。额外回**夹取后**的 `x`/`y`                                                                            |
| `POST /dsh-pet-7340/throw?pet=`           | **原生抛掷**（需锁）：给桌宠一个初速度让它飞出去（`angle` 度、`power` 倍率）                                                                                                   |
| `POST /dsh-pet-7340/sleep?pet=`           | **让它睡下**：从 `animations.sleep` 里挑一整套（开始/循环/起来）写进 `pets.<id>.sleep`；睡着期间自动来源与手动触发一律拒绝（持锁时让路）；没配睡觉动画回 `no-sleep-animations` |
| `POST /dsh-pet-7340/wake?pet=`            | **叫醒**：播「起来」后回随机链；本来没睡也回 ok（幂等）                                                                                                                        |
| `POST /dsh-pet-7340/focus-session`        | **跳会话**：让页面切到指定会话；桌面端点会话气泡走这条                                                                                                                         |

## 五、改配置与重载

| 接口                                 | 功能                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `PUT /dsh-pet-7340/config`           | 保存用户层配置（白名单重建，用户手写的精调字段会保留）                                                                  |
| `POST /dsh-pet-7340/config`          | 用内置默认整份覆盖用户配置，即「恢复默认」                                                                              |
| `POST /dsh-pet-7340/pet-display`     | **改单只宠物的显示位置**（`web` / `desktop` / `both` / `none`），只传 `{ id, display }`                                 |
| `POST /dsh-pet-7340/pet-config`      | **按种类写回全部实例**（`{ entry, pets }`，`entry` = `skin/<名>-config.json` 的前缀）；白名单重建，顶层动画池与人设保留 |
| `POST /dsh-pet-7340/reload`          | 重载桌面端（重启桌面宠物进程，按最新配置重建窗口）                                                                      |
| `GET /dsh-pet-7340/settings-backup`  | **导出设置备份**：主配置、每个种类配置与会话鱼设置的**原文**（JSONC 注释与字段顺序都保留）                              |
| `POST /dsh-pet-7340/settings-backup` | **用备份恢复**：先整体预检再原子写回，覆盖前把现有文件留成 `<文件>.bak-<时间戳>`；空串表示删掉那一层                    |

## 六、第三方菜单项

| 接口                                         | 功能                                                                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /dsh-pet-7340/menu/item`               | **注册菜单项**（该 `owner` 的菜单项整体覆盖）：`{ owner, labels: ["弹弓","钓鱼"], target?: "web"\|"desktop"\|"both" }`，`target` 不写 = 两端都显示 |
| `DELETE /dsh-pet-7340/menu/item?owner=`      | **清除菜单项**（该 `owner` 的全部项，幂等）：回 `{ ok: true, removed: 2 }`                                                                         |
| `GET /dsh-pet-7340/menu/events?owner=&wait=` | **查询触发**（读取即清空，`wait` = 长轮询毫秒数）：回 `{ 弹弓: "main", 钓鱼: null }`                                                               |
| `POST /dsh-pet-7340/menu/click`              | 渲染端上报点击（**内部通道**，第三方不用调）                                                                                                       |

第三方菜单项统一收在右键菜单的**「更多」**下。`label` 在全部第三方项里唯一时直接平铺
（`更多 / 弹弓`）；`label` 重名时，每个 `owner` 在「更多」下各占一个子菜单（`更多 / owner / label`），
靠它区分同名项。宿主自己的菜单项固定，不参与重名判定。

## 七、素材

| 接口                                         | 功能                                                                                                                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /dsh-pet-7340/thumb/{petId}/{file}`     | 动画素材（`.webm` / `.mov`，按宠物归属；缺失回落共享资源池 `<池>/webm/`，`petId=pool` 只查池）                                                                                                                                   |
| `GET /dsh-pet-7340/sound/{root}/index`       | **音效索引**：每个事件槽实际用哪个文件、来源（池 / 皮肤 / 声音目录 / 内置默认）、命中绝对路径与「建议放这里」                                                                                                                    |
| `GET /dsh-pet-7340/sound/{root}/{file}`      | 音效文件（按该素材根的音效搜索链；`root=pool` 只查共享资源池）。必带 `?renderer=layered\|live2d\|webm`（决定池的资源目录是哪一层），`?model=` 决定先查哪套皮肤：`/sound/main/manifest-click.wav?renderer=layered&model=feiyu-05` |
| `GET /dsh-pet-7340/skin/{root}/{file}`       | 皮肤 / 模型素材（缺失回落池；`root=pool` 只查池）                                                                                                                                                                                |
| `GET /dsh-pet-7340/skin/{root}/skins`        | 可切换的分层皮肤清单（旧皮肤 ∪ 池，`items` 带 `pack` / `pool` 来源）                                                                                                                                                             |
| `GET /dsh-pet-7340/skin/{root}/models`       | live2d 模型清单（同上，带来源）                                                                                                                                                                                                  |
| `GET /dsh-pet-7340/skin/{root}/resources`    | **渲染资源三桶清单**（设置页用）：`layered` / `live2d` / `webm` 各自的 `status`（`ok` / `empty` / `missing`）、`dir`、`count`、`items`、`expect`、`missingFiles`；与 `skins` / `models` 同一套扫描判定                           |
| `POST /dsh-pet-7340/open-folder?pet=&which=` | 打开素材目录（`pool-layered / pool-live2d / pool-webm / pool-sound / pool-global-sound` 等）；**不带 pet** 可打开全局目录：`pool-root / animations / memes / user-root`                                                          |
| `GET /dsh-pet-7340/font/{file}`              | 字体文件                                                                                                                                                                                                                         |
| `GET /dsh-pet-7340/pic/{file}`               | 通知图标（`pic/`）与表情包（`pic/memes/{素材根}/`，按宠物归属）                                                                                                                                                                  |
| `GET /dsh-pet-7340/attachment?id=`           | **取图**：把对话记忆里 `image.attachmentId`（`sha256:…`）换回图片                                                                                                                                                                |
| `GET /dsh-pet-7340/logo?root=`               | 宠物头像：缺省回插件 logo（`assets/logo.png`）；带 `root=<素材根>` 时回该 pet pack 上传的头像，没有就回默认                                                                                                                      |
| `GET /dsh-pet-7340/character?root=`          | **角色参考图**：按素材根回一张官方设定图（png / jpg / webp / gif），第三方自建生图时对齐角色用；**不代调生图模型**，出图与计费都在调用方                                                                                         |
| `POST /dsh-pet-7340/pet-avatar?root=`        | **上传头像**：`{ base64 }`，覆盖写 `skin/<素材根>-avatar.<ext>`；`root=main`（内置）被拒                                                                                                                                         |

## 八、工作状态（外部写入）

| 接口                               | 功能                                                                 |
| ---------------------------------- | -------------------------------------------------------------------- |
| `POST /dsh-pet-7340/work-status`   | **外部写入工作状态**：`{ state, task? }`，固定外部槽，最后写入者生效 |
| `DELETE /dsh-pet-7340/work-status` | **清空外部槽**回空闲（幂等，204）                                    |

## 九、语音

| 接口                                                | 功能                                                                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /dsh-pet-7340/voice/speak`                    | 合成并返回音频：`{ text, voice?, rate? }`；同一输入命中缓存，队列最多排 3 个                                                           |
| `POST /dsh-pet-7340/voice/hear`                     | 识别音频回文字：`{ audio }`，16kHz/单声道/PCM16 WAV 的 base64                                                                          |
| `GET /dsh-pet-7340/voice/voices`                    | 可用音色列表 + 合成链状态；前端拿它渲染选择器，不要硬编码 id                                                                           |
| `GET /dsh-pet-7340/voice/provider-config?provider=` | 读一个实现的接入配置：`values`（普通项）+ `secrets`（密钥**配没配**，值从不回传）                                                      |
| `POST /dsh-pet-7340/voice/provider-config`          | 写接入配置：`{ provider, patch, clear? }`；普通项进 `voice-providers.json`，密钥项进 DSH 凭据库；声明了 `options` 的字段只收候选值之一 |
| `POST /dsh-pet-7340/voice/provider-voice`           | 切某个实现的音色：`{ provider, voice }`，立即落盘（不是「保存」的一部分）                                                              |

合成链是「注册的**免费**第三方在前、内置 edge 收尾」，任一环失败就**静默**落到下一环（用户只会听到换了嗓子）。
**按量计费的实现不进这条链**（`billable`）：被「可用」自动选中等于替用户花钱。它只在用户打开自己的付费开关
（今天只有云端 TTS 的 `useCloud`）时被排到链首，自己失败则回落免费链——失败的那次请求不计费，所以回落不增加成本。
`/voice/voices` 的 `providers[]` 因此有两个互不替代的字段：`reason` 是「这一环现在能不能用」，
`lastError` 是「通着但上一句念失败了」（参考音频坏了、上游 `/tts` 报错…，合成成功即消失）——
后者是「本地音色其实没用上」唯一可见的线索，设置页的接入卡把它当警告显示。

**密钥不进配置文件**：`kind: password` 且声明了 `credentialRef` 的字段（今天只有云端 TTS 的 `apiKey`）
写进 DSH 凭据库——配置文件会被备份、会被贴进 issue。写入语义：`patch` 里非空才写、**空串是「不改」**
（值不回传，界面只能给空框），要删必须放进 `clear`。宿主凭据库没有写入能力时（独立模式的替身只有
`resolve`）回 `unsupported`，不静默丢弃用户填的密钥。
`credentialFallbacks` 是**只读**回退，且**按协议生效**：云端的 `apiKey` 只在 `protocol: deepseek` 时回退到
`DEEPSEEK_API_KEY`（设置页据此显示「已保存」）；`openai` / `custom` 的 `fields[].credentialFallbacks` 为空，
只认用户自己填的那把 key——**第三方 baseURL 永不复用宿主的 DeepSeek 密钥**（否则把 baseURL 指到陌生服务，
就等于把宿主的模型凭据发出去）。保存与清除永远只动主引用，不会连宿主的模型凭据一起删。

**云端 TTS 是通用接入**（`id: cloud`）：`protocol` 决定接口形状，三种都支持——
`deepseek`（`POST {baseURL}/v1/tools/tts`，body 固定 `{ text, voice_id, format: 'wav', filter_markdown: true }`，
12s 超时；这是改造前的形状，老配置原样继续跑）、
`openai`（`POST {baseURL}/v1/audio/speech`，body `{ model, input, voice, response_format }`，`response_format`
默认 `mp3`；服务地址已带 `/v1` 时不会重复拼）、
`custom`（`POST {baseURL}{path}`，body 由 `bodyTemplate` 渲染，可用占位符 `{text}`（必填）/ `{model}` / `{voice}`，
`headers` 可加额外请求头并与默认的 `Authorization: Bearer <key>` 合并）。

字段：`useCloud`（`off`/`on`）、`protocol`（`deepseek` / `openai` / `custom`）、`baseURL`、`model`、`voice`、
`path`、`bodyTemplate`、`format`、`headers`、`apiKey`。**`required` 随协议变**，由 `/voice/voices` 的
`providers[].fields[].required` 直接下发（设置页只画星号，不判断协议）：`openai` 要 `baseURL`+`model`+`voice`+key，
`deepseek` 只要 key（`baseURL` 留空用 `https://api.deepseek.com`，`model` 对该协议无效），
`custom` 要 `baseURL`+`path`+`bodyTemplate`+key。`voice` 是**自由文本**，按服务商填（`alloy` / `nova` / `stella`…）；
云端因此没有可枚举的清单，`providers[].voices` 只回**当前生效的那一个**（`{ id, name, tag: protocol }`，
`deepseek` 留空时是 `stella`），要换音色请改接入卡（`/voice/provider-voice` 只收清单里的值）。

响应**不再假定 wav**：按魔数嗅探 `RIFF`→wav、`ID3`/`0xFF Ex`→mp3、`OggS`→ogg、`ftyp`→m4a；认不出就报
「返回的不是音频（前 16 字节 hex）」并带上 `Content-Type`。非 2xx 的错误文案截断到 512 字符，带 `protocol` 与
**脱敏后的 `baseURL`**（去掉 userinfo 与查询串，绝不带 key）。缓存键含 `protocol`、`baseURL`、`path`、`model`、
`voice`、`format` 与 `bodyTemplate` 的指纹：换协议 / 换服务 / 换模型 / 换音色都不会命中旧音频。

老配置（`config/voice-providers.json` 里只有 `useCloud` / `baseURL` / `voice`）没有 `protocol` 时按地址推断：
空或含 `deepseek` → `deepseek`，否则 → `openai`；缺这一项**不会**被判成不可用。`useCloud` 不是「保存」的
一部分：保存后宿主立刻重探一次可用性（`refresh()`），开关与密钥当即生效。`rate` 对云端无效（三种协议都没有
统一的语速参数，说明写在字段描述里）；wav 比同长度 mp3 大约 8 倍，缓存上限 20 MB 约能存 100 句，靠 LRU 淘汰。
计费按服务商自己的规则（DeepSeek 按字符：汉字算 2 字符，每万字符 3 元、限时 1.5 元）。

`POST /voice/provider-process` 只跑 `config/voice-providers.json` 里填的启停脚本，**不建控制台窗口**：
脚本的 stdout/stderr 追加到 `<DSH_HOME>/fish-body/logs/gsv/<provider>-start.log`。这不是风格问题——
`api_v2` 的 `/tts` 在合成前有一句 `print()`，而「窗口被关掉、进程还活着」的 stdout 已失效，
`print` 会抛 `OSError: [Errno 22] Invalid argument`，于是每句合成都 400、整条链静默落到 edge。
手工双击 `gsv.bat` 时同理：脚本自己把 python 的输出重定向进 `logs\gsv\api-v2.log`，关窗口只会停服务，
不会再留下一个「stdout 已死」的孤儿。

## 十、待办事项

| 接口                              | 功能                                                         |
| --------------------------------- | ------------------------------------------------------------ |
| `GET /dsh-pet-7340/todos`         | 读取待办清单（未完成在前、到期越近越靠前，无期限垫底）       |
| `POST /dsh-pet-7340/todos`        | 新建一条：`{ text, dueAt? }`，`dueAt` 为 epoch 毫秒或 `null` |
| `PATCH /dsh-pet-7340/todos/{id}`  | 修改一条：`{ text?, dueAt?, done? }` 至少给一个              |
| `DELETE /dsh-pet-7340/todos/{id}` | 删除一条（幂等，回 `removed` 条数）                          |

## 十一、看屏幕与避让

五个端点都由桌面 Helper 驱动（宿主推不动 Helper：Windows 上 Electron 主进程收不到 piped stdin），
第三方一般只需要读状态或手动触发一次。

| 接口                                     | 功能                                                                                                                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /dsh-pet-7340/screen/tick?pet=`     | Helper 每 5 秒问一次「这一拍拍不拍」：`{ ok, capture, reason }`，`reason` = `disabled` / `manual` / `throttled` / `busy` / `quiet` / `ready`。**无副作用**；手动请求只有真的拍下去才被消费                                                             |
| `POST /dsh-pet-7340/screen/frame?pet=`   | 交一帧：`{ attachment: { mediaType, data } }` → 读图 → 一句话进 `say` 叶子。持锁时先门禁后花钱（`locked`），开关关着 `unsupported`，读图失败 `generate-error`（文案带「模型可能不支持读图」）。`?debug=1` 会把这一帧另存到 `<用户根>/screen-frame.jpg` |
| `POST /dsh-pet-7340/screen/request?pet=` | 记一个手动请求（跳过间隔 / 忙闲 / 静默三张门），下一拍 `reason=manual`；开关关着 `unsupported`                                                                                                                                                         |
| `POST /dsh-pet-7340/screen/event?pet=`   | Helper 上报最近一帧前台快照（`kind: foreground`），只存最近一条，供设置页显示「当前前台 …」                                                                                                                                                            |
| `GET /dsh-pet-7340/screen/state?pet=`    | 读十三个归一化后的配置项 + `manualPending` / `lastMs` / `last`（上次结论）/ `foreground`（最近前台与判定）                                                                                                                                             |

十三个配置键（`screenRead*` 六个、`avoid*` 七个，平键写在配置顶层、拍平时收成 `pet.screen`）见
[`docs/交接-P4.md`](docs/交接-P4.md) 第三节；越界值运行期夹取、写盘整包拒绝。

## 十二、会话鱼

| 接口                                        | 功能                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /dsh-pet-7340/session-fish`            | 读会话鱼设置（独立文件 `<数据根>/config/session-fish.json`；文件缺失/损坏时回默认值）                                     |
| `PUT /dsh-pet-7340/session-fish`            | 保存设置：只传要改的字段；未知键/类型错/越界 → `bad-request`，写盘失败 → `settings-write-failed`（旧值保留）              |
| `POST /dsh-pet-7340/session-fish`           | 用户动作：`{ action: "focus" \| "close", sessionId, blank?, running? }`；`focus` 在已完成时让鱼消失，`close` 隐藏到下一轮 |
| `GET /dsh-pet-7340/session-fish/skins`      | 列可选皮肤：用户目录 `<数据根>/assets/session-fish/` 在前、包内 `assets/webm/` 在后（同名以用户为准），附 `defaultSkin`   |
| `GET /dsh-pet-7340/session-fish/skin?name=` | 取一份皮肤文件（图片 / 动图 / webm）；名字非法或扩展名不支持 → `400`，不存在 → `404` 文本                                 |
| `POST /dsh-pet-7340/session-fish/claim`     | 认领一条播报的出声权：`{ sessionId, lineSeq }` → `{ granted }`；每个 `(会话, 序号)` 全机器只授予一次                      |

### 显示面：网页 + 桌面

会话鱼**跟着桌宠的显示方式走**（`pets[].display`）：`web` / `both` 时网页浮层里有鱼，`desktop` / `both`
时桌面 Helper 的窗口里也有鱼；`display` 不含那一端就不出现（网页里也不会退化成右下角竖排）。

- **网页**：`shell.overlay` 浮层，围着 `.dsh-pet-stage` 排布，拖拽位置以「相对槽位的偏移」记在
  `localStorage`（`dsh-pet:session-fish-offsets`）。
- **桌面**：画在桌宠**自己的那个窗口**里——不新增窗口、不新增渲染进程、不新增第二条 `/state` 轮询。
  鱼**可拖、可关、带播报气泡**：悬停到某条鱼时窗口才翻成可交互（`fishBusy` + 控件矩形经
  `pet:set-input-*` 上报，其余区域继续点击穿透）；拖动位置记在桌面窗口自己的 `localStorage`
  （`file://` 与网页不同源，两份互不覆盖）；右上角 × 发 `POST /session-fish {action:'close'}`。
  窗口只在真有鱼时按环位把透明余量撑大，鱼全没了立刻收回；运动与碰撞复用同一份
  `shared/session-fish/roam`。桌面没有「右下角竖排」，`followPet` 只影响网页端。

### 播报：全机器只念一次

语音链的单槽是每个页面 / 窗口各一份的，所以「谁该念这一句」由宿主裁决：客户端在念之前先
`POST /session-fish/claim`，只有拿到 `granted: true` 的那一端出声，另一端的鱼照样显示气泡。
请求失败一律按放行处理——网络抖动不该把播报静音。

每个显示面内部还有一层队列：多条鱼同时有事时串行播报（同一时刻只有一句），同一条播报 8 秒内不重入、
同样的句子跨会话 4 秒内只念一次；认句按 `lineSeq` 而不是文本（文案池每档只有两句，按文本认会把
别处念的同句误判成自己的收尾）。设置页「桌宠配置 → 会话鱼」可整体关掉。

- **会话范围**：会话是全局的（`<DSH_HOME>/sessions`，按 cwd 分桶，`SessionHeader` 里没有 profile 字段），
  不按 profile 划分；只有在本进程里真正跑的会话才会发 `session/event`，因此鱼天然只对应本 profile 正在做的事。

完整字段与状态机见 [`openapi.yaml`](openapi.yaml)。

## 十二、人设来源与角色库

人设的模型是「**角色库 + 勾选应用**」：来源只负责产出角色，角色进全局角色库
（`<数据根>/data/persona-characters/*.json`，一角色一个文件，可直接拷走）；宠物**引用**角色
（`pets[].personaCharacter` 存角色 id），点「应用到此宠物」才把正文写进那一只的 `whisperPrompt`。
不同宠物可引用不同角色，互不覆盖。接入细节见 [`docs/自定义人设接入.md`](docs/自定义人设接入.md)。

| 接口                                           | 功能                                                                                                                                                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /dsh-pet-7340/persona/sources?pet=`       | **来源列表**：每个来源的 `kind` / `installed` / `expectedPath` / `path` / `scannable` 与上次扫描回执 `lastScan`。`?pet=` 可选（给了附 `pet.entry/writable/character`，给了不存在的 id 回 `unknown-pet`）                    |
| `POST /dsh-pet-7340/persona/scan`              | **扫描并导入**：`{ source, path? }`；账本回 `{scanned, imported[], skipped[]}`。`path` 必须是绝对路径且落在数据根或 `DSH_HOME` 内，否则 `bad-request`。第二次运行同一来源全部 `reused:true`（同正文按指纹去重，不重复入库） |
| `GET /dsh-pet-7340/persona/characters`         | **角色列表**：`{id, name, source, importedAt, chars, appliedTo[]}`；坏文件只进 `skipped`                                                                                                                                    |
| `POST /dsh-pet-7340/persona/characters/import` | **落库**：`{ character: 8 字段, source? }`；同正文回 `reused:true` 且不写盘，同名不同正文 id 加 `-2…-99`                                                                                                                    |
| `POST /dsh-pet-7340/persona/characters/apply`  | **应用到此宠物**：`{ pet, characterId, writeName? }`；一次读盘一次写盘，**只改这只**。三键已是目标值回 `unchanged:true` 且不写盘；非 main 实例回 `persona-readonly-entry`                                                   |
| `DELETE /dsh-pet-7340/persona/characters/{id}` | **删角色**：被任何实例引用时拒绝（`character-in-use`，附 `extra.referrers`），无人引用才删文件                                                                                                                              |
| `POST /dsh-pet-7340/persona/import`            | **文档 → 预览（零写盘）**：`{ files: [{name, base64}], pet }`；单文件解码后 ≤ 768 KiB、合计 ≤ 768 KiB − 4 KiB（base64 与 JSON 包装预留）、最多 5 个；体超 1 MiB 回 `413`，解码后超上限回 `200 + payload-too-large`          |
| `POST /dsh-pet-7340/persona/polish`            | **AI 润色 → 预览（零写盘）**：`{ pet, text }`；只改措辞、不改名字、不新增设定，`text` 上限 8000 字符                                                                                                                        |

三条边界：

- **预览不写盘**：`/persona/import` 与 `/persona/polish` 只回结果，落库/写宠物一律要显式再调
  `/persona/characters/import` 或 `/persona/characters/apply`。文档里两个 AI 动作失败都归 `generate-error`。
- **文档格式**：`md` / `txt` / `json`（`chara_card_v2` 直接取 8 字段、**跳过模型调用**）/
  `png`（只认 SillyTavern 的 `chara` tEXt 块，**不做 OCR**）/ `docx`（纯文本抽取）。
  **`.doc` 不支持**，回 `unsupported` 并提示「另存为 .docx 或直接粘贴文本」；读不出内容回 `extract-failed`。
- **只读实例**：文件宠物（pet pack）的实例属于别的条目（`entry !== 'main'`），
  `writable:false`，设置页只禁用「应用 / 删除」，扫描/导入/浏览角色库仍可用。

新增的失败 `reason`：`unknown-character`、`character-in-use`（`extra.referrers`）、`extract-failed`、
`persona-readonly-entry`、`persona-source-unavailable`（`extra.expectedPath`）、`unknown-persona-source`。
全部是 200 + 失败实体，与其余业务端点同口径。

---

## state 详解

`GET /state` 是所有状态位的唯一出口，结构固定：

```jsonc
{
  "counter": 1755000000007,   // 整份 S 的版本号 = 最后一次写入的编号（顶层，不是叶子）
  "sections": {               // 全局段：所有端共享一份
    "balance": {…}, "workStatus": {…}, "notify": {…}, "config": {…}, "menu": {…}, "focusSession": {…}, "sessionFish": {…}
  },
  "pets": {                   // 每只宠物各自一份；键是宠物 id（可含点号，勿切分）
    "main": { "say": {…}, "anim": {…}, "position": {…}, "throw": {…}, "lock": {…}, "sleep": {…} }
  }
}
```

每个 `{…}` 是一个叶子 `{ counter, data }`：**`counter` 变了就表示它更新了**（唯一判据）。

`pets.<id>.anim` 是动作指令：`{ name }` 或 `{ url }` 二选一，可选 `playbackId` / `facing`；
对话动作联动写的也是它，形状与 `POST /anim` 完全一致。

`pets.<id>.sleep` 与 `lock` 一样是**状态不是指令**：`{ sleeping: true, start, loop, end }` 时它在睡，
三段名字由宿主挑定（渲染端照播）；`{ sleeping: false }` 是醒着。

`sections.sessionFish` 是**只读快照**：`{ enabled, sizePx, maxCount, bubbleMs, speak*, fishes[], ts }`，
每条鱼带 `state / task / line / lineSeq / done / planPending`。内容没变时宿主不会写它（`ts` 不参与去重），
消费端按叶子 `counter` 判断即可。**浏览器从不往回写这个叶子**——用户动作走 `POST /session-fish`。

**长轮询**：`?since=<上次的顶层 counter>&timeout=<ms>`（成对必填，上限 10s）。有字段改变就
**立刻返回**，否则一直挂到 `timeout` 到点；返回体与不带参数时一样。

**前端在每个需要的地方各存一份 `counter`**：首拉只记基线不渲染，之后一样就不渲染、不一样就
渲染并更新——据此判断变了没有、要不要触发。

## 独立模式（不打开 DSH）

不启动 DSH 时，同一份 `/dsh-pet-7340` 契约由本机服务提供，另外多出三个**挂在服务根上**的端点
（**不在 `/dsh-pet-7340` 前缀下**）：

| 接口                   | 功能                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `GET /`、`GET /health` | 服务与插件信息：名称、插件根与版本、监听端口、已运行秒数                                |
| `POST /shutdown`       | 优雅停机：释放插件注册的 effect（停止桌面助手、清掉周期定时器）后关闭服务，进程退出码 0 |

`/dsh-pet-7340` 下的端点形状不变，但三个依赖 DSH 的接口**明确降级**（结构化失败，不假装成功）：
`POST /whisper`、`POST /chat` 回 `reason: 'provider-missing'`，`POST /balance` 回 `reason: 'unsupported'`。

## 相关

- [`CORDIS.md`](CORDIS.md) —— 对外 Cordis 服务（客户端半侧，页面内 `ctx.get()`，不走网络）
- [`openapi.yaml`](openapi.yaml) —— 完整契约（OpenAPI 3.1，可直接导入 Swagger UI / Postman）
- [`tools/api-tester.html`](tools/api-tester.html) —— 桌宠控制台：扮演第三方消费方的示例页面，
  可直观试用上述接口（用 `node tools/api-tester.cjs` 启动，它会带上本地代理解决跨域）
