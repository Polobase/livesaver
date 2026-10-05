/**
 * A scan of the folders a page was given: work out where the folders lie on disk, find Ableton's
 * own folders among them, check every set (like `livesaver doctor`), and list the plug-ins the
 * sets use. Read-only: the host has no write access at all.
 */
import {
  EMPTY_REMAP,
  inProcessParser,
  parseRemapTable,
  posix,
  type RemapTable,
  type SetParser,
} from '@livesaver/core'
import {
  auditSets,
  buildReports,
  checkView,
  doctor,
  type EnvConfig,
  Environment,
  Probe,
  pluginsView,
} from '@livesaver/ops'
import { Inventory } from '@livesaver/plugins'
import type { Mount, WebFs } from '../fs.js'
import { createWebHost, type WebHost } from '../host.js'
import { createWorkerParser, defaultWorkerCount, type ParseWorker } from '../parser.js'
import type { WritableMount } from '../write.js'
import { APP_RESOURCES_IN } from './ableton.js'
import { installedIn, withAppleUnits } from './installed.js'
import { locate } from './places.js'
import type { FolderInput, LocatedFolder, ScanEvent, ScanPhase, ScanRequest } from './protocol.js'

interface Ableton {
  readonly config: EnvConfig
  /** The given folder that is, or holds, Live's App-Resources folder ('' = none does). */
  readonly liveFolder: string
}

/** Ableton's own folders, recognised by name: a given folder itself, or a folder in it. */
async function ableton(
  fs: WebFs,
  mounts: readonly Mount[],
  vendor: readonly string[],
): Promise<Ableton> {
  const is = (path: string, name: string) => posix.basename(path).toLowerCase() === name
  const isDir = async (path: string) => (await fs.kind(path)) === 'directory'
  const named = async (mount: string, name: string) => {
    if (is(mount, name.toLowerCase())) return mount
    const child = posix.join(mount, name)
    return (await isDir(child)) ? child : ''
  }
  let userLibrary = ''
  let factoryPacks = ''
  let appResources = ''
  let liveFolder = ''
  for (const { path } of mounts) {
    userLibrary ||= await named(path, 'User Library')
    factoryPacks ||= await named(path, 'Factory Packs')
    if (appResources) continue
    // The Core Library lies in the Live app's App-Resources folder.
    if (is(path, 'core library')) {
      appResources = posix.dirname(path)
      continue
    }
    for (const inside of APP_RESOURCES_IN) {
      const dir = inside ? posix.join(path, inside) : path
      if (!(await isDir(posix.join(dir, 'Core Library')))) continue
      appResources = dir
      // Only a folder of the Live app is narrowed to its Core Library when searching, not a
      // folder of the user's that happens to have a "Core Library" in it.
      if (inside || is(path, 'app-resources')) liveFolder = path
      break
    }
  }
  // If the whole App-Resources folder was given, Live's table of content it moved between
  // versions is there too.
  let remap: RemapTable = EMPTY_REMAP
  const table = posix.join(appResources, 'Database', 'filerefmap.db')
  if (appResources && (await fs.kind(table)) === 'file') {
    try {
      remap = parseRemapTable(await fs.readFile(table))
    } catch {} // an unreadable table only means fewer references are resolved
  }
  return {
    config: {
      userLibrary,
      factoryPacks,
      appResources,
      preferredRoots: [],
      vendorLibraries: vendor,
      remap,
    },
    liveFolder,
  }
}

export interface ScanEngineOptions {
  /** Starts a parse worker; left out where workers cannot start workers. */
  readonly spawn?: () => ParseWorker
  readonly cores: number
}

/** The folders of a request as livesaver works on them: placed, mounted, and Ableton's found. */
export interface Prepared {
  readonly folders: readonly LocatedFolder[]
  readonly mounts: readonly Mount[]
  readonly host: WebHost
  readonly probe: Probe
  /** The project folders, at the paths they were placed at. */
  readonly targets: readonly string[]
  /** Where samples are looked for (of the Live app's folder, only its Core Library). */
  readonly searchRoots: readonly string[]
  readonly config: EnvConfig
  readonly parser: SetParser
}

/**
 * Places and mounts the folders of a request. `writable`: more mounts (the page's own storage),
 * and which of the folders the page may write to; without it the host is read-only.
 */
export async function prepare(
  request: ScanRequest,
  options: ScanEngineOptions,
  writable?: {
    readonly extra: readonly (Mount & WritableMount)[]
    readonly folders: (mounts: readonly Mount[]) => readonly WritableMount[]
  },
  onLocated: (folders: readonly LocatedFolder[]) => void = () => {},
): Promise<Prepared> {
  const inputs = [...request.projects, ...request.search]
  const folders = await locate(request)
  onLocated(folders)
  const mounts = inputs.map((f, i) => ({
    path: (folders[i] as LocatedFolder).path,
    source: f.source,
  }))
  const host = writable
    ? createWebHost(
        [...mounts, ...writable.extra],
        [...writable.folders(mounts), ...writable.extra],
      )
    : createWebHost(mounts)
  const probe = new Probe(host.fs, host.hash)
  const targets = mounts.slice(0, request.projects.length).map((m) => m.path)
  const vendor = mounts.filter((_, i) => (inputs[i] as FolderInput).vendor).map((m) => m.path)
  const { config, liveFolder } = await ableton(host.fs, mounts, vendor)
  const parser = options.spawn
    ? createWorkerParser({
        host,
        spawn: options.spawn,
        workers: defaultWorkerCount(options.cores),
      })
    : inProcessParser(host)
  return {
    folders,
    mounts,
    host,
    probe,
    targets,
    // Of the Live app's own folder only the Core Library holds samples to relink to; the rest
    // (built-in devices, lessons, Max) is Live's business. (A folder given twice is one place.)
    searchRoots: [
      ...new Set(
        mounts.map((m) =>
          m.path === liveFolder ? posix.join(config.appResources, 'Core Library') : m.path,
        ),
      ),
    ],
    config,
    parser,
  }
}

export async function scanFolders(
  request: ScanRequest,
  emit: (event: ScanEvent) => void,
  options: ScanEngineOptions,
): Promise<void> {
  // (A phase that a scan does not have is not timed: the plug-ins only with folders for them.)
  const seconds: Partial<Record<ScanPhase, number>> = {
    locating: 0,
    indexing: 0,
    checking: 0,
    reporting: 0,
  }
  let phase: ScanPhase = 'locating'
  let since = performance.now()
  const enter = (next: ScanPhase) => {
    seconds[phase] = (seconds[phase] ?? 0) + (performance.now() - since) / 1000
    since = performance.now()
    phase = next
    emit({ type: 'phase', phase: next })
  }
  try {
    enter('locating')
    const { folders, host, probe, targets, searchRoots, config, parser } = await prepare(
      request,
      options,
      undefined,
      (located) => emit({ type: 'located', folders: located }),
    )

    enter('indexing')
    const result = await doctor(host, {
      targets,
      searchRoots,
      env: config,
      packCopyLimit: Math.trunc(request.options.packLimitMB * 1_000_000),
      matchLibraryPath: request.options.matchLibraryPath,
      minLive: request.options.minLive ?? 0,
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

    // The plug-ins were read with the samples. What is installed, a page cannot see by itself:
    // without folders that say so, the rows say which plug-ins are used and where, not whether
    // they are there.
    const given = request.installed ?? []
    let installed: Awaited<ReturnType<typeof installedIn>> | undefined
    if (given.length) {
      enter('plugins')
      installed = await installedIn(given)
    }
    enter('reporting')
    const env = result.projects[0]?.env ?? new Environment(config, probe)
    const reports = await buildReports(result.results, result.base, probe)
    const inventory = installed
      ? withAppleUnits(
          installed.inventory,
          result.results.flatMap((set) => (set.plugins ?? []).map((use) => use.ref)),
        )
      : undefined
    const audit = auditSets(
      result.results.map(({ setPath, projectRoot, plugins }) => ({
        setPath,
        projectRoot,
        ...(plugins ? { plugins } : {}),
      })),
      result.base,
      inventory && installed
        ? { inventory, catalog: installed.catalog }
        : { inventory: new Inventory([]) },
    )
    seconds.reporting = (performance.now() - since) / 1000
    emit({
      type: 'scanned',
      scan: {
        samples: checkView(result, env),
        plugins: pluginsView(audit, inventory),
        ...(installed
          ? { installed: { roots: installed.roots, database: installed.database } }
          : {}),
        reports,
        folders,
        usage: host.fs.usage,
        seconds,
        ableton: {
          userLibrary: env.userLibrary,
          factoryPacks: env.factoryPacks,
          coreLibrary: env.coreLibrary,
          remapEntries: env.config.remap.mapping.size,
        },
      },
    })
  } catch (error) {
    emit({ type: 'failed', message: (error as Error).message || String(error) })
  }
}
