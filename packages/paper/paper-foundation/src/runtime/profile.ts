/**
 * Paper runtime profile.
 *
 * TASK -1 introduces a bounded production capability lockdown. The
 * PaperRuntimeProfile describes, in code, the services that MUST be available
 * before a formal Paper workflow may start, the capabilities each stage is
 * allowed to invoke, and the critical gates that must be registered. Profiles
 * are plain data — fail-closed checks live in `preflight.ts` and
 * `capability-firewall.ts`.
 *
 * No profile allows `shell`, `web`, or `self_modify` in any stage. Those
 * capabilities are listed in the {@link Capability} union so that a caller
 * attempting to invoke them is rejected by name (see
 * `forbidden_capability` in `CapabilityDecision`).
 */

export type RuntimeMode = 'FORMAL' | 'FAST' | 'EXPLORATORY'

export type StageName = 'PLAN' | 'MODEL' | 'EXECUTE' | 'REVIEW' | 'DELIVERY'

/**
 * Closed list of capabilities a Paper stage may request. `shell`, `web`, and
 * `self_modify` are deliberately included so that the firewall can reject
 * them by name with a stable `forbidden_capability` reason — they are never
 * present in any default stage whitelist.
 */
export type Capability =
  | 'read_problem'
  | 'read_artifact'
  | 'write_model_spec'
  | 'code_runtime'
  | 'solver'
  | 'propose_finding'
  | 'read_verified_artifact'
  | 'llm_inference'
  | 'shell'
  | 'web'
  | 'self_modify'

/** Capabilities that are forbidden in every Paper stage, regardless of mode. */
export const FORBIDDEN_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'shell',
  'web',
  'self_modify',
])

export interface StagePolicy {
  readonly stage: StageName
  readonly allowedCapabilities: ReadonlySet<Capability>
}

export interface PaperRuntimeProfile {
  readonly mode: RuntimeMode
  readonly requiredServices: ReadonlyArray<ServiceRequirement>
  readonly stagePolicies: ReadonlyMap<StageName, StagePolicy>
  readonly criticalGateIds: ReadonlyArray<string>
  readonly deliveryPolicyId: string
}

export type ServiceRequirement =
  | { kind: 'persistence'; interfaceName: string }
  | { kind: 'artifact_store'; interfaceName: string }
  | { kind: 'audit'; interfaceName: string }
  | { kind: 'verifier_registry'; interfaceName: string }
  | { kind: 'delivery_policy'; interfaceName: string }
  | { kind: 'hash_provider'; interfaceName: string }

const ALL_STAGES: ReadonlyArray<StageName> = ['PLAN', 'MODEL', 'EXECUTE', 'REVIEW', 'DELIVERY']

const FORMAL_STAGE_CAPABILITIES: ReadonlyMap<StageName, ReadonlyArray<Capability>> = new Map<StageName, ReadonlyArray<Capability>>([
  ['PLAN', ['read_problem', 'llm_inference']],
  ['MODEL', ['read_artifact', 'write_model_spec', 'llm_inference']],
  ['EXECUTE', ['read_artifact', 'code_runtime', 'solver', 'llm_inference']],
  ['REVIEW', ['read_artifact', 'propose_finding', 'llm_inference']],
  ['DELIVERY', ['read_verified_artifact']],
])

const FAST_STAGE_CAPABILITIES: ReadonlyMap<StageName, ReadonlyArray<Capability>> = new Map<StageName, ReadonlyArray<Capability>>([
  ['PLAN', ['read_problem', 'llm_inference']],
  ['MODEL', ['read_artifact', 'write_model_spec', 'llm_inference']],
  ['EXECUTE', ['read_artifact', 'code_runtime', 'solver', 'propose_finding', 'llm_inference']],
  ['REVIEW', ['read_artifact', 'propose_finding', 'llm_inference']],
  ['DELIVERY', ['read_verified_artifact']],
])

const EXPLORATORY_STAGE_CAPABILITIES: ReadonlyMap<StageName, ReadonlyArray<Capability>> = new Map<StageName, ReadonlyArray<Capability>>([
  ['PLAN', ['read_problem', 'read_artifact', 'llm_inference']],
  ['MODEL', ['read_artifact', 'write_model_spec', 'llm_inference']],
  ['EXECUTE', ['read_artifact', 'code_runtime', 'solver', 'llm_inference']],
  ['REVIEW', ['read_artifact', 'propose_finding', 'llm_inference']],
  ['DELIVERY', ['read_verified_artifact']],
])

function buildStagePolicies(
  table: ReadonlyMap<StageName, ReadonlyArray<Capability>>,
): ReadonlyMap<StageName, StagePolicy> {
  const out = new Map<StageName, StagePolicy>()
  for (const stage of ALL_STAGES) {
    const caps = table.get(stage) ?? []
    out.set(stage, { stage, allowedCapabilities: new Set<Capability>(caps) })
  }
  return out
}

function requiredServicesFor(mode: RuntimeMode): ReadonlyArray<ServiceRequirement> {
  const common: ReadonlyArray<ServiceRequirement> = [
    { kind: 'persistence', interfaceName: 'paper.persistence' },
    { kind: 'artifact_store', interfaceName: 'paper.artifactStore' },
    { kind: 'audit', interfaceName: 'paper.audit' },
    { kind: 'verifier_registry', interfaceName: 'paper.verifierRegistry' },
    { kind: 'delivery_policy', interfaceName: 'paper.deliveryPolicy' },
    { kind: 'hash_provider', interfaceName: 'paper.hashProvider' },
  ]
  if (mode === 'FORMAL') return common
  if (mode === 'FAST') {
    // FAST drops the most expensive non-critical dependency (hash provider) but
    // still requires every gate that affects deliverable integrity. The single
    // difference is intentional: TASK -1's contract is "FORMAL is full, FAST
    // differs by 1-2 non-critical items".
    return common.filter(r => r.kind !== 'hash_provider')
  }
  // EXPLORATORY: per task book, no strict service validation enforced. Return
  // an empty list so preflight's required-service check is a no-op for this
  // mode. Capability enforcement still applies.
  return []
}

function criticalGateIdsFor(mode: RuntimeMode): ReadonlyArray<string> {
  if (mode === 'EXPLORATORY') return []
  return [
    'gate.ir-schema-validation',
    'gate.artifact-integrity',
    'gate.verifier-registry-coverage',
    'gate.audit-chain',
    'gate.delivery-policy',
  ]
}

function deliveryPolicyIdFor(mode: RuntimeMode): string {
  if (mode === 'EXPLORATORY') return 'delivery.exploratory'
  if (mode === 'FAST') return 'delivery.fast-strict'
  return 'delivery.formal-v1'
}

function profileFrom(
  mode: RuntimeMode,
  stageTable: ReadonlyMap<StageName, ReadonlyArray<Capability>>,
): PaperRuntimeProfile {
  return {
    mode,
    requiredServices: requiredServicesFor(mode),
    stagePolicies: buildStagePolicies(stageTable),
    criticalGateIds: criticalGateIdsFor(mode),
    deliveryPolicyId: deliveryPolicyIdFor(mode),
  }
}

/** Strict production profile: all six services, all five critical gates, narrowest whitelists. */
export function createFormalProfile(): PaperRuntimeProfile {
  return profileFrom('FORMAL', FORMAL_STAGE_CAPABILITIES)
}

/** Fast profile: drops the hash provider requirement; allows one extra capability in EXECUTE. */
export function createFastProfile(): PaperRuntimeProfile {
  return profileFrom('FAST', FAST_STAGE_CAPABILITIES)
}

/** Exploratory profile: no required-services validation; capability enforcement still applies. */
export function createExploratoryProfile(): PaperRuntimeProfile {
  return profileFrom('EXPLORATORY', EXPLORATORY_STAGE_CAPABILITIES)
}

/** Default profile used by Paper foundation when none is supplied. */
export const DEFAULT_RUNTIME_PROFILE: PaperRuntimeProfile = createFormalProfile()

export const ALL_STAGE_NAMES: ReadonlyArray<StageName> = ALL_STAGES
