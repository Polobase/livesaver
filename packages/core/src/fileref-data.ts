/**
 * The absolute path an old-format FileRef (Live 9 and 10) stores in its `<Data>` element: a
 * Windows path as UTF-16, or a classic Mac alias record.
 */
import { MAC_ROMAN_HIGH } from './macroman.generated.js'

const utf16 = new TextDecoder('utf-16le')
const utf8 = new TextDecoder('utf-8')

/** Absolute path stored in an old-format `<Data>` element (Windows path or Mac alias), or ''. */
export function decodeData(hexText: string): string {
  const raw = hexToBytes(hexText)
  if (!raw) return ''
  if (raw.length >= 6 && raw[1] === 0 && raw[2] === 0x3a && raw[3] === 0) {
    const text = utf16.decode(raw)
    const nul = text.indexOf('\u0000')
    return nul < 0 ? text : text.slice(0, nul)
  }
  return aliasPosixPath(raw)
}

const HEX = (() => {
  const t = new Int8Array(128).fill(-1)
  for (let i = 0; i < 10; i++) t[0x30 + i] = i
  for (let i = 0; i < 6; i++) {
    t[0x41 + i] = 10 + i
    t[0x61 + i] = 10 + i
  }
  return t
})()

/** Hex digits to bytes, ignoring whitespace (Python `bytes.fromhex("".join(text.split()))`). */
function hexToBytes(text: string): Uint8Array | undefined {
  const out = new Uint8Array(text.length >> 1)
  let n = 0
  let high = -1
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 0x20 || (c >= 0x09 && c <= 0x0d)) continue
    const v = c < 128 ? (HEX[c] as number) : -1
    if (v < 0) {
      if (/\s/.test(text[i] as string)) continue
      return undefined
    }
    if (high < 0) high = v
    else {
      out[n++] = (high << 4) | v
      high = -1
    }
  }
  return high < 0 ? out.subarray(0, n) : undefined
}

function u16be(raw: Uint8Array, at: number): number {
  return (((raw[at] as number) << 8) | (raw[at + 1] as number)) & 0xffff
}

/** POSIX path from a classic Mac alias record, version 2. */
function aliasPosixPath(raw: Uint8Array): string {
  if (raw.length < 150 || u16be(raw, 6) !== 2) return ''
  const tags = new Map<number, Uint8Array>()
  let pos = 150
  while (pos + 4 <= raw.length) {
    const tag = (u16be(raw, pos) << 16) >> 16
    const length = u16be(raw, pos + 2)
    if (tag === -1) break
    tags.set(tag, raw.subarray(pos + 4, pos + 4 + length))
    pos += 4 + length + (length & 1)
  }
  const posix = tags.get(0x12)
  if (posix) {
    const rel = utf8.decode(posix).replace(/^\/+/, '')
    const mountBytes = tags.get(0x13)
    const mount = (mountBytes ? utf8.decode(mountBytes) : '/') || '/'
    return `${mount.replace(/\/+$/, '')}/${rel}`
  }
  const hfs = tags.get(2)
  if (hfs) {
    let text = ''
    for (const b of hfs)
      text += b < 0x80 ? String.fromCharCode(b) : (MAC_ROMAN_HIGH[b - 0x80] as string)
    return `/${text.split(':').slice(1).join('/')}`
  }
  return ''
}
