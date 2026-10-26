# runs/ —— 真实运行产物目录（不入库）

> 2026-10-27 项目治理确立：**仓库 = 源码 + 决策文档；运行 = runs/ 目录**。
> 本目录除本 README 外整体 gitignore（运行日志与审计文件含机器本地信息）。

## 什么放这里

- paper-shell / cockpit 每次真实运行或 fake 运行的全部输出：
  `report.md`、`figures/`、`audit-trail.json`、`deliverable.zip`、`run-report.json`
- 运行启动脚本（循环 bash/cmd，含中转配置）
- 控制台日志、失败现场（traceback、`_runtime-failure.txt`）
- paper-shell 的持久化根 `<runs>/persist/paper-shell-persist-*`
  （cockpit 的运行发现读这里；历史位置是 apps/paper-shell/src，已废弃）
- cockpit 上传的题目与数据 `<runs>/cockpit-problems/`、运行输出 `<runs>/cockpit-out/`

## 目录规约

```
runs/
├─ persist/                        # paper-shell 存储域持久化（mkdtemp 自动建）
├─ cockpit-problems/               # cockpit 上传的题目
├─ cockpit-out/                    # cockpit 驱动的运行输出
└─ run-<日期>-<题号>-<slug>/       # 手工运行的输出（自建目录时用这个命名）
   ├─ scripts/                     # 本次运行的启动脚本
   └─ logs/                        # 控制台日志、失败现场
```

- **只进不改**：一次运行结束后目录视为只读证据；重跑 = 新目录。
- 不要把决策/结论写进 runs/——决策文档放 `artifacts/handoff/`（入库），
  运行证据留 runs/（不入库）。

## 相关配置

| 环境变量 | 默认 | 作用 |
|---|---|---|
| `PAPER_RUN_DIR` | `<仓库根>/runs` | 运行产物根（persist/cockpit-*/默认 out 都在它下面） |

历史运行档案（已入库、不可变的过程记录）仍在 `artifacts/upper-bound/` 与
`artifacts/handoff/` 各轮次目录里；**新运行一律写 runs/，不再进 artifacts/**。
