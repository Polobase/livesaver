/**
 * The catalog: one row per Live Set with its measurements, plus the plug-ins and sample references
 * it uses, in SQLite with a full-text index. Every value needed to answer `find` is stored, so
 * searching never opens a set. Text that is matched is also stored normalized (NFC, case-folded),
 * because SQLite's own case-insensitive comparison only knows ASCII.
 */
import { norm, type SqlDatabase, type SqlValue } from '@livesaver/core'

export const SCHEMA_VERSION = 1

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sets (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  path_key TEXT NOT NULL,
  project TEXT NOT NULL,
  project_key TEXT NOT NULL,
  is_project INTEGER NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  mtime_ns TEXT NOT NULL,
  ctime_ns TEXT NOT NULL,
  ino TEXT NOT NULL,
  dev TEXT NOT NULL,
  error TEXT NOT NULL,
  creator TEXT NOT NULL,
  live TEXT NOT NULL,
  major INTEGER NOT NULL,
  tempo REAL NOT NULL,
  signature TEXT NOT NULL,
  length_beats REAL NOT NULL,
  seconds REAL NOT NULL,
  bars REAL NOT NULL,
  start_bar INTEGER NOT NULL,
  tracks INTEGER NOT NULL,
  audio_tracks INTEGER NOT NULL,
  midi_tracks INTEGER NOT NULL,
  group_tracks INTEGER NOT NULL,
  return_tracks INTEGER NOT NULL,
  named_tracks INTEGER NOT NULL,
  arrangement_clips INTEGER NOT NULL,
  arrangement_tracks INTEGER NOT NULL,
  session_clips INTEGER NOT NULL,
  scenes INTEGER NOT NULL,
  scenes_used INTEGER NOT NULL,
  blocks INTEGER NOT NULL,
  distinct_blocks INTEGER NOT NULL,
  automated INTEGER NOT NULL,
  locators TEXT NOT NULL,
  master_devices TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  stage TEXT NOT NULL,
  missing_samples INTEGER NOT NULL,
  missing_devices INTEGER NOT NULL,
  missing_plugins INTEGER NOT NULL,
  rosetta_plugins INTEGER NOT NULL,
  indexed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sets_project ON sets(project_key);
CREATE INDEX IF NOT EXISTS sets_content ON sets(content_hash);
CREATE TABLE IF NOT EXISTS set_plugins (
  set_id INTEGER NOT NULL,
  format TEXT NOT NULL,
  ident TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  instances INTEGER NOT NULL,
  state TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS set_plugins_set ON set_plugins(set_id);
CREATE INDEX IF NOT EXISTS set_plugins_key ON set_plugins(format, ident);
-- Every distinct reference once; sets link to it with the file it resolves to from there.
CREATE TABLE IF NOT EXISTS refs (
  id INTEGER PRIMARY KEY,
  ref_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  rel_type INTEGER NOT NULL,
  rel_path TEXT NOT NULL,
  path TEXT NOT NULL,
  hint_path TEXT NOT NULL,
  pack_name TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  size INTEGER NOT NULL,
  crc INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS refs_name ON refs(name_key);
CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS set_refs (
  set_id INTEGER NOT NULL,
  ref_id INTEGER NOT NULL,
  -- the file it resolves to; NULL = missing
  file_id INTEGER
);
CREATE INDEX IF NOT EXISTS set_refs_set ON set_refs(set_id);
CREATE INDEX IF NOT EXISTS set_refs_ref ON set_refs(ref_id);
CREATE VIRTUAL TABLE IF NOT EXISTS sets_fts USING fts5(
  name, project, plugins, samples, locators, tokenize = 'unicode61 remove_diacritics 2'
);
`

/** A sample or Max device reference, as much as is needed to resolve it again. */
export interface StoredRef {
  readonly kind: 'sample' | 'device'
  readonly name: string
  /** The reference's identity (`FileRef.key`): one row per distinct reference. */
  readonly key: string
  readonly relType: number
  readonly relPath: string
  readonly path: string
  readonly hintPath: string
  readonly packName: string
  readonly packId: string
  readonly size: number
  readonly crc: number
  /** The file it resolves to ('' = missing). */
  resolved: string
  /** Row of the set's link to it (when read from the catalog). */
  readonly link?: number
}

export interface StoredPlugin {
  readonly format: string
  readonly ident: string
  readonly name: string
  readonly instances: number
  /** installed | rosetta | missing */
  state: string
}

/** The file's identity: a set whose identity is unchanged is not read again. */
export interface SetIdentity {
  readonly size: number
  readonly mtimeNs: string
  readonly ctimeNs: string
  readonly ino: string
  readonly dev: string
}

export interface SetRecord extends SetIdentity {
  readonly path: string
  readonly project: string
  readonly isProject: boolean
  readonly name: string
  readonly mtime: number
  readonly error: string
  readonly creator: string
  readonly live: string
  readonly major: number
  readonly tempo: number
  readonly signature: string
  readonly lengthBeats: number
  readonly seconds: number
  readonly bars: number
  readonly startBar: number
  readonly tracks: number
  readonly audioTracks: number
  readonly midiTracks: number
  readonly groupTracks: number
  readonly returnTracks: number
  readonly namedTracks: number
  readonly arrangementClips: number
  readonly arrangementTracks: number
  readonly sessionClips: number
  readonly scenes: number
  readonly scenesUsed: number
  readonly blocks: number
  readonly distinctBlocks: number
  readonly automated: number
  readonly locators: readonly string[]
  readonly masterDevices: readonly string[]
  readonly contentHash: string
  /** empty | session | sketch | arranged | elaborated | error */
  readonly stage: string
  readonly plugins: readonly StoredPlugin[]
  readonly refs: readonly StoredRef[]
}

/** Counts derived from a set's references and plug-ins. */
export function missingCounts(refs: readonly StoredRef[], plugins: readonly StoredPlugin[]) {
  return {
    missingSamples: refs.filter((r) => r.kind === 'sample' && !r.resolved).length,
    missingDevices: refs.filter((r) => r.kind === 'device' && !r.resolved).length,
    missingPlugins: plugins.filter((p) => p.state === 'missing').length,
    rosettaPlugins: plugins.filter((p) => p.state === 'rosetta').length,
  }
}

const num = (v: SqlValue | undefined) => Number(v ?? 0)
const str = (v: SqlValue | undefined) => (v === null || v === undefined ? '' : String(v))

export class Catalog {
  readonly db: SqlDatabase

  constructor(db: SqlDatabase) {
    this.db = db
    db.exec(SCHEMA)
    const version = db.all("SELECT value FROM meta WHERE key = 'schema'")[0]?.value
    if (version === undefined)
      db.run("INSERT INTO meta VALUES ('schema', ?)", [String(SCHEMA_VERSION)])
    else if (Number(version) !== SCHEMA_VERSION)
      throw new Error(
        `catalog schema ${version} is not supported (expected ${SCHEMA_VERSION}); delete it to rebuild`,
      )
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const out = fn()
      this.db.exec('COMMIT')
      return out
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Identity of every set stored below `roots` (all sets without roots). */
  identities(roots: readonly string[] = []): Map<string, SetIdentity & { id: number }> {
    const out = new Map<string, SetIdentity & { id: number }>()
    for (const r of this.db.all('SELECT id, path, size, mtime_ns, ctime_ns, ino, dev FROM sets')) {
      const path = str(r.path)
      if (roots.length && !roots.some((root) => isBelow(path, root))) continue
      out.set(path, {
        id: num(r.id),
        size: num(r.size),
        mtimeNs: str(r.mtime_ns),
        ctimeNs: str(r.ctime_ns),
        ino: str(r.ino),
        dev: str(r.dev),
      })
    }
    return out
  }

  /** Store a set (replacing what was stored for its path). */
  put(record: SetRecord, now = new Date()): number {
    this.remove(record.path)
    const counts = missingCounts(record.refs, record.plugins)
    const values: SqlValue[] = [
      record.path,
      norm(record.path),
      record.project,
      norm(record.project),
      record.isProject ? 1 : 0,
      record.name,
      norm(record.name),
      record.size,
      record.mtime,
      record.mtimeNs,
      record.ctimeNs,
      record.ino,
      record.dev,
      record.error,
      record.creator,
      record.live,
      record.major,
      record.tempo,
      record.signature,
      record.lengthBeats,
      record.seconds,
      record.bars,
      record.startBar,
      record.tracks,
      record.audioTracks,
      record.midiTracks,
      record.groupTracks,
      record.returnTracks,
      record.namedTracks,
      record.arrangementClips,
      record.arrangementTracks,
      record.sessionClips,
      record.scenes,
      record.scenesUsed,
      record.blocks,
      record.distinctBlocks,
      record.automated,
      JSON.stringify(record.locators),
      JSON.stringify(record.masterDevices),
      record.contentHash,
      record.stage,
      counts.missingSamples,
      counts.missingDevices,
      counts.missingPlugins,
      counts.rosettaPlugins,
      now.toISOString(),
    ]
    const { lastInsertRowid: id } = this.db.run(
      `INSERT INTO sets (path, path_key, project, project_key, is_project, name, name_key, size, mtime,
        mtime_ns, ctime_ns, ino, dev, error, creator, live, major, tempo, signature, length_beats, seconds,
        bars, start_bar, tracks, audio_tracks, midi_tracks, group_tracks, return_tracks, named_tracks,
        arrangement_clips, arrangement_tracks, session_clips, scenes, scenes_used, blocks, distinct_blocks,
        automated, locators, master_devices, content_hash, stage, missing_samples, missing_devices,
        missing_plugins, rosetta_plugins, indexed_at)
       VALUES (${values.map(() => '?').join(', ')})`,
      values,
    )
    for (const p of record.plugins) {
      this.db.run(
        'INSERT INTO set_plugins (set_id, format, ident, name, name_key, instances, state) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, p.format, p.ident, p.name, norm(p.name), p.instances, p.state],
      )
    }
    for (const r of record.refs) {
      this.db.run('INSERT INTO set_refs (set_id, ref_id, file_id) VALUES (?, ?, ?)', [
        id,
        this.refId(r),
        this.fileId(r.resolved),
      ])
    }
    this.db.run(
      'INSERT INTO sets_fts (rowid, name, project, plugins, samples, locators) VALUES (?, ?, ?, ?, ?, ?)',
      [
        id,
        record.name,
        record.project.split('/').at(-1) ?? '',
        [...new Set(record.plugins.map((p) => p.name))].join(' '),
        [...new Set(record.refs.map((r) => r.name))].join(' '),
        record.locators.join(' '),
      ],
    )
    return id
  }

  private refId(r: StoredRef): number {
    const hit = this.db.all('SELECT id FROM refs WHERE ref_key = ?', [r.key])[0]
    if (hit) return num(hit.id)
    return this.db.run(
      `INSERT INTO refs (ref_key, kind, name, name_key, rel_type, rel_path, path, hint_path, pack_name,
        pack_id, size, crc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        r.key,
        r.kind,
        r.name,
        norm(r.name),
        r.relType,
        r.relPath,
        r.path,
        r.hintPath,
        r.packName,
        r.packId,
        r.size,
        r.crc,
      ],
    ).lastInsertRowid
  }

  private fileId(path: string): number | null {
    if (!path) return null
    const hit = this.db.all('SELECT id FROM files WHERE path = ?', [path])[0]
    if (hit) return num(hit.id)
    return this.db.run('INSERT INTO files (path) VALUES (?)', [path]).lastInsertRowid
  }

  remove(path: string): void {
    const row = this.db.all('SELECT id FROM sets WHERE path = ?', [path])[0]
    if (!row) return
    const id = num(row.id)
    this.db.run('DELETE FROM set_plugins WHERE set_id = ?', [id])
    this.db.run('DELETE FROM set_refs WHERE set_id = ?', [id])
    this.db.run('DELETE FROM sets_fts WHERE rowid = ?', [id])
    this.db.run('DELETE FROM sets WHERE id = ?', [id])
  }

  refs(id: number): StoredRef[] {
    return this.db
      .all(
        `SELECT l.rowid AS link, r.kind, r.name, r.ref_key, r.rel_type, r.rel_path, r.path, r.hint_path,
           r.pack_name, r.pack_id, r.size, r.crc, f.path AS resolved
         FROM set_refs l JOIN refs r ON r.id = l.ref_id LEFT JOIN files f ON f.id = l.file_id
         WHERE l.set_id = ?`,
        [id],
      )
      .map((r) => ({
        link: num(r.link),
        kind: str(r.kind) === 'device' ? 'device' : 'sample',
        name: str(r.name),
        key: str(r.ref_key),
        relType: num(r.rel_type),
        relPath: str(r.rel_path),
        path: str(r.path),
        hintPath: str(r.hint_path),
        packName: str(r.pack_name),
        packId: str(r.pack_id),
        size: num(r.size),
        crc: num(r.crc),
        resolved: str(r.resolved),
      }))
  }

  plugins(id: number): StoredPlugin[] {
    return this.db
      .all('SELECT format, ident, name, instances, state FROM set_plugins WHERE set_id = ?', [id])
      .map((r) => ({
        format: str(r.format),
        ident: str(r.ident),
        name: str(r.name),
        instances: num(r.instances),
        state: str(r.state),
      }))
  }

  /**
   * Store re-checked references and plug-in states of an unchanged set; `before` are the values read
   * from the catalog, so only what changed is written.
   */
  refresh(
    id: number,
    refs: readonly StoredRef[],
    plugins: readonly StoredPlugin[],
    before?: { readonly refs: readonly string[]; readonly plugins: readonly string[] },
  ): void {
    let changed = !before
    for (const [i, r] of refs.entries()) {
      if (before && before.refs[i] === r.resolved) continue
      changed = true
      if (r.link !== undefined)
        this.db.run('UPDATE set_refs SET file_id = ? WHERE rowid = ?', [
          this.fileId(r.resolved),
          r.link,
        ])
    }
    for (const [i, p] of plugins.entries()) {
      if (before && before.plugins[i] === p.state) continue
      changed = true
      this.db.run(
        'UPDATE set_plugins SET state = ? WHERE set_id = ? AND format = ? AND ident = ? AND name = ?',
        [p.state, id, p.format, p.ident, p.name],
      )
    }
    if (!changed) return
    const c = missingCounts(refs, plugins)
    this.db.run(
      'UPDATE sets SET missing_samples = ?, missing_devices = ?, missing_plugins = ?, rosetta_plugins = ? WHERE id = ?',
      [c.missingSamples, c.missingDevices, c.missingPlugins, c.rosettaPlugins, id],
    )
  }

  /** Drop references and files no set links to any more. */
  prune(): void {
    this.db.exec(`
      DELETE FROM refs WHERE id NOT IN (SELECT ref_id FROM set_refs);
      DELETE FROM files WHERE id NOT IN (SELECT file_id FROM set_refs WHERE file_id IS NOT NULL);
    `)
  }

  stats(): { sets: number; projects: number; plugins: number; samples: number } {
    const one = (sql: string) => num(this.db.all(sql)[0]?.n)
    return {
      sets: one('SELECT count(*) AS n FROM sets'),
      projects: one('SELECT count(DISTINCT project) AS n FROM sets'),
      plugins: one('SELECT count(*) AS n FROM (SELECT DISTINCT format, ident FROM set_plugins)'),
      samples: one('SELECT count(*) AS n FROM refs'),
    }
  }
}

/** `path` is `root` or lies below it (case-insensitive like macOS). */
export function isBelow(path: string, root: string): boolean {
  const p = norm(path)
  const r = norm(root).replace(/\/+$/, '')
  return p === r || p.startsWith(`${r}/`)
}
