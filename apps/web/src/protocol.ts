/** What the page and its engine worker say to each other. */
import type { CheckView } from '@livesaver/ops'
import type { FsUsage, LocatedFolder, ScanOptions, WireFolder } from '@livesaver/web'

export type { ChangeRow, MissingRow, ProjectRow, SetRow, SourceRow } from '@livesaver/ops'

export type {
  FolderInput,
  LocatedFolder,
  ScanOptions as RunOptions,
  ScanRequest as RunRequest,
  WireFolder,
  WireSource,
} from '@livesaver/web'

export type ToEngine =
  | {
      readonly type: 'run'
      readonly projects: readonly WireFolder[]
      readonly search: readonly WireFolder[]
      readonly options: ScanOptions
    }
  /** The answer to an `open` event. */
  | { readonly type: 'file'; readonly request: number; readonly file: File | undefined }

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

export type Phase =
  | 'locating'
  | 'indexing'
  | 'checking'
  | 'plugins'
  | 'fixing'
  | 'upgrading'
  | 'reporting'

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
