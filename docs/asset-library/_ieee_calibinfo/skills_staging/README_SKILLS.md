# skills_pack_ieee — 单文件 SKILL.md 技能包

本包专为 agent 技能上传设计，满足硬性约束：
- 每个技能 = 一个目录，目录内**只有且仅有一个 SKILL.md**；
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
