# 更新日志

本文件从本 fork 的第一个对外版本 **v0.6.0** 开始记录。上游 `dsh-pet`（`PC2005-cloud/dsh-pet`）在
0.4.x 及更早的历史不在这里重复，见上游仓库的 Releases。版本号规则：`MAJOR.MINOR.PATCH`，
用户能感知的行为变化进 MINOR，修 bug 进 PATCH；破坏性的接口/配置变化在条目末尾标 **BREAKING**。

## v0.6.0

第一个以 `dsh-fish-body` 名义发布的版本（仓库名、包名、数据目录名、接口前缀一并从 `dsh-pet`
切到 `fish-body`，旧数据根会在启动时自动迁移，迁移失败只告警、源目录原样保留）。

### 素材：不再塞进安装包

- **字体 / 表情包 / Cubism Core 移出包体**，改为运行期按需获取：包内只留最小一套（分层皮肤两套、
  七段核心动画、图标与音效），包体积从「装完一大坨」降到 **27.5 MB 解包 / 14.1 MB 打包**。
- **资源包体系**：`assets/packs.json` 清单（含 sha256、字节数、许可）+ `<数据根>/packs/<id>/` 安装目录 +
  `GET /packs`、`POST /packs/install`、`POST /packs/remove` 三个端点；安装先解压到 `.tmp-*` 再原子换名，
  校验不过直接丢弃，**不会出现「装到一半被当成素材」**。
- **设置页「系统 → 素材与字体」卡**：装 / 删 / 有新版本，逐条给状态；装完立刻生效
  （查找顺序：用户目录 → 已装资源包 → 包内默认），不需要改配置也不用重启。
- **发版流水线**：`assets-packs` workflow 打出 `anims-extra.zip`（106 文件 / 56.9 MB）并重建
  `assets-v1` Release，同时输出实测 sha256 供清单同步。
- **下载健壮性**（三条都是真机踩出来的）：
  - Node 的 `fetch` **不读** Windows「Internet 选项」里的代理 → 现在自己读 `HTTPS_PROXY`/`HTTP_PROXY`、
    回退注册表，fetch 失败且确实知道代理时用 `curl -x` 兜底；
  - 超时从「总时长 120 秒」改成「停滞 60 秒且低于 10 KB/s」——慢但一直在走的下载不再被误杀；
  - 下载从 `spawnSync` 改 `spawn`：下载期间宿主不再被堵死（实测下载中 `GET /state` 仍 200 / 0.14 秒）。
- **启动清理**：进程被强杀留下的 `<数据根>/packs/.tmp-*` 目录在下次启动时删掉（不影响已装包）。

### 人设：能接别人家的 soul 项目

- **Markdown 人设**：目录里没有 `persona.json` 时，一层 `*.md` 按文件名判语义（`SOUL` / `IDENTITY` /
  `STYLE` / `PERSONALITY` / `AGENTS` / `HEARTBEAT` / `USER` / `MEMORY`）拼成**一个**角色；
  `HEARTBEAT.md` 会带一句显式边界（以下是设定，不是当前时间），堵掉「把作息设定当现状」的坑。
- **外部项目来源**：`surfcore`（读它 `character.json` 里 `persona` 的自述路径，不猜文件名）与
  `coopanion`（工作区 `PARTNER.md`，`partner/*.md` 折成「关于主人」段）。
- **`dsh-rofm` / `dsh-suzu-memory` 从人格来源摘掉**：它们不产人设，改挂**记忆**通道，
  不再让设置页出现「永远 0 角色」的死条目。
- **内置分层皮肤**：`feiyu-05`、`feiyu-muyu` 两套随包走（50 文件 / 4 MB），皮肤目录四级回落。

### 作息、共存、记忆

- **节律 API** `GET/POST /rhythm`：外部指定「现在该睡还是该醒」与到期时间，到点自动回醒。
- **作息驱动**：从人设里读出作息（`23:00 睡觉，早上 08:00 起床`、`晚上十一点睡` 都认），每分钟对表，
  进段就睡、出段自醒；跨午夜、多段重叠（取已持续最久的一段）、只给单点（前后推 7 小时）都处理；
  **不覆盖用户手动让它睡 / 醒的决定**。中文钟点只认带时段前缀的（裸的 `十一点` 不认）。
- **共存让位** `GET/POST /coexist`：检测 surfcore / Coopanion 是否也在驱动宠物（只认硬证据），
  给「只报告 / 全部功能 / 只做身体」三档；默认只报告，**不自动静音**。
- **外部记忆**：把 `dsh-rofm` / `dsh-suzu-memory` 的记忆接进宿主已有的单槽 `ChatMemoryProvider`
  （不新造契约、不抢占已有实现），以「过去的事、可能过时」注入；`GET /memory` 三态可见。
- **设置页「系统 → 兼容与记忆」卡**：共存模式即时生效（不进「未保存」），记忆接线状态分三态显示。

### 语音

- **它开始知道自己有什么嗓子**：system 提示词新增一段由运行时状态现算的能力声明（当前音色、
  接了哪些实现、哪些装了但没连上、自动念开没开），并要求它「不要编音色、不要答应换嗓子」——
  之前被问「你有什么声音」会现编（见 `docs/待验证项.md` V1）。

### 兼容与工程

- **peerDependencies 改成按次版本列举**（`^0.2.0-rc.1 || ^0.2.1-rc.1 || ^0.2.2-rc.1`）：
  semver 规定预发布版本只满足同 `major.minor.patch` 的带预发布范围，原来的 `^0.2.0-rc.1`
  在 npm 的严格解析下匹配不到 0.2.1 / 0.2.2 的 rc 宿主。
- **`dsh.compatibility.dshReleases`** 只保留最新三版 + 日常在跑的 0.2.2-rc.1；没真机跑过的写
  `unknown` 而不是 `compatible`。
- 门禁：`npm test`（4400+ 用例）、`test:ui`、tsc（两份配置）、eslint（含 runtime 配置）、prettier、
  导入环检查、`check:design`、`check:openapi`、prepack 素材体检全绿。
