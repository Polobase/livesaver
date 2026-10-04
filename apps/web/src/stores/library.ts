/** The folders and options of a scan: project folders, sample folders, and how to match. */
import type { FolderSource } from '@livesaver/web'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
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
    projects.value = start.projects.map((folder) => ({ ...folder, holds: [], exists: true }))
    search.value = [...start.search]
    options.value = { ...start.options }
    suggested.value = start.suggested
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
    const added = sources.map((source) => engine.add(source, kind))
    folders.value = [...folders.value, ...added]
    // What the page may do in a folder behind a handle, the browser says when asked.
    for (const folder of added) if (folder.access === 'ask') void access(folder.id)
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
  }

  function update(
    id: string,
    change: Partial<Pick<KnownFolder, 'vendor' | 'path' | 'access'>>,
  ): void {
    for (const folders of [projects, search, installed])
      folders.value = folders.value.map((folder) =>
        folder.id === id ? { ...folder, ...change } : folder,
      )
  }

  const request = computed<ScanRequest>(() => {
    const plain = ({ id, name, path, vendor }: KnownFolder) => ({ id, name, path, vendor })
    return {
      projects: projects.value.map(plain),
      search: search.value.map(plain),
      ...(installed.value.length ? { installed: installed.value.map(plain) } : {}),
      options: { ...options.value },
    }
  })

  const canScan = computed(() => projects.value.length > 0)
  /** What a complete scan needs and is not among the sample folders yet. */
  const wanted = computed(() => wantedOf(search.value))
  /** A folder is marked as holding installed libraries, so the rules for vendors' files apply. */
  const libraryMarked = computed(() => search.value.some((folder) => folder.vendor))
  /** Live's own content always counts as installed: there is nothing to tick for it. */
  const isLiveContent = (folder: KnownFolder) => folder.holds.includes(LIVE_CONTENT)

  /** What the folders that say what is installed hold, taken together. */
  const installedHolds = computed(() => new Set(installed.value.flatMap((folder) => folder.holds)))

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
