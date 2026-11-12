# dsh-pet 🐾

一只住在 DeepSeek Harness 里的桌面宠物，一百余个透明动画，可多开、能上桌面。

安装与完整文档：**<https://github.com/PC2005-cloud/dsh-pet>**

## 设置页源码地图

「桌宠配置」设置页按功能分区（宠物 / 全局 / 外观 / 音效 / 语音 / 对话 / 存储）。文件按**变化原因**切：
一个分区有自己的状态与异步时才有自己的文件，只把几张卡排一下序的分区就地写在装配表里。

| 文件                                             | 职责                                                           |
| ------------------------------------------------ | -------------------------------------------------------------- |
| `src/client/settings.ts`                         | 装配根：加载、写盘编排、分区外壳                               |
| `src/client/settings/tabs.ts`                    | 分区表与标签条（加一个分区 = 表里加一行）                      |
| `src/client/settings/panels.ts`                  | 分区标识符 → 卡片装配                                          |
| `src/client/settings/pet-tab.ts`                 | 宠物分区：种类条 + 宠物条 + 实例卡                             |
| `src/client/settings/voice-tab.ts`               | 语音分区：语音卡 + 本地语音接入卡                              |
| `src/client/settings/look-tab.ts`                | 外观分区：字体 / 物理 / 动作频率 / 移动端                      |
| `src/client/settings/model-tab.ts`               | 对话分区：模型卡                                               |
| `src/client/settings/use-voice-settings.ts`      | 语音状态：六个随保存写入的字段 + 拉取、轮询、启停的节奏        |
| `src/client/settings/voice-api.ts`               | `/voice/*` 三个接口的请求与解析（读失败回 `null`，写失败抛错） |
| `src/client/settings/use-global-settings.ts`     | 五个全局开关（含音效总闸）与通知权限申请                       |
| `src/client/settings/use-sfx-settings.ts`        | 音效分区：槽位编辑、来源展示与试听                             |
| `src/client/settings/sfx-card.ts`                | 音效卡：九个事件槽 + hook 的开关、音量与试听                   |
| `src/client/settings/use-model-settings.ts`      | 对话状态：两个模型、历史条数、配图上限、三个对话开关           |
| `src/client/settings/use-appearance-settings.ts` | 字体 / 物理 / 动作权重                                         |
| `src/client/settings/use-avatar-upload.ts`       | 头像上传：破缓存版本号与上传中标志                             |
| `src/client/settings/use-permission-test.ts`     | 「测试弹窗」的就地反馈                                         |
| `src/client/settings/save-hotkey.ts`             | Ctrl+S / Cmd+S：本页可见时才接管                               |
| `src/client/settings/tab-memory.ts`              | 分区记忆：上次停留的分区存在 `localStorage`                    |
| `src/client/settings/save-fields.ts`             | 保存请求体的摊平：每个分区贡献哪几个键                         |
| `src/client/settings/use-pet-list.ts`            | 宠物列表：种类条、实例增删与选中                               |
| `src/client/settings/use-remote-data.ts`         | 页面级一次性拉取：落盘位置与候选模型清单                       |
| `src/client/settings/config/`                    | 成品读取、HTTP 契约、保存与同步编排、表单校验                  |
| `src/client/settings/*-card.ts`                  | 单张卡片：纯展示 + 回调，状态全在 hook 里                      |

许可：代码 MIT；素材禁止商用；二创在公开渠道须署名（同上链接）。
