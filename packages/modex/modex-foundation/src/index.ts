/** Harness phase-two foundation: durable run storage and bounded diagnostics. */

import { Context, Service } from '@deepseek-ai/cordis'
import { DomainWorkflowRunRepository } from './store.ts'
import { workflowRunDomainSpec } from './spec.ts'

export * from './spec.ts'
export * from './store.ts'
export * from './diagnostics.ts'
export * from './settings.ts'
export * from './provider.ts'
export * from './state-machine.ts'
export * from './workflow.ts'
export * from './replay.ts'
export {
  SignedSkillProvider,
  SignedSkillValidationError,
  SignedSkillConfig,
  loadSignedSkill,
  signaturePayload,
} from './signed-skill.ts'
export type {
  SignedSkillManifest,
  SkillTrustRoots,
  SignedSkillProviderConfig,
  LoadSignedSkillOptions,
  ValidatedSignedSkill,
} from './signed-skill.ts'
export {
  SkillCatalogService,
  SkillConflictError,
  detectSkillConflicts,
  skillCatalogDomainSpec,
} from './skill-catalog.ts'
export type {
  InstalledSkillRecord,
  InstalledSkillVersion,
  SkillCatalogConfig,
  SkillConflict,
} from './skill-catalog.ts'
export { CatalogSkillProvider } from './catalog-provider.ts'
export { resolveRunPolicy } from './policy.ts'
export type { RunPolicy } from './policy.ts'
export { WorkflowExecutor, WorkflowExecutionError } from './executor.ts'
export type {
  AuditSink, ExecutionFailureCode, ExecutionOutcome, ExecutorOptions, ReviewDefect,
} from './executor.ts'
export {
  DEFAULT_BACKOFF_BASE_MS, DEFAULT_BACKOFF_CAP_MS, DEFAULT_BUDGET_WARN_FRACTION,
  DEFAULT_CONTEXT_UTILIZATION,
  resolveExecutorOptions,
  DEFAULT_DAILY_BUDGET_USD, DEFAULT_STRICT_BUDGET_MULTIPLIER, HarnessExecutorService,
} from './executor-service.ts'
export type { ExecutorConfig } from './executor-service.ts'
export { computeCostUsd, evaluateBudget, resolveModelPrice } from './cost.ts'
export type { BudgetPolicy, BudgetState, BudgetVerdict, ModelPrice, PricingTable } from './cost.ts'
export { compactPrompt, estimateTextTokens, renderSections } from './context.ts'
export type { CompactionOutcome, ElidedSection, PromptSection } from './context.ts'
export { backoffDelayMs, classifyFailure } from './resilience.ts'
export type { BackoffPolicy, FailureAction } from './resilience.ts'
export {
  REDACTED, redactSensitiveDetail, redactSensitiveText, redactSensitiveValue,
} from './redact.ts'
export {
  ReleaseVerificationError, isInRollout, releaseArtifactSchema, releaseManifestSchema,
  releaseSignaturePayload, verifyReleaseArtifacts, verifyReleaseManifest,
} from './release.ts'
export type { ReleaseArtifact, ReleaseManifest, ReleasePolicy, VerifiedRelease } from './release.ts'
export {
  DEFAULT_RELEASE_HARNESS_VERSION, HarnessReleaseService, releaseDomainSpec,
  releaseRecordSchema, releaseStateSchema, resolveReleasePolicy,
} from './release-service.ts'
export type { ReleaseConfig, ReleaseRecord, ReleaseStartupResult, ReleaseState } from './release-service.ts'
export {
  AUDIT_EVENT_TYPES, DEFAULT_AUDIT_RETENTION_DAYS, HarnessAuditService, auditDomainSpec,
  auditRecordSchema,
} from './audit.ts'
export type { AuditConfig, AuditEntryInput, AuditEventType, AuditRecord } from './audit.ts'

/** Cordis plugin name. */
export const name = 'harness-foundation'

/** Services required before the foundation can initialize. */
export const inject = ['storageDomain']

declare module '@deepseek-ai/cordis' {
  interface Context {
    harnessFoundation: HarnessFoundationService
  }
}

/** Owns the phase-two workflow domain and exposes its repository. */
export class HarnessFoundationService extends Service {
  static inject = ['storageDomain']

  private repository: DomainWorkflowRunRepository | undefined

  /**
   * @param ctx - Context carrying the shared storage-domain facility.
   */
  constructor(ctx: Context) {
    super(ctx, 'harnessFoundation')
  }

  /** Open the versioned domain and close it with the service lifecycle. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(workflowRunDomainSpec)
    const repository = new DomainWorkflowRunRepository(domain)
    this.repository = repository
    this.ctx.effect(() => async () => {
      this.repository = undefined
      await repository.close()
    }, 'harness-foundation.close')
  }

  /**
   * Return the initialized run repository.
   * @returns the repository owned by this service.
   */
  get runs(): DomainWorkflowRunRepository {
    if (this.repository === undefined) {
      throw new Error('harness foundation is not initialized')
    }
    return this.repository
  }
}

export default HarnessFoundationService
