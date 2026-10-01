/**
 * Index of all audio files and Max devices below the search roots, looked up by normalized file
 * name. Backup, hidden and Live's own project-info folders are skipped; directories are read in
 * parallel, and folders that cannot be read are reported instead of silently missing.
 */
import { compareCodePoints, norm, posix } from '@livesaver/core'
import { isInside } from './env.js'
import type { Probe } from './probe.js'

export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  '.wav',
  '.wave',
  '.aif',
  '.aiff',
  '.aifc',
  '.flac',
  '.mp3',
  '.ogg',
  '.m4a',
  '.mp4',
  '.caf',
  '.rx2',
  '.rex',
  '.rcy',
  '.ams',
])
export const DEVICE_EXTENSIONS: ReadonlySet<string> = new Set(['.amxd'])
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  'Backup',
  'Ableton Project Info',
  '__MACOSX',
])

/** Limit concurrent directory reads (file descriptors, and friendliness to spinning disks). */
export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i] as T)
    }
  })
  await Promise.all(workers)
  return out
}

export interface FileIndexOptions {
  /** Folders not used for the search (`--ignore`). */
  readonly ignore?: readonly string[]
  readonly concurrency?: number
}

export class FileIndex {
  readonly roots: readonly string[]
  readonly fileCount: number
  /** Folders that could not be read (permissions, macOS privacy), so their files are unknown. */
  readonly unreadable: readonly string[]
  private readonly byName: ReadonlyMap<string, readonly string[]>

  private constructor(
    roots: readonly string[],
    byName: ReadonlyMap<string, readonly string[]>,
    fileCount: number,
    unreadable: readonly string[],
  ) {
    this.roots = roots
    this.byName = byName
    this.fileCount = fileCount
    this.unreadable = unreadable
  }

  static async build(
    roots: readonly string[],
    probe: Probe,
    options: FileIndexOptions = {},
  ): Promise<FileIndex> {
    const ignore = options.ignore ?? []
    const limit = options.concurrency ?? 64
    const existing: string[] = []
    for (const root of roots) if (await probe.isDir(root)) existing.push(root)

    const unreadable: string[] = []
    // Collected per root in walk order; deduplicated afterwards in root order (first root wins).
    const perRoot: string[][] = []
    for (const root of existing) {
      const files: string[] = []
      let level = [root]
      while (level.length > 0) {
        const listings = await mapLimited(level, limit, async (dir) => ({
          dir,
          entries: await probe.fs.listDir(dir),
        }))
        const nextLevel: string[] = []
        for (const { dir, entries } of listings) {
          if (!entries) {
            unreadable.push(dir)
            continue
          }
          for (const e of entries) {
            if (e.isDirectory) {
              if (e.isSymlink) continue // os.walk(followlinks=False) lists but never enters linked dirs
              if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue
              const sub = posix.join(dir, e.name)
              if (ignore.some((i) => isInside(sub, i))) continue
              nextLevel.push(sub)
              continue
            }
            if (e.name.startsWith('._') || e.name.includes('\r')) continue
            const ext = posix.splitext(e.name)[1].toLowerCase()
            if (!AUDIO_EXTENSIONS.has(ext) && !DEVICE_EXTENSIONS.has(ext)) continue
            files.push(posix.join(dir, e.name))
          }
        }
        level = nextLevel
      }
      perRoot.push(files)
    }

    const seen = new Set<string>()
    const byName = new Map<string, string[]>()
    for (const files of perRoot) {
      for (const path of files) {
        const key = norm(path)
        if (seen.has(key)) continue
        seen.add(key)
        const nameKey = norm(posix.basename(path))
        const list = byName.get(nameKey)
        if (list) list.push(path)
        else byName.set(nameKey, [path])
      }
    }
    for (const list of byName.values()) list.sort(compareCodePoints)
    return new FileIndex(existing, byName, seen.size, unreadable.sort(compareCodePoints))
  }

  /** Every indexed file with this name (compared with `norm`). */
  candidates(name: string): string[] {
    return [...(this.byName.get(norm(name)) ?? [])]
  }
}
