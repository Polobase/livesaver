/**
 * UTF-8 and XML entity helpers. Everything works on byte ranges of the original buffer so values
 * are only decoded when someone asks for them.
 */

const decoder = new TextDecoder('utf-8')
const encoder = new TextEncoder()

/** Decode `bytes[start, end)` as UTF-8. Short ASCII runs (the common case in Live files) skip TextDecoder. */
export function decodeUtf8(bytes: Uint8Array, start = 0, end = bytes.length): string {
  const length = end - start
  if (length <= 0) return ''
  if (length <= 48) {
    let ascii = true
    for (let i = start; i < end; i++) {
      if ((bytes[i] as number) > 0x7f) {
        ascii = false
        break
      }
    }
    if (ascii) {
      let out = ''
      for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i] as number)
      return out
    }
  }
  return decoder.decode(bytes.subarray(start, end))
}

export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text)
}

const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/** Replace XML entity and character references. Unknown or malformed references stay as they are. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, ref: string) => {
    if (ref.charCodeAt(0) === 0x23) {
      const code =
        ref.charCodeAt(1) === 0x78 ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1))
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole
      return String.fromCodePoint(code)
    }
    return NAMED[ref] ?? whole
  })
}

/** Decode `bytes[start, end)` as UTF-8 and resolve entity references. */
export function decodeValue(bytes: Uint8Array, start: number, end: number): string {
  const raw = decodeUtf8(bytes, start, end)
  return raw.includes('&') ? decodeEntities(raw) : raw
}

/**
 * Escape an attribute value (`&`, `<`, `>`, `"`), for use between double
 * quotes. This is also what Live accepts back for every value it can hold.
 */
export function escapeAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** Escape character data (element text). */
export function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** How `setAttr` quotes new values. */
export type Quoting = 'double' | 'live'

/**
 * A complete quoted attribute value (quotes included).
 * - `double`: always `"…"` with `&quot;`; Live reads it back for every value it can hold.
 * - `live`: like Live itself, single quotes when the value contains `"` but no `'`.
 */
export function quoteAttr(value: string, quoting: Quoting = 'double'): string {
  if (quoting === 'live' && value.includes('"') && !value.includes("'")) {
    return `'${value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}'`
  }
  return `"${escapeAttr(value)}"`
}
