import { norm } from './compat.js'
import { readSqliteTable } from './sqlite-file.js'

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

/** Live's remap table from the bytes of `filerefmap.db` (a SQLite file, read without SQLite). */
export function parseRemapTable(db: Uint8Array): RemapTable {
  const text = (value: unknown) => (value === null || value === undefined ? '' : String(value))
  const mapping = new Map<string, readonly [number, string, string]>()
  const samples = readSqliteTable(db, 'sample_mapping')
  if (samples) {
    const [srcType, srcPack, srcRef, dstType, dstPack, dstRef] = [
      'src_type',
      'src_packid',
      'src_ref',
      'dst_type',
      'dst_packid',
      'dst_ref',
    ].map((name) => samples.columns.indexOf(name)) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ]
    for (const row of samples.rows) {
      mapping.set(remapKey(Number(row[srcType]), text(row[srcPack]), text(row[srcRef])), [
        Number(row[dstType]),
        text(row[dstPack]),
        text(row[dstRef]),
      ])
    }
  }
  const packNames = new Map<string, string>()
  const packs = readSqliteTable(db, 'pack_names')
  if (packs) {
    const id = packs.columns.indexOf('packid')
    const name = packs.columns.indexOf('packname')
    for (const row of packs.rows) packNames.set(text(row[id]), text(row[name]))
  }
  return { mapping, packNames }
}
