# dsh-pet 🐾

一只住在 DeepSeek Harness 里的桌面宠物，一百余个透明动画，可多开、能上桌面。

安装与完整文档：**<https://github.com/PC2005-cloud/dsh-pet>**

## 设置页源码地图

「桌宠配置」设置页按功能分区：**桌宠 / 外观与手感 / 声音 / 对话 / 会话鱼 / 系统**。
文件按**变化原因**切：一个分区有自己的状态与异步时才有自己的文件，只把几张卡排一下序的分区就地写在装配表里。

### 视觉与交互约定（改样式前先读这三条）

1. **说明只有两个出口**：卡片标题旁的 `?`（整卡语境）与字段标签的悬浮气泡。字段级问号已废弃——四十个问号把视线切碎，
   而它们承载的信息大多能从标签本身读出来；真正会让人踩坑的那几条写成常显的 `note`。
2. **控件只有一套规格**：28px 高、8px 圆角、`--pcg-*` 尺度变量；开关是开关视觉 + `checkbox` 语义，圆点是真节点
   （不画在 `input::after` 上——替换元素的伪元素不保证生成）；颜色一律取 `--dsw-*` token。
3. **动作分两层**：保存相关（撤销 / 取消 / 应用 / 确定 + 未保存条数）在底部常驻栏；维护相关（重启 / 重置 / 卸载，
   以及「文件与目录」那棵树）在「系统」分区末尾，不占底部栏。

### 文件

| 文件                                            | 职责                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/client/settings.ts`                        | 装配根：加载、写盘编排、未保存基线、快捷键与外壳（页头只剩分区标签条）            |
| `src/client/settings/tabs.ts`                   | 分区表与分段标签条（加一个分区 = 表里加一行）                                     |
| `src/client/settings/panels.ts`                 | 分区标识符 → 卡片装配                                                             |
| `src/client/settings/snapshot.ts`               | 表单快照：各分区状态摊成与基线同形的对象                                          |
| `src/client/settings/use-revert.ts`             | 「撤销改动」：重读配置与会话鱼，结论由加载状态落地                                |
| `src/client/settings/pet-tab.ts`                | 桌宠分区：种类下拉 + 实例 chip + 选中实例的配置卡                                 |
| `src/client/settings/pet-card.ts`               | 宠物卡：身份 / 显示与位置 / 功能 / 人设（折叠）                                   |
| `src/client/settings/pet-card-parts.ts`         | 宠物卡的字段组（身份 / 显示 / 位置 / 尺寸覆盖）与头像格                           |
| `src/client/settings/feel-tab.ts`               | 外观与手感分区：物理 / 动作频率 / 字体                                            |
| `src/client/settings/character-card.ts`         | 角色卡：来源下拉 / 扫描 / 角色列表 / 应用 / 导入文档预览 / 只读说明               |
| `src/client/settings/render-card.ts`            | 渲染卡：渲染方式 + 模型/皮肤同行 → 缺文件提示 → 位置 → 尺寸折叠                   |
| `src/client/settings/skin-dirs.ts`              | 皮肤目录三行：用户 skin 三类桶的存在性 / 资源数 / 打开                            |
| `src/client/settings/tree-row.ts`               | 树行绘制（文件卡与皮肤目录共用）                                                  |
| `src/client/settings/window-behavior.ts`        | 窗口行为卡：鼠标穿透（这只）/ 锁定在当前屏幕（全部）                              |
| `src/client/settings/physics-card.ts`           | 物理卡 + 「移动端效果」折叠（震动 / 倾斜 / 摇一摇）                               |
| `src/client/settings/motion-card.ts`            | 动作频率卡（随机动作是纯读数，不给假输入框）                                      |
| `src/client/settings/font-card.ts`              | 字体卡：字体 / 字号 / 跟随缩放                                                    |
| `src/client/settings/fish-tab.ts`               | 会话鱼分区：启用与预览 / 播报 / 节奏                                              |
| `src/client/settings/fish-fields.ts`            | 会话鱼的皮肤、大小与数量三格                                                      |
| `src/client/settings/fish-skins.ts`             | 皮肤清单分组、当前项与失效判定（纯函数）                                          |
| `src/client/settings/audio-tab.ts`              | 声音分区装配（总闸 → 事件 → 语音）                                                |
| `src/client/settings/sfx-master-card.ts`        | 音效总闸卡：总开关 / 常驻预热 / 总音量                                            |
| `src/client/settings/sfx-card.ts`               | 音效卡：槽位开关常显、明细收进折叠、hook 卡紧随                                   |
| `src/client/settings/sfx-slot-row.ts`           | 槽位两张脸：紧凑列表（开关 + 试听 + 来源徽标）与明细行（路径 + 命名规则）         |
| `src/client/settings/sfx-hooks.ts`              | 自定义 hook 卡：登记表单与名单                                                    |
| `src/client/settings/voice-tab.ts`              | 语音分区：播报卡 + 本地语音接入卡                                                 |
| `src/client/settings/voice-card.ts`             | 语音卡：四类播报 / 去表情 / 音色 / 音量 / 试听                                    |
| `src/client/settings/voice-provider-card.ts`    | 本地语音（GSV）接入配置与启停                                                     |
| `src/client/settings/model-tab.ts`              | 对话分区装配                                                                      |
| `src/client/settings/model-card.ts`             | 模型卡 + 「这些开关要花多少 token」折叠                                           |
| `src/client/settings/system-tab.ts`             | 系统分区装配（提醒 → 屏幕 → 快捷键 → 维护动作组）                                 |
| `src/client/settings/system-card.ts`            | 提醒与桌面卡（含「测试弹窗」）                                                    |
| `src/client/settings/maintenance-card.ts`       | 插件维护卡：重启 / 重置设置 / 页面说明（与备份、文件目录同属维护动作组）          |
| `src/client/settings/backup-card.ts`            | 备份与恢复卡（放在维护动作组最前：只读，风险最低）                                |
| `src/client/settings/shortcuts-card.ts`         | 快捷键参考卡（折叠）                                                              |
| `src/client/settings/fs-card.ts`                | 「文件与目录」卡：路径树（每行一个「打开文件夹」）+ 运行时 + 卸载                 |
| `src/client/settings/bar.ts`                    | 底部常驻栏：状态（未保存条数 / 保存结论 / 需重启条数）+ 撤销 / 取消 / 应用 / 确定 |
| `src/client/settings/use-plugin-restart.ts`     | 插件自重启的唯一实现：是否先存盘由参数决定                                        |
| `src/client/settings/restart-hint.ts`           | 「需重启插件后生效」的路径表：改动路径 → 是否要重建桌面窗口                       |
| `src/client/settings/dialog.ts`                 | 确认 / 提示弹窗（删除、只剩一只、重置、恢复、配置损坏）                           |
| `src/client/settings/ui.ts`                     | 共用小件：字段、卡头、小节、说明行、开关格、折叠卡、尺寸控件                      |
| `src/client/settings/css.ts`                    | 样式注入入口：拼 `style/` 三段，按 `data-plugin-css` 去重                         |
| `src/client/settings/style/tokens.ts`           | `--pcg-*` 尺度变量、入场关键帧与 `prefers-reduced-motion` 降级                    |
| `src/client/settings/style/controls.ts`         | 控件层样式：输入、按钮、开关、分段标签、chip、滑块与两类自绘下拉                  |
| `src/client/settings/style/cards.ts`            | 容器层样式：卡片、小节、列表行、折叠、底部栏、弹窗与容器查询                      |
| `src/client/settings/use-*.ts`                  | 各分区的字段状态（宠物列表、全局、音效、语音、模型、外观、会话鱼、备份…）         |
| `src/client/settings/use-persona-characters.ts` | 人设来源与角色库：加载、扫描、应用、删除                                          |
| `src/client/settings/use-persona-import.ts`     | 文档导入：预算闸门 → 预览 → 落库                                                  |
| `src/client/settings/use-persona-polish.ts`     | AI 润色：预览，应用才写草稿                                                       |
| `src/client/settings/use-render-resources.ts`   | 三桶资源清单（`/skin/{root}/resources`）                                          |
| `src/client/settings/config/`                   | 成品读取、HTTP 契约、保存与同步编排、表单校验                                     |
| `src/client/settings/locales/`                  | 九种语言字典；`zh` 是键集真源                                                     |

## 维护与回滚

| 想做的事                   | 怎么做                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| 重启插件（免重启 profile） | 设置页「系统 → 维护动作 → 重启」，或 `POST <插件路由>/plugin-restart`（有 HMR 时刷新页面即可）     |
| 升级前留一份底             | `npm run rollback -- snapshot --label before-upgrade`，`--with-config` 连数据根的 `config/` 一起拍 |
| 看有哪些底                 | `npm run rollback -- list`                                                                         |
| 退回上一个可用状态         | `npm run rollback -- restore <id>`（默认干跑；加 `--apply` 执行，恢复前自动再拍 `pre-restore`）    |
| 数据布局回滚               | `node scripts/migrate-layout.mjs --revert`（干跑）→ 加 `--apply`                                   |
| 清掉旧快照                 | `npm run rollback -- prune <id> --apply`                                                           |

- 快照收 `lib/`、`package.json`、`cordis.patch.yml`（+ 可选 `config/`），落在 `artifacts/rollback/`（已 gitignore）。
  **不收** `data/`、`skin/`、`assets/pet/`、`node_modules/`、`dist-app/`——回滚不碰用户自己的东西。
- 实现在 `src/host/rollback.ts`（纯逻辑 + 注入 fs）与 `scripts/rollback.mjs`（CLI，默认干跑）；
  `scripts/` 不随 npm 包发布（`files` 白名单只留 `ensure-electron.mjs`），要回滚请在仓库里跑。
- 设置页那边对应的入口：「系统 → 维护动作」（备份与恢复 / 文件与目录 / 重启 / 重置）；改到需要重建桌面窗口的项时，
  字段下方会立刻出现「需重启插件后生效」，保存后底部栏给出「其中 n 项需重启」+「立即重启」。

许可：代码 MIT；**素材禁止商用**；二创在公开渠道须署名（同上链接）；第三方组件、字体与 Live2D Cubism Core 见 [`../NOTICE`](../NOTICE)。
