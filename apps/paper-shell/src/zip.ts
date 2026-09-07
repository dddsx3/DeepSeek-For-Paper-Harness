/**
 * TASK-M1 M1-2 — minimal deterministic ZIP writer (STORE, no compression).
 *
 * The deliverable zip must be byte-deterministic so a re-run produces the
 * same sha256 (G2 / 禁 M1-3: PNG 后端确定性同款纪律). This writer uses
 * fixed timestamps (1980-01-01) and the STORE method, so identical inputs
 * always produce identical bytes. No external dependency.
 *
 * @module apps/paper-shell/src/zip
 */

/** CRC-32 table (IEEE, zlib polynomial). */
const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i += 1) {
  let c = i
  for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[i] = c >>> 0
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Fixed DOS date/time (1980-01-01 00:00:00) for determinism. */
const DOS_TIME = 0
const DOS_DATE = 0x21 // 1980-01-01

/** One zip entry. */
interface ZipEntry {
  readonly name: string
  readonly bytes: Uint8Array
}

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Build one deterministic ZIP archive from { name → text } entries. */
export function zipEntries(entries: ReadonlyArray<ZipEntry>): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const nameBytes = encodeUtf8(entry.name)
    const crc = crc32(entry.bytes)
    const size = entry.bytes.length
    const local = new Uint8Array(30 + nameBytes.length)
    const view = new DataView(local.buffer)
    view.setUint32(0, 0x04034b50, true) // local file header signature
    view.setUint16(4, 20, true) // version needed
    view.setUint16(6, 0x0800, true) // UTF-8 flag
    view.setUint16(8, 0, true) // STORE
    view.setUint16(10, DOS_TIME, true)
    view.setUint16(12, DOS_DATE, true)
    view.setUint32(14, crc, true)
    view.setUint32(18, size, true)
    view.setUint32(22, size, true)
    view.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    chunks.push(local, entry.bytes)

    const centralHeader = new Uint8Array(46 + nameBytes.length)
    const cview = new DataView(centralHeader.buffer)
    cview.setUint32(0, 0x02014b50, true) // central directory signature
    cview.setUint16(4, 20, true)
    cview.setUint16(6, 20, true)
    cview.setUint16(8, 0x0800, true)
    cview.setUint16(10, 0, true) // STORE
    cview.setUint16(12, DOS_TIME, true)
    cview.setUint16(14, DOS_DATE, true)
    cview.setUint32(16, crc, true)
    cview.setUint32(20, size, true)
    cview.setUint32(24, size, true)
    cview.setUint16(28, nameBytes.length, true)
    cview.setUint32(42, offset, true)
    centralHeader.set(nameBytes, 46)
    central.push(centralHeader)
    offset += local.length + entry.bytes.length
  }

  const centralBytes = concat(central)
  const endRecord = new Uint8Array(22)
  const eview = new DataView(endRecord.buffer)
  eview.setUint32(0, 0x06054b50, true) // EOCD signature
  eview.setUint16(8, entries.length, true)
  eview.setUint16(10, entries.length, true)
  eview.setUint32(12, centralBytes.length, true)
  eview.setUint32(16, offset, true)

  return concat([...chunks, centralBytes, endRecord])
}

function concat(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let cursor = 0
  for (const part of parts) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}

/** Convenience: build a zip from a name→text map (UTF-8). */
export function zipTextFiles(files: Record<string, string>): Uint8Array {
  return zipEntries(Object.entries(files).map(([name, text]) => ({ name, bytes: encodeUtf8(text) })))
}
