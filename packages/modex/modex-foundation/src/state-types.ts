/** State aliases shared by transition and recovery code. */

import type { z } from 'zod'
import { nodeStateSchema, runStatusSchema } from './spec.ts'

/** Workflow run lifecycle state. */
export type RunStatus = z.infer<typeof runStatusSchema>
/** Workflow node lifecycle state. */
export type NodeState = z.infer<typeof nodeStateSchema>
