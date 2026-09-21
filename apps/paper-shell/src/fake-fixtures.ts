/**
 * W11.5 round-7 — the offline pre-flight's fixtures (`--fake`).
 *
 * 这三份夹具的作用是让**整条交付链在零 token 下走完**，从而在花掉任何一次真实
 * 产出机会之前，先看到"真正会交付什么形态的论文"。它们必须与真实运行的契约
 * 同步，否则预检就变成了自我安慰：
 *
 *   - `FAKE_E1` 按 `[[REQUIREMENT: R-Qn]]` 逐问写推理段，并带
 *     `[[ASSUMPTION: ASM-n]]` 锚点 —— B4（逐问覆盖）与 B3（锚点同一性）都读它；
 *   - `FAKE_CONTAINER` 每个子问题**一个 ModelSpec**（`problem_refs: ["Pn"]`），
 *     每个子问题**一条 CRITICAL claim** —— 逐问章与 requirement_coverage 都按这个
 *     引用链归属（Result.run_ref → RunArtifact.model_ref → ModelSpec.problem_refs）；
 *   - `narrative` 的每一章都写到软下限之上（问题分析/评价/参考文献/代码附录），
 *     否则预检会被 prose_contract 拒，而真实运行也会被同一个门拒。
 *
 * 题目口径对齐 bench 里的 2024-B（抽样检测与生产决策），这样预检产出的稿子
 * 可以**直接肉眼对齐参照物**，而不是拿一份与题面无关的假文来看排版。
 *
 * @module paper-shell/fake-fixtures
 */

const NL = String.fromCharCode(10)

/** The T3 fill-in payload the fake provider serves (deterministic, legal). */
export const FAKE_T3_FILL = JSON.stringify({
  symbol_id: 'SYM-n',
  unit: '件',
  output_file: 'result.json',
  json_path: 'n1',
})

/**
 * The offline pre-flight's E1 analysis.
 *
 * 逐问推理段 + 假设锚点，且每个后续 e1_span 都能在这里找到**逐字**出处。
 */
export const FAKE_E1 = [
  '[[REQUIREMENT: R-OUT]]',
  '本文为某企业设计零配件与成品的抽样检测方案，并在检测与拆解之间给出成本最优的生产决策，所有结论都由可复算的计算过程给出。',
  '[[ASSUMPTION: ASM-1]] 假设批次内次品率恒定，因此单批的接收概率只由样本量与拒收临界值决定。',
  '[[ASSUMPTION: ASM-2]] 检测与拆解的成本可核算，且两者互不重叠。',
  '[[ASSUMPTION: ASM-3]] 多工序的装配结构是一棵树，节点之间的次品率传递彼此独立。',
  '[[ASSUMPTION: ASM-4]] 抽样检测得到的次品率带有抽样误差，可用后验分布刻画。',
  '[[REQUIREMENT: R-Q1]] 问题1：最小样本量与拒收临界值',
  '问题1 归到假设检验：在给定标称次品率与两类风险上界下，反解最小样本量与拒收临界值，难点是离散搜索与风险口径的对齐。',
  '[[REQUIREMENT: R-Q2]] 问题2：检测与拆解的期望成本比较',
  '问题2 归到期望成本最小化：把检测成本、拆解成本与次品流入下游的损失写成期望值，逐策略枚举取最优，难点是成本口径的可复算性。',
  '[[REQUIREMENT: R-Q3]] 问题3：多工序装配的树状成本聚合',
  '问题3 把结论推广到多工序装配结构，用树状节点的期望成本聚合递推，难点是节点之间的次品率传递。',
  '[[REQUIREMENT: R-Q4]] 问题4：抽样误差下的稳健决策',
  '问题4 考虑抽样误差，用后验分布替代点估计重算决策，得到稳健的最优策略与风险区间。',
].join(NL)

/** The offline pre-flight's EXECUTE answer: a real, per-sub-problem container. */
export const FAKE_CONTAINER = JSON.stringify({
  __dsh_paper: 'ir-container-v1',
  entries: [
    // ---- 问题1：假设检验 ----
    { kind: 'SymbolSpec', value: { symbol_id: 'S-N1', scope_ref: 'P1', token: 'n', meaning: '最小样本量', unit: '件', role: 'VARIABLE', shape: 'SCALAR', domain: 'NONNEGATIVE_INTEGER', index_set: [] } },
    { kind: 'SymbolSpec', value: { symbol_id: 'S-C1', scope_ref: 'P1', token: 'c', meaning: '拒收临界值', unit: '件', role: 'VARIABLE', shape: 'SCALAR', domain: 'NONNEGATIVE_INTEGER', index_set: [] } },
    { kind: 'AssumptionSpec', value: { assumption_id: 'ASM-1', scope_ref: 'P1', statement: '批次内次品率恒定', source_type: 'MODELING_CHOICE', justification_refs: ['R-Q1'], risk_level: 'MEDIUM', testable: true, sensitivity_refs: [], status: 'ACTIVE', e1_span: '假设批次内次品率恒定，因此单批的接收概率只由样本量与拒收临界值决定' } },
    { kind: 'EquationSpec', value: { equation_id: 'EQ-1', scope_ref: 'P1', expression: 'P_accept = B(c; n, p0)', representation: 'SYMPY', lhs_symbols: ['S-C1'], rhs_symbols: ['S-N1'], equation_type: 'DEFINITION', unit: 'dimensionless', depends_on: [], source: 'fake-container', e1_span: '反解最小样本量与拒收临界值，难点是离散搜索与风险口径的对齐' } },
    { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumption_refs: ['ASM-1'], variable_refs: ['S-N1', 'S-C1'], parameter_refs: [], equation_refs: ['EQ-1'], constraints: ['两类风险上界必须同时满足'], objective: '在风险上界内取最小样本量', dependencies: [] } },
    // ---- 问题2：期望成本最小化 ----
    { kind: 'SymbolSpec', value: { symbol_id: 'S-C2', scope_ref: 'P2', token: 'E_C', meaning: '单批期望成本', unit: '元', role: 'VARIABLE', shape: 'SCALAR', domain: 'REAL', index_set: [] } },
    { kind: 'AssumptionSpec', value: { assumption_id: 'ASM-2', scope_ref: 'P2', statement: '检测与拆解成本可核算', source_type: 'MODELING_CHOICE', justification_refs: ['R-Q2'], risk_level: 'MEDIUM', testable: true, sensitivity_refs: [], status: 'ACTIVE', e1_span: '检测与拆解的成本可核算，且两者互不重叠' } },
    { kind: 'EquationSpec', value: { equation_id: 'EQ-2', scope_ref: 'P2', expression: 'E_C = C_test * n + p * C_disassemble', representation: 'SYMPY', lhs_symbols: ['S-C2'], rhs_symbols: [], equation_type: 'OBJECTIVE', unit: '元', depends_on: ['EQ-1'], source: 'fake-container', e1_span: '把检测成本、拆解成本与次品流入下游的损失写成期望值' } },
    { kind: 'ModelSpec', value: { model_id: 'M2', problem_refs: ['P2'], assumption_refs: ['ASM-2'], variable_refs: ['S-C2'], parameter_refs: [], equation_refs: ['EQ-2'], constraints: [], objective: '期望成本最小', dependencies: ['M1'] } },
    // ---- 问题3：多工序推广 ----
    { kind: 'SymbolSpec', value: { symbol_id: 'S-C3', scope_ref: 'P3', token: 'C_node', meaning: '树状装配的节点期望成本', unit: '元', role: 'VARIABLE', shape: 'SCALAR', domain: 'REAL', index_set: [] } },
    { kind: 'AssumptionSpec', value: { assumption_id: 'ASM-3', scope_ref: 'P3', statement: '装配结构是一棵树', source_type: 'MODELING_CHOICE', justification_refs: ['R-Q3'], risk_level: 'MEDIUM', testable: true, sensitivity_refs: [], status: 'ACTIVE', e1_span: '多工序的装配结构是一棵树，节点之间的次品率传递彼此独立' } },
    { kind: 'EquationSpec', value: { equation_id: 'EQ-3', scope_ref: 'P3', expression: 'C_node = C_left + C_right + C_join', representation: 'SYMPY', lhs_symbols: ['S-C3'], rhs_symbols: [], equation_type: 'DERIVED', unit: '元', depends_on: ['EQ-2'], source: 'fake-container', e1_span: '用树状节点的期望成本聚合递推，难点是节点之间的次品率传递' } },
    { kind: 'ModelSpec', value: { model_id: 'M3', problem_refs: ['P3'], assumption_refs: ['ASM-3'], variable_refs: ['S-C3'], parameter_refs: [], equation_refs: ['EQ-3'], constraints: [], objective: '整树期望成本最小', dependencies: ['M2'] } },
    // ---- 问题4：抽样误差 ----
    { kind: 'SymbolSpec', value: { symbol_id: 'S-C4', scope_ref: 'P4', token: 'E_C_post', meaning: '后验期望成本', unit: '元', role: 'VARIABLE', shape: 'SCALAR', domain: 'REAL', index_set: [] } },
    { kind: 'AssumptionSpec', value: { assumption_id: 'ASM-4', scope_ref: 'P4', statement: '次品率带有抽样误差', source_type: 'MODELING_CHOICE', justification_refs: ['R-Q4'], risk_level: 'MEDIUM', testable: true, sensitivity_refs: [], status: 'ACTIVE', e1_span: '抽样检测得到的次品率带有抽样误差，可用后验分布刻画' } },
    { kind: 'EquationSpec', value: { equation_id: 'EQ-4', scope_ref: 'P4', expression: 'E_C_post = integral(E_C, d_posterior)', representation: 'SYMPY', lhs_symbols: ['S-C4'], rhs_symbols: [], equation_type: 'OBJECTIVE', unit: '元', depends_on: ['EQ-2'], source: 'fake-container', e1_span: '用后验分布替代点估计重算决策，得到稳健的最优策略与风险区间' } },
    { kind: 'ModelSpec', value: { model_id: 'M4', problem_refs: ['P4'], assumption_refs: ['ASM-4'], variable_refs: ['S-C4'], parameter_refs: [], equation_refs: ['EQ-4'], constraints: [], objective: '后验期望成本最小', dependencies: ['M2'] } },
  ],
  code: [
    'const fs = require("node:fs");',
    '// 问题1：精确二项、风险上界反解最小样本量与临界值',
    'function binomCdf(k, n, p) { let c = 1, s = 0; for (let i = 0; i <= k; i += 1) { if (i > 0) c = c * (n - i + 1) / i; s += c * Math.pow(p, i) * Math.pow(1 - p, n - i); } return s; }',
    'const p0 = 0.1, alpha = 0.05;',
    'let n1 = 1;',
    'while (n1 < 5000) { const c = Math.ceil(n1 * p0); if (1 - binomCdf(c - 1, n1, p0) <= alpha) break; n1 += 1; }',
    'const c1 = Math.ceil(n1 * p0);',
    '// 问题2：期望成本最小的策略（检测 vs 拆解）',
    'const C_test = 2, C_dis = 8, C_pen = 20;',
    'const detect = C_test * n1 + p0 * C_dis;',
    'const discard = C_test * n1 + p0 * C_pen;',
    'const cost2 = Math.round(Math.min(detect, discard) * 1000) / 1000;',
    '// 问题3：两工序树状聚合',
    'const cost3 = Math.round((2 * C_test * n1 + C_dis) * 1000) / 1000;',
    '// 问题4：抽样误差下的稳健成本（后验均值替代点估计）',
    'const cost4 = Math.round(detect * 1.05 * 1000) / 1000;',
    'fs.writeFileSync("result.json", JSON.stringify({ n1, c1, cost2, cost3, cost4 }));',
    'console.log("run ok");',
  ].join(NL),
  run: { outputBasenames: ['result.json'], seed: 20260903 },
  interpretations: {
    results: [
      { result_id: 'RES-N1', name: '问题1 最小样本量', source: { locator: 'result.json', jsonPath: 'n1' }, unit: '件', uncertainty: null },
      { result_id: 'RES-C1', name: '问题1 拒收临界值', source: { locator: 'result.json', jsonPath: 'c1' }, unit: '件', uncertainty: null },
      { result_id: 'RES-C2', name: '问题2 最优期望成本', source: { locator: 'result.json', jsonPath: 'cost2' }, unit: '元', uncertainty: null },
      { result_id: 'RES-C3', name: '问题3 整树期望成本', source: { locator: 'result.json', jsonPath: 'cost3' }, unit: '元', uncertainty: null },
      { result_id: 'RES-C4', name: '问题4 后验稳健成本', source: { locator: 'result.json', jsonPath: 'cost4' }, unit: '元', uncertainty: null },
    ],
    claims: [
      { claim_id: 'C-1', text: '问题1 的最小样本量与拒收临界值由精确二项风险上界反解得到。', claim_type: 'NUMERIC', criticality: 'CRITICAL', result_refs: ['RES-N1', 'RES-C1'], model_refs: ['M1'], evidence_refs: ['RES-N1', 'RES-C1'] },
      { claim_id: 'C-2', text: '问题2 的最优策略是检测后拆解，其期望成本为 {RES-C2} 元。', claim_type: 'NUMERIC', criticality: 'CRITICAL', result_refs: ['RES-C2'], model_refs: ['M2'], evidence_refs: ['RES-C2'] },
      { claim_id: 'C-3', text: '问题3 的两工序树状装配期望成本为 {RES-C3} 元。', claim_type: 'NUMERIC', criticality: 'CRITICAL', result_refs: ['RES-C3'], model_refs: ['M3'], evidence_refs: ['RES-C3'] },
      { claim_id: 'C-4', text: '问题4 在抽样误差下把点估计换成后验均值，稳健成本为 {RES-C4} 元。', claim_type: 'NUMERIC', criticality: 'CRITICAL', result_refs: ['RES-C4'], model_refs: ['M4'], evidence_refs: ['RES-C4'] },
    ],
    figures: [
      { figure_id: 'F-COST', chart_type: 'table', data_refs: ['RES-C2', 'RES-C3', 'RES-C4'], caption: '各问的期望成本对照' },
    ],
  },
  narrative: {
    title: '零配件抽样检测与生产决策（离线预检稿）',
    conclusion: {
      claims: [
        { text: '问题1 在两类风险上界内取到最小样本量 {RES-N1} 件，对应拒收临界值 {RES-C1} 件。', quantity_refs: ['RES-N1', 'RES-C1'] },
        { text: '问题2 的最优策略期望成本为 {RES-C2} 元。', quantity_refs: ['RES-C2'] },
        { text: '问题3 的整树期望成本为 {RES-C3} 元。', quantity_refs: ['RES-C3'] },
        { text: '问题4 的稳健成本为 {RES-C4} 元。', quantity_refs: ['RES-C4'] },
      ],
    },
    abstract: [
      '本文研究生产过程中的抽样检测与生产决策问题：企业需要对零配件与成品安排检测，并在检测、拆解与直接使用之间做出成本最优的选择。',
      '针对问题1，本文在给定标称次品率与两类风险上界的条件下，用精确二项分布反解检测方案，得到最小样本量 {RES-N1} 件与相应的拒收临界值 {RES-C1} 件；难点在于样本量与临界值都是整数，可行域离散，且两端的风险必须定义在同一套接收概率上。',
      '针对问题2，本文把检测成本、拆解成本与次品流入下游的损失写进同一个期望成本表达式，逐策略枚举比较，得到最优策略的期望成本 {RES-C2} 元。',
      '针对问题3，本文把单节点的成本比较推广到多工序的装配树，按父子关系由叶向根递推聚合，得到整树期望成本 {RES-C3} 元。',
      '针对问题4，本文承认抽样本身带来的误差，把次品率的点估计换成后验分布重算决策，得到稳健成本 {RES-C4} 元，并说明抽样波动会把结论推动多少。',
      '四个子问题共用同一组符号与同一条成本口径，因此四问的结论可以互相校核：问题2 的最优策略落在问题1 给出的可行方案内，问题3 的整树成本在单节点情形下退化回问题2 的数值，问题4 的稳健值把问题2 的结果包在区间内。模型的局限在于假设批次内次品率恒定且检测无误差；推广方向是把风险上界替换为代价函数，并把装配树换成一般的有向无环结构。',
    ].join(NL),
    restatement: [
      '本题来自生产过程中的抽样检测与决策场景：企业需要对零配件与成品安排检测，并在检测、拆解与直接使用之间做出成本最优的选择。',
      '题目要求分四层作答：第一层是单一批次的检测方案设计，即在给定标称次品率与两类风险上界的条件下，反解出所需的最小样本量与相应的拒收临界值；',
      '第二层是把检测结果嵌入生产决策，比较"检测后按结果拆解"与"不检测直接使用"等策略的期望成本，给出成本最优的方案；',
      '第三层是把结论推广到多工序的装配结构，说明树状结构中各节点的期望成本如何聚合，以及次品率在节点之间如何传递；',
      '第四层是承认抽样本身的误差，把次品率的点估计换成后验分布，检验前面的决策在抽样波动下是否仍然稳健，并给出风险区间。',
      '本文对四层分别建立模型、给出求解过程，并把每一个进入结论的数字都绑定到一次真实的计算输出。',
    ].join(NL),
    analysis: [
      '本文把四个子问题归到三个方法组件上：假设检验（离散风险上界的反解）、期望成本最小化（策略枚举与成本口径的统一）、以及贝叶斯化的稳健重算。',
      '问题1 归到假设检验。它的实质不是估计次品率，而是在"接收"与"拒收"之间划一条可复算的界：给定标称次品率与两类风险上界，样本量与临界值必须同时满足两端的概率约束。',
      '难点有两个：一是离散性——样本量与临界值都是整数，可行域是离散的，不能直接套连续近似；二是口径对齐——生产方风险与使用方风险必须定义在同一套接收概率上，否则两端的界会互相矛盾。',
      '问题2 归到期望成本最小化。它的实质是把"检测成本"与"漏检损失"放在同一个目标函数里比较：检测得越少，漏检流入下游的次品越多，损失越大；检测得越多，成本越高。',
      '难点在成本口径的可复算性：每一种策略的期望成本都必须写成同一个结构（检测成本 + 次品率 × 单位损失），并且所有参数都要显式声明，否则不同策略之间不可比。',
      '问题3 归到树状结构的递推聚合。它的实质是把问题2 的单节点成本推广到装配树：每个节点的输出次品率由输入次品率与本地检测方案共同决定，整树的期望成本由叶子向根递推。',
      '难点是节点之间的次品率传递：上游节点的输出就是下游节点的输入，任何一步的近似都会沿树放大，因此递推关系必须写清楚而不是笼统地说"逐层计算"。',
      '问题4 归到贝叶斯稳健化。它的实质是承认前面的决策用的是点估计的次品率，而真实可得的是抽样结果；把点估计换成后验分布后，期望成本变成对后验的积分。',
      '难点在于把"稳健"变成可比较的量：不是换一个更保守的数字，而是给出后验期望成本与区间，让决策者看到抽样波动会把结论推动多少。',
      '四个子问题共用同一组符号与同一条成本口径：问题1 给出检测方案的离散可行域，问题2 在该可行域上做期望成本比较，问题3 把比较推广到树，问题4 把点估计换成后验。',
      '这样安排的好处是四问的结论可以互相校核：问题2 的最优策略必须落在问题1 给出的可行方案里，问题3 的整树成本在单节点情形下必须退化回问题2 的数值，问题4 的稳健成本必须把问题2 的结果包在区间内。',
      '若某一问的数值与其他问矛盾，说明成本口径或次品率传递被写错了，可以机械地定位到具体一步，而不是靠重新叙述来掩盖。',
      '问题分析到此给出的是"每一问要做什么、归到哪类方法、难点在哪、四问如何互相校核"；具体的方程、参数与数值在下文各问的章节里逐条给出，并由同一次代码运行产生。',
      '这样安排的另一个好处是：读者不必先接受任何一处叙述，就能沿引用链核对每一个结论——结论指向结果，结果指向运行，运行指向代码与输出文件。',
    ].join(NL),
    evaluation: [
      '优点：本文的四个模型都由同一个成本口径串起来，每一步的输入、输出与判据都写清楚，所有进入结论的数字都来自同一次可复算的运行，读者可以按问逐步复核，而不必相信任何一处"看起来合理"的叙述。',
      '优点之二是判据的机械性：接收概率由精确二项分布给出，期望成本由显式结构给出，树状递推由父子关系给出，稳健化由后验积分给出，四者都不依赖主观权重。',
      '局限：模型假设批次内次品率恒定，且检测本身不犯错。若产线存在批次漂移，或者检测存在漏检与误检，则接收概率需要按分段或引入误检率重新推导，本文给出的方案会偏乐观。',
      '局限之二是成本参数被当作已知常数。实际生产中拆解成本与下游损失往往是区间或随批量变化的，本文只做了单点计算与一次扰动检验，没有把它们当作随机变量。',
      '敏感性：对次品率与成本参数做了扰动重算，最优策略在较宽的参数范围内保持不变，说明结论不是靠某一组特定参数支撑的；但当次品率接近策略切换的临界点时，期望成本的差异会迅速缩小，此时应回到问题4 的后验口径判断。',
      '敏感性之二是样本量的离散性：最小样本量是整数解，参数在临界点附近微动会让样本量跳变一档，因此报告样本量时应同时给出对应的风险水平，而不是只给一个整数。',
      '推广：把风险上界替换为代价函数即可推广到更一般的验收抽样；把单条装配线换成装配网络，递推关系由树改为有向无环图，问题3 的聚合仍然成立。',
      '推广之二是决策口径的替换：本文在检测与拆解之间比较，同样的期望成本框架可以直接用于多阶段的质量控制与返修决策，只需重新声明每阶段的成本项。',
      '最后说明本文不做什么：不估计产线的长期漂移，不建模检测设备本身的误差，也不把成本参数的估计误差纳入优化；这些都属于把模型推向更真实场景的后续工作。',
      '把这三点写在评价里，是为了让读者知道结论的适用范围：在本文假设成立时结论可直接使用，假设被打破时应当按上面给出的方向重建模型，而不是继续引用本文的数值。',
      '与其他做法相比，本文没有追求模型形式的复杂，而是把四问放在同一条可复算的成本口径上：复杂度换来的往往是难以核对的中间量，而竞赛论文的价值在于每一步都能被读者重新算一遍。',
      '因此本文把可复算性作为第一位的取舍标准，凡是无法由代码复现的量都不进入结论；这一取舍也让模型的局限与推广方向变得清楚，而不是靠形容词来修饰结论的可靠性。',
    ].join(NL),
    references: [
      '[1] Wald A. Sequential Analysis. New York: John Wiley & Sons. 1947.',
      '[2] 茆诗松, 程依明, 濮晓龙. 概率论与数理统计教程. 北京: 高等教育出版社. 2011.',
      '[3] Montgomery D C. Introduction to Statistical Quality Control. Hoboken: John Wiley & Sons. 2019.',
      '[4] 姜启源, 谢金星, 叶俊. 数学模型. 北京: 高等教育出版社. 2018.',
      '[5] Berger J O. Statistical Decision Theory and Bayesian Analysis. New York: Springer. 1985.',
      '[6] 王梓坤. 概率论基础及其应用. 北京: 科学出版社. 1976.',
      '[7] Deming W E. Some Theory of Sampling. New York: Dover Publications. 1966.',
      '[8] 盛骤, 谢式千, 潘承毅. 概率论与数理统计. 北京: 高等教育出版社. 2008.',
      '[9] Casella G, Berger R L. Statistical Inference. Pacific Grove: Duxbury Press. 2002.',
      '[10] 谢金星, 薛毅. 优化建模与 LINDO/LINGO 软件. 北京: 清华大学出版社. 2005.',
      '[11] Cochran W G. Sampling Techniques. New York: John Wiley & Sons. 1977.',
    ].join(NL),
    code: [
      '求解代码在一次运行中完成四问，并把全部数值写入 result.json，正文的数字由该文件回读（不经过人工转录）。',
      '问题1 由 binomCdf() 给出精确二项累积分布，主循环按风险上界逐样本量搜索，反解最小样本量与拒收临界值。',
      '问题2 在问题1 给出的方案上枚举检测后拆解与直接使用两种策略，比较期望成本并取较小者。',
      '问题3 把两工序的装配结构按树状节点聚合，得到整树期望成本。',
      '问题4 用后验均值替代点估计重算期望成本，得到抽样误差下的稳健值。',
    ].join(NL),
  },
})
