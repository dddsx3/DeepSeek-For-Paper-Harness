# Vendored Digital-Asset Library (v2)

This branch (`digital-assets`) is an **independent Git branch** carrying a
library of vendored digital assets. It is **not** the runtime code: the
runtime lives on `main` (paper-foundation, agent-loop, llm adapters,
etc.). This branch only stores vendored templates, skills, prompt assets,
preview images, tool scripts, and asset documentation.

> **v2 scope**: this tree is the second decoupling round (v1 carried a
> wider snapshot; see the Exclusion log below). v2 removes residual
> runtime-state files, relocates pure asset families out of
> build-artifact directory names, rewrites the deployment contract, and
> begins closing the missing-tool inventory.

## Why a separate branch?

1. **Risk isolation** — assets are vendored data (some under third-party
   licences). A push to `main` could contaminate the runtime checkout or
   be read as a redistribution under the paper-foundation licence.
2. **Audit and rotation** — the asset tree changes infrequently. A
   separate branch makes diffs and licence updates obvious, and lets the
   maintainers delete or rotate the branch without affecting runtime
   history.

## Directory layout (v2)

| Directory | Contents | Files |
|---|---|---|
| `skills/` | Skill packages (each with its own `SKILL.md`); `skills/shared-scripts/` is the shared script library skills materialize into workspaces | 317 |
| `tools/` | Tool scripts the skills invoke via the `_utils/` → `$MH_TOOLS_DIR/` → `tools/` probe chain; `tools/docx-cn-engine/` (docx 编译引擎) and `tools/docx_style_profiles/` live here | 24 |
| `dist/` | Front-end build outputs retained as assets (JS bundles, minified vendor libs) | 35 |
| `templates/` | Paper-template skeletons (LaTeX/Word) | 9 |
| `prompts/` | Prompt assets (relocated in v2 out of the legacy backend path) | 8 |
| `assets/palette-previews/` `assets/style-previews/` | Preview image galleries (relocated in v2 out of `dist/`) | 35 |
| `katex-assets/` | KaTeX (MIT) — math typesetting | 3 |

## Deployment contract (how skills expect the tree)

The skill texts reference a **workspace-materialized shared directory**
`_utils/`. That is not a stale path — it is the contract between the
skills and the consuming runtime: the runtime materializes
`skills/shared-scripts/` into `_utils/` inside each paper workspace
before invoking a skill. Skills also probe `$MH_TOOLS_DIR/` then `tools/`
for the tool scripts. Concretely, at the root that contains `skills/`:

```sh
# full materialization (the legacy runtime's behavior):
mkdir -p _utils && cp -r skills/shared-scripts/. _utils/

# minimal set (figure skills only):
cp skills/shared-scripts/plot_utils.py _utils/
```

Optional environment interfaces the skills read (interface names, kept
for compatibility — not product branding):

| Variable | Meaning |
|---|---|
| `MH_PYTHON` | Python interpreter override (71 references) |
| `MH_FAST_MODE` | skip optional quality steps (23) |
| `MH_AI_DISCLOSURE` | AI-usage disclosure switch for paper compliance (11) |
| `MH_TOOLS_DIR` | tool-script directory override (10) |
| `MH_SCREENSHOT_TOOL` | screenshot backend for `screenshot_capture` |
| `MH_FLOW_PER_PROBLEM` | one flow per problem (7) |
| `HUMANITIES_REVIEW_SCRIPT` | override for `humanities_review.py` |
| `MH_DATA_FIG_*`, `MH_SKIP_*` | data-figure / step-skip toggles |

## Missing-tool inventory (v2 state — read before use)

Skills reference tool scripts via the probe chain. When a tool is
absent the skill degrades gracefully (skips the check with a notice),
but that capability is then silently unavailable. Status after this
round:

| Tool | Referenced by | Status in this tree |
|---|---|---|
| `gpt_image.py` | paper-figure, editor-agent | **closed** — source vendored at `tools/gpt_image.py` |
| `tikz_vision_check.py` | paper-figure-drawio, paper-figure-html | **closed** — source vendored at `tools/tikz_vision_check.py` |
| `screenshot_capture.py` | copyright-draft, dev-selfcheck, paper-figure-html, patent-build | **open (no source)** — only compiled `.pyc` bytecode exists in the legacy project; source must be supplied by the maintainer |
| `data_fig_vision_check.py` | nature-figure, paper-figure | **open (no source)** — bytecode only |
| `drawio_vision_check.py` | paper-figure-drawio, paper-figure-html | **open (no source)** — bytecode only |
| `docx_template_analyze.py` | docx-template-map | **open (no source)** — bytecode only |
| `docx_template_fill.py` | docx-template-map | **open (no source)** — bytecode only |
| `humanities_review.py` | humanities-write, humanities-write-latex | **open (no source)** — bytecode only |

> Six tools exist in the legacy project only as compiled `.pyc`
> bytecode. This branch deliberately does **not** vendor bytecode: it is
> unauditable and runs counter to the branch's "pure assets" charter.
> When the maintainer supplies the Python sources they land in
> `tools/` and this table flips to closed.

## Exclusion log

### v1 (first cut, before the first commit)

| Removed | Reason |
|---|---|
| Skill directories named after the originating product | deprecated product; misleading provenance |
| All 32 font binaries (~161 MB) | third-party font licences (Microsoft EULA / Ubuntu / OFL) — consumers install fonts themselves |
| `_config/db_dump/workflow_logs.json` (41 MB) | production log snapshot, likely PII |
| `backend/license.json` | commercial licence record with a machine fingerprint |
| `backend/routers/providers_ui.html`, `dist/index.html` | product-name `<title>` tags |
| All `sk-…` API keys in db dumps | replaced with `<REDACTED-OPENAI-KEY>` placeholders |
| A user-specific Windows path in a db dump | replaced with `<REDACTED-LOCAL-PATH>` |

### v2 (this round)

| Removed | Reason |
|---|---|
| `_config/` wholesale (8 files: db_dump snapshots, `db/schema.sql`, `requirements.txt`) | runtime-state residue; snapshots embed real usage records (competition problem titles, run ledgers) — not assets |
| `backend/db/aris.db` (0-byte), `backend/db/schema.sql`, `backend/requirements.txt` | legacy runtime skeleton |
| `dist/logo.svg`, `dist/icons.svg`, `dist/favicon.svg` | originating product brand artifacts |
| `tools/_profile_test/` (3 files) | docx-engine development test outputs |
| `.github/secret_scanning.yml` | existed only to exempt the now-removed db-dump placeholders |

| Relocated | Reason |
|---|---|
| `backend/services/prompts/*.md` → `prompts/` (8) | prompts are assets; decoupled from the legacy backend path semantics (the `backend/` directory is now gone) |
| `dist/palette_preview/*` → `assets/palette-previews/` (29) | image assets out of a build-output directory name |
| `dist/style_preview/*` → `assets/style-previews/` (6) | same |

### Text-layer fixes (v2)

- `skills/paper-figure/SKILL.md` — the GPT-image key-injection sentence
  asserted a settings-page/backend writer that this branch deleted;
  rewritten to state the honest contract ("provided by the consuming
  runtime; if absent the GPT-image path is unavailable, fall back to
  DrawIO").
- `tools/gpt_image.py` (newly vendored) — same dead-assertion pattern in
  a fallback comment; rewritten in the same terms.

## Third-party licences

See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for the
per-family provenance and licence obligations (KaTeX MIT, minified
vendor libs, humanities-thesis-skill MIT, competition templates).
Open items that still need maintainer review before public distribution
(competition-template provenance, trademark surfaces in `huawei/` etc.)
are marked there as such.

## Restoration

This branch is **not self-contained** at the file level: six tool
sources are pending (see the missing-tool inventory), and skills expect
the consuming runtime to materialize `_utils/` (see the deployment
contract). Given those two prerequisites:

```bash
git clone --branch digital-assets <repo-url> /path/to/digital-assets
cp -r /path/to/digital-assets/skills/*        <install>/skills/
cp -r /path/to/digital-assets/templates/*     <install>/templates/
cp -r /path/to/digital-assets/katex-assets/* <install>/katex-assets/
cp -r /path/to/digital-assets/prompts/*       <install>/prompts/
cp -r /path/to/digital-assets/assets/*        <install>/assets/
```

Credentials in the (removed) configuration snapshots were placeholder
strings; consumers inject their own credentials via the application's
credentials page at first run.

## Contact

Issues with this branch: file a normal GitHub issue on this repository
and reference `digital-assets` in the title.

---

*Maintained as a vendored mirror. The maintainers grant no additional
licence for the assets in this branch beyond each asset's upstream
licence.*
