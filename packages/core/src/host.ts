import type { ByteSearch } from './search.js'

/**
 * Ports: the only way runtime-agnostic packages reach the outside world. `@livesaver/node`
 * implements them for Node.js and Bun; a browser host can implement them later.
 */

export interface FileStat {
  readonly size: number
  /** Modification time in whole seconds since the epoch, floored (Python `int(st_mtime)`). */
  readonly mtimeSec: number
  /** Modification time in nanoseconds (for cache keys). */
  readonly mtimeNs: bigint
  readonly ctimeNs: bigint
  readonly ino: bigint
  readonly dev: bigint
  readonly isFile: boolean
  readonly isDirectory: boolean
}

export interface DirEntry {
  readonly name: string
  /** Directory (following symlinks, like Python's `DirEntry.is_dir()`). */
  readonly isDirectory: boolean
  /** The entry itself is a symbolic link. */
  readonly isSymlink: boolean
}

/** Read access to a file system. Paths are absolute POSIX paths. */
export interface FsRead {
  /** `stat` following symlinks; `undefined` if the path does not exist or is unreadable. */
  stat(path: string): Promise<FileStat | undefined>
  /** `stat` of a symbolic link itself (hosts without links may leave it out). */
  lstat?(path: string): Promise<FileStat | undefined>
  /**
   * Whether a path is a file or a directory, for hosts where that is much cheaper than `stat`:
   * a browser has to fetch a file to learn its size, which existence checks do not need.
   */
  kind?(path: string): Promise<'file' | 'directory' | undefined>
  /** Up to `length` bytes starting at `offset`. */
  read(path: string, offset: number, length: number): Promise<Uint8Array>
  readFile(path: string): Promise<Uint8Array>
  /** Entries of a directory; `undefined` if it cannot be read (reported, never silently skipped). */
  listDir(path: string): Promise<DirEntry[] | undefined>
  /**
   * Whether `path` is a place where this host shows nothing, whatever lies there: a browser
   * shows a page no entry with certain names in a folder behind a handle. A file that is not
   * found at such a place may well be there. Left out where a host sees everything.
   */
  hides?(path: string): boolean
  /**
   * Whether nothing can be made at `path`: a browser makes no file or folder with those names
   * either. Left out where a host can make whatever its file system takes.
   */
  refuses?(path: string): boolean
}

/** gzip for Live documents. */
export interface Codec {
  gunzip(data: Uint8Array): Promise<Uint8Array>
  /** gzip with the given level and header mtime 0 (sets are written with level 6). */
  gzip(data: Uint8Array, level: number): Promise<Uint8Array>
}

export interface Hasher {
  update(data: Uint8Array): void
  hex(): string
}

export interface HashPort {
  sha1(): Hasher
  /**
   * SHA-1 of the parts taken together, for hosts whose fast hash only works on whole buffers and
   * asynchronously (a browser's `crypto.subtle`). Used for data that is in memory anyway.
   */
  sha1Of?(parts: readonly Uint8Array[]): Promise<string>
}

/**
 * Write access. Nothing here overwrites or deletes an existing file, except `replaceFile`, which
 * replaces a set atomically after its backup exists.
 */
export interface FsWrite {
  mkdirp(path: string): Promise<void>
  /**
   * Copy to a new file (APFS clone where possible), keeping access/modification times and mode.
   * Written under a temporary name and linked into place, so it never overwrites and never leaves a
   * half-written file under the final name. Fails if `destination` exists.
   */
  copyFile(source: string, destination: string): Promise<void>
  /**
   * Replace an existing file's content atomically, keeping its extended attributes (Finder tags and
   * comments) and mode. Like any file that is saved, it then carries the time of the write: a set
   * that was rewritten says so in Finder. `modified` (nanoseconds since the epoch) gives it another
   * time instead: an undo puts back the time the original had. A host that cannot set times
   * (a browser) ignores it.
   */
  replaceFile(path: string, data: Uint8Array, modified?: bigint): Promise<void>
  /** Create a new file; fails if it exists. */
  writeNew(path: string, data: Uint8Array | string): Promise<void>
  /** Append a line and flush it to disk (journals must survive a crash). */
  appendDurable(path: string, line: string): Promise<void>
  /** Free bytes on the volume holding `path`, if the host can tell. */
  freeBytes(path: string): Promise<number | undefined>
  /** Move to the Trash (never a hard delete). */
  trash(path: string): Promise<void>
  /**
   * Rename a file or folder on the same volume (keeps its content, dates and metadata). Never
   * replaces anything: fails if `to` exists. Missing parent folders of `to` are created.
   */
  rename(from: string, to: string): Promise<void>
  /**
   * Create or replace a file livesaver owns or maintains (reports, the rating sheet, state),
   * atomically: readers see the old or the new content, never a mix.
   */
  writeFile(path: string, data: Uint8Array | string): Promise<void>
}

/** Extended attributes (on macOS: Finder tags and the mirrored Finder comment). */
export interface XattrPort {
  /** The value, or `undefined` if the file has no attribute of that name. */
  get(path: string, name: string): Promise<Uint8Array | undefined>
  set(path: string, name: string, value: Uint8Array): Promise<void>
  /** Remove the attribute; no error if it is absent. */
  remove(path: string, name: string): Promise<void>
}

/** Finder comments as Finder shows them (macOS: set and read through Finder itself). */
export interface FinderComments {
  /** Comment per path ('' for none). Throws `FinderAccessError` without permission. */
  read(paths: readonly string[]): Promise<Map<string, string>>
  write(comments: ReadonlyMap<string, string>): Promise<void>
}

/**
 * Finder could not be asked: no permission to control it (`permission`), the script failed
 * (`failed`), or it returned a different number of comments than asked for (`mismatch`).
 */
export class FinderAccessError extends Error {
  override name = 'FinderAccessError'
  readonly kind: 'permission' | 'failed' | 'mismatch'
  readonly detail: string

  constructor(kind: 'permission' | 'failed' | 'mismatch', detail: string) {
    super(`${kind}: ${detail}`)
    this.kind = kind
    this.detail = detail
  }
}

/** A value SQLite stores. Large integers (nanosecond times, inodes) are stored as text. */
export type SqlValue = string | number | bigint | Uint8Array | null

/**
 * A synchronous SQLite connection (`bun:sqlite`, `node:sqlite`, later sqlite-wasm). Parameters are
 * positional (`?`). Statements are prepared once and reused by the host.
 */
export interface SqlDatabase {
  /** One or more statements without results (schema, PRAGMA, BEGIN/COMMIT). */
  exec(sql: string): void
  run(sql: string, params?: readonly SqlValue[]): { changes: number; lastInsertRowid: number }
  all(sql: string, params?: readonly SqlValue[]): Record<string, SqlValue>[]
  close(): void
}

export interface Host {
  readonly fs: FsRead
  readonly codec: Codec
  readonly hash: HashPort
  /** Native byte search, if the runtime has a faster one than the pure fallback. */
  readonly search?: ByteSearch
  /** Write access; read-only hosts (a first browser version) leave it out. */
  readonly write?: FsWrite
  /** Extended attributes (Finder tags); hosts without them leave it out. */
  readonly xattr?: XattrPort
  /** Finder comments (macOS only). */
  readonly finder?: FinderComments
}
