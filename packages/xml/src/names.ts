import { decodeUtf8, encodeUtf8 } from './text.js'

export const FNV_OFFSET = 0x811c9dc5 | 0
export const FNV_PRIME = 0x01000193

/** FNV-1a over `bytes[start, end)`, the same hash the scanner computes inline. */
export function hashBytes(bytes: Uint8Array, start: number, end: number): number {
  let h = FNV_OFFSET
  for (let i = start; i < end; i++) h = Math.imul(h ^ (bytes[i] as number), FNV_PRIME)
  return h
}

/**
 * Interned element and attribute names. Live files use a few thousand distinct names, so every
 * name is decoded once and elements store a small integer id instead.
 */
export class NameTable {
  readonly names: string[] = []
  private readonly raw: Uint8Array[] = []
  private readonly byHash = new Map<number, number | number[]>()

  get size(): number {
    return this.names.length
  }

  /** Id of the name in `src[start, end)` whose FNV-1a hash is `hash`; adds it if new. */
  intern(hash: number, src: Uint8Array, start: number, end: number): number {
    const hit = this.byHash.get(hash)
    if (hit !== undefined) {
      if (typeof hit === 'number') {
        if (this.equals(hit, src, start, end)) return hit
      } else {
        for (const id of hit) if (this.equals(id, src, start, end)) return id
      }
    }
    const id = this.names.length
    const copy = src.slice(start, end)
    this.raw.push(copy)
    this.names.push(decodeUtf8(copy))
    if (hit === undefined) this.byHash.set(hash, id)
    else if (typeof hit === 'number') this.byHash.set(hash, [hit, id])
    else hit.push(id)
    return id
  }

  /** Id of `name`, or -1 if no element or attribute in the document has that name. */
  lookup(name: string): number {
    const bytes = encodeUtf8(name)
    const hit = this.byHash.get(hashBytes(bytes, 0, bytes.length))
    if (hit === undefined) return -1
    if (typeof hit === 'number') return this.equals(hit, bytes, 0, bytes.length) ? hit : -1
    for (const id of hit) if (this.equals(id, bytes, 0, bytes.length)) return id
    return -1
  }

  /** Whether name `id` has exactly the bytes `src[start, end)`. */
  equals(id: number, src: Uint8Array, start: number, end: number): boolean {
    const raw = this.raw[id]
    if (raw === undefined || raw.length !== end - start) return false
    for (let i = 0; i < raw.length; i++) if (raw[i] !== src[start + i]) return false
    return true
  }
}
