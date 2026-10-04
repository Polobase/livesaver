/**
 * Live's plug-in database (`Live-plugins-*.db`), read from the file itself: the rows the
 * inventory and the upgrade need, where no SQLite is at hand (a browser). Live keeps the
 * database open in WAL mode while it runs, so what it scanned last may still be in the file
 * beside it (`-wal`), which is read with it.
 */
import { readSqliteTable, type SqliteTable, type SqlValue } from '@livesaver/core'
import type { DbModule, DbPlugin } from './inventory.js'

export interface PluginDatabase {
  /** The enabled plug-ins, each with the module it was scanned from. */
  readonly plugins: DbPlugin[]
  readonly modules: DbModule[]
}

const text = (value: SqlValue | undefined) =>
  value === null || value === undefined ? null : String(value)
const number = (value: SqlValue | undefined) =>
  typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : null
/** What SQL takes for true in a `WHERE`: a number that is not zero. */
const truthy = (value: SqlValue | undefined) =>
  value !== null && value !== undefined && Number(value) !== 0 && !Number.isNaN(Number(value))

/** A table's rows by the names of its columns (a column it does not have reads as NULL). */
function reader(table: SqliteTable | undefined) {
  const at = new Map(table?.columns.map((name, i) => [name.toLowerCase(), i]) ?? [])
  return {
    rows: table?.rows ?? [],
    value: (row: readonly SqlValue[], column: string) => row[at.get(column) ?? -1],
  }
}

/**
 * The rows of one database file, as these queries give them:
 * `SELECT p.dev_identifier, p.name, m.path, m.processor FROM plugins p LEFT JOIN plugin_modules m
 * ON p.module_id = m.module_id WHERE p.enabled`, and `SELECT path, processor, scanstate FROM
 * plugin_modules`. `wal`: the file `<name>-wal` beside the database, if there is one.
 */
export function parsePluginDatabase(db: Uint8Array, wal?: Uint8Array): PluginDatabase {
  const modules = reader(readSqliteTable(db, 'plugin_modules', wal))
  const plugins = reader(readSqliteTable(db, 'plugins', wal))
  const byId = new Map<SqlValue, readonly SqlValue[]>()
  for (const row of modules.rows) {
    const id = modules.value(row, 'module_id')
    if (id !== null && id !== undefined && !byId.has(id)) byId.set(id, row)
  }
  return {
    plugins: plugins.rows
      .filter((row) => truthy(plugins.value(row, 'enabled')))
      .map((row) => {
        const id = plugins.value(row, 'module_id')
        const module = id === null || id === undefined ? undefined : byId.get(id)
        return {
          devIdentifier: text(plugins.value(row, 'dev_identifier')),
          name: text(plugins.value(row, 'name')),
          path: module ? text(modules.value(module, 'path')) : null,
          processor: module ? number(modules.value(module, 'processor')) : null,
        }
      }),
    modules: modules.rows.map((row) => ({
      path: text(modules.value(row, 'path')),
      processor: number(modules.value(row, 'processor')),
      scanstate: number(modules.value(row, 'scanstate')),
    })),
  }
}
