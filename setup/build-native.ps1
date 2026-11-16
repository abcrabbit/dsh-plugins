# 为 preview-popout 重建 native/electron 原生壳
#
# 背景：该插件需要一个极简 Electron 壳。它不复制运行时，而是用硬链接复用本机已安装的 DSH。
# 硬链接不能跨磁盘，所以壳建在 C: 的 %LOCALAPPDATA%\DSHPreviewShell\electron，
# 再把仓库里的 plugins\preview-popout\native\electron 做成指向它的目录联接（junction）。
# 因此 native/ 永远不进 Git 仓库，每台机器跑一次本脚本即可。
#
# 用法： powershell -ExecutionPolicy Bypass -File setup\build-native.ps1

param(
  [string]$DshExe = ''
)

$ErrorActionPreference = 'Stop'
$root      = Split-Path $PSScriptRoot -Parent
$nativeDir = Join-Path $root 'plugins\preview-popout\native'
$link      = Join-Path $nativeDir 'electron'
$shell     = Join-Path $env:LOCALAPPDATA 'DSHPreviewShell\electron'
$template  = Join-Path $PSScriptRoot 'native-app'

function Find-DshExe {
  if ($DshExe) { return $DshExe }
  if ($env:DSH_NODE_EXECUTABLE -and (Test-Path $env:DSH_NODE_EXECUTABLE)) { return $env:DSH_NODE_EXECUTABLE }
  $guess = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'
  if (Test-Path $guess) { return $guess }
  $p = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue |
       Where-Object { $_.Path } | Select-Object -First 1
  if ($p) { return $p.Path }
  throw '找不到 DSH 安装目录。请用 -DshExe 指定 "DeepSeek Harness.exe" 的完整路径。'
}

$exe = Find-DshExe
$src = Split-Path $exe -Parent
Write-Host "DSH runtime : $src"
Write-Host "shell dir   : $shell"

if (Test-Path $shell) { Remove-Item $shell -Recurse -Force }
New-Item -ItemType Directory -Force -Path $shell | Out-Null

$linked = 0
foreach ($file in Get-ChildItem $src -Recurse -File -Force) {
  $rel = $file.FullName.Substring($src.Length).TrimStart([char]92)
  if ($rel -like 'resources\*') { continue }   # 不能带原版 app.asar，否则会加载整个 DSH
  if ($rel -like 'Uninstall*') { continue }

  $dest = Join-Path $shell $rel
  $destDir = Split-Path $dest -Parent
  if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
  New-Item -ItemType HardLink -Path $dest -Target $file.FullName | Out-Null
  $linked++
}

# 插件自己的极简壳（main.js + package.json）
$appDir = Join-Path $shell 'resources\app'
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
Copy-Item (Join-Path $template 'main.js') $appDir -Force
Copy-Item (Join-Path $template 'package.json') $appDir -Force

# 把仓库里的 native\electron 换成指向壳的联接
if (Test-Path $link) {
  $item = Get-Item $link -Force
  if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    [System.IO.Directory]::Delete($link)
  } else {
    Remove-Item $link -Recurse -Force
  }
}
New-Item -ItemType Junction -Path $link -Target $shell | Out-Null

Write-Host ("done: {0} hard-linked, shell ready" -f $linked)
Write-Host '验证：在预览面板把文件标签拖出来，能弹出独立窗口即成功。'
