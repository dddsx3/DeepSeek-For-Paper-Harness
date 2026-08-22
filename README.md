# DeepSeek-For-Paper-Harness

English | [中文](README.zh.md)

A paper-writing-oriented agent harness built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). Everything is a plugin, powered by [Cordis](https://github.com/cordiverse/cordis); this repository adds a durable, auditable writing-workflow layer on top of the harness and tracks upstream for everything else.

## What it does

A run takes a task and drives it through **plan → execute → review → revise → deliver**, with every fact durable before it is acted on:

- **Durable workflow engine** — versioned run/node/event/artifact records in `storage-domain`; an event log that replays fail-closed; runs survive process restarts and recover at startup.
- **Node executor with review policies** — fast mode delivers after one revise round; strict mode allows three and fails when defects persist. A node that spends its attempts pauses for review instead of failing, so a resumed run continues from it.
- **Cost and context control** — spend is derived from token counts against a configured price table and a daily ceiling (never trusted from a provider field); prompts are fitted to the model's window by trimming declared low-priority sections first.
- **Audit trail** — append-ordered, retention-pruned, credential-redacted; staging, activation, rollback, migration, and every run boundary reach it.
- **Signed skills and releases** — skill packages verify manifest, file hashes, trust root, and Ed25519 signature before loading; releases are signed manifests of content-addressed artifacts with staged rollout, health confirmation, and automatic rollback of an unproven version.
- **Legacy migration** — a dry-run, resumable importer for predecessor data; the source is never modified.

The writing layer mounts as one profile bundle over storage-capable modes: `@deepseek-ai/dsh-paper` inserts the composition, the signed skill catalog, its provider, and the invariant companion into any profile. Full subsystem reference: [docs/subsystems/paper.md](docs/subsystems/paper.md).

<a id="run"></a>

<a id="run-from-source"></a>

## Run

Requires Node.js 22+ and pnpm (via Corepack).

```sh
git clone -b paper/phase-2-foundation https://github.com/dddsx3/DeepSeek-For-Paper-Harness.git
cd DeepSeek-For-Paper-Harness
pnpm install
pnpm run build
pnpm dsh web
```

The Web UI starts at `http://127.0.0.1:3080` by default; pass `--no-open` to suppress opening a browser.

### Enabling the writing layer

Add the bundle to a profile's `dsh.profile.bundles` list:

```yaml
dsh:
  profile:
    bundles:
      - '@deepseek-ai/dsh-base'
      - '@deepseek-ai/dsh-web-app'
      - '@deepseek-ai/dsh-paper'
```

Configure role routes in your profile's `cordis.patch.yml` by row id (`paper`, `paper-skill-catalog`, …):

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

Conservative by default: no price table charges nothing, no trust root refuses every signed package and release, and unsigned packages load only in development mode. See the [patch file](packages/paper/paper-bundle/cordis.patch.yml) for every row and field.

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md). The writing layer's design decisions are recorded in [.agents/notes/implemented/architecture/2026-08-22-paper-foundation-seams.md](.agents/notes/implemented/architecture/2026-08-22-paper-foundation-seams.md).

For agents, follow [AGENTS.md](AGENTS.md). Contributions: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). Built on DeepSeek Harness; third-party dependencies are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
