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
