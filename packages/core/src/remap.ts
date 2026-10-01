import { norm } from './compat.js'

/**
 * Live's own table of moved library files (`<Live.app>/Contents/App-Resources/Database/filerefmap.db`),
 * e.g. Max devices of the Live 10 Core Library that are built into Live since version 11.
 */
export interface RemapTable {
  /** `remapKey(type, packId, ref)` → [dstType, dstPackId, dstRef]. */
  readonly mapping: ReadonlyMap<string, readonly [number, string, string]>
  /** Pack id → pack name. */
  readonly packNames: ReadonlyMap<string, string>
}

export const EMPTY_REMAP: RemapTable = { mapping: new Map(), packNames: new Map() }

/** Lookup key: (RelativePathType, LivePackId, norm(RelativePath)). */
export function remapKey(type: number, packId: string, ref: string): string {
  return `${type}\u0000${packId}\u0000${norm(ref)}`
}

/** Follow at most this many remap steps (Live 10 Expression Control → Live 11 → "… Legacy"). */
export const MAX_REMAP_STEPS = 5
