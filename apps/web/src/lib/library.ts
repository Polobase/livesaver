/** The folders of a library: which of Ableton's own they hold, and what a full scan still wants. */
import type { KnownFolder } from '../engine/types.js'

/**
 * Folders in which vendors keep installed libraries: Native Instruments uses /Users/Shared, and
 * its libraries are called "… Library". (Ableton's own folders are recognised without this.)
 */
export const LIBRARY_NAME = /^(shared|native instruments)$|^(?!user |core ).+ librar(y|ies)$/i

/** The name the engines give Live's own content among the things a folder holds. */
export const LIVE_CONTENT = "Live's own content"

export interface Wanted {
  /** The User Library and the Factory Packs: `Music/Ableton` in the home folder. */
  readonly libraries: boolean
  /** The Core Library and Live's list of content it moved, inside the Live app. */
  readonly live: boolean
}

/** What a complete scan needs and is not among the sample folders yet. */
export function wantedOf(search: readonly Pick<KnownFolder, 'holds'>[]): Wanted {
  const holds = new Set(search.flatMap((folder) => folder.holds))
  return {
    libraries: !holds.has('User Library') && !holds.has('Factory Packs'),
    live: !holds.has(LIVE_CONTENT),
  }
}

/** The request of a scan as one text: two requests are the same scan if these are equal. */
export function requestKey(request: {
  readonly projects: readonly { id: string; path: string }[]
  readonly search: readonly { id: string; path: string; vendor: boolean }[]
  readonly installed?: readonly { id: string }[]
  readonly options: object
}): string {
  return JSON.stringify([
    request.projects.map(({ id, path }) => [id, path]),
    request.search.map(({ id, path, vendor }) => [id, path, vendor]),
    request.options,
    ...(request.installed?.length ? [request.installed.map(({ id }) => id)] : []),
  ])
}

/** The names the engines give what a folder holds that says what is installed. */
export const PLUGIN_FOLDER = 'Plug-ins'
export const PLUGIN_DATABASE = "Live's plug-in database"
