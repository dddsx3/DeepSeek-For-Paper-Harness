# `@deepseek-ai/dsh-paper`

[English](README.md) | 中文

以 profile 组合包形式交付的 Paper 工作流层：[`cordis.patch.yml`](cordis.patch.yml) 在 `dsh-base` 与 profile 所用的模式组合包之上插入四条 Paper 行——[foundation 组合](../paper-foundation/README.zh.md)（角色 settings、provider 路由、持久化运行引擎、节点执行器、审计轨迹与发布）、签名技能目录、为目录中活跃版本提供服务的 provider，以及运行时不变量伴生插件。它不添加任何属于自己的 Host、HTTP 或浏览器行；profile 组合器通过 manifest（元数据清单）的 `dsh.bundle.patch` 字段解析该 patch，而不是通过代码。

该层需要 profile 提供存储：`storage`、诸如 `storage-json` 的后端，以及 `storage-domain`。每条 Paper 行都在其注入项上挂起，因此把本层叠加在没有存储的模式之上的 profile 会挂载这些行却永不激活它们——这种沉默从外部很难读懂。`missingPaperServices` 会指出缺少哪一项要求，插件在加载时告警一次；它仍然完成挂载，因为这些服务可能由后续的 patch 行提供，届时 Cordis 会激活这些行。

随部署变化的取值刻意保持保守：不配价格表（未定价的路由计为零费用）、不配信任根（任何签名技能包与发布清单都会被拒绝），并且目录与发布策略的 `allowUnsigned` 均为 false。需要灰度更新、真实价格或自有签名密钥的 profile，在自己的 `cordis.patch.yml` 里按 id 定位对应行；patch 会替换整行 `config`，因此覆盖时必须重述所有需要保留的字段。三个模型路由只写凭据*引用*（`DEEPSEEK_API_KEY`），从不写凭据值——由既有的 credentials 接缝在 provider 边界解析。

## 模型体验

通过插入的行间接产生影响：该组合包是 patch 列表的载体，每条 Paper 行的模型可见行为由其所属的包负责。

#### KV Cache 影响

无直接影响；每条插入行的影响由其所属的包负责。

## 已知限制与暂缓事项

- **patch 会替换整行 `config`**：profile 覆盖必须重述该行需要保留的每个字段；不存在深度合并层。
- **在部署指定签名密钥之前，自更新处于关闭状态**：随包交付的 `releasePolicy` 不信任任何密钥，因此所有发布清单都会被拒绝。这是刻意的默认值；`allowUnsigned` 只是开发期便利项，在生产构建中会被直接拒绝。
- **本层不自带存储**：叠加在没有存储的 profile 之上时，它只告警并让这些行保持未激活，而不会挂载兜底后端——这样运行状态绝不会落到 profile 没有选择的地方。
