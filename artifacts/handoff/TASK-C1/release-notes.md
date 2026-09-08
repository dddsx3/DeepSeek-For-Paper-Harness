# paper-cockpit v0.1-pilot — 学生视角三行话

**能干什么**:拖入题目(和数据文件),点"开始生成",看进度,下载论文初稿 zip 与运行报告。
**不能干什么**:初稿 ≠ 可提交论文;数字与引用仍需你亲自核对;系统冻结在 STUDY-A-PILOT 版本,引擎中途不会变。
**出问题找谁**:BLOCKED 界面点"我认为这是误杀"一键申诉(归档裁决表,由开发者与审计轨复核);其余情况找操作者。

- manifest 锚点:`artifacts/handoff/TASK-P2/study-manifest/study-manifest.json`(verify 同源投影于舱内徽章)
- 一键自检:`npx tsx apps/cockpit/server.mjs` 后浏览器打开 http://127.0.0.1:3081 → 点"一键演示"(fake 题 e2e,无需 key)→ 徽章/进度/交付三区应有完整投影
