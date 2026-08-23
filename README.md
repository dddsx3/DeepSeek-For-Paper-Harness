# DeepSeek-For-Paper-Harness (dph)

English | [中文](README.zh.md)

**DeepSeek-For-Paper-Harness** is an independent agent harness product for paper-writing workflows. It adopts the open-source [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) as its technical foundation — reusing the Cordis plugin system and the session/tool-execution stack — and builds a durable, auditable writing-workflow layer on top. The product is independent of its foundation: the CLI entry (`dph`), branding, user-data directory (`DPH_HOME`, default `~/.dph`), and default branch are entirely its own, and upstream is synced selectively through the `upstream` remote only.

## What it does

A run takes a task and drives it through **plan → execute → review → revise → deliver**, with every fact durable before it is acted on:

- **Durable workflow engine** — versioned run/node/event/artifact records in `storage-domain`; an event log that replays fail-closed; runs survive process restarts and recover at startup.
- **Node executor with review policies** — fast mode delivers after one revise round; strict mode allows three and fails when defects persist. A node that spends its attempts pauses for review instead of failing, so a resumed run continues from it.
- **Cost and context control** — spend is derived from token counts against a configured price table and a daily ceiling (never trusted from a provider field); prompts are fitted to the model's window by trimming declared low-priority sections first.
- **Audit trail** — append-ordered, retention-pruned, credential-redacted; staging, activation, rollback, migration, and every run boundary reach it.
- **Signed skills and releases** — skill packages verify manifest, file hashes, trust root, and Ed25519 signature before loading; releases are signed manifests of content-addressed artifacts with staged rollout, health confirmation, and automatic rollback of an unproven version.
- **Legacy migration** — a dry-run, resumable importer for predecessor data; the source is never modified.

The writing layer mounts as one profile bundle over storage-capable modes: `@deepseek-ai/dsh-paper` inserts the composition, the signed skill catalog, its provider, and the invariant companion into any profile. Full subsystem reference: [docs/subsystems/paper.md](docs/subsystems/paper.md).

## Relationship to the open-source foundation

- `vendor/` carries the pinned Cordis source; most `@deepseek-ai/dsh-*` packages under `packages/` are foundation capabilities (all `private: true`, never published to npm).
- `packages/paper/*` is this product's increment: workflow state machine, review-loop executor, cost budgets, audit, signed skills and releases, legacy migration.
- Upstream updates land only through a reviewed, selective merge from the `upstream` remote; this repository's `main` branch never points at an official snapshot.
- Coexistence with an official dsh install is conflict-free: the CLI command is `dph`, user data lives under `DPH_HOME` (default `~/.dph`), and `~/.dsh` is never read or written.

<a id="run"></a>

## Run

Requires Node.js ^22.19 or ≥24 (Corepack included) and Git.

### Windows quick start

1. Install [Node.js LTS](https://nodejs.org/) (the installer enables Corepack);
2. Clone this repository:

   ```bat
   git clone -b main https://github.com/dddsx3/DeepSeek-For-Paper-Harness.git
   cd DeepSeek-For-Paper-Harness
   ```

3. Double-click `setup.bat` (equivalent to `corepack enable && pnpm install && pnpm run build`), or run those commands yourself;
4. Copy `.env.example` to `.env` and fill in `DEEPSEEK_API_KEY`;
5. Double-click `start.bat` (equivalent to `pnpm dph web`) and open `http://127.0.0.1:3080`. Pass `--no-open` to suppress opening a browser.

### macOS / Linux

```sh
git clone -b main https://github.com/dddsx3/DeepSeek-For-Paper-Harness.git
cd DeepSeek-For-Paper-Harness
corepack enable
pnpm install
pnpm run build
pnpm dph web
```

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

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md). The writing layer's design decisions are recorded in [.agents/notes/implemented/architecture/2026-08-22-paper-foundation-seams.md](.agents/notes/implemented/architecture/2026-08-22-paper-foundation-seams.md); the product identity and namespace decisions are recorded in [.agents/notes/implemented/process/2026-08-22-independent-product-identity.md](.agents/notes/implemented/process/2026-08-22-independent-product-identity.md).

For agents, follow [AGENTS.md](AGENTS.md). Contributions: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). Built on the open-source DeepSeek Harness with thanks to its authors; third-party dependencies are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
