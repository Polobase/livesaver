/**
 * Where a folder lies on disk. A browser never tells a page, but sets do: a reference stored
 * relative to its project names the same file by an absolute path too, so it says where the
 * project was when the set was saved. The given folder is one of the folders in that path: the
 * one with its name.
 */
import { casefold, nfc, posix } from '@livesaver/core'

/** What one set says about a project in the folder. */
export interface ProjectAnchor {
  /** Absolute path of the project when the set was saved. */
  readonly savedAt: string
  /** The project's path below the folder now ('' = the folder is the project). */
  readonly inside: string
}

export interface Located {
  readonly path: string
  /** Anchors that led to this answer, and how many led to any. */
  readonly votes: number
  readonly of: number
}

const nameKey = (name: string) => casefold(nfc(name))

/**
 * The most likely absolute path of the folder called `name`, or `undefined` if no anchor's path
 * has a folder of that name (it was renamed or moved since the sets were saved).
 *
 * Projects are often moved around inside the folder after their sets were saved, so the name
 * decides, not the path below it. Only when the name occurs twice in a path, the project's depth
 * picks the occurrence.
 */
export function locateFolder(name: string, anchors: Iterable<ProjectAnchor>): Located | undefined {
  const wanted = nameKey(name)
  const votes = new Map<string, { count: number; weight: number }>()
  let fitting = 0
  const vote = (parts: readonly string[], index: number, weight: number) => {
    const path = `/${parts.slice(0, index + 1).join('/')}`
    const v = votes.get(path) ?? { count: 0, weight: 0 }
    v.count++
    v.weight += weight
    votes.set(path, v)
  }
  for (const { savedAt, inside } of anchors) {
    if (!posix.isAbs(savedAt) || posix.isWindowsPath(savedAt)) continue
    const parts = posix.splitPath(savedAt)
    const found = parts.flatMap((part, i) => (nameKey(part) === wanted ? [i] : []))
    if (found.length === 0) continue
    fitting++
    // Where the folder is in the path if the project still lies as deep in it as when saved.
    const expected = parts.length - 1 - posix.splitPath(inside).length
    if (found.includes(expected)) vote(parts, expected, 2)
    else for (const index of found) vote(parts, index, 1)
  }
  let best: [string, { count: number; weight: number }] | undefined
  for (const entry of votes) if (!best || entry[1].weight > best[1].weight) best = entry
  return best ? { path: best[0], votes: best[1].count, of: fitting } : undefined
}
