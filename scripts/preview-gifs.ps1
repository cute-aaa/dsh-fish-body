<#
.SYNOPSIS
    把 assets/webm 里的透明动画转成 README 用的 GIF 预览。

.DESCRIPTION
    仓库只发布 VP9-alpha 的 webm（唯一发布格式），但 GitHub 的 README 不播 webm，
    所以预览图统一由 ffmpeg 从 webm 转出，保证「README 里看到的」就是「插件实际播的」。

    为什么 GIF 长这样：
    - GIF 的透明只有 1 位（没有半透明），所以边缘会有锯齿——这是格式限制，不是转码出错；
    - 宽度固定 160（README 里三张一排正好放得下），10 帧/秒，调色板 48 色：
      再高就没意义了（原片 640×360，缩到 160 只会更糊），再低就认不出动作；
    - `reserve_transparent=1` + `alpha_threshold=128` 是唯一能让 webm 的 alpha 通道
      变成 GIF 透底的一组参数，换成别的组合会得到黑底或白底。

.PARAMETER Width
    输出宽度（像素），缺省 160；高度按原比例算。

.PARAMETER Fps
    抽帧率，缺省 10。

.PARAMETER Only
    只转这些名字（`assets/webm` 下的文件名，不带扩展名）；缺省转内置签名清单。

.PARAMETER OutDir
    输出目录，缺省 `dsh-fish-body/assets/preview`。

.EXAMPLE
    pwsh -File scripts/preview-gifs.ps1
    pwsh -File scripts/preview-gifs.ps1 -Width 200 -Only '吃白饭','撸猫'
#>
[CmdletBinding()]
param(
    [int]$Width = 160,
    [int]$Fps = 10,
    [string[]]$Only = @(),
    [string]$OutDir = 'dsh-fish-body/assets/preview'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$webmDir = Join-Path $repo 'dsh-fish-body/assets/webm'
$outDirAbs = if ([System.IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path $repo $OutDir }

# 内置签名清单：README 里展示的那一组（webm 里的中文名 → README 用的拼音文件名）。
$signature = [ordered]@{
    '待机呼吸休闲'            = 'daiji-huxi-xiuxian'
    '东张西望'                = 'dongzhangxiwang'
    '螃蟹走路'                = 'pangxie-zoulu'
    '超大伸懒腰'              = 'chaoda-shenlanyao'
    '吹气球'                  = 'chui-qiqiu'
    '撸猫'                    = 'lu-mao'
    '吃白饭'                  = 'chi-baifan'
    '写代码'                  = 'xie-daima'
    '工作状态-思考冒泡'       = 'gongzuozhuangtai-sikao-maopao'
    '点击回应-开心跃动'       = 'dianji-huiying-kaixin-yuedong'
    '点击回应-傲娇生气'       = 'dianji-huiying-aojiao-shengqi'
    '睡觉-开始'               = 'shuijiao-kaishi'
    '睡觉-循环'               = 'shuijiao-xunhuan'
    '睡觉-起来'               = 'shuijiao-qilai'
}

$ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ffmpeg) {
    throw '找不到 ffmpeg：先装一份并放进 PATH（本脚本只用它，不引入别的依赖）'
}
if (-not (Test-Path -LiteralPath $webmDir)) { throw "找不到素材目录：$webmDir" }
New-Item -ItemType Directory -Force -Path $outDirAbs | Out-Null

$jobs = @()
if ($Only.Count -gt 0) {
    foreach ($name in $Only) {
        $slug = $signature[$name]
        if (-not $slug) { $slug = $name }
        $jobs += [pscustomobject]@{ Src = $name; Out = $slug }
    }
} else {
    foreach ($key in $signature.Keys) { $jobs += [pscustomobject]@{ Src = $key; Out = $signature[$key] } }
}

# webm（VP9 + alpha）→ GIF：先抽帧缩放，再生成带透明槽的调色板，最后抖色关掉（抖动会把透底弄脏）。
$filter = "fps=$Fps,scale=${Width}:-1:flags=lanczos,split[a][b];" +
"[a]palettegen=max_colors=48:reserve_transparent=1[p];" +
'[b][p]paletteuse=alpha_threshold=128:dither=none'

$total = 0
foreach ($job in $jobs) {
    $src = Join-Path $webmDir ("{0}.webm" -f $job.Src)
    if (-not (Test-Path -LiteralPath $src)) { Write-Warning "跳过（没有这个 webm）：$($job.Src)"; continue }
    $dst = Join-Path $outDirAbs ("{0}.gif" -f $job.Out)
    & $ffmpeg -y -loglevel error -i $src -vf $filter -loop 0 $dst
    if ($LASTEXITCODE -ne 0) { throw "转码失败：$($job.Src)" }
    $kb = [math]::Round((Get-Item -LiteralPath $dst).Length / 1KB, 1)
    $total += $kb
    Write-Output ('{0,-44} {1,7} KB' -f (Split-Path $dst -Leaf), $kb)
}
Write-Output ('---- {0} 个，合计 {1} MB → {2}' -f $jobs.Count, [math]::Round($total / 1024, 2), $outDirAbs)
