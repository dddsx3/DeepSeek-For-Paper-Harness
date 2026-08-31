# HANDOFF-NEXT 目录索引

> 6 个文档，分两层：**README.md 是主入口**，其他 5 个是 REFERENCE / DETAIL。
> 
> 下一个 agent 开始工作时，按下面顺序读即可。

---

## 推荐阅读顺序（5 分钟上手）

### Step 1（2 分钟）— 主入口

📄 **[README.md](./README.md)**

14 节文档，覆盖：
- 项目身份 + 工程哲学
- 仓库现状（包结构、测试覆盖、fault corpus）
- 已完成 TASK 清单
- **下一阶段 TASK 1.5 任务书原文 + 衔接 + 隐含约束 + 推荐执行顺序 + 开放疑问**
- Coding AI System Contract
- 单人开发工作协议
- 永久 Invariants
- 已知风险
- Windows 经验
- 推送流程
- 红队协议
- 错误排查速查
- 路径速查
- 一句话总结

### Step 2（1 分钟）— Git 状态

📄 **[git-state.txt](./git-state.txt)**

当前 commit 图、push 状态、环境配置（Windows 节点路径、pnpm 版本、已知问题）。

### Step 3（2 分钟）— 写代码前必过

📄 **[preflight-checklist.md](./preflight-checklist.md)**

7 类清单：上下文确认 / 工具可用性 / 设计期必做 / 红队计划 / Git 准备 / 不要做的事 / 不通过时的处理。

### Step 4（按需查阅）— REFERENCE

| 何时查阅 | 文档 |
|---|---|
| 给 Coding AI 派任务时 | [system-contract.md](./system-contract.md) |
| 报错时 | [debug-decision-tree.md](./debug-decision-tree.md) |
| 想 drive-by 修某风险时 | [risk-inheritance.md](./risk-inheritance.md) |
| 找不到某个文件/import 时 | [key-paths.md](./key-paths.md) |

---

## 6 个文档的关系图

```
                        ┌─────────────────────┐
                        │     README.md       │ ← 主入口
                        │  (5 分钟读完)       │
                        └──────────┬──────────┘
                                   │
                ┌──────────────────┼──────────────────┐
                │                  │                  │
        ┌───────▼──────┐   ┌───────▼──────┐   ┌───────▼──────┐
        │ git-state    │   │ preflight    │   │ system-      │
        │ .txt         │   │ -checklist   │   │ contract.md  │
        │              │   │ .md          │   │              │
        │ (1 分钟)     │   │ (写代码前)   │   │ (派任务时)   │
        └──────────────┘   └──────────────┘   └──────────────┘

        ┌─────────────────┐  ┌─────────────────┐
        │ debug-decision- │  │ risk-inheritance│
        │ tree.md         │  │ .md             │
        │                 │  │                 │
        │ (报错时)        │  │ (想 drive-by    │
        │                 │  │  修风险时)      │
        └─────────────────┘  └─────────────────┘

                    ┌─────────────────┐
                    │ key-paths.md    │
                    │                 │
                    │ (找不到东西时)  │
                    └─────────────────┘
```

---

## 何时更新这些文档

| 时机 | 更新什么 |
|---|---|
| TASK 1.5 LOCAL GATE PASSED 后 | 把 `git-state.txt` 的 commit 图更新；标记 RISK-03 / RISK-04 部分解决（如有） |
| 新增 TASK 完成后 | README.md §4 已完成 TASK 表格追加；§5 改为下一阶段；risk-inheritance.md 状态更新 |
| 发现新踩坑时 | debug-decision-tree.md 追加决策树分支 |
| Windows 环境问题修复时 | README.md §9.3 / preflight-checklist.md 更新 |
| 永久 Invariant 新增时 | system-contract.md 同步 |

---

## 文档版本

- **版本**: v1.0
- **创建时间**: 2026-08-30 04:30 (GMT+8)
- **配套主线 commit**: `622b46cc46`（TASK 1.25 commit ref 记录）
- **预期下一阶段**: TASK 1.5

---

_本目录是项目跨阶段的"接力棒"。任何下一阶段 agent 接手时都应该先看 README.md。_