# TASK-P3D — 供应商解耦批次（vendor decoupling）

> 起因：作者约束——测试阶段非必须不使用官方端点（DeepSeek/OpenAI 等），
> 项目将转向中转商生态；**整个项目不得预置或默认走任何单一供应商**
> （官方与非官方一视同仁）。本批次把该约束落成代码 + CI 守卫。
> 上游：TASK-P3（`9a03db4516`）。

## 政策（一句话）

**任何运行路径都没有隐式供应商端点。** 要调用谁，必须显式配置（config /
环境变量 / settings）；未配置 = 大声失败，绝不静默路由。

## 交付清单

### D-1 llm-deepseek 适配器去隐式默认

- `resolveRequiredBaseURL()`：`config.baseURL ?? $DEEPSEEK_BASE_URL` 为空 →
  加载即抛错，错误消息点名两个配置旋钮。`PUBLIC_BASE_URL`
  （`https://api.deepseek.com`）**降级为纯导出常量**——组合层想用官方必须
  显式引用，不再作为任何 fallback。
- 原 "defaults to the public base URL without config or env" 测试改为断言
  **拒绝**（vendor-decoupling 反向测试）；其余 24 处直接调用
  `resolveAdapterOptions` 的单测补显式 `http://unit.test` 端点。

### D-2 web-search-deepseek 同款去默认

- `requireSearchBaseURL()`：注册期（apply）即拒绝未命名端点的部署；
  `DEEPSEEK_DEFAULT_BASE_URL` 同样降为显式常量。
- env fallback 测试改为断言 `$DEEPSEEK_SEARCH_BASE_URL` 被遵守 + 新增
  无端点拒绝测试。

### D-3 E2E 栈供应商中立化

- 新增 `examples/headless-agent/tests/e2e-llm-route.ts`：
  `DSH_E2E_LLM_PROVIDER / MODEL / API_KEY / BASE_URL` 变量族（legacy
  `DEEPSEEK_*` 兼容 fallback），**全部无默认端点指向**。
- 7 个 e2e 测试 + `harness.ts` + `code-mode` 本地栈改读该解析器；
  `cordis.yml` / `advanced.cordis.yml` 组合层 `baseURL/provider/model` 全部
  改 `!!js process.env...` 表达式（回放 snapshot 语料按其文件头语义保留
  ——录制数据非运行路由）。
- `e2e.yml`：**删除 `DEEPSEEK_BASE_URL: https://api.deepseek.com` pin**；
  secrets 参数化为 `DSH_E2E_LLM_*_EXTERNAL`（+legacy 名），preflight 改为
  "两族任一凭据存在即可"，缺失则大声失败（无静默绿）。

### D-4 base bundle 组合显式化

`dsh-base` 的 `llm-deepseek` 与 `web-search-deepseek` 行加
`baseURL: !!js process.env... || ''`（空串=交给 settings/env 层，绝不落到
供应商默认），注释写明部署义务。

### D-5 防回潮守卫（机器可查）

- `scripts/verify-vendor-neutrality.mjs`：git-grep 六家供应商端点
  （deepseek/openai/anthropic/google/x.ai/mistral），白名单内（命名常量、
  测试夹具、文档、回放语料、探针归档，**每项带理由**）放行，其余 FAIL。
- 接入 `ci.yml` node-24 static gates 之后独立 step —— 任何 PR 想塞回预置
  端点都会红。
- 负向自测已做：decoy 追踪文件能被抓到（见 redteam 记录）。

## 验证

- tsc host 链 0 错误；改动包单测全绿（llm-deepseek + web-search-deepseek
  395/395；bundle 36/36）；keyless e2e 冒烟 1/1（新 cordis.yml 真实 Loader
  boot）。
- 守卫脚本：当前树 PASS；decoy 注入测试 FAIL（证明有效）后清理。

## 红测（redteam 摘要）

| 攻击 | 证明 |
|---|---|
| 无端点启动 llm-deepseek | `adapter.spec.ts` "refuses registration without config or env endpoint" —— rejects /no endpoint configured/ |
| 无端点启动 web-search-deepseek | `deepseek.spec.ts` "refuses to resolve with NO endpoint" —— apply 抛 /no endpoint configured/ |
| 往源码塞回预置端点 | `verify-vendor-neutrality.mjs` decoy 注入 → exit 1 并列文件行号 |
| E2E 走中转 | `e2e.yml` 无任何硬编码 URL；路由全经 `DSH_E2E_LLM_*` |

## 已知边界（known-risks 增补）

- **回放语料（*.snapshot.yml）** 保留录制时的模型 id/provider 名——这是
  重放可复现性数据（llm-replay 无网络），不是运行路由；守卫白名单已注明。
- **subagent-claude-code 真实 e2e** 钉官方端点：Claude Code CLI 本身只会
  说官方 API，该套件是 opt-in 的集成验证，不影响部署路由；白名单注明。
- probe 归档脚本（TASK-P2/P3）含 legacy 端点 fallback 字面量——归档产物
  与其脚本须一致，白名单注明；新批次探针一律走 `PAPER_PROBE_*` 环境变量。
- pi-ai 的 catalog 测试断言供应商目录数据形状——测试夹具，非路由。

## 作者 TODO

- 在仓库 Settings 配置 `DSH_E2E_LLM_API_KEY_EXTERNAL` +
  `DSH_E2E_LLM_BASE_URL_EXTERNAL`（指向你的中转商），E2E 即走中转；
  原有 `DEEPSEEK_API_KEY_EXTERNAL` 若保留，需同时配
  `DEEPSEEK_BASE_URL_EXTERNAL`（不再有隐式官方 pin）。
- `pi-ai-provider-e2e.yml`（Azure OpenAI + Anthropic，手动触发、无 push
  触发）未动——它本就是 opt-in 双供应商验证，不构成预置路由；如需中立化
  可后续套用同款变量族。
