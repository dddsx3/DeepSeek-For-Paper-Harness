/** Paper role settings over the harness settings namespace. */

import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import {
  installSettingsSection,
  settingsNamespace,
} from '@deepseek-ai/dsh-settings'
import type { PaperSettings, ProviderRoute } from './spec.ts'

/** Settings namespace owned by this package. */
export const PAPER_SETTINGS_NAMESPACE = settingsNamespace('paper')

/** Loader-facing schema for one provider route. */
const providerRouteConfig: s<ProviderRoute> = s.object({
  provider: s.string().required(),
  model: s.string().required(),
  credentialRef: s.string().role('credential-ref').required(),
  timeoutMs: s.number().step(1).min(1).default(120_000),
})

/** Loader-facing schema for all Paper roles. */
export const Config: s<PaperSettings> = s.object({
  executor: providerRouteConfig,
  reviewer: providerRouteConfig,
  editorAi: providerRouteConfig,
  defaultMode: s.union(['fast', 'strict'] as const).default('fast'),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    paperSettings: PaperSettingsService
  }
}

/** Role settings service with immutable per-read snapshots. */
export class PaperSettingsService extends Service {
  static Config = Config

  private source: () => PaperSettings
  private revision = 0

  /**
   * @param ctx - Context carrying the settings provider when available.
   * @param config - Composition defaults for the Paper namespace.
   */
  constructor(ctx: Context, config: PaperSettings) {
    super(ctx, 'paperSettings')
    this.source = () => config
    this.install(config)
  }

  /**
   * Detached settings snapshot for one operation, so a mid-operation change
   * cannot alter the routes a run already started with.
   * @returns a deep copy of the currently resolved settings.
   */
  snapshot(): PaperSettings {
    return structuredClone(this.source())
  }

  /** Monotonic count of settings changes observed by this service. */
  get settingsRevision(): number {
    return this.revision
  }

  /** Register the namespace consumer through the shared settings service. */
  private install(config: PaperSettings): void {
    installSettingsSection(this.ctx, PAPER_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source) => {
        this.source = source
      },
      onChange: () => {
        this.revision += 1
      },
    })
  }
}

export default PaperSettingsService
