/**
 * Live's plug-in database (`~/Library/Application Support/Ableton/Live Database/Live-plugins-*.db`)
 * and the system's Audio Units. Live keeps the database open in WAL mode, so it is never opened in
 * place: the `.db` and its `-wal`/`-shm` files are copied to a temp folder and the copy is read.
 */
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FsRead } from '@livesaver/core'
import {
  type AuComponent,
  addCatalogRows,
  type Catalog,
  type CatalogEntry,
  type DbModule,
  type DbPlugin,
  type Inventory,
  loadInventory,
  parseAuval,
} from '@livesaver/plugins'
import { NodeFs } from './host.js'
import { openReadonly, type ReadonlyDb } from './sqlite.js'
import { NodeFsWrite } from './write.js'

export const LIVE_DATABASE = join(
  homedir(),
  'Library',
  'Application Support',
  'Ableton',
  'Live Database',
)
export const PLUGIN_ROOTS: readonly string[] = [
  '/Library/Audio/Plug-Ins',
  join(homedir(), 'Library', 'Audio', 'Plug-Ins'),
]
export const SYSTEM_COMPONENTS = '/System/Library/Components'

/** Run `fn` on a private copy of a Live database file (with its WAL). */
export async function withLiveDatabase<T>(path: string, fn: (db: ReadonlyDb) => T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'livesaver-db-'))
  try {
    const copy = join(dir, 'live.db')
    copyFileSync(path, copy)
    for (const suffix of ['-wal', '-shm'])
      if (existsSync(path + suffix)) copyFileSync(path + suffix, copy + suffix)
    const db = await openReadonly(copy, { writable: true })
    try {
      return fn(db)
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Rows of `query` from a safe copy of a Live database file. */
export function queryLiveDatabase(path: string, query: string): Promise<Record<string, unknown>[]> {
  return withLiveDatabase(path, (db) => db.all(query))
}

/** The `Live-plugins-*.db` files of a folder, sorted. */
function databaseFiles(folder: string): string[] {
  try {
    return readdirSync(folder)
      .filter((f) => /^Live-plugins-.*\.db$/.test(f))
      .sort()
      .map((f) => join(folder, f))
  } catch {
    return []
  }
}

/** Installed VST3 plug-ins from Live's plug-in database: class id → entry. */
export async function readPluginCatalog(folder = LIVE_DATABASE): Promise<Catalog> {
  const catalog = new Map<string, CatalogEntry>()
  for (const file of databaseFiles(folder)) {
    try {
      const rows = await queryLiveDatabase(
        file,
        'SELECT dev_identifier, name FROM plugins WHERE enabled',
      )
      addCatalogRows(
        catalog,
        rows.map((r) => ({
          devIdentifier: String(r.dev_identifier ?? ''),
          name: String(r.name ?? ''),
        })),
      )
    } catch {}
  }
  return catalog
}

const str = (v: unknown) => (v === null || v === undefined ? null : String(v))
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : null)

/** All plug-in and module rows of Live's plug-in databases. */
export async function readLivePluginDatabase(
  folder = LIVE_DATABASE,
): Promise<{ plugins: DbPlugin[]; modules: DbModule[] }> {
  const plugins: DbPlugin[] = []
  const modules: DbModule[] = []
  for (const file of databaseFiles(folder)) {
    try {
      await withLiveDatabase(file, (db) => {
        const p = db.all(
          'SELECT p.dev_identifier, p.name, m.path, m.processor FROM plugins p ' +
            'LEFT JOIN plugin_modules m ON p.module_id = m.module_id WHERE p.enabled',
        )
        const m = db.all('SELECT path, processor, scanstate FROM plugin_modules')
        plugins.push(
          ...p.map((r) => ({
            devIdentifier: str(r.dev_identifier),
            name: str(r.name),
            path: str(r.path),
            processor: num(r.processor),
          })),
        )
        modules.push(
          ...m.map((r) => ({
            path: str(r.path),
            processor: num(r.processor),
            scanstate: num(r.scanstate),
          })),
        )
      })
    } catch {}
  }
  return { plugins, modules }
}

/** Output of `auval -a` ('' if it cannot run). */
export function runAuval(): Promise<string> {
  return new Promise((resolve) => {
    execFile('auval', ['-a'], { timeout: 300_000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) =>
      resolve(error && !stdout ? '' : stdout),
    )
  })
}

export interface AudioUnitsOptions {
  /** Remember the result until a component bundle changes. */
  readonly cachePath?: string
  readonly fs?: FsRead
  /** Produces the `auval -a` output (tests pass a fake). */
  readonly run?: () => Promise<string>
}

/**
 * All registered Audio Units per `auval -a` (slow), cached until a component bundle changes.
 */
export async function registeredAudioUnits(
  components: readonly string[],
  options: AudioUnitsOptions = {},
): Promise<AuComponent[]> {
  const fs = options.fs ?? new NodeFs()
  let newest = 0n
  for (const c of components) {
    const s = await fs.stat(c)
    if (s && s.mtimeNs > newest) newest = s.mtimeNs
  }
  const stamp = `${components.length}:${newest}`
  const cachePath = options.cachePath
  if (cachePath) {
    try {
      const data = JSON.parse(readFileSync(cachePath, 'utf8')) as {
        stamp?: string
        units?: AuComponent[]
      }
      if (data.stamp === stamp && Array.isArray(data.units)) return data.units
    } catch {}
  }
  const units = parseAuval(await (options.run ?? runAuval)())
  if (cachePath && units.length)
    await new NodeFsWrite().writeFile(cachePath, JSON.stringify({ stamp, units }))
  return units
}

export interface InstalledPluginsOptions {
  readonly database?: string
  readonly pluginRoots?: readonly string[]
  readonly systemComponents?: string
  /** Ask `auval -a` for all registered Audio Units (default true). */
  readonly auval?: boolean
  readonly auvalCache?: string
}

/** The plug-ins installed on this Mac (Live's database, Audio Units, unscanned bundles). */
export async function loadInstalledPlugins(
  options: InstalledPluginsOptions = {},
): Promise<Inventory> {
  const fs = new NodeFs()
  const database = await readLivePluginDatabase(options.database ?? LIVE_DATABASE)
  return loadInventory(fs, {
    database,
    pluginRoots: options.pluginRoots ?? PLUGIN_ROOTS,
    systemComponents: options.systemComponents ?? SYSTEM_COMPONENTS,
    ...(options.auval === false
      ? {}
      : {
          registeredAudioUnits: (components: readonly string[]) =>
            registeredAudioUnits(components, {
              fs,
              ...(options.auvalCache ? { cachePath: options.auvalCache } : {}),
            }),
        }),
  })
}
