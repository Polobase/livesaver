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
 * The parts of a stored path, if it is one of the kind of computer the page runs on: with a
 * drive on Windows, without one elsewhere. A set that came from the other kind of computer
 * says nothing about where a folder lies on this one.
 */
function partsOf(stored: string, windows: boolean): string[] | undefined {
  const path = posix.slashed(stored)
  if (!posix.isAbs(path) || (posix.drive(path) !== '') !== windows) return undefined
  return posix.splitPath(path)
}

/** The path its parts make (the first part of a path of Windows is its drive). */
const pathOf = (parts: readonly string[], windows: boolean) =>
  windows ? parts.join('/') : `/${parts.join('/')}`

/**
 * The most likely absolute path of the folder called `name`, or `undefined` if no anchor's path
 * has a folder of that name (it was renamed or moved since the sets were saved).
 *
 * Projects are often moved around inside the folder after their sets were saved, so the name
 * decides, not the path below it. Only when the name occurs twice in a path, the project's depth
 * picks the occurrence.
 */
export function locateFolder(
  name: string,
  anchors: Iterable<ProjectAnchor>,
  windows = false,
): Located | undefined {
  const wanted = nameKey(name)
  const votes = new Map<string, { count: number; weight: number }>()
  let fitting = 0
  const vote = (parts: readonly string[], index: number, weight: number) => {
    const path = pathOf(parts.slice(0, index + 1), windows)
    const v = votes.get(path) ?? { count: 0, weight: 0 }
    v.count++
    v.weight += weight
    votes.set(path, v)
  }
  for (const { savedAt, inside } of anchors) {
    const parts = partsOf(savedAt, windows)
    if (!parts) continue
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

// --------------------------------------------------------------------------- Ableton's own folders

/**
 * Which folder of Live's own a given folder is. On a Mac they are the Live app, its `Contents`,
 * its `App-Resources`, and the Core Library in there. Windows has no app that is a folder:
 * Live's own lies in `C:/ProgramData/Ableton/Live 12 Suite` (here `contents`, and `app` too),
 * with `Resources` in it, and the Core Library in there. (The folders of Windows are as Ableton
 * documents them, and as sets that were saved on Windows name them; no Windows was at hand.)
 */
export type LiveLevel = 'app' | 'contents' | 'resources' | 'core'

/** The folders from Live's own folder down to each of them. */
const LIVE_BELOW: Readonly<
  Record<'mac' | 'windows', Readonly<Record<LiveLevel, readonly string[]>>>
> = {
  mac: {
    app: [],
    contents: ['Contents'],
    resources: ['Contents', 'App-Resources'],
    core: ['Contents', 'App-Resources', 'Core Library'],
  },
  windows: {
    app: [],
    contents: [],
    resources: ['Resources'],
    core: ['Resources', 'Core Library'],
  },
}
const below = (windows: boolean) => LIVE_BELOW[windows ? 'windows' : 'mac']

/**
 * The path of a folder of Live's own, from a path that was typed for it. Any path into the app
 * will do (the app, its `Contents`, `App-Resources` or the Core Library), whichever of them the
 * folder is: someone who is asked where "Contents" lies pastes the path of the app. On Windows
 * it is any path into Live's folder in `ProgramData/Ableton`. A path that leads into neither is
 * taken as it is.
 */
export function liveFolderPath(typed: string, level: LiveLevel, windows = false): string {
  const parts = posix.splitPath(typed)
  const root = windows
    ? parts.findIndex(
        (part, i) => /^live \d/i.test(part) && parts[i - 1]?.toLowerCase() === 'ableton',
      )
    : parts.findIndex((part) => part.toLowerCase().endsWith('.app'))
  if (root < 0) return typed
  return pathOf([...parts.slice(0, root + 1), ...below(windows)[level]], windows)
}

/**
 * How a folder of Ableton's shows in the paths that sets store: the folders that follow each
 * other there (`Contents/App-Resources`, `User Library`), and how many of them belong to the
 * given folder's own path (0 = the folder is the one that holds them).
 */
export interface Landmark {
  readonly names: readonly string[]
  readonly own: number
}

/** The landmark of a folder of Live's own. */
export function liveLandmark(level: LiveLevel, windows = false): Landmark {
  const folders = below(windows)
  return {
    names: level === 'core' ? folders.core : folders.resources,
    own: folders[level].length,
  }
}

/** A path a set stores for a file, with the Live version that saved the set. */
export interface StoredPath {
  readonly path: string
  /** The version as a number that sorts: 12.2.5 is 12_002_005 (0 = not known). */
  readonly version: number
}

/** A stored path read as a hint: where the folder lies if the path leads into it. */
export interface Lead {
  readonly path: string
  /** The file the stored path names, as a path in the folder: there, the lead is confirmed. */
  readonly inside: string
  readonly version: number
}

/** "Ableton Live 12.2.5" as a number that sorts (0 = no version in it). */
export function versionNumber(creator: string): number {
  const found = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(creator)
  if (!found) return 0
  const [major, minor, patch] = [found[1], found[2], found[3]].map((part) => Number(part ?? 0))
  return (major as number) * 1_000_000 + (minor as number) * 1000 + (patch as number)
}

/**
 * The leads that stored paths give for the folder called `name`. Only a path that names the
 * folder itself counts: a folder called "Ableton" does not lie at `…/Music/Live Stuff`.
 */
export function leadsTo(
  name: string,
  landmarks: readonly Landmark[],
  stored: Iterable<StoredPath>,
  windows = false,
): Lead[] {
  const wanted = nameKey(name)
  const leads: Lead[] = []
  const seen = new Set<string>()
  for (const { path, version } of stored) {
    const parts = partsOf(path, windows)
    if (!parts) continue
    const keys = parts.map(nameKey)
    for (const { names, own } of landmarks) {
      const at = keys.findIndex((_, i) => names.every((part, k) => keys[i + k] === nameKey(part)))
      const end = at + own
      // The folder is none of the root (nor a drive), and the path names a file below the
      // landmark.
      if (at < 0 || end <= (windows ? 1 : 0) || at + names.length >= parts.length) continue
      if (keys[end - 1] !== wanted) continue
      const lead = {
        path: pathOf(parts.slice(0, end), windows),
        inside: parts.slice(end).join('/'),
        version,
      }
      const key = `${lead.path}\u0000${lead.inside}`
      if (seen.has(key)) continue
      seen.add(key)
      leads.push(lead)
    }
  }
  return leads
}

/**
 * Where the folder lies, by the leads that were confirmed: what the sets of the newest Live
 * say, and among those what most of them say. Older sets name where things lay then (the Live
 * app of that time).
 */
export function placeByLeads(confirmed: readonly Lead[]): string | undefined {
  const newest = Math.max(0, ...confirmed.map((lead) => majorOf(lead.version)))
  const votes = new Map<string, number>()
  for (const lead of confirmed)
    if (majorOf(lead.version) === newest) votes.set(lead.path, (votes.get(lead.path) ?? 0) + 1)
  let best: [string, number] | undefined
  for (const entry of votes) if (!best || entry[1] > best[1]) best = entry
  return best?.[0]
}

/** The major version of a version number (12 of 12.2.5). */
export const majorOf = (version: number): number => Math.floor(version / 1_000_000)
