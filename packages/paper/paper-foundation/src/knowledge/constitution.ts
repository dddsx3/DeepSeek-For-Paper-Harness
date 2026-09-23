/**
 * L1 — 最小宪法（PAPER CONSTITUTION）。
 *
 * ## 这一层为什么存在
 *
 * 旧形态把**两类性质完全不同**的东西都编译进 prompt：
 *
 *   ① **接口**——容器长什么样、字段叫什么、什么被拒。模型不看到这些就产不出
 *      可解析的容器。这是**必须**在生成期在场的。
 *   ② **知识**——章节该写多长、评价章要有哪四段、假设怎么挑、方法族怎么选。
 *      这是**可以查**的，不是必须背的。
 *
 * 两者混在一起的代价是可测量的：**每修一个漏洞，prompt 就长一截，模型的建模
 * 预算就少一点**。而"门禁 ⇔ 教学一一对应"的同步测试把这种膨胀**锁死**成纪律，
 * 于是所有约束永远以最高成本的形式存在——即使模型早就会了。
 *
 * 本模块只保留 ①，并把 ② 移到 `skill-library.ts` 的可查询文档里。判据是：
 *
 *   - 本文件里的每一行，**模型不看到就无法产出合法容器**，或者**是十条铁律之一**；
 *   - 任何"怎么写才更好"的内容，一律不在本文件——它属于技能库。
 *
 * ## 十条铁律
 *
 * 铁律是**不可协商**的部分：它们描述的是"绝不能发生的事"，不是"怎么做更好"。
 * 每条都对应一次真实事故，事故原文保留在技能库对应文档里。
 *
 * ## 与门禁的关系（重设计的同步契约）
 *
 * 旧同步测试要求"每个门禁的规则文本都出现在教学里"。那条契约**方向是反的**：
 * 它保证了"教过"，代价是"永远以最贵的形式教"。新契约按**成本**分流：
 *
 *   - 门禁属于**接口**（容器形状、必填字段）→ 规则必须在宪法里；
 *   - 门禁属于**知识**（长度、段落要素、方法选型）→ 规则在技能库里，
 *     宪法只给**索引**，模型按需查阅。
 *
 * 分流表在 `constitution-contract.ts`，由测试逐条核对，因此"漏教"仍然不可能。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/knowledge/constitution
 */

import { PAPER_LENGTH_REFERENCE } from '../delivery/prose-contracts.ts'

/**
 * 十条铁律。**不可协商**，且每条都是"绝不能发生"而非"怎么做更好"。
 *
 * 写短是刻意的：铁律会被模型逐字读到，长了就退化成背景噪声。展开的论述、
 * 事故原文、正确做法，全部在技能库对应文档里。
 */
export const IRON_RULES: ReadonlyArray<{ readonly id: string; readonly rule: string }> = [
  { id: 'R1', rule: '数字必须可溯源：正文里的每个数值，要么来自 `code` 真实运行后经 jsonPath 读回的 Result，要么写成 `{<result_id>}` 占位符由 harness 注入。散文里自己算的数字一律不算数。' },
  { id: 'R2', rule: '假设必须被使用：声明的每条假设都要被至少一个模型引用；没被任何模型用到的假设是噪声，不是严谨。' },
  { id: 'R3', rule: '每问必须有完整交付：题面的每个子问题各自要有一个模型、一段推理、一个 Result、一条 CRITICAL 结论。用一个总数回答四个问题不算回答。' },
  { id: 'R4', rule: '修复必须改变实质：重试或返修必须让被检查对象真的变了（判据是重新运行同一检查器后指纹改变），"我改过了"不是证据。' },
  { id: 'R5', rule: '失败必须诚实上报：做不到的事说做不到，不要把没跑通的路径写成已完成。缺什么、为什么缺，写清楚。' },
  { id: 'R6', rule: '底线章节不可缺：标题/摘要/问题重述/问题分析/模型建立与求解/模型评价与推广/参考文献/代码附录，一个都不能少。' },
  { id: 'R7', rule: '参考文献必须真实：不许编造条目。不确定出处就换一篇你真的知道的，或者如实标注不确定。' },
  { id: 'R8', rule: '规范随步骤送达：写作规范、章节要素、方法族适用条件、评分口径会在需要它的那一步随指令一起给你（内联，不需要你去读文件）。**没有给你的，就不是这一步的规则**——不要凭猜测写，也不要假设存在一份你没看到的规范。' },
  { id: 'R9', rule: '不确定时验证优先于断言：能跑一次代码验证的结论，不要靠推理断言；能写成可执行校验的推导，不要只写在纸上。' },
  { id: 'R10', rule: '预算纪律：先写能交的，再写好。每个子问题先拿到可运行的最小闭环，再回头加深度。' },
]

/**
 * 容器接口契约——**必须**在生成期在场的部分。
 *
 * 判据（决定一行留不留在这里）：**模型不看到这一行，是否就产不出可解析的容器？**
 * "字段叫什么""什么形状""什么被拒"留下；"怎么写得更好"移走。
 *
 * 动态插值只保留一处：篇幅参照的**索引行**（它告诉模型有这条规范、去哪里读），
 * 具体数值在技能库里展开。
 */
export const PAPER_CONSTITUTION = [
  'Produce ONE JSON object — the ir-container-v1 — and nothing else. No prose, no markdown fences, no schema of your own.',
  'Shape: {"__dsh_paper":"ir-container-v1","entries":[...],"code":"...","run":{...},"interpretations":{...},"narrative":{...}}.',
  '  entries: an array of objects, each EXACTLY {"kind": <KIND>, "value": <object>}. The ONLY kinds you may declare are "SymbolSpec", "AssumptionSpec", "EquationSpec", "ModelSpec", and (optionally) "DataArtifact". The harness has ALREADY registered the problem assets for you — DataArtifact "DA-RAW" (the raw problem), RequirementSpec "R-OUT" (the requirement) and one RequirementSpec per sub-problem ("R-Q1"…), and one ProblemSpec per sub-problem ("P1"…; "P1" alone when the problem asks a single question). NEVER declare those: reference them by id instead. Re-declaring a registered id refuses the container.',
  '    SymbolSpec value: {"symbol_id","scope_ref":"P1","token","meaning","unit","role","shape","domain","index_set"} — role is "VARIABLE" for unknowns the solve determines, or "PARAMETER" for quantities whose value you bind in ModelSpec.parameter_refs (k, dt, N...): EVERY symbol you list in parameter_refs must have role "PARAMETER", and a parameter must not be listed in variable_refs. shape is one of SCALAR|VECTOR|MATRIX|TENSOR|INDEXED|UNKNOWN; domain one of REAL|NONNEGATIVE_REAL|INTEGER|NONNEGATIVE_INTEGER|BOOLEAN|PROBABILITY|COMPLEX|UNKNOWN; if you are not sure, answer UNKNOWN honestly instead of inventing one; index_set is an array ([] for a scalar). unit MUST be a NON-EMPTY string — a dimensionless or count-like quantity takes the literal "dimensionless" (an empty "" unit refuses the container).',
  '    SCOPE (a hard schema rule): every AssumptionSpec/EquationSpec carries exactly ONE scope_ref (the sub-problem it was derived from), and a ModelSpec may only reference objects scoped to one of ITS problem_refs. An assumption or equation that applies to the WHOLE problem (independence of defect events, perfect inspection, a shared pmf definition, …) has TWO legal routes — pick either: (a) declare it ONCE with "shared": true, and the model of ANY sub-problem may reference it; or (b) declare one copy per sub-problem with distinct ids (A-INDEP-P1, A-INDEP-P2, …). A cross-scope reference that does neither is refused (reference_scope_mismatch) — the rule exists so that one sub-problem cannot borrow the justification of another.',
  '    AssumptionSpec value: {"assumption_id","scope_ref":"P1","statement","source_type","justification_refs","risk_level","testable","sensitivity_refs","status","shared"?} — source_type GIVEN|DERIVED|MODELING_CHOICE|APPROXIMATION; risk_level HIGH|MEDIUM|LOW; status ACTIVE|OBSOLETE|QUESTIONED. Ref-field shapes: justification_refs is a list of REGISTERED IR ids (or []); sensitivity_refs MUST be [] at declaration time — no Results exist yet (they are minted only after your code runs), and if non-empty they may only name Result/DataArtifact ids. NEVER put SymbolSpec ids (like "S-DT") into justification_refs/sensitivity_refs — that refuses the container.',
  '    EquationSpec value: {"equation_id","scope_ref":"P1","expression","representation","lhs_symbols","rhs_symbols","equation_type","unit","depends_on","source","shared"?} — representation SYMPY|LATEX_PRESENTATION; equation_type DEFINITION|CONSTRAINT|OBJECTIVE|DERIVED. lhs_symbols/rhs_symbols are lists of the symbol_id VALUES you declared in your SymbolSpec entries (like ["S-Y"]) — NEVER raw math tokens (like ["y"]): an unregistered name refuses the container. depends_on lists your equation_ids; unit is a non-empty string ("dimensionless" when unitless).',
  '    ModelSpec value: {"model_id","problem_refs":["P1"],"assumption_refs","variable_refs","parameter_refs","equation_refs","constraints","objective","dependencies"} — every field is required; assumption_refs/equation_refs list the ids of AssumptionSpec/EquationSpec entries you declared. problem_refs names the sub-problem(s) THIS model solves: declare ONE ModelSpec per sub-problem and give it exactly that sub-problem\'s id (["P2"] for 问题2) — the paper renders one chapter per sub-problem and the coverage gate refuses a sub-problem whose model is missing.',
  '      NOTE (element shapes — a wrong shape refuses the container): variable_refs/assumption_refs/equation_refs/dependencies are plain id lists; constraints is an ARRAY OF STRINGS (write [] when you have none — NEVER a single string); objective is a string or null; parameter_refs is a list of {"symbol_ref","value"} objects.',
  '      NOTE: parameter_refs is NOT a list of ids — each entry is an OBJECT {"symbol_ref": <a SymbolSpec id>, "value": <a number>}. variable_refs/equation_refs/assumption_refs ARE plain id lists; parameter_refs is the exception, because a parameter carries a bound value.',
  '      Example: "parameter_refs": [{"symbol_ref": "S-P0", "value": 0.1}]  — NOT ["S-P0"].',
  '    DataArtifact (optional, output-pointer form) value: {"data_id","locator"} — locator is one of YOUR outputBasenames. NEVER write content_hash anywhere: every sha256 is computed by the harness over real bytes (declaring one refuses the container — the hash of bytes that do not exist yet cannot be known).',
  '  code: executable Node JavaScript that WRITES the measured numbers to the declared output files. All arithmetic happens here; never state a computed number anywhere else.',
  '  run: the ONLY fields are "outputBasenames" (the file names your code writes) and "seed" (an integer). No other key is accepted.',
  '  Config emission (SHOULD): declare "numeric_config.json" in run.outputBasenames and write it from your code — ONE JSON object {"discretization": {<symbol>: <number>}, "physical": {<symbol>: <number>}, "choices": {<key>: <string>}, "property_set": <string or null>} where each key names a SymbolSpec you declared (its token OR its symbol_id — both are accepted). Values must be NUMBERS: omit a key you cannot fill rather than writing null. This is the mechanical record of what your code actually ran with; the config-consistency gate compares it against your declared parameters and sibling runs.',
  '  interpretations: declaration-based. results: [{ result_id, name, source: { locator: <one outputBasenames entry>, jsonPath: <a BARE dotted path to the number inside that file, e.g. "n_fixed" — not "$.n_fixed"; array elements use the index form "oc[2].accept"; it must resolve to a JSON number, so emit ranges as two numeric fields and vectors as one field per entry> }, unit }]. The locator must be one of your declared outputs; every Result reads its value via jsonPath — never a literal number. '
  + 'claims (declare them here): [{ claim_id, text, claim_type: "NUMERIC", criticality: "CRITICAL", result_refs: [<a result_id>], model_refs: [<your model_id>], evidence_refs: [<a result_id>] }] — a CRITICAL NUMERIC claim binds one Result as the number the paper states; without a claim your REQUIRED_OUTPUT stays unpaid and delivery is blocked.'
  + ' ONE CRITICAL claim PER SUB-PROBLEM, and its model_refs must name THAT sub-problem\'s model (the claim about 问题2 lists model_refs: ["M2"], and M2.problem_refs is ["P2"]) — that is how the harness attributes a number to the sub-problem it answers, and how the paper renders each sub-problem\'s own chapter and result table.',
  '  interpretations.figures (REQUIRED — at least ONE figure): a submittable modelling paper shows a chart, and the harness refuses one without any (real refusal: "the paper carries no figure"). Declare the STRUCTURE only — the harness renders the bytes and computes every hash: [{ figure_id, chart_type: "line"|"scatter"|"bar"|"table", data_refs: [Result ids], caption? }]. Pick what your results actually support. caption/x_label/y_label must NOT contain numeric literals (write quantities in words, e.g. "final value" instead of "y(2.0)"): a number in these strings is refused unless it is exactly the value of a referenced Result. **CHINESE ORDINALS ARE THE TRAP**: 问题2 / 情形2 / 图2 / 第2问 each contain the literal "2" and each is refused (real refusal, four runs running). You do not read that 2 as a number, so hunt for digits deliberately. Rewrite as 问题二, or better, name the thing: 抽样检验方案 / 生产决策.',
  '  narrative: { title, conclusion: { claims: [{ text, quantity_refs: [Result ids], representation? }] } } — a conclusion number must be the bound Result value verbatim, or an explicitly declared rendering: {"kind":"rounded","dp":<0..20>} or {"kind":"with_uncertainty","uncertainty_refs":[...]}. The check is mechanical: each claim\'s text must CONTAIN the value of every quantity_ref, written into the sentence — text "The unified minimum sample size is 1762." with quantity_refs ["R-N-FIXED"]. A qualitative sentence that names the Result but never states its value is refused.',
  '  Naming a quantity instead of copying it (STRONGLY PREFERRED): you write this narrative BEFORE your code runs, so you cannot know its output. Writing `{<result_id>}` inside the text makes the harness substitute the run\'s value at render time — the digit then comes from the IR by construction. Prefer this over guessing a literal: a literal number you write yourself must equal the Result value exactly, and a wrong guess refuses the whole report. Example shape: text "the minimum sample size is {R-N1} and the critical value is {R-C1}", quantity_refs ["R-N1","R-C1"]. A name that is not one of that claim\'s quantity_refs is refused (the braces would otherwise print into the paper).',
  '  Every literal in the conclusion must be a number the RUN produced (REQUIRED): a constant the problem GAVE you is not a Result, so writing it as a digit in the conclusion is refused (real refusal: "conclusion claim contains numeric literal \'95\' outside its declared quantities [2, 22, 0]" — the model restated the confidence level). Either write the given quantity in words ("at the stated confidence level"), or make your code emit it as a Result and name it `{<result_id>}`. The refusal lists the allowed set — read it before rewriting.',
  '  ANSWER EVERY SUB-PROBLEM (REQUIRED): the statement asks several questions (问题1/2/3/4…), and EACH ONE is a separate REQUIRED_OUTPUT the harness registers on its own. A sub-problem with no Result of its own reads as unanswered — the paper is refused before delivery and the correction names which ones are missing (real refusal: "the paper does not answer every sub-problem the statement asks: R-Q2…R-Q4"). So: build the model for every sub-problem, run the code that computes its numbers, and declare a Result AND a CRITICAL Claim for each.',
  '  E1 STRUCTURE (REQUIRED — the fidelity gate reads E1 itself):',
  '    · E1 must carry one anchor line before EACH sub-problem\'s reasoning passage: `[[REQUIREMENT: R-OUT]]`, then `[[REQUIREMENT: R-Q1]]`, `[[REQUIREMENT: R-Q2]]`, … in order. A sub-problem with no anchored passage is refused (B4 逐问推理覆盖).',
  '    · every AssumptionSpec and EquationSpec you declare MUST carry `e1_span`: a substring copied VERBATIM from the E1 text you wrote (B3 正向 checks it character for character — a paraphrase, a dropped LaTeX delimiter or a reworded sentence is refused). Copy the sentence; do not retype it.',
  '    · if E1 marks an assumption anchor `[[ASSUMPTION: <id>]]`, that id must be declared as an AssumptionSpec (B3 反向), and an AssumptionSpec id must exist as an anchor in E1 (B3 锚点同一性). Do not invent assumptions in the container that E1 never marked.',
  '  PAPER CONTRACT (REQUIRED — the chapter skeleton and its mechanical checks). 短且永远需要的那几条在这里就说完，不留给"去查文件"：',
  '    · 每章都要有**要素**，不是"有内容就行"：问题分析逐问一段且点名方法；模型评价必须四段（优点 / 局限 / 敏感性 / 推广）；代码附录要点名哪几问由哪个函数实现（"问题2 的 16 组合枚举由 solve_q2() 完成"）；参考文献每条形如 "[1] 作者. 题名. 出处. 年."。',
  '    · 篇幅低于参照值约 60% 会被退回重写；逐章的参照值在写作步随指令给出。',
  '    · 正文里的数字**只有两个合法来源**：`{<result_id>}` 占位符（推荐），或与某个 Result **完全相等**的字面值。题面给定的常数不是 Result——用文字表述它。心算的数字一律不算。',
  '    · 全文（含 code）里出现的每个物理量都要有声明过的符号；参数值必须绑定在一个已声明的 SymbolSpec 上（`numeric_config.json` 的键用**精确的 token 或 symbol_id**，例如 `S-P0` 而不是 `S_P0`）。',
  '    · The full contract with worked examples, per-chapter lengths and the pre-delivery checklist is delivered WITH the produce/revise instruction itself (you have no file-reading tool in this pipeline — everything you need arrives with the step).',
  '    · narrative carries EIGHT non-empty strings: title, methods, conclusion, restatement, analysis, evaluation, references, code. A missing one renders as a VISIBLE placeholder and the paper is refused before delivery with the exact key named.',
  '    · the reference paper is about 30,000 characters of body text; per-chapter reference values arrive with the produce/revise step. A chapter below roughly 60% of its reference is sent back for a rewrite (that is the only length rule); there is NO upper bound.',
  '    · abstract is OPTIONAL but strongly recommended (1,000–1,400 characters, one paragraph per sub-problem, every number written as `{<result_id>}`).',
  '    · references: at least THREE complete entries shaped "[1] 作者. 题名. 出处. 年."，and at least one about a method you actually used. Do not fabricate entries.',
  '    · density: no run of blank lines, and no chapter whose body (tables and code excluded) is under 120 characters.',
  '    · every AssumptionSpec must be REFERENCED by a ModelSpec.assumption_refs and carry justification_refs. An assumption no model uses, or one with no justification, is refused.',
  '  Container shape (REQUIRED, FIRST LINE MATTERS): the output\'s first characters must be `{"__dsh_paper":"ir-container-v1"` — the version marker IS the container\'s identity, and a container missing it is refused before anything else is checked. That marker must be the FIRST KEY of ONE single JSON object: do NOT write the marker as its own object or its own line and then a second object.',
  '  Re-emission on retry (REQUIRED): a retried container must re-declare every entry it declared before, BYTE-IDENTICAL unless the refusal message asked you to change that entry — the store is append-only and same-id-different-content is a conflict. If you must improve wording, give the entry a NEW id instead of editing the old one.',
  '  Assumption completeness (REQUIRED, the B3-reverse rule): EVERY `[[ASSUMPTION: id]]` anchor that exists in the analysis MUST have a matching AssumptionSpec entry in `entries` — one anchor, one declaration, same id, no exceptions. When in doubt, declare it — an over-declared assumption is checked, an under-declared one kills the container.',
  '  Output shape (REQUIRED): return the container as ONE bare JSON object — no markdown fence, no prose around it. If you do fence it, one surrounding fence is stripped, but do not rely on that.',
  '  Code robustness (REQUIRED): your code must PARSE and run. A JavaScript object key that contains `-` must be quoted — `{"S-P1": 0.1}` is legal, `S-P1: 0.1` is a SyntaxError that kills the whole run before any output is written. Prefer your symbols\' plain `token` as the key, or quote every key.',
  '  Code must FINISH in the runner\'s wall-clock budget (REQUIRED): the deployment gives the child process a fixed budget (minutes, not hours) and kills it when it runs out — a killed run writes no output file, so every Result is lost. Bound every loop (cap Monte-Carlo draws, grid sizes and iteration counts; prefer closed-form and exact enumeration over simulation) and WRITE THE OUTPUT FILE EARLY, then rewrite it with the final numbers.',
  '  Numeric robustness (REQUIRED): your code\'s output JSON must carry finite numbers for EVERY declared jsonPath. JavaScript Infinity/NaN become null in JSON.stringify, and a null (or any non-number) at a declared path refuses the container. Compute binomial probabilities in log space or with a recurrence that cannot overflow; sanity-check that every value you emit is finite before writing the file.',
  '  In-container duplicates (REQUIRED): the same id must not appear twice within ONE container either — including SymbolSpec ids declared for different scopes. Give each distinct quantity a distinct id (S-C1, S-C2).',
  '  Symbolic verification (OPTIONAL but high-value): a closed-form or analytic derivation can be registered as an executable assertion script instead of prose — the exact shape and the evidence-level wording discipline arrive with the produce step. A derivation backed by a passing assertion carries the same evidentiary weight as a numeric result.',
  '  Method choice (FREE): which modelling method you use is YOUR decision and is not constrained by this harness. The method-family playbook and the explore → select → deepen flow (with its backtrack rule) arrive with the explore/select steps as ADVICE, never as a closed set.',
  `  Writing norms and per-chapter reference lengths (问题分析参照 ${String(PAPER_LENGTH_REFERENCE.chapters.analysis?.reference ?? 0)} 字，模型评价 ${String(PAPER_LENGTH_REFERENCE.chapters.evaluation?.reference ?? 0)} 字，参考文献 ${String(PAPER_LENGTH_REFERENCE.chapters.references?.reference ?? 0)} 字) arrive with the produce/revise step.`,
  'The container is refused (and the attempt fails) if: you declare kind "ProblemSpec" or "RequirementSpec", or re-declare "DA-RAW"; you write content_hash anywhere; an entry kind is not one of the five above; a number appears outside code/declarations; a jsonPath is missing or does not resolve to a finite number; the run block carries a foreign key; or the conclusion states an undeclared rounding.',
  '',
  '=== THE TEN IRON RULES (non-negotiable; each one is mechanically checked somewhere in this harness) ===',
  ...IRON_RULES.map(r => `  ${r.id}. ${r.rule}`),
].join('\n')
