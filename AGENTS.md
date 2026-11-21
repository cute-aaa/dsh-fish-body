# AGENTS.md — 本仓的多工作树对齐纪律

> 给**新开的会话**（人或 Agent）看的第一份文件。本仓长期同时存在两个工作副本，历史上因此出现过三次「功能看起来没了」的误判：不是被删，而是**另一个副本上的改动还没合并过来**。开工前请先执行本文的「开工前三步」。

## 一、工作副本一览

| 角色   | 路径                                                              | 分支                | 说明                                         |
| ------ | ----------------------------------------------------------------- | ------------------- | -------------------------------------------- |
| 主检出 | `G:/Projnew/ai/dsh-fish-body`                                     | `main`              | 用户的日常开发副本；**新功能常先在这里落地** |
| 工作树 | `G:/Projnew/ai/dsh-fish-body/.agents/worktrees/dsh-42f42794-3023` | `dsh-42f42794-3023` | 长任务/DevFlow 路由用的隔离副本              |

- 插件本体在 `dsh-pet/`；仓库根另有 `openapi.yaml`、`API.md`、`CONFIG.md`、`FEATURES.md`、`docs/`。
- `D:\NodeJs\DSH_home\plugins\dsh-fish-body` 是 **junction**，指向哪一个副本，决定「当前运行的插件代码是哪一份」——这直接决定用户看到的功能。
- 远程 `upstream` = `github.com/PC2005-cloud/dsh-pet`（上游模板仓库），`main` 已远领先于它。

## 二、运行实例与端口（本机实测）

| 端口        | 实例                         | 纪律                                                                                           |
| ----------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| **3099**    | `--profile fish --port 3099` | 本插件（`dsh-fish-body`）的宿主实例，**验收/真机测试都在它上面**                               |
| 3080 / 3081 | `dsh web`（web profile）     | DSH 自己的 Web UI + 虚拟桌面 frameServer（`127.0.0.1:8790`）宿主，**任何测试都不许重启或杀掉** |
| 8790        | frameServer                  | 属于上面那个 web 实例；重启 web 实例会一起没                                                   |

- token 从该实例自己的启动行取：`logs\dsh-3099*.out.log` 里的 `dsh web: http://127.0.0.1:3099/?token=...`；**旧 token 会 401**，不要复用历史记录里的。
- 重启 3099 前后必须断言目标命令行含 `--profile fish` 与 `--port 3099`，且 PID ≠ web 实例的 PID。

## 三、开工前三步（每次会话都做，30 秒）

```powershell
# 1) 有几份工作副本、各自在哪个分支
git -C G:\Projnew\ai\dsh-fish-body worktree list

# 2) 另一个副本有没有未提交的活
git -C G:\Projnew\ai\dsh-fish-body status --short

# 3) 当前分支缺了 main 上哪些提交
git -C G:\Projnew\ai\dsh-fish-body log --oneline <当前分支>..main
```

- 第 2 步有输出 → **先问用户**要不要先把那边的活提交；不要直接拷贝文件覆盖（会产生两份分叉的产品代码）。
- 第 3 步有输出 → 先 `git merge main`，再做任何功能开发；否则你测的是旧产品。
- 用户说「某功能没了」时，**第一个排查方向是第 2/3 步**，而不是去 git 历史里找删除记录。

## 四、合并方向与冲突热点

- 方向固定：**主检出 → 工作树**（`git merge main`，在主检出所在仓库执行即可，两边共享同一个 `.git`）。
- 已知冲突热点：
  - `dsh-pet/runtime/electron-helper/main.js` / `main/tray.js` / `main/windows.js` —— 托盘/窗口状态相关改动都挤在这里；
  - `dsh-pet/src/client/settings/locales/*.ts`（8 份字典，键集必须一致）；
  - `dsh-pet/src/client/settings/{voice-tab,voice-card,voice-provider-card,use-voice-settings}.ts` 与 `src/host/voice/**`、`src/host/routes/voice*.ts`；
  - `openapi.yaml`（新增端点/字段要双向校验：`npm run check:openapi`）。
- 解冲突原则：**两侧能力都要保留**；若两侧做的是同一件事的不同入口，收敛成「一个状态真源 + 变更广播」，不要留两条并行路径。

## 五、状态真源规则（踩过坑，写死）

- **托盘菜单不存状态**：勾选/显隐一律**现算**，来源是运行期真值（`windows.js`），窗口不在时才回落配置。历史缺陷：托盘自己记一份 → 快捷键或右键改过之后托盘显示反的。
- `clickThrough`、隐藏/显示这类「多入口同状态」的字段，变更必须：
  1. 收敛到单一出口（`windows.setClickThrough` / `setHidden`）；
  2. 出口内**值真的变化**才广播（首次登记也算变化）；
  3. 订阅方（托盘）用「合并刷新」（在飞置 again、结束后 drain），不要逐次重画。
- 不新增并行 IPC 频道来表达同一件事；渲染端已有的 `pet:click-through` 之类频道保持不变。

## 六、测试与数据安全纪律

- 破坏性测试默认在**真实 `fish` 数据根**上做，必须走「快照 → 实测 → 还原 + 四项基线双判」：主配置 `md5`、`data/persona-characters` 条目数、`skin/{layered,live2d,webm}` 条目数、`skin/*-config.json` 清单；另加 web 实例 PID 不变。
- 快照只保内容、**不保链接拓扑**：`skin/` 下若有 junction，`/MIR` 会在快照侧落成普通空目录，别声称「链接也还原了」。
- 虚拟桌面（`dshv-*`）：`/vdesk/input` **不校验桌面名**，历史上因此误关过用户的浏览器窗口。使用前必须 ①目标桌面在 `/vdesk/desktops` 里 ②`/vdesk/frame` 拿到有内容的帧 ③该用例确实需要 OS 级输入；**禁止探测式点击**。截图优先走 CDP（DComp 窗口不进 BitBlt 帧）。
- 路由失败约定：本仓不少接口是 **`200 + {ok:false,reason,message}`**，`400` 只留给非法 JSON；断言要写 `body.ok === false`，别按 4xx 写。
- **`{kind:'none'}` 只表示「调用方已经走了」**（`routes/types.ts` 的 `RouteInput.signal` 触发，`http-route.ts` 因此**不写任何应答**）。任何**「时限到点」都不许走这条路**：用户侧症状是「点了没反应」——既不失败也不说话，而门禁可能是全绿的。时限类错误必须显式落成 `unsupported`（可操作提示）或继续等待，见 `src/host/pick-no-timeout-guard.test.ts` 的守卫口径。
- **别用时间当失败条件**：凡是「等外部人操作」的链路（系统对话框、长轮询、回调），不得以 `setTimeout`/`AbortSignal.timeout`/请求选项 `timeout:` 判失败。释放互斥只能由真实事件（选中 / 取消 / 抛错 / 调用方断开）驱动。守卫：`dsh-pet/src/host/pick-no-timeout-guard.test.ts`（覆盖四个 pick 源文件）。

## 七、文档与产物索引

| 位置                         | 内容                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `DESIGN.md`                  | 功能清单（能力 → 入口 → 状态真源 → 不变量）与**变更前检查清单**；改功能前先对照                                              |
| `FEATURES.md`                | 面向用户的功能列表（与 DESIGN.md 的分工见文件头）                                                                            |
| `docs/插件升级与冒烟隔离.md` | 换根 / 快照-还原 / 双判判据 / junction 代价                                                                                  |
| `docs/测试约定.md`           | 四层测试、虚拟桌面输入约束、`200+ok:false` 断言口径、变异验证、**等外部人的请求不得用全局 `fetch`**（undici 缺省 300s 悬崖） |
| `docs/计划编制规范.md`       | 依赖图与拓扑序（避免任务成环）                                                                                               |
| `docs/上传体积上限约定.md`   | base64 与请求体预算                                                                                                          |
| `artifacts/<slug>/`          | DevFlow 各轮产物（需求、方案、计划、变更、审查、测试、知识、总结）                                                           |

## 八、提交与发布

- 不自动 `commit` / `push` / 打 tag；提交前跑：`npm test`、`npx tsc --noEmit`、`npx tsc -p tsconfig.test.json`、`npm run lint`、`npm run format:check`、`npm run check:cycles`、`npm run check:openapi`、`npm run test:ui`（碰 UI 时）、`npx tsdown`。
- 插件改动要在真机生效需 `npm run build`（产物 `lib/`）+ 重启对应实例。
