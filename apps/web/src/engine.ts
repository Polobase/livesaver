/**
 * A doctor run over the folders a page was given: work out where the folders lie on disk, find
 * Ableton's own folders among them, check every set, and shape the result for the page.
 * Read-only: the host has no write access at all.
 */
import {
  EMPTY_REMAP,
  inProcessParser,
  parseRemapTable,
  posix,
  REL_PROJECT,
  type RemapTable,
} from '@livesaver/core'
import {
  buildReports,
  type DoctorResult,
  doctor,
  type EnvConfig,
  Environment,
  FOUND_NAMES,
  findSets,
  foundSources,
  HINTS,
  isComplete,
  KIND_NAMES,
  libraryGroups,
  missingGroups,
  Probe,
  projectRootOf,
  totalCounts,
} from '@livesaver/ops'
import {
  createWebHost,
  createWorkerParser,
  defaultWorkerCount,
  type FolderSource,
  type FsUsage,
  locateFolder,
  type Mount,
  type ParseWorker,
  type ProjectAnchor,
  WebFs,
} from '@livesaver/web'
import type {
  EngineEvent,
  FolderInput,
  LocatedFolder,
  Phase,
  RunRequest,
  RunResult,
} from './protocol.js'

/** Sets read to learn where a project folder lies; their stored paths agree, so a few suffice. */
const SAMPLE_SETS = 24

export interface EngineOptions {
  /** Starts a parse worker; left out where workers cannot start workers. */
  readonly spawn?: () => ParseWorker
  readonly cores: number
}

/**
 * What a sample of the sets says about where their projects were saved. Only references stored
 * relative to the project count: they name the same file by an absolute path too. Other stored
 * paths are no evidence: one that no longer exists would move a folder to a place where it is
 * not, and the missing file would then seem to exist.
 */
async function anchorsOf(source: FolderSource): Promise<ProjectAnchor[]> {
  const mount = '/folder'
  const host = createWebHost([{ path: mount, source }])
  const probe = new Probe(host.fs, host.hash)
  const sets = await findSets([mount], [], probe)
  const step = Math.max(1, Math.floor(sets.length / SAMPLE_SETS))
  const parser = inProcessParser(host)
  const anchors: ProjectAnchor[] = []
  for (let i = 0; i < sets.length; i += step) {
    const set = sets[i] as string
    const parsed = await parser.parse(set)
    if (!parsed.ok) continue
    const ref = parsed.refs.find(
      (r) => r.relType === REL_PROJECT && r.relPath && r.path.endsWith(`/${r.relPath}`),
    )
    if (!ref) continue
    const inside = posix.relpath(await projectRootOf(set, probe), mount)
    anchors.push({
      savedAt: ref.path.slice(0, -(ref.relPath.length + 1)),
      inside: inside === '.' ? '' : inside,
    })
  }
  return anchors
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

async function locate(request: RunRequest): Promise<LocatedFolder[]> {
  const inputs = [...request.projects, ...request.search]
  const typedPath = (f: FolderInput) => {
    const typed = f.path.trim().replace(/(?<=.)\/+$/, '')
    return typed.startsWith('/') ? posix.normpath(typed) : ''
  }
  const taken = new Set<string>()
  const located: LocatedFolder[] = []
  for (const [i, folder] of inputs.entries()) {
    let path = typedPath(folder)
    let how: LocatedFolder['how'] = 'typed'
    if (!path) {
      how = 'found'
      path =
        i < request.projects.length
          ? (locateFolder(folder.source.name, await anchorsOf(folder.source))?.path ?? '')
          : await placedBy(folder, request.projects, located)
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

/** Ableton's own folders, recognised by name: a given folder itself, or a folder directly in it. */
async function ableton(
  fs: WebFs,
  mounts: readonly Mount[],
  vendor: readonly string[],
): Promise<EnvConfig> {
  const named = async (mount: string, name: string) => {
    if (posix.basename(mount).toLowerCase() === name.toLowerCase()) return mount
    const child = posix.join(mount, name)
    return (await fs.stat(child))?.isDirectory ? child : ''
  }
  let userLibrary = ''
  let factoryPacks = ''
  let coreLibrary = ''
  for (const { path } of mounts) {
    userLibrary ||= await named(path, 'User Library')
    factoryPacks ||= await named(path, 'Factory Packs')
    coreLibrary ||= await named(path, 'Core Library')
  }
  // The Core Library lies in the Live app's App-Resources folder. If that whole folder was
  // given, Live's table of content it moved between versions is there too.
  const appResources = coreLibrary ? posix.dirname(coreLibrary) : ''
  let remap: RemapTable = EMPTY_REMAP
  const table = posix.join(appResources, 'Database', 'filerefmap.db')
  if (appResources && (await fs.kind(table)) === 'file') {
    try {
      remap = parseRemapTable(await fs.readFile(table))
    } catch {} // an unreadable table only means fewer references are resolved
  }
  return {
    userLibrary,
    factoryPacks,
    appResources,
    preferredRoots: [],
    vendorLibraries: vendor,
    remap,
  }
}

function shape(
  r: DoctorResult,
  env: Environment,
  reports: Record<string, string>,
  folders: readonly LocatedFolder[],
  usage: FsUsage,
  phases: Record<Phase, number>,
): RunResult {
  const rel = (path: string) => {
    const relative = posix.relpath(path, r.base)
    return relative === '.' ? posix.basename(path) : relative
  }
  const groups = missingGroups(r.results)
  const byProject = new Map<string, boolean>()
  for (const s of r.results)
    byProject.set(s.projectRoot, (byProject.get(s.projectRoot) ?? true) && isComplete(s))
  return {
    base: r.base,
    seconds: r.ms / 1000,
    phases,
    indexedFiles: r.index.fileCount,
    projects: byProject.size,
    completeProjects: [...byProject.values()].filter((complete) => complete).length,
    sets: r.results.length,
    completeSets: r.results.filter(isComplete).length,
    counts: totalCounts(r.results),
    uncertain: r.results.reduce((n, s) => n + s.changes.filter((c) => !c.certain).length, 0),
    copyFiles: r.projects.reduce((n, p) => n + p.copiedFiles, 0),
    copyBytes: r.projects.reduce((n, p) => n + p.copiedBytes, 0),
    changingSets: r.results.filter((s) => s.changes.length > 0 && !s.error).length,
    missingSources: libraryGroups(groups).map((lib) => ({
      kind: KIND_NAMES[lib.kind],
      name: lib.name,
      samples: lib.samples,
      projects: lib.projects.size,
      // The command line's advice, in the page's terms.
      hint: HINTS[lib.kind].replace('pass it with --search', 'add it as a sample folder'),
    })),
    foundSources: foundSources(r.results, env, r.index.roots).map((f) => ({
      kind: FOUND_NAMES[f.kind],
      name: f.name,
      samples: f.files.size,
      projects: f.projects.size,
      hint: '',
    })),
    setRows: r.results.map((s) => ({
      path: rel(s.setPath),
      project: rel(s.projectRoot),
      name: posix.basename(s.setPath),
      live: s.creator.replace('Ableton Live ', ''),
      counts: s.counts,
      changes: s.changes.length,
      error: s.error,
    })),
    missing: groups.map((g) => ({
      status: g.status,
      device: g.kind === 'device',
      name: g.name,
      path: g.path,
      source: g.source,
      size: g.size,
      sets: g.sets.size,
      projects: g.projects.size,
      candidates: g.choice.candidates.slice(0, 10),
    })),
    changes: r.results.flatMap((s) =>
      s.changes.map((c) => ({
        project: rel(s.projectRoot),
        set: posix.basename(s.setPath),
        action: c.action,
        name: c.name,
        oldPath: c.oldPath,
        newPath: c.newPath,
        source: c.source,
        method: c.method,
        certain: c.certain,
      })),
    ),
    reports,
    folders,
    usage,
    ableton: {
      userLibrary: env.userLibrary,
      factoryPacks: env.factoryPacks,
      coreLibrary: env.coreLibrary,
      remapEntries: env.config.remap.mapping.size,
    },
  }
}

export async function run(
  request: RunRequest,
  emit: (event: EngineEvent) => void,
  options: EngineOptions,
): Promise<void> {
  const phases: Record<Phase, number> = { locating: 0, indexing: 0, checking: 0, reporting: 0 }
  let phase: Phase = 'locating'
  let since = performance.now()
  const enter = (next: Phase) => {
    phases[phase] += (performance.now() - since) / 1000
    since = performance.now()
    phase = next
    emit({ type: 'phase', phase: next })
  }
  try {
    enter('locating')
    const inputs = [...request.projects, ...request.search]
    const folders = await locate(request)
    emit({ type: 'located', folders })

    const mounts = inputs.map((f, i) => ({
      path: (folders[i] as LocatedFolder).path,
      source: f.source,
    }))
    const host = createWebHost(mounts)
    const probe = new Probe(host.fs, host.hash)
    const targets = mounts.slice(0, request.projects.length).map((m) => m.path)
    const vendor = mounts.filter((_, i) => (inputs[i] as FolderInput).vendor).map((m) => m.path)
    const config = await ableton(host.fs, mounts, vendor)
    const parser = options.spawn
      ? createWorkerParser({
          host,
          spawn: options.spawn,
          workers: defaultWorkerCount(options.cores),
        })
      : inProcessParser(host)

    enter('indexing')
    const result = await doctor(host, {
      targets,
      // Of the Live app's own folder only the Core Library holds samples to relink to; the rest
      // (built-in devices, lessons, Max) is Live's business.
      searchRoots: mounts.map((m) =>
        config.appResources && m.path === config.appResources
          ? posix.join(m.path, 'Core Library')
          : m.path,
      ),
      env: config,
      packCopyLimit: Math.trunc(request.options.packLimitMB * 1_000_000),
      matchLibraryPath: request.options.matchLibraryPath,
      // Nothing is written here, and the strict scan of each patched set would run on this one
      // thread: a third of the whole run.
      quickPlan: true,
      parser,
      probe,
      onEvent: (e) => {
        if (e.type === 'index') {
          emit({ type: 'indexed', files: e.files })
          enter('checking')
        } else if (e.type === 'set') {
          emit({
            type: 'progress',
            done: e.index,
            total: e.total,
            name: posix.basename(e.result.setPath),
          })
        }
      },
    })
    await parser.close()

    enter('reporting')
    const env = result.projects[0]?.env ?? new Environment(config, probe)
    const reports = await buildReports(result.results, result.base, probe)
    phases.reporting = (performance.now() - since) / 1000
    emit({ type: 'done', result: shape(result, env, reports, folders, host.fs.usage, phases) })
  } catch (error) {
    emit({ type: 'failed', message: (error as Error).message || String(error) })
  }
}
