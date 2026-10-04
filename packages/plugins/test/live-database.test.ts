/** Live's plug-in database read from the file itself, checked against SQLite's own answers. */
import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from '@livesaver/test-kit'
import { addCatalogRows, type CatalogEntry, parsePluginDatabase } from '../src/index.js'

let tmp: { path: string; cleanup: () => void }
beforeEach(() => {
  tmp = tempDir()
})
afterEach(() => tmp.cleanup())

const PLUGINS =
  'SELECT p.dev_identifier, p.name, m.path, m.processor FROM plugins p ' +
  'LEFT JOIN plugin_modules m ON p.module_id = m.module_id WHERE p.enabled'
const MODULES = 'SELECT path, processor, scanstate FROM plugin_modules'

/** A database as Live keeps it, open (in WAL mode, with what it scanned last still in the log). */
function liveDatabase(fill: (db: Database) => void) {
  const path = join(tmp.path, 'Live-plugins-1.db')
  const db = new Database(path)
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA wal_autocheckpoint = 0')
  db.run(`CREATE TABLE plugin_modules (module_id INTEGER PRIMARY KEY, path TEXT, arch INTEGER,
    processor INTEGER, scanstate INTEGER, fingerprint TEXT)`)
  db.run(`CREATE TABLE plugins (plugin_id INTEGER PRIMARY KEY AUTOINCREMENT, module_id INTEGER,
    dev_identifier TEXT, name TEXT, vendor TEXT, version TEXT, sdk_version TEXT, flags INTEGER,
    scanstate INTEGER, subcategories TEXT, enabled INTEGER)`)
  fill(db)
  const read = {
    bytes: new Uint8Array(readFileSync(path)),
    wal: new Uint8Array(readFileSync(`${path}-wal`)),
    plugins: db.query(PLUGINS).all() as Record<string, unknown>[],
    modules: db.query(MODULES).all() as Record<string, unknown>[],
  }
  db.close()
  return read
}

const module = (db: Database, id: number | null, path: string, processor: number, state = 1) =>
  db.run('INSERT INTO plugin_modules VALUES (?, ?, 3, ?, ?, ?)', [
    id,
    path,
    processor,
    state,
    'a:b',
  ])
const plugin = (
  db: Database,
  moduleId: number | null,
  ident: string,
  name: string,
  enabled: unknown = 1,
) =>
  db.run(
    'INSERT INTO plugins (module_id, dev_identifier, name, vendor, enabled) VALUES (?, ?, ?, ?, ?)',
    [moduleId, ident, name, 'Vendor', enabled as number],
  )

test('the rows the inventory needs are those SQLite gives, the log included', () => {
  const serum = '/Library/Audio/Plug-Ins/VST3/Serum.vst3'
  const { bytes, wal, plugins, modules } = liveDatabase((db) => {
    module(db, 1, serum, 2)
    module(db, 2, serum, 1)
    module(db, 7, '/Library/Audio/Plug-Ins/VST/Old.vst', 1, 3)
    plugin(db, 1, 'device:vst3:instr:56535458-6673-5873-6572-756d00000000', 'Serum')
    plugin(db, 2, 'device:vst3:instr:56535458-6673-5873-6572-756d00000000', 'Serum')
    plugin(db, 7, 'device:vst:instr:42?n=Old', 'Old', 0) // switched off in Live
    plugin(db, 7, 'device:vst:instr:43?n=Unset', 'Unset', null)
    plugin(db, 100000, 'device:vst:instr:44?n=Orphan', 'Orphan') // its module is gone
    plugin(db, null, 'device:vst:audiofx:45?n=No%20module', 'No module', 2)
    // A second scan, in a transaction of its own.
    db.transaction(() => {
      for (let i = 0; i < 300; i++) {
        module(db, null, `/Library/Audio/Plug-Ins/VST3/Vendor/Effect ${i}.vst3`, 1 + (i % 2))
        plugin(
          db,
          8 + i,
          `device:vst3:audiofx:${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`,
          `Effect ${i}`,
        )
      }
    })()
  })
  const read = parsePluginDatabase(bytes, wal)
  expect(read.plugins.length).toBe(304)
  expect(read.plugins).toEqual(
    plugins.map((row) => ({
      devIdentifier: row.dev_identifier as string,
      name: row.name as string,
      path: (row.path as string | null) ?? null,
      processor: (row.processor as number | null) ?? null,
    })),
  )
  expect(read.modules).toEqual(
    modules.map((row) => ({
      path: row.path as string,
      processor: row.processor as number,
      scanstate: row.scanstate as number,
    })),
  )
  expect(read.plugins.find((row) => row.name === 'Orphan')).toEqual({
    devIdentifier: 'device:vst:instr:44?n=Orphan',
    name: 'Orphan',
    path: null,
    processor: null,
  })
  // Without the log the file knows nothing yet: Live has not written it down.
  expect(parsePluginDatabase(bytes)).toEqual({ plugins: [], modules: [] })

  // The VST3 plug-ins Live knows, as an upgrade asks for them.
  const catalog = addCatalogRows(
    new Map<string, CatalogEntry>(),
    read.plugins.map((row) => ({ devIdentifier: row.devIdentifier ?? '', name: row.name ?? '' })),
  )
  expect(catalog.get('56535458667358736572756d00000000')?.name).toBe('Serum')
  expect(catalog.size).toBe(301)
})

test('a database of another kind, or none, is said or read as empty', () => {
  const other = join(tmp.path, 'other.db')
  const db = new Database(other)
  db.run('CREATE TABLE files (file_id INTEGER PRIMARY KEY, name TEXT)')
  db.close()
  expect(parsePluginDatabase(new Uint8Array(readFileSync(other)))).toEqual({
    plugins: [],
    modules: [],
  })
  expect(() => parsePluginDatabase(new TextEncoder().encode('not a database'.repeat(20)))).toThrow(
    'not a SQLite database',
  )
})
