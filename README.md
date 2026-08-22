# DeepSeek-For-Paper-Harness

English | [中文](README.zh.md)

This repository is a **secondary-development rebuild** of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), the open-source agent harness developed by [DeepSeek AI](https://deepseek.com). It is **not** the official project: the goal here is a paper-writing-oriented agent harness, delivered as the *Harness* extension described below.

The harness architecture is unchanged from upstream: **everything is a plugin**, powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper). All credit for the platform belongs to the upstream team; this repository adds one vertical capability on top of it and keeps everything else tracking upstream.

## Relationship to upstream

| | This repository | Upstream |
|---|---|---|
| Source | [`dddsx3/DeepSeek-For-Paper-Harness`](https://github.com/dddsx3/DeepSeek-For-Paper-Harness), branch `harness/phase-2-foundation` | [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) |
| Baseline | pinned at upstream tag `dsh-v0.1.1-rc.2` | moving developer preview; **compatibility-breaking changes happen** |
| Scope | the Harness extension — `packages/harness/*` and the profile bundle `@deepseek-ai/dsh-harness` — plus Windows-only gate fixes | the harness itself |

What the Harness extension adds, in build order:

- A durable workflow engine: versioned run/node/event/artifact records, fail-closed replay, and startup recovery.
- A node executor driving plan → execute → review → revise → deliver, with fast/strict review policies, retry and backoff, token-derived cost accounting against a daily budget, prompt context budgeting, and an append-ordered audit trail.
- A signed skill catalog (Ed25519 signatures over content-addressed files) served through the existing skill seam, plus release staging with health confirmation, rollback, and staged rollout.
- Resumable legacy migration and reviewable skill-content cleansing.

Packages keep the upstream `@deepseek-ai/*` npm scope on purpose: the workspace resolves through that scope, and renaming it would diverge every internal reference from upstream for no functional gain. The full subsystem reference lives in [docs/subsystems/harness.md](docs/subsystems/harness.md); package-level detail is in the [Harness foundation README](packages/harness/harness-foundation/README.md).

<a id="run"></a>

<a id="run-from-source"></a>

## Run from source

```sh
git clone -b harness/phase-2-foundation https://github.com/dddsx3/DeepSeek-For-Paper-Harness.git
cd DeepSeek-For-Paper-Harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts; `pnpm dsh web` uses those built artifacts without rebuilding and starts the Web UI at `http://127.0.0.1:3080` by default. Pass `--no-open` to run the server without opening a browser.

Note that `npx @deepseek-ai/dsh web` installs and runs the **official upstream release** from npm — not this rebuild. To run the Harness layer, use a source checkout as above; the Harness rows mount wherever a profile includes the `@deepseek-ai/dsh-harness` bundle over storage-capable modes. See [Web UI guide](docs/user/guide/index.md) for the interface itself.

## Feedback and issues

Fork-specific problems, questions, and suggestions go to [this repository's Issues](https://github.com/dddsx3/DeepSeek-For-Paper-Harness/issues).

Questions about the harness platform itself belong to the upstream project: [upstream Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) and the [official Discord community](https://discord.gg/Ycq5dCaS4). Chinese-language users can also reach the official community through the WeCom channels listed in the Chinese version of this file.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md): it opens with how this fork accepts contributions, followed by the upstream contribution statement this repository inherits.

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md). The Harness design decisions are recorded in the architecture Agent Note [.agents/notes/implemented/architecture/2026-08-22-harness-foundation-seams.md](.agents/notes/implemented/architecture/2026-08-22-harness-foundation-seams.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE), as upstream. Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
