/**
 * A fix in the browser: the pipeline of `livesaver collect --apply`, writing through the handles
 * of folders the user gave the page for editing, and keeping the run in the page's own storage
 * so that it can be undone. What a browser cannot do stays undone and is said by the app: it
 * cannot see whether Live runs, a rewritten set loses its Finder tags and comment, and a folder
 * handle hides files with some names.
 */
import { posix } from '@livesaver/core'
import {
  applyWriter,
  buildReports,
  doctor,
  isInside,
  journalPath,
  type RunContext,
  readJournal,
  undoRun,
} from '@livesaver/ops'
import { createWebHost, type WebHost } from '../host.js'
import { folderFromHandle } from '../source.js'
import type { WritableDirectoryHandleLike, WritableMount } from '../write.js'
import type {
  BrowserFixed,
  BrowserUndone,
  FixEvent,
  FixRequest,
  FolderInput,
  ScanRequest,
  UndoEvent,
  UndoRequest,
} from './protocol.js'
import {
  type BrowserRun,
  type BrowserRunDetail,
  endRun,
  listRuns,
  newRun,
  runDetail,
  runFolder,
  runReport,
  STATE_PATH,
} from './runs.js'
import { type Prepared, prepare, type ScanEngineOptions } from './scan.js'

/** The page's own storage, where the runs are kept. */
export type StateFolder = () => Promise<WritableDirectoryHandleLike>

export interface WriteEngineOptions extends ScanEngineOptions {
  readonly state: StateFolder
  /**
   * Runs `work` while nothing else of the page writes (another tab), and rejects if something
   * does: two runs at once would journal over each other. Without it, the work just runs.
   */
  readonly exclusive?: (work: () => Promise<void>) => Promise<void>
}

/** A handle that also writes: a folder the user chose for editing. */
const writableHandle = (folder: FolderInput): WritableDirectoryHandleLike | undefined => {
  const { source } = folder
  return source.kind === 'handle' && 'getFileHandle' in source.handle
    ? (source.handle as WritableDirectoryHandleLike)
    : undefined
}

/** The folders of a request with the page's storage beside them, and write access to both. */
export async function prepareToWrite(request: ScanRequest, options: WriteEngineOptions) {
  if (request.projects.length === 0) throw new Error('No project folder was given.')
  for (const folder of request.projects)
    if (!writableHandle(folder))
      throw new Error(
        `The project folder “${folder.source.name}” was not given for editing: choose it again, and allow this page to edit it.`,
      )
  const handle = await options.state()
  const state = { path: STATE_PATH, handle, source: folderFromHandle(handle) }
  return prepare(request, options, {
    extra: [state],
    // The project folders come first among the mounts. A sample folder is never written to,
    // even if its handle would allow it.
    folders: (mounts) =>
      request.projects.map(
        (folder, i): WritableMount => ({
          path: (mounts[i] as { path: string }).path,
          handle: writableHandle(folder) as WritableDirectoryHandleLike,
        }),
      ),
  })
}

/**
 * A fix writes into the sets where their files lie: in their project, or in a pack that keeps
 * its large files. So the place of every project folder has to be known, and that of a folder
 * with Ableton's packs or Live's own content; a stand-in path must never get into a set.
 */
function unplaced(request: ScanRequest, prepared: Prepared): string[] {
  const { factoryPacks, appResources } = prepared.config
  const inputs = [...request.projects, ...request.search]
  return prepared.folders
    .map((folder, i) => ({ folder, name: (inputs[i] as FolderInput).source.name, project: i }))
    .filter(
      ({ folder, project }) =>
        folder.how === 'unknown' &&
        (project < request.projects.length ||
          [factoryPacks, appResources].some((own) => own && isInside(own, folder.path))),
    )
    .map(({ name }) => name)
}

/** Runs `work` while nothing else of the page writes. */
export const alone = (options: WriteEngineOptions, work: () => Promise<void>) =>
  options.exclusive ? options.exclusive(work) : work()

/** The projects of a request that were asked for, or all: each lies in a folder that was given. */
export async function targetsOf(
  prepared: Prepared,
  asked: readonly string[] | undefined,
): Promise<readonly string[]> {
  const only = (asked ?? []).map((root) => posix.normpath(root))
  for (const root of only) {
    if (!prepared.targets.some((target) => isInside(root, target)))
      throw new Error(`This folder is not in a project folder that was scanned: ${root}`)
    if ((await prepared.host.fs.kind(root)) !== 'directory')
      throw new Error(`This folder does not exist: ${root}`)
  }
  return only.length ? only : prepared.targets
}

export async function fixFolders(
  request: FixRequest,
  emit: (event: FixEvent) => void,
  options: WriteEngineOptions,
): Promise<void> {
  let run: RunContext | undefined
  let host: WebHost | undefined
  let close = async () => {}
  try {
    await alone(options, async () => {
      emit({ type: 'phase', phase: 'locating' })
      const prepared = await prepareToWrite(request, options)
      host = prepared.host
      close = () => prepared.parser.close()
      const { probe, searchRoots, config, parser } = prepared
      const nowhere = unplaced(request, prepared)
      if (nowhere.length)
        throw new Error(
          `livesaver does not know where ${nowhere.map((name) => `“${name}”`).join(' and ')} ${nowhere.length === 1 ? 'lies' : 'lie'} on your disk, and a fix writes into the sets where their files are. Set the path of the folder, scan again, and fix then.`,
        )
      const targets = await targetsOf(prepared, request.only)

      run = await newRun(host, 'collect', {
        targets,
        options: {
          search: searchRoots,
          packLimit: request.options.packLimitMB,
          matchLibraryPath: request.options.matchLibraryPath,
          certainOnly: Boolean(request.certainOnly),
          ...(request.options.minLive ? { minLive: request.options.minLive } : {}),
          vendorLibraries: config.vendorLibraries,
        },
      })
      emit({ type: 'phase', phase: 'indexing' })
      const result = await doctor(host, {
        targets,
        // Every folder of the page, the project folders among them: a single project is fixed
        // with the same files to choose from as when all were scanned.
        searchRoots,
        env: config,
        packCopyLimit: Math.trunc(request.options.packLimitMB * 1_000_000),
        matchLibraryPath: request.options.matchLibraryPath,
        certainOnly: Boolean(request.certainOnly),
        minLive: request.options.minLive ?? 0,
        parser,
        probe,
        writer: applyWriter(host, run, probe),
        onEvent: (e) => {
          if (e.type === 'index') {
            emit({ type: 'indexed', files: e.files })
            emit({ type: 'phase', phase: 'fixing' })
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

      emit({ type: 'phase', phase: 'reporting' })
      const reports = await buildReports(result.results, result.base, probe)
      for (const [name, content] of Object.entries(reports))
        await host.write?.writeFile(posix.join(run.dir, name), content)
      const fixed: BrowserFixed = {
        run: run.id,
        sets: result.results.filter((set) => set.written).length,
        files: result.projects.reduce((n, project) => n + project.copiedFiles, 0),
        bytes: result.projects.reduce((n, project) => n + project.copiedBytes, 0),
        errors: result.results
          .filter((set) => set.error)
          .map((set) => ({ set: set.setPath, error: set.error })),
      }
      await endRun(host, run, {
        sets: result.results.length,
        changingSets: result.results.filter((set) => !set.error && set.changes.length > 0).length,
        written: fixed.sets,
        files: fixed.files,
        bytes: fixed.bytes,
        errors: fixed.errors.length,
      })
      emit({ type: 'fixed', fixed })
    })
  } catch (error) {
    const message = (error as Error).message || String(error)
    let wrote = false
    if (run && host) {
      await endRun(host, run, {}, message).catch(() => {})
      wrote = (await host.fs.kind(journalPath(run)).catch(() => undefined)) === 'file'
    }
    // What it wrote before it failed is in its journal, and can be undone.
    emit({ type: 'failed', message, ...(run && wrote ? { run: run.id } : {}) })
  } finally {
    await close().catch(() => {})
  }
}

/**
 * Takes a run back, like `livesaver undo`. The page needs the folders the run changed again,
 * for editing, and at the place they had: the journal names every file by its path.
 */
export async function undoFolders(
  request: UndoRequest,
  emit: (event: UndoEvent) => void,
  options: WriteEngineOptions,
): Promise<void> {
  let close = async () => {}
  try {
    await alone(options, async () => {
      const { host, config, parser, targets } = await prepareToWrite(request, options)
      close = () => parser.close()
      const run = runFolder(request.run)
      const entries = await readJournal(host, run)
      if (entries.length === 0)
        throw new Error(`This is not a run that changed anything: ${request.run}`)
      const elsewhere = entries
        .flatMap((entry) =>
          entry.t !== 'begin'
            ? []
            : entry.op === 'write-set'
              ? [entry.set]
              : entry.op === 'copy'
                ? [entry.destination]
                : [],
        )
        .find((path) => !targets.some((target) => isInside(path, target)))
      if (elsewhere !== undefined)
        throw new Error(
          `This run changed ${elsewhere}, which is not in a project folder this page has now (${targets.join(', ')}). Give it the folder that was fixed, with the same path, and undo again.`,
        )
      const report = await undoRun(host, run, config)
      const undone: BrowserUndone = {
        restored: report.restored.length,
        trashed: report.trashed.length,
        kept: report.stillUsed.length,
        changedSince: report.changedSince,
        problems: [...report.unfinished, ...report.problems],
      }
      emit({ type: 'undone', undone })
    })
  } catch (error) {
    emit({ type: 'failed', message: (error as Error).message || String(error) })
  } finally {
    await close().catch(() => {})
  }
}

/** A host over the page's storage alone: what the history needs, without any folder. */
async function stateHost(state: StateFolder): Promise<WebHost> {
  return createWebHost([{ path: STATE_PATH, source: folderFromHandle(await state()) }])
}

/** Every run this browser keeps for the page, the newest first. */
export async function browserRuns(state: StateFolder): Promise<BrowserRun[]> {
  return listRuns(await stateHost(state))
}

export async function browserRun(state: StateFolder, id: string): Promise<BrowserRunDetail> {
  return runDetail(await stateHost(state), id)
}

/** A report file of a run, as text. */
export async function browserReport(state: StateFolder, id: string, name: string): Promise<string> {
  return runReport(await stateHost(state), id, name)
}
