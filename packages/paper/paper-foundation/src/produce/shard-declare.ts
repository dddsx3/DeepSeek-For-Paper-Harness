/**
 * W9-P2 — sharded EXECUTE declaration (O-L1-03).
 *
 * 问题（W8.5 实测）：ir-container-v1 单次整体声明，输出预算被 reasoning
 * 通道吃掉（P1 探针：reasoning:content ≈ 14.6:1），32k 上限在 JSON 正文
 * 完成前被撞破 → 截断。
 *
 * 分片方案：把一次大输出拆成**三步小输出**（每步独立请求、独立预算）：
 *   片 1/3 定义层: SymbolSpec[] + AssumptionSpec[] + EquationSpec[]
 *   片 2/3 模型层: ModelSpec[]
 *   片 3/3 运行层: code + run + interpretations + narrative
 * 每片输出一个**小 JSON 对象**（非完整容器），全部成功后由 harness 合并为
 * 一个完整 ir-container-v1，然后走与单次声明**完全相同**的生产链
 * （producer / code-run / 审计逐条不变——合并点是唯一新代码）。
 *
 * 开关：`--shard-declare`（CLI）/ `shardDeclare: true`（executor options）。
 * **默认关闭**：默认路径保持单次声明的既有行为（W8.6 教训：未验证的协议
 * 改动不得直接改默认路径；分片必须先在真实运行上证明自己）。
 *
 * 片长依据（P1 探针数据）：每片输出预算 ≈ 内容 tokens × 15（reasoning
 * 比）。实测 ir-container 内容 469 字符 → reasoning 6,863 字符。目标：
 * 每片内容 ≤ 600 字符 ≈ 9k tokens 预算占用，远低于 32k 默认上限。
 */

/** 三片的片名（审计事件与提示词共用，单一来源）。 */
export const SHARD_NAMES = ['definitions', 'models', 'runtime'] as const
export type ShardName = (typeof SHARD_NAMES)[number]

/** 每片的系统指令。每片都是"小 JSON 对象"，不是完整容器。 */
export function shardPrompt(shard: ShardName): string {
  const head = [
    'You are completing ONE SHARD of a multi-step structured declaration. Output EXACTLY ONE small JSON object and nothing else. No prose, no markdown fences.',
    'The harness has ALREADY registered: DataArtifact "DA-RAW", RequirementSpec "R-OUT", ProblemSpec "P1". Reference them by id; NEVER declare them.',
  ]
  if (shard === 'definitions') {
    return [
      ...head,
      'SHARD 1/3 — DEFINITIONS. Shape: {"entries":[<entry>...]} where each entry is EXACTLY {"kind":<KIND>,"value":<object>}.',
      'Allowed kinds in this shard: "SymbolSpec", "AssumptionSpec", "EquationSpec".',
      '  SymbolSpec value: {"symbol_id","scope_ref":"P1","token","meaning","unit","role","shape","domain","index_set"} — role VARIABLE|PARAMETER; shape SCALAR|VECTOR|MATRIX|TENSOR|INDEXED|UNKNOWN; domain REAL|NONNEGATIVE_REAL|INTEGER|NONNEGATIVE_INTEGER|BOOLEAN|PROBABILITY|COMPLEX|UNKNOWN; index_set is an array ([] for a scalar). Be honest: answer UNKNOWN instead of inventing.',
      '  AssumptionSpec value: {"assumption_id","scope_ref":"P1","statement","source_type","justification_refs","risk_level","testable","sensitivity_refs","status"} — source_type GIVEN|DERIVED|MODELING_CHOICE|APPROXIMATION; risk_level HIGH|MEDIUM|LOW; status ACTIVE.',
      '  EquationSpec value: {"equation_id","scope_ref":"P1","expression","representation","lhs_symbols","rhs_symbols","equation_type","unit","depends_on","source"} — representation SYMPY|LATEX_PRESENTATION; equation_type DEFINITION|CONSTRAINT|OBJECTIVE|DERIVED; lhs/rhs_symbols reference the symbol_ids you declared here.',
      'Declare between 2 and 6 symbols and between 1 and 4 assumptions. Keep every "statement"/"meaning" under 40 characters. No numbers anywhere except inside expression strings.',
    ].join('\n')
  }
  if (shard === 'models') {
    return [
      ...head,
      'SHARD 2/3 — MODELS. Shape: {"entries":[{"kind":"ModelSpec","value":{...}}]}.',
      '  ModelSpec value: {"model_id","problem_refs":["P1"],"assumption_refs","variable_refs","parameter_refs","equation_refs","constraints","objective","dependencies"} — every field required; variable_refs/parameter_refs reference the symbol_ids declared in shard 1; assumption_refs/equation_refs list the ids from shard 1.',
      'Declare exactly ONE ModelSpec. Keep "objective" under 40 characters and every constraint string under 40 characters.',
    ].join('\n')
  }
  return [
    ...head,
    'SHARD 3/3 — RUNTIME. Shape: {"code":"<JavaScript source>","run":{"outputBasenames":[...],"seed":<integer>},"interpretations":{"results":[...],"figures":[...]},"narrative":{"title":"..."}}.',
    '  code: executable Node JavaScript that WRITES the measured numbers to the declared output files. All arithmetic happens HERE; never state a computed number anywhere else.',
    '  run: ONLY "outputBasenames" (the file names your code writes; 1–2 of them) and "seed" (an integer). No other key is accepted.',
    '  interpretations.results: [{"result_id","name","source":{"locator":<one outputBasenames entry>,"jsonPath":<path to the number inside that file>},"unit"}] — every Result reads its value via jsonPath; never a literal number.',
    '  interpretations.figures (optional): [{"figure_id","chart_type":"line"|"scatter"|"bar"|"table","data_refs":[result_ids],"caption?"}] — structure only; the harness renders the bytes.',
    '  narrative: {"title":"<short>"}. Do NOT include "conclusion" here — the conclusion arrives in a later step.',
    'Refusals: a number outside code/declarations, an outputBasename the code never writes, a jsonPath that does not resolve, or a foreign key in the run block.',
  ].join('\n')
}

/** 解析一片的输出：小 JSON 对象（{entries:[...]} / runtime 形）。 */
export function parseShard(
  shard: ShardName,
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; code: string; reason: string } {
  const trimmed = text.trim()
  // 容忍围栏包裹（模型常见），但不做字段修复
  const unfenced = trimmed.startsWith('```')
    ? trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '').trim()
    : trimmed
  let parsed: unknown
  try {
    parsed = JSON.parse(unfenced)
  } catch (error) {
    return { ok: false, code: 'parse_failed', reason: `shard '${shard}' output is not JSON: ${String(error).split('\n')[0]}` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, code: 'parse_failed', reason: `shard '${shard}' output is not a JSON object` }
  }
  const obj = parsed as Record<string, unknown>
  if (shard === 'runtime') {
    if (!Array.isArray((obj['run'] as { outputBasenames?: unknown } | undefined)?.outputBasenames)) {
      return { ok: false, code: 'schema_violation', reason: "shard 'runtime' must carry run.outputBasenames" }
    }
    return { ok: true, value: obj }
  }
  if (!Array.isArray(obj['entries'])) {
    return { ok: false, code: 'schema_violation', reason: `shard '${shard}' must carry an 'entries' array` }
  }
  return { ok: true, value: obj }
}

/**
 * 合并三片为完整 ir-container-v1。合并点是唯一新代码：产出物与单次声明
 * 的形状逐字段相同，因此后续 producer / 代码执行 / 审计零改动。
 */
export function mergeShards(
  definitions: Record<string, unknown>,
  models: Record<string, unknown>,
  runtime: Record<string, unknown>,
): Record<string, unknown> {
  const entries = [
    ...(definitions['entries'] as ReadonlyArray<unknown>),
    ...(models['entries'] as ReadonlyArray<unknown>),
  ]
  return {
    __dsh_paper: 'ir-container-v1',
    entries,
    ...(runtime['code'] === undefined ? {} : { code: runtime['code'] }),
    ...(runtime['run'] === undefined ? {} : { run: runtime['run'] }),
    ...(runtime['interpretations'] === undefined ? {} : { interpretations: runtime['interpretations'] }),
    ...(runtime['narrative'] === undefined ? {} : { narrative: runtime['narrative'] }),
  }
}
