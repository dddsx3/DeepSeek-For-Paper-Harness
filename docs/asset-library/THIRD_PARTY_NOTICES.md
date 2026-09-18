# Third-Party Notices — Vendored Digital-Asset Library (v2)

This branch (`digital-assets`) carries vendored digital assets used by a
paper-production toolchain. Several asset families are owned by third
parties and are subject to their own licences. This file is the central
index of those obligations; the asset files themselves are not modified
and their provenance is preserved exactly as the upstream sources ship
them.

> **Legal status**: a vendored mirror, stored on an independent Git
> branch (not on `main`) so the runtime, which ships without these
> assets, remains unaffected. Distribution is at the discretion of the
> maintainers and is governed by the licences noted below.

---

## 1. KaTeX

| Path | Source | Licence |
|---|---|---|
| `katex-assets/katex.embedded.css`, `katex-assets/katex.min.js` | https://khan.github.io/KaTeX/ | **MIT License** |

Obligation: the copyright and permission notice must accompany
substantial copies. Full text: https://github.com/KaTeX/KaTeX/blob/main/LICENSE

## 2. Minified vendor libraries (in `dist/`)

`dist/` carries front-end build output that bundles third-party
libraries (e.g. `mermaid.min.js`) in minified form. The minified files
are redistribution-tolerant under their upstream licences (MIT for the
ones present), but the upstream licence headers are inside the minified
payloads — do not strip them when re-bundling. `dist/` is retained for
restoration fidelity, not as the preferred consumption path.

## 3. `humanities-thesis-skill` (upstream skill, MIT)

| Path | Source | Licence |
|---|---|---|
| `skills/shared-scripts/NOTICE-humanities.md` and the `humanities-*` reference material adapted into the paper skills | https://github.com/ganzhi-black/humanities-thesis-skill | **MIT License** |

Obligation: the MIT copyright and licence notice must accompany
substantial copies; the upstream NOTICE file is preserved in-tree and
the full MIT text is available in the upstream repository.

## 4. Competition paper templates (`skills/comp-paper-zh/templates/`)

The template family (`mcmthesis.cls` and friends, plus per-competition
flavours `cumcm/`, `huazhong/`, `wuyi/`, `huawei/`, `changsanjiao/`,
`diangongbei/`, `shuweibei/`, `stats/`) derives from publicly circulated
Chinese competition LaTeX classes (`mcmthesis` upstream is LPPL), some
further localised by the legacy project. Two obligations before any
public distribution of this tree:

- **Per-template provenance**: each `.cls`/`.tex` has an upstream;
  the maintainer should record per-file source/licence before wide
  distribution. *(open item)*
- **Trademark surfaces**: competition-brand template directories (most
  prominently `huawei/`) may embed logos or branded title pages. Those
  marks belong to their owners; a public branch must not present them
  as generic assets. *(open item — screen before distribution)*

## 5. Fonts — intentionally NOT shipped

This branch ships no font files. v1 removed all 32 font binaries
(Microsoft system fonts under the Microsoft EULA; Ubuntu Mono under the
Ubuntu Font Licence 1.0; Fira Code Nerd under SIL OFL; NotoSansSC).
Consumers install the fonts they need from the original vendors. The
template `fonts/` directories are preserved as empty mount points where
the engines expect them.

## 6. Removed in v2 — no licence exposure

`_config/` (runtime-state snapshots), `backend/` (legacy runtime
skeleton, including its 0-byte db and requirements), the three brand
SVGs, and `tools/_profile_test/` (dev test outputs) were removed in v2.
None of them carried third-party licences; the removal is recorded in
the README exclusion log.

## 7. How to verify a vendored file before use

Before redistributing any single asset, confirm the corresponding
upstream licence permits the intended distribution channel. The
maintainers ship assets "as-is" and do not relicense them; this file is
documentation of provenance, not a licence grant.

---

*Last verified: 2026-09-05 (v2). This branch is independent of `main`;
assets here are not consumed by the paper-foundation runtime (which
ships without fonts, templates, or vendor scripts).*
