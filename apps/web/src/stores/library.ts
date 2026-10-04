/** The folders and options of a scan: project folders, sample folders, and how to match. */
import type { FolderSource } from '@livesaver/web'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { BrowserEngine } from '../engine/browser.js'
import type {
  FolderAccess,
  FolderListing,
  KnownFolder,
  LocatedFolder,
  ScanOptions,
  ScanRequest,
  Start,
} from '../engine/types.js'
import { LIBRARY_NAME, LIVE_CONTENT, wantedOf } from '../lib/library.js'
import { useEngineStore } from './engine.js'

/**
 * `installed`: in a browser, folders that say what is installed (plug-in folders, the folder
 * of Live's plug-in database). livesaver on the computer looks for itself.
 */
export type FolderKind = 'projects' | 'search' | 'installed'

const nameOf = (path: string) => path.split('/').filter(Boolean).pop() ?? path

export const useLibraryStore = defineStore('library', () => {
  const engines = useEngineStore()
  const projects = ref<KnownFolder[]>([])
  const search = ref<KnownFolder[]>([])
  const installed = ref<KnownFolder[]>([])
  const options = ref<ScanOptions>({ packLimitMB: 50, matchLibraryPath: false })
  /** Where a browser's scan placed the folders it was handed. */
  const located = ref<ReadonlyMap<string, LocatedFolder>>(new Map())
  /** Folders checked before on this computer, to offer while no project folder is given. */
  const suggested = ref<readonly string[]>([])

  const list = (kind: FolderKind) =>
    kind === 'projects' ? projects : kind === 'search' ? search : installed

  function init(start: Start): void {
    projects.value = start.projects.map((folder) => ({ holds: [], exists: true, ...folder }))
    search.value = [...start.search]
    installed.value = [...(start.installed ?? [])]
    options.value = { ...start.options }
    suggested.value = start.suggested
    // A folder of the last visit behind a handle: what the page may do in it now is asked.
    for (const folder of [...projects.value, ...search.value, ...installed.value])
      if (folder.access === 'ask') void access(folder.id)
  }

  /**
   * In a browser the folders are noted for the next visit after every change: the lists, what
   * was typed and ticked, and of each folder what the browser lets a page keep.
   */
  function remember(): void {
    if (engines.kind !== 'browser') return
    void (engines.engine() as BrowserEngine).keep({
      projects: projects.value,
      search: search.value,
      installed: installed.value,
    })
  }

  /** Adds a folder of this computer by what its listing says (its path names it). */
  function addPath(
    kind: Exclude<FolderKind, 'installed'>,
    folder: Pick<FolderListing, 'path' | 'holds'>,
  ): void {
    const folders = list(kind)
    if (folders.value.some((known) => known.path === folder.path)) return
    const name = nameOf(folder.path)
    folders.value = [
      ...folders.value,
      {
        id: folder.path,
        name,
        path: folder.path,
        vendor: kind === 'search' && LIBRARY_NAME.test(name),
        holds: kind === 'search' ? folder.holds : [],
        exists: true,
      },
    ]
  }

  /**
   * Adds folders the browser handed over (uploaded, dropped, or chosen for editing); the engine
   * keeps their files.
   */
  function addSources(kind: FolderKind, sources: readonly FolderSource[]): void {
    const engine = engines.engine() as BrowserEngine
    const folders = list(kind)
    const added: KnownFolder[] = []
    for (const source of sources) {
      const folder = engine.add(source, kind)
      // A folder of the last visit that was waiting to be added again: this is it. It takes
      // the place it had, with the path that was typed for it and its tick.
      const before = folders.value.find(
        (known) => known.waits === 'folder' && known.name === folder.name,
      )
      if (!before) {
        folders.value = [...folders.value, folder]
      } else {
        engine.remove(before.id)
        const again = { ...folder, path: before.path, vendor: before.vendor }
        folders.value = folders.value.map((known) => (known === before ? again : known))
      }
      added.push(folder)
    }
    remember()
    // What the page may do in a folder behind a handle, the browser says when asked.
    for (const folder of added) if (folder.access === 'ask') void access(folder.id)
  }

  /**
   * Asks the user of the browser to let the page read a folder of the last visit again. To be
   * called from a click: a browser asks its user only then. `false`: it was not allowed.
   */
  async function allow(id: string): Promise<boolean> {
    const engine = engines.engine() as BrowserEngine
    if (!(await engine.allow(id))) return false
    for (const folders of [projects, search, installed])
      folders.value = folders.value.map((folder) => {
        if (folder.id !== id) return folder
        const { waits: _waits, ...there } = folder
        return { ...there, access: 'ask' as const }
      })
    await access(id)
    return true
  }

  const set = (id: string, access: FolderAccess) => update(id, { access })

  /** Asks the browser what the page may do in a folder, and notes it. */
  async function access(id: string): Promise<FolderAccess> {
    const now = await (engines.engine() as BrowserEngine).access(id)
    set(id, now)
    return now
  }

  /**
   * Asks the user of the browser to let the page edit a folder. To be called from a click: a
   * browser asks its user only then.
   */
  async function allowEditing(id: string): Promise<FolderAccess> {
    const now = await (engines.engine() as BrowserEngine).allowEditing(id)
    set(id, now)
    return now
  }

  function remove(kind: FolderKind, id: string): void {
    const folders = list(kind)
    folders.value = folders.value.filter((folder) => folder.id !== id)
    if (engines.kind === 'browser') (engines.engine() as BrowserEngine).remove(id)
    remember()
  }

  function update(
    id: string,
    change: Partial<Pick<KnownFolder, 'vendor' | 'path' | 'access'>>,
  ): void {
    for (const folders of [projects, search, installed])
      folders.value = folders.value.map((folder) =>
        folder.id === id ? { ...folder, ...change } : folder,
      )
    // (What the page may do in a folder is asked anew on every visit: nothing to note.)
    if ('path' in change || 'vendor' in change) remember()
  }

  // How a scan matches is noted with the folders (livesaver on the computer keeps its own).
  watch(
    options,
    (now) => {
      if (engines.kind === 'browser') (engines.engine() as BrowserEngine).keepOptions(now)
    },
    { deep: true },
  )

  /** The folders a scan can read: not those of the last visit that still wait. */
  const there = (folders: readonly KnownFolder[]) => folders.filter((folder) => !folder.waits)
  /** Folders of the last visit that the browser wants to be asked for again. */
  const asleep = computed(() =>
    [...projects.value, ...search.value, ...installed.value].filter(
      (folder) => folder.waits === 'permission',
    ),
  )

  const request = computed<ScanRequest>(() => {
    const plain = ({ id, name, path, vendor }: KnownFolder) => ({ id, name, path, vendor })
    const told = there(installed.value)
    return {
      projects: there(projects.value).map(plain),
      search: there(search.value).map(plain),
      ...(told.length ? { installed: told.map(plain) } : {}),
      options: { ...options.value },
    }
  })

  const canScan = computed(() => there(projects.value).length > 0)
  /** What a complete scan needs and is not among the sample folders yet. */
  const wanted = computed(() => wantedOf(there(search.value)))
  /** A folder is marked as holding installed libraries, so the rules for vendors' files apply. */
  const libraryMarked = computed(() => search.value.some((folder) => folder.vendor))
  /** Live's own content always counts as installed: there is nothing to tick for it. */
  const isLiveContent = (folder: KnownFolder) => folder.holds.includes(LIVE_CONTENT)

  /** What the folders that say what is installed hold, taken together. */
  const installedHolds = computed(
    () => new Set(there(installed.value).flatMap((folder) => folder.holds)),
  )

  return {
    projects,
    search,
    installed,
    installedHolds,
    options,
    located,
    suggested,
    init,
    addPath,
    addSources,
    access,
    allow,
    asleep,
    allowEditing,
    remove,
    update,
    request,
    canScan,
    wanted,
    libraryMarked,
    isLiveContent,
  }
})
