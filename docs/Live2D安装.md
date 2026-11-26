# Live2D 模型与 Cubism Core 安装指南

本插件只提供 Live2D 加载器，不随包分发 Live2D Cubism Core，也不代为授权模型。
需要同时准备两样东西：

1. Live2D 官方 Cubism Core；
2. 你有权使用的 `.model3.json` 模型及其贴图、`.moc3`、动作和表情文件。

## 1. 确认当前数据根

打开 DSH 的「桌宠配置 → 系统 → 文件与目录」，以页面显示的路径为准。
下文用 `<数据根>` 表示该目录；不要把旧的 `<DSH_HOME>/dsh-pet/` 当成当前路径。

## 2. 从官方取得 Cubism Core

1. 打开 [Live2D Cubism SDK for Web 官方下载页](https://www.live2d.com/zh-CHS/sdk/download/web/)。
2. 按页面要求登录并接受 Live2D 自己的许可协议，下载当前版本的 Cubism SDK for Web。
3. 解压 SDK，在解压目录中找到：

   ```text
   Core/live2dcubismcore.min.js
   ```

   文件名必须保持为 `live2dcubismcore.min.js`。

4. 在数据根下创建 `cubism/`，把文件放成：

   ```text
   <数据根>/cubism/live2dcubismcore.min.js
   ```

不要复制或改名插件自带的 `assets/vendor/live2d-cubism4.min.js`：那个文件是
`pixi-live2d-display` 加载器，不包含 Cubism Core。

当前版本没有 Cubism Core 的一键下载资源包，原因是 Core 的分发受 Live2D 专有许可限制。
把文件正确放好并刷新设置页后，Live2D 选项应重新可用。

## 3. 放入 Live2D 模型

模型必须至少包含一个 `.model3.json`。模型引用的 `.moc3`、纹理、动作、表情和物理文件
要按原目录结构一起放入；不要只复制入口 JSON。

推荐目录：

```text
<数据根>/skin/live2d/<模型目录>/
  model.model3.json
  model.moc3
  textures/
  motions/
  expressions/
```

入口 JSON 里的相对路径必须与磁盘结构一致。若文件名或子目录被改动，`.model3.json`
里的引用也要同步修改。

也可以在「桌宠配置 → 外观与手感 → 皮肤目录 → live2d」点「导入」，选择一个完整模型目录。
导入完成后点「重新扫描」，再到「渲染方式 / 模型」选择该模型。

## 4. 选择并验证

1. 在设置页选择 `live2d` 渲染方式；
2. 在模型下拉中选择刚扫描到的 `.model3.json` 或模型 id；
3. 保存设置；
4. 桌面模式需要重建桌宠窗口，网页模式刷新页面后生效。

排障顺序：

| 现象                     | 检查                                                                           |
| ------------------------ | ------------------------------------------------------------------------------ |
| Live2D 选项置灰          | `<数据根>/cubism/live2dcubismcore.min.js` 是否存在，文件名和大小写是否完全一致 |
| 看不到模型               | 模型目录里是否存在 `.model3.json`，设置页是否点了「重新扫描」                  |
| 模型显示空白或报加载错误 | `.model3.json` 引用的 `.moc3`、贴图、动作是否齐全，相对路径是否正确            |
| 只有部分动作或表情       | 对应 `.motion3.json`、`.exp3.json`、`.physics3.json` 是否随模型一起复制        |
| 换模型后仍显示旧的       | 保存后重启插件；桌面模式还会重建 Helper 窗口                                   |

建议先使用自己制作或明确允许使用的 Cubism 3/4 示例模型验证整条链路。不要用来路不明的
模型包测试；模型的版权、角色形象授权和商业使用条件由模型提供者决定。

## 5. 发布与商用边界

- Cubism Core 的许可、出版许可与「可扩展应用」申请由使用者自行承担，详见仓库根 `NOTICE` 第 4 节。
- 本仓库和 npm 包不分发 Cubism Core，也不分发用户自己的 Live2D 模型。
- 模型来源、角色授权和商用范围请保留单独的来源记录。
