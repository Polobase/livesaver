/**
 * The browser as the engine: a worker reads the folders the page was handed. It can only read,
 * it does not know where a folder lies on disk, and it cannot see what is installed, so it scans
 * and nothing more. (Fixing in the browser is a later step, and for Chrome and Edge only.)
 */
import {
  type EngineWorker,
  type FolderSource,
  holdsNames,
  holdsOf,
  type ScanEvent,
  scanInWorker,
} from '@livesaver/web'
import { LIBRARY_NAME } from '../lib/library.js'
import {
  type Capabilities,
  type Engine,
  type KnownFolder,
  type LibraryFolder,
  type OnProgress,
  RunFailed,
  type Scan,
  type ScanRequest,
  type Start,
  type Status,
  Unsupported,
} from './types.js'

export interface BrowserOptions {
  /** Starts the engine's worker (its script calls `serveEngine`). */
  readonly spawn: () => EngineWorker
  readonly version?: string
}

export class BrowserEngine implements Engine {
  readonly kind = 'browser'
  readonly capabilities: Capabilities = {
    paths: false,
    fix: false,
    upgrade: false,
    undo: false,
    history: false,
    reveal: false,
    installedPlugins: false,
    liveStatus: false,
    keepsScan: false,
  }
  private readonly options: BrowserOptions
  /** The files of the folders stay with the page; a folder is known to the app by its id. */
  private readonly sources = new Map<string, FolderSource>()
  private ids = 0
  private running: { stop(): void } | undefined

  constructor(options: BrowserOptions) {
    this.options = options
  }

  /**
   * Takes a folder the page was handed (uploaded, dropped) and returns it as the app knows it.
   * A sample folder that looks like a vendor's is marked as holding installed libraries.
   */
  add(source: FolderSource, kind: 'projects' | 'search'): KnownFolder {
    const id = `folder-${++this.ids}`
    this.sources.set(id, source)
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
      holds: holdsNames(holdsOf(source)),
      exists: true,
      ...(files === undefined ? {} : { files }),
    }
  }

  /** Lets go of a folder's files. */
  remove(id: string): void {
    this.sources.delete(id)
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

  async start(): Promise<Start> {
    return {
      version: this.options.version ?? '',
      live: '',
      projects: [],
      search: [],
      options: { packLimitMB: 50, matchLibraryPath: false },
      suggested: [],
      places: [],
      home: '',
      upgradable: [],
    }
  }

  async scan(request: ScanRequest, onProgress?: OnProgress): Promise<Scan> {
    this.stop()
    const running = scanInWorker(
      this.options.spawn,
      {
        projects: request.projects.map((folder) => this.input(folder)),
        search: request.search.map((folder) => this.input(folder)),
        options: request.options,
      },
      (event: ScanEvent) => {
        if (event.type !== 'scanned' && event.type !== 'failed') onProgress?.(event)
      },
    )
    this.running = running
    try {
      const scan = await running.result
      return {
        samples: { ...scan.samples, reports: scan.reports, unreadable: [], ableton: scan.ableton },
        plugins: scan.plugins,
        at: new Date().toISOString(),
        seconds: scan.seconds,
        folders: scan.folders,
      }
    } catch (error) {
      throw new RunFailed((error as Error).message)
    } finally {
      if (this.running === running) this.running = undefined
    }
  }

  async status(): Promise<Status> {
    return { liveRunning: false, busy: this.running ? 'scan' : '' }
  }

  async runs(): Promise<readonly never[]> {
    return []
  }

  planUpgrade(): Promise<never> {
    return Promise.reject(new Unsupported('Planning an upgrade of plug-ins'))
  }

  fix(): Promise<never> {
    return Promise.reject(new Unsupported('Fixing'))
  }

  upgrade(): Promise<never> {
    return Promise.reject(new Unsupported('Upgrading plug-ins'))
  }

  undo(): Promise<never> {
    return Promise.reject(new Unsupported('Undo'))
  }

  run(): Promise<never> {
    return Promise.reject(new Unsupported('A history of runs'))
  }

  report(): Promise<never> {
    return Promise.reject(new Unsupported('A history of runs'))
  }

  reveal(): Promise<never> {
    return Promise.reject(new Unsupported('Showing a file in Finder'))
  }

  folders(): Promise<never> {
    return Promise.reject(new Unsupported('Browsing the folders of this computer'))
  }
}
