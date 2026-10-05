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

/**
 * What the page says of folders of the last visit that are not read yet: a browser hands a page
 * an uploaded folder for one visit, and wants to be asked again for one it kept. `scanned`: a
 * scan was made without them, and what it shows is to be read with that in mind: a sample that
 * lies in such a folder counts as not found. `projects`: a project folder is among them, whose
 * sets are not scanned either.
 */
export function absentWords(
  names: readonly string[],
  scanned: boolean,
  projects = false,
): { title: string; text: string; line: string } {
  const n = names.length
  const [folders, them] = n === 1 ? ['1 folder', 'it'] : [`${n} folders`, 'them']
  const listed = names.map((name) => `“${name}”`).join(', ')
  const sets = projects ? `, and sets in ${them} are not checked` : ''
  return {
    title: scanned
      ? `This scan did not read ${folders} from your last visit`
      : `${folders} from your last visit ${n === 1 ? 'has' : 'have'} to be added again`,
    text: scanned
      ? `${listed}. Samples that lie in ${them} count as not found here${sets}. Let the page read ${them} again (${n === 1 ? 'its row says' : 'their rows say'} how), then scan again.`
      : `${listed}. A browser hands a page such a folder for one visit. Add ${them} again, by the dialog or a drop: several folders can be dropped at once. Until then a scan does not read ${them}: a sample that lies there counts as not found${sets}.`,
    line: `${folders} from your last visit ${n === 1 ? 'was' : 'were'} not read by this scan: a sample that lies in ${them} counts as not found.`,
  }
}

/**
 * Which sets a scan can leave out for the Live that saved them: the option is the oldest major
 * version that is still checked (0: every set).
 */
export const LEAVE_OUT: { label: string; value: number }[] = [
  { label: 'Check every set', value: 0 },
  { label: 'Leave out Live 9 and older', value: 10 },
  { label: 'Leave out Live 10 and older', value: 11 },
  { label: 'Leave out Live 11 and older', value: 12 },
]

/** What a scan says of the sets it left out for their Live ('' = it left none out). */
export function leftOutWords(sets: number, minLive: number | undefined): string {
  if (!sets) return ''
  const which = minLive ? `Live ${minLive - 1} or older` : 'an older Live'
  return `${sets === 1 ? '1 set' : `${sets.toLocaleString('en-US')} sets`} saved with ${which} ${sets === 1 ? 'is' : 'are'} left out, as you set.`
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
