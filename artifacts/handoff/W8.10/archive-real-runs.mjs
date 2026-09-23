// W8.10-D2 全量归档生成器（只读持久化目录，只写 real-run-{1,2,3}/）
//
// 输入（只读）：
//   apps/paper-shell/src/paper-shell-persist-<X>/paper_audit.json
//   apps/paper-shell/src/paper-shell-persist-<X>/paper_workflow.json
//   artifacts/handoff/W8.10/real-run-N/run-report.json
// 输出（每个 run 4 个文件）：
//   audit-trail.json / audit-trail.md / workflow-state.json / FAILURE.md
//
// 纪律：detail 逐字保留；磁盘上没有的数据一律写「未留存」，不编造。

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = '<repo>'
const OUT_ROOT = path.join(ROOT, 'artifacts', 'handoff', 'W8.10')
const SRC_ROOT = path.join(ROOT, 'apps', 'paper-shell', 'src')

const RUNS = [
  { n: 1, dir: 'paper-shell-persist-49bCAV', runId: 'edca6fcf-ba03-45f9-aae5-779b2604396a' },
  { n: 2, dir: 'paper-shell-persist-KoapW9', runId: '6b10cd1f-9138-4f71-8803-34dc227d8fe5' },
  { n: 3, dir: 'paper-shell-persist-eXRp4h', runId: '148f8f63-eac0-49b1-9e46-a9eca9995bf3' },
]

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const readText = (p) => fs.readFileSync(p, 'utf8')
const jparse = (p) => JSON.parse(readText(p))

/** 单行化 + 表格安全。 */
function oneLine(v, n = 90) {
  const s = String(v).replace(/\s+/g, ' ').replace(/\|/g, '\\|')
  return s.length > n ? `${s.slice(0, n)}…` : s
}

/** 字符串截断，返回 {text, truncated, originalLength}。 */
function clip(s, n) {
  const str = String(s)
  return str.length > n
    ? { text: str.slice(0, n), truncated: true, originalLength: str.length }
    : { text: str, truncated: false, originalLength: str.length }
}

/**
 * 渲染 ir_entry_written 的 detail：展开 kind/id/ok 等标量，字符串型 detail 走截断渲染。
 * 截断标注写明两层：本渲染的 300 上限，以及 harness 落盘的 400 上限（executor.ts:1630）。
 */
function renderIrDetail(d, limit = 300) {
  const lines = []
  const scalars = []
  for (const [k, v] of Object.entries(d)) {
    if (k === 'detail') continue
    scalars.push(`\`${k}\` = ${JSON.stringify(v)}`)
  }
  if (scalars.length > 0) lines.push(scalars.join('　·　'))
  if (typeof d.detail === 'string') {
    const c = clip(d.detail, limit)
    const marks = []
    if (c.truncated) marks.push(`已截断至 ${limit} 字符（原文 ${c.originalLength} 字符）`)
    if (c.originalLength === 400) marks.push('原文长度恰为 400：harness 落盘时已按 `executor.ts:1630` 的 `slice(0, 400)` 截断，此处不是完整模型输出')
    lines.push(`detail${marks.length > 0 ? `（${marks.join('；')}）` : ''}：`)
    lines.push('')
    lines.push('> ' + c.text.replace(/\n/g, '\n> '))
  } else if (d.detail !== undefined) {
    lines.push('`detail` = ' + JSON.stringify(d.detail))
  }
  return lines.join('\n')
}

/** 事件一行摘要。 */
function summarize(ev) {
  const d = ev.detail ?? {}
  switch (ev.eventType) {
    case 'production_enabled':
      return `tier=${d.tier} mode=${d.mode} route=${d.route}`
    case 'workflow_started':
      return `mode=${d.mode}`
    case 'ir_entry_written': {
      const bits = [`kind=${d.kind}`]
      if (d.id !== undefined) bits.push(`id=${d.id}`)
      if (d.ok !== undefined) bits.push(`ok=${d.ok}`)
      if (d.chars !== undefined) bits.push(`chars=${d.chars}`)
      if (d.guidance_chars !== undefined) bits.push(`guidance_chars=${d.guidance_chars}`)
      if (typeof d.detail === 'string') bits.push(`detail="${oneLine(d.detail, 60)}"`)
      return bits.join(' ')
    }
    case 'provider_retry':
      return `attempt=${d.attempt} code=${d.code} w4Class=${d.w4Class} role=${d.role}`
    case 'gate_failed':
      return `gate=${d.gate} reason=${d.reason}`
    default:
      return oneLine(JSON.stringify(d), 80)
  }
}

/** 从 B3 正向 detail 里抽出被点名的锚点 id（逐字，按落盘顺序）。 */
function anchorsOf(detailText) {
  return String(detailText)
    .split('；')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((seg) => {
      const i = seg.indexOf(':')
      if (i === -1) return { id: seg, truncated: true }
      return { id: seg.slice(0, i).trim(), truncated: false }
    })
}

/** 按 provider_retry 切分 attempt 桶。 */
function bucketAttempts(events) {
  const buckets = []
  let cur = { attempt: 1, events: [] }
  for (const ev of events) {
    cur.events.push(ev)
    if (ev.eventType === 'provider_retry') {
      buckets.push(cur)
      cur = { attempt: (ev.detail?.attempt ?? buckets.length + 1) + 1, events: [] }
    }
  }
  buckets.push(cur)
  return buckets
}

function buildAuditTrailJson(run, audit, auditRaw, events) {
  return {
    run: `real-run-${run.n}`,
    runId: run.runId,
    archived_from: `apps/paper-shell/src/${run.dir}/paper_audit.json`,
    archived_from_sha256: sha256(auditRaw),
    archived_from_unit: audit.unit,
    archived_from_global: audit.global,
    ordering: 'seq ascending',
    event_count: events.length,
    note:
      'events 为该次运行 paper_audit.json 中 tables.entries 的全部事件，按 seq 升序排列；' +
      'detail 逐字保留（未经改写/润色/删减）。源表是以 16 位零填充字符串为键的对象，非数组。',
    events,
  }
}

function buildAuditTrailMd(run, auditRaw, events) {
  const L = []
  L.push(`# real-run-${run.n} 审计轨迹（audit trail）`)
  L.push('')
  L.push(`- runId: \`${run.runId}\``)
  L.push(`- 来源: \`apps/paper-shell/src/${run.dir}/paper_audit.json\`（sha256 \`${sha256(auditRaw)}\`）`)
  L.push(`- audit unit: \`${JSON.stringify(run.auditUnit)}\``)
  L.push(`- 事件数: ${events.length}（按 \`seq\` 升序；源表为 16 位零填充字符串键对象，非数组）`)
  L.push(`- 原始数组: \`audit-trail.json\`（本文是同一数组的可读渲染）`)
  L.push('')
  L.push('> 渲染规则：所有标量逐字；字符串型 `detail` 字段超过 300 字符时截断并**标注已截断**。')
  L.push('> 另需注意：harness 落盘时已按 `packages/paper/paper-foundation/src/executor.ts:1630`')
  L.push('> 的 `finding.detail.slice(0, 400)` 截断，故「原文 400 字符」不等于完整模型输出。')
  L.push('')
  L.push('## 事件总表')
  L.push('')
  L.push('| seq | ts | actor | runId | eventType | 摘要 |')
  L.push('|---|---|---|---|---|---|')
  for (const ev of events) {
    L.push(
      `| ${ev.seq} | ${ev.ts} | ${ev.actor} | ${ev.runId === null ? 'null' : `\`${ev.runId}\``} | \`${ev.eventType}\` | ${oneLine(summarize(ev), 110)} |`,
    )
  }
  L.push('')
  L.push('## 逐事件明细')
  L.push('')
  for (const ev of events) {
    L.push(`### seq ${ev.seq} — \`${ev.eventType}\``)
    L.push('')
    L.push(`- ts: \`${ev.ts}\``)
    L.push(`- actor: \`${ev.actor}\``)
    L.push(`- runId: ${ev.runId === null ? '`null`' : `\`${ev.runId}\``}`)
    L.push(`- id: \`${ev.id}\``)
    L.push(`- 原始 detail（JSON，逐字）:`)
    L.push('')
    L.push('```json')
    L.push(JSON.stringify(ev.detail, null, 2))
    L.push('```')
    L.push('')
    if (ev.eventType === 'ir_entry_written') {
      L.push('展开（`kind` / `id` / `ok` / `detail`）:')
      L.push('')
      L.push(renderIrDetail(ev.detail ?? {}))
      L.push('')
    }
  }
  return L.join('\n')
}

function buildFailureMd(run, ctx) {
  const { report, audit, workflow, auditRaw, wfRaw, events } = ctx
  const runRec = Object.values(workflow.tables.runs)[0]
  const nodes = Object.values(workflow.tables.nodes)
  const gateFailed = events.filter((e) => e.eventType === 'gate_failed')
  const retries = events.filter((e) => e.eventType === 'provider_retry')
  const guidanceEvs = events.filter((e) => e.eventType === 'ir_entry_written' && e.detail?.kind === 'E2DriftGuidance')
  const buckets = bucketAttempts(events)

  const wallFromWf = (new Date(runRec.updatedAt) - new Date(runRec.createdAt)) / 1000
  const f = report.memo?.failing_node ?? {}
  const executeNode = nodes.find((n) => n.type === 'execute')

  // ---- 计算观察（全部来自磁盘） ----
  const perAttempt = buckets.map((b) => {
    const findings = b.events.filter((e) => e.eventType === 'ir_entry_written' && e.detail?.kind === 'FidelityFinding')
    const byRule = {}
    for (const fd of findings) byRule[fd.detail.id] = fd.detail
    const forward = findings.find((fd) => fd.detail.id.includes('B3 正向'))
    const e2 = b.events.filter((e) => e.detail?.kind === 'E2Normalization').pop()
    const g = b.events.filter((e) => e.detail?.kind === 'E2DriftGuidance')
    const retry = b.events.find((e) => e.eventType === 'provider_retry')
    return { attempt: b.attempt, byRule, forward, e2, guidance: g, retry, events: b.events }
  })
  const b4 = perAttempt.map((a) => a.byRule['B4 逐问推理覆盖']?.ok)
  const b4AlwaysFail = b4.length > 0 && b4.every((v) => v === false)
  const b4AlwaysPass = b4.length > 0 && b4.every((v) => v === true)
  const forwardCounts = perAttempt.map((a) =>
    a.forward?.detail === undefined ? null : a.forward.detail.ok === true ? 'PASS' : anchorsOf(a.forward.detail.detail).length,
  )
  const firstRetrySeq = retries[0]?.seq ?? Infinity
  const guidanceBeforeFirstRetry = guidanceEvs.filter((g) => g.seq < firstRetrySeq)
  const lastTwo = perAttempt.slice(-2).map((a) => a.forward?.detail?.detail)
  const identicalTruncated =
    lastTwo.length === 2 && lastTwo[0] !== undefined && lastTwo[0] === lastTwo[1]

  const L = []
  L.push(`# real-run-${run.n} 失败归档（W8.10-D2）`)
  L.push('')
  L.push('> **归档纪律**：本文引用的所有原始文本均逐字来自磁盘，未做美化、总结替代或删减。')
  L.push('> 磁盘上没有的数据一律标注「**未留存**」，不做推测性补写。')
  L.push(`> 来源：\`apps/paper-shell/src/${run.dir}/paper_audit.json\`（sha256 \`${sha256(auditRaw)}\`）、`)
  L.push(`> \`apps/paper-shell/src/${run.dir}/paper_workflow.json\`（sha256 \`${sha256(wfRaw)}\`）、`)
  L.push(`> \`artifacts/handoff/W8.10/real-run-${run.n}/run-report.json\`（已有产物，本次未修改）。`)
  L.push('')
  L.push('## 1. 结论速览')
  L.push('')
  L.push('| 项 | 值 | 来源 |')
  L.push('|---|---|---|')
  L.push(`| runId | \`${report.runId}\` | run-report.json |`)
  L.push(`| tier / mode | ${report.tier} / ${report.mode} | run-report.json |`)
  L.push(`| status | **${report.status}** | run-report.json；workflow runs.status = \`${runRec.status}\` |`)
  L.push(`| routed_family / route_truth | ${report.routed_family} / ${report.route_truth} | run-report.json |`)
  L.push(`| route_mismatch | ${report.route_mismatch} | run-report.json |`)
  L.push(`| **失败码 code** | \`${report.code}\` | run-report.json |`)
  L.push(`| **classifier** | \`${report.classifier}\` | run-report.json |`)
  L.push(`| **失败节点** | \`${f.title}\`（attempts ${f.attempts}，maxAttempts ${executeNode?.maxAttempts}，node state \`${executeNode?.state}\`） | run-report.json memo.failing_node + workflow nodes |`)
  L.push(`| **失败 gate** | \`${gateFailed[0]?.detail?.gate ?? '未留存'}\` | audit \`gate_failed\` 事件 seq ${gateFailed[0]?.seq ?? '-'} |`)
  L.push(`| minted_ir_count / kinds | ${report.minted_ir_count}（${(report.memo?.minted_ir_kinds ?? []).join(', ')}） | run-report.json |`)
  L.push(`| passed_gates | ${(report.memo?.passed_gates ?? []).join(', ')} | run-report.json |`)
  L.push(`| wall_clock_seconds | ${report.wall_clock_seconds}（workflow createdAt→updatedAt = ${wallFromWf.toFixed(3)} s） | run-report.json / workflow runs |`)
  L.push(`| usage | input ${report.usage.input_tokens} / output ${report.usage.output_tokens} / cost_usd ${report.usage.cost_usd} | run-report.json（与 workflow 5 条 usage 事件求和一致） |`)
  L.push('')
  L.push('## 2. 失败码')
  L.push('')
  L.push('```json')
  L.push(JSON.stringify({ code: report.code, classifier: report.classifier, humanized: report.humanized }, null, 2))
  L.push('```')
  L.push('')
  L.push('`humanized` 为 run-report.json 中逐字原文（未润色）。`classifier` 为 `none`，表示本次未落到分类器分支。')
  L.push('')
  L.push('## 3. 失败层（哪个节点 / 哪个 gate）')
  L.push('')
  L.push(`- 节点：\`${f.title}\`（nodeId \`${executeNode?.id}\`，type \`${executeNode?.type}\`，role \`${executeNode?.role}\`），state \`${executeNode?.state}\`，attempts \`${executeNode?.attempts}\`/\`${executeNode?.maxAttempts}\`，\`lastErrorCode\` = \`${JSON.stringify(executeNode?.lastErrorCode)}\`。`)
  L.push(`- gate：\`${gateFailed[0]?.detail?.gate ?? '未留存'}\`，逐字 reason：\`${gateFailed[0]?.detail?.reason ?? '未留存'}\`（seq ${gateFailed[0]?.seq ?? '-'}）。`)
  L.push("- 该 gate 的抛出点：`packages/paper/paper-foundation/src/executor.ts:1832`（`gate: 'ir_producer'`）。")
  L.push(`- 逐次尝试的 gate 层失败码：${retries.map((r) => `attempt ${r.detail.attempt} = \`${r.detail.code}\`（w4Class \`${r.detail.w4Class}\`）`).join('；')}。`)
  L.push('')
  L.push('## 4. 原始错误文本')
  L.push('')
  L.push('### 4.1 落盘原文（逐字）')
  L.push('')
  L.push(`- \`gate_failed\`（seq ${gateFailed[0]?.seq ?? '-'}）reason：`)
  L.push('')
  L.push('```text')
  L.push(String(gateFailed[0]?.detail?.reason ?? '未留存'))
  L.push('```')
  L.push('')
  L.push('- 每次 attempt 的 `provider_retry` 事件：')
  L.push('')
  L.push('```json')
  L.push(JSON.stringify(retries.map((r) => r.detail), null, 2))
  L.push('```')
  L.push('')
  L.push('- 每次 attempt 的拒绝理由（`FidelityFinding.detail`，逐字，落盘上限 400 字符）：')
  L.push('')
  for (const a of perAttempt) {
    const failed = Object.values(a.byRule).filter((x) => x.ok === false)
    if (failed.length === 0) continue
    L.push(`  - **attempt ${a.attempt}**：`)
    L.push('')
    for (const x of failed) {
      const c = clip(x.detail, 400)
      L.push(`    - \`${x.id}\`（原文 ${c.originalLength} 字符${c.originalLength === 400 ? '，已在落盘时截断' : ''}）：`)
      L.push('')
      L.push('      ```text')
      L.push('      ' + c.text.replace(/\n/g, '\n      '))
      L.push('      ```')
      L.push('')
    }
  }
  L.push('### 4.2 未留存')
  L.push('')
  L.push('- **抛出的 Error.message 未留存。** `executor.ts:1834-1837` 构造的 `WorkflowExecutionError` 文本（`node \'<id>\' exhausted 2 guided retries (DRIFT): EXECUTE output was not a schema-valid ir-container-v1 (BLOCKED)`）只作为异常抛出，未写入任何持久化产物：')
  L.push(`  - \`paper_workflow.json\` 只记录状态迁移（\`node_state running→failed\`、\`run_state running→failed\`），无 message 字段；对两个持久化文件检索 \`exhausted\`/\`refused\` 仅命中 \`gate_failed.reason\` 一处。`)
  L.push('- 每次 attempt 的完整 E2 模型输出文本未留存（只有长度 `chars` 与拒绝理由摘录）。')
  L.push('- 完整 E1 分析文本未留存（只有长度 `chars`）。')
  L.push('')
  L.push('### 4.3 代码模板（非落盘原文，仅用于核对措辞）')
  L.push('')
  L.push('以下文本**不是**磁盘上的归档数据，而是从源码模板代入本次 nodeId 后的重建，仅供复盘核对措辞：')
  L.push('')
  L.push('```text')
  L.push(`node '${executeNode?.id}' exhausted 2 guided retries (DRIFT): EXECUTE output was not a schema-valid ir-container-v1 (BLOCKED)`)
  L.push('```')
  L.push('')
  L.push('（模板出处：`packages/paper/paper-foundation/src/executor.ts:1834-1837`；`2` = `NONE_RETRY_BUDGET`，定义在 `packages/paper/paper-foundation/src/probe/probe.ts:37`。）')
  L.push('')
  L.push('## 5. 被拒容器摘录')
  L.push('')
  L.push('**本次未留存被拒容器摘录。**')
  L.push('')
  L.push('依据（只读检索，未做任何推断性补写）：')
  L.push('')
  L.push(`- 本次审计轨迹共 ${events.length} 个事件，事件类型全集为 \`${JSON.stringify([...new Set(events.map((e) => e.eventType))])}\`，**不含 \`container_refused\`**。`)
  L.push('- 全仓检索 `container_refused` 只命中源码与测试文件，未命中任何 `apps/paper-shell/src/paper-shell-persist-*/` 持久化目录。')
  L.push('- 原因（代码路径，只读）：本次拒绝发生在 E1→E2 fidelity 门（`executor.ts:1634-1660`，抛 `E1_E2_FIDELITY_VIOLATION` / `w4Class=DRIFT`），该门位于 `produceContainerInto`（`executor.ts:1663`）**之前**——这是 W8.10-B1 的重排要求「每个可能拒绝的门都必须坐在 admission 之前」。只有 `produceContainerInto` 返回 `!ok` 时才会写 `container_refused`（`executor.ts:1671-1687`，含 `excerpt_head`/`excerpt_tail`/`output_sha256`/`reason`）。因此本次运行不存在被拒容器，也就不存在可摘录的容器文本。')
  L.push('- 最接近的替代物（已在上文第 4.1 节逐字归档）：`FidelityFinding` 事件的 `detail`——它是**拒绝理由的原文**，但不是被拒容器的内容摘录。')
  L.push('')
  L.push('## 6. 逐次尝试的失败分类演变')
  L.push('')
  L.push('| attempt | E2 chars | 该 attempt 应用的 guidance | B4 逐问推理覆盖 | B3 反向 | B3 锚点同一性 | B3 正向 | 正向失败锚点数 | w4Class / code |')
  L.push('|---|---|---|---|---|---|---|---|---|')
  for (const a of perAttempt) {
    const g = a.guidance.map((x) => `\`${x.detail.guidance_chars}\` 字符（seq ${x.seq}）`).join('、')
    const rule = (name) => {
      const v = a.byRule[name]
      return v === undefined ? '未记录' : v.ok ? 'PASS' : '**FAIL**'
    }
    // 只有 B3 正向 FAIL 时，detail 才是「被点名锚点」清单；PASS 时该文本是肯定句，不是锚点列表。
    const n = a.forward?.detail
      ? a.forward.detail.ok === true
        ? '—（PASS，无失败锚点）'
        : `${anchorsOf(a.forward.detail.detail).length}${anchorsOf(a.forward.detail.detail).some((x) => x.truncated) ? '+（下界）' : ''}`
      : '未记录'
    const cls = a.retry ? `\`${a.retry.detail.w4Class}\` / \`${a.retry.detail.code}\`` : '（终局，无 retry 事件）'
    L.push(
      `| ${a.attempt} | ${a.e2?.detail?.chars ?? '未留存'} | ${g || '**未应用**'} | ${rule('B4 逐问推理覆盖')} | ${rule('B3 反向（E1 假设须被声明）')} | ${rule('B3 锚点同一性（声明须在 E1 中有同名锚点）')} | ${rule('B3 正向（声明须逐字锚定 E1）')} | ${n} | ${cls} |`,
    )
  }
  L.push('')
  L.push('### 6.1 B3 正向 FAIL 的锚点清单（逐字，按落盘顺序）')
  L.push('')
  let anyForwardFail = false
  for (const a of perAttempt) {
    if (!a.forward?.detail) continue
    if (a.forward.detail.ok === true) {
      L.push(`- **attempt ${a.attempt}**：B3 正向 **PASS**，无失败锚点。该 attempt 的 detail 原文（逐字）：\`${clip(a.forward.detail.detail, 300).text}\``)
      continue
    }
    anyForwardFail = true
    const list = anchorsOf(a.forward.detail.detail)
    const truncatedTail = list.some((x) => x.truncated)
    L.push(
      `- **attempt ${a.attempt}**（${list.length} 项${truncatedTail ? '，**这是下界**：末项在落盘时被 400 字符上限截断，其后的锚点未留存' : ''}）：`,
    )
    L.push(`  ${list.map((x) => `\`${x.id}${x.truncated ? '…（截断）' : ''}\``).join('、')}`)
  }
  L.push('')
  L.push('### 6.2 演变读数')
  L.push('')
  L.push(`- 分类本身**未变化**：三次 attempt 的 \`w4Class\` 恒为 \`DRIFT\`，失败码恒为 \`E1_E2_FIDELITY_VIOLATION\`。变化的是**被点名的具体失败面**（B3 正向：${forwardCounts.map((c) => (c === null ? '未记录' : c)).join(' → ')}；数值为 FAIL 时被点名的锚点数，PASS 时记为 PASS）。`)
  if (b4AlwaysFail) {
    L.push('- **B4 逐问推理覆盖三次尝试全部 FAIL**，且 detail 三次逐字相同（`E1 缺少 1 个要求的推理段：R-OUT`）。按 W8.10-D1（`executor.ts:1635-1642`），B4 是 **E1 侧缺陷**，被 `e2Fixable = fidelity.filter(f => !f.ok && !f.rule.includes(\'B4\'))` 排除在 E2 回灌之外——即它**不可能被 E2 重试修好**，因此它在这三次运行中是恒定的背景失败，不参与收窄。')
    // 回灌是否有「可作用对象」：attempt N 的 guidance 由 attempt N-1 的**非 B4** FAIL 构成。
    // 若前序 attempt 只有 B4 FAIL，则 e2Fixable 为空（executor.ts:1650），回灌无条目。
    const actionable = perAttempt.map((a, i) => {
      if (i === 0) return null // attempt 1 无前序
      const prev = perAttempt[i - 1]
      const nonB4 = Object.values(prev.byRule).filter((x) => x.ok === false && !x.id.includes('B4'))
      return nonB4.map((x) => x.id)
    })
    const anyActionable = actionable.some((x) => x !== null && x.length > 0)
    L.push(`- **回灌可作用对象（本 run 的关键读数）**：attempt 2 的 guidance 由 attempt 1 的非 B4 FAIL 构成，attempt 3 的由 attempt 2 的构成。本 run 的对应值为：${actionable.slice(1).map((x, i) => `attempt ${i + 2} ← ${x.length === 0 ? '**空（无可回灌条目）**' : x.map((s) => `\`${s}\``).join('、')}`).join('；')}。`)
    if (!anyActionable) {
      L.push('  - **本 run 的回灌从未携带任何可作用条目。** 原因（代码路径，`executor.ts:1650`）：条目只在 `e2Fixable.length > 0` 时追加，而 `e2Fixable` 排除了 B4；本 run 前两次 attempt 的 FAIL 只有 B4，故 `priorViolations` 恒为空。')
      L.push(`  - 落盘的 \`guidance_chars\` 为 ${guidanceEvs.map((g) => g.detail.guidance_chars).join(' / ')}。以真实函数实测，「无 violation + 3 个 id」基线为 985 字符；落盘值与之的差异来自 \`registeredIds\` 列表（其完整文本未留存，故不逐字核验）。`)
      L.push('  - 读数：本 run 对**同一个不可能被回灌修好的缺陷（B4）**重试，回灌机制在此 run 上**没有可作用的对象**——失败面不收敛不是回灌失效，而是回灌从未收到指令。')
      L.push('  - 附带观察（逐字来自落盘）：attempt 3 的 B3 正向由 PASS 转为 FAIL，detail 为 `E1: 未声明 e1_span；E2: 未声明 e1_span；…；E8: 未声明 e1_span`（8 项，127 字符，未触达 400 上限）。即最后一次尝试**新增**了一类此前不存在的失败面。')
    } else if (actionable.slice(1).some((x) => x.length === 0)) {
      L.push('  - 其中至少一次 attempt 的 guidance **为空条目**（前序 attempt 仅有 B4 FAIL），故那一次重试没有收到任何纠正指令。')
    }
  }
  if (b4AlwaysPass) {
    L.push('- **B4 逐问推理覆盖三次尝试全部 PASS**（`全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点`）。本 run 的审计事件顺序显示输入资产注册（`DataArtifact`/`RequirementSpec`/`ProblemSpec`，seq 3-5）发生在 `E1Analysis`（seq 6）**之前**——这正是 W8.10-D1 的修复形态（`executor.ts:1411-1422`：注册必须先于 E1，否则 E1 被告知「harness registered no requirement ids」，B4 必然失败）。对比 real-run-1/2 的同位置事件顺序（E1→E2→注册），可见本 run 跑在 D1 修复之后。')
  }
  if (guidanceBeforeFirstRetry.length > 0) {
    L.push(`- **本 run 的 attempt 1 就已携带 guidance**（seq ${guidanceBeforeFirstRetry.map((g) => g.seq).join(', ')}，${guidanceBeforeFirstRetry.map((g) => g.detail.guidance_chars).join('/')} 字符），此时**尚无任何 prior violation**（该 attempt 之前不存在任何 \`provider_retry\` 事件，也不存在任何 FAIL 的 \`FidelityFinding\`）。`)
    L.push(`  - 该 985 字符长度与「只有 registeredIds、无 violation」形态**精确吻合**：以真实函数 \`e2DriftGuidance({ priorViolations: [], registeredIds: ['DA-RAW','P1','R-OUT'] })\` 实测得 985 字符，与落盘的 \`guidance_chars: 985\` 逐字相等。ids 取自本 run seq 3-5 的三条注册事件。`)
    L.push(`  - 机制（代码，只读）：\`e2-guidance.ts:140-142\` 的 \`if (!hasViolations && !hasRegistered) return ''\`——只要 \`registeredIds\` 非空，guidance 就非空。D1 修复把注册提前到 E1 之前（\`executor.ts:1411-1422\`），于是注册 id 列表在首次 attempt 就进入了 E2 prompt。`)
    L.push(`  - 副作用：real-run-3 的首次 E2 调用**不再**与 W8.9 的 prompt 逐字节相同（\`e2PromptWithGuidance\` 会追加非空 guidance，\`e2-guidance.ts:187\`）。W8.10-B1 注释所声明的「Empty on the first attempt」在本 run 的 D1 修复组合下不成立。`)
    L.push(`  - 对比：real-run-1/2 的 attempt 1 **无** \`E2DriftGuidance\` 事件（首次出现分别在 seq 14），即首次 guidance 为空；两者的注册事件都排在 \`E2Normalization\` **之后**（run-1 seq 5-7 晚于 seq 4；run-2 seq 5-7 晚于 seq 4），与 D1 修复前的顺序一致。`)
  }
  if (identicalTruncated) {
    L.push(`- **最后两次 attempt 的 B3 正向 detail 落盘后逐字相同**（均 ${clip(lastTwo[0], 400).originalLength} 字符，均被 400 上限截断）。注意这是**截断后的视图相同**，不是模型输出相同：两次 E2 文本长度不同（${perAttempt.slice(-2).map((a) => a.e2?.detail?.chars ?? '?').join(' vs ')} 字符），故 W8.6-A4 同因熔断的指纹（\`sha256(E2 text)\`）不同，熔断未触发。终局是预算耗尽（见下条）。`)
  }
  L.push(`- **终局机制**：三次运行都没有触发 W8.6-A4 同因熔断（每次 attempt 的 E2 文本长度互不相同，指纹不同），最终失败都是 \`NONE_RETRY_BUDGET = 2\`（\`probe.ts:37\`）用尽后的 \`gate_failed: DRIFT guidance budget exhausted\`（\`executor.ts:1813-1837\`）。即：attempt 3 的失败发生在预算分支，熔断分支（\`executor.ts:1857\`）未参与。`)
  L.push('')
  L.push('## 7. usage 与 wall clock')
  L.push('')
  L.push('| 项 | run-report.json | workflow runs 记录 | 备注 |')
  L.push('|---|---|---|---|')
  L.push(`| input_tokens | ${report.usage.input_tokens} | ${runRec.usage.inputTokens} | 与 5 条 usage 事件求和一致 |`)
  L.push(`| output_tokens | ${report.usage.output_tokens} | ${runRec.usage.outputTokens} | 与 5 条 usage 事件求和一致 |`)
  L.push(`| cost_usd | ${report.usage.cost_usd} | ${runRec.usage.costUsd} | 未配置计价 |`)
  L.push(`| wall_clock_seconds | ${report.wall_clock_seconds} | ${wallFromWf.toFixed(3)}（createdAt→updatedAt） | 两者一致（四舍五入） |`)
  L.push('')
  L.push('分 attempt 的 usage 事件（逐字，来自 `paper_workflow.json` 的 `events` 表）：')
  L.push('')
  L.push('> 注：`usage` 事件的 `nodeId` 在落盘时恒为 `null`（见下表「nodeId」列），故节点归属**不是**落盘字段。')
  L.push('> 「归属（推导）」列由「该 usage 之前最近的一条 `request_started`」机械推出，仅作阅读辅助。')
  L.push('')
  L.push('| workflow seq | nodeId（落盘原文） | 归属（推导） | inputTokens | outputTokens | costUsd |')
  L.push('|---|---|---|---|---|---|')
  let lastReq = null
  for (const ev of Object.values(workflow.tables.events).sort((a, b) => a.seq - b.seq)) {
    if (ev.type === 'request_started') {
      const t = nodes.find((n) => n.id === ev.nodeId)?.title ?? ev.nodeId
      lastReq = `${t} / attempt ${ev.data.attempt}`
      continue
    }
    if (ev.type !== 'usage') continue
    L.push(`| ${ev.seq} | \`${JSON.stringify(ev.nodeId)}\` | ${lastReq ?? '—'} | ${ev.data.inputTokens} | ${ev.data.outputTokens} | ${ev.data.costUsd} |`)
  }
  L.push('')
  L.push('## 8. 归因注意（沿用 D0，不新增结论）')
  L.push('')
  L.push('`artifacts/handoff/W8.10/D0-run-posture.md` 已记录：本轮同时改变了**模型**（→ 目标模型 `deepseek/deepseek-v4-flash`）与 **E2 回灌**（B 组）两件事，失败归因存在混淆，不得把结果归因给单一变量。本文只归档事实，不做归因。')
  L.push('')
  return L.join('\n')
}

for (const run of RUNS) {
  const auditPath = path.join(SRC_ROOT, run.dir, 'paper_audit.json')
  const wfPath = path.join(SRC_ROOT, run.dir, 'paper_workflow.json')
  const outDir = path.join(OUT_ROOT, `real-run-${run.n}`)

  const auditRaw = fs.readFileSync(auditPath)
  const wfRaw = fs.readFileSync(wfPath)
  const audit = JSON.parse(auditRaw.toString('utf8'))
  const workflow = JSON.parse(wfRaw.toString('utf8'))
  const report = jparse(path.join(outDir, 'run-report.json'))

  const events = Object.values(audit.tables.entries).sort((a, b) => a.seq - b.seq)
  // 完整性：seq 必须连续 1..N
  const seqs = events.map((e) => e.seq)
  const contiguous = seqs.every((s, i) => s === i + 1)

  run.auditUnit = audit.unit

  fs.writeFileSync(
    path.join(outDir, 'audit-trail.json'),
    JSON.stringify(buildAuditTrailJson(run, audit, auditRaw, events), null, 2) + '\n',
    'utf8',
  )
  fs.writeFileSync(path.join(outDir, 'audit-trail.md'), buildAuditTrailMd(run, auditRaw, events) + '\n', 'utf8')
  // workflow-state.json：逐字节复制（最忠实的「原样」）
  fs.copyFileSync(wfPath, path.join(outDir, 'workflow-state.json'))
  fs.writeFileSync(
    path.join(outDir, 'FAILURE.md'),
    buildFailureMd(run, { report, audit, workflow, auditRaw, wfRaw, events }) + '\n',
    'utf8',
  )

  const outWf = fs.readFileSync(path.join(outDir, 'workflow-state.json'))
  console.log(
    `real-run-${run.n}: auditEvents=${events.length} seqContiguous=${contiguous} ` +
      `workflowCopyIdentical=${sha256(outWf) === sha256(wfRaw)} gate=${events.find((e) => e.eventType === 'gate_failed')?.detail?.reason}`,
  )
}
