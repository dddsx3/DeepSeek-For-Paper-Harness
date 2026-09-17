#!/usr/bin/env bash
# W8.9 真实运行的路由环境（不含凭据）。
# 凭据只从仓库根的 .env.local 读取（该文件已被 .gitignore 忽略）。
#
# 用法： source artifacts/handoff/W8.9/route-env.sh
#
# 事故记录（本批次自查发现）：本文件的第一版把 PAPER_PROBE_API_KEY 的**明文值**
# 写进了文件，而 artifacts/handoff/ 不在 .gitignore 内 —— 一次提交即泄漏。
# 现改为运行时从 .env.local 提取；本文件不含任何密钥。
set -a
while IFS= read -r line; do
  case "$line" in
    ''|'#'*) continue ;;
  esac
  export "$line"
done < "$(git rev-parse --show-toplevel 2>/dev/null || echo .)/.env.local"
set +a
export PAPER_PROBE_MAX_OUTPUT_TOKENS="${PAPER_PROBE_MAX_OUTPUT_TOKENS:-24000}"
export PAPER_PROBE_REASONING="${PAPER_PROBE_REASONING:-none}"
