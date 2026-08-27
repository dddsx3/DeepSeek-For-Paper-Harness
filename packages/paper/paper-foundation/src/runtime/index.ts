/**
 * Paper runtime capability lockdown (TASK -1).
 *
 * Three concerns, three modules:
 *   - `profile.ts`     — declarative runtime profile (services, stages, gates).
 *   - `preflight.ts`   — fail-closed check that the required services are
 *                        actually present and the production config is known.
 *   - `capability-firewall.ts` — code-level gate that rejects capability
 *                        requests outside the per-stage whitelist.
 *
 * Nothing in this directory mutates shared state. Profiles are plain data,
 * the firewall is stateless across calls, and preflight returns a value.
 */

export {
  ALL_STAGE_NAMES,
  DEFAULT_RUNTIME_PROFILE,
  FORBIDDEN_CAPABILITIES,
  createExploratoryProfile,
  createFastProfile,
  createFormalProfile,
} from './profile.ts'
export type {
  Capability,
  PaperRuntimeProfile,
  RuntimeMode,
  ServiceRequirement,
  StageName,
  StagePolicy,
} from './profile.ts'

export {
  isPreflightBlocked,
  runPreflight,
} from './preflight.ts'
export type {
  PreflightAuditEvent,
  PreflightResult,
  RunPreflightOptions,
} from './preflight.ts'

export { CapabilityFirewall } from './capability-firewall.ts'
export type {
  AuditEvent,
  AuditSink,
  CapabilityDecision,
  CapabilityRequest,
} from './capability-firewall.ts'
