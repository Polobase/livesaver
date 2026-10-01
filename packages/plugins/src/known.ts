/**
 * Plug-ins whose VST2 → VST3 conversion was checked against a Set in which Live itself saved each
 * plug-in once as VST2 and once as VST3 (fixtures/projects/VST2toVST3 Project). Keyed by VST2 id.
 */

export interface Known {
  readonly name: string
  /** Fixed VST3 class id (32 hex digits); undefined = derived from the VST2 id. */
  readonly vst3Uid?: string
  /** VST2 chunk → VST3 processor state; undefined = the chunk unchanged. */
  readonly wrap?: (chunk: Uint8Array) => Uint8Array
  /** VST3 parameter ids equal the VST2 parameter indices (checked with automation). */
  readonly idsVerified?: boolean
}

/** Omnisphere's VST3 state: a 24-byte header, the VST2 chunk (patch XML) and 4 zero bytes. */
export function omnisphereState(chunk: Uint8Array): Uint8Array {
  const out = new Uint8Array(24 + chunk.length + 4)
  const view = new DataView(out.buffer)
  view.setUint32(0, 999999999, true)
  view.setUint32(4, 0, true)
  view.setUint32(8, 1, true)
  view.setUint32(12, 0, true)
  view.setBigUint64(16, BigInt(chunk.length), true)
  out.set(chunk, 24)
  return out
}

export const KNOWN: ReadonlyMap<number, Known> = new Map<number, Known>([
  [1315523937, { name: 'Massive', idsVerified: true }], // 'NiMa'
  [1483109208, { name: 'Serum' }], // 'XfsX'
  [
    1097687666, // 'Ambr'
    { name: 'Omnisphere', vst3Uid: '84e8de5f9255222296fae4133c935a18', wrap: omnisphereState },
  ],
])
