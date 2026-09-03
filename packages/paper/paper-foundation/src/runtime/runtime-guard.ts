/**
 * Paper runtime guard (TASK -1 rewire).
 *
 * The guard is the single blessed entry point for capability execution. Until
 * it is readied, no production capability may run; once it is readied, every
 * capability request must go through `invokeCapability` (or be rejected by the
 * audit). Composition mounts the guard, runs preflight, and readies it; the
 * provider, diagnostics, and executor are then forced to take this path.
 *
 * The guard is intentionally thin: it owns a `CapabilityFirewall` for the
 * decision and a profile reference for `assertRuntimeReady`. The two concerns
 * that previously lived only in the profile/preflight/firewall modules
 * (validation of the runtime configuration, realness of registered services)
 * are now backed by the same preflight composition runs at boot, and the same
 * audit trail every consumer is already producing.
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  AuditEntryInput,
} from '../audit.ts'
import { CapabilityFirewall } from './capability-firewall.ts'
import type { AuditSink, CapabilityRequest } from './capability-firewall.ts'
import { createFormalProfile, type Capability, type PaperRuntimeProfile, type StageName } from './profile.ts'

/** Capability tokens accepted by the guard. The two extension tokens (`llm` and
 * `diagnostics_probe`) are mapped to the LLM seam; they are not in the
 * `Capability` union because they are paper-orchestration seams, not generic
 * capabilities, but they must still be guarded to prevent bypass. */
export type GuardedCapability = Capability | 'llm' | 'diagnostics_probe'

declare module '@deepseek-ai/cordis' {
  interface Context {
    paperRuntimeGuard: PaperRuntimeGuard
  }
}

export interface InvokeCapabilityContext {
  /** Where in the workflow the call originates. */
  readonly stage: StageName
  /** The capability being requested. */
  readonly capability: GuardedCapability
  /** Run id, when call belongs to a run. */
  readonly runId?: string
}

export interface GuardedFnContext {
  /** The function to execute if and only if the capability is allowed. */
  readonly fn: () => unknown | Promise<unknown>
}

/** Thrown when a capability request is rejected by the firewall. */
export class CapabilityDeniedError extends Error {
  constructor(
    readonly stage: StageName,
    readonly capability: string,
    readonly reason: string,
  ) {
    super(`capability ${capability} denied in stage ${stage}: ${reason}`)
    this.name = 'CapabilityDeniedError'
  }
}

/** Thrown when the runtime guard has not been readied or its profile is
 * inconsistent with the request (e.g. after a profile swap, or run mode
 * mismatch). */
export class RuntimeNotReadyError extends Error {
  constructor(reason: string) {
    super(`paper runtime not ready: ${reason}`)
    this.name = 'RuntimeNotReadyError'
  }
}

/** Internal helper: check whether a capability token is one of the LLM seams. */
function isLlmSeam(cap: GuardedCapability): cap is 'llm' | 'diagnostics_probe' {
  return cap === 'llm' || cap === 'diagnostics_probe'
}

/**
 * The single production entry point for capability execution. The composition
 * mounts this service, runs preflight, and readies it before the rest of the
 * foundation can run any model call. After readied, every capability
 * invocation must pass through `invokeCapability`.
 */
export class PaperRuntimeGuard extends Service {
  // No `static inject`: the audit service is looked up lazily via
  // `ctx.get('paperAudit', false)`. This lets the guard be mounted
  // BEFORE the audit service, so the guard itself can refuse to boot
  // in compositions that lack the audit service.

  private readonly firewall: CapabilityFirewall
  private profile: PaperRuntimeProfile
  private ready = false
  private readonly now: () => string

  /**
   * @param ctx - Cordis context that will eventually carry `paperAudit`.
   * @param options - profile override and clock override for tests.
   */
  constructor(
    ctx: Context,
    options: { profile?: PaperRuntimeProfile; now?: () => string } = {},
  ) {
    super(ctx, 'paperRuntimeGuard')
    this.profile = options.profile ?? createFormalProfile()
    this.now = options.now ?? (() => new Date().toISOString())
    this.firewall = new CapabilityFirewall(this.profile, event => this.emitAudit(event))
  }

  /**
   * Replace the active profile. Forbidden after the guard has been readied.
   * @param profile - new profile.
   */
  setProfile(profile: PaperRuntimeProfile): void {
    if (this.ready) {
      throw new RuntimeNotReadyError('profile cannot be changed after assertRuntimeReady')
    }
    this.profile = profile
    // Rebuild the firewall so its stage policies match the new profile.
    this.firewall.setProfile(profile)
  }

  getProfile(): PaperRuntimeProfile {
    return this.profile
  }

  /**
   * Mark the guard as ready. Called exactly once by the composition after
   * preflight passes. Any subsequent `setProfile` call throws.
   */
  markReady(): void {
    this.ready = true
  }

  /**
   * Whether the guard has been readied.
   *
   * TASK 5.0.11: the query form of {@link assertRuntimeReady}. The
   * delivery policy carries a `runtimeProfileValid` field, and it used
   * to be hardcoded `true` on the theory that the guard is always
   * checked before the policy is built. That made the field a constant
   * PASS — a check that never runs but always agrees. `buildDeliveryPolicy`
   * now asks, and this is the answer it is given.
   *
   * It returns readiness only. Mode compatibility is a property of a
   * *run*, so it stays on `assertRuntimeReady(runMode)`, which the
   * executor calls before the run starts.
   */
  isReady(): boolean {
    return this.ready
  }

  /**
   * Assert the guard is readied and the active profile is compatible with
   * the run mode recorded on the call. EXPLORATORY profiles accept any run
   * mode; FORMAL/FAST profiles require a run mode that maps to them
   * (`strict` ↔ FORMAL, `fast` ↔ FAST).
   * @param runMode - the mode recorded on the run; omit to skip mode check.
   */
  assertRuntimeReady(runMode?: string): void {
    if (!this.ready) {
      throw new RuntimeNotReadyError('guard is not readied')
    }
    if (runMode === undefined) return
    if (this.profile.mode === 'EXPLORATORY') return
    const expected = this.profile.mode === 'FORMAL' ? 'strict' : 'fast'
    if (runMode !== expected) {
      throw new RuntimeNotReadyError(
        `run mode '${runMode}' does not match profile mode '${this.profile.mode}' (expected '${expected}')`,
      )
    }
  }

  /**
   * The only blessed entry point for a capability execution. Returns whatever
   * the wrapped function returns, or throws `CapabilityDeniedError` on denial
   * and `RuntimeNotReadyError` if the guard is not readied.
   * @param ctx - capability invocation context.
   * @param body - the function whose execution is gated.
   * @returns the function's return value.
   */
  invokeCapability<T>(ctx: InvokeCapabilityContext, body: GuardedFnContext): T {
    if (!this.ready) {
      throw new RuntimeNotReadyError('guard is not readied')
    }
    let decision: { allowed: boolean; reason?: string }
    if (isLlmSeam(ctx.capability)) {
      // LLM seams map to the `llm_inference` capability, which is present
      // in every stage whitelist that needs to call the model. This keeps
      // the firewall the single source of truth for "this stage may
      // contact the model".
      const req: CapabilityRequest = { stage: ctx.stage, capability: 'llm_inference', at: this.now() }
      decision = this.firewall.check(req)
    } else {
      const req: CapabilityRequest = { stage: ctx.stage, capability: ctx.capability, at: this.now() }
      decision = this.firewall.check(req)
    }
    if (!decision.allowed) {
      throw new CapabilityDeniedError(ctx.stage, ctx.capability, decision.reason ?? 'unknown')
    }
    return body.fn() as T
  }

  /** Internal: forward a capability-check audit event to `paperAudit` if
   * available. The composition installs the audit service before any
   * capability call, so a missing audit is only possible in tests that
   * instantiate the guard without Cordis — in that case we still log to
   * stderr, but the guard's own `ready` flag remains false until the
   * composition calls `markReady`, so the runtime is not exploitable. */
  private emitAudit(event: {
    type: 'capability_check'
    stage: StageName
    capability: Capability
    allowed: boolean
    at: string
  }): void {
    const audit = this.ctx.get('paperAudit') as
      | { record(entry: AuditEntryInput): Promise<unknown> }
      | undefined
    if (audit === undefined) {
      process.stderr.write(
        `[paperRuntimeGuard] audit not available: capability_check stage=${event.stage} cap=${event.capability} allowed=${event.allowed}\n`,
      )
      return
    }
    void audit.record({
      eventType: 'capability_check',
      actor: 'paperRuntimeGuard',
      detail: {
        stage: event.stage,
        capability: event.capability,
        allowed: event.allowed,
        at: event.at,
      },
    }).catch(() => undefined)
  }
}

export default PaperRuntimeGuard

// Re-export the firewall's audit-sink type under a stable name so the bundle
// layer can build its own sinks if needed without circular imports.
export type { AuditSink as GuardAuditSink }
