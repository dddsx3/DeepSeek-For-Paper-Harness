# TASK-M1 — 用户外壳与人机协同实测 (Paper-Shell 用户外壳 + 真实用户模拟)

> 任务书 TASK-M1：在 M1-1 真实遵从率实证之后，把可执行的用户外层（CLI 外壳）落地，
> 并以真实测试 key 模拟至少一次真实用户操作；若反馈良好则推送并给简报。
> 本任务是 P3 收尾里「用户外壳」候选的落实，同时是 P2 遗留「真实遵从率实跑」的兑现
> （probe-real 三层全程真实 key，非 fake）。

## 本批次交付

- **用户外壳 CLI v0**：`apps/paper-shell/`（`cli.ts` + `invoke.ts` + `real-provider.ts` + `zip.ts`）
  - `paper-shell run <file> [--tier T1|T2|T3] [--mode fast|strict|exploratory] [--out <dir>] [--zip] [--fake]`
  - `paper-shell explain <code>` —— 把引擎九门拒绝 / 五类失败码翻成人话一句 + 修复建议
  - `--version` / 缺参 / 未知子命令 / 非法 tier·mode —— 都有明确 exit 码与提示
  - 外壳不重实现引擎语义（禁 M1-1）：只读题目 → 委托 executor → 打包。
- **产线 opt-in + 审计（F5/M-B）**：`produceFromExecute: true` 显式开启并记录
  `production_enabled` 审计事件（只读题目、非伪造、入口版本记录）。
- **P3D 中立变量族路由**：`PAPER_PROBE_*` / `DEEPSEEK_*` / `DSH_E2E_LLM_*` 三族 fallback，
  无硬编码厂商（`resolveShellRoute`），坏路由退出码 1 并提示。
- **真实 provider 适配**：OpenAI 兼容 SSE 直通（`streamCompletion`），壳层不解析语义。
- **确定性 ZIP 导出（G2）**：`STORE` + 固定 DOS 时间 + redacted runId —— 重跑同 sha256。
- **八个外壳单元测试**（`invoke.spec.ts`）：三攻击守卫（巨量/空/非 UTF-8）+ 四类 BLOCKED
  人话分类 + 正例。

## 真实用户模拟（M1-1 之后的关键实证）

- M1-1 探针（`probe-real/RESULT.md`）：38 次首次尝试（10 T1 + 10 T2 + 18 T3），
  **T3 填准入 18/18（1.0）、端到端专测 8/8**；T1/T2 0/10 —— 弱模型被 T3 最小面救回。
- 首测组合定层：`deepseek/deepseek-v4-flash @ T3`（结构遵从 1.0 / 端到端 ≥0.8）。
- 用户视角 fresh 真实跑（`shell-out-real/`）：用测试 key 从目录里没有既成产物的干净状态
  跑 `course-work.md @ T3 strict` → **DELIVERED**，报告经规范 IR 注入结果表与结论数字，
  zip 导出完整，审计链 `production_enabled … promotion_succeeded workflow_completed`。

## 门禁 (G4) 核对

- 基线：`npm run test:task3:report-state` → **PASS vitest 1025/1025, 0 failures**（RG-06/07/09 一致）。
- 外壳 spec：`npm run test:m1:shell` → **8/8 绿**（含三攻击红 + 四类人话分类）。
- 确定性：fake e2e 三次 fresh 跑 zip sha256 均 `29a4ab58…`（G2 重启同）。
- demo 命令面：`demo:pw`（fake 离线）DELIVERED；`demo:pw:real`（真实 key）。

## 产物清单

| 路径 | 内容 |
|---|---|
| `apps/paper-shell/` | 外壳源码 + tsconfig + package.json |
| `apps/paper-shell/tests/invoke.spec.ts` | 8 单测 |
| `artifacts/handoff/TASK-M1/probe-real/` | 真实遵从率实证（RESULT + summary.json + records.jsonl） |
| `artifacts/handoff/TASK-M1/samples/` | course-work.md / journal.md 示例题目 |
| `artifacts/handoff/TASK-M1/shell-out/` | fake 离线 e2e 输出（zip `29a4ab58…`） |
| `artifacts/handoff/TASK-M1/shell-out-real/` | 真实用户模拟输出 |

## 后续

- M1-3 PNG 位图后端（deterministic SVG→PNG + FigureSpec 信任链 + corpus PNG 叶）——未启动。
- M1-5 pilot 协议（真实批次三段先 small 后 scale 的守则）——未启动。
- 弱模型轨：T3 可用；T1/T2 轨转为持续观察项（每次真实批次重测，不强求救回）。