/** Harness role settings over the harness settings namespace. */

import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import {
  installSettingsSection,
  settingsNamespace,
} from '@deepseek-ai/dsh-settings'
import type { HarnessSettings, ProviderRoute } from './spec.ts'

/** Settings namespace owned by this package. */
export const MODEX_SETTINGS_NAMESPACE = settingsNamespace('harness')

/** Loader-facing schema for one provider route. */
const providerRouteConfig: s<ProviderRoute> = s.object({
  provider: s.string().required(),
  model: s.string().required(),
  credentialRef: s.string().role('credential-ref').required(),
  timeoutMs: s.number().step(1).min(1).default(120_000),
})

/** Loader-facing schema for all Harness roles. */
export const Config: s<HarnessSettings> = s.object({
  executor: providerRouteConfig,
  reviewer: providerRouteConfig,
  editorAi: providerRouteConfig,
  defaultMode: s.union(['fast', 'strict'] as const).default('fast'),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    harnessSettings: HarnessSettingsService
  }
}

/** Role settings service with immutable per-read snapshots. */
export class HarnessSettingsService extends Service {
  static Config = Config

  private source: () => HarnessSettings
  private revision = 0

  /**
   * @param ctx - Context carrying the settings provider when available.
   * @param config - Composition defaults for the Harness namespace.
   */
  constructor(ctx: Context, config: HarnessSettings) {
    super(ctx, 'harnessSettings')
    this.source = () => config
    this.install(config)
  }

  /** Current detached settings snapshot for one operation. */
  snapshot(): HarnessSettings {
    return structuredClone(this.source())
  }

  /** Monotonic count of settings changes observed by this service. */
  get settingsRevision(): number {
    return this.revision
  }

  /** Register the namespace consumer through the shared settings service. */
  private install(config: HarnessSettings): void {
    installSettingsSection(this.ctx, MODEX_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source) => {
        this.source = source
      },
      onChange: () => {
        this.revision += 1
      },
    })
  }
}

export default HarnessSettingsService
