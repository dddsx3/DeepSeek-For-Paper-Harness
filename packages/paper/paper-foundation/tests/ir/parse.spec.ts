import { describe, expect, it } from 'vitest'
import {
  MAX_IR_JSON_CHARS,
  MAX_IR_JSON_DEPTH,
  parseStrictJson,
  scanIrValue,
  type StrictJsonResult,
} from '../../src/ir/index.ts'

/** Discriminate the failure side of a strict-parse result for assertions. */
function reasonOf(result: StrictJsonResult): string {
  if (result.ok) throw new Error('expected a failure, got a parse success')
  return result.reason
}

describe('parseStrictJson — IR-001 text ingress', () => {
  it('accepts a well-formed object', () => {
    const r = parseStrictJson('{"a":1}')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual({ a: 1 })
  })

  it('accepts a bare scalar, leaving type rejection to the schema', () => {
    const r = parseStrictJson('42')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(42)
  })

  it('rejects a non-string input instead of coercing it', () => {
    expect(reasonOf(parseStrictJson({ a: 1 }))).toBe('input_not_a_string')
  })

  it('rejects undefined and null inputs', () => {
    expect(reasonOf(parseStrictJson(undefined))).toBe('input_not_a_string')
    expect(reasonOf(parseStrictJson(null))).toBe('input_not_a_string')
  })

  it('rejects empty and whitespace-only input', () => {
    expect(reasonOf(parseStrictJson(''))).toBe('empty_or_blank_input')
    expect(reasonOf(parseStrictJson('   \n\t '))).toBe('empty_or_blank_input')
  })

  it('rejects trailing commas', () => {
    expect(reasonOf(parseStrictJson('{"a":1,}'))).toBe('json_parse_error')
  })

  it('rejects single-quoted JSON', () => {
    expect(reasonOf(parseStrictJson("{'a':1}"))).toBe('json_parse_error')
  })

  it('rejects JavaScript literals that are not JSON', () => {
    expect(reasonOf(parseStrictJson('NaN'))).toBe('json_parse_error')
    expect(reasonOf(parseStrictJson('Infinity'))).toBe('json_parse_error')
    expect(reasonOf(parseStrictJson('undefined'))).toBe('json_parse_error')
  })

  it('rejects a model "explanation sandwich" around the JSON', () => {
    const text = 'Here is the object:\n{"a":1}\nHope that helps!'
    expect(reasonOf(parseStrictJson(text))).toBe('json_parse_error')
  })

  it('rejects truncated JSON', () => {
    expect(reasonOf(parseStrictJson('{"a":'))).toBe('json_parse_error')
  })

  it('never throws on adversarial input', () => {
    const nasty = [' ', '﻿{}', '{"a":1}{"b":2}', '[1,2,]', '{"a":1e999}']
    for (const text of nasty) {
      expect(() => parseStrictJson(text)).not.toThrow()
    }
  })
})

describe('parseStrictJson — size cap precedes the parse', () => {
  it('refuses an oversized payload without ever calling JSON.parse', () => {
    // The depth cap runs after JSON.parse, so without this bound a
    // multi-megabyte deeply-nested payload is fully materialised before
    // anything can refuse it — the process dies of heap exhaustion instead
    // of returning a verdict (red team RT1-02).
    const huge = `{${'"a":'.repeat(MAX_IR_JSON_CHARS)}1${'}'.repeat(MAX_IR_JSON_CHARS)}`
    expect(huge.length).toBeGreaterThan(MAX_IR_JSON_CHARS)
    expect(reasonOf(parseStrictJson(huge))).toBe('input_too_large')
  })

  it('accepts a payload exactly at the cap', () => {
    const atCap = `{"a":"${'x'.repeat(MAX_IR_JSON_CHARS - 8)}"}`
    expect(atCap.length).toBe(MAX_IR_JSON_CHARS)
    expect(parseStrictJson(atCap).ok).toBe(true)
  })
})

describe('scanIrValue — structural safety of an already-parsed value', () => {
  it('cleans a plain legal object', () => {
    expect(scanIrValue({ a: 1, b: ['x', 'y'], c: { d: null } })).toBe('clean')
  })

  it('rejects a top-level __proto__ key', () => {
    expect(scanIrValue(JSON.parse('{"__proto__":{"polluted":true}}'))).toBe('forbidden_key')
  })

  it('rejects a nested forbidden key', () => {
    // Built with JSON.parse on purpose: `{ __proto__: 1 }` in an object
    // *literal* sets the prototype, it does not create an own key.
    expect(scanIrValue(JSON.parse('{"a":{"b":{"__proto__":1}}}'))).toBe('forbidden_key')
    expect(scanIrValue({ a: { constructor: 1 } })).toBe('forbidden_key')
    expect(scanIrValue({ a: { prototype: 1 } })).toBe('forbidden_key')
  })

  it('rejects a forbidden key inside an array', () => {
    expect(scanIrValue({ a: [{ constructor: 1 }] })).toBe('forbidden_key')
    expect(scanIrValue({ a: [{ prototype: 1 }] })).toBe('forbidden_key')
    expect(scanIrValue(JSON.parse('{"a":[[{"__proto__":1}]]}'))).toBe('forbidden_key')
  })

  it('rejects the unicode-escaped spelling of a forbidden key', () => {
    expect(scanIrValue(JSON.parse('{"\\u005f_proto__":1}'))).toBe('forbidden_key')
  })

  it('rejects an object graph deeper than the cap', () => {
    const depth = MAX_IR_JSON_DEPTH + 6
    let value: unknown = 1
    for (let i = 0; i < depth; i += 1) value = [value]
    expect(scanIrValue(value)).toBe('too_deep')
  })

  it('accepts an object graph exactly at the cap', () => {
    let value: unknown = 1
    for (let i = 0; i < MAX_IR_JSON_DEPTH; i += 1) value = [value]
    expect(scanIrValue(value)).toBe('clean')
  })

  it('rejects a value with own symbol keys, which Object.keys would silently drop', () => {
    expect(scanIrValue({ a: 1, [Symbol('secret')]: 'x' })).toBe('symbol_key')
  })

  it('rejects inherited keys, which zod would read as if they were own', () => {
    const proto = { inherited: 1 }
    expect(scanIrValue(Object.create(proto))).toBe('inherited_key')
    expect(scanIrValue(Object.assign(Object.create({}), { own: 1 }))).toBe('clean')
  })

  it('rejects an array whose prototype carries an enumerable key', () => {
    // A *real* array (Array.isArray true) with a polluted prototype: for..in
    // walks the chain and sees the inherited key as non-own.
    const proto = { polluted: 1 }
    const arr: unknown[] = []
    Object.setPrototypeOf(arr, proto)
    expect(Array.isArray(arr)).toBe(true)
    expect(scanIrValue(arr)).toBe('inherited_key')
  })

  it('rejects an accessor property rather than invoking it', () => {
    const hostile = { get boom(): number { throw new Error('getter') } }
    expect(scanIrValue({ a: hostile })).toBe('accessor_key')
    expect(() => scanIrValue({ a: hostile })).not.toThrow()
  })
})

describe('text ingress as a whole refuses every hostile payload', () => {
  it('either the parser or the scan rejects attack text', () => {
    const payloads = [
      '{',
      '{"a":1,}',
      "{'a':1}",
      '{"__proto__":{"polluted":true}}',
      '{"a":[{"constructor":1}]}',
      `${'['.repeat(MAX_IR_JSON_DEPTH + 6)}1${']'.repeat(MAX_IR_JSON_DEPTH + 6)}`,
    ]
    for (const text of payloads) {
      const parsed = parseStrictJson(text)
      if (parsed.ok) {
        expect(scanIrValue(parsed.value), `scan must reject: ${text.slice(0, 40)}`).not.toBe('clean')
      } else {
        expect(parsed.reason).toBeTypeOf('string')
      }
    }
  })
})
