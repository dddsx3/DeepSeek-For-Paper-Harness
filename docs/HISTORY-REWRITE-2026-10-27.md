# 历史重写记录 —— 2026-10-27

> 沿用 2026-09-05 全历史重写的先例惯例：本文是本次重写的**事实存档**。
> 重写由 2026-10-27 项目治理轮执行（动机与过程见 [`docs/PROJECT-MAP.md`](./PROJECT-MAP.md) §7）。

## 重写范围（全部历史，13,550 个提交，git filter-repo 2.47.0）

1. **密钥字面量替换**（4 个真实凭据 → `***REMOVED***`，适用于全历史所有 blob）：
   - mhcoding 中转 key（`artifacts/upper-bound/2024B-ingest-1/run-mh.sh` 原内容）
   - teamorouter 中转 key（`run-3-to-6.sh` 原内容）
   - opencode key（`run-7-to-13.sh`、`run-oc.sh`、未跟踪的 `run-loop-detached.sh` 原内容）
   - y-api key（`apps/cockpit/cockpit-settings.json` 的本地配置值，保险起见一并替换）
2. **路径清除**：`bench/problems/2024-E/attachment-2.csv`（491MB，曾以 Git LFS 入库）
   从全部历史移除；文件保留在本机原位，获取方式见 `bench/problems/2024-E/README.md`。

## 验证结果（重写后实测）

- `git log --all -S <各 key 片段>` → 全部 0 命中；
- `git log --all -- bench/problems/2024-E/attachment-2.csv` → 空；
- `.git` 体积 647MB → **168MB**（pack 159MB）；
- 工作树干净；三分支（main/master/digital-assets）与 4 个 `dsh-v*` tag 均按重写后历史重建。

## 映射与回滚

- **old→new 全量映射**：`.git/filter-repo/commit-map`（13,550 行；例如治理前 HEAD
  `922ce0dadf` → 重写后 `e69faf77ff`）。
- **回滚资产**：重写前完整 bundle 备份在仓库外
  `<工作区根>/_archive/deepseek-harness-pre-rewrite-2026-10-27.bundle`（157MB）。
- **⚠️ 三把真实 key 必须作废轮换**（重写只保护历史，已泄漏的 key 本身仍然有效）：
  mhcoding / teamorouter / opencode 各一把；y-api 一把建议一并轮换（曾存于本地未跟踪文件）。

## 上游 remote

`upstream`（官方 deepseek-ai/deepseek-harness）不受影响、未重写；它只是本仓库的
选择性同步来源。
