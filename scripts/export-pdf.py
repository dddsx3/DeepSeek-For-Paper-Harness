#!/usr/bin/env python3
"""
W11.5 round-3 — PDF 导出：**数字资产自带的 CUMCM 论文格式模板为必选项**。

输入：real-run 的 report.md + figures/ 目录 + 模板目录（cumcmthesis.cls + main.tex）
输出：paper.pdf

路径：report.md →（pandoc 转 LaTeX 正文）→ 填入 CUMCM 模板的 main.tex →
      xelatex 两遍 → PDF。

纪律（与 docx 导出同源，N31）：**导出步不得修改内容**——只做 Markdown→LaTeX 的
形式映射，不增删改任何文字、数字、公式；代码块逐字保留（verbatim）。

模板为**必选项**：模板目录缺失、cls 缺失、或 xelatex 不可用 → 直接失败退出
（退出码 1），绝不静默降级成"没有模板的 PDF"。这是用户明确要求的口径。

用法：
  python scripts/export-pdf.py <report.md> <figures-dir> <out.pdf> [template-dir]
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DEFAULT_TEMPLATE = Path("docs/asset-library/skills/comp-paper-zh/templates/cumcm")


def die(message: str) -> None:
    print(f"PDF EXPORT REFUSED — {message}", file=sys.stderr)
    raise SystemExit(1)


def split_front_matter(md: str) -> tuple[str, str, str, str]:
    """Pull title / abstract / keywords out of the delivered markdown.

    The delivered report is a 12-section skeleton: `# title`, then `## 摘要`, then
    the chapters. The CUMCM template wants those three as \\title / abstract
    environment / \\keywords, so they are lifted out and the rest becomes the body.
    """
    lines = md.split("\n")
    title = "数学建模论文"
    for line in lines:
        m = re.match(r"^#\s+(.+)$", line.strip())
        if m:
            title = m.group(1).strip()
            break
    body_lines: list[str] = []
    abstract_lines: list[str] = []
    keywords = ""
    in_abstract = False
    for line in lines:
        stripped = line.strip()
        if re.match(r"^##\s*摘要\s*$", stripped):
            in_abstract = True
            continue
        if in_abstract and re.match(r"^#{1,6}\s+", stripped):
            in_abstract = False
        if in_abstract:
            if stripped.startswith("关键词") or stripped.startswith("**关键词"):
                keywords = re.sub(r"^\**关键词\**[:：]\s*", "", stripped)
                continue
            abstract_lines.append(line)
            continue
        if re.match(r"^#\s+", stripped):
            continue  # the title line is rendered by \title
        body_lines.append(line)
    return title, "\n".join(abstract_lines).strip(), keywords, "\n".join(body_lines).strip()


# Mathematical alphanumeric symbols (U+1D400–U+1D7FF) and a few strays that the
# problem PDF carries (𝑚, 𝑛, 𝒙…). xelatex has no glyph for them in the body font
# and reports "Missing character", so they are folded to their ASCII letters
# before conversion — the statement stays readable and the PDF has no gaps.
MATH_ALPHANUMERIC = {
    chr(0x1D400 + i): chr(ord("A") + i) for i in range(26)
}
MATH_ALPHANUMERIC.update({chr(0x1D41A + i): chr(ord("a") + i) for i in range(26)})
MATH_ALPHANUMERIC.update({chr(0x1D7CE + i): chr(ord("0") + i) for i in range(10)})
MATH_ALPHANUMERIC.update({"−": "-", "×": "x", "·": ".", "∼": "~", "∈": " in "})


def flatten_note_markers(md: str) -> str:
    """Drop the underscore wrappers around the harness's own notes.

    The delivered paper carries machine notes as `_(模型待写入)_` / `_摘要自动生成被…_`.
    pandoc's `_`-emphasis needs word boundaries, and a note whose body contains
    full-width parentheses does not parse as emphasis — the raw `_` then reaches
    LaTeX in text mode and dies with "Missing $ inserted" (the first real PDF
    export failed on exactly that line). The markers are form, not content, so
    they are removed and the note text stays verbatim.
    """
    md = re.sub(r"(?m)^_([^_" + chr(10) + r"]+)_$", r"\1", md)
    md = re.sub(r"_\(([^)]*)\)_", r"(\1)", md)
    # W11.5 round-6: an identifier inside prose (`parse_failed`, `output_refs`) puts an
    # underscore into LaTeX text mode, which dies with "Missing $ inserted" — the
    # pre-flight's E1-direct draft carries an engine code exactly like that. Escaping
    # the word-internal underscore keeps the identifier readable and the compile alive.
    out_lines = []
    in_code = False
    for line in md.split(chr(10)):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code = not in_code
            out_lines.append(line)
            continue
        if in_code or stripped.startswith("|"):
            out_lines.append(line)
            continue
        out_lines.append(re.sub(r"(?<=\w)_(?=\w)", r"\_", line))
    md = chr(10).join(out_lines)
    return md


def fold_math_alphanumerics(md: str) -> str:
    return "".join(MATH_ALPHANUMERIC.get(ch, ch) for ch in md)


def prefer_png_figures(md: str, figure_dir: Path) -> str:
    r"""Point figure references at PNG.

    pandoc turns `![](x.svg)` into `\includesvg`, which needs the svg package and
    inkscape; the delivery already carries a PNG per figure (the docx path renders
    them), so the LaTeX path uses that instead.
    """
    def swap(match: "re.Match[str]") -> str:
        path = match.group(1)
        png = Path(path).with_suffix(".png")
        if not (figure_dir / png.name).is_file():
            try:
                import cairosvg
            except ImportError:
                return match.group(0)
            cairosvg.svg2png(url=str(figure_dir / Path(path).name),
                             write_to=str(figure_dir / png.name), scale=3.0)
        return f"]({png.as_posix()})"

    return re.sub(r"\]\(([^)\s]+\.svg)\)", swap, md)


def find_tool(name: str, extra_dirs: tuple[str, ...] = ()) -> str | None:
    """Locate a tool the way a user's machine actually has it.

    `shutil.which` only sees PATH, and the winget user-scope installs
    (pandoc, MiKTeX) are frequently absent from the PATH a harness process
    inherits — the PDF step then refuses and the delivery ships without
    paper.pdf (observed in the offline pre-flight: pandoc WAS installed, at
    LOCALAPPDATA/Pandoc/pandoc.exe, and `which` still returned None).
    So: PATH first, then the well-known per-user and machine locations.
    """
    found = shutil.which(name)
    if found is not None:
        return found
    local = os.environ.get("LOCALAPPDATA", "")
    roots = [
        Path(local) / "Microsoft" / "WinGet" / "Links",
        Path(local) / "Pandoc",
        Path(local) / "Programs" / "MiKTeX" / "miktex" / "bin" / "x64",
        Path("C:/Program Files/Pandoc"),
        Path("C:/Program Files/MiKTeX/miktex/bin/x64"),
        *[Path(d) for d in extra_dirs],
    ]
    for root in roots:
        candidate = root / f"{name}.exe"
        if candidate.exists():
            return str(candidate)
        candidate = root / name
        if candidate.exists():
            return str(candidate)
    return None


def markdown_to_latex_body(md: str, figure_dir: Path) -> str:
    """pandoc does the conversion; this function only guards its presence."""
    pandoc = find_tool("pandoc")
    if pandoc is None:
        die("pandoc is required for the markdown→LaTeX step (winget install JohnMacFarlane.Pandoc)")
    prepared = prefer_png_figures(flatten_note_markers(fold_math_alphanumerics(md)), figure_dir)
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as fh:
        fh.write(prepared)
        src = fh.name
    out = subprocess.run(
        # `-yaml_metadata_block`: the delivered paper uses `---` as a horizontal
        # rule (the machine-number footer), and pandoc otherwise reads the block
        # between two rules as YAML metadata and dies on it (real failure on the
        # first real paper).
        # `-longtable`: pandoc's longtable output uses \LTcaptype (a caption-package
        # feature this MiKTeX's longtable does not provide) and dies with
        # "No counter 'none' defined". Plain tabular compiles everywhere.
        # `--no-highlight`: pandoc's default code highlighting wraps every code
        # block in egin{Shaded}, which needs the `framed`/`fvextra` packages the
        # CUMCM template does not load — xelatex then dies with "Environment
        # Shaded undefined" (real failure: the whole PDF, including the code
        # appendix, was lost). Plain verbatim compiles everywhere.
        [pandoc, src, "-f", "markdown-yaml_metadata_block", "-t", "latex",
         "--top-level-division=section", "--no-highlight"],
        capture_output=True, text=True, encoding="utf-8",
    )
    Path(src).unlink(missing_ok=True)
    if out.returncode != 0:
        die(f"pandoc failed: {out.stderr.strip()[:300]}")
    return out.stdout


def build_tex(title: str, abstract: str, keywords: str, body_tex: str, figure_dir: Path) -> str:
    """Assemble the CUMCM template's document with the paper's content."""
    # The report references `figures/<name>.png`, so the search path is the
    # PARENT of the figures directory (plus the directory itself, for a report
    # that references bare file names).
    keyword_line = f"\\keywords{{{keywords}}}" if keywords else ""
    # The template's own preamble (packages, abstract fix) is reused verbatim;
    # only the document body is ours. \graphicspath lets the figure files keep
    # the names the report already references.
    return "\n".join([
        "% 由 DPH 论文生产链生成：内容来自 report.md，模板来自数字资产 cumcm 模板",
        "\\documentclass[withoutpreface,bwprint]{cumcmthesis}",
        "\\usepackage[numbers,sort&compress]{natbib}",
        "\\usepackage{graphicx}",
        "\\usepackage{longtable,booktabs,array}",
        "\\usepackage{caption}",
        "\\usepackage{listings}",
        "\\lstset{basicstyle=\\small\\ttfamily,breaklines=true,frame=single,numbers=left,numberstyle=\\tiny}",
        # pandoc helper macros the writer assumes, plus a counter shim for the
        # longtable in this MiKTeX (pandoc emits `\def\LTcaptype{none}` and an
        # older longtable never defines that counter: "No counter 'none' defined").
        r"\makeatletter\@ifundefined{c@none}{\newcounter{none}}{}\makeatother",
        r"\providecommand{\tightlist}{\setlength{\itemsep}{0pt}\setlength{\parskip}{0pt}}",
        r"\providecommand{\pandocbounded}[1]{#1}",
        "\\captionsetup{font=small}",
        "\\title{" + title.replace("_", "\\_") + "}",
        "\\tihao{A}",
        # W11.5 round-3: without this, xelatex embeds CJK glyphs with no
        # ToUnicode map — the PDF prints correctly but its Chinese text cannot
        # be searched or copied (pdftotext returns only the digits).
        "\\XeTeXgenerateactualtext=1",
        "\\begin{document}",
        "\\maketitle",
        "\\begin{abstract}",
        abstract,
        keyword_line,
        "\\end{abstract}",
        body_tex,
        "\\end{document}",
        "",
    ])


def compile_pdf(tex: str, workdir: Path) -> Path:
    xelatex = find_tool("xelatex")
    if xelatex is None:
        die("xelatex is required (install MiKTeX/TeX Live); the CUMCM template needs it for Chinese")
    (workdir / "paper.tex").write_text(tex, encoding="utf-8")
    # Twice: the second pass resolves the TOC and cross-references.
    for attempt in (1, 2):
        run = subprocess.run(
            [xelatex, "-interaction=nonstopmode", "-halt-on-error", "paper.tex"],
            cwd=workdir, capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        if run.returncode != 0:
            log = (run.stdout or "") + (run.stderr or "")
            log_lines = log.splitlines()
            errors = [ln for ln in log_lines if ln.startswith("!") or "Error" in ln]
            tail = "\n".join(errors[-6:]).replace("\n", chr(10))
            # Diagnosability (repo doctrine: 模型可见 ⟺ 已记录): keep the generated
            # .tex plus the failing context, so the next reader sees the real line
            # instead of a one-line summary.
            kept = Path.cwd() / "pdf-export-failed.tex"
            kept.write_text(tex, encoding="utf-8")
            context = ""
            for idx, line in enumerate(log_lines):
                if line.startswith("l."):
                    context = "\n".join(log_lines[max(0, idx - 4):idx + 2]).replace("\n", chr(10))
                    break
            die("xelatex pass " + str(attempt) + " failed:" + chr(10) + tail[:600]
                + chr(10) + "--- context ---" + chr(10) + context[:600]
                + chr(10) + "(kept: " + str(kept) + ")")
    return workdir / "paper.pdf"


def main() -> None:
    if len(sys.argv) < 4:
        print("usage: python scripts/export-pdf.py <report.md> <figures-dir> <out.pdf> [template-dir]",
              file=sys.stderr)
        raise SystemExit(2)
    report = Path(sys.argv[1])
    figure_dir = Path(sys.argv[2])
    out = Path(sys.argv[3])
    template = Path(sys.argv[4]) if len(sys.argv) > 4 else DEFAULT_TEMPLATE
    # REQUIRED option: no template, no PDF.
    cls = template / "cumcmthesis.cls"
    if not cls.is_file():
        die(f"CUMCM template class not found at {cls} — the template is a REQUIRED option "
            f"(数字资产 cumcm 模板)，缺失即拒绝导出，不静默降级")
    if not report.is_file():
        die(f"report not found: {report}")

    md = report.read_text(encoding="utf-8")
    title, abstract, keywords, body_md = split_front_matter(md)
    # The abstract is lifted out verbatim and lands inside the template's
    # abstract environment, so it needs the same marker normalization as the
    # body (the first real PDF export died on a note marker that only existed
    # in the abstract).
    abstract = flatten_note_markers(abstract)
    keywords = flatten_note_markers(keywords)
    if not abstract:
        die("the paper carries no 摘要 — the CUMCM template requires one (abstract environment)")
    body_tex = markdown_to_latex_body(body_md, figure_dir)

    with tempfile.TemporaryDirectory(prefix="dph-pdf-") as tmp:
        workdir = Path(tmp)
        shutil.copy(cls, workdir / "cumcmthesis.cls")
        # The report references figures as `figures/<name>.png`, so the figures
        # travel into the build directory. A `\graphicspath` pointing at the
        # delivery dir does NOT work here: the path contains spaces, and TeX
        # tokenizes `\graphicspath` entries, so the file was never found.
        if figure_dir.is_dir():
            shutil.copytree(figure_dir, workdir / "figures", dirs_exist_ok=True)
        for extra in template.glob("*.ttf"):
            shutil.copy(extra, workdir / extra.name)
        for extra in template.glob("*.otf"):
            shutil.copy(extra, workdir / extra.name)
        tex = build_tex(title, abstract, keywords, body_tex, figure_dir)
        pdf = compile_pdf(tex, workdir)
        if not pdf.is_file() or pdf.stat().st_size < 10_000:
            die(f"compiled PDF is missing or implausibly small ({pdf.stat().st_size if pdf.is_file() else 0} bytes)")
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(pdf, out)
    print(f"PDF EXPORT OK — {out} ({out.stat().st_size} bytes, template={template})")


if __name__ == "__main__":
    main()
