# dsh-fish-body → dsh-pet fork 开发计划

> 状态：**P0 已完成**（2026-11-10），P1 交接见 `docs/交接-P1.md`
> 基线：dsh-pet `v0.4.7`（commit be4536d，MIT；**素材禁止商用**，fork 保留 NOTICE 与来源链接）
> 目标：把 `dsh-fish-body` 从 4.8k 行自研实现，整体替换为 dsh-pet 的 fork，并在其上补齐 fish-body 的差异能力。

## 一、已定决策（第二版）

| 决策 | 结论 |
|---|---|
| 代码策略 | fork dsh-pet 本地改（仓库就是 `G:\Projnew\ai\dsh-fish-body`） |
| 渲染后端 | **webm / layered / live2d 三个独立实现，用户在设置里自选**（统一的 `Renderer` 接口 + 注册表） |
| 语音 | **edge + GSV 直连（9880）**；云端 TTS **只留配置骨架**，暂不实现 |
| GSV 音色 | `D:\AI\AI-Voice\02_GPT-SoVITS`，9 个已训练音色（见 §三） |
| 避让 + 屏幕识别 | 两个都做 |
| 默认角色包 | **dsh-pet 默认包（114 个动作，蓝毛小女仆）**；shenshen 106 作为第二个包 |
| 按需 Electron | 保持官方行为（`DSH_PET_ELECTRON_PATH` → `$DSH_HOME/electron` → `@electron/get` 下载），不打包 |
| 人设 / IM | 人设接 `dsh-fish-soul` 的 persona 卡；不实现微信/QQ |
| 环境隔离 | 其它 pet 实例/配置已关闭（见 §六） |

## 二、基线、仓库与分支

1. 现自研实现保留为 `legacy` 分支 + tag `legacy-0.2.0`（`assets/layered.js`、`lib/persona/*` 是资产，P2/P1 移植）。
2. `git remote add upstream https://github.com/PC2005-cloud/dsh-pet`，`git fetch upstream --tags`，以 `v0.4.7` 为基点重建 `main`；保持上游线性历史，日后 `git rebase upstream/main`。
3. `docs/` 目录跨迁移保留（本文件、`后续计划.md`）。
4. `pnpm install && pnpm build`（`scripts/prepare.js`：tsdown → `lib/`、`build:desktop-core` → `shared-core.js`、`tsc` → 类型声明）。
5. 插件根目录自带 `node_modules`（link 安装的插件不会从 profile 解析依赖）。

## 三、渲染后端：三实现 + 注册表

统一接口（`src/client/pet/render/types.ts`）：

```ts
interface Renderer {
  id: 'webm' | 'layered' | 'live2d';
  mount(stage: HTMLElement, opts: { size: number; assetRoot: string }): Promise<void>;
  destroy(): void;
  playAction(name: string, opts?: { weight?: number }): void;  // 一次播完
  setIdle(name?: string): void;
  setMouth(open: number): void;      // 口型（TTS 时用）
  setGaze(x: number, y: number): void;
  hitTest(x: number, y: number): string | undefined;  // 命中区 id
  readonly ready: boolean;
}
```

| 实现 | 素材 | 状态 | 工时 |
|---|---|---|---|
| `webm` | dsh-pet 默认 114（55MB）+ shenshen 106（52MB） | **默认**，dsh-pet 现有能力直接包成适配器，动作分类/权重/睡眠/事件全部复用 | 0.5d |
| `layered` | `D:\AI\FishChi\body\skins` 5 套（21–22 层，1280²） | 移植 `legacy:assets/layered.js`（28KB）→ TS，加皮肤扫描与命中区 | 3.5d |
| `live2d` | **无内置素材**，用户自备 `.model3.json` | 只做适配器 + 目录扫描；用 `pixi-live2d-display` + Cubism Core（用户自行放置运行时文件） | 1.5d（无模型时仅冒烟） |

设置页：`渲染后端` 下拉 + 对应素材选择；切换即时重建 stage，不重启插件。

## 四、语音：edge + GSV 直连（云端留骨架）

### GSV 现状（已探明）

- 服务：`D:\AI\AI-Voice\02_GPT-SoVITS\api_v2.py`，默认 `127.0.0.1:9880`，`POST /tts`，`media_type=wav`；权重切换走 `/set_gpt_weights`、`/set_sovits_weights`（全局状态，需按音色切换并缓存“当前已加载”）。
- 音色 9 个（GPT ckpt 在 `GPT_weights_v2/`，SoVITS 在 `SoVITS_weights_v2/`）：`ayaka / ganyu / hutao / klee / lauma / skirk / vodyanitsa / yaemiko / yaoyao`，每个有 e5/e10 与 e4/e8 两组。
- **缺口**：仓库里找不到每个音色的 `ref_audio_path` + `prompt_text`（`_tts_tmp/infer_*.yaml` 只记权重，不含参考音频）。GSV 合成必需这两项，**需要你提供**（至少给默认音色一份参考音频与文本）。

### 实现

| # | 任务 | 工时 |
|---|---|---|
| T3.1 | 契约改造：`synthesize() → { data, mime }`，路由按 mime 出、缓存按扩展名存（GSV 的 wav 免转码） | 0.5d |
| T3.2 | provider 框架：声明式 `fields` + `availability()` + 回退链 + `flavor()` 进缓存键（照 `dsh-pet-indesktop/pet/tts/base.py`） | 1.5d |
| T3.3 | edge（现有实现包成 provider） | 0.5d |
| T3.4 | **GSV 直连**：音色选择（扫描权重目录）+ 权重切换缓存 + `/tts`（ref_audio/prompt_text/语言/切分） | 1.5–2d |
| T3.5 | 云端 TTS：**只写配置骨架**（baseURL/model/voice 字段 + provider 空实现 + 明确 `unsupported` 原因） | 0.3d |
| T3.6 | 设置页自动生成控件；key 走 DSH credentials 不落盘 | 0.5d |

## 五、阶段计划

### P0 迁移与构建（1d）

| # | 任务 | 验收 |
|---|---|---|
| T0.1 | 备份现实现（`legacy` 分支 + tag） | `git tag` 可见 |
| T0.2 | 导入 v0.4.7 并构建 | `pnpm build` 成功，`lib/` 齐 |
| T0.3 | 切 profile：bundles `dsh-pet` → `dsh-fish-body`，patch `disabled: false` | 重启后 `/dsh-pet-7340/state` 200，只剩一只 |
| T0.4 | 冒烟 | 动画能播、设置页能开 |

### P1 角色包 + 人设同步（1.5d）

| # | 任务 | 验收 |
|---|---|---|
| T1.1 | `pet/main-config` 动画映射：**默认 114 包**全部归类（idle/turn/drag/clicks/moves/categories/events/sleep/baifan）+ `animationWeights` + `workStatusTexts` | 无孤立动作 |
| T1.2 | shenshen 106 作为第二个包（junction + 独立 config） | 设置页可切 |
| T1.3 | 人设同步：watcher 监听 `$DSH_HOME/fish-soul/persona.json` → 投影 → 写 `whisperPrompt` | 改卡不重启即生效 |
| T1.4 | 关掉 dsh-pet 自带 whisper 或统一 persona，避免双份模型调用 | 日志无重复 |

### P2 渲染三实现（5.5d）

| # | 任务 | 工时 |
|---|---|---|
| T2.1 | `Renderer` 接口 + 注册表 + stage 重建 | 0.5d |
| T2.2 | webm 适配器（包住现有 card 播放链路） | 0.5d |
| T2.3 | layered：渲染器 TS 化 + 皮肤扫描 + 命中区 + 口型 | 3.5d |
| T2.4 | live2d 适配器（pixi-live2d-display + 模型目录扫描 + 无模型时的明确提示） | 1.5d |
| T2.5 | 设置页：后端下拉 + 素材选择 + 即时生效 | 0.5d |

### P3 语音（4.5d）

见 §四。

### P4 屏幕识别 + 避让（4d）

| # | 任务 | 验收 |
|---|---|---|
| T4.1 | 截屏（helper `desktopCapturer` / Win32 BitBlt）→ 缩放 | 4K/150% 不出黑图 |
| T4.2 | 视觉 → 一句话 → `/whisper`；频率/静默/免打扰 | 默认关 |
| T4.3 | 避让：`GetForegroundWindow` + 全屏判定 → 隐藏/恢复；DSH 空闲；app 白名单 | 全屏时消失、退出恢复 |
| T4.4 | 设置页开关 | 三项独立 |

### P5 收尾（2d）

动画音效、`resourceDirs` 扫描、设置页整合、README/NOTICE、回滚脚本。

**合计 ≈ 18.5 人日**（不含 Tauri PoC）。

## 六、环境隔离（已执行）

- `profiles/web` 的 `dsh-pet` 已从 `dsh.profile.bundles` 移除，其桌面 helper 进程已不在；
- `dsh-pet-to-family` 及其 145MB electron 平台包已卸载；
- 目前只有 fish profile 的一只宠物（pid 109740，窗口「dsh-pet 桌宠（桌面模式）」）在跑；
- 共享目录 `D:\NodeJS\DSH\dsh-pet\`（配置/记忆/日志）现在只归 fish profile 使用。

## 七、风险与对策

| 风险 | 对策 |
|---|---|
| 构建链首次 install 需网络（tsdown/tsc 等 devDeps） | P0 单独验证；失败则退回 tarball 的 `lib/` 直接改 |
| 上游迭代快 | 补丁集“一能力一文件 + 少量挂点”，可 rebase |
| 素材许可（禁商用） | 保留 NOTICE |
| webm/layered/live2d 是不同角色 | 三实现互斥，不混播 |
| GSV 缺参考音频 | 见 §八；未配时自动回退 edge |
| live2d 无模型 | 只保证接口与加载路径，等用户放模型 |
| 屏幕识别涉及隐私 | 默认关、不落盘 |

## 八、需要你配合

1. **GSV 参考音频**：每个音色的 `ref_audio_path` + `prompt_text`（至少默认音色一份），否则 GSV 无法合成。
2. GSV 启动方式：`python api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml`？要不要我写个 `start-gsv.bat`。
3. fish-soul 里是否已有“鱼生的嗓子”对应到上面哪个音色（决定默认选哪个）。
