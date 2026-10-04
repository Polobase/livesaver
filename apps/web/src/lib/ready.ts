/**
 * What a fix in a browser needs before it may start, as far as the page can see it: that it may
 * edit the project folders, and that it knows where the folders lie whose places a fix writes
 * into the sets. (The engine checks both again: this is to say it before the button is pressed.)
 */
import type { KnownFolder, LocatedFolder, Scan, ScanRequest } from '../engine/types.js'
import { LIVE_CONTENT } from './library.js'

/**
 * A browser shows a page no file whose name it considers unsafe, in a folder that was chosen
 * for editing: a name with one of these characters (a `:` is what Finder shows as `/`), or with
 * a space at its start or end. A sample named like that counts as missing there.
 */
export function hiddenFromPage(name: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are part of the rule
  return /[":*/<>?\\|\u0000-\u001f]/.test(name) || name !== name.trim()
}

export interface PageReadiness {
  /** Project folders the page may not edit yet: its user can be asked. */
  readonly ask: readonly { readonly id: string; readonly name: string }[]
  /** Project folders that were handed over to be read only, or are gone: to be added again. */
  readonly readOnly: readonly string[]
  /** Folders whose place on disk is not known, though a fix writes it into the sets. */
  readonly unplaced: readonly string[]
  /**
   * Where the folders lie whose places a fix writes into the sets, as the scan placed them (the
   * project folders, and Ableton's own): to be looked at before a fix.
   */
  readonly places: readonly (LocatedFolder & { readonly name: string })[]
}

/** A fix leaves large pack files and Max devices where they are, and names that place. */
const NAMED_IN_SETS: readonly string[] = ['Factory Packs', LIVE_CONTENT]

export function pageReadiness(
  scanned: ScanRequest,
  scan: Pick<Scan, 'folders'>,
  library: { readonly projects: readonly KnownFolder[]; readonly search: readonly KnownFolder[] },
): PageReadiness {
  const known = new Map([...library.projects, ...library.search].map((f) => [f.id, f]))
  const placed = new Map(scan.folders.map((f) => [f.id, f]))
  const unknown = new Set(scan.folders.filter((f) => f.how === 'unknown').map((f) => f.id))
  /** Sample folders that a fix names in the sets: Ableton's packs, and Live's own content. */
  const named = scanned.search.filter((folder) =>
    (known.get(folder.id)?.holds ?? []).some((held) => NAMED_IN_SETS.includes(held)),
  )
  const ask: { id: string; name: string }[] = []
  const readOnly: string[] = []
  for (const { id, name } of scanned.projects) {
    const access = known.get(id)?.access ?? 'read'
    if (access === 'ask') ask.push({ id, name })
    else if (access !== 'edit') readOnly.push(name)
  }
  return {
    ask,
    readOnly,
    unplaced: [...scanned.projects, ...named]
      .filter((folder) => unknown.has(folder.id))
      .map((folder) => folder.name),
    places: [...scanned.projects, ...named].flatMap((folder) => {
      const at = placed.get(folder.id)
      return at && at.how !== 'unknown' ? [{ ...at, name: folder.name }] : []
    }),
  }
}

export const isReady = (ready: PageReadiness): boolean =>
  ready.ask.length + ready.readOnly.length + ready.unplaced.length === 0
