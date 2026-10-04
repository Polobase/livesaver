/** Reading tables straight from a SQLite file, checked against SQLite itself. */
import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from '@livesaver/test-kit'
import { parseRemapTable, readSqliteTable, remapKey, SqliteFormatError } from '../src/index.js'

let tmp: { path: string; cleanup: () => void }
beforeEach(() => {
  tmp = tempDir()
})
afterEach(() => tmp.cleanup())

let files = 0

/** A database file made by SQLite, and what SQLite itself reads from `table`. */
function database(setup: (db: Database) => void, table: string, pageSize = 4096) {
  const path = join(tmp.path, `test-${files++}.db`)
  const db = new Database(path)
  db.run(`PRAGMA page_size = ${pageSize}`)
  setup(db)
  const expected = db.query(`SELECT * FROM "${table}"`).values()
  db.close()
  return { bytes: new Uint8Array(readFileSync(path)), expected }
}

describe('reading a SQLite file', () => {
  test('every kind of value', () => {
    const { bytes, expected } = database((db) => {
      db.run('CREATE TABLE things (a, b, c, d, e)')
      const insert = db.prepare('INSERT INTO things VALUES (?, ?, ?, ?, ?)')
      insert.run(0, 1, -1, null, 'text')
      insert.run(127, -128, 32767, -32768, 'café ★')
      insert.run(8388607, -8388608, 2147483647, -2147483648, '')
      insert.run(
        140737488355327,
        -140737488355328,
        9007199254740991,
        1.5,
        new Uint8Array([0, 255, 7]),
      )
      insert.run(Number.MIN_SAFE_INTEGER, 0.1, -0.0, 1e300, new Uint8Array(0))
    }, 'things')
    const table = readSqliteTable(bytes, 'things')
    expect(table?.columns).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(table?.rows).toEqual(expected as never)
  })

  test('many rows (pages below pages) and long values (overflow pages)', () => {
    for (const pageSize of [512, 4096, 65536]) {
      const { bytes, expected } = database(
        (db) => {
          db.run('CREATE TABLE refs (id int not null, "the path" varchar, [size] int)')
          const insert = db.prepare('INSERT INTO refs VALUES (?, ?, ?)')
          db.transaction(() => {
            for (let i = 0; i < 5000; i++)
              insert.run(i, `Samples/Drums/Kick ${i}.wav`.repeat(i % 97 === 0 ? 400 : 1), i * i)
          })()
          db.run('DELETE FROM refs WHERE id % 7 = 3')
        },
        'refs',
        pageSize,
      )
      const table = readSqliteTable(bytes, 'refs')
      expect(table?.columns).toEqual(['id', 'the path', 'size'])
      expect(table?.rows.length).toBe(expected.length)
      expect(table?.rows).toEqual(expected as never)
    }
  })

  test('several tables, a missing one, and constraints that are no columns', () => {
    const { bytes } = database((db) => {
      db.run('CREATE TABLE a (x int, y text, PRIMARY KEY (x, y), UNIQUE (y), CHECK (x > 0))')
      db.run('CREATE TABLE b (k varchar not null, v varchar not null)')
      db.run('CREATE UNIQUE INDEX b_key ON b (k)')
      db.run("INSERT INTO a VALUES (1, 'one')")
      db.run("INSERT INTO b VALUES ('key', 'value')")
    }, 'b')
    expect(readSqliteTable(bytes, 'a')).toEqual({ columns: ['x', 'y'], rows: [[1, 'one']] })
    expect(readSqliteTable(bytes, 'b')?.rows).toEqual([['key', 'value']])
    expect(readSqliteTable(bytes, 'c')).toBeUndefined()
    expect(readSqliteTable(bytes, 'b_key')).toBeUndefined() // an index is no table
  })

  test('what it cannot read is refused, not misread', () => {
    expect(() =>
      readSqliteTable(new TextEncoder().encode('not a database'.repeat(20)), 'a'),
    ).toThrow(SqliteFormatError)
    const { bytes } = database((db) => {
      db.run('CREATE TABLE w (k text PRIMARY KEY, v text) WITHOUT ROWID')
      db.run("INSERT INTO w VALUES ('a', 'b')")
    }, 'w')
    expect(() => readSqliteTable(bytes, 'w')).toThrow('WITHOUT ROWID')
  })
})

describe('a column that is the id of its row', () => {
  test('is read from the id: its value is not stored in the row', () => {
    const path = join(tmp.path, 'ids.db')
    const db = new Database(path)
    db.run('CREATE TABLE modules (module_id INTEGER PRIMARY KEY, path TEXT, processor INTEGER)')
    db.run('CREATE TABLE auto (id INTEGER PRIMARY KEY AUTOINCREMENT, v)')
    db.run('CREATE TABLE named (name TEXT, "the id" INTEGER, PRIMARY KEY ("the id"))')
    // Not ids of their rows, by SQLite's rules: another type name, or a key that counts down.
    db.run('CREATE TABLE short (id INT PRIMARY KEY, v)')
    db.run('CREATE TABLE down (id INTEGER PRIMARY KEY DESC, v)')
    db.run('CREATE TABLE both (a INTEGER, b INTEGER, PRIMARY KEY (a, b))')
    db.run("INSERT INTO modules VALUES (7, '/Library/Audio/Plug-Ins/VST3/A.vst3', 2)")
    db.run("INSERT INTO modules VALUES (NULL, '/Library/Audio/Plug-Ins/VST3/B.vst3', 1)")
    db.run("INSERT INTO modules VALUES (-5, 'negative', NULL)")
    db.run("INSERT INTO modules VALUES (300000, 'large', NULL)")
    for (const table of ['auto', 'short', 'down'])
      for (const v of ['one', 'two', 'three']) db.run(`INSERT INTO ${table} (v) VALUES ('${v}')`)
    db.run("INSERT INTO named VALUES ('first', 40), ('second', 2)")
    db.run('INSERT INTO both VALUES (1, 2), (3, 4)')
    db.run('INSERT INTO short VALUES (12, 12)')
    db.run('INSERT INTO down VALUES (99, 99)')
    const expected = (table: string) => db.query(`SELECT * FROM ${table}`).values()
    const tables = ['modules', 'auto', 'named', 'short', 'down', 'both']
    const wanted = tables.map(expected)
    db.close()
    const bytes = new Uint8Array(readFileSync(path))
    expect(tables.map((table) => readSqliteTable(bytes, table)?.rows)).toEqual(wanted as never)
    expect(readSqliteTable(bytes, 'modules')?.rows.map((row) => row[0])).toEqual([-5, 7, 8, 300000])
    expect(readSqliteTable(bytes, 'named')?.columns).toEqual(['name', 'the id'])
  })

  test('also when it is larger than a number holds exactly', () => {
    const path = join(tmp.path, 'wide.db')
    const db = new Database(path)
    db.run('CREATE TABLE wide (id INTEGER PRIMARY KEY, v)')
    db.run(
      "INSERT INTO wide VALUES (9007199254740993, 'beyond'), (72057594037927935, 'eight bytes')",
    )
    db.run("INSERT INTO wide VALUES (-9223372036854775808, 'least'), (9223372036854775807, 'most')")
    db.close()
    const rows = readSqliteTable(new Uint8Array(readFileSync(path)), 'wide')?.rows
    expect(rows).toEqual([
      [-9223372036854775808n, 'least'],
      [9007199254740993n, 'beyond'],
      [72057594037927935n, 'eight bytes'],
      [9223372036854775807n, 'most'],
    ])
  })
})

describe('a database with a write-ahead log', () => {
  /** A database in WAL mode, read while it is open: closing it would empty the log. */
  function logged(setup: (db: Database) => void, change: (db: Database) => void, table: string) {
    const path = join(tmp.path, `wal-${files++}.db`)
    const db = new Database(path)
    db.run('PRAGMA journal_mode = WAL')
    db.run('PRAGMA wal_autocheckpoint = 0')
    setup(db)
    const all = () => db.query(`SELECT * FROM "${table}"`).values()
    const before = all()
    const walBefore = new Uint8Array(readFileSync(`${path}-wal`))
    change(db)
    const after = all()
    const read = {
      bytes: new Uint8Array(readFileSync(path)),
      wal: new Uint8Array(readFileSync(`${path}-wal`)),
      walBefore,
      before,
      after,
    }
    db.close()
    return read
  }
  const filled = (db: Database) => {
    db.run('CREATE TABLE plugins (plugin_id INTEGER PRIMARY KEY, name TEXT, enabled INTEGER)')
    const insert = db.prepare('INSERT INTO plugins (name, enabled) VALUES (?, ?)')
    db.transaction(() => {
      for (let i = 0; i < 400; i++) insert.run(`Plug-in ${i} ${'x'.repeat(i % 50)}`, i % 3)
    })()
  }
  const changed = (db: Database) => {
    db.transaction(() => {
      db.run('DELETE FROM plugins WHERE plugin_id % 5 = 0')
      db.run("UPDATE plugins SET name = name || ' (updated)' WHERE plugin_id % 7 = 0")
      db.run(`INSERT INTO plugins (name, enabled) VALUES ('${'long '.repeat(3000)}', 1)`)
    })()
  }

  test('is read as SQLite reads it: the log’s pages in place of the file’s', () => {
    const { bytes, wal, after } = logged(filled, changed, 'plugins')
    // Everything is still in the log: the file itself has no table at all.
    expect(readSqliteTable(bytes, 'plugins')).toBeUndefined()
    const table = readSqliteTable(bytes, 'plugins', wal)
    expect(table?.columns).toEqual(['plugin_id', 'name', 'enabled'])
    expect(table?.rows.length).toBe(321)
    expect(table?.rows).toEqual(after as never)
  })

  test('after a part of the log was written into the file, the rest still counts', () => {
    const { bytes, wal, after, before } = logged(
      (db) => {
        filled(db)
        db.run('PRAGMA wal_checkpoint(TRUNCATE)')
        db.run("INSERT INTO plugins (name, enabled) VALUES ('after the checkpoint', 1)")
      },
      changed,
      'plugins',
    )
    expect(readSqliteTable(bytes, 'plugins')?.rows.length).toBe(400)
    expect(before.length).toBe(401)
    expect(readSqliteTable(bytes, 'plugins', wal)?.rows).toEqual(after as never)
  })

  test('a transaction that is not whole in the log is not seen', () => {
    const { bytes, wal, walBefore, before, after } = logged(filled, changed, 'plugins')
    expect(after).not.toEqual(before)
    // The log as it was before the last transaction, and with only a part of that transaction.
    expect(readSqliteTable(bytes, 'plugins', walBefore)?.rows).toEqual(before as never)
    const cut = wal.subarray(0, wal.length - 1000)
    expect(readSqliteTable(bytes, 'plugins', cut)?.rows).toEqual(before as never)
    // A frame that does not check out ends the log there, like for SQLite.
    const damaged = wal.slice()
    const inLast = walBefore.length + 24 + 100
    damaged[inLast] = (damaged[inLast] as number) ^ 0xff
    expect(readSqliteTable(bytes, 'plugins', damaged)?.rows).toEqual(before as never)
  })

  test('a log that is none, or of another page size, changes nothing', () => {
    const { bytes, expected } = database((db) => {
      db.run('CREATE TABLE t (a, b)')
      db.run("INSERT INTO t VALUES (1, 'one')")
    }, 't')
    // The log of a database with larger pages (the size is set before anything else).
    const path = join(tmp.path, 'larger.db')
    const larger = new Database(path)
    larger.run('PRAGMA page_size = 8192')
    larger.run('PRAGMA journal_mode = WAL')
    larger.run('PRAGMA wal_autocheckpoint = 0')
    filled(larger)
    const other = new Uint8Array(readFileSync(`${path}-wal`))
    larger.close()
    expect(other.length).toBeGreaterThan(8192)
    for (const wal of [new Uint8Array(0), new Uint8Array(4096), bytes, other])
      expect(readSqliteTable(bytes, 't', wal)?.rows).toEqual(expected as never)
  })
})

describe("Live's remap table", () => {
  test('as Live ships it: two tables, looked up by type, pack and path', () => {
    const { bytes } = database((db) => {
      db.run(`CREATE TABLE sample_mapping (
        src_type int not null, src_packid varchar not null, src_ref varchar not null,
        dst_type int not null, dst_packid varchar, dst_ref varchar not null)`)
      db.run('CREATE TABLE pack_names (packid VARCHAR NOT NULL, packname VARCHAR NOT NULL)')
      db.run(
        'CREATE UNIQUE INDEX sample_mapping_key on sample_mapping (src_type, src_packid, src_ref)',
      )
      db.run(
        "INSERT INTO sample_mapping VALUES (2, '', 'Samples/Loops/Old Name.aif', 5, 'www.ableton.com/36', 'Samples/New Name.aif')",
      )
      db.run(
        "INSERT INTO sample_mapping VALUES (5, 'www.ableton.com/0', 'Devices/LFO.amxd', 7, NULL, 'Devices/LFO')",
      )
      db.run("INSERT INTO pack_names VALUES ('www.ableton.com/36', 'Loops Pack')")
    }, 'pack_names')
    const table = parseRemapTable(bytes)
    expect(table.mapping.get(remapKey(2, '', 'samples/loops/OLD NAME.aif'))).toEqual([
      5,
      'www.ableton.com/36',
      'Samples/New Name.aif',
    ])
    expect(table.mapping.get(remapKey(5, 'www.ableton.com/0', 'Devices/LFO.amxd'))).toEqual([
      7,
      '',
      'Devices/LFO',
    ])
    expect([...table.packNames]).toEqual([['www.ableton.com/36', 'Loops Pack']])
  })
})
