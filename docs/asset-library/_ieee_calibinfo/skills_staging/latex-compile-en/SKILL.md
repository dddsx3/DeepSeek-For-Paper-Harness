---
name: latex-compile-en
description: Compile an English/LaTeX paper to PDF with the standard pdflatex/bibtex chain and report errors, warnings, undefined citations, and page count. Use when the user says "compile the paper", "build PDF", or wants to check a LaTeX manuscript compiles. Self-contained; uses only the local LaTeX toolchain.
argument-hint: [main-tex-path]
---

# 英文 LaTeX 编译

输入：主 LaTeX 文件路径；输出：编译日志、PDF、问题报告。

## 1. 标准编译链（按序执行）
```
pdflatex -interaction=nonstopmode -file-line-error main.tex
bibtex  main        # 若用 bibliography 文件
pdflatex ...        # 重跑 ×2 以收敛引用/书签
```
- 用 `-file-line-error` 便于定位；`nonstopmode` 保证一次跑完给出全部错误而非中断干等。

## 2. 编译诊断（读完日志后给出）
- **Error**：语法/宏包/未定义命令 → 给出 file:line 与修复建议。
- **Warning**：段落过长、字体缺失、fbox 溢出 → 按影响分级列出。
- **Undefined citation/reference**：列出未解析的 `\cite` 键 → 需补 `bibtex` 或请检查引用。
- **Overfull/underfull box**：双栏尤其关注 overfull 导致文字被截断 → 建议调整换行/图宽。
- 统计**页数**（如期刊限制需报给用户）。

## 3. 宏包/字体环境核查
- 若 `IEEEtran.cls` 缺失，提示从官方/发行版补齐后再编译（本 skill 不强制下载，只报告）。
- 目标类文档采用两次/三次编译收敛；模板选项与文档类匹配。

## 4. 交付
- PDF 路径 + 编译日志摘要 + 错误/警告/未定义引用分级清单 + 修复建议；人工确认是否重跑。