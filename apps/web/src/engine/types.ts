/**
 * The one contract the app talks to. Two engines implement it: livesaver on this computer
 * (`computer.ts`, over HTTP), which reads the disk itself and can write, and the browser
 * (`browser.ts`, in a worker), which reads only the folders it was handed. What an engine cannot
 * do is said in its capabilities, so a screen can show and explain it instead of hiding it.
 */
import type { CheckView, PluginsView, RunStep, RunSummary, UpgradeView } from '@livesaver/ops'

export type EngineKind = 'computer' | 'browser'

export interface Capabilities {
  /** Folders are named by their paths and read from the disk, not handed over by the browser. */
  readonly paths: boolean
  readonly fix: boolean
  /** Planning and applying an upgrade of VST2 plug-ins to VST3. */
  readonly upgrade: boolean
  readonly undo: boolean
  readonly history: boolean
  /** Showing a file in the system's file manager. */
  readonly reveal: boolean
  /** Knowing which plug-ins are installed: without it, a plug-in's state is `unknown`. */
  readonly installedPlugins: boolean
  /** Telling whether Live is running (it must be closed before anything is written). */
  readonly liveStatus: boolean
  /** The last scan survives a reload of the page. */
  readonly keepsScan: boolean
  /** It has settings of its own, which the folders and options can be reset to. */
  readonly ownSettings: boolean
}

export interface ScanOptions {
  /** Pack files larger than this stay in the pack (megabytes; 0 = never copy). */
  readonly packLimitMB: number
  readonly matchLibraryPath: boolean
}

/** A folder of the library. */
export interface LibraryFolder {
  /** Unique among the folders of the app; the browser engine finds a folder's files by it. */
  readonly id: string
  readonly name: string
  /** Where it lies on disk. A browser does not know: '' unless the user typed it. */
  readonly path: string
  /** A sample folder with installed libraries: the rules for vendors' files apply to it. */
  readonly vendor: boolean
}

export interface ScanRequest {
  readonly projects: readonly LibraryFolder[]
  readonly search: readonly LibraryFolder[]
  /**
   * In a browser: folders that say what is installed (plug-in folders, the folder of Live's
   * plug-in database). livesaver on the computer looks for itself.
   */
  readonly installed?: readonly LibraryFolder[]
  readonly options: ScanOptions
}

export type Phase =
  | 'locating'
  | 'indexing'
  | 'checking'
  | 'plugins'
  | 'fixing'
  | 'upgrading'
  | 'reporting'

export interface LocatedFolder {
  readonly id: string
  readonly path: string
  /** `typed` by the user, `found` in the sets' stored paths, or `unknown` (a stand-in path). */
  readonly how: 'typed' | 'found' | 'unknown'
}

/** How far a run is. */
export type Progress =
  | { readonly type: 'phase'; readonly phase: Phase }
  | { readonly type: 'indexed'; readonly files: number }
  | {
      readonly type: 'progress'
      readonly done: number
      readonly total: number
      readonly name: string
    }
  /** Where a browser placed the folders it was handed. */
  | { readonly type: 'located'; readonly folders: readonly LocatedFolder[] }

export type OnProgress = (progress: Progress) => void

export interface SamplesResult extends CheckView {
  /** Report files as the command line writes them: name → content. */
  readonly reports: Readonly<Record<string, string>>
  /** Folders that could not be read (permissions, privacy): what is in them was not seen. */
  readonly unreadable: readonly string[]
  /** Ableton's own folders among the given ones ('' = not given). */
  readonly ableton: {
    readonly userLibrary: string
    readonly factoryPacks: string
    readonly coreLibrary: string
    readonly remapEntries: number
  }
}

export interface Scan {
  readonly samples: SamplesResult
  readonly plugins: PluginsView
  /** When it ended (ISO 8601). */
  readonly at: string
  readonly seconds: Readonly<Partial<Record<Phase, number>>>
  /** Where a browser placed the folders (it does not know where a folder lies on disk). */
  readonly folders: readonly LocatedFolder[]
  /** In a browser: what the folders that say what is installed held (left out: none given). */
  readonly installed?: {
    /** The plug-in folders that were found, at the paths they were placed at. */
    readonly roots: readonly string[]
    /** Live's plug-in database was among them. */
    readonly database: boolean
  }
}

export interface FixRequest extends ScanRequest {
  /** The project folders to fix (their `root` in the scan); without it, every project. */
  readonly only?: readonly string[]
  /** Leave uncertain matches out: their samples stay missing. */
  readonly certainOnly?: boolean
}

export interface Fixed {
  /** The run, to undo it. */
  readonly run: string
  readonly sets: number
  readonly files: number
  readonly bytes: number
  /** Sets that were not written, with the reason. */
  readonly errors: readonly { readonly set: string; readonly error: string }[]
}

export interface UpgradeRequest {
  readonly projects: readonly LibraryFolder[]
  /** In a browser: the folders that say what is installed, Live's plug-in database among them. */
  readonly installed?: readonly LibraryFolder[]
  /** Only these plug-ins, by name; without it, every plug-in that can be converted. */
  readonly plugins?: readonly string[]
  /** The project folders to upgrade; without it, every project. */
  readonly only?: readonly string[]
}

export interface Upgraded {
  readonly run: string
  readonly sets: number
  readonly upgrade: UpgradeView
  readonly errors: readonly { readonly set: string; readonly error: string }[]
}

export interface Undone {
  readonly restored: number
  /** Copied files moved to the Trash (in a browser: to a hidden folder of the project folder). */
  readonly trashed: number
  /** Copied files that stay: a set that was changed since the run uses them. */
  readonly kept: number
  /** Things changed since the run, which were left alone. */
  readonly changedSince: readonly string[]
  readonly problems: readonly string[]
}

export interface Run extends RunSummary {
  /** The report files in the run's folder. */
  readonly reports: readonly string[]
}

export interface RunDetail {
  readonly run: Run
  readonly steps: readonly RunStep[]
}

export interface Status {
  readonly liveRunning: boolean
  /** What runs right now ('' = nothing): a run goes on when the page is closed. */
  readonly busy: string
  readonly phase?: Phase
  readonly done?: number
  readonly total?: number
  /** Free space on the volume of the folder that was asked about, where it is known. */
  readonly freeBytes?: number
}

export interface Place {
  readonly name: string
  readonly path: string
}

/** The folders in a folder, for choosing one by its path. */
export interface FolderListing {
  readonly path: string
  /** '' at the top. */
  readonly parent: string
  readonly folders: readonly Place[]
  /** Which of Ableton's own folders `path` holds, by their names. */
  readonly holds: readonly string[]
}

/**
 * What a page may do in a folder a browser handed it: only `read` it (an upload, a drop), `edit`
 * it (a folder chosen for editing), or `ask` its user for that (a handle that may only read so
 * far).
 */
export type FolderAccess = 'read' | 'ask' | 'edit'

/** A sample folder as the app starts with it. */
export interface KnownFolder extends LibraryFolder {
  /** Which of Ableton's own folders it holds, by their names. */
  readonly holds: readonly string[]
  readonly exists: boolean
  /** How many files it has, where the browser listed them when it handed the folder over. */
  readonly files?: number
  /** In a browser: what the page may do in it. On this computer livesaver reads and writes. */
  readonly access?: FolderAccess
}

/** Where things are on this computer, as livesaver found them. */
export interface Found {
  /** The settings file livesaver reads ('' = there is none). */
  readonly config: string
  /** Where livesaver keeps its runs: their reports, and the original of every set it rewrote. */
  readonly state: string
  /** Ableton's folders ('' = not there). */
  readonly userLibrary: string
  readonly factoryPacks: string
  readonly coreLibrary: string
  /** The folders and options are those of the last scan, not those of the settings. */
  readonly remembered: boolean
}

/** What the app starts with. */
export interface Start {
  readonly version: string
  /** The installed Live ('' = none found, or not known). */
  readonly live: string
  /** The last scan's folders and options, else this computer's settings. */
  readonly projects: readonly LibraryFolder[]
  readonly search: readonly KnownFolder[]
  readonly options: ScanOptions
  /** Folders checked before, to offer while no project folder is given (paths). */
  readonly suggested: readonly string[]
  /** Folders to start browsing from, and where browsing starts without one. */
  readonly places: readonly Place[]
  readonly home: string
  /** The plug-ins an upgrade can convert, by name. */
  readonly upgradable: readonly string[]
  readonly found?: Found
  /** The scan the engine still has, with what was scanned and the upgrade plan if there is one. */
  readonly last?: {
    readonly scan: Scan
    readonly request: ScanRequest
    readonly upgrade?: UpgradeView
  }
}

/** The engine cannot do this at all (see its capabilities). */
export class Unsupported extends Error {
  constructor(what: string) {
    super(`${what} is not possible here.`)
    this.name = 'Unsupported'
  }
}

/** A run that failed. `run`: it wrote something before it failed, which can be undone. */
export class RunFailed extends Error {
  readonly run: string

  constructor(message: string, run = '') {
    super(message)
    this.name = 'RunFailed'
    this.run = run
  }
}

/** The engine is not there to be asked: nothing works until the page is loaded again. */
export class Unreachable extends RunFailed {
  constructor(message: string) {
    super(message)
    this.name = 'Unreachable'
  }
}

export interface Engine {
  readonly kind: EngineKind
  /**
   * The page did not come from the livesaver it talks to: it was connected to it. Its files
   * are read and written on this computer all the same.
   */
  readonly paired?: boolean
  readonly capabilities: Capabilities
  start(): Promise<Start>
  /** Forgets the folders and options of the last scan, and starts with its own settings again. */
  reset(): Promise<Start>
  /** The samples and the plug-ins of every set. Rejects with `RunFailed`. */
  scan(request: ScanRequest, onProgress?: OnProgress): Promise<Scan>
  /** What an upgrade of VST2 plug-ins to VST3 would do. */
  planUpgrade(request: UpgradeRequest, onProgress?: OnProgress): Promise<UpgradeView>
  fix(request: FixRequest, onProgress?: OnProgress): Promise<Fixed>
  upgrade(request: UpgradeRequest, onProgress?: OnProgress): Promise<Upgraded>
  /**
   * Takes a run back. `library`: the folders the app has now. A browser needs the folder the run
   * changed among them; livesaver on this computer finds it by its path.
   */
  undo(run: string, library?: ScanRequest): Promise<Undone>
  /** Every run, the newest first. */
  runs(): Promise<readonly Run[]>
  run(id: string): Promise<RunDetail>
  report(run: string, name: string): Promise<string>
  /** `folder`: also say how much space is free where it lies (a fix copies files there). */
  status(folder?: string): Promise<Status>
  reveal(path: string): Promise<void>
  folders(path: string): Promise<FolderListing>
}
