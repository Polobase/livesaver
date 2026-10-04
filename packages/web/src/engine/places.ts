/**
 * Where the folders of a request lie on disk. A browser does not say; the sets do: a project
 * folder is placed by what its sets store about their own projects, a sample folder by a
 * project folder it holds or lies in, and Ableton's own folders by the paths the sets store
 * for files in them. Every other folder gets a stand-in path, unless its path was typed.
 */
import { inProcessParser, posix, REL_PROJECT, type SetParser } from '@livesaver/core'
import { findSets, Probe, projectRootOf } from '@livesaver/ops'
import { WebFs } from '../fs.js'
import { createWebHost, type WebHost } from '../host.js'
import {
  type Landmark,
  type Lead,
  type LiveLevel,
  leadsTo,
  liveFolderPath,
  liveLandmark,
  locateFolder,
  majorOf,
  type ProjectAnchor,
  placeByLeads,
  type StoredPath,
  versionNumber,
} from '../locate.js'
import type { FolderSource } from '../source.js'
import type { FolderInput, LocatedFolder, ScanRequest } from './protocol.js'

/** Sets read to learn where a project folder lies; their stored paths agree, so a few suffice. */
const SAMPLE_SETS = 24
/** Sets read beyond those when nothing yet says where one of Ableton's own folders lies. */
const MORE_SETS = 48

/**
 * What a sample of the sets of a project folder says about where things lie.
 *
 * Where the projects were saved: only references stored relative to the project count, which
 * name the same file by an absolute path too. Other stored paths are no evidence for a folder
 * of the user's: one that no longer exists would move a folder to a place where it is not, and
 * the missing file would then seem to exist.
 *
 * Where Ableton's own folders lie (the Live app, the User Library, the Factory Packs): every
 * stored path is kept for that, with the Live that saved it. Live finds what lies in those
 * folders by its own rules whatever the stored path says, so a stale one does no such harm.
 */
class SetSample {
  readonly anchors: ProjectAnchor[] = []
  readonly stored: StoredPath[] = []
  /** The newest Live among the sets that were read. */
  newest = 0
  private readonly mount = '/folder'
  private readonly host: WebHost
  private readonly probe: Probe
  private readonly parser: SetParser
  private sets: string[] | undefined
  private readonly read = new Set<number>()

  constructor(source: FolderSource) {
    this.host = createWebHost([{ path: this.mount, source }])
    this.probe = new Probe(this.host.fs, this.host.hash)
    this.parser = inProcessParser(this.host)
  }

  private async one(index: number): Promise<StoredPath[]> {
    const set = this.sets?.[index]
    if (set === undefined || this.read.has(index)) return []
    this.read.add(index)
    const parsed = await this.parser.parse(set)
    if (!parsed.ok) return []
    const version = versionNumber(parsed.doc.creator)
    this.newest = Math.max(this.newest, version)
    const ref = parsed.refs.find(
      (r) => r.relType === REL_PROJECT && r.relPath && r.path.endsWith(`/${r.relPath}`),
    )
    if (ref) {
      const inside = posix.relpath(await projectRootOf(set, this.probe), this.mount)
      this.anchors.push({
        savedAt: ref.path.slice(0, -(ref.relPath.length + 1)),
        inside: inside === '.' ? '' : inside,
      })
    }
    const stored = parsed.refs.flatMap((r) =>
      [r.path, r.hintPath].flatMap((path) => (path ? [{ path, version }] : [])),
    )
    this.stored.push(...stored)
    return stored
  }

  /** The sets spread over the folder that are read first. */
  async first(): Promise<void> {
    if (this.sets) return
    this.sets = await findSets([this.mount], [], this.probe)
    const step = Math.max(1, Math.floor(this.sets.length / SAMPLE_SETS))
    for (let i = 0; i < this.sets.length; i += step) await this.one(i)
  }

  /** More sets, between those that were read, one at a time: what each of them stores. */
  async *more(): AsyncGenerator<StoredPath[]> {
    await this.first()
    const count = this.sets?.length ?? 0
    const step = Math.max(1, Math.floor(count / MORE_SETS))
    let given = 0
    for (let i = Math.floor(step / 2); i < count && given < MORE_SETS; i += step) {
      if (this.read.has(i)) continue
      given++
      yield await this.one(i)
    }
  }
}

/** What a folder is among Ableton's own, by its name and what lies in it. */
async function abletonFolder(
  source: FolderSource,
): Promise<{ live?: LiveLevel; landmarks: Landmark[] }> {
  const fs = new WebFs([{ path: '/folder', source }])
  const name = source.name.toLowerCase()
  const has = async (inside: string) =>
    (await fs.kind(posix.join('/folder', inside))) === 'directory'
  const landmarks: Landmark[] = []
  let live: LiveLevel | undefined
  if (name === 'core library') live = 'core'
  else if (await has('Contents/App-Resources/Core Library')) live = 'app'
  else if (await has('App-Resources/Core Library')) live = 'contents'
  else if (await has('Core Library')) live = 'resources'
  if (live) landmarks.push(liveLandmark(live))
  for (const library of ['User Library', 'Factory Packs']) {
    if (name === library.toLowerCase()) landmarks.push({ names: [library], own: 1 })
    else if (await has(library)) landmarks.push({ names: [library], own: 0 })
  }
  return { ...(live ? { live } : {}), landmarks }
}

/**
 * Where one of Ableton's own folders lies, by the paths the sets store for files in it: a lead
 * counts once the file it names is in the folder. Sets of the newest Live decide (an older set
 * names the Live app of its time), so more sets are read while only older ones gave a lead.
 */
async function placedBySets(
  folder: FolderInput,
  landmarks: readonly Landmark[],
  samples: readonly SetSample[],
): Promise<string> {
  const fs = new WebFs([{ path: '/folder', source: folder.source }])
  const confirmed: Lead[] = []
  const checked = new Map<string, boolean>()
  const take = async (stored: readonly StoredPath[]) => {
    for (const lead of leadsTo(folder.source.name, landmarks, stored)) {
      let there = checked.get(lead.inside)
      if (there === undefined) {
        there = (await fs.kind(posix.join('/folder', lead.inside))) !== undefined
        checked.set(lead.inside, there)
      }
      if (there) confirmed.push(lead)
    }
  }
  for (const sample of samples) await sample.first()
  for (const sample of samples) await take(sample.stored)
  const newest = () => Math.max(0, ...samples.map((sample) => majorOf(sample.newest)))
  const settled = () => confirmed.some((lead) => majorOf(lead.version) === newest())
  for (const sample of samples) {
    if (settled()) break
    for await (const stored of sample.more()) {
      await take(stored)
      if (settled()) break
    }
  }
  return placeByLeads(confirmed) ?? ''
}

/** Names directly in a folder (`inside` = in one of its subfolders), sorted. */
async function namesIn(source: FolderSource, inside = ''): Promise<string[]> {
  const fs = new WebFs([{ path: '/folder', source }])
  const entries = await fs.listDir(posix.join('/folder', inside))
  return (entries ?? []).map((e) => e.name).sort()
}

const sameNames = (a: readonly string[], b: readonly string[]) =>
  a.length > 0 && a.length === b.length && a.every((name, i) => name === b[i])

/**
 * A sample folder that contains a project folder, or lies directly in one, is placed by it:
 * "Music" holding "Music/Projects", or "Projects/Samples" inside "Projects".
 */
async function placedBy(
  folder: FolderInput,
  projects: readonly FolderInput[],
  located: readonly LocatedFolder[],
): Promise<string> {
  const own = await namesIn(folder.source)
  for (const [i, project] of projects.entries()) {
    const at = located[i] as LocatedFolder
    if (at.how === 'unknown') continue
    const theirs = await namesIn(project.source)
    if (sameNames(theirs, await namesIn(folder.source, project.source.name)))
      return posix.dirname(at.path)
    if (sameNames(own, await namesIn(project.source, folder.source.name)))
      return posix.join(at.path, folder.source.name)
    if (sameNames(own, theirs) && folder.source.name === project.source.name) return at.path
  }
  return ''
}

export async function locate(request: ScanRequest): Promise<LocatedFolder[]> {
  const inputs = [...request.projects, ...request.search]
  const typedPath = (f: FolderInput) => {
    const typed = f.path.trim().replace(/(?<=.)\/+$/, '')
    return typed.startsWith('/') ? posix.normpath(typed) : ''
  }
  const samples = request.projects.map((project) => new SetSample(project.source))
  const taken = new Set<string>()
  const located: LocatedFolder[] = []
  for (const [i, folder] of inputs.entries()) {
    let path = typedPath(folder)
    let how: LocatedFolder['how'] = 'typed'
    const sample = samples[i]
    if (sample) {
      if (!path) {
        how = 'found'
        await sample.first()
        path = locateFolder(folder.source.name, sample.anchors)?.path ?? ''
      }
    } else {
      const own = await abletonFolder(folder.source)
      if (path) {
        // Asked where "Contents" lies, one pastes the path of the app: any path into it will do.
        if (own.live) path = liveFolderPath(path, own.live)
      } else {
        how = 'found'
        path = await placedBy(folder, request.projects, located)
        if (!path && own.landmarks.length) path = await placedBySets(folder, own.landmarks, samples)
      }
    }
    if (!path || taken.has(path)) {
      // Unknown: a stand-in path. Paths stored in sets then never lead into this folder by
      // accident; its files are still found by name and fingerprint.
      how = 'unknown'
      const name = folder.source.name || 'folder'
      path = `/${name}`
      for (let n = 2; taken.has(path); n++) path = `/${name} ${n}`
    }
    taken.add(path)
    located.push({ id: folder.id, path, how })
  }
  return located
}
