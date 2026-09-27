#!/bin/bash
cd "D:/deepseek modex/deepseek-harness"
R=artifacts/upper-bound/2024B-ingest-1
# mhcoding 中转（免费额度独立）；直连不通，必须走 clash 代理 → Node 24 的 NODE_USE_ENV_PROXY
export NODE_USE_ENV_PROXY=1
export HTTPS_PROXY=http://127.0.0.1:62549
export HTTP_PROXY=http://127.0.0.1:62549
export PAPER_PROBE_BASE_URL=https://www.mhcoding.ai/v1
export PAPER_PROBE_MODEL=gpt-6-luna
export PAPER_PROBE_PROVIDER=mhcoding
export PAPER_PROBE_API_KEY=sk-aRidda9RDU7HqkncHUXvDr8EbJxj9p2J1O5ZLCKCn7JR2CpB
# **不关闭思考**（用户硬约束：数学建模与模型能力强相关，不能因中转原因让步）
export PAPER_PROBE_REASONING=default
export PAPER_AUDIT_MODEL=gpt-6-luna
# 开思考 + 大简报远超默认 60s（实测被 abort 成 "fetch failed"）
export PAPER_PROBE_TIMEOUT_MS=900000
for i in 1 2 3 4; do
  echo "===== 第 $i 次 --stage-next（mhcoding/gpt-6-luna）====="
  npx tsx apps/paper-shell/src/cli.ts run "$R/stages/00-input/problem.txt" --stages --stage-next --out "$R" 2>&1
done
echo "===== LOOP DONE ====="
