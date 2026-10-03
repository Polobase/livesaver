/** What the page and its engine worker say to each other. */
import type { CheckView } from '@livesaver/ops'
import type { DirectoryHandleLike, FolderSource, FsUsage } from '@livesaver/web'

export type { ChangeRow, MissingRow, ProjectRow, SetRow, SourceRow } from '@livesaver/ops'

export interface FolderInput {
  readonly id: string
  readonly source: FolderSource
  /** Where the folder lies on disk, if the user typed it ('' = work it out from the sets). */
  readonly path: string
  /** Sample folder whose files a vendor may have re-saved (installed libraries, packs). */
  readonly vendor: boolean
}

export interface RunOptions {
  /** Pack files larger than this stay in the pack (megabytes; 0 = never copy). */
  readonly packLimitMB: number
  readonly matchLibraryPath: boolean
}

export interface RunRequest {
  readonly projects: readonly FolderInput[]
  readonly search: readonly FolderInput[]
  readonly options: RunOptions
}

/**
 * A folder as the page sends it to the engine. An uploaded or dropped folder travels as the
 * paths of its files: sending its `File` objects (hundreds of thousands) would block the page
 * for many seconds, so the engine asks for single files when it reads them. A handle travels
 * as it is.
 */
export type WireSource =
  | { readonly kind: 'handle'; readonly name: string; readonly handle: DirectoryHandleLike }
  | { readonly kind: 'listing'; readonly name: string; readonly paths: readonly string[] }

export interface WireFolder extends Omit<FolderInput, 'source'> {
  readonly source: WireSource
}

export type ToEngine =
  | {
      readonly type: 'run'
      readonly projects: readonly WireFolder[]
      readonly search: readonly WireFolder[]
      readonly options: RunOptions
    }
  /** The answer to an `open` event. */
  | { readonly type: 'file'; readonly request: number; readonly file: File | undefined }

export interface LocatedFolder {
  readonly id: string
  readonly path: string
  /** `typed` by the user, `found` in the sets' stored paths, or `unknown` (a stand-in path). */
  readonly how: 'typed' | 'found' | 'unknown'
}

/** A check's result, as the engine in the page or livesaver on this computer delivers it. */
export interface RunResult extends CheckView {
  /** Seconds spent in each phase of the run, where they were measured. */
  readonly phases?: Readonly<Partial<Record<Phase, number>>>
  /** Report files as the command line writes them: name → content. */
  readonly reports: Readonly<Record<string, string>>
  /** Where the folders were placed (a page does not know where a folder lies on disk). */
  readonly folders: readonly LocatedFolder[]
  /** Files fetched and bytes read from the browser (none when the computer itself reads). */
  readonly usage?: FsUsage
  /** Folders the computer could not read (permissions, privacy). */
  readonly unreadable?: readonly string[]
  /** Ableton's own folders among the given ones ('' = not given). */
  readonly ableton: {
    readonly userLibrary: string
    readonly factoryPacks: string
    readonly coreLibrary: string
    /** Entries of Live's table of moved content (0 = App-Resources was not given). */
    readonly remapEntries: number
  }
}

export type Phase = 'locating' | 'indexing' | 'checking' | 'fixing' | 'reporting'

export type EngineEvent =
  | { readonly type: 'phase'; readonly phase: Phase }
  | { readonly type: 'located'; readonly folders: readonly LocatedFolder[] }
  | { readonly type: 'indexed'; readonly files: number }
  | {
      readonly type: 'progress'
      readonly done: number
      readonly total: number
      readonly name: string
    }
  /** The engine needs a file of an uploaded folder (answered with a `file` message). */
  | {
      readonly type: 'open'
      readonly request: number
      readonly folder: string
      readonly index: number
    }
  | { readonly type: 'done'; readonly result: RunResult }
  | { readonly type: 'failed'; readonly message: string }
