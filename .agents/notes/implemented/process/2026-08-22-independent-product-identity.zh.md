# Agent Note：独立产品身份（dph 命令、DPH_HOME 隔离、延后的整体更名）

状态：已实施

[English](2026-08-22-independent-product-identity.md) | 中文

## 问题

本仓库最初以"官方分支叠加层"的形态存在：默认分支指向官方发布快照、CLI 入口叫 `dsh`、用户数据放在 `~/.dsh`、对外界面（web manifest、页面标题、系统提示词开场白、引导文案）都以 "DeepSeek Harness" 作为产品名。但本产品不是官方渠道的发行版，而是采用 dsh 作为 vendor 基座的独立论文写作 harness——上述每一个默认值都制造了错误的第一印象，并构成真实的冲突面：同一台机器上与官方产品共用 `~/.dsh` 状态、CLI 命令名相撞、默认分支是别人的发布线。

## 决策

产品身份已端到端自有：

- **分支主权。** `main` 是默认分支并承载产品主线；官方历史仅能经 `upstream` remote 访问，且未经评审不进入 `main`。
- **CLI 命令。** 启动命令为 `dph`（根脚本 `pnpm dph`、commander 程序名、帮助文本与面向用户的文档同步）。内部 npm 包名暂保留 `@deepseek-ai/dsh-*` scope——它们全部 `private: true` 且永不发布，不存在注册表冲突。
- **数据隔离。** `@deepseek-ai/dsh-home-paths` 以 `$DPH_HOME`（回退 `~/.dph`）解析单根用户数据目录；不再读取 `DSH_HOME` 与 `~/.dsh`。设置、凭据、附件、profile、preset、匿名标识以及暴露给 shell 的 home 变量全部经由这一个接缝，官方 dsh 与本产品永不共享状态。
- **对外品牌。** web manifest、页面标题、侧栏/hero 品牌槽位（文字标 "dph"）、PWA 名称、系统提示词开场白、源码检出声明段、agent preset 人设与引导声明均呈现 DeepSeek-For-Paper-Harness；上游在 README 与 LICENSE（保留双版权行）中获得署名。
- **延后整体更名（本条即持久提醒）。** 把全部内部包迁出 `@deepseek-ai/dsh-*` scope——连同残余的内部 JSDoc 叙述、示例 bin（`dsh-acp-demo`、`dsh-jsonrpc-agent`）、`dsh-badge` 技能与 `dsh-v*` tag 谱系——刻意推迟到首次公开发布时执行。在此之前本条是常设指令：任何将产品公开发布的改动必须同批执行完整 rescope，因为[预发布立场](../../../AGENTS.md#pre-release-stance-foundation-over-blast-radius)将在那个 tag 失效。更名机制遵循[仓库命名契约](2026-08-11-repository-naming-contract-and-rename-ledger.md)；vendor 包先例见 [vendor package rescope](2026-08-10-vendor-package-rescope.zh.md)。

## 已考虑的替代方案

- **立即重命名全部包。** 本轮否决：虽然零发布消费者时改名安全，但会在产品尚未发布一次之前放大与 `upstream` 的 diff，抬高此后每次选择性同步的成本。以书面触发条件延迟，而不是依赖记忆。
- **保留 `dsh` 命令作为别名。** 否决：别名会在 PATH 上与官方安装相撞，并模糊哪个二进制拥有哪个数据目录；一个命令对应一个 home。
- **回退读取旧 `DSH_HOME`/`~/.dsh`。** 否决：与官方安装共享状态正是本次决策要移除的冲突。

## 后果

- 早期叠加层用户升级到本次身份切换后，旧存于 `~/.dsh` 的设置不会自动迁移；预发布阶段可接受，前代产品数据由迁移导入器单独覆盖。
- 所有陈述旧默认值的文档、快照与夹具已在同一次变更中更新（home 字面量、身份句、源码声明段、帮助文本）；受影响双语文档的配对记录已重新录制。
- 延后的 rescope 由本条追踪而非散落的 issue：准备首次发布时搜索 `independent-product-identity`。
