/**
 * 首次真实产出的交付链（run 完成后执行）——预检 → docx → 契约 → 交付包.
 *
 * 与 dry-run 同一套环节，但输入是**真实运行**的产物目录：
 *   <runOut>/report.md + <runOut>/figures/*.svg + run-report.json
 *
 * 用法：npx tsx artifacts/handoff/R5/paper-deliver.sh（见同目录 README 或直接内联命令）
 * 本文件为记录用；实际执行用 CLI 子命令逐条跑（见 baseline-1 报告）。
 */
export {}
