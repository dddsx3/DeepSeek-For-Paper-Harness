$ErrorActionPreference='Stop'
$root='D:\modex\_assets_extracted'
$outDir='D:\modex\_assets_extracted\_ieee_calibinfo'
$stage=Join-Path $outDir 'skills_staging'
if(Test-Path $stage){Remove-Item -Recurse -Force $stage}
New-Item -ItemType Directory -Path $stage -Force | Out-Null

function New-SkillDir($name){ $p=Join-Path $stage $name; New-Item -ItemType Directory -Path $p -Force | Out-Null; return $p }

# 技能集：name / 主源技能 / 合并的次技能 / 需要的 shared-scripts 资源
$skills=@(
 @{ n='01_en_manuscript_writing'; primary='skills\paper-write-nature'; mods=@('skills\paper-write','skills\paper-plan');
    shared=@('skills\shared-scripts\writing_rules.md','skills\shared-scripts\error_prevention.md') },
 @{ n='02_figure_generation'; primary='skills\nature-figure'; mods=@('skills\paper-figure');
    shared=@('skills\shared-scripts\figure_style_guide.md','skills\shared-scripts\figure_recipes_basic.md','skills\shared-scripts\figure_recipes_advanced.md','skills\shared-scripts\figure_recipes_competition.md','skills\shared-scripts\plot_utils.py','skills\shared-scripts\get_recipe.py','skills\shared-scripts\recipe_audit.py','skills\shared-scripts\fig_size_consistency_check.py','skills\shared-scripts\fig_include_size.py','skills\shared-scripts\figure_check.sh') },
 @{ n='03_schematic_diagrams'; primary='skills\paper-figure-html'; mods=@('skills\paper-figure-drawio','skills\mermaid-diagram');
    shared=@('skills\shared-scripts\drawio_rules.md','skills\shared-scripts\tikz_rules.md','skills\shared-scripts\drawio_check.py','skills\shared-scripts\tikz_check.sh') },
 @{ n='04_research_claim_audit'; primary='skills\result-to-claim'; mods=@('skills\analyze-results','skills\ablation-planner');
    shared=@('skills\shared-scripts\facts_audit.py','skills\shared-scripts\claim_code_check.py','skills\shared-scripts\cross_problem_check.py','skills\shared-scripts\paper_claim_check.py','skills\shared-scripts\logic_audit.py','skills\shared-scripts\bib_authenticity_check.py','skills\shared-scripts\data_profile.py','skills\shared-scripts\error_prevention.md') },
 @{ n='05_literature_novelty'; primary='skills\literature-review'; mods=@('skills\arxiv','skills\novelty-check');
    shared=@('skills\shared-scripts\bib_authenticity_check.py') },
 @{ n='06_latex_compile_en'; primary='skills\paper-compile'; mods=@();
    shared=@('skills\shared-scripts\compile_check.sh','skills\shared-scripts\compile_utils.sh') },
 @{ n='07_quality_review'; primary='skills\quality-check'; mods=@(); shared=@() },
 @{ n='08_editor_agent'; primary='skills\editor-agent'; mods=@(); shared=@() },
 @{ n='09_rebuttal'; primary='skills\rebuttal'; mods=@(); shared=@() }
)

$unless=@('skills-codex','skills-codex-claude-review')
foreach($s in $skills){
  $d=New-SkillDir $s.n
  # 主源 → 根
  $sp=Join-Path $root $s.primary
  Write-Output ("复制主源: {0} -> {1}" -f $s.primary,$s.n)
  Copy-Item -Path (Join-Path $sp '*') -Destination $d -Recurse -Force
  # 次源 → modules/<basename>
  if($s.mods.Count){
    $mdir=Join-Path $d 'modules'; New-Item -ItemType Directory -Path $mdir -Force|Out-Null
    foreach($m in $s.mods){
      $base=[IO.Path]::GetFileName($m)
      Copy-Item -Path (Join-Path $root $m) -Destination (Join-Path $mdir $base) -Recurse -Force
      Write-Output ("  并存次技能: {0}" -f $m)
    }
  }
  # 共享资源 → resources/
  if($s.shared.Count){
    $rdir=Join-Path $d 'resources'; New-Item -ItemType Directory -Path $rdir -Force|Out-Null
    foreach($sh in $s.shared){
      Copy-Item -Path (Join-Path $root $sh) -Destination $rdir -Recurse -Force
      Write-Output ("  内聚资源: {0}" -f $sh)
    }
  }
}

# IEEE 模板目录
$ieee=Join-Path $stage '00_ieee_templates'
New-Item -ItemType Directory -Path $ieee -Force|Out-Null
Copy-Item -Path (Join-Path $outDir 'ieee_template\bin\*') -Destination $ieee -Force
Write-Output "IEEE 模板 -> 00_ieee_templates"

# 打包
$zip=Join-Path $outDir 'skills_pack_ieee.zip'
if(Test-Path $zip){Remove-Item -Force $zip}
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
Write-Output ("ZIP: {0}  [{1:N0} B]" -f $zip,(Get-Item $zip).Length)
Write-Output "=== zip 顶层 ==="
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z=[IO.Compression.ZipFile]::OpenRead($zip)
$z.Entries | Where-Object{$_.FullName -notmatch '/'} | ForEach-Object{$_.FullName}
$directories = $z.Entries | ForEach-Object{ ($_.FullName -split '/')[0] } | Sort-Object -Unique
$z.Dispose()
$directories