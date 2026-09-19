#!/usr/bin/env python3
"""
W11-A3 — docx 导出（内测 MVP 的"稿子交得出去"维度）。

输入：real-run 的 report.md + figures/ 目录
输出：paper.docx（竞赛格式：A4 / 25mm 边距 / 正文宋体小四 12pt / 1.5 倍行距 /
      标题黑体 / 图以 PNG 嵌入（cairosvg 300dpi 转换）/ 题注独占行）

纪律（总书 N31）：**导出步不得修改内容**——本脚本只做 Markdown→docx 的形式
映射，不增删改任何文字、数字、公式（代码块逐字保留）。

用法：python scripts/export-docx.py <report.md> <figures-dir> <output.docx>
"""
import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

try:
    import cairosvg
except ImportError:
    cairosvg = None


def set_font(run, name_cn: str, name_en: str, size: float, bold=False):
    run.font.name = name_en
    run.font.size = Pt(size)
    run.font.bold = bold
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name_cn)


def add_body(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.line_spacing = 1.5
    p.paragraph_format.first_line_indent = Cm(0.85)
    run = p.add_run(text)
    set_font(run, "宋体", "Times New Roman", 12)
    return p


def add_heading(doc, text, level):
    p = doc.add_paragraph()
    sizes = {1: 16, 2: 14, 3: 12}
    align = WD_ALIGN_PARAGRAPH.CENTER if level == 1 else WD_ALIGN_PARAGRAPH.LEFT
    p.alignment = align
    p.paragraph_format.space_before = Pt(12)
    p.paragraph_format.space_after = Pt(6)
    run = p.add_run(text)
    set_font(run, "黑体", "Arial", sizes.get(level, 12), bold=(level <= 2))
    return p


def add_table(doc, rows):
    cells = [r.strip().strip("|").split("|") for r in rows]
    cells = [[c.strip() for c in row] for row in cells]
    ncols = max(len(r) for r in cells)
    t = doc.add_table(rows=len(cells), cols=ncols)
    t.style = "Table Grid"
    for i, row in enumerate(cells):
        for j in range(ncols):
            val = row[j] if j < len(row) else ""
            cell = t.cell(i, j)
            cell.text = ""
            run = cell.paragraphs[0].add_run(val)
            set_font(run, "宋体", "Times New Roman", 9, bold=(i == 0))
    return t


def add_image(doc, svg_path: Path, caption: str):
    png_path = svg_path.with_suffix(".png")
    if svg_path.exists() and cairosvg is not None:
        cairosvg.svg2png(url=str(svg_path), write_to=str(png_path), scale=3.0)
    if png_path.exists():
        doc.add_picture(str(png_path), width=Cm(14))
        doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = cap.add_run(caption)
    set_font(run, "宋体", "Times New Roman", 9)
    cap.paragraph_format.space_after = Pt(12)


def convert(md_path: Path, figures_dir: Path, out_path: Path):
    text = md_path.read_text(encoding="utf-8")
    lines = text.split("\n")
    doc = Document()
    # A4 + 25mm margins (竞赛规范)
    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.top_margin = sec.bottom_margin = sec.left_margin = sec.right_margin = Cm(2.5)

    i = 0
    img_count = 0
    while i < len(lines):
        line = lines[i]
        # image line: ![caption](figures/x.svg)
        m = re.match(r"^!\[([^\]]*)\]\((figures/[^)]+\.svg)\)$", line.strip())
        if m:
            caption, rel = m.group(1), m.group(2)
            svg_path = md_path.parent / rel
            add_image(doc, svg_path, caption)
            img_count += 1
            i += 1
            continue
        # table block
        if line.strip().startswith("|") and i + 1 < len(lines) and re.match(r"^\|[-\s|]+\|$", lines[i + 1].strip()):
            block = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                block.append(lines[i])
                i += 1
            rows = [r for r in block if not re.match(r"^\|[-\s|]+\|$ ", r.strip()) and not re.match(r"^\|[-| ]+\|$", r.strip())]
            add_table(doc, rows)
            doc.add_paragraph()
            continue
        # headings
        m = re.match(r"^(#{1,3})\s+(.*)$", line)
        if m:
            add_heading(doc, m.group(2).strip(), len(m.group(1)))
            i += 1
            continue
        # code fence
        if line.strip().startswith("```"):
            i += 1
            code_lines = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1
            for cl in code_lines:
                p = doc.add_paragraph()
                p.paragraph_format.line_spacing = 1.0
                p.paragraph_format.space_after = Pt(0)
                run = p.add_run(cl)
                set_font(run, "宋体", "Consolas", 9)
            continue
        # blockquote → 楷体（诚实标注/说明性引用）
        if line.strip().startswith(">"):
            p = doc.add_paragraph()
            run = p.add_run(line.strip().lstrip(">").strip())
            set_font(run, "楷体", "Times New Roman", 12)
            i += 1
            continue
        # empty line
        if line.strip() == "":
            i += 1
            continue
        # normal body (merge consecutive non-empty, non-special lines)
        add_body(doc, line.strip())
        i += 1

    doc.save(str(out_path))
    return img_count


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    md = Path(sys.argv[1])
    figdir = Path(sys.argv[2])
    out = Path(sys.argv[3])
    n = convert(md, figdir, out)
    print(f"docx written: {out} | images embedded: {n}")


if __name__ == "__main__":
    main()
