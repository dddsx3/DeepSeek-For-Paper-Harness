$ErrorActionPreference = 'Stop'
$root = 'D:\modex\_assets_extracted'
$out  = 'D:\modex\_assets_extracted\_cumcm_run\本步_skills_prompts.zip'
if (Test-Path $out) { Remove-Item -Force $out }

$rel = @(
  # --- 技能入口 SKILL.md ---
  'skills\paper-figure\SKILL.md',
  'skills\paper-figure-html\SKILL.md',
  'skills\paper-figure-drawio\SKILL.md',
  'skills\comp-review\SKILL.md',
  'skills\comp-paper-zh-docx\SKILL.md',
  # --- 国赛模板骨架（复用档案） ---
  'skills\comp-paper-zh\templates\cumcm\cumcmthesis.cls',
  'skills\comp-paper-zh\templates\cumcm\main.tex',
  # --- paper-figure-html 模板与工具 ---
  'skills\paper-figure-html\templates\tpl_roadmap.html',
  'skills\paper-figure-html\templates\tpl_flow.html',
  'skills\paper-figure-html\templates\tpl_arch.html',
  'skills\paper-figure-html\templates\tpl_framework.html',
  'skills\paper-figure-html\templates\tpl_pipeline.html',
  'skills\paper-figure-html\templates\themes.css',
  'skills\paper-figure-html\tools\html_pdf_check.py',
  # --- 图表配方与工具（shared-scripts） ---
  'skills\shared-scripts\figure_recipes_competition.md',
  'skills\shared-scripts\figure_style_guide.md',
  'skills\shared-scripts\figure_recipes_basic.md',
  'skills\shared-scripts\figure_recipes_advanced.md',
  'skills\shared-scripts\figure_recipes_empirical.md',
  'skills\shared-scripts\figure_recipes_academic.md',
  'skills\shared-scripts\figure_exemplars.md',
  'skills\shared-scripts\plot_utils.py',
  'skills\shared-scripts\get_recipe.py',
  'skills\shared-scripts\recipe_audit.py',
  'skills\shared-scripts\fig_size_consistency_check.py',
  'skills\shared-scripts\fig_include_size.py',
  'skills\shared-scripts\figure_check.sh',
  # --- 论文写作规则与审计（复核/论文阶段） ---
  'skills\shared-scripts\writing_rules.md',
  'skills\shared-scripts\writing_check.sh',
  'skills\shared-scripts\facts_audit.py',
  'skills\shared-scripts\logic_audit.py',
  'skills\shared-scripts\claim_code_check.py',
  'skills\shared-scripts\paper_claim_check.py',
  'skills\shared-scripts\cross_problem_check.py',
  'skills\shared-scripts\data_profile.py',
  'skills\shared-scripts\bib_authenticity_check.py',
  'skills\shared-scripts\stats_utils.py',
  'skills\shared-scripts\table_slim.py',
  'skills\shared-scripts\normalize_cjk_quotes.py',
  'skills\shared-scripts\ai_disclosure_rules.md',
  'skills\shared-scripts\inject_ai_disclosure.py',
  'skills\shared-scripts\error_prevention.md',
  'skills\shared-scripts\tikz_rules.md',
  'skills\shared-scripts\drawio_rules.md',
  'skills\shared-scripts\tikz_check.sh',
  # --- prompts ---
  'prompts\paper_figure_lang_zh.md',
  'prompts\docx_write_markdown.md'
)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)
$missing = @()
foreach ($r in $rel) {
  $src = Join-Path $root $r
  if (-not (Test-Path -LiteralPath $src)) { $missing += $r; continue }
  $bytes = [System.IO.File]::ReadAllBytes($src)   # 只读源文件，不修改
  $entry = $zip.CreateEntry(($r -replace '\\','/'))
  $s = $entry.Open(); $s.Write($bytes,0,$bytes.Length); $s.Close()
}
$zip.Dispose()

$n = $rel.Count - $missing.Count
Write-Output ("已打包 {0} 个文件，缺失 {1} 个，缺失清单:" -f $n, $missing.Count)
$missing | ForEach-Object { Write-Output ("  MISS " + $_) }
Write-Output ("ZIP: {0}  大小 {1:N0} B" -f $out, (Get-Item $out).Length)