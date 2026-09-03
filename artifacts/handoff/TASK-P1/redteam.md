# TASK-P1 — redteam（击杀证明汇总）

> P1 的全部击杀按组件/门列出：攻击名 → 击杀点 → 证据 spec/runner。
> 每条 kill 都是真实执行或真链跑的（非桩）。

## P1-1 结构化输出生产者（tests/produce/ir-producer.spec.ts, 8）
- ① schema 违例全拒零写（schema_violation + zod 路径）
- ② 缺必填带路径
- ③ ExecutionRecord 偷渡 → execution_record_forbidden（INV-3-M）
- ④ 非白名单 kind（RunArtifact/Result/Claim 等）→ kind_not_producible
- ⑤ 同 id 冲突 → conflicting_id（append-only，覆盖 put = duplicate）
- ⑥ 无宽容清洗：字段逐字节入库（含非 ASCII）
- 接线（tests/executor-producer.spec.ts, 2）：合法容器 run completed +
  8 条 ir_entry_written 审计；schema 违例容器 retry→耗尽→BLOCKED，store 空。

## P1-2 执行捕获生产接线（execution-producer.spec，CI 权威真 spawn）
- 真 node 子进程一次 → RunArtifact + ExecutionRecord 落 IR，链非 STALE
- 攻击 无 record 声称执行/产出集与声明不符（OUTPUT_SET_MISMATCH，runner
  不再伪装缺失文件）→ 拒且零 record 提交
- capture/runner/replay 语义由 capture-replay.spec + real smoke 背书

## P1-3 numeric + Result/Claim 生产（numeric-consistency.spec 5 +
  interpretation-producer.spec 9 + renderer）
- Result 值漂移 0.731→0.732 → numeric BLOCKED；单位 'm'→'cm' 同
- 数字只从真实输出注入：换 bytes 值随之（模型无自有数字）；6 类结构/
  源/绑定/冲突攻击全拒零部分写（D12）
- renderer：结论 0.732 vs Result 0.731 → 渲染拒；'km^-1' 单位指数与
  uncertainty 不误杀（D5 实证修正）

## P1-4 内容门（gate-v014 6 + gates-p14b 5 + figure-consistency 3 +
  gate-loadcode 4 + numeric 5）
- reference_validation：synthetic 悬挂引用 → finding；canonical 无
- execution：无 record 的 claim 链 → no_record_for_run BLOCK；backbone
  通过；loadCode 伪造字节 → S-007 CODE_MISMATCH 经 buildDeliveryPolicy
  注入 BLOCK execution+stale_detection（真实接线）
- requirement_coverage：N outputs 缺 result → BLOCK（A7 count-bound）
- runtime_integrity：schema 锁 64-hex；synthetic 畸形指纹 finding
- figure vacuous：无 FigureSpec PASS / 有 → BLOCK（D3）
- sync-hack removal：async loadCode 不再 crash/hang（JS 调用方）

## P1-5 pass corpus（demo runner 真链击杀）
- TOO-GOOD：结论 0.732 vs 真实 Result 0.731 → renderer refused
  （conflicting_conclusion_number）
- OVER-PROMISE：2 REQUIRED_OUTPUTs vs 1 个 reaching Result →
  requirement_coverage BLOCKED
- 误杀率首基线：3/3 legal leaf DELIVER = False Block Rate 0/3
