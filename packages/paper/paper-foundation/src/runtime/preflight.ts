/**
 * Paper preflight.
 *
 * TASK -1 closes a class of "started but not really safe" escape paths: if any
 * of the services the profile declares required are missing, or the current
 * production configuration is unknown to the harness, startup MUST fail.
 *
 * No silent fallback. No warning-and-continue. Preflight returns a single
 * structured result that the harness startup path is expected to refuse to
 * boot from when `ok: false`. Each missing requirement is also forwarded to
 * the audit sink so the failure leaves a trail.
 */

import type { PaperRuntimeProfile, ServiceRequirement } from './profile.ts'

export type PreflightResult =
  | { ok: true; profile: PaperRuntimeProfile }
  | { ok: false; missing: ReadonlyArray<ServiceRequirement>; unknownConfig: string[] }

/** Audit event type emitted by preflight when a missing requirement is detected. */
export type PreflightAuditEvent = {
  readonly type: 'preflight_missing'
  readonly missing: ReadonlyArray<ServiceRequirement>
  readonly unknownConfig: ReadonlyArray<string>
  readonly at: string
}

export interface RunPreflightOptions {
  /** Current production configuration name (e.g. "prod-eu-west-1"). */
  readonly productionConfig: string
  /** Services currently registered in the harness, keyed by `interfaceName`. */
  readonly availableServices: ReadonlyMap<string, unknown>
  /** Set of production configuration names the harness knows about. */
  readonly knownProductionConfigs: ReadonlySet<string>
  /**
   * Optional audit sink. If supplied AND the audit service is itself available
   * (caller should pass it through `availableServices` to gate this), the sink
   * receives one event per missing requirement. If the audit service is
   * missing but the sink is still supplied, preflight still emits to the sink
   * (some harnesses inject a stdout sink for first-boot). Fail-closed
   * behaviour is independent of sink delivery.
   */
  readonly auditSink?: (event: PreflightAuditEvent) => void
}

const ISO_TIME = (): string => new Date().toISOString()

/**
 * Check that every service in `profile.requiredServices` is present in
 * `availableServices`, and that `productionConfig` is a member of
 * `knownProductionConfigs`. Returns a structured {@link PreflightResult}.
 *
 * The function does not throw. It also does not warn-and-continue: any
 * missing requirement produces `ok: false`.
 */
export function runPreflight(
  profile: PaperRuntimeProfile,
  options: RunPreflightOptions,
): PreflightResult {
  const missing: ServiceRequirement[] = []
  for (const req of profile.requiredServices) {
    if (!options.availableServices.has(req.interfaceName)) {
      missing.push(req)
    }
  }

  const unknownConfig: string[] = []
  if (!options.knownProductionConfigs.has(options.productionConfig)) {
    unknownConfig.push(options.productionConfig)
  }

  if (missing.length === 0 && unknownConfig.length === 0) {
    return { ok: true, profile }
  }

  if (options.auditSink) {
    options.auditSink({
      type: 'preflight_missing',
      missing,
      unknownConfig,
      at: ISO_TIME(),
    })
  } else {
    // No sink available: log to stderr so an operator can still see the
    // reason, but do NOT downgrade the verdict. Startup must still fail.
    process.stderr.write(
      `[paper-preflight] missing=${JSON.stringify(missing)} unknownConfig=${JSON.stringify(unknownConfig)} at=${ISO_TIME()}\n`,
    )
  }

  return { ok: false, missing, unknownConfig }
}

/** Convenience predicate: does the result block startup? */
export function isPreflightBlocked(
  result: PreflightResult,
): result is { ok: false; missing: ReadonlyArray<ServiceRequirement>; unknownConfig: string[] } {
  return result.ok === false
}
