# TASK-P2-C — 首批实测协议(pilot-protocol,定稿冻结)

> 定稿后修改 = Study Batch B(禁 P2-B #4)。知情同意文本随 manifest 冻结。
> 裁决单签批(代签,沿用先例):**P-A=B**(7 已知题作锚 + ≥17 新题)、
> **P-B=B**(交付冷却后自复核 + 审计轨独立交叉)、**P-C=B**(首名 pilot 先行)。

## 0. 实测定位(专家计划书 §9 逐条承接)

n=3-5 人 case-series:**只做 feasibility / case-series,不做任何总体效果
结论**。重点不是"成功率多少",而是**系统到底在哪里真实失败**(任务书 §9)。
实测前对表:档期冲突(考试周)者换人(M3 口径保护)。

## 1. 三预注册指标(每个 case 全程记录)

### M1. Strict Delivery Success(x/5 原始数)

`S_i = 1` 当且仅当:
- strict 模式完成;全部 mandatory gates PASS;生成最终 artifact(deliverable.zip);
- **没有开发者修改内部状态/数据库/IR**(任何人工介入 = S_i = 0,记入支持日志)。

报告口径:**x/5 原始数**,禁止百分比精度包装(禁 P2-C #6)。

### M2. Undetected Defect Count(False Accept,最高优先)

- 交付 zip 由**独立复核**过目(裁决单 P-B=B):
  1. **自复核**:操作者交付后冷却 ≥24h,逐项过(数字/引用/图表-数据一致性/公式/claim);
  2. **审计轨交叉**:交付归档交审计方独立复核;分歧 case 逐条裁决。
- 统计:harness 放行而人工发现的**实质错误**逐条归档(id/case/位置/描述/严重度)。
- **False Accept 比 False Block 更危险**(系统哲学):M2 优先于用户满意度。

### M3. Human/Compute Cost per Delivery

- 人工分钟数:**用户时间与支持者时间分开记**(操作日志字段 user_minutes /
  support_minutes,自我报告 + 支持者当场记);
- 每 run telemetry 导出真钱成本(TASK-P2/pricing.json 口径;未配价 = 0 注明);
- 汇报口径:per delivered paper。

## 2. FalseBlock 次级指标(裁决表)

每个 BLOCK 逐条归档:

```json
{
  "case_id": "...",
  "gate": "Gxxx",
  "failure_code": "...",
  "model_output_head": "(前 120 字符)",
  "validator_evidence": "...",
  "adjudication": "TRUE_BLOCK | FALSE_BLOCK | UNCERTAIN",
  "adjudication_reason": "(一行)",
  "adjudicated_by": "operator | auditor",
  "at": "(ISO 时间)"
}
```

n=5 只给原始 counts 与逐 case 描述,不主张总体 FalseBlockRate。

## 3. n=5 纪律(禁 P2-C #6)

- **禁止**:"成功率 xx%"、"显著优于…"、"验证了…有效性"式表述;
- **允许**:x/5、逐 case 叙述、失败分类计数、成本表;
- 论文表述预注册:"feasibility case-series, n=5, 描述统计 only"。

## 4. 实测流程(P-C=B:首名 pilot 先行)

1. **冻结**:STUDY_MANIFEST 落库 commit(先于任何用户 run,G6);
2. **首名用户**(pilot of the pilot)完整走通;协议 bug 修入 Batch A 补丁
   (若触及 manifest 冻结字段 → 如实触发 Batch B,禁 4 无例外);
3. 其余 2-4 人并行;单用户 >2 天无进展 → 人工介入会诊(M1 先例);
4. 数据回收:M1/M2/M3 三表 + FalseBlock 归档 + 独立复核交叉。

### 外壳/引擎 bug 分账(沿用 M1 先例)

外壳 bug(读题/打包/CLI)与引擎 bug(门禁/准入/执行)分开记;两类的修复路径
不同(外壳可热修入 Batch A 补丁——不动 manifest 冻结字段;引擎语义改动一律
Batch B)。

## 5. 知情同意(随 manifest 冻结)

对每名用户,进场前书面确认:

1. 产出由 AI 生成系统辅助完成,**初稿 ≠ 可提交论文**;
2. 全程数据(运行记录/BLOCK/时间)用于研究归档,题目内容脱敏后可入论文附录;
3. AI 生成内容将按学术规范披露;
4. 随时可以退出,退出后已产生数据继续匿名归档(可协商删除题面细节)。

## 6. 每用户登记字段(进 manifest users[])

| 字段 | 说明 |
|---|---|
| user_id | 匿名编号(user-1..5) |
| tier | 分配层(首批全部 T3;T3.5 待 P2-A 结果决定是否入 Batch B) |
| problem_file / problem_sha256 | 题目文件 + 内容哈希(冻结) |
| 时间窗 | 进场-交付计划区间(M3 口径保护) |

## 7. 交付物

- 每用户:deliverable.zip + run-report(嵌 manifest_hash)+ BLOCK 裁决表 + 支持日志;
- 批级:M1 x/5 表、M2 缺陷账、M3 成本账、FalseBlock 裁决表、独立复核记录;
- 归档:`artifacts/handoff/TASK-P2/study/`(目录随首批冻结落库)。

---

*定稿:2026-09-08(三裁决单 B/B/B 代签入库,见 decision-log)。修改本文件中
任何指标定义/M2 独立性安排 = Study Batch B。*
