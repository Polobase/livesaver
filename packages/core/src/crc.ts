/**
 * Live's sample fingerprint: file size plus CRC-16/UMTS (poly 0x8005, init 0, no reflection,
 * xorout 0) over the first 16 KB. Stored as OriginalFileSize/OriginalCrc (Live 11+) or
 * SearchHint/FileSize/Crc (Live 8.2–10). See docs/format/fingerprints.md.
 */

export const CRC_BYTES = 16384

const TABLE = (() => {
  const t = new Uint16Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i << 8
    for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff
    t[i] = c
  }
  return t
})()

/** CRC-16/UMTS of `bytes[start, end)`. */
export function crc16umts(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0
  for (let i = start; i < end; i++) {
    c = ((c << 8) & 0xffff) ^ (TABLE[((c >> 8) ^ (bytes[i] as number)) & 0xff] as number)
  }
  return c
}

/** Live's CRC of a file whose first bytes are `head` (only the first 16 KB count). */
export function liveCrc(head: Uint8Array): number {
  return crc16umts(head, 0, Math.min(head.length, CRC_BYTES))
}

/**
 * Live CRCs of a file as if its RIFF/FORM header announced a file of `size` bytes.
 * Vendors (Native Instruments, Ableton) re-saved library files with a padding byte or appended
 * metadata; the first 16 KB then differ only in that size field (bytes 4–8).
 */
export function resizedHeaderCrcs(head: Uint8Array, size: number): Set<number> {
  const out = new Set<number>()
  const tag = String.fromCharCode(head[0] ?? 0, head[1] ?? 0, head[2] ?? 0, head[3] ?? 0)
  const littleEndian = tag === 'RIFF' ? true : tag === 'FORM' ? false : undefined
  if (littleEndian === undefined) return out
  const copy = head.slice(0, Math.min(head.length, CRC_BYTES))
  if (copy.length < 8) return out
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength)
  for (const k of [7, 8, 9]) {
    if (size > k) {
      view.setUint32(4, (size - k) >>> 0, littleEndian)
      out.add(crc16umts(copy))
    }
  }
  return out
}
