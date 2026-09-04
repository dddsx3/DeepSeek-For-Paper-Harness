/**
 * Vendor-neutral e2e route resolution (vendor-decoupling batch).
 *
 * The e2e suites must never be bound to any single LLM vendor — official or
 * relay. The route (provider adapter, model id, endpoint, credential) comes
 * from the environment; nothing here defaults to a vendor. Two variable
 * families are accepted:
 *
 *   - `DSH_E2E_LLM_*` — the vendor-neutral family (preferred):
 *       DSH_E2E_LLM_PROVIDER   adapter route the composition registers
 *                              (e.g. deepseek-official, a pi-ai relay route)
 *       DSH_E2E_LLM_MODEL      model id the endpoint accepts
 *       DSH_E2E_LLM_API_KEY    credential for the run
 *       DSH_E2E_LLM_BASE_URL   endpoint base (any OpenAI-compatible relay)
 *   - the legacy `DEEPSEEK_API_KEY` still gates the suites (skip-if) so
 *     existing credentialed CI keeps working, but it never selects a vendor
 *     by itself.
 *
 * When `DSH_E2E_LLM_*` is absent, the suites fall back to the deepseek
 * adapter family with its OWN endpoint variables — and the adapter itself
 * refuses to run without an explicit baseURL (no implicit vendor route).
 *
 * @module examples/headless-agent/tests/e2e-llm-route
 */

export interface E2eLlmRoute {
  /** Adapter route name registered on the composition. */
  readonly provider: string
  /** Model id the endpoint accepts. */
  readonly model: string
  /** Credential for this run (never stored, never logged). */
  readonly apiKey: string
  /** Endpoint base URL; every OpenAI-compatible relay is accepted. */
  readonly baseURL: string
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.find(value => value !== undefined && value !== '')
}

/**
 * Resolve the e2e LLM route from the environment. Returns `undefined` when
 * no usable credential is present — the caller uses that to self-skip
 * (keyless CI must never fake a green).
 */
export function resolveE2eLlmRoute(): E2eLlmRoute | undefined {
  const apiKey = firstDefined(process.env.DSH_E2E_LLM_API_KEY, process.env.DEEPSEEK_API_KEY)
  if (apiKey === undefined) return undefined
  return {
    provider: firstDefined(process.env.DSH_E2E_LLM_PROVIDER) ?? 'deepseek-official',
    model: firstDefined(process.env.DSH_E2E_LLM_MODEL) ?? 'deepseek-v4-flash',
    apiKey,
    baseURL: firstDefined(process.env.DSH_E2E_LLM_BASE_URL, process.env.DEEPSEEK_BASE_URL)
      // The deepseek adapter requires an explicit endpoint (vendor-decoupling
      // batch); when nothing named one, this string makes the refusal message
      // actionable at harness-boot time instead of deep in the adapter.
      ?? 'unset:e2e-must-configure-DSH_E2E_LLM_BASE_URL-or-DEEPSEEK_BASE_URL',
  }
}
