/** Run `find` queries against the catalog. */
import type { SqlValue } from '@livesaver/core'
import type { Catalog } from './catalog.js'
import { compileQuery, QueryError, SORTS } from './query.js'

export interface FoundSet {
  readonly path: string
  readonly project: string
  readonly name: string
  readonly stage: string
  readonly seconds: number
  readonly tempo: number
  readonly signature: string
  readonly live: string
  readonly tracks: number
  readonly plugins: number
  readonly missingSamples: number
  readonly missingDevices: number
  readonly missingPlugins: number
  readonly rosettaPlugins: number
  readonly error: string
  /** Modification time, seconds since 1970. */
  readonly mtime: number
}

export interface SearchOptions {
  /** path, name, project, modified, length, bpm, stage (default: project). */
  readonly sort?: string
  readonly limit?: number
}

const num = (v: SqlValue | undefined) => Number(v ?? 0)
const str = (v: SqlValue | undefined) => (v === null || v === undefined ? '' : String(v))

/** Sets matching a `find` query. */
export function searchCatalog(
  catalog: Catalog,
  query: string,
  options: SearchOptions = {},
): FoundSet[] {
  const { where, params } = compileQuery(query)
  const order = SORTS[options.sort ?? 'project']
  if (!order)
    throw new QueryError(`unknown sort “${options.sort}” (${Object.keys(SORTS).join(', ')})`)
  const limit = options.limit && options.limit > 0 ? ` LIMIT ${Math.floor(options.limit)}` : ''
  const rows = catalog.db.all(
    `SELECT s.*, (SELECT count(*) FROM set_plugins p WHERE p.set_id = s.id) AS plugin_count
     FROM sets s WHERE ${where} ORDER BY ${order}${limit}`,
    params,
  )
  return rows.map((r) => ({
    path: str(r.path),
    project: str(r.project),
    name: str(r.name),
    stage: str(r.stage),
    seconds: num(r.seconds),
    tempo: num(r.tempo),
    signature: str(r.signature),
    live: str(r.live),
    tracks: num(r.tracks),
    plugins: num(r.plugin_count),
    missingSamples: num(r.missing_samples),
    missingDevices: num(r.missing_devices),
    missingPlugins: num(r.missing_plugins),
    rosettaPlugins: num(r.rosetta_plugins),
    error: str(r.error),
    mtime: num(r.mtime),
  }))
}
