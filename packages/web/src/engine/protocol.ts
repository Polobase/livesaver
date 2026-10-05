/** What a page and the engine that scans its folders say to each other. */
import type { CheckView, PluginsView, UpgradeView } from '@livesaver/ops'
import type { FsUsage } from '../fs.js'
import type { DirectoryHandleLike, FolderSource } from '../source.js'
import type { InstalledFolders } from './installed.js'

export interface FolderInput {
  readonly id: string
  readonly source: FolderSource
  /** Where the folder lies on disk, if the user typed it ('' = work it out from the sets). */
  readonly path: string
  /** Sample folder whose files a vendor may have re-saved (installed libraries, packs). */
  readonly vendor: boolean
}

export interface ScanOptions {
  /** Pack files larger than this stay in the pack (megabytes; 0 = never copy). */
  readonly packLimitMB: number
  readonly matchLibraryPath: boolean
  /**
   * Sets last saved by a Live older than this major version are left out: not checked, listed
   * or fixed (0 or absent: every set).
   */
  readonly minLive?: number
}

export interface ScanRequest {
  readonly projects: readonly FolderInput[]
  readonly search: readonly FolderInput[]
  /**
   * Folders that say what is installed: plug-in folders, and the folder of Live's plug-in
   * database. They are not searched for samples.
   */
  readonly installed?: readonly FolderInput[]
  readonly options: ScanOptions
}

/**
 * A folder as the page sends it to the engine's worker. An uploaded or dropped folder travels as
 * the paths of its files: sending its `File` objects (hundreds of thousands) would block the page
 * for many seconds, so the engine asks for single files when it reads them. A handle travels as
 * it is.
 */
export type WireSource =
  | {
      readonly kind: 'handle'
      readonly name: string
      readonly handle: DirectoryHandleLike
      /** The paths of the files the handle hides; the files stay with the page, like a listing's. */
      readonly hidden?: { readonly paths: readonly string[] }
    }
  | { readonly kind: 'listing'; readonly name: string; readonly paths: readonly string[] }

export interface WireFolder extends Omit<FolderInput, 'source'> {
  readonly source: WireSource
}

/** The folders and options of a request, as they travel to the engine's worker. */
export interface WireRequest {
  readonly projects: readonly WireFolder[]
  readonly search: readonly WireFolder[]
  readonly installed?: readonly WireFolder[]
  readonly options: ScanOptions
}

export interface WireUpgrade extends WireRequest {
  readonly names?: readonly string[]
  readonly only?: readonly string[]
}

export type ToEngine =
  | ({ readonly type: 'scan' } & WireRequest)
  | ({
      readonly type: 'fix'
      readonly only?: readonly string[]
      readonly certainOnly?: boolean
    } & WireRequest)
  | ({ readonly type: 'undo'; readonly run: string } & WireRequest)
  /** What an upgrade of plug-ins would do, and the upgrade itself. */
  | ({ readonly type: 'plan-upgrade' } & WireUpgrade)
  | ({ readonly type: 'upgrade' } & WireUpgrade)
  /** The answer to an `open` event. */
  | { readonly type: 'file'; readonly request: number; readonly file: File | undefined }

export interface LocatedFolder {
  readonly id: string
  readonly path: string
  /** `typed` by the user, `found` in the sets' stored paths, or `unknown` (a stand-in path). */
  readonly how: 'typed' | 'found' | 'unknown'
}

export type ScanPhase = 'locating' | 'indexing' | 'checking' | 'plugins' | 'reporting'

/** A scan in a page: the samples, and the plug-ins the sets use. */
export interface BrowserScan {
  readonly samples: CheckView
  /**
   * Which plug-ins the sets use; and whether they are installed, if the page was handed
   * folders that say so (`plugins.inventory`).
   */
  readonly plugins: PluginsView
  /** What the folders that say what is installed held (left out: none were given). */
  readonly installed?: InstalledFolders
  /** Report files as the command line writes them: name → content. */
  readonly reports: Readonly<Record<string, string>>
  /** Where the folders were placed (a page does not know where a folder lies on disk). */
  readonly folders: readonly LocatedFolder[]
  /** Files fetched and bytes read from the browser. */
  readonly usage: FsUsage
  /** Seconds spent in each phase. */
  readonly seconds: Readonly<Partial<Record<ScanPhase, number>>>
  /** Ableton's own folders among the given ones ('' = not given). */
  readonly ableton: {
    readonly userLibrary: string
    readonly factoryPacks: string
    readonly coreLibrary: string
    /** Entries of Live's table of moved content (0 = App-Resources was not given). */
    readonly remapEntries: number
  }
}

/** How far a run is. */
export type ProgressEvent =
  | { readonly type: 'indexed'; readonly files: number }
  | {
      readonly type: 'progress'
      readonly done: number
      readonly total: number
      readonly name: string
    }

export type ScanEvent =
  | { readonly type: 'phase'; readonly phase: ScanPhase }
  | { readonly type: 'located'; readonly folders: readonly LocatedFolder[] }
  | ProgressEvent
  | { readonly type: 'scanned'; readonly scan: BrowserScan }
  | { readonly type: 'failed'; readonly message: string }

/** A fix of the projects that were scanned, or of some of them. */
export interface FixRequest extends ScanRequest {
  /** The project folders to fix, as the scan placed them; without it, every project. */
  readonly only?: readonly string[]
  /** Leave uncertain matches out: their samples stay missing. */
  readonly certainOnly?: boolean
}

/** Taking a run back: the folders the page has now, the run's among them. */
export interface UndoRequest extends ScanRequest {
  readonly run: string
}

export interface BrowserFixed {
  /** The run, to undo it. */
  readonly run: string
  readonly sets: number
  readonly files: number
  readonly bytes: number
  /** Sets that were not written, with the reason. */
  readonly errors: readonly { readonly set: string; readonly error: string }[]
}

export interface BrowserUndone {
  readonly restored: number
  /** Copied files taken out of their projects (to the hidden folder that stands for a Trash). */
  readonly trashed: number
  /** Copied files that stay: another set uses them by now. */
  readonly kept: number
  readonly changedSince: readonly string[]
  readonly problems: readonly string[]
}

export type FixEvent =
  | { readonly type: 'phase'; readonly phase: ScanPhase | 'fixing' }
  | ProgressEvent
  | { readonly type: 'fixed'; readonly fixed: BrowserFixed }
  /** `run`: it wrote something before it failed, which can be undone. */
  | { readonly type: 'failed'; readonly message: string; readonly run?: string }

export type UndoEvent =
  | { readonly type: 'undone'; readonly undone: BrowserUndone }
  | { readonly type: 'failed'; readonly message: string }

/**
 * An upgrade of VST2 plug-ins to VST3, in the projects that were scanned or in some of them.
 * Which VST3 plug-ins Live has is read from its plug-in database, which has to be among the
 * folders that say what is installed.
 */
export interface UpgradeRequest extends ScanRequest {
  /** Only these plug-ins, by name; without it, every plug-in that can be converted. */
  readonly names?: readonly string[]
  /** The project folders to upgrade, as the scan placed them; without it, every project. */
  readonly only?: readonly string[]
}

export interface BrowserUpgraded {
  /** The run, to undo it. */
  readonly run: string
  readonly sets: number
  readonly upgrade: UpgradeView
  /** Sets that were not written, with the reason. */
  readonly errors: readonly { readonly set: string; readonly error: string }[]
}

export type UpgradeEvent =
  | { readonly type: 'phase'; readonly phase: ScanPhase | 'upgrading' }
  | ProgressEvent
  | { readonly type: 'planned'; readonly upgrade: UpgradeView }
  | { readonly type: 'upgraded'; readonly upgraded: BrowserUpgraded }
  /** `run`: it wrote something before it failed, which can be undone. */
  | { readonly type: 'failed'; readonly message: string; readonly run?: string }

/** What the engine's worker posts: the events of a run, and its requests for files. */
export type FromEngine =
  | ScanEvent
  | FixEvent
  | UndoEvent
  | UpgradeEvent
  /** The engine needs a file of an uploaded folder (answered with a `file` message). */
  | {
      readonly type: 'open'
      readonly request: number
      readonly folder: string
      readonly index: number
    }
