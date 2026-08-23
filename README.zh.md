# DeepSeek-For-Paper-Harness（dph）

[English](README.md) | 中文

**DeepSeek-For-Paper-Harness** 是一个面向论文写作场景的独立 agent harness 产品。它采用开源项目 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）作为技术基座——复用其 Cordis 插件体系与会话、工具执行栈——并在此基础上构建了持久化、可审计的论文写作工作流层。本产品与基座相互独立：命令行入口（`dph`）、品牌、用户数据目录（`DPH_HOME`，默认 `~/.dph`）与默认分支完全自有，上游仅通过 `upstream` remote 做选择性同步。

## 它做什么

一次运行接收一个任务，驱动它走完 **plan → execute → review → revise → deliver**，每条事实在被依赖之前都已持久化：

- **持久化工作流引擎** — 版本化的运行/节点/事件/产物记录存放在 `storage-domain`；事件日志回放失败即拒；运行可跨进程重启存活并在启动时恢复。
- **带复核策略的节点执行器** — fast 模式在一轮修订后交付；strict 模式允许三轮并在缺陷仍存在时失败。尝试次数用尽的节点转入暂停待人工复核而非失败，恢复后的运行从该节点继续。
- **成本与上下文控制** — 花费由 token 数按配置价格表与日预算推导（绝不信任提供方返回的成本字段）；提示词按声明优先级先裁剪低价值分段，以适配模型窗口。
- **审计追踪** — 按追加序号排序、按保留期清理、凭据遮蔽；暂存、激活、回滚、迁移以及每次运行边界都会进入追踪。
- **签名技能与发布** — 技能包在加载前校验清单、文件哈希、信任根与 Ed25519 签名；发布是"内容寻址产物"的签名清单，支持灰度放量、健康确认，以及对未证实版本的自动回滚。
- **历史迁移** — 面向前代数据的干跑式、可续跑导入器；绝不修改旧数据源。

写作层以一个 profile 组合包挂载到具备存储能力的模式之上：`@deepseek-ai/dsh-paper` 会把组合、签名技能目录及其 provider、invariant 伴生插件插入任意 profile。完整子系统参考见 [docs/subsystems/paper.zh.md](docs/subsystems/paper.zh.md)。

## 与开源基座的关系

- `vendor/` 内置 Cordis 源码；`packages/` 下大部分 `@deepseek-ai/dsh-*` 包是基座能力（全部 `private: true`，不发布到 npm）。
- `packages/paper/*` 是本产品的增量：工作流状态机、复核执行器、成本预算、审计、签名技能与发布、历史迁移。
- 上游更新经 `upstream` remote 人工评估后选择性合入；本仓库的 `main` 分支永不指向官方快照。
- 与官方 dsh 共存不冲突：CLI 命令为 `dph`，用户数据位于 `DPH_HOME`（默认 `~/.dph`），不读写 `~/.dsh`。

<a id="run"></a>

## 运行

需要 Node.js ^22.19 或 ≥24（自带 Corepack）与 Git。

### Windows 快速开始

1. 安装 [Node.js LTS](https://nodejs.org/)（安装器会一并启用 Corepack）；
2. 克隆本仓库：

   ```bat
   git clone -b main https://github.com/dddsx3/DeepSeek-For-Paper-Harness.git
   cd DeepSeek-For-Paper-Harness
   ```

3. 双击 `setup.bat`（等价于 `corepack enable && pnpm install && pnpm run build`），或手动执行同样命令；
4. 复制 `.env.example` 为 `.env` 并填入 `DEEPSEEK_API_KEY`；
5. 双击 `start.bat`（等价于 `pnpm dph web`），浏览器会打开 `http://127.0.0.1:3080`。传 `--no-open` 可不自动打开浏览器。

### macOS / Linux

```sh
git clone -b main https://github.com/dddsx3/DeepSeek-For-Paper-Harness.git
cd DeepSeek-For-Paper-Harness
corepack enable
pnpm install
pnpm run build
pnpm dph web
```

### 启用写作层

把组合包加入 profile 的 `dsh.profile.bundles` 列表：

```yaml
dsh:
  profile:
    bundles:
      - '@deepseek-ai/dsh-base'
      - '@deepseek-ai/dsh-web-app'
      - '@deepseek-ai/dsh-paper'
```

在 profile 的 `cordis.patch.yml` 中按行 id（`paper`、`paper-skill-catalog` 等）配置角色路由：

```yaml
- insert:
    - id: paper
      config:
        executor:
          provider: deepseek-official
          model: deepseek-v4-flash
          # A reference resolved through the credentials seam — never a value.
          credentialRef: DEEPSEEK_API_KEY
        defaultMode: fast
```

默认保守：不配价格表则计零费用，不配信任根则拒绝所有签名包与发布，未签名包仅在开发模式加载。每一行与每个字段见 [patch 文件](packages/paper/paper-bundle/cordis.patch.yml)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。写作层的设计决策记录在架构 Agent Note [.agents/notes/implemented/architecture/2026-08-22-paper-foundation-seams.zh.md](.agents/notes/implemented/architecture/2026-08-22-paper-foundation-seams.zh.md)；产品定位与命名空间决策记录在 [.agents/notes/implemented/process/2026-08-22-independent-product-identity.zh.md](.agents/notes/implemented/process/2026-08-22-independent-product-identity.zh.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。贡献流程：[CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)。

## 许可证

[MIT](LICENSE)。基于 DeepSeek Harness 开源版本构建，致谢上游作者；第三方依赖见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
