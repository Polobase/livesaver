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
import { onWindows } from '../platform.js'
import { type FolderSource, hiddenByHandle } from '../source.js'
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
    // (A set of Live 9 or 10 that was saved on Windows stores the path with backslashes.)
    const ref = parsed.refs.find(
      (r) =>
        r.relType === REL_PROJECT && r.relPath && posix.slashed(r.path).endsWith(`/${r.relPath}`),
    )
    if (ref) {
      const inside = posix.relpath(await projectRootOf(set, this.probe), this.mount)
      this.anchors.push({
        savedAt: posix.slashed(ref.path).slice(0, -(ref.relPath.length + 1)),
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

/**
 * What a folder is among Ableton's own, by its name and what lies in it. `windows`: Live's own
 * folder is laid out as on Windows (`Resources` in the program's folder), which the folder
 * itself says where it can, and the computer of the page where it cannot.
 */
async function abletonFolder(
  source: FolderSource,
  pageOnWindows: boolean,
): Promise<{ live?: LiveLevel; windows: boolean; landmarks: Landmark[] }> {
  const fs = new WebFs([{ path: '/folder', source }])
  const name = source.name.toLowerCase()
  const has = async (inside: string) =>
    (await fs.kind(posix.join('/folder', inside))) === 'directory'
  const landmarks: Landmark[] = []
  let live: LiveLevel | undefined
  let windows = pageOnWindows
  if (name === 'core library') live = 'core'
  else if (await has('Contents/App-Resources/Core Library')) [live, windows] = ['app', false]
  else if (await has('App-Resources/Core Library')) [live, windows] = ['contents', false]
  else if (await has('Resources/Core Library')) [live, windows] = ['contents', true]
  else if (await has('Core Library')) {
    live = 'resources'
    if (name === 'resources') windows = true
    else if (name === 'app-resources') windows = false
  }
  if (live) landmarks.push(liveLandmark(live, windows))
  for (const library of ['User Library', 'Factory Packs']) {
    if (name === library.toLowerCase()) landmarks.push({ names: [library], own: 1 })
    else if (await has(library)) landmarks.push({ names: [library], own: 0 })
  }
  return { ...(live ? { live } : {}), windows, landmarks }
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
  windows: boolean,
): Promise<string> {
  const fs = new WebFs([{ path: '/folder', source: folder.source }])
  const confirmed: Lead[] = []
  const checked = new Map<string, boolean>()
  const take = async (stored: readonly StoredPath[]) => {
    for (const lead of leadsTo(folder.source.name, landmarks, stored, windows)) {
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

/**
 * Names directly in a folder (`inside` = in one of its subfolders), sorted. Only the names a
 * browser shows behind a handle: the same folder is compared as a handle and as an upload.
 */
async function namesIn(source: FolderSource, inside = ''): Promise<string[]> {
  const fs = new WebFs([{ path: '/folder', source }])
  const entries = await fs.listDir(posix.join('/folder', inside))
  return (entries ?? [])
    .map((e) => e.name)
    .filter((name) => !hiddenByHandle(name))
    .sort()
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

/**
 * `windows`: the page runs on Windows, where a path has a drive. The paths that sets store are
 * read accordingly: a set that came from the other kind of computer says nothing here.
 */
export async function locate(
  request: ScanRequest,
  windows: boolean = onWindows(),
): Promise<LocatedFolder[]> {
  const inputs = [...request.projects, ...request.search]
  const typedPath = (f: FolderInput) => {
    // (Typed as Windows shows it, `C:\Music`, or as Live writes it, `C:/Music`.)
    const typed = posix.slashed(f.path.trim()).replace(/(?<=.)\/+$/, '')
    return posix.isAbs(typed) ? posix.normpath(typed) : ''
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
        path = locateFolder(folder.source.name, sample.anchors, windows)?.path ?? ''
      }
    } else {
      const own = await abletonFolder(folder.source, windows)
      if (path) {
        // Asked where "Contents" lies, one pastes the path of the app: any path into it will do.
        if (own.live) path = liveFolderPath(path, own.live, own.windows)
      } else {
        how = 'found'
        path = await placedBy(folder, request.projects, located)
        if (!path && own.landmarks.length)
          path = await placedBySets(folder, own.landmarks, samples, windows)
      }
    }
    // A project folder that was chosen for editing, given once more as an upload or a drop:
    // that one shows the names the handle hides, and is read at the same place.
    const again =
      !sample &&
      folder.source.kind !== 'handle' &&
      request.projects.some(
        (project, k) => project.source.kind === 'handle' && located[k]?.path === path,
      )
    if (!path || (taken.has(path) && !again)) {
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
