/** Skill-registry provider over the Harness catalog's active versions. */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
} from '@deepseek-ai/dsh-skill'
import type { ValidatedSignedSkill } from './signed-skill.ts'
import type { SkillCatalogService } from './skill-catalog.ts'

const PROVIDER_NAME = 'harness-catalog'

/** Provider serving the catalog's active skill versions through `ctx.skills`. */
export class CatalogSkillProvider implements SkillProvider {
  readonly name = PROVIDER_NAME

  /**
   * @param catalog - Catalog whose active versions this provider serves.
   */
  constructor(private readonly catalog: SkillCatalogService) {}

  /** @inheritdoc */
  async list(): Promise<readonly SkillCandidate[]> {
    return (await this.catalog.activeSkills()).map(skill => candidateOf(skill))
  }

  /** @inheritdoc */
  async get(candidate: SkillCandidate, _options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    if (typeof candidate.locator !== 'string') return undefined
    const active = await this.catalog.activeSkills()
    const match = active.find(skill => skill.directory === candidate.locator)
    if (match === undefined) return undefined
    return definitionOf(match)
  }
}

/** Cordis plugin name. */
export const name = 'harness-skill-catalog-provider'
/** The provider needs the skill registry and the Harness catalog service. */
export const inject = ['skills', 'harnessSkillCatalog']

/** Register the catalog provider on the existing skill registry. */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => new CatalogSkillProvider(ctx.harnessSkillCatalog))
}

function candidateOf(skill: ValidatedSignedSkill): SkillCandidate {
  return {
    name: skill.manifest.id,
    description: skill.manifest.description,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled',
    provider: PROVIDER_NAME,
    resourceBase: { kind: 'directory', path: skill.directory },
    rank: BUNDLED_SKILL_RANK,
    locator: skill.directory,
    path: join(skill.directory, 'system.md'),
    metadata: { version: skill.manifest.version, tags: [...skill.manifest.tags] },
  }
}

function definitionOf(skill: ValidatedSignedSkill): SkillDefinition {
  return {
    ...candidateOf(skill),
    content: skill.systemContent,
    metadata: {
      version: skill.manifest.version,
      roles: [...skill.manifest.roles],
      tags: [...skill.manifest.tags],
      permissions: skill.manifest.permissions,
    },
  }
}
