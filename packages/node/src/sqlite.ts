/**
 * SQLite through `bun:sqlite` under Bun and `node:sqlite` under Node (≥ 22.13): read-only access
 * to Live's own databases, and full connections for livesaver's catalog.
 */
import type { SqlDatabase, SqlValue } from '@livesaver/core'

export interface ReadonlyDb {
  all(sql: string): Record<string, unknown>[]
  close(): void
}

interface BunDatabase {
  query(sql: string): { all(): Record<string, unknown>[] }
  close(): void
}

interface NodeDatabase {
  prepare(sql: string): { all(): Record<string, unknown>[] }
  close(): void
}

/**
 * Open a database for reading. `writable` is for private copies only (SQLite needs write access to
 * replay a copied WAL file); the database is still only queried.
 */
export async function openReadonly(
  path: string,
  options: { writable?: boolean } = {},
): Promise<ReadonlyDb> {
  const readonly = !options.writable
  if ((globalThis as { Bun?: unknown }).Bun) {
    const specifier = 'bun:sqlite'
    const { Database } = (await import(specifier)) as {
      Database: new (
        path: string,
        options: { readonly?: boolean; readwrite?: boolean },
      ) => BunDatabase
    }
    const db = new Database(path, readonly ? { readonly: true } : { readwrite: true })
    return { all: (sql) => db.query(sql).all(), close: () => db.close() }
  }
  const specifier = 'node:sqlite'
  const { DatabaseSync } = (await import(specifier)) as {
    DatabaseSync: new (path: string, options: { readOnly: boolean }) => NodeDatabase
  }
  const db = new DatabaseSync(path, { readOnly: readonly })
  return { all: (sql) => db.prepare(sql).all(), close: () => db.close() }
}

interface BunStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  all(...params: unknown[]): Record<string, SqlValue>[]
}
interface BunFullDatabase {
  exec(sql: string): void
  prepare(sql: string): BunStatement
  close(): void
}
interface NodeStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  all(...params: unknown[]): Record<string, SqlValue>[]
}
interface NodeFullDatabase {
  exec(sql: string): void
  prepare(sql: string): NodeStatement
  close(): void
}

/**
 * A full SQLite connection for livesaver's own databases (the catalog): `bun:sqlite` under Bun,
 * `node:sqlite` under Node. Statements are prepared once per SQL text.
 */
export async function openDatabase(
  path: string,
  options: { readonly?: boolean } = {},
): Promise<SqlDatabase> {
  const statements = new Map<string, BunStatement | NodeStatement>()
  if ((globalThis as { Bun?: unknown }).Bun) {
    const specifier = 'bun:sqlite'
    const { Database } = (await import(specifier)) as {
      Database: new (path: string, options: Record<string, boolean>) => BunFullDatabase
    }
    const db = new Database(
      path,
      options.readonly ? { readonly: true } : { create: true, readwrite: true },
    )
    const prepared = (sql: string) => {
      let st = statements.get(sql) as BunStatement | undefined
      if (!st) {
        st = db.prepare(sql)
        statements.set(sql, st)
      }
      return st
    }
    return {
      exec: (sql) => db.exec(sql),
      run: (sql, params = []) => {
        const r = prepared(sql).run(...params)
        return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) }
      },
      all: (sql, params = []) => prepared(sql).all(...params),
      close: () => db.close(),
    }
  }
  const specifier = 'node:sqlite'
  const { DatabaseSync } = (await import(specifier)) as {
    DatabaseSync: new (path: string, options: { readOnly: boolean }) => NodeFullDatabase
  }
  const db = new DatabaseSync(path, { readOnly: Boolean(options.readonly) })
  const prepared = (sql: string) => {
    let st = statements.get(sql) as NodeStatement | undefined
    if (!st) {
      st = db.prepare(sql)
      statements.set(sql, st)
    }
    return st
  }
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, params = []) => {
      const r = prepared(sql).run(...params)
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
    },
    all: (sql, params = []) => prepared(sql).all(...params),
    close: () => db.close(),
  }
}
