<#
SYNOPSIS
  Assemble a Windows "double-click" payload for DeepSeek-For-Paper-Harness.

DESCRIPTION
  Mode A (default): copy the working tree WITH build outputs (lib/, dist/)
  but WITHOUT .git / node_modules into a payload folder, add launcher.bat,
  and print remaining steps. Target machine runs setup.bat once (network),
  then start.bat.

  Mode B (-IncludeNodeModules, experimental): also copy node_modules with
  junctions skipped (/XJ) and repair workspace links by running pnpm install
  inside the payload with the portable Node on PATH. Validate on a clean VM.

EXAMPLES
  powershell -File packaging\windows\make-portable.ps1 -NodeZip C:\downloads\node-v22-win-x64.zip
  ... -MakeSfx -SevenZip "C:\Program Files\7-Zip\7z.exe"
#>
param(
  [string] $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')),
  [string] $NodeZip,
  [string] $OutputDir = '',
  [string] $SevenZip = '7z',
  [switch] $MakeSfx,
  [switch] $IncludeNodeModules
)
$ErrorActionPreference = 'Stop'
if ($OutputDir -eq '') { $OutputDir = Join-Path $RepoRoot 'dist-portable' }

$mustHave = @(
  'apps\cli\src\bin.ts',
  'apps\cli\lib\bin.js',
  'package.json'
)
foreach ($rel in $mustHave) {
  if (-not (Test-Path (Join-Path $RepoRoot $rel))) { throw "missing build output: $rel (run the root build first)" }
}

if (Test-Path $OutputDir) { Remove-Item -Recurse -Force $OutputDir }
New-Item -ItemType Directory -Path $OutputDir | Out-Null
$app = Join-Path $OutputDir "app"
New-Item -ItemType Directory -Path $app | Out-Null

$excludeDirs = @(".git", ".dph-build", "coverage", "dist-portable")
if (-not $IncludeNodeModules) { $excludeDirs += "node_modules" }
$xd = $excludeDirs | ForEach-Object { Join-Path $RepoRoot $_ }
robocopy $RepoRoot $app /E /XJ /NFL /NDL /NJH /NJS /NP /XD $xd /XF ".env" "*.tsbuildinfo" | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }

Copy-Item (Join-Path $PSScriptRoot 'launcher.bat') (Join-Path $app 'launcher.bat') -Force
Copy-Item (Join-Path $RepoRoot '.env.example') (Join-Path $app '.env.example') -Force

if ($NodeZip) {
  Write-Host "[*] extracting portable Node: $NodeZip"
  $tmp = Join-Path $OutputDir "_node-tmp"
  New-Item -ItemType Directory -Path $tmp | Out-Null
  Expand-Archive -Path $NodeZip -DestinationPath $tmp -Force
  $exe = Get-ChildItem -Recurse -Filter node.exe $tmp | Select-Object -First 1
  if (-not $exe) { throw 'node.exe not found in zip' }
  $nodeDir = Join-Path $app "node"
  New-Item -ItemType Directory -Path $nodeDir | Out-Null
  Copy-Item (Join-Path $exe.DirectoryName "*") $nodeDir -Recurse -Force
  Remove-Item -Recurse -Force $tmp
}

if ($IncludeNodeModules) {
  robocopy (Join-Path $RepoRoot 'node_modules') (Join-Path $app 'node_modules') /E /XJ /NFL /NDL /NJH /NJS /NP | Out-Null
  if ((Test-Path (Join-Path $app "node")) -and (Test-Path (Join-Path $app "pnpm-lock.yaml"))) {
    $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
    $prev = $env:PATH; $env:PATH = (Join-Path $app "node") + ";" + $prev
    Push-Location $app
    try { corepack enable 2>$null; pnpm install --offline --ignore-scripts 2>&1 | Select-Object -Last 2 }
    finally { Pop-Location; $env:PATH = $prev }
  } else { Write-Host "[!] offline repair skipped (portable node or lockfile missing)" }
}

Write-Host ''
Write-Host "[ok] payload ready: $app"
if ($MakeSfx) {
  $sfxOut = Join-Path $OutputDir "DeepSeek-For-Paper-Harness-portable.exe"
  & $SevenZip a -sfx -y $sfxOut (Join-Path $app "*") | Select-Object -Last 3
  if ($LASTEXITCODE -eq 0) { Write-Host "[ok] SFX: $sfxOut" } else { Write-Host "[!] 7z failed; see packaging/windows/README.md" }
} else {
  Write-Host ("       " + $SevenZip + " a -sfx -y DeepSeek-For-Paper-Harness-portable.exe .\dist-portable\app\*")
}
