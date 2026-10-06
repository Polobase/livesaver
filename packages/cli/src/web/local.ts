/**
 * What the web app asks of this computer: which folders there are, a check, a fix, an undo. A
 * check is `livesaver doctor`, a fix is `livesaver collect --apply`: the same pipeline, settings,
 * backups, journal and undo as on the command line.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { posix } from '@livesaver/core'
import { createNodeHost, liveIsRunning } from '@livesaver/node'
import { checkView, type DoctorEvent, isInside, undoRun } from '@livesaver/ops'
import { type CollectRun, collectRun, type DoctorFlags } from '../commands/doctor.js'
import { type PluginSources, upgradablePlugins } from '../commands/plugins.js'
import {
  absolute,
  CONFIG_PATH,
  type ResolvedConfig,
  resolveConfig,
  resolveStatusConfig,
} from '../config.js'
import { basename, dirname, home, join, windowsFolder } from '../paths.js'
import { acquireLock, cachePath, readText, runsDir, stateDir, writeStateFile } from '../state.js'
import type {
  WebEvent,
  WebFixRequest,
  WebFolder,
  WebFolderInfo,
  WebFolders,
  WebInfo,
  WebPlace,
  WebRequest,
  WebResult,
  WebUndone,
} from './protocol.js'
import { WEB_API } from './protocol.js'

export interface WebSettings {
  /** Config file in place of ~/.config/livesaver/config.json. */
  readonly config?: string
  readonly version?: string
  /**
   * Whether Ableton Live runs, in place of asking the system. Tests on copies say no: what they
   * write is open in no Live, whether one runs on the machine or not.
   */
  readonly liveRunning?: () => boolean
  /** What is installed and what Live knows, in place of looking it up on this computer. */
  readonly plugins?: () => Promise<PluginSources>
  /** Shows a file or folder in the system's file manager, in place of asking the system. */
  readonly reveal?: (path: string) => Promise<void>
}

export const LIVE_RUNNING =
  'Ableton Live is running. Quit it first, so that no open set gets overwritten.'

/** Whether Live runs: nothing is written while it does. */
export const liveRuns = (settings: WebSettings = {}): boolean =>
  (settings.liveRunning ?? liveIsRunning)()

/** The folders and options of the last check, which the page starts with next time. */
interface Remembered extends WebRequest {}

const rememberedPath = () => join(stateDir(), 'web.json')

export function remember(request: WebRequest): Promise<void> {
  const kept: Remembered = {
    projects: request.projects,
    search: request.search,
    options: request.options,
  }
  return writeStateFile(rememberedPath(), JSON.stringify(kept))
}

/**
 * Forgets the folders and options of the last scan: the page starts with the settings again
 * (the settings file, and what was found on this computer), as the command line does.
 */
export function webReset(): void {
  rmSync(rememberedPath(), { force: true })
}

function remembered(): Remembered | undefined {
  try {
    const data = JSON.parse(readText(rememberedPath()) ?? '') as Partial<Remembered>
    if (Array.isArray(data.projects) && Array.isArray(data.search) && data.options)
      return data as Remembered
  } catch {}
  return undefined
}

export const isFolder = (path: string) => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Which of Ableton's own folders a search folder holds (or lies in, for Live's content). */
function holds(path: string, config: ResolvedConfig): string[] {
  const { userLibrary, factoryPacks, appResources } = config.env
  const core = appResources ? join(appResources, 'Core Library') : ''
  return [
    userLibrary && isInside(userLibrary, path) ? 'User Library' : '',
    factoryPacks && isInside(factoryPacks, path) ? 'Factory Packs' : '',
    core && (isInside(core, path) || isInside(path, core)) ? "Live's own content" : '',
  ].filter((name) => name)
}

/** The folder all sets of earlier checks lie in, if there is one worth offering. */
function checkedBefore(): string[] {
  try {
    const { sets } = JSON.parse(readText(cachePath()) ?? '') as { sets?: Record<string, unknown> }
    const paths = Object.keys(sets ?? {})
    if (paths.length === 0) return []
    const common = posix.commonpath(paths.map((path) => dirname(path)))
    const deep = posix.splitPath(common).length > posix.splitPath(home()).length
    return deep && isFolder(common) ? [common] : []
  } catch {
    return []
  }
}

const windows = process.platform === 'win32'

/** The drives of Windows, each a root of its own (a Mac shows its volumes in one folder). */
function drives(): WebPlace[] {
  return [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
    .map((letter) => ({ name: `${letter}:`, path: `${letter}:/` }))
    .filter((drive) => isFolder(drive.path))
}

function places(): WebPlace[] {
  const folder = home()
  const fixed = [
    { name: 'Home', path: folder },
    ...['Documents', 'Music', 'Desktop'].map((name) => ({ name, path: join(folder, name) })),
    windows
      ? { name: 'Public', path: windowsFolder('PUBLIC', 'C:/Users/Public') }
      : { name: 'Shared', path: '/Users/Shared' },
  ]
  let volumes: WebPlace[] = []
  if (windows) volumes = drives()
  else
    try {
      volumes = readdirSync('/Volumes').map((name) => ({ name, path: join('/Volumes', name) }))
    } catch {}
  return [...fixed, ...volumes].filter((place) => isFolder(place.path))
}

export async function webInfo(settings: WebSettings = {}): Promise<WebInfo> {
  const config = await resolveConfig(settings.config ? { config: settings.config } : {})
  const last = remembered()
  // The first time, the projects folder of the settings (`status.projects`) is the one to check.
  const settled = resolveStatusConfig(settings.config ? { config: settings.config } : {}).projects
  const fromSettings = settled && isFolder(settled) ? [settled] : []
  const search: readonly WebFolder[] =
    last?.search ??
    config.searchRoots.map((path) => ({
      path,
      vendor: config.env.vendorLibraries.some((library) => isInside(path, library)),
    }))
  const file = settings.config ? absolute(settings.config) : CONFIG_PATH
  const there = (path: string) => (path && isFolder(path) ? path : '')
  const { userLibrary, factoryPacks, appResources } = config.env
  return {
    api: WEB_API,
    version: settings.version ?? '',
    found: {
      config: existsSync(file) ? file : '',
      state: stateDir(),
      userLibrary: there(userLibrary),
      factoryPacks: there(factoryPacks),
      coreLibrary: there(appResources ? join(appResources, 'Core Library') : ''),
      remembered: last !== undefined,
    },
    home: home(),
    places: places(),
    // (On Windows the folder is called like its Live, without "Ableton".)
    live: config.install ? basename(config.install.app, '.app') : '',
    projects: (last?.projects ?? fromSettings).filter(isFolder),
    suggested: last || fromSettings.length ? [] : checkedBefore(),
    search: search.map(
      (folder): WebFolderInfo => ({
        ...folder,
        holds: holds(folder.path, config),
        exists: isFolder(folder.path),
      }),
    ),
    options: last?.options ?? {
      packLimitMB: config.packCopyLimit / 1_000_000,
      matchLibraryPath: false,
    },
    platform: process.platform,
    upgradable: upgradablePlugins(),
  }
}

/**
 * Where Live's App-Resources folder may lie in a folder: it is it, the app's Contents, or the
 * app; on Windows it is the folder `Resources` of Live's folder.
 */
const APP_RESOURCES_IN = ['', 'App-Resources', 'Contents/App-Resources', 'Resources']

/** The Core Library of the Live app `path` is (or is a folder of), else ''. */
function coreLibraryIn(path: string): string {
  for (const inside of APP_RESOURCES_IN) {
    const core = join(path, inside, 'Core Library')
    if (isFolder(core)) return core
  }
  return ''
}

/**
 * The folder to search for a given one: of the Live app (or its Contents or App-Resources
 * folder) only the Core Library, which holds the samples; the rest is Live's business.
 */
function searchFolder(path: string): string {
  const name = basename(path).toLowerCase()
  const ofLive =
    name.endsWith('.app') ||
    name === 'contents' ||
    name === 'app-resources' ||
    // Windows: Live's folder (`Live 12 Suite`) and its `Resources`, names that say nothing
    // on another system.
    (windows && (name === 'resources' || /^live \d/.test(name)))
  return (ofLive && coreLibraryIn(path)) || path
}

/** The folders in `path` ('' = the home folder), hidden ones left out. */
export function webFolders(path: string): WebFolders {
  const folder = absolute(path || home())
  const names = readdirSync(folder, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    // A link to a folder is a folder to choose, too.
    .filter(
      (entry) =>
        entry.isDirectory() || (entry.isSymbolicLink() && isFolder(join(folder, entry.name))),
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }))
  const parent = dirname(folder)
  const is = (name: string) =>
    basename(folder).toLowerCase() === name.toLowerCase() || isFolder(join(folder, name))
  return {
    path: folder,
    parent: parent === folder ? '' : parent,
    folders: names.map((name) => ({ name, path: join(folder, name) })),
    holds: [
      is('User Library') ? 'User Library' : '',
      is('Factory Packs') ? 'Factory Packs' : '',
      is('Core Library') || coreLibraryIn(folder) ? "Live's own content" : '',
    ].filter((name) => name),
  }
}

export interface Prepared {
  readonly targets: string[]
  readonly flags: DoctorFlags
  readonly vendorLibraries: string[]
}

/** The folders a run works on: every project folder, or the projects in them that were asked. */
export function targetsOf(request: {
  projects?: readonly string[]
  only?: string | readonly string[]
}): string[] {
  if (!Array.isArray(request?.projects)) throw new Error('The request names no folders.')
  const projects = request.projects.map(absolute)
  if (projects.length === 0) throw new Error('No project folder was given.')
  for (const project of projects)
    if (!existsSync(project)) throw new Error(`This folder does not exist: ${project}`)
  const asked = request.only === undefined || request.only === '' ? [] : [request.only].flat()
  const only = asked.map((folder) => absolute(String(folder)))
  for (const folder of only) {
    if (!projects.some((project) => isInside(folder, project)))
      throw new Error(`This folder is not in a project folder that was checked: ${folder}`)
    if (!isFolder(folder)) throw new Error(`This folder does not exist: ${folder}`)
  }
  return only.length ? only : projects
}

/** The request as the pipeline takes it; throws what the page should show if it cannot run. */
export function prepare(request: WebFixRequest, settings: WebSettings): Prepared {
  if (!Array.isArray(request?.projects) || !Array.isArray(request.search) || !request.options)
    throw new Error('The request names no folders or options.')
  const targets = targetsOf(request)
  const projects = request.projects.map(absolute)
  const search = request.search.map((folder) => searchFolder(absolute(folder.path)))
  return {
    targets,
    flags: {
      // Exactly the folders of the page, the project folders among them: a single project is
      // fixed with the same files to choose from as when all were checked.
      search: [...projects, ...search],
      defaultSearch: false,
      packLimit: String(Math.max(0, Number(request.options.packLimitMB) || 0)),
      matchLibraryPath: Boolean(request.options.matchLibraryPath),
      certainOnly: Boolean(request.certainOnly),
      // (A whole number of a version, whatever the page sent.)
      minLive: String(Math.max(0, Math.trunc(Number(request.options.minLive) || 0))),
      ...(settings.config ? { config: settings.config } : {}),
    },
    vendorLibraries: request.search
      .filter((folder) => folder.vendor)
      .map((folder) => absolute(folder.path)),
  }
}

export function progress(emit: (event: WebEvent) => void, then: 'checking' | 'fixing') {
  return (event: DoctorEvent) => {
    if (event.type === 'index') {
      emit({ type: 'indexed', files: event.files })
      emit({ type: 'phase', phase: then })
    } else if (event.type === 'set') {
      emit({
        type: 'progress',
        done: event.index,
        total: event.total,
        name: basename(event.result.setPath),
      })
    }
  }
}

export const message = (error: unknown) => (error as Error).message || String(error)

/** A check's result as the page gets it. */
export function sampleResult({
  result,
  env,
  reports,
}: Pick<CollectRun, 'result' | 'env' | 'reports'>): WebResult {
  return {
    ...checkView(result, env),
    reports: reports ?? {},
    unreadable: result.index.unreadable,
    ableton: {
      userLibrary: env.userLibrary,
      factoryPacks: env.factoryPacks,
      coreLibrary: env.coreLibrary,
      remapEntries: env.config.remap.mapping.size,
    },
  }
}

/** A check, like `livesaver doctor`: nothing is written but livesaver's own notes. */
export async function webCheck(
  request: WebRequest,
  emit: (event: WebEvent) => void,
  settings: WebSettings = {},
): Promise<void> {
  try {
    const { targets, flags, vendorLibraries } = prepare(request, settings)
    emit({ type: 'phase', phase: 'indexing' })
    const checked = await collectRun('doctor', targets, flags, {
      vendorLibraries,
      reports: true,
      onEvent: progress(emit, 'checking'),
    })
    emit({ type: 'phase', phase: 'reporting' })
    await remember(request)
    emit({ type: 'done', result: sampleResult(checked) })
  } catch (error) {
    emit({ type: 'failed', message: message(error) })
  }
}

/** A fix, like `livesaver collect --apply`, of every project or of one. */
export async function webFix(
  request: WebFixRequest,
  emit: (event: WebEvent) => void,
  settings: WebSettings = {},
): Promise<void> {
  let release = () => {}
  let started = ''
  try {
    const { targets, flags, vendorLibraries } = prepare(request, settings)
    if (liveRuns(settings)) throw new Error(LIVE_RUNNING)
    release = acquireLock()
    emit({ type: 'phase', phase: 'indexing' })
    const { result, run } = await collectRun(
      'collect',
      targets,
      { ...flags, apply: true },
      {
        vendorLibraries,
        onEvent: progress(emit, 'fixing'),
        onRun: (context) => {
          started = context.id
        },
      },
    )
    emit({
      type: 'fixed',
      fixed: {
        run: run?.id ?? '',
        sets: result.results.filter((set) => set.written).length,
        files: result.projects.reduce((n, project) => n + project.copiedFiles, 0),
        bytes: result.projects.reduce((n, project) => n + project.copiedBytes, 0),
        errors: result.results
          .filter((set) => set.error)
          .map((set) => ({ set: set.setPath, error: set.error })),
      },
    })
  } catch (error) {
    emit({ type: 'failed', message: message(error), ...(started ? { run: started } : {}) })
  } finally {
    release()
  }
}

/** Reverse a fix, like `livesaver undo <run>`. */
export async function webUndo(run: string, settings: WebSettings = {}): Promise<WebUndone> {
  const dir = join(runsDir(), run)
  if (!/^\w[\w.-]*$/.test(run) || !existsSync(join(dir, 'journal.jsonl')))
    throw new Error(`This is not a run that changed anything: ${run}`)
  if (liveRuns(settings)) throw new Error(LIVE_RUNNING)
  const release = acquireLock()
  try {
    const config = await resolveConfig(settings.config ? { config: settings.config } : {})
    const host = createNodeHost({
      write: true,
      ...(process.env.LIVESAVER_TRASH_DIR ? { trashDir: process.env.LIVESAVER_TRASH_DIR } : {}),
    })
    const report = await undoRun(host, { id: run, dir }, config.env)
    return {
      restored: report.restored.length,
      trashed: report.trashed.length,
      kept: report.stillUsed.length,
      changedSince: report.changedSince,
      problems: [...report.unfinished, ...report.problems],
    }
  } finally {
    release()
  }
}
