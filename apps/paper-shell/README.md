# paper-shell — 用户外壳 CLI (TASK-M1 M1-2)

`apps/paper-shell/` 是把执行链包成一个可给真实用户使用的命令行外壳。它**不重新实现
引擎语义**（禁 M1-1）：只读题目 → 委托 executor → 打包导出。

## 命令面

```
paper-shell run <problem-file> [--tier T1|T2|T3] [--mode fast|strict|exploratory]
                               [--out <dir>] [--fake]
paper-shell explain <code>      # 把引擎九门拒绝 / 五类失败码翻成人话一句 + 修复建议
paper-shell --version
```

- 缺参 / 未知子命令 → exit 2 并提示。
- 非法 `--tier` / `--mode` → exit 2（守卫，不落库）。
- 非 `--fake` 且无路由 → exit 1，提示设 `PAPER_PROBE_*` / `DEEPSEEK_*` / `DSH_E2E_LLM_*`
  变量族（P3D 中立，无硬编码厂商）。
- 产线 opt-in：非 `--fake` 时显式 `produceFromExecute: true` 并记录 `production_enabled` 审计。

## 运行

```bash
# 离线确定性 e2e（fake provider 填 T3 填充面）
npm run demo:pw                     # -> artifacts/handoff/TASK-M1/shell-out

# 真实 provider（从环境变量读路由）
export PAPER_PROBE_API_KEY=… PAPER_PROBE_BASE_URL=… PAPER_PROBE_MODEL=…
npm run demo:pw:real                # -> artifacts/handoff/TASK-M1/shell-out-real

# 单元测试（三攻击守卫 + 四类人话分类 + 正例）
npm run test:m1:shell
```

## 目录

- `src/cli.ts` — 入口 / 参数 / 组装 / 打包（含 zip 确定性导出：STORE + 固定 DOS 时间 + redacted runId）
- `src/invoke.ts` — 守卫（巨量/空/非 UTF-8 三攻击）、`blockMessage` 人话分类、《route》解析
- `src/real-provider.ts` — OpenAI 兼容 SSE 直通（真实适配，壳层不解析语义）
- `src/zip.ts` — 字节确定性 ZIP（重跑同 sha256，G2）
- `tests/invoke.spec.ts` — 8 单测