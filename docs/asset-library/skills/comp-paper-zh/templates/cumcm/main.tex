% 国赛 (CUMCM) 模板
% 基于 cumcmthesis 文档类
% 电子版提交使用 withoutpreface 去掉封面编号页，bwprint 黑白打印
\documentclass[withoutpreface,bwprint]{cumcmthesis}

% === 额外宏包（cumcmthesis 已内置 amsmath/graphicx/booktabs/listings/hyperref/tabularx/longtable 等）===
\usepackage[framemethod=TikZ]{mdframed}
\usepackage[section]{placeins}
\usepackage{needspace}
\usepackage{algorithm2e}

% === 参考文献引用（数字型，配合 gbt7714-numerical.bst）===
% ⛔ 不要加 \usepackage{cite} — 和 natbib 冲突导致编译错误。
% ⛔ 必须显式加载 natbib：gbt7714-numerical.bst 产出的是 natbib 风格条目
%    （\bibitem[作者(年)]{key}），不加载 natbib 时标准 \cite 会把"作者-年"当引用标记
%    上标出来（而非数字 [1]）。numbers 模式让 \cite 产出数字，cls 的 \upcite 再上标它。
%    正文引用统一用 \upcite{key} 得数字上标 $^{[1]}$。
\usepackage[numbers,sort&compress]{natbib}

% === TikZ（cumcmthesis 已加载 tikz，这里只加额外库）===
\usetikzlibrary{arrows.meta,positioning,shapes.geometric,fit,calc}

% === 代码高亮设置 ===
\lstset{
    language=Python,
    basicstyle=\small\ttfamily,
    breaklines=true,
    frame=single,
    numbers=left,
    numberstyle=\tiny,
}

% === 摘要后排版修复 ===
% ⛔ 不再重定义 \@cite —— 引用交给 natbib（上面已 numbers 模式加载），
%    \upcite 会正确产出数字上标；旧的 \@cite hack 在 natbib 下无效且会干扰，已移除。
\makeatletter
% === 修复摘要后排版（cls 的 abstract 结束时有 \newpage\null，跟目录前的 \newpage 冲突产生空白页）===
% 方案：abstract 结束时加 \newpage 确保目录另起一页，但不加 \null 避免空白页
\renewenvironment{abstract}{%
  \if@twocolumn\section*{\abstractname}%
  \else\begin{center}{\zihao{4}\bfseries \abstractname\vspace{-.5em}\vspace{\z@}}\end{center}\quotation
  \fi}{\if@twocolumn\else\endquotation\newpage\fi}
\makeatother

% === 竞赛信息（电子版提交时注释掉）===
% \tihao{A}
% \baominghao{xxxx}
% \schoolname{[学校名称]}
% \membera{[成员A]}
% \memberb{[成员B]}
% \memberc{[成员C]}
% \supervisor{[指导老师]}
% \yearinput{[竞赛年份]}
% \monthinput{[月]}
% \dayinput{[日]}

\title{[论文标题]}

\begin{document}

\maketitle

% === 摘要 ===
\begin{abstract}

[中文摘要内容：问题概述 + 每个子问题的方法和数值结果 + 结论]

\keywords{[关键词1]\quad [关键词2]\quad [关键词3]}
\end{abstract}

% === 目录（摘要结束时已自动换页，这里不需要额外 \newpage）===
\tableofcontents
\clearpage

% === 正文 ===
\input{sections/1_restatement}
\input{sections/2_analysis}
\input{sections/3_assumptions}
\input{sections/4_symbols}
\input{sections/5_problem1}
\input{sections/6_problem2}
\input{sections/7_problem3}
\input{sections/8_sensitivity}
\input{sections/9_evaluation}

% === 参考文献 ===
\begin{thebibliography}{99}
% \bibitem[1]{ref1} 作者. 标题[J]. 期刊, 年份.
\end{thebibliography}

% === 附录 ===
\begin{appendices}
\input{sections/A_code}
\end{appendices}

\end{document}
