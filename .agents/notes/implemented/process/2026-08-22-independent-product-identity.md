# Agent Note: Independent product identity (dph CLI, DPH_HOME isolation, deferred rescope)

Status: implemented

English | [中文](2026-08-22-independent-product-identity.zh.md)

## Problem

This repository started as a fork-shaped overlay on the official dsh: the default branch pointed at an official release snapshot, the CLI entry was named `dsh`, user data lived in `~/.dsh`, and shipped surfaces (web manifest, page title, system-prompt opener, onboarding copy) presented "DeepSeek Harness" as the product name. The product is not an official-channel distribution — it is an independent paper-writing harness that adopts dsh as a vendored foundation — so every one of those defaults created a wrong first impression and a concrete conflict surface for anyone running both products on one machine: shared `~/.dsh` state, colliding CLI names, and a default branch that was somebody else's release.

## Decision

The product identity is now self-owned end to end:

- **Branch sovereignty.** `main` is the default branch and carries the product line; official history is reachable only through the `upstream` remote and never lands on `main` without review.
- **CLI command.** The launcher command is `dph` (root script `pnpm dph`, commander program name, help text, and user-facing docs). Internal npm package names keep the `@deepseek-ai/dsh-*` scope for now — they are `private: true` and never published, so there is no registry collision.
- **Data isolation.** `@deepseek-ai/dsh-home-paths` resolves the single-root harness home from `$DPH_HOME` with fallback `~/.dph`; `DSH_HOME` and `~/.dsh` are no longer read. Settings, credentials, attachments, profiles, presets, anonymous id, and the shell-exposed home variable all flow through that one seam, so an official dsh install and this product never share state.
- **Shipped brand.** The web manifest, document titles, sidebar/hero brand slots (text wordmark "dph"), PWA name, system-prompt opener, checkout-source section, agent preset persona, and onboarding notice present DeepSeek-For-Paper-Harness; upstream receives attribution in READMEs and LICENSE (dual copyright line preserved).
- **Rescope deferral (the durable reminder).** Renaming every internal package out of the `@deepseek-ai/dsh-*` scope — plus the remaining internal JSDoc narratives, example bins (`dsh-acp-demo`, `dsh-jsonrpc-agent`), the `dsh-badge` skill, and the `dsh-v*` tag lineage — is deliberately deferred until the first public release. Until then this note is the standing order: any change that ships the product publicly must execute the full rescope in the same effort, because [the pre-release stance](../../../AGENTS.md#pre-release-stance-foundation-over-blast-radius) expires at that tag. The rename mechanics follow the [repository naming contract](2026-08-11-repository-naming-contract-and-rename-ledger.md); the vendor-rescope precedent is [vendor package rescope](2026-08-10-vendor-package-rescope.md).

## Alternatives considered

- **Rename all packages now.** Rejected for this round: with zero published consumers the renames are safe but would inflate the diff against `upstream` before the product has shipped once, raising the cost of every selective sync until release. Deferred with a written trigger instead of trusted to memory.
- **Keep the `dsh` command as an alias.** Rejected: an alias re-collides with an official install on PATH and blurs which binary owns which data dir; one command, one home.
- **Read legacy `DSH_HOME`/`~/.dsh` as a fallback.** Rejected: sharing state with an official install is precisely the conflict this decision removes.

## Consequences

- Users of the earlier overlay lose their old `~/.dsh`-stored settings on upgrade to this identity cut; acceptable pre-release, and the migration importer covers predecessor-product data separately.
- Every doc, snapshot, and fixture that stated the old defaults was updated in the same change (home literals, identity sentence, checkout section, help text); the pairing records for touched bilingual documents were re-recorded.
- The deferred rescope is tracked by this note, not by issue trivia: search for `independent-product-identity` when preparing the first release.
