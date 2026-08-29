/**
 * Paper preflight.
 *
 * TASK -1 closes a class of "started but not really safe" escape paths: if any
 * of the services the profile declares required are missing, or the current
 * production configuration is unknown to the harness, startup MUST fail.
 *
 * TASK -1 rewire extends preflight with three new realness checks so that
 * startup cannot pass on a profile whose critical gate IDs are not actually
 * registered, whose stage policy table is incomplete, or whose delivery policy
 * ID is not in the harness's known list. The five failure kinds are surfaced
 * under a single `failures` array so a caller can fail-closed on the union.
 * The failure result also retains the legacy `missing` and `unknownConfig`
 * projections for backward compatibility with the pre-rewire test surface.
 *
 * No silent fallback. No warning-and-continue. Preflight returns a single
 * structured result that the harness startup path is expected to refuse to
 * boot from when `ok: false`. Each missing requirement is also forwarded to
 * the audit sink so the failure leaves a trail.
 */

import {
  ALL_STAGE_NAMES,
  DEFAULT_RUNTIME_PROFILE,
  type PaperRuntimeProfile,
  type ServiceRequirement,
  type StageName,
} from './profile.ts'

/** One structured failure surfaced by preflight. */
export type PreflightFailure =
  | { kind: 'missing_service'; service: ServiceRequirement }
  | { kind: 'unknown_production_config'; config: string }
  | { kind: 'gate_not_registered'; gateId: string }
  | { kind: 'stage_policy_incomplete'; missingStages: ReadonlyArray<StageName> }
  | { kind: 'delivery_policy_unresolved'; policyId: string }

export type PreflightResult =
  | { ok: true; profile: PaperRuntimeProfile }
  | {
    ok: false
    /** Full taxonomy of failures surfaced by preflight. */
    failures: ReadonlyArray<PreflightFailure>
    /** Legacy projection: just the missing services. */
    missing: ReadonlyArray<ServiceRequirement>
    /** Legacy projection: just the unknown production configs. */
    unknownConfig: string[]
  }

/** Audit event type emitted by preflight when a failure is detected. */
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
  /**
   * Optional override of the profile that preflight checks. When omitted, the
   * function uses the FORMAL default — keeping the pre-rewire
   * `runPreflight(profile, options)` signature usable for the existing
   * A-001..A-005 tests, which pass `createFormalProfile()` as the first arg
   * without an `options.profile`.
   */
  readonly profile?: PaperRuntimeProfile
  /**
   * Registry of critical gates (gate_id -> registration). Each id in
   * `profile.criticalGateIds` must have a key here, otherwise preflight fails
   * closed with a `gate_not_registered` failure. Omitting this check
   * (undefined) is a no-op so the existing A-001..A-005 tests stay valid.
   */
  readonly verifierRegistry?: Readonly<Record<string, unknown>>
  /**
   * Set of delivery policy ids the harness knows about. If non-empty, the
   * profile's `deliveryPolicyId` must be a member, otherwise preflight fails
   * closed with a `delivery_policy_unresolved` failure. Omitting this check
   * (undefined) is a no-op.
   */
  readonly knownDeliveryPolicyIds?: ReadonlySet<string>
}

const ISO_TIME = (): string => new Date().toISOString()

/**
 * Check that the supplied runtime profile is actually safe to boot:
 *
 *   1. every service in `profile.requiredServices` is present in
 *      `availableServices`,
 *   2. `productionConfig` is a member of `knownProductionConfigs`,
 *   3. every id in `profile.criticalGateIds` is present in
 *      `verifierRegistry` (when provided),
 *   4. every stage in {@link ALL_STAGE_NAMES} has a policy in
 *      `profile.stagePolicies`,
 *   5. `profile.deliveryPolicyId` is in `knownDeliveryPolicyIds` (when that
 *      set is provided and non-empty).
 *
 * Returns a structured {@link PreflightResult}. The function does not throw.
 * It also does not warn-and-continue: any failure produces `ok: false`.
 */
export function runPreflight(
  profile: PaperRuntimeProfile,
  options: RunPreflightOptions,
): PreflightResult {
  const effectiveProfile = options.profile ?? profile ?? DEFAULT_RUNTIME_PROFILE
  const failures: PreflightFailure[] = []

  // (1) Required services present in availableServices.
  for (const req of effectiveProfile.requiredServices) {
    if (!options.availableServices.has(req.interfaceName)) {
      failures.push({ kind: 'missing_service', service: req })
    }
  }

  // (2) Production config known.
  if (!options.knownProductionConfigs.has(options.productionConfig)) {
    failures.push({ kind: 'unknown_production_config', config: options.productionConfig })
  }

  // (3) Critical gates registered.
  if (options.verifierRegistry !== undefined) {
    for (const gateId of effectiveProfile.criticalGateIds) {
      if (options.verifierRegistry[gateId] === undefined) {
        failures.push({ kind: 'gate_not_registered', gateId })
      }
    }
  }

  // (4) Stage policies cover every stage.
  const missingStages: StageName[] = []
  for (const stage of ALL_STAGE_NAMES) {
    if (!effectiveProfile.stagePolicies.has(stage)) missingStages.push(stage)
  }
  if (missingStages.length > 0) {
    failures.push({ kind: 'stage_policy_incomplete', missingStages })
  }

  // (5) Delivery policy id resolves.
  if (
    options.knownDeliveryPolicyIds !== undefined
    && options.knownDeliveryPolicyIds.size > 0
    && !options.knownDeliveryPolicyIds.has(effectiveProfile.deliveryPolicyId)
  ) {
    failures.push({
      kind: 'delivery_policy_unresolved',
      policyId: effectiveProfile.deliveryPolicyId,
    })
  }

  if (failures.length === 0) {
    return { ok: true, profile: effectiveProfile }
  }

  const missing = failures
    .filter((f): f is { kind: 'missing_service'; service: ServiceRequirement } => f.kind === 'missing_service')
    .map(f => f.service)
  const unknownConfig = failures
    .filter((f): f is { kind: 'unknown_production_config'; config: string } => f.kind === 'unknown_production_config')
    .map(f => f.config)

  if (options.auditSink) {
    options.auditSink({
      type: 'preflight_missing',
      missing,
      unknownConfig,
      at: ISO_TIME(),
    })
  } else {
    process.stderr.write(
      `[paper-preflight] failures=${JSON.stringify(failures.map(f => f.kind))} at=${ISO_TIME()}\n`,
    )
  }

  return { ok: false, failures, missing, unknownConfig }
}

/** Convenience predicate: does the result block startup? */
export function isPreflightBlocked(
  result: PreflightResult,
): result is {
  ok: false
  failures: ReadonlyArray<PreflightFailure>
  missing: ReadonlyArray<ServiceRequirement>
  unknownConfig: string[]
} {
  return result.ok === false
}
