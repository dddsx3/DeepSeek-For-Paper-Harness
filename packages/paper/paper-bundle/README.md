# `@deepseek-ai/dsh-paper`

English | [中文](README.zh.md)

The Paper workflow layer as a profile bundle: [`cordis.patch.yml`](cordis.patch.yml) inserts the four Paper rows over `dsh-base` and whichever mode bundle a profile uses — the [foundation composition](../paper-foundation/README.md) (role settings, provider routing, the durable run engine, the node executor, the audit trail, and releases), the signed skill catalog, the provider that serves the catalog's active versions, and the runtime invariant companion. It adds no Host, HTTP, or browser rows of its own, and the profile composer resolves the patch through the `dsh.bundle.patch` manifest field rather than through code.

The layer needs storage from the profile: `storage`, a backend such as `storage-json`, and `storage-domain`. Every Paper row pends on its injections, so a profile that stacks this layer over a storage-less mode mounts the rows and never activates them — silence that is hard to read from the outside. `missingPaperServices` names which requirement is absent and the plugin warns once at load; it still mounts, because the services may arrive from a later patch row and Cordis activates the rows when they do.

Deployment-varying values stay conservative on purpose: no price table (an unpriced route charges nothing), no trust root (every signed skill package and release manifest is refused), and `allowUnsigned: false` on both the catalog and the release policy. A profile that wants staged updates, real prices, or its own signing key addresses the row by id in its own `cordis.patch.yml`; a patch replaces a row's whole `config`, so an override restates every field it means to keep. The three model routes name a credential *reference* (`DEEPSEEK_API_KEY`), never a credential value — the existing credentials seam resolves it at the provider boundary.

## Model Experience

Indirectly, through the inserted rows: the bundle is a patch-list carrier, and each Paper row's package owns its model-facing behavior.

#### KV Cache effect

None directly; each inserted row's package owns its effect.

## Known Limitations and Deferred Work

- **A patch replaces whole row configs** — a profile override must restate every field the row keeps; there is no deep-merge layer.
- **Self-update is off until a deployment names a signing key** — the shipped `releasePolicy` trusts no key, so every release manifest is refused. That is the intended default; `allowUnsigned` is a development affordance and is refused outright in production builds.
- **The layer carries no storage of its own** — over a storage-less profile it warns and leaves the rows inactive rather than mounting a fallback backend, so run state can never land somewhere the profile did not choose.
