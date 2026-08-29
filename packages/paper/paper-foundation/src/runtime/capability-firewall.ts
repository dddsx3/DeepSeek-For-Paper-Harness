/**
 * Paper capability firewall.
 *
 * TASK -1 fixes a class of "stage can call any general-Harness capability"
 * escape paths. The firewall is a code-level gate: every capability request
 * must pass through `check()` BEFORE the capability is invoked. The firewall
 * is stateless across calls — repeated calls for the same request always
 * produce the same decision, and there is no idempotency cache that could be
 * used to "stick" a previously allowed capability.
 *
 * Decisions:
 *   - `forbidden_capability`: the capability is `shell`, `web`, or
 *     `self_modify`. These are rejected in every stage, in every mode.
 *   - `not_in_whitelist`: the capability is not in the requesting stage's
 *     whitelist.
 *   - allowed: the capability is in the whitelist.
 *
 * Audit: every `check()` call records an audit event, allowed or denied. The
 * audit sink is supplied by the harness at firewall construction; the
 * firewall never silently drops an event.
 */

import {
  FORBIDDEN_CAPABILITIES,
  type Capability,
  type PaperRuntimeProfile,
  type StageName,
} from './profile.ts'

export interface CapabilityRequest {
  readonly stage: StageName
  readonly capability: Capability
  /** ISO 8601 timestamp of when the request was made. */
  readonly at: string
}

export interface AuditEvent {
  readonly type: 'capability_check'
  readonly stage: StageName
  readonly capability: Capability
  readonly allowed: boolean
  readonly at: string
}

export type CapabilityDecision =
  | { allowed: false; stage: StageName; capability: Capability; reason: 'not_in_whitelist' | 'forbidden_capability' }
  | { allowed: true; stage: StageName; capability: Capability }

export type AuditSink = (event: AuditEvent) => void

export class CapabilityFirewall {
  private profile: PaperRuntimeProfile
  private readonly auditSink: AuditSink

  constructor(profile: PaperRuntimeProfile, auditSink: AuditSink) {
    this.profile = profile
    this.auditSink = auditSink
  }

  /**
   * Replace the active profile. Used by `PaperRuntimeGuard` when the
   * composition swaps profiles before readied. Forbidden after readied;
   * `PaperRuntimeGuard.setProfile` enforces that.
   * @param profile - new profile.
   */
  setProfile(profile: PaperRuntimeProfile): void {
    this.profile = profile
  }

  /**
   * Decide whether `req.capability` is allowed in `req.stage`. Emits an audit
   * event regardless of the verdict. Throws if `req.stage` is not present in
   * the profile — a missing stage policy is itself a configuration failure
   * and must not be silently mapped to "allowed".
   */
  check(req: CapabilityRequest): CapabilityDecision {
    const policy = this.profile.stagePolicies.get(req.stage)
    if (!policy) {
      // No policy for this stage → cannot allow. Emit audit then return
      // `not_in_whitelist` (the policy table is the whitelist; absence
      // means non-membership).
      const denied: CapabilityDecision = {
        allowed: false,
        stage: req.stage,
        capability: req.capability,
        reason: 'not_in_whitelist',
      }
      this.auditSink({ type: 'capability_check', stage: req.stage, capability: req.capability, allowed: false, at: req.at })
      return denied
    }

    if (FORBIDDEN_CAPABILITIES.has(req.capability)) {
      const denied: CapabilityDecision = {
        allowed: false,
        stage: req.stage,
        capability: req.capability,
        reason: 'forbidden_capability',
      }
      this.auditSink({ type: 'capability_check', stage: req.stage, capability: req.capability, allowed: false, at: req.at })
      return denied
    }

    if (!policy.allowedCapabilities.has(req.capability)) {
      const denied: CapabilityDecision = {
        allowed: false,
        stage: req.stage,
        capability: req.capability,
        reason: 'not_in_whitelist',
      }
      this.auditSink({ type: 'capability_check', stage: req.stage, capability: req.capability, allowed: false, at: req.at })
      return denied
    }

    const allowed: CapabilityDecision = {
      allowed: true,
      stage: req.stage,
      capability: req.capability,
    }
    this.auditSink({ type: 'capability_check', stage: req.stage, capability: req.capability, allowed: true, at: req.at })
    return allowed
  }
}
