/**
 * Byte search. Live files are scanned for a handful of tags (`<FileRef>`, `<RelativePathElement Id="`)
 * far more often than they are fully parsed, so this is on the hot path. Hosts pass a native search
 * (Bun: SIMD memmem at ~6 GB/s); the pure Boyer–Moore–Horspool here keeps the core runtime-agnostic.
 */

/** Offset of `needle` in the prepared haystack at or after `from`, or -1. */
export type Finder = (needle: Uint8Array, from: number) => number

/** Prepare a haystack once (native hosts wrap it in a Buffer view), then search it many times. */
export type ByteSearch = (haystack: Uint8Array) => Finder

const skipTables = new WeakMap<Uint8Array, Int32Array>()

function skipTable(needle: Uint8Array): Int32Array {
  let table = skipTables.get(needle)
  if (!table) {
    const m = needle.length
    table = new Int32Array(256).fill(m)
    for (let i = 0; i < m - 1; i++) table[needle[i] as number] = m - 1 - i
    skipTables.set(needle, table)
  }
  return table
}

/** Pure Boyer–Moore–Horspool over `haystack`. */
export function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  const m = needle.length
  if (m === 0) return from <= haystack.length ? from : -1
  if (m === 1) return haystack.indexOf(needle[0] as number, from)
  const skip = skipTable(needle)
  const last = needle[m - 1] as number
  const end = haystack.length - m
  let i = Math.max(0, from)
  while (i <= end) {
    const c = haystack[i + m - 1] as number
    if (c === last) {
      let k = m - 2
      while (k >= 0 && haystack[i + k] === needle[k]) k--
      if (k < 0) return i
    }
    i += skip[c] as number
  }
  return -1
}

export const searchBytes: ByteSearch = (haystack) => (needle, from) =>
  indexOfBytes(haystack, needle, from)
