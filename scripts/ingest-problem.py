#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""题目摄取：PDF/图片 → `00-input/`（结构化文本 + 表格 + 图 + 附件清单）。

## 为什么需要它（2024B 实测的两类缺陷）

1. **表格被压平**：此前的 `problem-faithful.md` 是逐格一行的抽取结果
   （"情况\\n零配件 1\\n次品\\n率\\n购买\\n单价…"），大量空行只有几个字——
   表 1 的 6×13 结构完全丢失。模型只能靠猜。
2. **图完全没进输入**：图 1（2 道工序、8 个零配件的装配树）是**图片**，纯文本抽取
   拿不到。2024B 实测后果：阶段 2 的建模报告把输入件集合 I(v) 当抽象符号
   （"由装配拓扑决定"），**从未给出组件→半成品的具体映射**——问题 3 的决策变量
   无法正确实例化。

## 输出（写进 `00-input/`）

| 文件 | 内容 |
|---|---|
| `problem.txt` | 题面全文：正文 + **markdown 表格**（结构保留）+ 图占位与转录文本 |
| `tables.json` | 每张表的结构化数据（行列 + 单元格），供下游按键名读取 |
| `figures/` | 每张图导出为 PNG（内嵌图像原样导出；矢量图按页面区域栅格化） |
| `figures.json` | 图清单：id / 文件 / 尺寸 / 它在第几页 / 转录状态 |
| `attachments.json` | 附件清单（本脚本识别的表格与图，供阶段 1 的 consumes） |

## 表格还原的纪律

`find_tables()` 给出的是**合并单元格的物理网格**（表 1 的表头是两层：第 1 行是
"零配件1/零配件2/成品/不合格成品" 四个组，第 2 行是各自的列名）。压平成一行会
丢组名，所以本脚本**保留两层表头**：组名与列名用 `组/列` 形式合成一个列名
（`零配件1/次品率`），并把原始网格一并写进 `tables.json`。**不改数字、不猜缺失格**：
空单元格原样留空。

用法：
    python scripts/ingest-problem.py <source.pdf|图片|目录> <out-dir>
"""
from __future__ import annotations

import json
import os
import sys

import pymupdf

# 内嵌图像小于这个尺寸的多半是图标/装饰，不当成题目插图
MIN_FIGURE_PX = 120


def _cell(text: str | None) -> str:
    """单元格文本归一：换行变空格、去首尾空白（**不动内容**）。"""
    return (text or "").replace("\n", " ").strip()


def _looks_like_header_row(row: list[str]) -> bool:
    """这一行像不像列名？判据：**不含数字/百分号/货币单位**。

    2024B 实测的坑：表 2 的表头只有一行（`零配件 | 次品率 | …`），而表 1 有两层
    （组名 + 列名）。无条件吃两行会把表 2 的**第一行数据**（`1 | 10% | 2 | …`）
    当成第二层表头并**丢掉它**——数据行凭空少一行，且列名变成 `零配件/1`。
    """
    non_empty = [c for c in row if c]
    if not non_empty:
        return False
    return not any(any(ch.isdigit() for ch in c) or "%" in c for c in non_empty)


def _merge_header(rows: list[list[str]]) -> tuple[list[str], list[list[str]]]:
    """表头合成：两层（组名+列名）合成 `组/列`；只有一层就直接用它。

    判据是**第二行像不像列名**，不是"表一定有两层"——见 `_looks_like_header_row`。
    """
    if not rows:
        return [], []
    if len(rows) == 1 or not _looks_like_header_row(rows[1]):
        return rows[0], rows[1:]
    group_row, name_row = rows[0], rows[1]
    merged: list[str] = []
    last_group = ""
    for i, name in enumerate(name_row):
        group = group_row[i] if i < len(group_row) else ""
        if group:
            last_group = group
        if name and group and name != group:
            merged.append(f"{group}/{name}")
        elif name:
            merged.append(name)
        elif last_group:
            merged.append(last_group)
        else:
            merged.append(f"列{i + 1}")
    return merged, rows[2:]


def _markdown_table(header: list[str], body: list[list[str]]) -> str:
    if not header:
        return ""
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join("---" for _ in header) + " |"]
    for row in body:
        cells = [row[i] if i < len(row) else "" for i in range(len(header))]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def ingest(source: str, out_dir: str) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    fig_dir = os.path.join(out_dir, "figures")
    os.makedirs(fig_dir, exist_ok=True)

    doc = pymupdf.open(source)
    text_parts: list[str] = []
    tables_out: list[dict] = []
    figures_out: list[dict] = []
    fig_seq = 0
    table_seq = 0

    for pno in range(doc.page_count):
        page = doc[pno]
        page_no = pno + 1

        # ── 图：先导出（正文里按位置插占位）────────────────────────────────
        page_figs: list[dict] = []
        for info in page.get_images(full=True):
            xref = info[0]
            img = doc.extract_image(xref)
            if img["width"] < MIN_FIGURE_PX or img["height"] < MIN_FIGURE_PX:
                continue
            fig_seq += 1
            fid = f"fig-{fig_seq}"
            name = f"{fid}.{img['ext']}"
            with open(os.path.join(fig_dir, name), "wb") as fh:
                fh.write(img["image"])
            rec = {
                "id": fid, "file": f"figures/{name}", "page": page_no,
                "width": img["width"], "height": img["height"], "bytes": len(img["image"]),
                "kind": "embedded-image", "transcribed": False,
            }
            page_figs.append(rec)
            figures_out.append(rec)

        # ── 表格：结构保留（组名继承 + 原始网格）──────────────────────────
        page_tables: list[dict] = []
        for t in page.find_tables().tables:
            raw = [[_cell(c) for c in row] for row in t.extract()]
            header, body = _merge_header(raw)
            if not header:
                continue
            table_seq += 1
            rec = {
                "id": f"table-{table_seq}", "page": page_no,
                "header": header, "rows": body, "raw_grid": raw,
                "row_count": t.row_count, "col_count": t.col_count,
            }
            page_tables.append(rec)
            tables_out.append(rec)

        # ── 正文：用 "blocks" 保序；表格区域跳过（避免与 markdown 表重复）──
        table_rects = [pymupdf.Rect(t.bbox) for t in page.find_tables().tables]
        body_parts: list[str] = []
        for block in page.get_text("blocks"):
            x0, y0, x1, y1, btext, *_ = block
            rect = pymupdf.Rect(x0, y0, x1, y1)
            if any(rect.intersects(tr) for tr in table_rects):
                continue
            cleaned = btext.strip()
            if cleaned:
                body_parts.append(cleaned)

        page_md: list[str] = [f"## 第 {page_no} 页", ""]
        page_md.extend(body_parts)
        for rec in page_tables:
            page_md += ["", _markdown_table(rec["header"], rec["rows"])]
        for rec in page_figs:
            page_md += ["", f"![{rec['id']}]({rec['file']})",
                        f"<!-- {rec['id']} 的转录见 figures/{rec['id']}.md（摄取时由视觉模型生成） -->"]
        text_parts.append("\n\n".join(page_md))

    header_note = [
        f"<!-- 由 scripts/ingest-problem.py 从 {os.path.basename(source)} 摄取 -->",
        f"<!-- 表格 {len(tables_out)} 张、图 {len(figures_out)} 张；表格结构见 tables.json，图见 figures/ -->",
        "",
    ]
    problem_text = "\n".join(header_note) + "\n\n".join(text_parts) + "\n"
    with open(os.path.join(out_dir, "problem.txt"), "w", encoding="utf-8") as fh:
        fh.write(problem_text)
    with open(os.path.join(out_dir, "tables.json"), "w", encoding="utf-8") as fh:
        json.dump({"tables": tables_out}, fh, ensure_ascii=False, indent=2)
    with open(os.path.join(out_dir, "figures.json"), "w", encoding="utf-8") as fh:
        json.dump({"figures": figures_out}, fh, ensure_ascii=False, indent=2)
    # 阶段 1 的 consumes 里点名了 attachments.json —— 这里如实填"有哪些附件"
    with open(os.path.join(out_dir, "attachments.json"), "w", encoding="utf-8") as fh:
        json.dump({
            "source": os.path.basename(source),
            "attachment_files": [],
            "tables": [{"id": t["id"], "page": t["page"], "shape": f'{t["row_count"]}×{t["col_count"]}'} for t in tables_out],
            "figures": [{"id": f["id"], "file": f["file"], "page": f["page"]} for f in figures_out],
            "note": "表格与图由 scripts/ingest-problem.py 从题面 PDF 结构化摄取；"
                    "表格全文见 tables.json，图见 figures/（转录见同目录 .md）。",
        }, fh, ensure_ascii=False, indent=2)

    return {
        "pages": doc.page_count, "tables": len(tables_out), "figures": len(figures_out),
        "text_bytes": len(problem_text.encode("utf-8")), "out_dir": out_dir,
    }


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    result = ingest(sys.argv[1], sys.argv[2])
    print(json.dumps(result, ensure_ascii=False))
