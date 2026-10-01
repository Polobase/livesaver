/**
 * CPU architectures of a Mach-O binary (thin or universal), from its first bytes: whether a plug-in
 * runs natively on Apple Silicon or only under Rosetta.
 */

const CPU_TYPES: ReadonlyMap<number, string> = new Map([
  [7, 'i386'],
  [0x01000007, 'x86_64'],
  [12, 'arm'],
  [0x0100000c, 'arm64'],
  [18, 'ppc'],
  [0x01000012, 'ppc64'],
])

/** How many bytes `machoArchs` looks at. */
export const MACHO_HEAD_BYTES = 4096

/** Python's `int.from_bytes(head[start:end], order)` (a short slice gives a smaller number). */
function fromBytes(head: Uint8Array, start: number, end: number, little: boolean): number {
  const bytes = head.subarray(Math.min(start, head.length), Math.min(end, head.length))
  let n = 0
  if (little) for (let i = bytes.length - 1; i >= 0; i--) n = n * 256 + (bytes[i] as number)
  else for (const b of bytes) n = n * 256 + b
  return n
}

const cpu = (type: number) => CPU_TYPES.get(type) ?? '?'

/** Architectures ("arm64", "x86_64", …; "?" for unknown CPU types) of the binary starting with `head`. */
export function machoArchs(head: Uint8Array): Set<string> {
  const m = [head[0], head[1], head[2], head[3]]
  if (m[0] === 0xca && m[1] === 0xfe && m[2] === 0xba && (m[3] === 0xbe || m[3] === 0xbf)) {
    const count = fromBytes(head, 4, 8, false)
    const size = m[3] === 0xbe ? 20 : 32
    if (!(count > 0 && count < 20)) return new Set() // Java class files share the magic number
    const out = new Set<string>()
    for (let i = 0; i < count; i++)
      out.add(cpu(fromBytes(head, 8 + i * size, 12 + i * size, false)))
    return out
  }
  if ((m[0] === 0xcf || m[0] === 0xce) && m[1] === 0xfa && m[2] === 0xed && m[3] === 0xfe)
    return new Set([cpu(fromBytes(head, 4, 8, true))])
  if (m[0] === 0xfe && m[1] === 0xed && m[2] === 0xfa && (m[3] === 0xcf || m[3] === 0xce))
    return new Set([cpu(fromBytes(head, 4, 8, false))])
  return new Set()
}
