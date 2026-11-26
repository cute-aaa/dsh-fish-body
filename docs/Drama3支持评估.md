# Drama3 Studio 语音接入评估

## 结论

当前版本**不内置 Drama3 Studio provider**。对桌宠默认场景，继续以 GSV、edge 和
可选云端 TTS 为主；等高级本地配音需求稳定后，再决定是否增加独立 provider。

## 它是什么

[Drama3 Studio](https://github.com/nkxx188/Drama3-Studio) 是 Fish Audio Drama 3 的第三方本地
Windows WebUI/运行时封装，不是一个新的通用 TTS 协议。Studio 自己的原创代码是 MIT，
但 Fish Speech/Drama 3 的适配代码和模型权重另有许可：

- 模型卡：<https://huggingface.co/fishaudio/drama-3>
- 模型许可：Fish Audio Community License
- 官方能力说明：<https://docs.fish.audio/features/text-to-speech/drama-3>

因此「Studio 是 MIT」不等于「模型可以按 MIT 随插件再分发」。

## 和 GSV 的差异

| 维度     | GSV（GPT-SoVITS `api_v2`）                            | Drama3                                                                                        |
| -------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 插件现状 | 已接；有音色包扫描、导入、启停、缓存与回退链          | 未内置                                                                                        |
| 典型用途 | 桌宠日常说话、本地参考音色                            | 有表演指导的长句、多角色配音、有声内容                                                        |
| 表达能力 | 依赖 GSV 版本、参考音频与采样参数                     | 支持自然语言表演指令、停顿、声音事件、局部语气标签和多说话人                                  |
| 硬件成本 | 明显更低，适合作为默认本地实现                        | 35B MoE（3B 激活）；Studio 虽有低显存路径，但仍需要 NVIDIA GPU、较大内存/磁盘和更慢的首次加载 |
| 接入成本 | 当前 provider 已经完成                                | 还需要参考音频路径、逐字稿、模型选择、较长任务超时与新 UI                                     |
| 模型授权 | GPT-SoVITS 代码 MIT，但具体权重和参考音频仍需逐个确认 | 模型权重采用 Fish Audio Community License，也要单独确认                                       |

所以不应简单用“谁音质更好”做结论：**GSV 更适合默认安装，Drama3 更适合可选高级配音**。

## 当前可用的替代方式

### Fish Audio 云端 Drama3

Fish Audio 的公开 API 用 `POST /v1/tts`，通过 `model: drama-3` 请求头选择模型。
当前插件已有“云端语音四轴”能力，理论上可以由熟悉配置的用户用自定义请求模板接入；
但这仍属于高级配置，不计入“装完即可用”的本地 Drama3 支持。

### 本地 vLLM-Omni / OpenAI 兼容服务

社区存在以 `ref_audio`、`ref_text` 调用 Drama3 的本地服务。当前插件的通用 provider
只能方便地传文本、语速和不含文件的模板字段，不能管理参考录音和逐字稿，因此不能把一个
只暴露 Studio 地址的本地服务当成已支持。

已有第三方插件 [dsh-drama3-tts](https://github.com/huangzhilin-hzl/dsh-drama3-tts)
可以作为需求参考；该仓库目前未声明许可证，不能直接复制其代码。

## 将来什么条件下再做

满足以下条件时再考虑新增 provider：

1. 有稳定的本地 HTTP 协议，能显式传 `ref_audio`、`ref_text`、模型和输出格式；
2. 能接受数十秒到数分钟的首句/整个任务耗时，并有明确的取消语义；
3. 设置页能管理参考录音、逐字稿和模型目录，不把大文件塞进插件包；
4. 能在 CI 中用假服务覆盖请求与错误分类，不依赖真实 GPU；
5. 许可证边界和模型下载来源能在设置页与 NOTICE 中直接看见。

在这些条件满足前，文档只提供评估和外部说明，不承诺“本地 Drama3 已支持”。
