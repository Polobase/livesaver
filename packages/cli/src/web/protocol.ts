/**
 * What the web app and livesaver on this computer say to each other. The page checks folders by
 * itself in a browser, but only this computer's livesaver can fix what it finds: it reads and
 * writes like the command line does, with the same settings, backups, journal and undo.
 */
import type { CheckView, PluginsView, RunStep, RunSummary, UpgradeView } from '@livesaver/ops'

export interface WebOptions {
  /** Pack files larger than this stay in the pack (megabytes; 0 = never copy). */
  readonly packLimitMB: number
  readonly matchLibraryPath: boolean
}

/** A folder to search for samples. */
export interface WebFolder {
  readonly path: string
  /** Its files count as an installed library's: the rules for vendors' files apply. */
  readonly vendor: boolean
}

export interface WebFolderInfo extends WebFolder {
  /** Which of Ableton's own folders it holds, by name (as the page shows them). */
  readonly holds: readonly string[]
  readonly exists: boolean
}

export interface WebPlace {
  readonly name: string
  readonly path: string
}

/** What livesaver found on this computer, for the page to show where things are. */
export interface WebFound {
  /** The settings file livesaver reads ('' = there is none: everything is as it was found). */
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

/** What the page starts with: the last check's folders, else livesaver's settings. */
export interface WebInfo {
  readonly version: string
  readonly home: string
  /** Folders to start browsing from. */
  readonly places: readonly WebPlace[]
  /** The installed Live ('' = none found). */
  readonly live: string
  readonly projects: readonly string[]
  /** Folders checked before on this computer, to offer while no project folder is given. */
  readonly suggested: readonly string[]
  readonly search: readonly WebFolderInfo[]
  readonly options: WebOptions
  readonly found: WebFound
  /** `darwin`, `linux`, `win32`: what this computer can do depends on it (Finder, Live). */
  readonly platform: string
  /** The plug-ins an upgrade from VST2 to VST3 can convert, by name. */
  readonly upgradable: readonly string[]
  /** This computer can show a file in its file manager. */
  readonly reveal?: boolean
}

/** The folders in a folder, for choosing one in the page (a page cannot ask the system for it). */
export interface WebFolders {
  readonly path: string
  /** '' at the top. */
  readonly parent: string
  readonly folders: readonly WebPlace[]
  /** Which of Ableton's own folders `path` holds, by their names. */
  readonly holds: readonly string[]
}

export interface WebRequest {
  readonly projects: readonly string[]
  readonly search: readonly WebFolder[]
  readonly options: WebOptions
}

export interface WebFixRequest extends WebRequest {
  /** The project folder, or folders, to fix; without it, every project is fixed. */
  readonly only?: string | readonly string[]
  /** Leave uncertain matches out: their samples stay missing. */
  readonly certainOnly?: boolean
}

/** A scan: the samples, and the plug-ins the sets use. */
export interface WebScan {
  readonly samples: WebResult
  readonly plugins: PluginsView
  /** Seconds spent in each phase. */
  readonly seconds: Readonly<Partial<Record<WebPhase, number>>>
}

/** The scan livesaver still has: a page that was reloaded shows it without scanning again. */
export interface WebLastScan {
  readonly scan: WebScan
  /** What was scanned. */
  readonly request: WebRequest
  /** When it ended (ISO 8601). */
  readonly at: string
  /** What an upgrade to VST3 would do, once it was planned for these folders. */
  readonly upgrade?: UpgradeView
}

export interface WebUpgradeRequest {
  readonly projects: readonly string[]
  /** Only these plug-ins, by name; without it, every plug-in that can be converted. */
  readonly plugins?: readonly string[]
  /** The project folder, or folders, to upgrade; without it, every project. */
  readonly only?: string | readonly string[]
}

export interface WebUpgraded {
  /** The run, to undo it. */
  readonly run: string
  /** Sets that were rewritten. */
  readonly sets: number
  /** Every plug-in in every set: converted or not, and why. */
  readonly upgrade: UpgradeView
  readonly errors: readonly { readonly set: string; readonly error: string }[]
}

/** A run of the history: what it did, and the report files in its folder. */
export interface WebRun extends RunSummary {
  readonly reports: readonly string[]
}

export interface WebRunDetail {
  readonly run: WebRun
  readonly steps: readonly RunStep[]
}

export interface WebStatus {
  /** Live must be closed before anything is written. */
  readonly liveRunning: boolean
  /** What runs right now ('' = nothing), and how far it is. */
  readonly busy: '' | 'check' | 'scan' | 'plan' | 'fix' | 'upgrade' | 'undo'
  readonly phase?: WebPhase
  readonly done?: number
  readonly total?: number
  /** When the scan livesaver still has ended ('' = it has none). */
  readonly lastScan: string
  /** Free space on the volume of the folder that was asked about (`?path=`), where it is known. */
  readonly freeBytes?: number
}

export interface WebResult extends CheckView {
  /** Report files as the command line writes them: name → content. */
  readonly reports: Readonly<Record<string, string>>
  /** Folders that could not be read (permissions, privacy): what is in them was not seen. */
  readonly unreadable: readonly string[]
  readonly ableton: {
    readonly userLibrary: string
    readonly factoryPacks: string
    readonly coreLibrary: string
    readonly remapEntries: number
  }
}

export interface WebFixed {
  /** The run, to undo it (`livesaver undo <run>` does the same). */
  readonly run: string
  readonly sets: number
  readonly files: number
  readonly bytes: number
  /** Sets that were not written, with the reason. */
  readonly errors: readonly { readonly set: string; readonly error: string }[]
}

export interface WebUndone {
  readonly restored: number
  /** Copied files moved to the Trash. */
  readonly trashed: number
  /** Copied files that stay: another set uses them by now. */
  readonly kept: number
  /** Things changed since the run, which were left alone. */
  readonly changedSince: readonly string[]
  readonly problems: readonly string[]
}

export type WebPhase = 'indexing' | 'checking' | 'plugins' | 'fixing' | 'upgrading' | 'reporting'

/** A run answers with one event per line. */
export type WebEvent =
  | { readonly type: 'phase'; readonly phase: WebPhase }
  | { readonly type: 'indexed'; readonly files: number }
  | {
      readonly type: 'progress'
      readonly done: number
      readonly total: number
      readonly name: string
    }
  | { readonly type: 'done'; readonly result: WebResult }
  | { readonly type: 'scanned'; readonly scan: WebScan; readonly at: string }
  /** What an upgrade of VST2 plug-ins to VST3 would do. */
  | { readonly type: 'planned'; readonly upgrade: UpgradeView }
  | { readonly type: 'fixed'; readonly fixed: WebFixed }
  | { readonly type: 'upgraded'; readonly upgraded: WebUpgraded }
  /** `run`: a fix failed on its way, and what it had done until then can be undone. */
  | { readonly type: 'failed'; readonly message: string; readonly run?: string }

/** The header every request carries; the page finds its value in the page it was served. */
export const TOKEN_HEADER = 'x-livesaver-token'
/** The `<meta>` of the page that carries the token (empty where no livesaver serves the page). */
export const TOKEN_META = 'livesaver-local'
