# DeepSeek-For-Paper-Harness

[English](README.md) | 中文

本仓库是对 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`，由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness）的**二次开发重建**。它**不是**官方项目：这里的目标是一个面向论文写作场景的 agent harness，以下文的 *Harness* 扩展形式交付。

harness 架构与上游保持一致：**一切皆插件**，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。平台本身的所有成果属于上游团队；本仓库只在其上增加一个垂直能力层，其余部分保持与上游同步。

## 与上游的关系

| | 本仓库 | 上游 |
|---|---|---|
| 源码 | [`dddsx3/DeepSeek-For-Paper-Harness`](https://github.com/dddsx3/DeepSeek-For-Paper-Harness)，分支 `harness/phase-2-foundation` | [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) |
| 基线 | 固定在上游标签 `dsh-v0.1.1-rc.2` | 持续迭代的开发者预览；**会出现破坏兼容性的变更** |
| 范围 | Harness 扩展——`packages/harness/*` 与 profile 组合包 `@deepseek-ai/dsh-harness`——外加仅限 Windows 的门禁修复 | harness 本身 |

Harness 扩展按构建顺序增加了：

- 持久化工作流引擎：版本化的运行/节点/事件/产物记录、失败即拒的事件回放，以及启动恢复。
- 节点执行器：驱动 plan → execute → review → revise → deliver，带快速/严格复核策略、重试与退避、按 token 计算并对照日预算的成本核算、提示词上下文预算，以及按追加序号排序的审计追踪。
- 签名技能目录（对内容寻址文件做 Ed25519 签名），通过既有技能接缝提供服务；另有发布暂存、健康确认、回滚与灰度放量。
- 可续跑的历史迁移与可审核的技能内容清洗。

各包刻意保留上游的 `@deepseek-ai/*` npm scope：整个 workspace 通过该 scope 解析依赖，改名会让所有内部引用与上游无谓地分叉。完整子系统参考见 [docs/subsystems/harness.zh.md](docs/subsystems/harness.zh.md)；包级细节见 [Harness foundation README](packages/harness/harness-foundation/README.zh.md)。

<a id="run"></a>

<a id="run-from-source"></a>

## 从源码运行

```sh
git clone -b harness/phase-2-foundation https://github.com/dddsx3/DeepSeek-For-Paper-Harness.git
cd DeepSeek-For-Paper-Harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物；`pnpm dsh web` 直接使用这些已构建产物而不会重新构建，默认在 `http://127.0.0.1:3080` 启动 Web UI。传入 `--no-open` 可仅运行服务器而不打开浏览器。

注意：`npx @deepseek-ai/dsh web` 安装并运行的是 npm 上的**官方上游发行版**——不是本重建版。要运行 Harness 层，请按上述方式使用源码检出；只要 profile 在具备存储能力的模式之上包含了 `@deepseek-ai/dsh-harness` 组合包，Harness 行就会随之挂载。界面本身参见 [Web UI 指南](docs/user/guide/index.zh.md)。

## 反馈与问题

针对本分支的问题、疑问与建议请提交到[本仓库的 Issues](https://github.com/dddsx3/DeepSeek-For-Paper-Harness/issues)。

关于 harness 平台本身的疑问属于上游项目：请使用[上游 Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 与[官方 Discord 社区](https://discord.gg/Ycq5dCaS4)。中文用户也可以通过本文件中文版所列的企微渠道联系官方团队：欢迎加入企微群——扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)：开头说明本分支如何接受贡献，其后是本仓库继承的上游贡献声明。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。Harness 的设计决策记录在架构 Agent Note [.agents/notes/implemented/architecture/2026-08-22-harness-foundation-seams.zh.md](.agents/notes/implemented/architecture/2026-08-22-harness-foundation-seams.zh.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)，同上游。第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
