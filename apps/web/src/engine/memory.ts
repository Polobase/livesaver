/**
 * What a page keeps of its folders for its next visit, in the browser's own database for the
 * site. A browser hands a page the files of a folder for one visit; what can be kept is the
 * list (names, typed paths, ticks), and a folder's handle where the browser handed one out. A
 * handle is read again after a reload, once the browser's user allows it.
 */
import type { DirectoryHandleLike } from '@livesaver/web'
import type { ScanOptions } from './types.js'

export type FolderKind = 'projects' | 'search' | 'installed'

export interface Remembered {
  readonly id: string
  readonly kind: FolderKind
  readonly name: string
  /** The path that was typed for it ('' = none). */
  readonly path: string
  readonly vendor: boolean
  readonly holds: readonly string[]
  readonly files?: number
  /** The folder itself, where the browser handed out a handle for it. */
  readonly handle?: DirectoryHandleLike
  /**
   * How many of the folder's files the handle does not show (their names): known where the
   * folder was dropped, which lists every file. A folder is read again through its handle only
   * if that loses nothing.
   */
  readonly lost?: number
}

export interface FolderMemory {
  all(): Promise<Remembered[]>
  /** Puts these in place of what was kept, in this order. */
  keep(folders: readonly Remembered[]): Promise<void>
  /** How a scan matches, as it was set last (`undefined`: never). */
  options(): ScanOptions | undefined
  keepOptions(options: ScanOptions): void
}

/** The lists, as text in the browser's storage for the site. */
const KEY = 'livesaver:folders'
const OPTIONS = 'livesaver:options'
/** The handles, by the ids of their folders, in the browser's database for the site. */
const DATABASE = 'livesaver'
const STORE = 'handles'

type Listed = Omit<Remembered, 'handle'>

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const asked = indexedDB.open(DATABASE, 1)
    asked.onupgradeneeded = () => asked.result.createObjectStore(STORE, { keyPath: 'id' })
    asked.onsuccess = () => resolve(asked.result)
    asked.onerror = () => reject(asked.error)
  })
}

const done = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })

async function handles(): Promise<Map<string, DirectoryHandleLike>> {
  const database = await open()
  try {
    const transaction = database.transaction(STORE, 'readonly')
    const asked = transaction.objectStore(STORE).getAll()
    await done(transaction)
    return new Map(
      (asked.result as { id: string; handle: DirectoryHandleLike }[]).map((kept) => [
        kept.id,
        kept.handle,
      ]),
    )
  } finally {
    database.close()
  }
}

async function keepHandles(folders: readonly Remembered[]): Promise<void> {
  const database = await open()
  try {
    const transaction = database.transaction(STORE, 'readwrite')
    const store = transaction.objectStore(STORE)
    store.clear()
    for (const { id, handle } of folders) if (handle) store.put({ id, handle })
    await done(transaction)
  } finally {
    database.close()
  }
}

/** The browser's storage for the site; it may keep a page from it (private modes do). */
function storage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/** How long the browser's database gets to hand the kept handles back. */
const PATIENCE = 1500
/** Noted for the tab: this browser does not hand kept handles back, so it is not asked again. */
const SILENT = 'livesaver:no-kept-handles'
/** What a window of Chromium that is not private gives a page at least: 10 GiB. */
const ROOM = 10 * 2 ** 30

/** The tab's own store; a browser may keep a page from it. */
function tab(): Storage | undefined {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

let handed: Promise<boolean> | undefined

/**
 * Whether this window can be trusted with a handle. A private window of Chromium (seen in 153)
 * takes a handle into its database and never answers when the handle is asked back; from then
 * on the page gets no answer to any question about folders, until the window is closed. So in
 * a private window no handle is kept, and none is asked back.
 *
 * A page is not told whether its window is private. What it can see is the room it is given:
 * a private window of Chromium gets a share of the computer's memory (15 to 20 %), any other
 * 10 GiB or more. Brave tells every page the same number, and hands handles back in its
 * private windows too (checked in 1.96).
 */
function handsHandlesBack(): Promise<boolean> {
  handed ??= (async () => {
    if (typeof indexedDB === 'undefined' || tab()?.getItem(SILENT)) return false
    if ('brave' in globalThis.navigator) return true
    try {
      const { quota = 0, usage = 0 } = await globalThis.navigator.storage.estimate()
      return quota - usage >= ROOM - 2 ** 20
    } catch {
      return false
    }
  })()
  return handed
}

/**
 * The handles the browser kept, if it hands them back in time. Should a browser not answer
 * after all, it is asked once, and then left alone for as long as the tab lives: the page must
 * come up either way.
 */
async function handlesInTime(): Promise<Map<string, DirectoryHandleLike>> {
  const nothing = new Map<string, DirectoryHandleLike>()
  if (!(await handsHandlesBack())) return nothing
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), PATIENCE)
  })
  const held = await Promise.race([handles().catch(() => nothing), late])
  clearTimeout(timer)
  if (held) return held
  handed = Promise.resolve(false)
  try {
    tab()?.setItem(SILENT, '1')
  } catch {}
  return nothing
}

/**
 * The memory of this browser for this site, or `undefined` where a page has no storage. The
 * lists are written at once, as text: a reload right after a change must not lose it. The
 * handles go to the browser's database, which takes a moment, and only in a window that can
 * be trusted with them (see `handsHandlesBack`). A browser that keeps nothing is one that
 * remembers nothing: nothing fails for it.
 */
export function browserMemory(): FolderMemory | undefined {
  const kept = storage()
  if (!kept) return undefined
  return {
    async all() {
      let listed: Listed[] = []
      try {
        const read = JSON.parse(kept.getItem(KEY) ?? '[]') as unknown
        if (Array.isArray(read)) listed = read as Listed[]
      } catch {} // not what this page wrote: as if nothing were kept
      const held = await handlesInTime()
      return listed.map((folder) => {
        const handle = held.get(folder.id)
        return handle ? { ...folder, handle } : folder
      })
    },
    async keep(folders) {
      try {
        kept.setItem(KEY, JSON.stringify(folders.map(({ handle: _handle, ...folder }) => folder)))
      } catch {}
      if (await handsHandlesBack()) await keepHandles(folders).catch(() => {})
    },
    options() {
      try {
        const read = JSON.parse(kept.getItem(OPTIONS) ?? 'null') as Partial<ScanOptions> | null
        return typeof read?.packLimitMB === 'number' && typeof read.matchLibraryPath === 'boolean'
          ? { packLimitMB: read.packLimitMB, matchLibraryPath: read.matchLibraryPath }
          : undefined
      } catch {
        return undefined
      }
    },
    keepOptions(options) {
      try {
        kept.setItem(OPTIONS, JSON.stringify(options))
      } catch {}
    },
  }
}
