/**
 * Redaction applied before any Paper value becomes durable or diagnostic.
 * Credential material reaches this package only as a reference, but audit
 * detail, provider messages, and error text are open maps assembled from
 * outside data, so they pass through here rather than being trusted.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/redact
 */

/** Replacement for every redacted value. */
export const REDACTED = '***'

/** Credential-bearing name fragments shared by the key and text patterns. */
const SECRET_NAMES = 'api[_-]?keys?|authorization|auth[_-]?token|access[_-]?token'
  + '|token|secret|password|passphrase|credential'

/** Keys whose value is replaced outright, matched case-insensitively. */
const SENSITIVE_KEY = new RegExp(`(?:^|[._-])(?:${SECRET_NAMES})$`, 'iu')

/** `name: value` and `name=value` pairs whose value is credential material. */
const LABELED_SECRET = new RegExp(
  `\\b(${SECRET_NAMES})\\b(["']?\\s*[:=]\\s*["']?)([\\w.+/-]{8,})`,
  'giu',
)

/** HTTP bearer credentials, whatever header casing carried them. */
const BEARER = /\b(bearer\s+)[\w.~+/-]{8,}={0,2}/giu

/** Provider key prefixes that identify a credential without a surrounding label. */
const PREFIXED_KEY = /\b(?:sk|rk|pk)-[a-z0-9]{12,}\b/giu

/** Recursion ceiling; deeper structure is replaced rather than walked. */
const MAX_DEPTH = 8

/**
 * Mask credential material inside free text.
 * @param text - arbitrary text, possibly carrying labeled or prefixed secrets.
 * @returns the text with every recognized credential replaced.
 */
export function redactSensitiveText(text: string): string {
  return text
    .replace(LABELED_SECRET, (_match, label: string, separator: string) => `${label}${separator}${REDACTED}`)
    .replace(BEARER, (_match, prefix: string) => `${prefix}${REDACTED}`)
    .replace(PREFIXED_KEY, REDACTED)
}

/**
 * Deep-copy one JSON-compatible value with credential-bearing keys and text
 * masked. Cycles and over-deep structure are replaced, never followed, so this
 * is safe on values assembled outside this package.
 * @param value - the value to project.
 * @returns a redacted structural copy; functions and symbols become `null`.
 */
export function redactSensitiveValue(value: unknown): unknown {
  return project(value, 0, new WeakSet<object>())
}

/**
 * Redact one open detail map, the shape audit entries and event payloads use.
 * @param detail - the map to project.
 * @returns a redacted copy with the same keys.
 */
export function redactSensitiveDetail(
  detail: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(detail)) {
    result[key] = SENSITIVE_KEY.test(key) ? REDACTED : project(entry, 1, new WeakSet<object>())
  }
  return result
}

function project(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactSensitiveText(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (typeof value !== 'object') return null
  if (depth >= MAX_DEPTH) return REDACTED
  if (seen.has(value)) return REDACTED
  seen.add(value)
  if (Array.isArray(value)) return value.map(entry => project(entry, depth + 1, seen))
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEY.test(key) ? REDACTED : project(entry, depth + 1, seen)
  }
  return result
}
