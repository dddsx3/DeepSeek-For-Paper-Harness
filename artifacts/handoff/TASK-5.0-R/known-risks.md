# TASK 5.0-R — known-risks（新旧合并；每条含防再犯）

## 已消除 / 已改写的历史账

1. **redteam15 7 红"历史债"**（旧 item 7/12）— 已消除：根因是链挂载绕过 producer-only 门被 INV-3-M 拒，守卫从未失效。防再犯：fixtures/新 spec 一律 `putExecutionRecord + CAPTURE_ATTESTATION`。
2. **stale-engine 4 红"等 forge 工厂"**（旧 item 13）— 已消除：不可变 store 上覆盖 put 是无效构造；漂移改在捕获字段表达（5.0-R 裁决单 5 测量源）。防再犯：任何记录漂移测试都从 S-002 同构出发。
3. **"六门必须保持 UNIMPLEMENTED 以避免 pretend-PASS"的旧叙事** — 已改写：六门现在真的 UNIMPLEMENTED 且被 RG-09/`gates_impl` 机器登记；P1 将逐个升级为真门。
4. **TASK 5.0 旧行 "5.0.8 enforcement point = audit composition"**（item 20）— 仍有效（executor 热路径不做 replay），保留。

## 本批次新增风险

5. **FORMAL/FAST 彻底不可交付（比 5.0-R 之前更红）**：六门 UNIMPLEMENTED 是有意为之的诚实红灯（任务书 §7.3）。产品叙事必须同步为"结构防御就绪，内容管线未通（P1）"。防再犯：任何声称"可交付"的演示必须跑 EXPLORATORY 且带"非正式"标记（R1-4）——不得用 EXPLORATORY 充 FORMAL。
6. **executor 机制测试跑在 EXPLORATORY run mode**（fast/strict 语义只有 resolveRunPolicy 纯单测）：六门实现（P1）后必须恢复 fast/strict 的端到端验收，否则 fast/strict 门语义出现覆盖空窗。防再犯：P1 门禁里加"恢复 fast 集成验收"项。
7. **RunMode 新增 'exploratory' 的向下耦合**：legacy migrateRunMode 现接受 'exploratory'/'draft'；host apiproxy 类型已放宽——任何外部消费者把 RunMode 当 2 元枚举都会编译错（好事，类型即文档）。
8. **finalOutputRoot 未挂时 promotion 仍是审计-only**（persistFinal 标注 no sink）：真实部署若忘挂 sink，"已交付"语义回到虚位。防再犯：P1 demo 必须挂 sink 并在 CI 断言文件存在（sha256=审计）。
9. **RG-09 的"无条件 PASS"检测是登记表级 + 约定级**（producer 须读 IR 的静态约定尚未数据流化）：P1 给六门真实现后自然收窄。防再犯：任何新 critical producer 必须 (a) 走 registerCriticalGate (b) 读 IR 至少一次 (c) 进 `gates_impl`。

## 前向（P1/P2）

- S-009 RequirementSpec 传递：P1-4 冻结闭包算法 A7 后实现（§5.7 边界内禁止先动传播图）。
- figure_data_consistency：P2（无 Figure 数据）。
- EXPLORATORY 失去"唯一可用"地位后的模式分档产品语义（草稿 vs 提交）：作者 P2 前定稿。
