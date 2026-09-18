/**
 * W8.11-B2 — the artifact BODY store.
 *
 * 事故（W8.10 的判定无法核验）：run-4 报"e1_span 疑似改写"，但 **E1 全文与
 * E2 容器都没有落盘**——于是该判定事后只能靠 D5 的内联证据，无法回看原文。
 * 这是本项目第 4/6 类形态（量具失效 / 判定侧写了、传递侧没写）的第 N 次复发。
 *
 * 为什么需要这个模块：`spec.ts` 的 `artifactRecordSchema` 注释早已写明
 * "Durable artifact metadata; **content is stored separately by a later
 * provider**"——而那个 provider **从未被实现**。`storeArtifact` 只写
 * `storageKey: 'inline:<digest>'` 这条**元数据**，正文哪里都没有。
 *
 * 落点选择（**红线 N17 是硬约束**）：正文必须进 **artifact store**，
 * **不得进 EXECUTE 节点的输出**——W8.9-C2 的教训是节点输出同时是 reviewer 的
 * 输入，往里加内容会改变请求指纹，导致 TASK-E 每个 cassette miss。本模块因此
 * 是**独立的存储域**（照 `audit.ts` 的先例），与 workflow 记录解耦，不进任何
 * 模型可见的通道。
 *
 * 独立域而非给 `paper_workflow` 加表：那个域是 `version: 1`，加表要么改
 * version（`storage-json` 的 `format.ts:62` 对 version 不等**直接抛错**，
 * 已有数据全读不出来），要么不动 version 而让 schema 与磁盘不一致。
 * 新域则天然向后兼容（`format.ts:67` 对缺失的表建空 Map）。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/artifact-body
 */

import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z as zod } from 'zod'
import { redactSensitiveText } from './redact.ts'

/**
 * One stored body.
 *
 * `sha256` is the **content hash the metadata record already carries**, so a
 * reader can verify the body it fetched is the body the record describes —
 * the store never has to be trusted, only checked.
 */
export const artifactBodySchema = zod.object({
  /** The `ArtifactRecord.id` this body belongs to. */
  artifactId: zod.string().min(1),
  /** Run the artifact belongs to (kept so bodies can be pruned per run). */
  runId: zod.string().min(1),
  /** Lowercase hex digest of `text`, matching `ArtifactRecord.sha256`. */
  sha256: zod.string().regex(/^[a-f0-9]{64}$/),
  /** The body itself. Bounded so one artifact cannot exhaust the medium. */
  text: zod.string().max(4_000_000),
})

/** One stored body. */
export type ArtifactBody = zod.infer<typeof artifactBodySchema>

/** Body storage declaration, deliberately separate from the workflow domain. */
export const artifactBodyDomainSpec = defineDomain({
  name: 'paper_artifact_body',
  version: 0,
  tables: {
    bodies: domainTable<string, ArtifactBody>(artifactBodySchema),
  },
})

/** Retention policy for bodies. */
export interface ArtifactBodyConfig {
  /**
   * Whether bodies are persisted at all.
   *
   * Default `true`: W8.11-B2 exists because the ABSENCE of bodies made a
   * judgement unverifiable. A composition that wants the old metadata-only
   * behaviour opts out explicitly rather than getting it by accident.
   */
  readonly persistBodies?: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    paperArtifactBody: PaperArtifactBodyService
  }
}

/** Durable artifact bodies over their own storage domain. */
export class PaperArtifactBodyService extends Service {
  static inject = ['storageDomain']

  static Config: s<ArtifactBodyConfig> = s.object({
    persistBodies: s.boolean().default(true),
  })

  private readonly enabled: boolean
  private table: KvTable<string, ArtifactBody> | undefined

  /**
   * @param ctx - Context carrying the storage-domain facility.
   * @param config - whether bodies are persisted.
   */
  constructor(ctx: Context, config: ArtifactBodyConfig = {}) {
    super(ctx, 'paperArtifactBody')
    this.enabled = config.persistBodies ?? true
  }

  /** Open the body domain and close it with the service. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(artifactBodyDomainSpec)
    const table = domain.table('bodies')
    this.table = table
    this.ctx.effect(() => async () => {
      this.table = undefined
      await domain.close()
    }, 'paper-artifact-body.close')
  }

  /**
   * Store one body. Idempotent: the same artifact id with the same digest
   * overwrites with identical content, so a retry cannot duplicate a body.
   *
   * Text passes through the same credential redaction the audit trail uses —
   * a model can echo a key it was given, and the body store must not become
   * the one durable sink that skips the redactor (W8.9 §5 凭据卫生).
   *
   * @param input - artifact id, run id, the digest the metadata carries, and the text.
   * @returns the stored body.
   */
  async put(input: { artifactId: string; runId: string; sha256: string; text: string }): Promise<ArtifactBody> {
    const body: ArtifactBody = {
      artifactId: input.artifactId,
      runId: input.runId,
      sha256: input.sha256,
      text: redactSensitiveText(input.text),
    }
    if (!this.enabled) return body
    await this.requireTable().put(body.artifactId, body)
    return body
  }

  /**
   * Read one body.
   * @param artifactId - the artifact whose body to read.
   * @returns the body, or undefined when absent (or when persistence is off).
   */
  get(artifactId: string): ArtifactBody | undefined {
    if (!this.enabled) return undefined
    return this.requireTable().get(artifactId)
  }

  /**
   * Read one body by the digest the metadata record carries, verifying that
   * the body's content actually hashes to it.
   *
   * The verification is the point: a body that does not match its record is
   * worse than a missing body, because a reader would treat it as evidence.
   *
   * @param artifactId - the artifact whose body to read.
   * @param sha256 - the digest the metadata record claims.
   * @returns the body when present AND consistent, else undefined.
   */
  getVerified(artifactId: string, sha256: string): ArtifactBody | undefined {
    const body = this.get(artifactId)
    if (body === undefined) return undefined
    if (body.sha256 !== sha256) return undefined
    return body
  }

  /** Every stored body, for a run when one is named. */
  list(runId?: string): ArtifactBody[] {
    if (!this.enabled) return []
    const all = [...this.requireTable().entries()].map(([, body]) => body)
    return runId === undefined ? all : all.filter(body => body.runId === runId)
  }

  private requireTable(): KvTable<string, ArtifactBody> {
    if (this.table === undefined) throw new Error('paperArtifactBody used before init')
    return this.table
  }
}
