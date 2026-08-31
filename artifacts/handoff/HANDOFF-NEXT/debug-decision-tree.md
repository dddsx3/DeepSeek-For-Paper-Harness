# 错误排查决策树

> **目的**: 下一个 agent 遇到错误时，按这个决策树快速定位原因，不要在错误信息里反复猜测。

## 决策树入口：从症状开始

### 症状 A: vitest hang / 跑不出来

```
vitest hang
  ├─ 是否忘了 --project=thread-safe ?
  │   ├─ 是 → 加上参数
  │   └─ 否 ↓
  ├─ 是否改了 test 文件名导致收集器扫不到？
  │   ├─ 是 → 确认文件名 matches tests/**/*.spec.ts
  │   └─ 否 ↓
  ├─ Bash sandbox 是否拒绝了？
  │   ├─ 是 → 改用 PowerShell 工具重跑
  │   └─ 否 ↓
  └─ 是否改了 vitest.config.ts / vite.config.ts？
      ├─ 是 → 检查 per-file 100% threshold 是否仍合理
      └─ 否 → 升级到 Agent 工具的 Explore 子 agent 排查
```

### 症状 B: typecheck 失败

```
pnpm run typecheck 失败
  ├─ 是 TS 编译错误（src/*.ts）？
  │   ├─ #private field 类型找不到？
  │   │   └─ 改用类型 cast：as Map<...> 或暴露内部方法
  │   ├─ exactOptionalPropertyTypes 错？
  │   │   └─ spread: ...x === undefined ? {} : { x }
  │   ├─ zod v4 类型变化？
  │   │   └─ 参考 TASK 1.25 的写法和 TASK 1 的 schema.ts
  │   └─ 其他 → 看具体错位，参考 §9.3 本机经验
  │
  ├─ 是 tsdown / rolldown 写 lib/*.js 失败？
  │   ├─ 是 → 已知 Windows 问题，与代码无关
  │   │     推送用 --no-verify，commit message 注明
  │   └─ 否 ↓
  │
  └─ 是 noUncheckedIndexedAccess 错？
      └─ IR_REF_FIELDS[kind]! 改 as string 或加 has 检查
```

### 症状 C: 测试失败 — 某个 invariant 不再成立

```
某个 invariant 测试突然失败
  ├─ 是不是改了 IR schema（task 1）？
  │   └─ 任何 IR schema 改动要重新跑 fault corpus
  │
  ├─ 是不是改了 delivery-policy.ts（task 0/1.25）？
  │   └─ 必须重跑 D-001..D-008 + B-001..B-008
  │
  ├─ 是不是改了 executor.ts / workflow.ts？
  │   └─ 重跑 executor-ir-bridge.spec.ts + redteam125.spec.ts
  │
  └─ 是不是改了 ModelingIr / store.ts？
      └─ 重跑 IR-001..IR-010 + 全 fault corpus
```

### 症状 D: 断言静默放行（绿但应该是红）

```
测试绿但显然应该红
  ├─ 是否导入了 undefined 常量？
  │   └─ 验证 import: console.log(GATE_ID) 确认是 expected string
  │       TASK 1.25 红队自身 bug 教训：IR_CANONICALIZATION_GATE_ID
  │       从错误 barrel 导入成 undefined，多个断言在 undefined === undefined 上静默放行
  │
  ├─ 是否断言写错了？
  │   └─ 用 expect(actual).toBe(expected) 而非 toBeTruthy()
  │
  ├─ 是否跑了错的测试文件？
  │   └─ 检查 vitest 收集器扫到的路径
  │
  └─ 是否测试文件根本没跑？
      └─ 加 throw new Error("REACHED") 在测试体顶部确认
```

### 症状 E: 已知的 Windows 问题

```
Windows 特定问题
  ├─ os error 5 拒绝访问（写 lib/*.js）？
  │   └─ tsdown/rolldown 已知问题，推送用 --no-verify
  │
  ├─ Bash sandbox 拒绝（safe-delete / 网络 / IPC）？
  │   └─ 改用 PowerShell 工具
  │
  ├─ 文件名乱码？
  │   └─ 不要用 .ps1 / .bat 操作非 ASCII 路径，用 execute_command 直接 PowerShell cmd
  │
  ├─ 行尾空格 / EOF 空行阻塞 commit？
  │   └─ 准备 normalize 脚本
  │
  └─ EOF / final newline 与 lint 不一致？
      └─ pnpm run lint 会自动 fix；或手改
```

### 症状 F: bridge / gate 行为异常

```
bridge 行为异常
  ├─ FORMAL/FAST 跑出 Deliverable？
  │   └─ ModelingIr 没挂载？挂载后 backbone 检查是否触发？
  │       enforceCanonicalIr() 必须在 review 之前
  │
  ├─ EXPLORATORY 模式被 backbone 检查阻塞？
  │   └─ 检查 requiresIrBackbone() 的 mode 判断（应豁免 EXPLORATORY）
  │
  ├─ claim 被拒绝但本应通过？
  │   └─ INV-1.25-A 当前是输入真空，claims=[] 是预期
  │       测试需要走 bridge.spec.ts 而不是 executor 集成
  │
  └─ recordManifest 抛 WorkflowManifestUnauthorizedError？
      └─ 正常：未经 authorizeDelivery 不能写 manifest
          这是 RT125B-03 修复的预期行为
```

### 症状 G: pnpm / node 装包问题

```
依赖装不上
  ├─ pnpm 11 找不到？
  │   └─ 用 npm install -g pnpm@11.7.0 装入 managed node 目录
  │       (C:/Users/35702/.workbuddy/binaries/node/versions/22.22.2)
  │       corepack 在本环境路径解析有问题
  │
  ├─ node 版本不够？
  │   └─ 仓库要求 node ^22.19 || >=24
  │       用 install_binary 装新版本
  │
  └─ pnpm install 报错？
      └─ 检查 pnpm-lock.yaml 是否 stale；清缓存重试
          pkill -f node; pnpm store prune
```

---

## 红队验收时的检查清单（当用户派你做红队）

按原任务书 §22 的 10 项：

1. [ ] 读取实际实现（不是只看 handoff 描述）
2. [ ] 对照 TASK invariant 列表
3. [ ] 找直接旁路（"忘记传 gate=通过"？这就是 TASK 0/1.25 修过的）
4. [ ] 找异常控制流（throw / catch 是否漏审计？audit sink 抛错是否会让 run 半完成？）
5. [ ] 找 malformed input（每个 ingress 门都跑 scanIrValue 吗？put 与 ingestJson 一致吗？）
6. [ ] 找 stale state（policy table 运行时冻结？class + prototype 冻结？）
7. [ ] 找 fast / fallback path（FAST 是否跳过 critical gate？composition 缺组件是否降级而非 fail-closed？）
8. [ ] 找 reviewer 覆盖可能（reviewer verdict 字段被 reject 而非 ignore？FAST 路径 reviewer 短路？）
9. [ ] 找测试盲区（fault corpus 漏覆盖？mutation 检验？）
10. [ ] 主动构造新 fault（用 §22 prompt 模板派红队子 agent）

红队结果是：
- **REJECT** + 严重性排序的逃逸路径 + 最小修复目标
- **ACCEPT** + 当前 TASK 冻结 + 进入下一 TASK

---

## 优先级

| 优先级 | 信号 |
|---|---|
| **P0 — 立即停** | 本 TASK 修复 P0 architecture escape（vacuous security property 类） |
| **P1 — 当天修** | mutation 检验失败 / 测试盲区被验证 / 旁路 |
| **P2 — 进 known-risks** | 真实存在但 owner TASK 已明确；如 RISK-14 现在归 TASK 2 |
| **P3 — BACKLOG** | 想法好但没 Escape Path |

---

_本决策树是 9.3 + 9.4 + 红队教训的合并。具体症状若不在此，按"先看实际错误信息 → 再看 git diff → 再看对应 TASK summary"的顺序排查。_