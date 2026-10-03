/**
 * The rows of a table in a SQLite database file, read without SQLite. Live ships small lookup
 * databases; where no SQLite is at hand (a browser), this reads them straight from the file.
 * Only plain tables are supported: no indexes are used, and a database in WAL mode with
 * unsaved changes, a `WITHOUT ROWID` table, or UTF-16 text are refused or not seen.
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
const utf8 = new TextDecoder()

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

function integer(view: DataView, at: number, bytes: number): SqlValue {
  if (bytes <= 6) {
    // Signed, big-endian: take the top byte with its sign, then append the rest.
    let value = view.getInt8(at)
    for (let i = 1; i < bytes; i++) value = value * 256 + view.getUint8(at + i)
    return value
  }
  const value = view.getBigInt64(at, false)
  return value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER
    ? Number(value)
    : value
}

/** The values of one record (https://www.sqlite.org/fileformat2.html#record_format). */
function record(payload: Uint8Array): SqlValue[] {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
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

/** Column names of a `CREATE TABLE` statement (constraints of the table itself are skipped). */
function columnsOf(sql: string): string[] {
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
  return parts
    .map((part) => /^\s*(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|(\w+))/.exec(part))
    .map((m) => m?.[1] ?? m?.[2] ?? m?.[3] ?? m?.[4] ?? '')
    .filter((name) => name && !/^(primary|unique|check|foreign|constraint)$/i.test(name))
}

/** The rows of `table`, or `undefined` if the database has no table of that name. */
export function readSqliteTable(db: Uint8Array, table: string): SqliteTable | undefined {
  if (db.length < 100 || utf8.decode(db.subarray(0, 16)) !== MAGIC)
    throw new SqliteFormatError('not a SQLite database')
  const file = new DataView(db.buffer, db.byteOffset, db.byteLength)
  // 1 stands for 65536, which does not fit the two bytes.
  const pageSize = file.getUint16(16, false) === 1 ? 65536 : file.getUint16(16, false)
  const usable = pageSize - file.getUint8(20)
  if (file.getUint32(56, false) > 1) throw new SqliteFormatError('UTF-16 text is not supported')

  /** The whole payload of a leaf cell, following its overflow pages. */
  const payloadOf = (cell: number, size: number): Uint8Array => {
    const maxLocal = usable - 35
    if (size <= maxLocal) return db.subarray(cell, cell + size)
    const minLocal = Math.floor(((usable - 12) * 32) / 255) - 23
    const fitting = minLocal + ((size - minLocal) % (usable - 4))
    const local = fitting <= maxLocal ? fitting : minLocal
    const out = new Uint8Array(size)
    out.set(db.subarray(cell, cell + local))
    let filled = local
    let next = file.getUint32(cell + local, false)
    while (next !== 0 && filled < size) {
      const page = (next - 1) * pageSize
      const take = Math.min(usable - 4, size - filled)
      out.set(db.subarray(page + 4, page + 4 + take), filled)
      filled += take
      next = file.getUint32(page, false)
    }
    if (filled < size) throw new SqliteFormatError('a row ends in the middle of its overflow pages')
    return out
  }

  /** Every row of the table whose B-tree starts at page `root`, in rowid order. */
  const rowsOf = (root: number): SqlValue[][] => {
    const rows: SqlValue[][] = []
    const walk = (number: number, depth: number): void => {
      if (depth > 64 || number < 1 || number * pageSize > db.length)
        throw new SqliteFormatError(`page ${number} does not exist`)
      const page = (number - 1) * pageSize
      const header = page + (number === 1 ? 100 : 0) // page 1 starts with the file header
      const kind = file.getUint8(header)
      if (kind !== INTERIOR && kind !== LEAF)
        throw new SqliteFormatError(`page ${number} is no table page`)
      const cells = file.getUint16(header + 3, false)
      const pointers = header + (kind === INTERIOR ? 12 : 8)
      for (let i = 0; i < cells; i++) {
        const cell = page + file.getUint16(pointers + 2 * i, false)
        if (kind === INTERIOR) walk(file.getUint32(cell, false), depth + 1)
        else {
          const [size, afterSize] = varint(db, cell)
          const [, afterRowid] = varint(db, afterSize)
          rows.push(record(payloadOf(afterRowid, size)))
        }
      }
      if (kind === INTERIOR) walk(file.getUint32(header + 8, false), depth + 1)
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
  const rows = rowsOf(Number(entry[3]))
  // A column added later (ALTER TABLE) is missing in older rows.
  for (const row of rows) while (row.length < columns.length) row.push(null)
  return { columns, rows }
}
