#!/bin/bash
cd "D:/deepseek modex/deepseek-harness"
R=artifacts/upper-bound/2024B-ingest-1
export PAPER_PROBE_BASE_URL=https://opencode.ai/zen/v1
export PAPER_PROBE_MODEL=space-bunny-free
export PAPER_PROBE_PROVIDER=opencode
export PAPER_PROBE_API_KEY=oc_sk_213f3ee9fcde_yJ7nv66hZ0r9X_kWKUxMsk18UKCv5BkN
# **不关闭思考**（用户硬约束）：default = 不发送 reasoning 参数，模型自行决定（实测会返回 reasoning_content）
export PAPER_PROBE_REASONING=default
# **非流式**：实测"max-tokens 截断只在流式下反复出现"，且 SSE 断流（fetch failed）在非流式下不存在
export PAPER_NON_STREAM=1
export PAPER_NON_STREAM_TIMEOUT_MS=1800000
# 输出预算放大：开思考后推理 token 会占掉一部分，14 条规划 JSON 要写得下
export PAPER_PROBE_MAX_OUTPUT_TOKENS=64000
export PAPER_PROBE_TIMEOUT_MS=1800000
export PAPER_AUDIT_MODEL=space-bunny-free
for i in 1 2 3 4; do
  echo "===== 第 $i 次 --stage-next（opencode/space-bunny-free 非流式）====="
  npx tsx apps/paper-shell/src/cli.ts run "$R/stages/00-input/problem.txt" --stages --stage-next --out "$R" 2>&1
done
echo "===== LOOP DONE ====="
