#!/bin/bash
cd "D:/deepseek modex/deepseek-harness"
R=artifacts/upper-bound/2024B-ingest-1
export PAPER_PROBE_BASE_URL=https://opencode.ai/zen/v1
export PAPER_PROBE_MODEL=space-bunny-free
export PAPER_PROBE_PROVIDER=opencode
export PAPER_PROBE_API_KEY=oc_sk_213f3ee9fcde_yJ7nv66hZ0r9X_kWKUxMsk18UKCv5BkN
export PAPER_PROBE_REASONING=default
export PAPER_NON_STREAM=1
export PAPER_NON_STREAM_TIMEOUT_MS=1800000
export PAPER_PROBE_MAX_OUTPUT_TOKENS=64000
export PAPER_PROBE_TIMEOUT_MS=1800000
export PAPER_AUDIT_MODEL=space-bunny-free
# 传输层重试预算：默认 4 次 / 1.5s 基数 = 总窗口约 10.5 秒，骑不过免费中转的连续丢连
# （实测阶段 2 连撞 4 次全是 fetch failed，且四次都落在同一分钟内 = 等于没重试）
export PAPER_PROBE_MAX_ATTEMPTS=8
export PAPER_PROBE_BASE_BACKOFF_MS=5000
for i in $(seq 1 16); do
  echo "===== 第 $i 次 --stage-next ====="
  npx tsx apps/paper-shell/src/cli.ts run "$R/stages/00-input/problem.txt" --stages --stage-next --out "$R" 2>&1
done
echo "===== LOOP DONE ====="
