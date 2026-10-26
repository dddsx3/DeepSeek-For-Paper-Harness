# 开源同类项目调研与借鉴/规避清单（2026-10-27）

> 调研方法：GitHub 开源、以"自动化研究/论文生成"为核心的产品。目的有二：找出值得引入的功能；
> 明确 DPH 的设计哲学相对它们的差异化优势（避免"看着别人有就抄"）。Lean 专项评估独立成篇：
> [`LEAN-ASSESSMENT.md`](./LEAN-ASSESSMENT.md)。

## 一、项目盘点

### 1. [SakanaAI/AI-Scientist](https://github.com/SakanaAI/AI-Scientist) + [AI-Scientist-v2](https://github.com/SakanaAI/AI-Scientist-v2)
**定位**：端到端自主科研（idea→实验→写作→自动评审），v2 产出首篇 ICLR workshop 全 AI 论文。
**可引入**：
- **LLM 评审 rubric 量化打分**（NeurIPS 模板式评分）——DPH 的 review 阶段目前产出缺陷列表，缺一个可跨轮对比的量化分（改进循环 G5 的终止条件可直接消费它）；
- **idea evolution（v2 的想法演化树）**——探索-择优的广度扩展参照（DPH 的 T3.5 已试过择优，诚实负结果，可借其并行探索结构重试）。
**应避免（实证教训）**：
- 独立评估（ACM 2025）：12 个提议实验 **42% 因代码错误直接失败**，跑通的结论表述仍由模型自由发挥——正是 DPH"零数字通道"要消灭的形态；
- 引文幻觉：无真实性校验机制；
- 自动评审自我偏好（自己给自己打分膨胀）；无视觉能力导致排版缺陷无法自修（DPH 的 print quality gate 是差异化优势）。

### 2. [stanford-oval/STORM](https://github.com/stanford-oval/storm)
**定位**：多视角 persona 提问 → 大纲 → 带引用的百科式长文。
**可引入**：
- **视角驱动提问**（persona 预设问题再综合）——可用于 prob-analysis 的分析广度（评审者/复算者/质疑者三类视角提问后再建模）；
- 大纲先行的两段式写作（DPH 骨架已是此形态，可借鉴其大纲-内容一致性校验）。
**应避免**：引用来自网页抓取而**非验证**——"有引用"不等于"引用真实"；训练数据偏差在多视角下仍残留。

### 3. [Future-House/paper-qa](https://github.com/Future-House/paper-qa)（PaperQA2）
**定位**：文献问答 + 引用精度机制（in-text citation 与原文对齐验证），曾复现 discoveries。
**可引入（DPH 当前最大真实缺口）**：
- **引用真实性门禁**：每条 in-text 引用回溯到来源文本做 claim↔source 对齐。DPH 现有 references 门只查格式/存在性地板（`references_method_keyword`），参考文献可以是模型编的——零数字通道管住了数字，没管住文献。若 DPH 未来接入文献检索通道，此机制应作为第九门之外的独立门。
- 代价意识：需要真实文献语料/检索 API，当前中转环境不具备——列为"有检索通道后"的远期项。

### 4. [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher)
**定位**：规划式深度研究代理（计划→并行子任务→汇总报告）。
**可引入**：研究计划显式化 + 子任务并行结构（DPH 已有 stage 切分，弱增量）。
**应避免**：结论可信度完全依赖检索质量，无执行/验证层——与 DPH 互补而非替代。

### 5. [Agent Laboratory](https://github.com/SamuelSchmidgall/AgentLaboratory)（AMD）
**定位**：分相研究工作流（文献回顾→计划→数据准备→实验→写作）+ **human co-pilot** 模式。
**可引入**：human-in-loop 暂停点设计（DPH cockpit 已有 pause/恢复，可借鉴其"每相末确认"粒度）；实验与写作严格分相。
**应避免**：实验结果不经独立验证直接进文；脚本脆弱（同类"42% 失败"模式）。

### 6. [HKUDS/AI-Researcher](https://github.com/HKUDS/AI-Researcher)
**定位**：自动 full-length 学术论文（idea→算法→writer agent 成文）。
**可引入**：writer agent 与 researcher agent 的职责切分（DPH 的模型/harness 分工更彻底，可借鉴其"算法框架设计独立于写作"的中间产物形态）。
**应避免**：同上（生成物可信度无执行验证）。

### 7. Lean 生态（[LeanDojo](https://github.com/lean-dojo/LeanDojo)、[Lean Copilot](https://github.com/lean-dojo/LeanCopilot)、[Pantograph](https://github.com/leanprover/Pantograph)、[DeepSeek-Prover-V2](https://huggingface.co/deepseek-ai/DeepSeek-Prover-V2-7B)、Goedel-Prover-V2、Seed-Prover）
**定位**：形式化定理证明（见专篇评估）。
**结论**：技术可行性 2026 年成立（开源证明器模型 + 机器接口齐全），但与 DPH 当前环境不匹配——详见 [LEAN-ASSESSMENT.md](./LEAN-ASSESSMENT.md)。

## 二、横向结论

**1. DPH 的差异化优势（保持，不许被"借鉴"稀释）**：
数字零通道 + 执行取证（capture/replay/独立审计）+ 四档诚实交付 + 评审回滚——上述所有项目
共同缺陷恰恰是"文本产出 = 成果"，DPH 是少数把"做出来"和"写出来"强制分离的系统。

**2. 对照后确认的真实缺口（按价值排序）**：
1. **引用真实性**：零数字通道管住了数字，没管住文献（引文可以是编的）——PaperQA2 机制是引入模板；
2. **评审量化分**：改进循环终止条件缺一个可对比的量化信号——AI-Scientist rubric 可借鉴；
3. **分析广度**：单题深挖强、多假设并行探索弱（T3.5 负结果后未再试）——STORM persona 提问是低成本起点。

**3. 引入纪律（PM-HANDBOOK §8 呼应）**：任何借鉴先写 TASK 任务书（目标/证据/验收判据），
过 S1 裁决再动手；**禁止因为"别人有"而引入**——每个引入必须对应 DPH 自己的一个已登记缺口。
