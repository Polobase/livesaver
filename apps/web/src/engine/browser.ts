/**
 * The browser as the engine: a worker reads the folders the page was handed. It does not know
 * where a folder lies on disk, and it cannot see what is installed. It only reads, unless its
 * user switched fixing on (Chrome and Edge): then it writes into project folders that were
 * chosen for editing, and keeps its runs, with what an undo needs, in the page's own storage.
 */

import type { UpgradeView } from '@livesaver/ops'
import {
  browserReport,
  browserRun,
  browserRuns,
  type DirectoryHandleLike,
  EngineFailure,
  type EngineWorker,
  type FolderSource,
  fixInWorker,
  folderFromHandle,
  holdsNames,
  holdsOf,
  installedHoldsOf,
  lostBehindHandle,
  planUpgradeInWorker,
  type ScanEvent,
  type StateFolder,
  scanInWorker,
  undoInWorker,
  upgradeInWorker,
} from '@livesaver/web'
import { LIBRARY_NAME } from '../lib/library.js'
import type { FolderKind, FolderMemory, Remembered } from './memory.js'
import {
  type Capabilities,
  type Engine,
  type Fixed,
  type FixRequest,
  type FolderAccess,
  type KnownFolder,
  type LibraryFolder,
  type OnProgress,
  type Run,
  type RunDetail,
  RunFailed,
  type Scan,
  type ScanOptions,
  type ScanRequest,
  type Start,
  type Status,
  type Undone,
  Unsupported,
  type Upgraded,
  type UpgradeRequest,
} from './types.js'

export interface BrowserOptions {
  /** Starts the engine's worker (its script calls `serveEngine`). */
  readonly spawn: () => EngineWorker
  readonly version?: string
  /** The page's own storage for the runs of a fix; without it the engine only reads. */
  readonly state?: StateFolder
  /** Whether fixing in the browser is switched on. Asked each time: it is a setting. */
  readonly writing?: () => boolean
  /** Where the folders are kept for the next visit; without it nothing is remembered. */
  readonly memory?: FolderMemory
}

type Permission = 'granted' | 'denied' | 'prompt'
type Mode = 'read' | 'readwrite'

/** A folder handle of a browser, as far as what the page may do in it goes. */
interface Permitted {
  queryPermission?(how: { mode: Mode }): Promise<Permission>
  requestPermission?(how: { mode: Mode }): Promise<Permission>
}

/** What of a folder a browser lets a page keep: its handle, and how many files that hides. */
interface Keepable {
  readonly handle: DirectoryHandleLike & Permitted
  readonly lost: number
}

export class BrowserEngine implements Engine {
  readonly kind = 'browser'
  private readonly options: BrowserOptions
  /** The files of the folders stay with the page; a folder is known to the app by its id. */
  private readonly sources = new Map<string, FolderSource>()
  /** The folders that can be kept for the next visit as more than their names. */
  private readonly keepable = new Map<string, Keepable>()
  /** Folders of the last visit that the browser wants to be asked for again, with their lists. */
  private readonly asleep = new Map<string, FolderKind>()
  private restored: Promise<Record<FolderKind, KnownFolder[]>> | undefined
  private ids = 0
  private running: { stop(): void } | undefined
  /** What writes right now ('' = nothing): a fix or an undo is never stopped half-way. */
  private writes: '' | 'fix' | 'undo' | 'upgrade' = ''

  constructor(options: BrowserOptions) {
    this.options = options
  }

  /** Fixing is switched on, and the browser has what it takes. */
  private get writing(): boolean {
    return this.options.state !== undefined && (this.options.writing?.() ?? false)
  }

  get capabilities(): Capabilities {
    const writing = this.writing
    return {
      paths: false,
      fix: writing,
      // (Which VST3 plug-ins Live has, it reads from Live's database, if it is handed that.)
      upgrade: writing,
      undo: writing,
      history: writing,
      reveal: false,
      installedPlugins: false,
      liveStatus: false,
      keepsScan: false,
      ownSettings: false,
    }
  }

  /** The page's storage, or the refusal of something that needs it. */
  private storage(what: string): StateFolder {
    if (!this.writing || !this.options.state) throw new Unsupported(what)
    return this.options.state
  }

  /**
   * Takes a folder the page was handed (uploaded, dropped, chosen) and returns it as the app
   * knows it. A sample folder that looks like a vendor's is marked as holding installed
   * libraries. What the page may do in a folder behind a handle is asked with `access`.
   */
  add(source: FolderSource, kind: FolderKind): KnownFolder {
    const id = `folder-${++this.ids}`
    this.sources.set(id, source)
    // A folder behind a handle is read through it now, so reading it through it next time
    // loses nothing. A dropped folder is read through its entries, which show every file:
    // its handle may show fewer.
    if (source.kind === 'handle') this.keepable.set(id, { handle: source.handle, lost: 0 })
    else if (source.kind === 'listing' && source.kept)
      this.keepable.set(id, { handle: source.kept, lost: lostBehindHandle(source.paths) })
    const files =
      source.kind === 'files'
        ? source.files.length
        : source.kind === 'listing'
          ? source.paths.length
          : undefined
    return {
      id,
      name: source.name || '(folder)',
      path: '',
      vendor: kind === 'search' && LIBRARY_NAME.test(source.name),
      holds: kind === 'installed' ? installedHoldsOf(source) : holdsNames(holdsOf(source)),
      exists: true,
      ...(files === undefined ? {} : { files }),
      access: this.handle(id) ? 'ask' : 'read',
    }
  }

  /** Lets go of a folder's files. */
  remove(id: string): void {
    this.sources.delete(id)
    this.keepable.delete(id)
    this.asleep.delete(id)
  }

  /**
   * Notes the folders as the app has them now, for the next visit: the lists with what was
   * typed and ticked, and of each folder what the browser lets a page keep of it.
   */
  async keep(lists: Readonly<Record<FolderKind, readonly KnownFolder[]>>): Promise<void> {
    if (!this.options.memory) return
    const records: Remembered[] = []
    for (const kind of ['projects', 'search', 'installed'] as const)
      for (const folder of lists[kind]) {
        const kept = this.keepable.get(folder.id)
        records.push({
          id: folder.id,
          kind,
          name: folder.name,
          path: folder.path,
          vendor: folder.vendor,
          // (Made anew: the app's state wraps what it keeps, and a browser stores no wrapper.)
          holds: [...folder.holds],
          ...(folder.files === undefined ? {} : { files: folder.files }),
          ...(kept
            ? { handle: kept.handle, lost: kept.lost }
            : folder.lost
              ? { lost: folder.lost }
              : {}),
        })
      }
    await this.options.memory.keep(records)
  }

  /** Notes how a scan matches, for the next visit. */
  keepOptions(options: ScanOptions): void {
    this.options.memory?.keepOptions({
      packLimitMB: options.packLimitMB,
      matchLibraryPath: options.matchLibraryPath,
    })
  }

  /** The folders of the last visit, as far as they were kept: each is read again, or waits. */
  private async restore(): Promise<Record<FolderKind, KnownFolder[]>> {
    const lists: Record<FolderKind, KnownFolder[]> = { projects: [], search: [], installed: [] }
    for (const record of (await this.options.memory?.all()) ?? []) {
      // New folders are numbered on from those of the last visit.
      this.ids = Math.max(this.ids, Number(/^folder-(\d+)$/.exec(record.id)?.[1] ?? 0))
      const folder: KnownFolder = {
        id: record.id,
        name: record.name,
        path: record.path,
        vendor: record.vendor,
        holds: record.holds,
        exists: true,
        ...(record.files === undefined ? {} : { files: record.files }),
      }
      const handle = record.handle as (DirectoryHandleLike & Permitted) | undefined
      if (!handle || record.lost) {
        // Handed over for that visit only; or kept, but showing less than there is.
        lists[record.kind].push({
          ...folder,
          waits: 'folder',
          ...(record.lost ? { lost: record.lost } : {}),
        })
        continue
      }
      this.keepable.set(record.id, { handle, lost: 0 })
      const may = handle.queryPermission
        ? await handle.queryPermission({ mode: 'read' })
        : 'granted'
      if (may === 'granted') {
        this.sources.set(record.id, folderFromHandle(handle))
        lists[record.kind].push({ ...folder, access: 'ask' })
      } else {
        this.asleep.set(record.id, record.kind)
        lists[record.kind].push({ ...folder, waits: 'permission' })
      }
    }
    return lists
  }

  /**
   * Asks the user of the browser to let the page read a folder of the last visit again (and,
   * with fixing switched on, edit a project folder). A browser only asks in answer to a
   * click. `false`: it was not allowed.
   */
  async allow(id: string): Promise<boolean> {
    const kind = this.asleep.get(id)
    const kept = this.keepable.get(id)
    if (!kind || !kept) return this.sources.has(id)
    const mode: Mode = kind === 'projects' && this.writing ? 'readwrite' : 'read'
    const answer = kept.handle.requestPermission
      ? await kept.handle.requestPermission({ mode })
      : 'granted'
    if (answer !== 'granted') return false
    this.asleep.delete(id)
    this.sources.set(id, folderFromHandle(kept.handle))
    return true
  }

  /** The handle of a folder that can be written through, if it was handed over as one. */
  private handle(id: string): Permitted | undefined {
    const source = this.sources.get(id)
    return source?.kind === 'handle' && 'getFileHandle' in source.handle
      ? (source.handle as Permitted)
      : undefined
  }

  /** What the page may do in a folder right now. */
  async access(id: string): Promise<FolderAccess> {
    const handle = this.handle(id)
    if (!handle) return 'read'
    if (!handle.queryPermission) return 'edit'
    return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'edit' : 'ask'
  }

  /**
   * Asks the user of the browser whether the page may edit a folder. A browser only asks in
   * answer to a click, so this has to be called from one.
   */
  async allowEditing(id: string): Promise<FolderAccess> {
    const handle = this.handle(id)
    if (!handle) return 'read'
    if (!handle.requestPermission) return 'edit'
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted' ? 'edit' : 'ask'
  }

  /** Ends a scan that is running; its promise rejects. */
  stop(): void {
    this.running?.stop()
  }

  private input(folder: LibraryFolder) {
    const source = this.sources.get(folder.id)
    // After a reload the page has the names of its folders at most, not their files.
    if (!source) throw new RunFailed(`The folder "${folder.name}" has to be added again.`)
    return { id: folder.id, source, path: folder.path, vendor: folder.vendor }
  }

  /**
   * A request as it goes to a worker. Everything in it is made anew here: an app keeps what its
   * user chose in a state that wraps it (Vue's does), and a browser refuses to send a wrapped
   * object to a worker.
   */
  private inputs(request: ScanRequest) {
    return {
      projects: request.projects.map((folder) => this.input(folder)),
      search: request.search.map((folder) => this.input(folder)),
      ...(request.installed?.length
        ? { installed: request.installed.map((folder) => this.input(folder)) }
        : {}),
      options: { ...request.options },
    }
  }

  async start(): Promise<Start> {
    this.restored ??= this.restore()
    const { projects, search, installed } = await this.restored
    return {
      version: this.options.version ?? '',
      live: '',
      projects,
      search,
      ...(installed.length ? { installed } : {}),
      options: this.options.memory?.options() ?? { packLimitMB: 50, matchLibraryPath: false },
      suggested: [],
      places: [],
      home: '',
      upgradable: [],
    }
  }

  async scan(request: ScanRequest, onProgress?: OnProgress): Promise<Scan> {
    if (this.writes) throw new RunFailed(`A scan has to wait: the ${this.writes} is still running.`)
    this.stop()
    let running: ReturnType<typeof scanInWorker>
    try {
      running = scanInWorker(this.options.spawn, this.inputs(request), (event: ScanEvent) => {
        if (event.type !== 'scanned' && event.type !== 'failed') onProgress?.(event)
      })
    } catch (error) {
      throw new RunFailed((error as Error).message)
    }
    this.running = running
    try {
      const scan = await running.result
      return {
        samples: { ...scan.samples, reports: scan.reports, unreadable: [], ableton: scan.ableton },
        plugins: scan.plugins,
        at: new Date().toISOString(),
        seconds: scan.seconds,
        folders: scan.folders,
        ...(scan.installed ? { installed: scan.installed } : {}),
      }
    } catch (error) {
      throw new RunFailed((error as Error).message)
    } finally {
      if (this.running === running) this.running = undefined
    }
  }

  /** One run that writes, in a worker of its own; what fails is a `RunFailed`. */
  private async write<T>(what: 'fix' | 'undo' | 'upgrade', work: () => Promise<T>): Promise<T> {
    if (this.writes) throw new RunFailed(`The ${this.writes} that was started is still running.`)
    // Nothing reads while something writes: a scan in between would see half of it.
    this.stop()
    this.writes = what
    try {
      return await work()
    } catch (error) {
      if (error instanceof RunFailed) throw error
      throw new RunFailed((error as Error).message, error instanceof EngineFailure ? error.run : '')
    } finally {
      this.writes = ''
    }
  }

  /** Refuses unless the page may edit every project folder. */
  private async editable(projects: readonly LibraryFolder[]): Promise<void> {
    for (const folder of projects)
      if ((await this.access(folder.id)) !== 'edit')
        throw new RunFailed(
          this.handle(folder.id)
            ? `This page may not edit the project folder “${folder.name}” yet: allow it first.`
            : `The project folder “${folder.name}” was added to be read only: add it again with “Add folder”, for editing.`,
        )
  }

  async fix(request: FixRequest, onProgress?: OnProgress): Promise<Fixed> {
    this.storage('Fixing')
    return this.write('fix', async () => {
      const folders = this.inputs(request)
      await this.editable(request.projects)
      return fixInWorker(
        this.options.spawn,
        {
          ...folders,
          ...(request.only ? { only: [...request.only] } : {}),
          ...(request.certainOnly ? { certainOnly: true } : {}),
        },
        (event) => {
          if (event.type !== 'fixed' && event.type !== 'failed') onProgress?.(event)
        },
      )
    })
  }

  async undo(run: string, library?: ScanRequest): Promise<Undone> {
    this.storage('Undo')
    return this.write('undo', async () => {
      if (!library?.projects.length)
        throw new RunFailed(
          'To take this run back, the page needs the project folder it changed: add it again, for editing, and undo then.',
        )
      return undoInWorker(this.options.spawn, { ...this.inputs(library), run })
    })
  }

  async status(): Promise<Status> {
    return { liveRunning: false, busy: this.writes || (this.running ? 'scan' : '') }
  }

  async runs(): Promise<readonly Run[]> {
    return this.writing && this.options.state ? browserRuns(this.options.state) : []
  }

  async run(id: string): Promise<RunDetail> {
    const state = this.storage('A history of runs')
    return browserRun(state, id).catch((error: unknown) => {
      throw new RunFailed((error as Error).message)
    })
  }

  async report(run: string, name: string): Promise<string> {
    const state = this.storage('A history of runs')
    return browserReport(state, run, name).catch((error: unknown) => {
      throw new RunFailed((error as Error).message)
    })
  }

  reset(): Promise<never> {
    return Promise.reject(new Unsupported('Resetting to settings of its own'))
  }

  /** The folders of an upgrade: the projects, and what says which VST3 plug-ins Live has. */
  private upgradeOf(request: UpgradeRequest) {
    return {
      ...this.inputs({
        projects: request.projects,
        search: [],
        ...(request.installed ? { installed: request.installed } : {}),
        options: { packLimitMB: 0, matchLibraryPath: false },
      }),
      ...(request.plugins ? { names: [...request.plugins] } : {}),
      ...(request.only ? { only: [...request.only] } : {}),
    }
  }

  async planUpgrade(request: UpgradeRequest, onProgress?: OnProgress): Promise<UpgradeView> {
    this.storage('Planning an upgrade of plug-ins')
    try {
      return await planUpgradeInWorker(this.options.spawn, this.upgradeOf(request), (event) => {
        if (event.type === 'phase' || event.type === 'progress') onProgress?.(event)
      })
    } catch (error) {
      throw error instanceof RunFailed ? error : new RunFailed((error as Error).message)
    }
  }

  async upgrade(request: UpgradeRequest, onProgress?: OnProgress): Promise<Upgraded> {
    this.storage('Upgrading plug-ins')
    return this.write('upgrade', async () => {
      const folders = this.upgradeOf(request)
      await this.editable(request.projects)
      return upgradeInWorker(this.options.spawn, folders, (event) => {
        if (event.type === 'phase' || event.type === 'progress') onProgress?.(event)
      })
    })
  }

  reveal(): Promise<never> {
    return Promise.reject(new Unsupported('Showing a file in Finder'))
  }

  folders(): Promise<never> {
    return Promise.reject(new Unsupported('Browsing the folders of this computer'))
  }
}
