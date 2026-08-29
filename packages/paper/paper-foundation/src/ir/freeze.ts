/**
 * Deep-freeze helper shared by the IR's policy tables.
 *
 * `readonly` and `as const` are compile-time promises with no runtime effect.
 * The IR's tables (`IR_KINDS`, `IR_SCHEMAS`, `IR_REF_FIELDS`,
 * `ID_FIELD_BY_KIND`) are *read live* on every ingest, so leaving them
 * mutable hands any module in the process a global kill switch: one
 * assignment turns the reference validator into a no-op and every subsequent
 * ingest becomes an unconditional accept (red team RT2-02 / RT3-01).
 *
 * Freezing is the machine-level enforcement the `Readonly<>` types only
 * advertise, and it is asserted by a test rather than trusted.
 */

/**
 * Recursively freeze `value` in place and return it.
 *
 * Cycle-safe: zod's schema objects reference each other, so a naive walk
 * would recurse forever.
 */
export function deepFreeze<T>(value: T, seen: Set<object> = new Set()): T {
  if (Array.isArray(value)) {
    if (seen.has(value)) return value
    seen.add(value)
    for (const item of value) deepFreeze(item, seen)
    return Object.freeze(value)
  }
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return value
    seen.add(value)
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested, seen)
    }
    return Object.freeze(value)
  }
  return value
}
