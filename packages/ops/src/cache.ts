/**
 * Sets that were complete with nothing to do, so later runs can skip them while nothing changed.
 * An entry is trusted only while the set's size, mtime and ctime are unchanged (ctime catches
 * rewrites that put an old mtime back, as an undo does), the pack limit is the same, and every
 * file it used still exists.
 */
import type { FileStat } from '@livesaver/core'
import type { Status } from './match.js'
import type { Probe } from './probe.js'

/** The cache file's format version; an older or newer file is ignored (and rebuilt). */
export const CACHE_VERSION = 3

export interface CacheEntry {
  readonly mtimeNs: string
  readonly ctimeNs: string
  readonly size: number
  readonly packLimit: number
  readonly creator: string
  readonly counts: Record<Status, number>
  readonly files: readonly string[]
}

export class CompleteSets {
  readonly packLimit: number
  private readonly entries: Record<string, CacheEntry>

  constructor(packLimit: number, entries: Record<string, CacheEntry> = {}) {
    this.packLimit = packLimit
    this.entries = entries
  }

  /** From the saved JSON (a different version or broken file starts empty). */
  static parse(json: string | undefined, packLimit: number): CompleteSets {
    try {
      const data = JSON.parse(json ?? '') as { version?: number; sets?: Record<string, CacheEntry> }
      if (data.version === CACHE_VERSION && data.sets) return new CompleteSets(packLimit, data.sets)
    } catch {}
    return new CompleteSets(packLimit)
  }

  async lookup(setPath: string, probe: Probe): Promise<CacheEntry | undefined> {
    const entry = this.entries[setPath]
    if (!entry) return undefined
    const s = await probe.fs.stat(setPath)
    if (!s) return undefined
    if (
      entry.mtimeNs !== String(s.mtimeNs) ||
      entry.ctimeNs !== String(s.ctimeNs) ||
      entry.size !== s.size ||
      entry.packLimit !== this.packLimit
    ) {
      return undefined
    }
    for (const f of entry.files) if (!(await probe.exists(f))) return undefined
    return entry
  }

  store(
    setPath: string,
    stat: FileStat,
    creator: string,
    counts: Record<Status, number>,
    files: readonly string[],
  ): void {
    this.entries[setPath] = {
      mtimeNs: String(stat.mtimeNs),
      ctimeNs: String(stat.ctimeNs),
      size: stat.size,
      packLimit: this.packLimit,
      creator,
      counts,
      files: [...new Set(files)].sort(),
    }
  }

  forget(setPath: string): void {
    delete this.entries[setPath]
  }

  /** Paths of all entries. */
  paths(): string[] {
    return Object.keys(this.entries)
  }

  /** Rewrite entry paths and their files (after folders were moved by `reorg`). */
  remap(moved: (path: string) => string): void {
    const next: Record<string, CacheEntry> = {}
    for (const [path, entry] of Object.entries(this.entries))
      next[moved(path)] = { ...entry, files: entry.files.map(moved) }
    for (const key of Object.keys(this.entries)) delete this.entries[key]
    Object.assign(this.entries, next)
  }

  /** Drop entries of sets that no longer exist; returns how many. */
  async prune(exists: (path: string) => Promise<boolean>): Promise<number> {
    let n = 0
    for (const path of Object.keys(this.entries)) {
      if (!(await exists(path))) {
        delete this.entries[path]
        n++
      }
    }
    return n
  }

  get size(): number {
    return Object.keys(this.entries).length
  }

  serialize(): string {
    return JSON.stringify({ version: CACHE_VERSION, sets: this.entries })
  }
}
