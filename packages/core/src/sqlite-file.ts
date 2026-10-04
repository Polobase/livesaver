/**
 * The rows of a table in a SQLite database file, read without SQLite. Live ships small lookup
 * databases and keeps one of the plug-ins it scanned; where no SQLite is at hand (a browser),
 * this reads them straight from the file.
 *
 * Only plain tables are read: no indexes are used, and a `WITHOUT ROWID` table or UTF-16 text
 * is refused. A database in WAL mode keeps its newest pages in a file beside it (`-wal`) until
 * they are written into the database itself: given that file, its committed pages are read in
 * place of the database's, as SQLite reads them.
 *
 * File format: https://www.sqlite.org/fileformat2.html
 */
import type { SqlValue } from './host.js'

export class SqliteFormatError extends Error {
  override name = 'SqliteFormatError'
}

export interface SqliteTable {
  readonly columns: readonly string[]
  /** One array per row, in the order of `columns`. */
  readonly rows: readonly SqlValue[][]
}

const MAGIC = 'SQLite format 3\u0000'
const INTERIOR = 0x05
const LEAF = 0x0d
const WAL_HEADER = 32
const FRAME_HEADER = 24
const utf8 = new TextDecoder()

const viewOf = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength)
const safe = (value: bigint): number | bigint =>
  value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER ? Number(value) : value

/** A variable-length integer (1–9 bytes, big-endian, 7 bits each; the 9th byte has 8). */
function varint(b: Uint8Array, at: number): [value: number, next: number] {
  let value = 0
  for (let i = 0; i < 8; i++) {
    const byte = b[at + i] as number
    value = value * 128 + (byte & 0x7f)
    if (byte < 0x80) return [value, at + i + 1]
  }
  return [value * 256 + (b[at + 8] as number), at + 9]
}

/** A row's id: a varint that is a signed 64-bit number when it takes all nine bytes. */
function rowid(b: Uint8Array, at: number): [value: number | bigint, next: number] {
  const [value, next] = varint(b, at)
  if (next - at < 8) return [value, next]
  let wide = 0n
  for (let i = 0; i < Math.min(8, next - at); i++) {
    wide = (wide << 7n) | BigInt((b[at + i] as number) & 0x7f)
  }
  if (next - at === 9) wide = (wide << 8n) | BigInt(b[at + 8] as number)
  return [safe(BigInt.asIntN(64, wide)), next]
}

function integer(view: DataView, at: number, bytes: number): SqlValue {
  if (bytes <= 6) {
    // Signed, big-endian: take the top byte with its sign, then append the rest.
    let value = view.getInt8(at)
    for (let i = 1; i < bytes; i++) value = value * 256 + view.getUint8(at + i)
    return value
  }
  return safe(view.getBigInt64(at, false))
}

/** The values of one record (https://www.sqlite.org/fileformat2.html#record_format). */
function record(payload: Uint8Array): SqlValue[] {
  const view = viewOf(payload)
  const [headerSize, first] = varint(payload, 0)
  const values: SqlValue[] = []
  let type = first
  let at = headerSize
  while (type < headerSize) {
    const [serial, next] = varint(payload, type)
    type = next
    if (serial === 0) values.push(null)
    else if (serial <= 6) {
      const bytes = [0, 1, 2, 3, 4, 6, 8][serial] as number
      values.push(integer(view, at, bytes))
      at += bytes
    } else if (serial === 7) {
      values.push(view.getFloat64(at, false))
      at += 8
    } else if (serial === 8 || serial === 9) values.push(serial - 8)
    else if (serial >= 12) {
      const length = (serial - 12 - (serial & 1)) / 2
      const bytes = payload.subarray(at, at + length)
      values.push(serial & 1 ? utf8.decode(bytes) : bytes.slice())
      at += length
    } else throw new SqliteFormatError(`reserved serial type ${serial}`)
  }
  return values
}

interface Columns {
  readonly names: string[]
  /**
   * The column that is the row's id (`INTEGER PRIMARY KEY`), or -1: its value is not stored in
   * the row, where a NULL stands for it.
   */
  readonly rowid: number
}

const NAME = /^\s*(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|(\w+))/
const KEY_OF_TABLE = /primary\s+key\s*\(\s*(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|(\w+))\s*\)/i
const named = (m: RegExpExecArray | null) => m?.[1] ?? m?.[2] ?? m?.[3] ?? m?.[4] ?? ''

/** The columns of a `CREATE TABLE` statement (constraints of the table itself are no columns). */
function columnsOf(sql: string): Columns {
  const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'))
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) {
      parts.push(body.slice(start, i))
      start = i + 1
    }
  }
  parts.push(body.slice(start))
  const names: string[] = []
  const integers = new Set<string>()
  let key = ''
  for (const part of parts) {
    const m = NAME.exec(part)
    const name = named(m)
    if (!name) continue
    // (A quoted name is a column, whatever it says.)
    if (m?.[4] && /^(primary|unique|check|foreign|constraint)$/i.test(name)) {
      // `PRIMARY KEY (one column)` of the table names the row's id like the column's own does.
      const single = named(KEY_OF_TABLE.exec(part))
      if (single) key = single
      continue
    }
    names.push(name)
    const rest = part.slice(m?.[0].length ?? 0)
    // Only the type INTEGER, word for word, makes a primary key the row's id (INT does not).
    if (!/^\s*integer\b(?!\s*\()/i.test(rest)) continue
    integers.add(name.toLowerCase())
    if (/\bprimary\s+key\b(?!\s+desc)/i.test(rest)) key = name
  }
  const id = key.toLowerCase()
  return {
    names,
    rowid: id && integers.has(id) ? names.findIndex((name) => name.toLowerCase() === id) : -1,
  }
}

/** A page: the bytes it lies in (the database or its write-ahead log), and where it starts. */
type Page = readonly [bytes: Uint8Array, view: DataView, offset: number]

interface Pages {
  readonly size: number
  at(number: number): Page
}

/**
 * The 32-bit sums SQLite keeps over its write-ahead log: each continues the one before it, so a
 * frame that was not written whole, or is left from an older log, does not check out.
 */
function walSums(
  view: DataView,
  start: number,
  length: number,
  little: boolean,
  from: readonly [number, number],
): [number, number] {
  let [s0, s1] = from
  for (let i = start; i < start + length; i += 8) {
    s0 = (s0 + view.getUint32(i, little) + s1) >>> 0
    s1 = (s1 + view.getUint32(i + 4, little) + s0) >>> 0
  }
  return [s0, s1]
}

/**
 * The pages a write-ahead log holds in place of the database's: those of its transactions that
 * were committed, each page as the last of them wrote it. `size`: how many pages the database
 * has after the last of them (0 = the log changes nothing).
 */
function walPages(wal: Uint8Array, pageSize: number): { at: Map<number, number>; size: number } {
  const none = { at: new Map<number, number>(), size: 0 }
  if (wal.length < WAL_HEADER) return none
  const view = viewOf(wal)
  const magic = view.getUint32(0, false)
  if (magic !== 0x377f0682 && magic !== 0x377f0683) return none
  if (view.getUint32(8, false) !== pageSize) return none
  const little = magic === 0x377f0682
  const salt = [view.getUint32(16, false), view.getUint32(20, false)]
  let sums = walSums(view, 0, 24, little, [0, 0])
  if (sums[0] !== view.getUint32(24, false) || sums[1] !== view.getUint32(28, false)) return none

  const committed = new Map<number, number>()
  let size = 0
  let pending = new Map<number, number>()
  const frame = FRAME_HEADER + pageSize
  for (let at = WAL_HEADER; at + frame <= wal.length; at += frame) {
    if (view.getUint32(at + 8, false) !== salt[0] || view.getUint32(at + 12, false) !== salt[1])
      break
    sums = walSums(view, at, 8, little, sums)
    sums = walSums(view, at + FRAME_HEADER, pageSize, little, sums)
    if (sums[0] !== view.getUint32(at + 16, false) || sums[1] !== view.getUint32(at + 20, false))
      break
    pending.set(view.getUint32(at, false), at + FRAME_HEADER)
    const after = view.getUint32(at + 4, false)
    if (after === 0) continue // the transaction goes on
    for (const [number, offset] of pending) committed.set(number, offset)
    pending = new Map()
    size = after
  }
  return { at: committed, size }
}

function pagesOf(db: Uint8Array, wal: Uint8Array | undefined): Pages {
  if (db.length < 100 || utf8.decode(db.subarray(0, 16)) !== MAGIC)
    throw new SqliteFormatError('not a SQLite database')
  const file = viewOf(db)
  // 1 stands for 65536, which does not fit the two bytes.
  const size = file.getUint16(16, false) === 1 ? 65536 : file.getUint16(16, false)
  const log = wal ? walPages(wal, size) : { at: new Map<number, number>(), size: 0 }
  const logged = wal && log.size ? viewOf(wal) : undefined
  const count = log.size || Math.floor(db.length / size)
  return {
    size,
    at(number) {
      if (number < 1 || number > count) throw new SqliteFormatError(`page ${number} does not exist`)
      const inLog = log.at.get(number)
      if (inLog !== undefined && wal && logged) return [wal, logged, inLog]
      const offset = (number - 1) * size
      if (offset + size > db.length) throw new SqliteFormatError(`page ${number} does not exist`)
      return [db, file, offset]
    },
  }
}

/**
 * The rows of `table`, or `undefined` if the database has no table of that name. `wal`: the
 * database's write-ahead log (the file `<name>-wal` beside it), if there is one.
 */
export function readSqliteTable(
  db: Uint8Array,
  table: string,
  wal?: Uint8Array,
): SqliteTable | undefined {
  const pages = pagesOf(db, wal)
  const [, first, start] = pages.at(1)
  const usable = pages.size - first.getUint8(start + 20)
  if (first.getUint32(start + 56, false) > 1)
    throw new SqliteFormatError('UTF-16 text is not supported')

  /** The whole payload of a leaf cell, following its overflow pages. */
  const payloadOf = (bytes: Uint8Array, view: DataView, cell: number, size: number): Uint8Array => {
    const maxLocal = usable - 35
    if (size <= maxLocal) return bytes.subarray(cell, cell + size)
    const minLocal = Math.floor(((usable - 12) * 32) / 255) - 23
    const fitting = minLocal + ((size - minLocal) % (usable - 4))
    const local = fitting <= maxLocal ? fitting : minLocal
    const out = new Uint8Array(size)
    out.set(bytes.subarray(cell, cell + local))
    let filled = local
    let next = view.getUint32(cell + local, false)
    while (next !== 0 && filled < size) {
      const [more, moreView, page] = pages.at(next)
      const take = Math.min(usable - 4, size - filled)
      out.set(more.subarray(page + 4, page + 4 + take), filled)
      filled += take
      next = moreView.getUint32(page, false)
    }
    if (filled < size) throw new SqliteFormatError('a row ends in the middle of its overflow pages')
    return out
  }

  /** Every row of the table whose B-tree starts at page `root`, in the order of their ids. */
  const rowsOf = (root: number, idAt = -1): SqlValue[][] => {
    const rows: SqlValue[][] = []
    const walk = (number: number, depth: number): void => {
      if (depth > 64) throw new SqliteFormatError(`page ${number} does not exist`)
      const [bytes, view, page] = pages.at(number)
      const header = page + (number === 1 ? 100 : 0) // page 1 starts with the file header
      const kind = view.getUint8(header)
      if (kind !== INTERIOR && kind !== LEAF)
        throw new SqliteFormatError(`page ${number} is no table page`)
      const cells = view.getUint16(header + 3, false)
      const pointers = header + (kind === INTERIOR ? 12 : 8)
      for (let i = 0; i < cells; i++) {
        const cell = page + view.getUint16(pointers + 2 * i, false)
        if (kind === INTERIOR) walk(view.getUint32(cell, false), depth + 1)
        else {
          const [size, afterSize] = varint(bytes, cell)
          const [id, afterId] = rowid(bytes, afterSize)
          const row = record(payloadOf(bytes, view, afterId, size))
          if (idAt >= 0 && row[idAt] === null) row[idAt] = id
          rows.push(row)
        }
      }
      if (kind === INTERIOR) walk(view.getUint32(header + 8, false), depth + 1)
    }
    walk(root, 0)
    return rows
  }

  // sqlite_schema, always rooted at page 1: (type, name, tbl_name, rootpage, sql)
  const entry = rowsOf(1).find((row) => row[0] === 'table' && row[1] === table)
  if (!entry) return undefined
  if (/without\s+rowid/i.test(String(entry[4])))
    throw new SqliteFormatError('WITHOUT ROWID tables are not supported')
  const columns = columnsOf(String(entry[4]))
  const rows = rowsOf(Number(entry[3]), columns.rowid)
  // A column added later (ALTER TABLE) is missing in older rows.
  for (const row of rows) while (row.length < columns.names.length) row.push(null)
  return { columns: columns.names, rows }
}
