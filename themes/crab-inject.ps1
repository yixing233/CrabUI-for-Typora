<#
.SYNOPSIS
    Crab 增强脚本注入器 —— 把 crab-enhance.js 注入 Typora,或还原到注入前的状态。

.DESCRIPTION
    Typora 不会自动加载 themes 目录里的 .js,必须在它的页面模板里加一行 <script>。
    本脚本对每个目标文件生成 *.crab-bak 备份,把资源清单里的脚本复制到目标同级目录,
    再在 </body> 前逐个插入引用。缺失的资源只警告并跳过。
    改动的是 Typora 安装目录(一般在 Program Files),
    因此需要管理员权限,脚本会自动提权。

.EXAMPLE
    .\crab-inject.ps1
    只查看当前状态,不做任何修改。

.EXAMPLE
    .\crab-inject.ps1 -Inject
    注入(自动提权)。完全退出并重启 Typora 后生效。

.EXAMPLE
    .\crab-inject.ps1 -Restore
    用 *.crab-bak 还原,并删除复制过去的 crab-enhance.js。

.EXAMPLE
    .\crab-inject.ps1 -Inject -TyporaDir 'D:\Program Files\Typora'
    手动指定 Typora 安装目录。

.EXAMPLE
    .\crab-inject.ps1 -Inject -SourceDir 'D:\repo\themes'
    所有资源都从指定目录取(-SourceJs 只覆盖 crab-enhance.js 的来源路径)。
#>
[CmdletBinding()]
param(
    [switch]$Inject,
    [switch]$Restore,
    [string]$TyporaDir,
    [string]$SourceJs,
    [string]$SourceDir
)

$ErrorActionPreference = 'Stop'
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
# 要注入的资源清单,数组顺序即页面里的插入顺序
$Assets = @('crab-enhance.js')

function Get-Tag {
    param([string]$Name)
    return "<script src='./$Name'></script>"
}

function Get-AssetLabel {
    # crab-enhance.js -> enhance,只用于状态输出的短标签
    param([string]$Name)
    return ($Name -replace '^crab-', '' -replace '\.js$', '')
}

function Find-TyporaDir {
    param([string]$Hint)
    if ($Hint) {
        if (Test-Path (Join-Path $Hint 'Typora.exe')) { return $Hint.TrimEnd('\') }
        throw "指定的目录里没有 Typora.exe: $Hint"
    }
    $keys = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($k in $keys) {
        $hit = Get-ItemProperty $k -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -like '*Typora*' -and $_.InstallLocation } |
            Select-Object -First 1
        if ($hit -and (Test-Path (Join-Path $hit.InstallLocation 'Typora.exe'))) {
            return $hit.InstallLocation.TrimEnd('\')
        }
    }
    $cands = @()
    foreach ($d in 'C', 'D', 'E', 'F') { $cands += "${d}:\Program Files\Typora"; $cands += "${d}:\Program Files (x86)\Typora" }
    $cands += "$env:LOCALAPPDATA\Programs\Typora"
    foreach ($c in $cands) { if (Test-Path (Join-Path $c 'Typora.exe')) { return $c } }
    throw '没找到 Typora 安装目录,请用 -TyporaDir 指定。'
}
function Get-Targets {
    param([string]$Root)
    $rel = @(
        'resources\window.html',
        'resources\page-dist\index.html',
        'resources\page-dist\setting.html',
        'resources\page-dist\local-setting.html',
        'resources\app\src\window\index.html'
    )
    $out = @()
    foreach ($r in $rel) { $p = Join-Path $Root $r; if (Test-Path $p) { $out += $p } }
    if (-not $out) { throw "在 $Root 里没找到可注入的页面模板(window.html / page-dist\*.html)。" }
    # 逗号前缀阻止 return 把单元素数组解包成字符串,否则 $Targets[0] 会取到路径首字符
    return , [string[]]$out
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-Writable {
    param([string]$Path)
    try {
        $s = [System.IO.File]::Open($Path, 'Open', 'ReadWrite', 'None')
        $s.Close()
        return $true
    }
    catch { return $false }
}

function Invoke-Elevated {
    $a = @('-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'))
    if ($Inject) { $a += '-Inject' }
    if ($Restore) { $a += '-Restore' }
    if ($TyporaDir) { $a += @('-TyporaDir', ('"' + $TyporaDir + '"')) }
    if ($SourceJs) { $a += @('-SourceJs', ('"' + $SourceJs + '"')) }
    if ($SourceDir) { $a += @('-SourceDir', ('"' + $SourceDir + '"')) }
    Write-Host '需要管理员权限,正在请求提权...' -ForegroundColor Yellow
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $a
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Text)
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Show-Status {
    param([string[]]$Targets)
    Write-Host '当前状态:' -ForegroundColor Cyan
    foreach ($t in $Targets) {
        $txt = Get-Content -LiteralPath $t -Raw
        $dir = Split-Path -Parent $t
        $cols = @()
        foreach ($name in $Assets) {
            $inj = if ($txt -match [regex]::Escape($name)) { '是' } else { '否' }
            $file = if (Test-Path (Join-Path $dir $name)) { '有' } else { '无' }
            $cell = '{0}=注入{1}/文件{2}' -f (Get-AssetLabel $name), $inj, $file
            $cols += '{0,-20}' -f $cell
        }
        $bak = if (Test-Path "$t.crab-bak") { '有' } else { '无' }
        $label = '{0}\{1}' -f (Split-Path -Leaf (Split-Path -Parent $t)), (Split-Path -Leaf $t)
        '  {0,-34} {1} 备份={2}' -f $label, ($cols -join ' '), $bak
    }
}
function Invoke-Inject {
    param([string[]]$Targets, [object[]]$Sources)
    # 先筛掉缺失的资源:少放一个也不影响其余资源注入
    $ready = @()
    foreach ($s in $Sources) {
        if (Test-Path $s.Path) { $ready += $s }
        else { Write-Host "  找不到资源,跳过: $($s.Name)($($s.Path))" -ForegroundColor Yellow }
    }
    foreach ($t in $Targets) {
        $dir = Split-Path -Parent $t
        if (-not (Test-Path "$t.crab-bak")) { Copy-Item -LiteralPath $t -Destination "$t.crab-bak" }
        $txt = Get-Content -LiteralPath $t -Raw
        $tags = @()
        foreach ($s in $ready) {
            Copy-Item -LiteralPath $s.Path -Destination (Join-Path $dir $s.Name) -Force
            if ($txt -match [regex]::Escape($s.Name)) {
                Write-Host "  已注入过,跳过: $($s.Name) @ $t" -ForegroundColor DarkGray
                continue
            }
            $tags += (Get-Tag $s.Name)
        }
        if (-not $tags) { continue }
        $i = $txt.LastIndexOf('</body>')
        if ($i -lt 0) { Write-Warning "  没有 </body>,跳过: $t"; continue }
        # 多个标签一次写回,顺序与 $Assets 一致
        Write-Utf8NoBom $t ($txt.Substring(0, $i) + ($tags -join '') + $txt.Substring($i))
        Write-Host "  已注入 $($tags.Count) 个脚本: $t" -ForegroundColor Green
    }
}

function Invoke-Restore {
    param([string[]]$Targets)
    foreach ($t in $Targets) {
        if (Test-Path "$t.crab-bak") {
            Copy-Item -LiteralPath "$t.crab-bak" -Destination $t -Force
            Remove-Item -LiteralPath "$t.crab-bak" -Force
            Write-Host "  已用备份还原: $t" -ForegroundColor Green
        }
        else {
            $txt = Get-Content -LiteralPath $t -Raw
            $new = $txt
            foreach ($name in $Assets) {
                $pat = '\s*<script[^>]*{0}[^>]*>\s*</script>' -f [regex]::Escape($name)
                $new = [regex]::Replace($new, $pat, '')
            }
            if ($new -ne $txt) {
                Write-Utf8NoBom $t $new
                Write-Host "  无备份,已移除注入行: $t" -ForegroundColor Yellow
            }
            else { Write-Host "  未注入,跳过: $t" -ForegroundColor DarkGray }
        }
        foreach ($name in $Assets) {
            $js = Join-Path (Split-Path -Parent $t) $name
            if (Test-Path $js) { Remove-Item -LiteralPath $js -Force }
        }
    }
}

$Root = Find-TyporaDir -Hint $TyporaDir
$Targets = Get-Targets -Root $Root
# -SourceDir 给定时所有资源都从该目录取;-SourceJs 仍只指定 crab-enhance.js 的来源
$SrcDir = if ($SourceDir) { $SourceDir.TrimEnd('\') } else { $ScriptDir }
$Sources = @()
foreach ($name in $Assets) {
    $p = if ($SourceJs -and $name -eq 'crab-enhance.js') { $SourceJs } else { Join-Path $SrcDir $name }
    $Sources += [pscustomobject]@{ Name = $name; Path = $p }
}
Write-Host "Typora 安装目录: $Root"

if ($Inject -or $Restore) {
    if (-not (Test-Admin) -and -not (Test-Writable $Targets[0])) { Invoke-Elevated; return }
    if (Get-Process -Name Typora -ErrorAction SilentlyContinue) {
        Write-Warning 'Typora 正在运行 —— 需要完全退出并重启才会生效。'
    }
    if ($Inject) {
        if (-not ($Sources | Where-Object { Test-Path $_.Path })) {
            throw "在 $SrcDir 里找不到任何待注入的资源($($Assets -join ', '),可用 -SourceDir/-SourceJs 指定)"
        }
        Invoke-Inject -Targets $Targets -Sources $Sources
    }
    else { Invoke-Restore -Targets $Targets }
    Write-Host ''
}

Show-Status -Targets $Targets
if (-not ($Inject -or $Restore)) { Write-Host "`n-Inject 注入,-Restore 还原。" -ForegroundColor Cyan }
