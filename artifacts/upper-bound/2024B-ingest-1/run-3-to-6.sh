#!/bin/bash
cd "D:/deepseek modex/deepseek-harness"
R=artifacts/upper-bound/2024B-ingest-1
export PAPER_PROBE_BASE_URL=https://api.teamorouter.cn/v1
export PAPER_PROBE_MODEL=deepseek-flash-free
export PAPER_PROBE_PROVIDER=teamorouter
export PAPER_PROBE_API_KEY=***REMOVED***
export PAPER_AUDIT_MODEL=glm-5.3-flash-free
for i in 1 2 3 4 5 6; do
  echo "===== 第 $i 次 --stage-next ====="
  npx tsx apps/paper-shell/src/cli.ts run "$R/stages/00-input/problem.txt" --stages --stage-next --out "$R" 2>&1
  if grep -q "整条链都已完成" /dev/null 2>/dev/null; then :; fi
done
echo "===== LOOP DONE ====="
