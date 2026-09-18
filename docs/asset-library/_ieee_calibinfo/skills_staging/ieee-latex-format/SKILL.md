---
name: ieee-latex-format
description: Compose and check a paper against the IEEE two-column publishing format (IEEEtran document class, IEEE numeric citations). Use when the target venue is "IEEE" or the user wants IEEE transactions/conference formatting, author block, or reference style. This skill is fully self-contained and requires no external template lookup beyond the agent's LaTeX toolchain.
argument-hint: [main-tex-path]
---

# IEEE 排版格式（IEEEtran）

输入：论文正文 LaTeX 文件（或 Markdown），输出符合 IEEE 双栏排版、可用 `pdflatex` 编译、引用为 IEEE 数字制。

## 0. 前提（agent 环境自带，无需另装自定义文件）
- 需要 LaTeX 发行版（TeX Live / MiKTeX）已安装；本 skill 不依赖任何仓库内文件。
- 若环境仅有 `IEEEtran.cls`（官方免费版，CTAN/IEEE 官网获取），优先用它的文档类；否则由 agent 在编译前用 `tlmgr`/发行版补齐 IEEEtran。

## 1. 版式骨架（文档类与选项）
```latex
\documentclass[conference]{IEEEtran}   % journal 类可用 [journal]
```
- 双栏由 IEEEtran 自动处理；正文用 Times 系数学字体（默认）。
- Author block：按官方格式 `\author{\IEEEauthorblockN{...}\IEEEauthorblockA{...}}` 组合姓名/机构。

## 2. 论文结构（IEEE 标准章节 + 摘要/关键词）
```
\documentclass[...]{IEEEtran}
\title{...}\author{...}\markboth{...}
\begin{abstract} ... \end{abstract}
\begin{IEEEkeywords} ... \end{IEEEkeywords}   % 或 \begin{keywords}
\section{Intro} \section{% development} ...
\begin{IEEEbiography}{...} ... \end{IEEEbiography}  % 可选作者简介，放在 \end{document} 前
```

## 3. IEEE 数字引用（引用制式）
- 用 `\cite{key}`，参考文献用 IEEEtran 官方 `.bst`（如 `IEEEtran.bst`，或发行版自带的 `IEEEtran` 样式），即数字编号，正文不出现作者年。
- 通过 `\bibliographystyle{IEEEtran}` + `\bibliography{refs}` 生成。

## 4. 格式硬性检查清单（逐条核）
- [ ] 双栏、页边距/字体为 IEEEtran 默认，不用自定义 `geometry` 改边距
- [ ] 标题/作者块齐全；摘要 ≤250 词左右、无引用无公式编号
- [ ] 关键词 3–6 个
- [ ] 图：IEEE 图宽常用 `\columnwidth` / `0.5\columnwidth` / `\textwidth`（双栏通栏图用 `span` 或两层 `figure*`）；图中字号不小于 8pt，线宽在缩小后仍清晰
- [ ] 表格用 IEEE 三线式（`\hline` 上下 + 列头），不用竖线
- [ ] 公式：`\begin{equation}...\end{equation}`、编号右对齐；正文引用 `\eqref`
- [ ] 参考文献全部为数字编号，正文引用序号正确
- [ ] 不含 Word 残留样式、不含未编译的 `\verb` 长代码块（代码进附录环境）
- [ ] 双栏微调可用 `\IEEEoverridecommandlockouts` 等保留官方宏，不用 hack

## 5. 编译验证
- 至少跑通 `pdflatex → bibtex → pdflatex ×2` 全流程，输出 PDF 无 undefined citation / overfull 黑块导致文字截断。

## 产出
- 排版合规、可编译的 IEEE LaTeX 源 + PDF；逐条给出本 skill 第 4 节检查清单的核对结果并交人工确认。