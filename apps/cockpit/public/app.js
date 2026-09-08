/**
 * Paper Cockpit 前端 — 纯投影层,零引擎语义。
 * 一切状态来自 API 投影(activeRuns / run 记录 / 事件流 / manifest / falseblock),
 * 本文件不计算哈希、不判断门逻辑、不发明引擎没有的状态。
 */
(() => {
'use strict';

// ---------------------------------------------------------------------------
// 环境
// ---------------------------------------------------------------------------

// 同源部署走相对路径;file:// 双击打开时退化为直连本机服务(连不上则显示灰条,不白屏)。
const API_BASE = (location.protocol === 'http:' || location.protocol === 'https:')
  ? '' : 'http://127.0.0.1:3081';

const LS_CONSENT = 'pc.consent.v1';
const LS_RUNS    = 'pc.runs.v1';

const $ = (id) => document.getElementById(id);

const PROBLEM_EXT = ['md', 'tex', 'pdf', 'docx'];   // 题面
const DATA_EXT = ['csv', 'xlsx'];                    // 数据(只被求解代码读取)

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

/** key(runId 或 runKey) → 投影条目 */
const runs = new Map();
let selectedKey = null;
let stagedProblem = null;          // {name, contentBase64}
let stagedData = [];               // [{name, contentBase64}]
let uploadResult = null;           // {problemPath, problem_sha256, dataFiles}
let online = null;                 // null=未探测 true/false
let manifest = null;               // /api/manifest 投影
let manifestDetailOpen = false;
let selectedNodeId = null;
// TASK-C1.5:API 配置(profiles)。draftProfiles 是面板内的编辑副本,点「保存设置」才 POST。
let settings = null;               // GET /api/settings 投影 {activeId, envFallback, profiles:[…]}
let draftProfiles = [];            // 编辑副本:[{id?, name, endpoint, model, provider, test:{state,detail,models,chosen}}]
let draftActiveId = null;
let settingsOpen = false;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
function show(node, on) { node.style.display = on ? '' : 'none'; }

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}
function trunc(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

let toastTimer = null;
function toast(msg, ms) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms || 3200);
}

function downloadText(name, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------------------------------------------------------------------------
// 连接层:所有请求过这里;断网 → 顶部灰条,恢复自动撤除
// ---------------------------------------------------------------------------

function setOnline(v) {
  if (online === v) return;
  online = v;
  $('connStrip').classList.toggle('on', v === false);
  const dot = $('connDot'), txt = $('connText');
  dot.className = 'dot' + (v ? ' ok' : ' bad');
  txt.textContent = v ? '已连接' : '服务未连接';
}

async function apiFetch(path, opts) {
  let res;
  try {
    res = await fetch(API_BASE + path, opts);
  } catch (e) {
    setOnline(false);
    const err = new Error('网络错误,无法连接驾驶舱服务');
    err.network = true;
    throw err;
  }
  setOnline(true);
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  if (!res.ok) {
    const err = new Error((body && body.reason) ? body.reason : ('HTTP ' + res.status));
    err.httpStatus = res.status;
    err.reason = (body && body.reason) ? body.reason : null;
    throw err;
  }
  return body;
}

function showReason(barId, prefix, error) {
  const bar = $(barId);
  clear(bar);
  bar.appendChild(el('span', null, prefix));
  bar.appendChild(document.createTextNode(error && error.message ? error.message : String(error)));
  bar.classList.add('on');
}
function hideReason(barId) { $(barId).classList.remove('on'); }

// ---------------------------------------------------------------------------
// 投影词表(全部映射自引擎原始取值,不发明)
// ---------------------------------------------------------------------------

const SHELL_STATUS = {
  starting:  { label: '启动中', dot: 'warn' },
  running:   { label: '运行中', dot: 'live' },
  DELIVERED: { label: '已交付', dot: 'ok' },
  BLOCKED:   { label: '被拦截', dot: 'bad' },
  FAILED:    { label: '失败',   dot: 'bad' },
};
const RUN_STATUS = {           // RunRecord.status(引擎原值)
  planning:  { label: '规划中' },
  running:   { label: '进行中' },
  paused:    { label: '已暂停' },
  completed: { label: '已完成' },
  failed:    { label: '已失败' },
  cancelled: { label: '已取消' },
};
const NODE_STATE = {           // node.state(引擎原值)
  pending:   { label: '待执行', dot: '' },
  ready:     { label: '就绪',   dot: '' },
  running:   { label: '进行中', dot: 'live' },
  succeeded: { label: '已完成', dot: 'ok' },
  failed:    { label: '受阻',   dot: 'bad' },
  skipped:   { label: '已跳过', dot: '' },
  paused:    { label: '已暂停', dot: 'warn' },
};
const NODE_TYPE = { plan: '计划', execute: '执行', review: '评审', revise: '修订', deliver: '交付' };

function shellStatusOf(entry) { return SHELL_STATUS[entry.shell.status] || { label: entry.shell.status, dot: '' }; }

function statusDot(entry) {
  const s = entry.engine && entry.engine.run && entry.engine.run.status;
  if (s === 'failed') return 'bad';
  if (s === 'completed') return 'ok';
  if (s === 'running') return 'live';
  const sh = shellStatusOf(entry);
  return sh.dot || '';
}
function statusLabel(entry) {
  const r = entry.engine && entry.engine.run;
  if (r && RUN_STATUS[r.status]) return RUN_STATUS[r.status].label + '(引擎)';
  return shellStatusOf(entry).label;
}

// ---------------------------------------------------------------------------
// 投影条目管理
// ---------------------------------------------------------------------------

function ensureEntry(key) {
  let e = runs.get(key);
  if (!e) {
    e = {
      key,
      runKey: null, runId: null,
      shell: { status: 'starting', startedAt: null, tier: null, mode: null, fake: null, reportPath: null, outputHead: '' },
      engine: { run: null, nodes: [], events: [], artifacts: [] },
      engineReason: null,   // GET run 投影失败时的后端 reason 原文
      usageAcc: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      lastSeq: 0,
      es: null,
      sseState: 'idle',     // idle | connecting | live | reconnecting
      hydrated: false,
    };
    runs.set(key, e);
  }
  return e;
}

/** 把 /api/runs/active 的一条投影合并进本地 */
function mergeActive(rec) {
  const key = rec.runId || rec.runKey;
  if (!key) return null;
  // 运行结束前后端从"只有 runKey"变为"拿到 runId":把旧键条目迁移到 runId 键下
  let e = runs.get(key);
  if (!e && rec.runId && rec.runKey && runs.has(rec.runKey)) {
    e = runs.get(rec.runKey);
    runs.delete(rec.runKey);
    e.key = key;
    runs.set(key, e);
    if (selectedKey === rec.runKey) selectedKey = key;
  }
  if (!e) e = ensureEntry(key);
  e.runKey = rec.runKey || e.runKey;
  e.runId = rec.runId || e.runId;
  e.shell.status = rec.status || e.shell.status;
  e.shell.startedAt = rec.startedAt || e.shell.startedAt;
  e.shell.tier = rec.tier ?? e.shell.tier;
  e.shell.mode = rec.mode ?? e.shell.mode;
  e.shell.fake = rec.fake ?? e.shell.fake;
  e.shell.reportPath = rec.reportPath || e.shell.reportPath;
  e.shell.outputHead = rec.outputHead || e.shell.outputHead;
  if (e.runId && !e.hydrated) hydrate(e, false);
  return e;
}

function persistRuns() {
  try {
    const arr = [...runs.values()].slice(-8).map(e => ({
      key: e.key, runKey: e.runKey, runId: e.runId,
      shell: e.shell, lastSeq: e.lastSeq,
    }));
    localStorage.setItem(LS_RUNS, JSON.stringify(arr));
  } catch (e) { /* 隐私模式等场景忽略 */ }
}

async function restoreRuns() {
  let arr = null;
  try { arr = JSON.parse(localStorage.getItem(LS_RUNS) || 'null'); } catch (e) { arr = null; }
  if (!Array.isArray(arr)) return;
  for (const raw of arr) {
    const e = ensureEntry(raw.key);
    Object.assign(e, { runKey: raw.runKey || null, runId: raw.runId || null, lastSeq: raw.lastSeq || 0 });
    if (raw.shell) Object.assign(e.shell, raw.shell);
    if (e.runId) hydrate(e, false);
  }
  if (arr.length) selectedKey = arr[arr.length - 1].key;
}

/** GET /api/runs/:runId 全量恢复;之后由 SSE 增量续传(afterSeq=最后 seq) */
async function hydrate(e, selectAfter) {
  if (!e.runId || e.hydrating) return;
  if (e.hydrateBackoff && Date.now() < e.hydrateBackoff) return;
  e.hydrating = true;
  try {
    const body = await apiFetch('/api/runs/' + encodeURIComponent(e.runId));
    e.engine = {
      run: Array.isArray(body.run) && body.run.length ? body.run[0] : (body.run && !Array.isArray(body.run) ? body.run : null),
      nodes: Array.isArray(body.nodes) ? body.nodes : [],
      events: Array.isArray(body.events) ? body.events : [],
      artifacts: Array.isArray(body.artifacts) ? body.artifacts : [],
    };
    e.engineReason = null;
    e.hydrateBackoff = 0;
    e.hydrated = true;
    for (const ev of e.engine.events) {
      if (typeof ev.seq === 'number' && ev.seq > e.lastSeq) e.lastSeq = ev.seq;
      applyUsageFromEvent(e, ev);
    }
    connectSSE(e);
    if (selectAfter) selectedKey = e.key;
    renderAll();
  } catch (err) {
    e.engineReason = err.message;
    // 404(记录尚未落盘)每 15s 重试一次,避免每轮轮询都打一次;其他错误同样退避
    e.hydrateBackoff = err.httpStatus === 404 ? Date.now() + 15000 : Date.now() + 60000;
    if (selectAfter) selectedKey = e.key;
    renderAll();
  } finally {
    e.hydrating = false;
  }
}

/** usage 事件累计(spec ③);snapshot 的 run.usage(引擎权威合计)存在时优先展示它 */
function applyUsageFromEvent(e, ev) {
  if (!ev || ev.type !== 'usage' || !ev.data) return;
  const d = ev.data;
  if (typeof d.inputTokens === 'number') {
    e.usageAcc.inputTokens += d.inputTokens;
    e.usageAcc.outputTokens += typeof d.outputTokens === 'number' ? d.outputTokens : 0;
    e.usageAcc.costUsd += typeof d.costUsd === 'number' ? d.costUsd : 0;
  }
}

// ---------------------------------------------------------------------------
// SSE(断线由 EventSource 原生重连;seq 去重保证恢复后不重复渲染)
// ---------------------------------------------------------------------------

function connectSSE(e) {
  if (!e.runId || e.es) return;
  const url = API_BASE + '/api/runs/' + encodeURIComponent(e.runId) + '/stream?afterSeq=' + e.lastSeq;
  const es = new EventSource(url);
  e.es = es;
  e.sseState = 'connecting';

  es.addEventListener('open', () => { e.sseState = 'live'; renderTlConn(e); });
  es.addEventListener('error', () => {
    // 原生自动重连;URL 里 afterSeq 固定,服务端可能重放旧事件 → 靠 seq 去重
    if (e.es === es) e.sseState = 'reconnecting';
    renderTlConn(e);
  });
  es.addEventListener('engine', (msg) => {
    let payload = null;
    try { payload = JSON.parse(msg.data); } catch (err) { return; }
    if (!payload || payload.kind !== 'event' || !payload.event) return;
    applyEngineEvent(e, payload.event);
  });
  es.addEventListener('snapshot', (msg) => {
    let payload = null;
    try { payload = JSON.parse(msg.data); } catch (err) { return; }
    if (!payload || payload.kind !== 'snapshot') return;
    // 服务端每轮都重发 snapshot:仅在内容变化时重渲染
    const next = {
      run: payload.run || null,
      nodes: Array.isArray(payload.nodes) ? payload.nodes : e.engine.nodes,
      artifacts: Array.isArray(payload.artifacts) ? payload.artifacts : e.engine.artifacts,
    };
    const prev = { run: e.engine.run, nodes: e.engine.nodes, artifacts: e.engine.artifacts };
    if (JSON.stringify(next) !== JSON.stringify(prev)) {
      e.engine.run = next.run;
      e.engine.nodes = next.nodes;
      e.engine.artifacts = next.artifacts;
      e.engineReason = null;
      renderAll();
    }
  });
}

function applyEngineEvent(e, ev) {
  if (typeof ev.seq !== 'number') return;
  if (ev.seq <= e.lastSeq) return; // 断线重放去重
  e.lastSeq = ev.seq;
  e.engine.events.push(ev);
  e.engineReason = null;
  applyUsageFromEvent(e, ev);
  // run_state 事件直接推进本地 run 状态(投影)
  if (ev.type === 'run_state' && ev.data && ev.data.to && e.engine.run) {
    e.engine.run.status = ev.data.to;
  }
  renderAll();
  persistRuns();
}

function renderTlConn(e) {
  const node = $('tlConn');
  if (!e) { node.textContent = ''; return; }
  const map = { connecting: '实时连接:连接中…', live: '实时连接:已连接', reconnecting: '实时连接:断线,自动重连中…', idle: '' };
  node.textContent = map[e.sseState] || '';
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

function selectedEntry() { return selectedKey ? (runs.get(selectedKey) || null) : null; }

function renderAll() {
  renderChips();
  const e = selectedEntry();
  renderTimeline(e);
  renderDelivery(e);
  renderNodes(e);
  renderDetail(e);
  renderAux(e);
  persistRuns();
}

function renderChips() {
  const box = $('runChips');
  clear(box);
  if (runs.size === 0) { box.style.display = 'none'; return; }
  box.style.display = '';
  for (const e of runs.values()) {
    const chip = el('button', 'run-chip' + (e.key === selectedKey ? ' sel' : ''));
    chip.type = 'button';
    chip.appendChild(el('span', 'dot ' + statusDot(e)));
    const idLabel = e.runId ? e.runId.slice(0, 8) : (e.runKey || '');
    chip.appendChild(el('span', null, idLabel + ' · ' + statusLabel(e)));
    if (e.shell.fake) chip.appendChild(el('span', 'chip', '演示'));
    chip.addEventListener('click', () => { selectedKey = e.key; selectedNodeId = null; renderAll(); });
    box.appendChild(chip);
  }
}

function evLine(ev) {
  const row = el('div', 'ev');
  row.appendChild(el('span', 'ev-type', ev.type));
  if (ev.timestamp) row.appendChild(el('span', 'ev-time', fmtTime(ev.timestamp)));
  row.appendChild(el('span', 'ev-data', evSummary(ev)));
  return row;
}

/** 事件 data → 一行人话摘要;未知形状退回 JSON 原文(投影,不翻译发明) */
function evSummary(ev) {
  const d = ev.data || {};
  switch (ev.type) {
    case 'run_state':    return `运行状态 ${d.from ?? '—'} → ${d.to ?? '—'}`;
    case 'node_created': return `节点创建(state=${d.state ?? '—'}, type=${d.type ?? '—'})`;
    case 'node_state':   return `节点状态 ${d.from ?? '—'} → ${d.to ?? '—'}`;
    case 'request_started': return `第 ${d.attempt ?? '?'} 次模型请求 · ${d.provider ?? '—'}/${d.model ?? '—'}`;
    case 'usage':
      if (typeof d.inputTokens === 'number') return `输入 +${d.inputTokens} · 输出 +${d.outputTokens} · 成本 $${d.costUsd}`;
      if (d.budgetState) return `预算:${d.budgetState} · 上限 $${d.limitUsd} · 已用 $${d.spentUsd}`;
      return trunc(JSON.stringify(d), 160);
    case 'defect':       return `[${d.severity ?? '?'}] ${d.description ?? ''}(${d.defectId ?? '—'})`;
    case 'gate_result':  return `${d.gate ?? '—'}:${d.passed ? 'PASS' : 'BLOCKED'} · 缺陷合计 ${d.defects_total ?? 0}(critical ${d.defects_critical ?? 0} / advisory ${d.advisory ?? 0})`;
    case 'delivery_authorized': return `授权于 ${d.authorizedAt ?? '—'} · 门:(${(Array.isArray(d.gates) ? d.gates : []).join(', ')})`;
    case 'plan_ready':   return `计划就绪(${d.status ?? '—'})`;
    case 'paused':       return `暂停(${d.reason ?? '—'})`;
    case 'recovery':     return `恢复 ${d.from ?? '—'} → ${d.to ?? '—'}`;
    default:
      try { return trunc(JSON.stringify(d), 160); } catch (e) { return ''; }
  }
}

function renderTimeline(e) {
  const box = $('timeline');
  clear(box);
  renderTlConn(e);
  if (!e) {
    box.appendChild(el('div', 'empty', '还没有运行——拖入题目,或点右上角"一键演示"。'));
    return;
  }

  const tl = el('div', 'tl');

  // --- 运行状态节 ---
  const secRun = el('section', 'tl-sec');
  secRun.appendChild(el('span', 'dot ' + statusDot(e)));
  const runTitle = el('div', 'tl-title');
  runTitle.appendChild(el('span', 't', '运行 ' + statusLabel(e)));
  runTitle.appendChild(el('span', 'mono-id', e.runId || (e.runKey || '')));
  secRun.appendChild(runTitle);
  const runBody = el('div', 'tl-body');
  const metaBits = [];
  if (e.shell.tier) metaBits.push('tier ' + e.shell.tier);
  if (e.shell.mode) metaBits.push('mode ' + e.shell.mode);
  if (e.shell.fake) metaBits.push('fake(演示)');
  if (e.shell.startedAt) metaBits.push('开始于 ' + fmtTime(e.shell.startedAt));
  if (metaBits.length) runBody.appendChild(el('div', 'hint', metaBits.join(' · ')));
  if (e.engineReason) {
    runBody.appendChild(el('div', 'hint', '引擎记录投影:' + e.engineReason));
  }
  secRun.appendChild(runBody);
  tl.appendChild(secRun);

  // --- 节点节(标题取 node.title 原文,type 徽章取引擎枚举的标准对应词) ---
  const nodes = e.engine.nodes;
  const events = e.engine.events.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
  for (const node of nodes) {
    const st = NODE_STATE[node.state] || { label: node.state || '—', dot: '' };
    const sec = el('section', 'tl-sec');
    const dot = el('span', 'dot ' + (st.dot || ''));
    sec.appendChild(dot);
    const title = el('div', 'tl-title');
    title.appendChild(el('span', 't', node.title || node.id));
    if (NODE_TYPE[node.type]) title.appendChild(el('span', 'chip', NODE_TYPE[node.type]));
    title.appendChild(el('span', 'chip', st.label));
    title.appendChild(el('span', 'mono-id', `第 ${node.attempts ?? 0}/${node.maxAttempts ?? '?'} 次`));
    sec.appendChild(title);
    const body = el('div', 'tl-body');
    if (node.lastErrorCode) body.appendChild(el('div', 'ev', '')).appendChild(el('span', 'ev-data', 'lastErrorCode: ' + node.lastErrorCode));
    const nodeEvents = events.filter(ev => ev.nodeId === node.id);
    for (const ev of nodeEvents.slice(-30)) body.appendChild(evLine(ev));
    sec.appendChild(body);
    tl.appendChild(sec);
  }

  // --- 门禁节(gate_result 逐门) ---
  const gateEvents = events.filter(ev => ev.type === 'gate_result');
  if (gateEvents.length) {
    const sec = el('section', 'tl-sec');
    sec.appendChild(el('span', 'dot ' + (gateEvents.some(ev => ev.data && ev.data.passed === false) ? 'bad' : 'ok')));
    const title = el('div', 'tl-title');
    title.appendChild(el('span', 't', '门禁'));
    sec.appendChild(title);
    const body = el('div', 'tl-body');
    for (const ev of gateEvents) {
      const passed = ev.data && ev.data.passed === true;
      const line = el('div', 'gate-line');
      line.classList.add('ev', passed ? 'gate-pass' : 'gate-fail');
      line.appendChild(el('span', 'ev-type', ev.data && ev.data.gate ? String(ev.data.gate) : 'gate'));
      line.appendChild(el('span', null, passed ? 'PASS' : 'BLOCKED'));
      line.appendChild(el('span', 'ev-data', evSummary(ev)));
      body.appendChild(line);
      // 拦截时把该 run 的 defect 描述(引擎原文)跟在门下
      if (!passed) {
        const defects = events.filter(d => d.type === 'defect').slice(-5);
        for (const d of defects) body.appendChild(evLine(d));
      }
    }
    sec.appendChild(body);
    tl.appendChild(sec);
  }

  // --- 交付授权节 ---
  const delEvents = events.filter(ev => ev.type === 'delivery_authorized');
  if (delEvents.length) {
    const sec = el('section', 'tl-sec');
    sec.appendChild(el('span', 'dot ok'));
    const title = el('div', 'tl-title');
    title.appendChild(el('span', 't', '交付授权'));
    sec.appendChild(title);
    const body = el('div', 'tl-body');
    for (const ev of delEvents) { const line = evLine(ev); line.classList.add('delivery'); body.appendChild(line); }
    sec.appendChild(body);
    tl.appendChild(sec);
  }

  // --- 事件流兜底:无节点投影但确有事件时,平铺最近事件 ---
  if (!nodes.length && events.length) {
    const sec = el('section', 'tl-sec');
    sec.appendChild(el('span', 'dot'));
    const title = el('div', 'tl-title');
    title.appendChild(el('span', 't', '事件流'));
    sec.appendChild(title);
    const body = el('div', 'tl-body');
    for (const ev of events.slice(-60)) body.appendChild(evLine(ev));
    sec.appendChild(body);
    tl.appendChild(sec);
  }

  // --- usage 条 ---
  const usage = usageOf(e);
  if (usage) {
    const strip = el('div', 'usage-strip');
    strip.appendChild(el('span')).append('输入 tokens ', (() => { const b = el('b'); b.textContent = String(usage.inputTokens); return b; })());
    strip.appendChild(el('span')).append('输出 tokens ', (() => { const b = el('b'); b.textContent = String(usage.outputTokens); return b; })());
    strip.appendChild(el('span')).append('累计成本 ', (() => { const b = el('b'); b.textContent = '$' + (Number(usage.costUsd) || 0); return b; })());
    tl.appendChild(strip);
  }

  // --- 空态(诚实):没有引擎事件且 shell 在途 ---
  if (!nodes.length && !events.length && !e.engineReason) {
    const sh = shellStatusOf(e);
    if (e.shell.status === 'starting' || e.shell.status === 'running') {
      tl.appendChild(el('div', 'hint', '引擎事件尚未投影到本页——运行进行中,本页会随服务端投影自动更新。'));
    } else if (!delEvents.length) {
      tl.appendChild(el('div', 'hint', '该运行暂未产生可投影的引擎事件(运行状态见"交付区"输出)。'));
    }
  }

  box.appendChild(tl);
}

function usageOf(e) {
  const ru = e.engine && e.engine.run && e.engine.run.usage;
  if (ru && (ru.inputTokens || ru.outputTokens || ru.costUsd)) return ru;
  const a = e.usageAcc;
  if (a.inputTokens || a.outputTokens || a.costUsd) return a;
  return null;
}

// ---------------------------------------------------------------------------
// ② 交付区
// ---------------------------------------------------------------------------

function deliveryVerdict(e) {
  const s = e.shell.status;
  if (s === 'DELIVERED') return { cls: 'ok',   title: '已交付',        sub: '报告与校验信息见下方输出。' };
  if (s === 'BLOCKED')   return { cls: 'bad',  title: '被门禁拦截',    sub: '引擎输出的原文见下方;如认为拦截不当,可提交"误杀申诉"。' };
  if (s === 'FAILED')    return { cls: 'warn', title: '运行失败',      sub: '引擎输出的原文见下方。' };
  return null;
}

function projectionText(e) {
  const lines = [];
  lines.push('# Paper Cockpit — 运行投影');
  lines.push('runId: ' + (e.runId || '(未知)'));
  lines.push('runKey: ' + (e.runKey || '(未知)'));
  lines.push('status: ' + e.shell.status);
  lines.push('tier: ' + (e.shell.tier ?? '—') + '  mode: ' + (e.shell.mode ?? '—') + '  fake: ' + String(e.shell.fake ?? '—'));
  lines.push('startedAt: ' + (e.shell.startedAt || '—'));
  if (e.engine && e.engine.run) {
    const u = e.engine.run.usage || {};
    lines.push(`usage: inputTokens=${u.inputTokens ?? 0} outputTokens=${u.outputTokens ?? 0} costUsd=${u.costUsd ?? 0}`);
  }
  lines.push('reportPath: ' + (e.shell.reportPath || '(未提供)'));
  lines.push('');
  lines.push('== 引擎输出(尾部原文)==');
  lines.push(e.shell.outputHead || '(空)');
  return lines.join('\n');
}

function renderDelivery(e) {
  const emptyBox = $('deliveryEmpty'), body = $('deliveryBody');
  if (!e) {
    show(emptyBox, true); show(body, false);
    $('deliveryAux').textContent = '';
    const row = document.querySelector('#deliveryBody .dl-row');
    if (row) row.classList.remove('on');
    return;
  }
  show(emptyBox, false); show(body, true);
  $('deliveryAux').textContent = 'run ' + (e.runId ? e.runId.slice(0, 8) : (e.runKey || ''));

  const v = $('verdict');
  clear(v);
  const verdict = deliveryVerdict(e);
  if (verdict) {
    v.className = 'verdict on ' + verdict.cls;
    const inner = el('div', 'v-body');
    const t = el('div', 'v-title');
    t.appendChild(el('span', 'dot ' + verdict.cls, ''));
    t.appendChild(el('span', null, verdict.title));
    inner.appendChild(t);
    inner.appendChild(el('div', 'v-sub', verdict.sub));
    v.appendChild(inner);
  } else {
    v.className = 'verdict on';
    const inner = el('div', 'v-body');
    const t = el('div', 'v-title');
    t.appendChild(el('span', 'dot ' + (statusDot(e) || 'live'), ''));
    t.appendChild(el('span', null, '运行 ' + statusLabel(e)));
    inner.appendChild(t);
    inner.appendChild(el('div', 'v-sub', '运行结束后,报告与输出会显示在这里。'));
    v.appendChild(inner);
  }

  const rp = $('reportPath');
  clear(rp);
  if (e.shell.reportPath) {
    rp.classList.add('on');
    rp.append('报告路径(引擎投影):');
    rp.appendChild(el('code', null, e.shell.reportPath));
  } else {
    rp.classList.remove('on');
  }

  const oh = $('outputHead');
  if (e.shell.outputHead) {
    oh.classList.add('on');
    oh.textContent = e.shell.outputHead;
  } else {
    oh.classList.remove('on');
    oh.textContent = '';
  }

  show($('btnDownload'), true);
  show($('btnPreviewReport'), true);
  // 按钮行容器靠 .on class 显示(inline style 压不过 CSS display:none——同 manifestDetail 的坑)
  document.querySelector('#deliveryBody .dl-row').classList.add('on');
  const blocked = e.shell.status === 'BLOCKED' || (e.engine.events || []).some(ev => ev.type === 'gate_result' && ev.data && ev.data.passed === false);
  show($('btnAppealTop'), blocked);
}

// ---------------------------------------------------------------------------
// ④ 节点视图 + 详情/溯源
// ---------------------------------------------------------------------------

function renderNodes(e) {
  const grid = $('nodeGrid'), empty = $('nodesEmpty');
  clear(grid);
  const nodes = e ? (e.engine.nodes || []) : [];
  if (!nodes.length) {
    show(grid, false);
    empty.textContent = e ? '该运行暂未投影出节点记录。' : '还没有运行——拖入题目,或点右上角"一键演示"。';
    show(empty, true);
    $('btnExport').disabled = !e;
    return;
  }
  show(grid, true); show(empty, false);
  $('btnExport').disabled = false;
  for (const node of nodes) {
    const st = NODE_STATE[node.state] || { label: node.state || '—', dot: '' };
    const card = el('button', 'node-card' + (node.state === 'failed' ? ' blocked' : '') + (node.id === selectedNodeId ? ' sel' : ''));
    card.type = 'button';
    const title = el('div', 'n-title');
    title.appendChild(el('span', 'dot ' + (st.dot || '')));
    title.appendChild(el('span', null, node.title || node.id));
    card.appendChild(title);
    const meta = el('div', 'n-meta');
    meta.appendChild(el('span', 'chip', st.label));
    if (NODE_TYPE[node.type]) meta.appendChild(el('span', 'chip', NODE_TYPE[node.type]));
    meta.appendChild(el('span', null, `第 ${node.attempts ?? 0}/${node.maxAttempts ?? '?'} 次`));
    card.appendChild(meta);
    if (node.lastErrorCode) card.appendChild(el('div', 'n-err', node.lastErrorCode));
    card.addEventListener('click', () => { selectedNodeId = node.id; renderAll(); });
    grid.appendChild(card);
  }
}

/** 在事件 data 里按字段名命中 sha256 / hash / locator / artifact(字段名与值全部原文投影) */
const FIELD_KEYS = ['sha256', 'hash', 'content_hash', 'locator', 'artifact', 'storageKey', 'digest'];

function collectFieldHits(events) {
  const hits = [];
  for (const ev of events) {
    walk(ev.data, '', ev);
  }
  function walk(v, path, ev) {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, path + '[' + i + ']', ev)); return; }
    if (typeof v === 'object') {
      for (const k of Object.keys(v)) walk(v[k], path ? path + '.' + k : k, ev);
      return;
    }
    const key = path.split('.').pop().toLowerCase();
    if (FIELD_KEYS.some(f => key.includes(f))) {
      hits.push({ ev, path, value: v });
    }
  }
  return hits;
}

function renderDetail(e) {
  const zone = $('zone-detail'), box = $('nodeDetail');
  const node = (e && e.engine.nodes || []).find(n => n.id === selectedNodeId) || null;
  if (!e || !node) { zone.style.display = 'none'; return; }
  zone.style.display = '';
  clear(box);

  // --- 标题 ---
  const title = el('div', 'detail-title');
  const st = NODE_STATE[node.state] || { label: node.state || '—', dot: '' };
  title.appendChild(el('span', 'dot ' + (st.dot || '')));
  title.appendChild(el('b', null, node.title || node.id));
  if (NODE_TYPE[node.type]) title.appendChild(el('span', 'chip accent', NODE_TYPE[node.type]));
  title.appendChild(el('span', 'chip', st.label));
  box.appendChild(title);

  // --- 字段 kv ---
  const kv = el('dl', 'kv');
  const addKv = (k, v) => { kv.appendChild(el('dt', null, k)); const dd = el('dd'); dd.textContent = v === null || v === undefined || v === '' ? '—' : String(v); kv.appendChild(dd); };
  addKv('节点 ID', node.id);
  addKv('状态', st.label + ' (state=' + (node.state ?? '—') + ')');
  addKv('尝试', `第 ${node.attempts ?? 0} / ${node.maxAttempts ?? '?'} 次`);
  if (node.role) addKv('角色', node.role);
  addKv('lastErrorCode', node.lastErrorCode);
  box.appendChild(kv);

  // --- 事件序列(nodeId 过滤) ---
  const events = (e.engine.events || []).filter(ev => ev.nodeId === node.id).sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const sub1 = el('div', 'subhead', '事件序列(' + events.length + ' 条)');
  box.appendChild(sub1);
  if (events.length) {
    for (const ev of events) box.appendChild(evLine(ev));
  } else {
    box.appendChild(el('div', 'hint', '该节点暂无事件投影。'));
  }

  // --- 溯源卡:input → output artifact 链 + 事件中的 sha256/locator 字段原文 ---
  const arts = (e.engine.artifacts || []);
  const ownArts = arts.filter(a => a.nodeId === node.id);
  const inputArt = node.inputArtifactId ? arts.find(a => a.id === node.inputArtifactId) : null;
  const outputArt = node.outputArtifactId ? arts.find(a => a.id === node.outputArtifactId) : null;
  const linkedArts = [];
  if (inputArt) linkedArts.push({ dir: '输入 artifact(inputArtifactId)', art: inputArt });
  for (const a of ownArts) if (!outputArt || a.id !== outputArt.id) linkedArts.push({ dir: '本节点 artifact', art: a });
  if (outputArt) linkedArts.push({ dir: '输出 artifact(outputArtifactId)', art: outputArt });

  const hits = collectFieldHits(events);
  if (linkedArts.length || hits.length) {
    const sub2 = el('div', 'subhead', '溯源卡');
    box.appendChild(sub2);
    if (linkedArts.length) {
      const chain = el('div', 'prov-chain');
      for (const { dir, art } of linkedArts) {
        const item = el('div', 'prov-item');
        item.appendChild(el('div', 'p-dir', dir));
        const dl = el('dl');
        const add = (k, v) => { dl.appendChild(el('dt', null, k)); const dd = el('dd'); dd.textContent = v === null || v === undefined ? '—' : String(v); dl.appendChild(dd); };
        add('id', art.id); add('kind', art.kind); add('mime', art.mime);
        add('size', art.size != null ? art.size + ' B' : '—');
        add('sha256', art.sha256); add('storageKey', art.storageKey);
        item.appendChild(dl);
        chain.appendChild(item);
      }
      box.appendChild(chain);
    }
    if (hits.length) {
      const boxHits = el('div', 'field-hits');
      boxHits.appendChild(el('div', 'hint', '事件中的溯源字段原文:'));
      for (const h of hits.slice(0, 20)) {
        const line = el('div', 'fh');
        line.textContent = `#${h.ev.seq} ${h.ev.type} ${h.path} = ${String(h.value)}`;
        boxHits.appendChild(line);
      }
      box.appendChild(boxHits);
    }
  } else {
    box.appendChild(el('div', 'hint', '该节点暂无可溯源的 artifact 链或 sha256/locator 字段投影。'));
  }
}

// ---------------------------------------------------------------------------
// ⑤ 实测辅助:manifest 徽章 + 申诉
// ---------------------------------------------------------------------------

async function refreshManifest() {
  try {
    const m = await apiFetch('/api/manifest');
    manifest = m;
    hideReason('manifestDetail');
  } catch (err) {
    if (err.network) return;      // 断网由灰条负责
    manifest = { error: err.message };
  }
  renderManifest();
}

function renderManifest() {
  const badge = $('manifestBadge');
  const m = manifest;
  badge.className = 'badge';
  if (!m) { badge.classList.add('idle'); badge.textContent = '未冻结(待用户名单)'; $('btnManifestDetail').disabled = true; return; }
  if (m.error) {
    badge.classList.add('bad');
    badge.textContent = '⚠ 研究档案读取失败';
  } else if (m.frozen && m.ok) {
    badge.classList.add('ok');
    badge.textContent = '✓ 已冻结 @ ' + (m.study_id ?? '—') + ' @ ' + String(m.git_commit ?? '').slice(0, 7);
  } else if (m.frozen && !m.ok) {
    badge.classList.add('warn');
    badge.textContent = '⚠ 冻结漂移(点「详情」看说明)';
  } else {
    badge.classList.add('idle');
    badge.textContent = '未冻结(待用户名单)' + (m.reason ? ' — ' + m.reason : '');
  }
  $('btnManifestDetail').disabled = false;
  renderManifestDetail();
}

function renderManifestDetail() {
  const box = $('manifestDetail');
  // 用 .on class 切换(CSS 定义 display:none/.on{display:block});inline style 会被 CSS 压住
  box.classList.toggle('on', manifestDetailOpen && !!manifest);
  if (!manifestDetailOpen || !manifest) return;
  clear(box);
  const m = manifest;
  if (m.error) {
    box.appendChild(el('div', 'bar-error on', '读取失败:' + m.error));
    return;
  }
  box.appendChild(el('div', 'hint', '说明:这是课程研究档案的冻结比对。漂移 = 当前代码或门禁基线与冻结记录不一致(日常迭代就会造成),不影响本页使用;正式实测以冻结清单为准。'));
  const kv = el('dl', 'kv');
  const add = (k, v) => { kv.appendChild(el('dt', null, k)); const dd = el('dd'); dd.textContent = v == null || v === '' ? '—' : String(v); kv.appendChild(dd); };
  add('study_id', m.study_id);
  add('git_commit', m.git_commit);
  add('manifest_hash', m.manifest_hash);
  box.appendChild(kv);
  if (m.frozen && !m.ok && Array.isArray(m.drifts) && m.drifts.length) {
    box.appendChild(el('div', 'subhead', '漂移清单(后端原文)'));
    const table = el('table', 'drifts');
    const thead = el('thead'); const trh = el('tr');
    for (const h of ['field', 'frozen', 'current']) { const th = el('th'); th.textContent = h; trh.appendChild(th); }
    thead.appendChild(trh); table.appendChild(thead);
    const tbody = el('tbody');
    for (const d of m.drifts) {
      const tr = el('tr');
      for (const k of ['field', 'frozen', 'current']) { const td = el('td'); td.textContent = d[k] == null ? '—' : String(d[k]); tr.appendChild(td); }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    box.appendChild(table);
  }
}

function lastBlockedGate(e) {
  if (!e) return { gate: null, code: null };
  const gates = (e.engine.events || []).filter(ev => ev.type === 'gate_result' && ev.data && ev.data.passed === false);
  const gate = gates.length ? gates[gates.length - 1].data.gate : null;
  const failedNodes = (e.engine.nodes || []).filter(n => n.state === 'failed' && n.lastErrorCode);
  const code = failedNodes.length ? failedNodes[failedNodes.length - 1].lastErrorCode : null;
  return { gate, code };
}

function isBlocked(e) {
  return !!e && (e.shell.status === 'BLOCKED'
    || (e.engine.events || []).some(ev => ev.type === 'gate_result' && ev.data && ev.data.passed === false));
}

// ---------------------------------------------------------------------------
// ① 导入:文件读取 / 上传 / 开始
// ---------------------------------------------------------------------------

function extOf(name) {
  const i = String(name).lastIndexOf('.');
  return i >= 0 ? String(name).slice(i + 1).toLowerCase() : '';
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('无法读取文件:' + file.name));
    r.onload = () => {
      const s = String(r.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.readAsDataURL(file);
  });
}

async function addFiles(fileList) {
  hideReason('importError');
  for (const file of Array.from(fileList)) {
    const ext = extOf(file.name);
    if (PROBLEM_EXT.includes(ext)) {
      if (stagedProblem) {
        showReason('importError', '题面文件仅支持一个,已替换为:', new Error(file.name));
      }
      stagedProblem = { name: file.name, contentBase64: await readAsBase64(file) };
      uploadResult = null;
    } else if (DATA_EXT.includes(ext)) {
      stagedData.push({ name: file.name, contentBase64: await readAsBase64(file) });
      uploadResult = null;
    } else {
      showReason('importError', '未识别的文件类型(仅支持题面 .md/.tex/.pdf/.docx 与数据 .csv/.xlsx):', new Error(file.name));
      continue;
    }
  }
  renderImport();
}

function renderImport() {
  const list = $('fileList');
  clear(list);
  if (stagedProblem) {
    const row = el('div', 'frow');
    row.appendChild(el('span', 'name', stagedProblem.name));
    row.appendChild(el('span', 'role', '题面'));
    const rm = el('button', 'rm', '×');
    rm.title = '移除';
    rm.addEventListener('click', () => { stagedProblem = null; uploadResult = null; renderImport(); });
    row.appendChild(rm);
    list.appendChild(row);
  }
  stagedData.forEach((d, i) => {
    const row = el('div', 'frow');
    row.appendChild(el('span', 'name', d.name));
    row.appendChild(el('span', 'role', '数据 · 只被求解代码读取,不进入模型'));
    const rm = el('button', 'rm', '×');
    rm.title = '移除';
    rm.addEventListener('click', () => { stagedData.splice(i, 1); uploadResult = null; renderImport(); });
    row.appendChild(rm);
    list.appendChild(row);
  });

  $('btnStart').disabled = !stagedProblem || submitBusy;
  // 无可用模型路由时,在点「开始生成」之前就常驻提醒(用户反馈:提交后才闪现红条几乎不可见)
  const noRoute = !(settings && (settings.activeId || settings.envFallback));
  $('startHint').textContent = submitBusy
    ? '正在提交…'
    : (stagedProblem
      ? (noRoute
        ? '⚠ 尚未配置 API:点右上角「API 设置」,填好 endpoint / 模型 ID / key 并勾选激活,就能真实生成;只想先看流程可点右上角「一键演示」。'
        : (uploadResult ? '题目已注册,正在创建运行…' : '题面已就绪,点「开始生成」即可。数据文件只被求解代码读取,不进入模型。'))
      : '选择题面文件后即可开始;数据文件只被求解代码读取,不进入模型。');

  const sha = $('shaLine');
  clear(sha);
  if (uploadResult) {
    sha.classList.add('on');
    const l1 = el('div');
    l1.append('题目 sha256(引擎返回):');
    l1.appendChild(el('code', null, uploadResult.problem_sha256 || '—'));
    sha.appendChild(l1);
    for (const d of (uploadResult.dataFiles || [])) {
      const line = el('div');
      line.append(d.name + ' sha256:');
      line.appendChild(el('code', null, d.sha256 || '—'));
      sha.appendChild(line);
    }
  } else {
    sha.classList.remove('on');
  }
}

let submitBusy = false;

async function startRun() {
  if (!stagedProblem || submitBusy) return;
  // 真实运行必须有可用模型路由:激活配置优先;都没有则提前拒绝(演示不受影响)。
  const activeProfile = settings && Array.isArray(settings.profiles) ? settings.profiles.find(x => x.id === settings.activeId) : null;
  if (!activeProfile && !(settings && settings.envFallback)) {
    showReason('importError', '无法开始:还没有可用的 API 配置。',
      new Error('点右上角「API 设置」添加一套配置(endpoint / 模型 ID / API key)并勾选激活;只想先看流程可点右上角「一键演示」。'));
    toast('尚未配置 API —— 请点右上角「API 设置」', 8000);
    return;
  }
  submitBusy = true;
  hideReason('importError');
  renderImport();
  try {
    const up = await apiFetch('/api/problems', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        problem: { name: stagedProblem.name, contentBase64: stagedProblem.contentBase64 },
        data: stagedData.map(d => ({ name: d.name, contentBase64: d.contentBase64 })),
      }),
    });
    uploadResult = up;
    renderImport();
    const run = await apiFetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        problemPath: up.problemPath,
        tier: $('selTier').value,
        mode: $('selMode').value,
        fake: false,
        profileId: activeProfile ? activeProfile.id : undefined,
      }),
    });
    trackNewRun(run.runKey, { tier: $('selTier').value, mode: $('selMode').value, fake: false });
    toast('运行已提交:' + (run.runKey || ''));
  } catch (err) {
    // 后端 422 的 reason 原文照显,不自行措辞
    showReason('importError', '提交被拒绝:', err);
  } finally {
    submitBusy = false;
    renderImport();
  }
}

async function demoRun() {
  const btn = $('btnDemo');
  if (btn.disabled) return;
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = '启动中…';
  try {
    const body = await apiFetch('/api/demo-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    trackNewRun(body.runKey, { tier: 'T3', mode: 'strict', fake: true });
    toast('演示运行已提交');
  } catch (err) {
    if (err.network) toast('无法连接驾驶舱服务');
    else toast('演示启动失败:' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

function trackNewRun(runKey, shellHint) {
  if (!runKey) return;
  const e = ensureEntry(runKey);
  e.runKey = runKey;
  Object.assign(e.shell, shellHint);
  selectedKey = runKey;
  selectedNodeId = null;
  renderAll();
}

// ---------------------------------------------------------------------------
// 轮询 /api/runs/active(兼作连接探针)
// ---------------------------------------------------------------------------

let pollBusy = false;
async function pollActive() {
  if (pollBusy) return;
  pollBusy = true;
  try {
    const body = await apiFetch('/api/runs/active');
    if (body && body.runs && typeof body.runs === 'object') {
      for (const runKey of Object.keys(body.runs)) {
        // 服务端 runs 是 Map(runKey → entry):记录对象本身不含 runKey,补上再合并
        const rec = Object.assign({ runKey }, body.runs[runKey]);
        mergeActive(rec);
      }
      renderAll();
    }
  } catch (err) {
    // 断网已由 setOnline 处理;其余静默等待下轮
  } finally {
    pollBusy = false;
  }
}

// ---------------------------------------------------------------------------
// 模态:知情同意 / 误杀申诉
// ---------------------------------------------------------------------------

function initConsent() {
  let agreed = false;
  try { agreed = localStorage.getItem(LS_CONSENT) === '1'; } catch (e) { agreed = false; }
  if (agreed) return;
  const ov = $('consentOverlay');
  ov.classList.add('on');
  $('btnConsentYes').addEventListener('click', () => {
    try { localStorage.setItem(LS_CONSENT, '1'); } catch (e) { /* 忽略 */ }
    ov.classList.remove('on');
  });
  $('btnConsentNo').addEventListener('click', () => {
    clear(ov.querySelector('.modal'));
    const m = el('div', null);
    m.style.padding = '0';
    m.appendChild(el('h3', null, '已退出'));
    m.appendChild(el('p', 'm-body', '你可以直接关闭此页面。重新打开时可以再次选择。'));
    ov.querySelector('.modal').appendChild(m);
  });
}

function openAppeal() {
  const e = selectedEntry();
  const ov = $('appealOverlay');
  const { gate, code } = lastBlockedGate(e);
  $('apGate').value = gate || '';
  $('apCode').value = code || '';
  $('apReason').value = '';
  ov.classList.add('on');
  $('apReason').focus();
}

async function submitAppeal() {
  const e = selectedEntry();
  const reason = $('apReason').value.trim();
  if (!reason) { toast('请填写一句话理由'); return; }
  const btn = $('btnAppealSubmit');
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = '提交中…';
  try {
    await apiFetch('/api/falseblock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        case_id: 'FB-' + Date.now().toString(36),
        run_id: e ? (e.runId || e.runKey) : null,
        gate: $('apGate').value || null,
        failure_code: $('apCode').value || null,
        model_output_head: e ? (e.shell.outputHead || '').slice(0, 120) : '',
        reason,
      }),
    });
    $('appealOverlay').classList.remove('on');
    toast('已归档,将由开发者与审计轨复核');
  } catch (err) {
    toast('申诉提交失败:' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

// ---------------------------------------------------------------------------
// TASK-C1.5:API 设置(profiles)。key 只存本机,页面只见掩码;编辑不填 key = 保留旧 key。
// ---------------------------------------------------------------------------

/** 激活配置的顶栏徽章原文投影;无激活配置时按 envFallback 区分两种文案。 */
function renderActiveProfileBadge() {
  const btn = $('btnActiveProfile');
  const p = settings && settings.profiles ? settings.profiles.find(x => x.id === settings.activeId) : null;
  if (p) {
    btn.classList.remove('none');
    btn.textContent = '● ' + p.model + ' @ ' + p.name;
    btn.title = '当前激活配置:' + p.name + '(' + p.endpoint + '),点击查看/修改';
    return;
  }
  btn.classList.add('none');
  btn.textContent = settings && settings.envFallback ? '● 使用启动环境变量' : '未配置 API';
  btn.title = settings && settings.envFallback
    ? '没有激活的 API 配置;真实运行将使用启动本程序时注入的环境变量。点击配置面板可改为页面内管理。'
    : '还没有可用的 API 配置——真实运行会被拒绝。点击「API 设置」添加一套,或用「一键演示」先看流程。';
}

async function refreshSettings() {
  try {
    settings = await apiFetch('/api/settings');
  } catch (err) {
    if (err.network) return;      // 断网由灰条负责
    settings = { activeId: null, envFallback: false, profiles: [], error: err.message };
  }
  renderActiveProfileBadge();
  renderImport();     // 配置状态变化影响「开始生成」提示与守卫
  if (settingsOpen) renderSettingsPanel();
}

/** 打开面板:把服务端投影复制成编辑副本 */
function openSettings() {
  const list = settings && Array.isArray(settings.profiles) ? settings.profiles : [];
  draftProfiles = list.map(p => ({
    id: p.id, name: p.name, endpoint: p.endpoint, model: p.model, provider: p.provider,
    apiKeyMasked: p.apiKeyMasked, test: null,
  }));
  draftActiveId = settings ? settings.activeId : null;
  hideReason('settingsError');
  $('settingsOverlay').classList.add('on');
  settingsOpen = true;
  renderSettingsPanel();
}

function closeSettings() {
  $('settingsOverlay').classList.remove('on');
  settingsOpen = false;
}

function renderSettingsPanel() {
  const list = $('profileList');
  clear(list);
  if (!draftProfiles.length) {
    list.appendChild(el('div', 'empty', '还没有配置。在下方新增一套(名称 / endpoint / 模型 ID / API key),保存后即可用于真实运行。'));
    return;
  }
  draftProfiles.forEach((p, i) => {
    const row = el('div', 'prow');
    const grid = el('div', 'p-grid');
    const mk = (key, ph) => {
      const input = document.createElement('input');
      input.type = 'text'; input.placeholder = ph; input.value = p[key] ?? '';
      input.addEventListener('input', () => { p[key] = input.value; });
      return input;
    };
    grid.appendChild(mk('name', '名称'));
    grid.appendChild(mk('endpoint', 'endpoint(https://…)'));
    grid.appendChild(mk('model', '模型 ID'));
    row.appendChild(grid);

    const ctl = el('div', 'p-ctl');
    const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'activeProfile'; radio.id = 'prof-radio-' + i;
    radio.checked = p.id === draftActiveId;
    radio.addEventListener('change', () => { draftActiveId = p.id; renderSettingsPanel(); });
    const label = el('label', null, '激活');
    label.setAttribute('for', radio.id);
    label.style.cursor = 'pointer';
    ctl.appendChild(radio); ctl.appendChild(label);

    const masked = el('span', 'hint', 'key:' + (p.apiKeyMasked || '(未保存)'));
    ctl.appendChild(masked);

    const newKey = document.createElement('input');
    newKey.type = 'password';
    newKey.placeholder = '替换 key(留空=保留)';
    newKey.className = 'p-newkey';
    newKey.addEventListener('input', () => { p.newApiKey = newKey.value; });
    ctl.appendChild(newKey);

    const btnTest = el('button', 'btn small', '测试');
    btnTest.type = 'button';
    btnTest.addEventListener('click', () => testProfile(p, btnTest, row));
    ctl.appendChild(btnTest);

    const btnDel = el('button', 'btn small', '删除');
    btnDel.type = 'button';
    btnDel.addEventListener('click', () => {
      draftProfiles.splice(i, 1);
      if (draftActiveId === p.id) draftActiveId = draftProfiles[0]?.id ?? null;
      renderSettingsPanel();
    });
    ctl.appendChild(btnDel);

    row.appendChild(ctl);

    if (p.test) {
      const d = el('div', 'p-test-detail ' + (p.test.state === 'ok' ? 'ok' : 'bad'), p.test.detail);
      row.appendChild(d);
      if (p.test.state === 'ok' && Array.isArray(p.test.models) && p.test.models.length) {
        const box = el('div', 'models-list');
        box.appendChild(el('span', 'hint', '端点可用模型(点选回填):'));
        for (const id of p.test.models.slice(0, 24)) {
          const chip = el('button', 'chip model-chip' + (id === p.model ? ' accent' : ''), id);
          chip.type = 'button';
          chip.addEventListener('click', () => { p.model = id; renderSettingsPanel(); });
          box.appendChild(chip);
        }
        row.appendChild(box);
      }
    }
    list.appendChild(row);
  });
}

/** 保存前本地校验,返回 null 或错误文案(与服务端规则一致,提前给出可读提示) */
function draftValidationError() {
  for (const p of draftProfiles) {
    if (!p.name || !p.name.trim()) return '有配置缺少名称';
    if (!p.endpoint || !/^https?:\/\//.test(p.endpoint.trim())) return `配置「${p.name}」的 endpoint 必须是 http(s) 地址`;
    if (!p.model || !p.model.trim()) return `配置「${p.name}」缺少模型 ID`;
    const hasKey = (p.newApiKey && p.newApiKey.trim()) || p.apiKeyMasked && p.apiKeyMasked !== '(未保存)';
    if (!hasKey) return `配置「${p.name}」还没有 API key`;
  }
  return null;
}

async function saveSettings() {
  const invalid = draftValidationError();
  if (invalid) { showReason('settingsError', '还没填好:', new Error(invalid)); return; }
  const btn = $('btnSettingsSave');
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = '保存中…';
  try {
    // 新增行没有 id:保存成功后用返回的 activeId 对照名称重排;服务端 replace-all 会给无 id 行生成新 id,
    // 这里把「无 id 行」直接交给服务端,并以保存后的 GET 投影刷新整个面板。
    await apiFetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        profiles: draftProfiles.map(p => ({
          id: p.id, name: p.name, endpoint: p.endpoint, model: p.model, provider: p.provider,
          apiKey: (p.newApiKey && p.newApiKey.trim()) || undefined,
        })),
        activeId: draftActiveId,
      }),
    });
    hideReason('settingsError');
    toast('API 设置已保存');
    settingsOpen = false;
    $('settingsOverlay').classList.remove('on');
    await refreshSettings();
    renderImport();   // 配置状态变了:导入区常驻提示与「开始生成」可用性随之刷新
  } catch (err) {
    showReason('settingsError', '保存失败:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

/** POST /api/settings/test — 15s 内返回端点连通性与模型列表(点选回填 model) */
async function testProfile(p, btn, row) {
  if (!p.endpoint || !/^https?:\/\//.test(p.endpoint.trim())) {
    p.test = { state: 'bad', detail: '先填写 http(s) 开头的 endpoint 再测试。' };
    renderSettingsPanel();
    return;
  }
  if (!p.id && !(p.newApiKey && p.newApiKey.trim())) {
    p.test = { state: 'bad', detail: '新配置要先填 API key 并保存后才能测试(测试走服务端,密钥不经页面)。' };
    renderSettingsPanel();
    return;
  }
  btn.disabled = true;
  btn.textContent = '测试中…';
  try {
    const body = await apiFetch('/api/settings/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileId: p.id ?? null, endpoint: p.endpoint, model: p.model, apiKey: (p.newApiKey && p.newApiKey.trim()) || undefined }),
    });
    p.test = { state: body.ok ? 'ok' : 'bad', detail: body.detail || (body.ok ? '端点可达' : '端点不可达'), models: body.models ?? null };
  } catch (err) {
    p.test = { state: 'bad', detail: '测试失败:' + err.message };
  } finally {
    btn.disabled = false;
    btn.textContent = '测试';
    renderSettingsPanel();
  }
}

function addDraftProfile() {
  // 临时 id 前缀 draft-:服务端会原样保留非空 id,所以激活 radio 在保存前就可用;
  // id null 的行服务端才生成新 id,radio 会在保存后失配,故新行一律带临时 id。
  const row = { id: 'draft-' + Date.now().toString(36) + '-' + draftProfiles.length, name: $('npName').value, endpoint: $('npEndpoint').value, model: $('npModel').value, provider: undefined, apiKeyMasked: null, newApiKey: $('npKey').value, test: null };
  draftProfiles.push(row);
  if (draftActiveId === null) draftActiveId = row.id; // 第一个配置默认激活
  $('npName').value = ''; $('npEndpoint').value = ''; $('npModel').value = ''; $('npKey').value = '';
  renderSettingsPanel();
}

// ---------------------------------------------------------------------------
// 导出溯源 JSON
// ---------------------------------------------------------------------------

function exportProvenance() {
  const e = selectedEntry();
  if (!e) return;
  const payload = {
    exportedAt: new Date().toISOString(),
    runKey: e.runKey,
    runId: e.runId,
    shell: e.shell,                    // /api/runs/active 投影
    run: e.engine.run,                 // GET /api/runs/:runId 投影(原样)
    nodes: e.engine.nodes,
    events: e.engine.events,
    artifacts: e.engine.artifacts,
    note: '本文件是驾驶舱页面对 API 投影的原样导出,不含任何本地计算或推断。',
  };
  downloadText('provenance-' + (e.runId ? e.runId.slice(0, 8) : e.key) + '.json',
    JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  toast('已导出溯源 JSON');
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

function initImportZone() {
  const drop = $('dropMain');
  drop.addEventListener('click', () => $('fileProblem').click());
  drop.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); $('fileProblem').click(); } });
  drop.addEventListener('dragover', (ev) => { ev.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (ev) => {
    ev.preventDefault();
    drop.classList.remove('drag');
    if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) addFiles(ev.dataTransfer.files);
  });
  // 右键或长按拖数据文件:同一拖拽区按扩展名自动分流
  $('fileProblem').addEventListener('change', (ev) => { if (ev.target.files) addFiles(ev.target.files); ev.target.value = ''; });
  $('fileData').addEventListener('change', (ev) => { if (ev.target.files) addFiles(ev.target.files); ev.target.value = ''; });
  $('btnAddData').addEventListener('click', () => $('fileData').click());
  $('btnStart').addEventListener('click', startRun);
  // 一键演示(TASK-C1 用户反馈:demoRun 曾从未被绑定,按钮按下无反应)
  $('btnDemo').addEventListener('click', demoRun);
}

function initDeliveryZone() {
  $('btnDownload').addEventListener('click', () => {
    const e = selectedEntry();
    if (!e) return;
    downloadText('report-projection-' + (e.runId ? e.runId.slice(0, 8) : e.key) + '.txt', projectionText(e));
    toast('已下载当前投影文本');
  });
  // 页面内预览最近一次运行的 report.md 全文(投影只读;用户反馈:只给路径无法直接看初稿)
  $('btnPreviewReport').addEventListener('click', async () => {
    const btn = $('btnPreviewReport');
    const view = $('reportView');
    const on = view.style.display !== 'none';
    if (on) { view.style.display = 'none'; btn.textContent = '在页面里看初稿'; return; }
    btn.disabled = true;
    btn.textContent = '读取中…';
    try {
      const body = await apiFetch('/api/report');
      if (!body.ok) { view.textContent = body.reason || '报告尚未生成。'; }
      else { view.textContent = body.text; }
      view.style.display = 'block';
      btn.textContent = '收起初稿';
    } catch (err) {
      view.textContent = '读取失败:' + err.message;
      view.style.display = 'block';
      btn.textContent = '收起初稿';
    } finally {
      btn.disabled = false;
    }
  });
}

function initAuxZone() {
  $('btnManifestDetail').addEventListener('click', () => {
    manifestDetailOpen = !manifestDetailOpen;
    if (manifestDetailOpen && !manifest) refreshManifest();
    renderManifestDetail();
  });
  $('btnAppeal').addEventListener('click', openAppeal);
  $('btnAppealTop').addEventListener('click', openAppeal);
  $('btnAppealCancel').addEventListener('click', () => $('appealOverlay').classList.remove('on'));
  $('btnAppealSubmit').addEventListener('click', submitAppeal);
  $('btnExport').addEventListener('click', exportProvenance);
}

function initDetailZone() {
  $('btnCloseDetail').addEventListener('click', () => { selectedNodeId = null; renderAll(); });
}

function renderAux(e) {
  // 申诉按钮:仅当存在被拦截的运行时可用
  const anyBlocked = [...runs.values()].some(isBlocked);
  $('btnAppeal').disabled = !anyBlocked;
}

function initSettingsZone() {
  $('btnSettings').addEventListener('click', openSettings);
  $('btnActiveProfile').addEventListener('click', openSettings);
  $('btnSettingsClose').addEventListener('click', closeSettings);
  $('btnSettingsSave').addEventListener('click', saveSettings);
  $('btnAddProfile').addEventListener('click', addDraftProfile);
  $('settingsOverlay').addEventListener('click', (ev) => { if (ev.target === $('settingsOverlay')) closeSettings(); });
}

function initPollers() {
  pollActive();
  setInterval(pollActive, 3000);
  refreshManifest();
  setInterval(refreshManifest, 60000);
  refreshSettings();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { pollActive(); refreshManifest(); refreshSettings(); }
  });
  window.addEventListener('online', () => pollActive());
  window.addEventListener('offline', () => setOnline(false));
}

function boot() {
  initImportZone();
  initDeliveryZone();
  initAuxZone();
  initDetailZone();
  initSettingsZone();
  initConsent();
  restoreRuns().then(() => {
    renderAll();
    initPollers();
  });
}

document.addEventListener('DOMContentLoaded', boot);
})();
