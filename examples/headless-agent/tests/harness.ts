import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import * as BashEnvPlugin from '@deepseek-ai/dsh-shell-env'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolResultPruner from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as SessionCheckpointPolicy from '@deepseek-ai/dsh-session-checkpoint-policy'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'
import { resolveE2eLlmRoute } from './e2e-llm-route.ts'

/**
 * Shared harness for the headless-agent e2e suites: the full plugin stack
 * with the resolved LLM adapter route (vendor-neutral, see
 * {@link resolveE2eLlmRoute}) and the real bash + todo_write tools. Lives
 * outside the *.e2e.ts pattern so importing it never re-registers another
 * file's tests.
 */

export const SYSTEM_PROMPT = 'You are a coding agent. Use bash for file operations '
  + 'with cat/grep/heredocs; check [exit code: N] markers, '
  + 'and report results briefly.'

/** System prompt for the todo_write e2e: nudges the model to plan with the tool. */
export const TODO_SYSTEM_PROMPT = 'You are a coding agent. For multi-step work, '
  + 'use the todo_write tool to track a task list: send the WHOLE list each call, '
  + 'mark every task being actively worked on in_progress (several at once when '
  + 'work runs in parallel, at least one while work remains), and mark a task '
  + 'completed as soon as it is done.'

/** Options for {@link codingHarness}. */
export interface CodingHarnessOptions {
  /**
   * Deployment persona for the tree (the system-prompt plugin's `persona`
   * config — per-context, not per-agent). Omitted ⇒ no persona section.
   */
  persona?: string
  /** Durable JSONL persistence root (the resume suite needs it; others stay file-free). */
  persistenceRoot?: string
  /**
   * Load {@link BasicCompactionEngine} with this config so the compaction e2e can
   * trigger compaction at a small, controlled history size. Omitted ⇒ no
   * compaction plugin (the default suites run without it).
   */
  compact?: BasicCompactionConfig
  /** Test-only context capacity advertised for `deepseek-v4-flash`. */
  modelContextWindow?: number
}

export async function codingHarness(workdir: string, options: CodingHarnessOptions = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { persona: options.persona ?? '' },
  })
  await ctx.plugin(AgentLoop, { agents: [] })
  // Vendor-neutral route (vendor-decoupling batch): endpoint + model come
  // from $DSH_E2E_LLM_* (falling back to the legacy DEEPSEEK_* names) —
  // never a built-in vendor default. The adapter itself refuses an unset
  // endpoint, so a misconfigured run fails loudly instead of silently
  // routing to any single vendor.
  const route = resolveE2eLlmRoute()
  await ctx.plugin(LlmDeepSeek, {
    ...(route === undefined ? {} : { baseURL: route.baseURL }),
    ...(options.modelContextWindow === undefined ? {} : {
      models: [{ id: route?.model ?? 'e2e-model', contextWindow: options.modelContextWindow }],
    }),
  })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(BashEnvPlugin)
  await ctx.plugin(LocalBashExecutor, { cwd: workdir, timeoutMs: 30_000 })
  await ctx.plugin(ToolBash)
  await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  // Compaction is opt-in: only the compaction e2e loads the reusable meter and backend.
  if (options.compact !== undefined) {
    await ctx.plugin(TokenMeter)
    await ctx.plugin(ToolResultPruner)
    await ctx.plugin(BasicCompactionEngine, options.compact)
  }
  // Durable JSONL persistence is opt-in: only the resume e2e needs it, and the
  // other suites stay file-free. Loaded last so a resume's deferred
  // `ctx.inject(['sessionPersistence'])` resolves once this is present.
  if (options.persistenceRoot !== undefined) {
    await ctx.plugin(JsonlSessionPersistence, { root: options.persistenceRoot })
    await ctx.plugin(SessionCheckpointPolicy)
  }
  return ctx
}

export function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

export function finalText(events: SessionEvent[]): string {
  const message = events.findLast(event => event.type === 'assistant/message')
  if (message?.type !== 'assistant/message') return ''
  return message.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}
