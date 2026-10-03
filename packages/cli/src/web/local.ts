/**
 * What the web app asks of this computer: which folders there are, a check, a fix, an undo. A
 * check is `livesaver doctor`, a fix is `livesaver collect --apply`: the same pipeline, settings,
 * backups, journal and undo as on the command line.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { posix } from '@livesaver/core'
import { createNodeHost, liveIsRunning } from '@livesaver/node'
import { checkView, type DoctorEvent, isInside, readJournal, undoRun } from '@livesaver/ops'
import { collectRun, type DoctorFlags } from '../commands/doctor.js'
import { absolute, type ResolvedConfig, resolveConfig, resolveStatusConfig } from '../config.js'
import {
  acquireLock,
  cachePath,
  listRuns,
  readText,
  runsDir,
  stateDir,
  writeStateFile,
} from '../state.js'
import type {
  WebEvent,
  WebFixRequest,
  WebFolder,
  WebFolderInfo,
  WebFolders,
  WebInfo,
  WebLastFix,
  WebPlace,
  WebRequest,
  WebUndone,
} from './protocol.js'

export interface WebSettings {
  /** Config file in place of ~/.config/livesaver/config.json. */
  readonly config?: string
  readonly version?: string
  /** Write even while Live is running (for tests on copies; the page never asks for it). */
  readonly force?: boolean
}

const LIVE_RUNNING = 'Ableton Live is running. Quit it first, so that no open set gets overwritten.'

/** The folders and options of the last check, which the page starts with next time. */
interface Remembered extends WebRequest {}

const rememberedPath = () => join(stateDir(), 'web.json')

function remembered(): Remembered | undefined {
  try {
    const data = JSON.parse(readText(rememberedPath()) ?? '') as Partial<Remembered>
    if (Array.isArray(data.projects) && Array.isArray(data.search) && data.options)
      return data as Remembered
  } catch {}
  return undefined
}

const isFolder = (path: string) => {
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
    const deep = posix.splitPath(common).length > posix.splitPath(homedir()).length
    return deep && isFolder(common) ? [common] : []
  } catch {
    return []
  }
}

function places(): WebPlace[] {
  const home = homedir()
  const fixed = [
    { name: 'Home', path: home },
    ...['Documents', 'Music', 'Desktop'].map((name) => ({ name, path: join(home, name) })),
    { name: 'Shared', path: '/Users/Shared' },
  ]
  let volumes: WebPlace[] = []
  try {
    volumes = readdirSync('/Volumes').map((name) => ({ name, path: join('/Volumes', name) }))
  } catch {}
  return [...fixed, ...volumes].filter((place) => isFolder(place.path))
}

/** The newest applied collect run that changed something and was not undone. */
async function lastFix(): Promise<WebLastFix | undefined> {
  const host = createNodeHost()
  for (const run of listRuns().reverse()) {
    const stamp = /^(\d{4}-\d\d-\d\d)_(\d\d)(\d\d)\d\d_collect_apply/.exec(run)
    if (!stamp) continue
    const entries = await readJournal(host, { id: run, dir: join(runsDir(), run) })
    const done = (op: string) => entries.filter((e) => e.t === 'end' && e.op === op).length
    const sets = done('write-set')
    const files = done('copy')
    if (entries.some((e) => e.t === 'undo') || sets + files === 0) continue
    return { run, when: `${stamp[1]} ${stamp[2]}:${stamp[3]}`, sets, files }
  }
  return undefined
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
  const fix = await lastFix()
  return {
    ...(fix ? { lastFix: fix } : {}),
    version: settings.version ?? '',
    home: homedir(),
    places: places(),
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
  }
}

/** Where Live's App-Resources folder may lie in a folder: it is it, the app's Contents, or the app. */
const APP_RESOURCES_IN = ['', 'App-Resources', join('Contents', 'App-Resources')]

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
  const ofLive = name.endsWith('.app') || name === 'contents' || name === 'app-resources'
  return (ofLive && coreLibraryIn(path)) || path
}

/** The folders in `path` ('' = the home folder), hidden ones left out. */
export function webFolders(path: string): WebFolders {
  const folder = absolute(path || homedir())
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

interface Prepared {
  readonly targets: string[]
  readonly flags: DoctorFlags
  readonly vendorLibraries: string[]
}

/** The request as the pipeline takes it; throws what the page should show if it cannot run. */
function prepare(request: WebFixRequest, settings: WebSettings): Prepared {
  if (!Array.isArray(request?.projects) || !Array.isArray(request.search) || !request.options)
    throw new Error('The request names no folders or options.')
  const projects = request.projects.map(absolute)
  if (projects.length === 0) throw new Error('No project folder was given.')
  for (const project of projects)
    if (!existsSync(project)) throw new Error(`This folder does not exist: ${project}`)
  const only = request.only ? absolute(request.only) : ''
  if (only && !projects.some((project) => isInside(only, project)))
    throw new Error(`This folder is not in a project folder that was checked: ${only}`)
  if (only && !isFolder(only)) throw new Error(`This folder does not exist: ${only}`)
  const search = request.search.map((folder) => searchFolder(absolute(folder.path)))
  return {
    targets: only ? [only] : projects,
    flags: {
      // Exactly the folders of the page, the project folders among them: a single project is
      // fixed with the same files to choose from as when all were checked.
      search: [...projects, ...search],
      defaultSearch: false,
      packLimit: String(Math.max(0, Number(request.options.packLimitMB) || 0)),
      matchLibraryPath: Boolean(request.options.matchLibraryPath),
      ...(settings.config ? { config: settings.config } : {}),
    },
    vendorLibraries: request.search
      .filter((folder) => folder.vendor)
      .map((folder) => absolute(folder.path)),
  }
}

function progress(emit: (event: WebEvent) => void, then: 'checking' | 'fixing') {
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

const message = (error: unknown) => (error as Error).message || String(error)

/** A check, like `livesaver doctor`: nothing is written but livesaver's own notes. */
export async function webCheck(
  request: WebRequest,
  emit: (event: WebEvent) => void,
  settings: WebSettings = {},
): Promise<void> {
  try {
    const { targets, flags, vendorLibraries } = prepare(request, settings)
    emit({ type: 'phase', phase: 'indexing' })
    const { result, env, reports } = await collectRun('doctor', targets, flags, {
      vendorLibraries,
      reports: true,
      onEvent: progress(emit, 'checking'),
    })
    emit({ type: 'phase', phase: 'reporting' })
    await writeStateFile(
      rememberedPath(),
      JSON.stringify({
        projects: request.projects,
        search: request.search,
        options: request.options,
      } satisfies Remembered),
    )
    emit({
      type: 'done',
      result: {
        ...checkView(result, env),
        reports: reports ?? {},
        unreadable: result.index.unreadable,
        ableton: {
          userLibrary: env.userLibrary,
          factoryPacks: env.factoryPacks,
          coreLibrary: env.coreLibrary,
          remapEntries: env.config.remap.mapping.size,
        },
      },
    })
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
    if (!settings.force && liveIsRunning()) throw new Error(LIVE_RUNNING)
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
  if (!settings.force && liveIsRunning()) throw new Error(LIVE_RUNNING)
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
