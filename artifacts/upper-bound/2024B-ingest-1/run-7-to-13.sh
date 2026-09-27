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
for i in 1 2 3 4 5 6 7 8; do
  echo "===== 第 $i 次 --stage-next ====="
  npx tsx apps/paper-shell/src/cli.ts run "$R/stages/00-input/problem.txt" --stages --stage-next --out "$R" 2>&1
done
echo "===== LOOP DONE ====="
