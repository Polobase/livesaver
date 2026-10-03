/**
 * What the web app and livesaver on this computer say to each other. The page checks folders by
 * itself in a browser, but only this computer's livesaver can fix what it finds: it reads and
 * writes like the command line does, with the same settings, backups, journal and undo.
 */
import type { CheckView } from '@livesaver/ops'

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

/** The newest fix that was not undone: the page offers to undo it, also after a reload. */
export interface WebLastFix {
  readonly run: string
  /** When it ran, as its run folder is named: `2026-10-03 14:30`. */
  readonly when: string
  readonly sets: number
  readonly files: number
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
  readonly lastFix?: WebLastFix
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
  /** The one project folder to fix; without it, every project is fixed. */
  readonly only?: string
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

export type WebPhase = 'indexing' | 'checking' | 'fixing' | 'reporting'

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
  | { readonly type: 'fixed'; readonly fixed: WebFixed }
  /** `run`: a fix failed on its way, and what it had done until then can be undone. */
  | { readonly type: 'failed'; readonly message: string; readonly run?: string }

/** The header every request carries; the page finds its value in the page it was served. */
export const TOKEN_HEADER = 'x-livesaver-token'
/** The `<meta>` of the page that carries the token (empty where no livesaver serves the page). */
export const TOKEN_META = 'livesaver-local'
