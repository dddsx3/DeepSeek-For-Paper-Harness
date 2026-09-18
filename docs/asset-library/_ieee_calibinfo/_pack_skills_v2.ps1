$ErrorActionPreference='Stop'
$stage='D:\modex\_assets_extracted\_ieee_calibinfo\skills_staging'
$outDir='D:\modex\_assets_extracted\_ieee_calibinfo'

# 删除旧合并技能目录（含 modules/resources）
$keep=@('ieee-latex-format','en-paper-writing','figure-generation','schematic-diagrams','research-claim-audit','literature-novelty','latex-compile-en','quality-review','editor-agent','rebuttal')
Get-ChildItem $stage -Directory | ForEach-Object{ if($_.Name -notin $keep){ Remove-Item -Recurse -Force $_.FullName; Write-Output ("删除旧目录: {0}" -f $_.Name) } }

# 约束校验：每个技能目录内必须 恰好一个 SKILL.md，且不再有 modules/resources 等附加
Write-Output "`n=== 合规性校验 ==="
$bad=$false
foreach($k in $keep){
  $d=Join-Path $stage $k
  if(-not(Test-Path $d)){ Write-Output "MISS dir: $k"; $bad=$true; continue }
  $all=Get-ChildItem $d -Recurse -File
  $sk = $all | Where-Object{ $_.Name -eq 'SKILL.md' }
  if($sk.Count -ne 1){ Write-Output "违规 $k : SKILL.md 数量=$($sk.Count)"; $bad=$true }
  $extra = $all | Where-Object{ $_.Name -ne 'SKILL.md' }
  if($extra.Count -gt 0){ Write-Output "违规 $k : 存在非SKILL.md文件: $($extra.Name -join ',')"; $bad=$true }
  if(-not $bad){ Write-Output ("OK  {0}  [仅 SKILL.md，{1} B]" -f $k,(Get-Item (Join-Path $d 'SKILL.md')).Length) }
}
if($bad){ Write-Output "存在违规，停止打包"; exit 1 }

# 重建总 README（说明上传方式）
$readme=@"
# skills_pack_ieee — 单文件 SKILL.md 技能包

本包专为 agent 技能上传设计，满足硬性约束：
- 每个技能 = 一个目录，目录内**只有且仅有一个 `SKILL.md`**；
- 自包含、零外部依赖、无需改路径、上传即用；
- 每个技能只上传一份，无跨技能依赖。

## 技能列表（整目录上传，保留目录名）
- ieee-latex-format      ：IEEE 双栏排版（IEEEtran）+ 数字引用 + 格式自检
- en-paper-writing       ：英文论文写作（hourglass / reader-first）
- figure-generation      ：出版级图表（配色/尺寸/可追溯）
- schematic-diagrams     ：论文示意图 / 流程 / 架构图
- research-claim-audit   ：结果→声明审计 + 可复现/防伪审计
- literature-novelty     ：文献综述 + 引用真实核验 + 查新
- latex-compile-en       ：英文 LaTeX 编译 + 诊断
- quality-review         ：学术写作质量审查
- editor-agent           ：论文编辑器代理（协作精修）
- rebuttal               ：审稿回复（多轮）

说明：IEEEtran.cls 等官方模板不属于技能；由 latex-compile-en 提示从官方/CTAN 获取，或由编译环境自带，故不捆绑进任何 skill（遵守"无外部依赖文件"约束）。
"@
Set-Content -Path (Join-Path $stage 'README_SKILLS.md') -Value $readme -Encoding UTF8

# 打包
$zip=Join-Path $outDir 'skills_pack_ieee_SKILLmd.zip'
if(Test-Path $zip){Remove-Item -Force $zip}
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
Write-Output ("`nZIP: {0}  [{1:N0} B]" -f $zip,(Get-Item $zip).Length)

# 展示 zip 内每个技能仅一个 SKILL.md
Add-Type -AssemblyName System.IO.Compression.FileSystem
Write-Output "`n=== zip 内 SKILL.md 归属（应每个技能恰一次）==="
$z=[IO.Compression.ZipFile]::OpenRead($zip)
$z.Entries | Where-Object{$_.Name -eq 'SKILL.md'} | ForEach-Object{ $_.FullName } | Sort-Object
$z.Dispose()