/**
 * Measuring for `status`: every set analyzed (worker threads), missing samples and plug-ins found,
 * sets grouped into projects with their main set, duplicates and mixdowns.
 */
import {
  COMMENT_ATTR,
  compareCodePoints,
  decodeComment,
  decodeTags,
  type Host,
  type InspectedSet,
  inProcessParser,
  nfc,
  norm,
  type PluginRef,
  posix,
  type SetInfo,
  type SetParser,
  TAGS_ATTR,
  type Tag,
} from '@livesaver/core'
import type { Inventory } from '@livesaver/plugins'
import { findSets, PROJECT_MARKER, projectRootOf } from './collect.js'
import { type EnvConfig, Environment } from './env.js'
import { AUDIO_EXTENSIONS, mapLimited } from './file-index.js'
import { resolveExisting } from './match.js'
import { Probe } from './probe.js'
import {
  type ProjectStatus,
  projectComment,
  projectTags,
  type SetStatus,
  setComment,
  setName,
  setStage,
  setTags,
} from './status.js'
import { STAGE_KEYS, type StageKey, type StatusProfile } from './status-profile.js'
import { WORDS } from './status-words.js'

// ------------------------------------------------------------------------------------ assessment

/** The set that got furthest: highest progress, then the longer arrangement, then the newer one. */
export function chooseMain(
  sets: readonly SetStatus[],
  profile: StatusProfile,
): SetStatus | undefined {
  const readable = sets.filter((s) => s.info)
  if (readable.length === 0) return sets[0]
  const key = (s: SetStatus) =>
    [
      STAGE_KEYS.indexOf(setStage(s, profile) as StageKey),
      (s.info as SetInfo).lengthBeats,
      s.mtime,
    ] as const
  let best = readable[0] as SetStatus
  for (const s of readable.slice(1)) {
    const a = key(s)
    const b = key(best)
    if (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) best = s
  }
  return best
}

/** Project name for finding the same song in several places ("First Try Project copy" → "first try"). */
export function songKey(root: string): string {
  // Finder names a duplicated folder "<name> copy", "<name> copy 2", …
  const name = posix.basename(root).replace(/\s+Project(\s+copy(\s*\d+)?)?$/i, '')
  return norm(name.replace(/\s+copy(\s*\d+)?$/i, ''))
}

/** Sets of two copies of a project compared by name and musical content (clips and notes). */
export function compareSets(mine: readonly SetStatus[], theirs: readonly SetStatus[]): string {
  const w = WORDS
  const hashes = (sets: readonly SetStatus[]) => {
    const m = new Map<string, string>()
    for (const s of sets) if (s.info) m.set(norm(setName(s)), s.info.contentHash)
    return m
  }
  const a = hashes(mine)
  const b = hashes(theirs)
  let same = 0
  let different = 0
  let onlyHere = 0
  for (const [k, v] of a) {
    if (!b.has(k)) onlyHere++
    else if (b.get(k) === v) same++
    else different++
  }
  const onlyThere = [...b.keys()].filter((k) => !a.has(k)).length
  if (same === a.size && a.size === b.size) return w.allSetsEqual
  const parts: [number, string][] = [
    [same, w.compared[0]],
    [different, w.compared[1]],
    [onlyHere, w.compared[2]],
    [onlyThere, w.compared[3]],
  ]
  return parts
    .filter(([n]) => n)
    .map(([n, label]) => `${n} ${label}`)
    .join(', ')
}

export function findDuplicates(projects: readonly ProjectStatus[]): void {
  const bySong = new Map<string, ProjectStatus[]>()
  for (const p of projects) {
    if (!p.isProject) continue
    const k = songKey(p.root)
    const group = bySong.get(k) ?? []
    group.push(p)
    bySong.set(k, group)
  }
  for (const group of bySong.values()) {
    for (const p of group) {
      p.duplicates = group
        .filter((other) => other !== p)
        .map((other) => [other.root, compareSets(p.sets, other.sets)])
    }
  }
}

async function audioFiles(host: Host, folder: string): Promise<string[]> {
  const entries = await host.fs.listDir(folder)
  if (!entries) return []
  const out: string[] = []
  for (const name of entries.map((e) => e.name).sort(compareCodePoints)) {
    if (name.startsWith('.')) continue
    if (!AUDIO_EXTENSIONS.has(posix.splitext(name)[1].toLowerCase())) continue
    const path = posix.join(folder, name)
    if ((await host.fs.stat(path))?.isFile) out.push(path)
  }
  return out
}

function namedLike(path: string, name: string): boolean {
  const stem = norm(posix.splitext(posix.basename(path))[0])
  return Boolean(name) && (stem === name || stem.startsWith(`${name} `))
}

/** Mixdowns: audio in the project folder itself or in the exports folder, named like a set or the song. */
export async function findExports(
  host: Host,
  projects: readonly ProjectStatus[],
  exportsDir: string,
): Promise<void> {
  const shared = exportsDir ? await audioFiles(host, exportsDir) : []
  for (const p of projects) {
    const song = songKey(p.root)
    const own = p.isProject ? await audioFiles(host, p.root) : []
    const all = [...own, ...shared]
    for (const s of p.sets) {
      const name = norm(setName(s))
      s.exports = all.filter((a) => norm(posix.splitext(posix.basename(a))[0]) === name)
    }
    const found = new Set<string>(p.sets.flatMap((s) => s.exports))
    for (const a of all) if (namedLike(a, song)) found.add(a)
    p.exports = [...found].sort(compareCodePoints)
  }
}

/** Bytes of all files below `root` (symbolic links counted as links, not followed). */
export async function folderSize(host: Host, root: string): Promise<number> {
  let total = 0
  const walk = async (dir: string): Promise<void> => {
    const entries = await host.fs.listDir(dir)
    if (!entries) return
    const subdirs: string[] = []
    await mapLimited(entries, 16, async (e) => {
      const path = posix.join(dir, e.name)
      if (e.isDirectory) {
        if (!e.isSymlink) subdirs.push(path)
        return
      }
      const s = await (host.fs.lstat ?? host.fs.stat).call(host.fs, path)
      if (s) total += s.size
    })
    for (const d of subdirs) await walk(d)
  }
  await walk(root)
  return total
}

// ------------------------------------------------------------------------------------ collecting

export interface StatusProgress {
  readonly type: 'sets' | 'set'
  readonly done?: number
  readonly total: number
}

/** Finder tags of a path ([] if none or unreadable). */
export async function readTags(host: Host, path: string): Promise<Tag[]> {
  if (!host.xattr) return []
  try {
    return decodeTags(await host.xattr.get(path, TAGS_ATTR))
  } catch {
    return []
  }
}

/** The comment Finder mirrored into the extended attribute ('' if none). */
export async function readCommentAttr(host: Host, path: string): Promise<string> {
  if (!host.xattr) return ''
  try {
    return decodeComment(await host.xattr.get(path, COMMENT_ATTR))
  } catch {
    return ''
  }
}

function pythonMtime(ns: bigint): number {
  return Number(ns / 1_000_000_000n) + Number(ns % 1_000_000_000n) * 1e-9
}

const pluginKey = (r: PluginRef) => `${r.format}\u0000${r.ident}\u0000${r.name}`

export interface InspectOptions {
  readonly targets: readonly string[]
  readonly excludes?: readonly string[]
  readonly env: EnvConfig
  readonly inventory: Inventory
  readonly exportsDir?: string
  readonly profile: StatusProfile
  /** Analyzes sets (worker threads); default: in-process. */
  readonly parser?: SetParser
  readonly probe?: Probe
  readonly onProgress?: (p: StatusProgress) => void
}

/** Analyze all sets below the targets and group them into projects. */
export async function inspectProjects(
  host: Host,
  options: InspectOptions,
): Promise<ProjectStatus[]> {
  const probe = options.probe ?? new Probe(host.fs, host.hash)
  const env = new Environment(options.env, probe)
  const w = WORDS
  const sets = await findSets(options.targets, options.excludes ?? [], probe)
  options.onProgress?.({ type: 'sets', total: sets.length })
  const roots = new Map<string, string>()
  for (const s of sets) roots.set(s, await projectRootOf(s, probe))
  const parser = options.parser ?? inProcessParser(host)
  const inspect = parser.inspect?.bind(parser) ?? inProcessParser(host).inspect
  let done = 0
  const results = await mapLimited(sets, 16, async (path): Promise<SetStatus> => {
    const root = roots.get(path) as string
    const status: SetStatus = {
      path,
      root,
      mtime: 0,
      info: undefined,
      error: '',
      missingSamples: [],
      missingDevices: [],
      plugins: new Map(),
      exports: [],
    }
    const inspected: InspectedSet = await (inspect as NonNullable<SetParser['inspect']>)(path)
    if (inspected.stat) status.mtime = pythonMtime(inspected.stat.mtimeNs)
    options.onProgress?.({ type: 'set', done: ++done, total: sets.length })
    if (!inspected.ok) {
      status.error = `${w.unreadable}: ${inspected.error}`
      return status
    }
    status.info = inspected.info
    const seen = new Set<string>()
    const setDir = posix.dirname(path)
    for (const ref of inspected.refs) {
      if (!ref.name || seen.has(ref.key)) continue
      seen.add(ref.key)
      if ((await resolveExisting(ref, setDir, root, env, probe)) === undefined)
        (ref.kind === 'device' ? status.missingDevices : status.missingSamples).push(ref)
    }
    return status
  })

  const byRoot = new Map<string, SetStatus[]>()
  for (const s of results) {
    if (s.info) {
      for (const { ref } of s.info.plugins)
        s.plugins.set(pluginKey(ref), { ref, state: options.inventory.status(ref).state })
    }
    const list = byRoot.get(s.root) ?? []
    list.push(s)
    byRoot.set(s.root, list)
  }
  const projects: ProjectStatus[] = []
  for (const root of [...byRoot.keys()].sort(compareCodePoints)) {
    const members = byRoot.get(root) as SetStatus[]
    const isProject = (await host.fs.stat(posix.join(root, PROJECT_MARKER)))?.isDirectory ?? false
    projects.push({
      root,
      sets: members,
      isProject,
      main: chooseMain(members, options.profile),
      exports: [],
      duplicates: [],
      size: isProject ? await folderSize(host, root) : 0,
      tags: isProject ? await readTags(host, root) : [],
    })
  }
  findDuplicates(projects)
  await findExports(host, projects, options.exportsDir ?? '')
  return projects
}

/** Wanted tags and automatic comment per path (sets and project folders). */
export function planned(
  projects: readonly ProjectStatus[],
  profile: StatusProfile,
): Map<string, { tags: Tag[]; comment: string }> {
  const wanted = new Map<string, { tags: Tag[]; comment: string }>()
  for (const p of projects) {
    for (const s of p.sets)
      wanted.set(s.path, { tags: setTags(s, profile), comment: nfc(setComment(s, profile)) })
    if (p.isProject && p.main)
      wanted.set(p.root, {
        tags: projectTags(p, profile),
        comment: nfc(projectComment(p, profile)),
      })
  }
  return wanted
}
