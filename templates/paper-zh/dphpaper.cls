%% dphpaper.cls — DPH 中文论文模板类（自研）
%%
%% 由 DPH 论文生产链自建并维护。只提供排版能力，不含任何外部素材、商标或图形资源。
%%
%% 选项：
%%   withoutpreface  不生成封面页（默认生成）
%%   bwprint         黑白打印模式：标题/分隔线用黑而非主题色
%%
%% 提供的接口（导出器 scripts/export-pdf.py 依赖的即这些，改动须同步）：
%%   \title{...}      论文标题
%%   \tihao{...}      题号（如 A），显示在封面
%%   \maketitle       生成标题区（含封面）
%%   abstract 环境    摘要区，内部可用 \keywords{...}
%%   \keywords{...}   关键词行
%%
%% 编译：xelatex（两遍，第二遍解析目录与交叉引用）。
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{dphpaper}[2026/09/22 v1.0 DPH Chinese paper class]

% --- 选项 ---------------------------------------------------------------
\newif\ifdph@preface \dph@prefacetrue
\newif\ifdph@bw      \dph@bwfalse
\DeclareOption{withoutpreface}{\dph@prefacefalse}
\DeclareOption{bwprint}{\dph@bwtrue}
\DeclareOption*{\PassOptionsToClass{\CurrentOption}{ctexart}}
\ProcessOptions\relax

% ctexart 提供中文排版（字体、标点挤压、章节标题汉化）。
\LoadClass[zihao=-4,a4paper,UTF8]{ctexart}

% --- 页面 ---------------------------------------------------------------
\RequirePackage{geometry}
\geometry{top=2.6cm,bottom=2.6cm,left=2.6cm,right=2.6cm}
\RequirePackage{xcolor}
\RequirePackage{graphicx}
\RequirePackage{amsmath,amssymb}
% `calc` 是 pandoc 的硬依赖：它的表格列宽写成
%   p{(\linewidth - 6\tabcolsep) * \real{0.2500}}
% 而 `\real` 由 calc 提供。缺它时 xelatex 会在**表格首行**报错并停住，
% 而报错位置指向 minipage（下一行）——这个误导性的位置正是它难查的原因。
\RequirePackage{calc}
\RequirePackage{booktabs,longtable,array}
\RequirePackage{caption}
\captionsetup{font=small,labelsep=quad}
\RequirePackage{listings}
\RequirePackage{hyperref}
\hypersetup{colorlinks=false,pdfborder={0 0 0},bookmarksnumbered=true}

% 标题层级：**不自动编号**。
%
% 交付稿的章节标题自带编号（"## 1 问题重述"），若模板再加一层就会渲染成
% "一、1 问题重述"——一次真实 PDF 导出实测到的形态。两种编号叠在一起既难看也
% 让交叉引用失去意义，所以这里让 LaTeX 不编号，标题原样呈现。
\setcounter{secnumdepth}{0}
\ctexset{
  section/name={,},
  subsection/name={,},
}

% --- 题号 / 标题 ---------------------------------------------------------
\newcommand{\dph@tihao}{}
\newcommand{\tihao}[1]{\renewcommand{\dph@tihao}{#1}}

\ifdph@bw
  \newcommand{\dph@rulecolor}{black}
  \newcommand{\dph@titlecolor}{black}
\else
  \newcommand{\dph@rulecolor}{black!70}
  \newcommand{\dph@titlecolor}{black!85}
\fi

\renewcommand{\maketitle}{%
  \begin{center}%
    \ifdph@preface
      \vspace*{1.2cm}%
      {\zihao{3}\bfseries 数学建模竞赛论文\par}%
      \vspace{0.6cm}%
      {\zihao{4} 题号：\dph@tihao\par}%
      \vspace{1.2cm}%
    \fi
    {\zihao{2}\bfseries \color{\dph@titlecolor}\@title\par}%
    \vspace{0.3cm}%
    {\color{\dph@rulecolor}\hrule height 0.8pt}%
    \vspace{0.6cm}%
  \end{center}%
  \setcounter{footnote}{0}%
}

% --- 摘要 ---------------------------------------------------------------
% abstract 环境：小字号、两侧缩进，末尾接关键词行。
\renewenvironment{abstract}{%
  \par\vspace{0.4cm}%
  \begin{center}{\zihao{4}\bfseries 摘\quad 要}\end{center}%
  \begingroup\zihao{5}\setlength{\parindent}{2em}%
}{%
  \par\vspace{0.4cm}\endgroup
}

\newcommand{\dph@keywords}{}
\newcommand{\keywords}[1]{\renewcommand{\dph@keywords}{#1}}
\AtEndEnvironment{abstract}{%
  \ifx\dph@keywords\@empty\else
    \par\vspace{0.5em}%
    {\zihao{5}\noindent\textbf{关键词：}\dph@keywords\par}%
  \fi
}

% --- 列表 / 代码 --------------------------------------------------------
% pandoc 生成的 tightlist 与代码块在本类下必须能直接编译。
\providecommand{\tightlist}{\setlength{\itemsep}{0pt}\setlength{\parskip}{0pt}}
\providecommand{\pandocbounded}[1]{#1}
\providecommand{\passthrough}[1]{#1}
% pandoc 的 longtable 会 \def\LTcaptype{none}；旧版 longtable 未定义该计数器。
\makeatletter
\@ifundefined{c@none}{\newcounter{none}}{}
\makeatother

\lstset{
  basicstyle=\small\ttfamily,
  breaklines=true,
  frame=single,
  numbers=left,
  numberstyle=\tiny,
  columns=fullflexible,
  keepspaces=true,
  showstringspaces=false,
}

\endinput
