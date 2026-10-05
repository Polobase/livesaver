/**
 * Folders a page was given. Browsers hand them over in three ways, and none reveals where the
 * folder lies on disk:
 * - a folder upload (`<input type="file" webkitdirectory>`, every browser): all files at once;
 * - drag and drop: the entries of the dropped folder, listed here, each file fetched when read;
 * - the File System Access API (`showDirectoryPicker`, Chromium only): a handle, listed on demand.
 * Nothing is uploaded anywhere: the files stay on the user's disk and are read in the page.
 *
 * A handle is the only one of the three that can also write, but it does not show everything.
 * Chromium hides entries whose names it considers unsafe: a name with a `:` (which Finder shows
 * as `/`, as in a folder "Claps/Snares"), a name that starts or ends with a space, `desktop.ini`
 * and a few more; it also hands out no handle for a folder in `/Applications`. A check that must
 * see every sample therefore takes uploads and drops.
 */
import { onWindows } from './platform.js'

/** The part of a `FileSystemDirectoryHandle` livesaver reads. */
export interface DirectoryHandleLike {
  readonly kind: 'directory'
  readonly name: string
  values(): AsyncIterable<{ readonly kind: 'file' | 'directory'; readonly name: string }>
}

/** The part of a `FileSystemFileHandle` livesaver reads. */
export interface FileHandleLike {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
}

/** One file of an uploaded folder; `path` is relative to the folder, '/'-separated. */
export interface FolderFile {
  readonly path: string
  readonly file: File
}

/**
 * The files of a folder that its handle does not show, as a drop listed them: by their paths in
 * the folder ('/'-separated), each fetched when it is read.
 */
export interface HiddenFiles {
  readonly paths: readonly string[]
  readonly open: (index: number) => Promise<File | undefined>
}

export type FolderSource =
  | {
      readonly kind: 'handle'
      readonly name: string
      readonly handle: DirectoryHandleLike
      /**
       * Where the folder was dropped: what the handle hides. The page then reads the folder in
       * full, and still writes through the handle.
       */
      readonly hidden?: HiddenFiles
    }
  | { readonly kind: 'files'; readonly name: string; readonly files: readonly FolderFile[] }
  /**
   * A folder known by the paths of its files only (relative to the folder, '/'-separated); a
   * file is fetched when it is first read. A dropped folder is listed this way: fetching every
   * file of a large folder up front takes most of a minute. So is an uploaded folder as a worker
   * gets it: sending hundreds of thousands of `File` objects to a worker takes many seconds.
   */
  | {
      readonly kind: 'listing'
      readonly name: string
      readonly paths: readonly string[]
      readonly open: (index: number) => Promise<File | undefined>
      /**
       * The same folder as a handle, where a browser hands one out for a drop (Chromium). A
       * page can keep a handle for a later visit, which it cannot do with a listing.
       */
      readonly kept?: DirectoryHandleLike
    }

/**
 * Chromium shows a page no entry with such a name behind a handle: one of these characters (a
 * `:` is what Finder shows as `/`), or a space at its start or end.
 */
export function hiddenByHandle(name: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are part of the rule
  return /[":*/<>?\\|\u0000-\u001f]/.test(name) || name !== name.trim()
}

/**
 * How many files of a folder a handle would not show, by the paths of a listing that shows
 * them all: a file below a name a handle hides. Files a scan passes over anyway do not count
 * (what lies in a hidden folder, `._` files, the icon file of a folder).
 */
export function lostBehindHandle(paths: readonly string[]): number {
  let lost = 0
  for (const path of paths) {
    const parts = path.split('/')
    const name = parts.at(-1) ?? ''
    if (name.startsWith('._') || name.includes('\r')) continue
    if (parts.some((part) => part.startsWith('.'))) continue
    if (parts.some(hiddenByHandle)) lost++
  }
  return lost
}

/** A folder as its handle (see above for what a handle does not show). */
export function folderFromHandle(handle: DirectoryHandleLike): FolderSource {
  return { kind: 'handle', name: handle.name, handle }
}

/**
 * A dropped folder as the handle the browser gave for it, to be edited through, with what that
 * handle hides taken from the listing of the drop. A folder the browser gave no handle for
 * stays what it is: it can be read, not edited.
 */
export function editable(source: FolderSource): FolderSource {
  if (source.kind !== 'listing' || !source.kept) return source
  const { open } = source
  const at: number[] = []
  const paths: string[] = []
  for (const [index, path] of source.paths.entries()) {
    if (!path.split('/').some(hiddenByHandle)) continue
    at.push(index)
    paths.push(path)
  }
  const hidden: HiddenFiles = { paths, open: (index) => open(at[index] ?? -1) }
  return {
    kind: 'handle',
    name: source.name,
    handle: source.kept,
    ...(paths.length ? { hidden } : {}),
  }
}

/**
 * The folders of a drop as handles alone (Chromium), without listing them: what a page needs to
 * write into them, once its user allows that. Such a folder shows less than there is (see
 * above); `editableFromDrop` also lists it. Call it inside the `drop` handler: the items are
 * only readable while the event is being handled, so every handle is asked for before the
 * first `await`.
 */
export function handlesFromDrop(items: DataTransferItemList): Promise<FolderSource[]> {
  const asked: Promise<{ kind?: string } | null>[] = []
  for (const item of items) {
    const handed = item as DataTransferItem & {
      getAsFileSystemHandle?: () => Promise<{ kind?: string } | null>
    }
    if (item.kind === 'file' && handed.getAsFileSystemHandle)
      asked.push(handed.getAsFileSystemHandle())
  }
  return Promise.all(asked).then((handles) =>
    handles
      .filter((handle): handle is DirectoryHandleLike => handle?.kind === 'directory')
      .map(folderFromHandle),
  )
}

/**
 * The folders of a folder upload. Each file's `webkitRelativePath` starts with the name of the
 * folder that was chosen.
 */
export function foldersFromFiles(files: Iterable<File>): FolderSource[] {
  const folders = new Map<string, FolderFile[]>()
  for (const file of files) {
    const relative = file.webkitRelativePath || file.name
    const cut = relative.indexOf('/')
    const name = cut < 0 ? '' : relative.slice(0, cut)
    let list = folders.get(name)
    if (!list) {
      list = []
      folders.set(name, list)
    }
    list.push({ path: cut < 0 ? relative : relative.slice(cut + 1), file })
  }
  return [...folders].map(([name, list]) => ({ kind: 'files', name, files: list }))
}

/** How long a browser gets to hand out the handle of a dropped folder, once it is listed. */
const HANDLE_PATIENCE = 1000

/**
 * A folder of an app, by its name: the app itself, or a folder of its bundle as the Live app
 * has them. Chromium hands a page no handle for a folder in `/Applications`, and says so to its
 * user in a dialog of its own ("can't open this folder because it contains system files") as
 * soon as a page asks for one. So none is asked for such a folder: it is read through its
 * entries all the same, and only cannot be kept for a later visit, which it could not be anyway.
 */
export function folderOfAnApp(name: string, windows = onWindows()): boolean {
  const lower = name.toLowerCase()
  return (
    /\.app$/i.test(name) ||
    ['contents', 'app-resources', 'core library'].includes(lower) ||
    // Windows keeps Live in `C:\ProgramData\Ableton\Live 12 Suite`, with its content in
    // `Resources`: folders of the system to Chromium there, as an app's are on a Mac.
    (windows && (lower === 'resources' || /^live \d/.test(lower)))
  )
}

/** Entries are read 100 at a time (Chromium), and a reader is done when it returns none. */
async function readEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader()
  const all: FileSystemEntry[] = []
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    )
    if (batch.length === 0) return all
    all.push(...batch)
  }
}

interface Listing {
  readonly paths: string[]
  readonly files: FileSystemFileEntry[]
}

async function listBelow(
  dir: FileSystemDirectoryEntry,
  prefix: string,
  out: Listing,
  onFiles: (count: number) => void,
): Promise<void> {
  const folders: FileSystemDirectoryEntry[] = []
  for (const entry of await readEntries(dir)) {
    if (entry.isDirectory) folders.push(entry as FileSystemDirectoryEntry)
    else {
      out.paths.push(prefix + entry.name)
      out.files.push(entry as FileSystemFileEntry)
    }
  }
  onFiles(out.paths.length)
  for (const folder of folders) await listBelow(folder, `${prefix}${folder.name}/`, out, onFiles)
}

/**
 * The folders of a drop, read through the entries API. Call it inside the `drop` handler: the
 * items are only readable while the event is being handled, so everything is taken from them
 * before the first `await`. `onFiles` reports the number of files found so far in the folder
 * that is being listed.
 */
export function foldersFromDrop(
  items: DataTransferItemList,
  onFiles: (count: number) => void = () => {},
): Promise<FolderSource[]> {
  const dropped: {
    entry: FileSystemDirectoryEntry
    handle: Promise<DirectoryHandleLike | undefined>
  }[] = []
  for (const item of items) {
    const entry = item.kind === 'file' ? item.webkitGetAsEntry() : null
    if (!entry?.isDirectory) continue
    // Where the browser also hands out a handle for what was dropped, it is taken along: the
    // page reads the folder through its entries, which show every file, and can keep the handle.
    const handed = item as DataTransferItem & {
      getAsFileSystemHandle?: () => Promise<{ kind?: string } | null>
    }
    const handle =
      handed.getAsFileSystemHandle && !folderOfAnApp(entry.name)
        ? handed
            .getAsFileSystemHandle()
            .then((got) => (got?.kind === 'directory' ? (got as DirectoryHandleLike) : undefined))
            // (No handle for this folder: one of the system's, or the browser hands out none.)
            .catch(() => undefined)
        : Promise.resolve(undefined)
    dropped.push({ entry: entry as FileSystemDirectoryEntry, handle })
  }
  return (async () => {
    const folders: FolderSource[] = []
    for (const { entry, handle } of dropped) {
      const listing: Listing = { paths: [], files: [] }
      await listBelow(entry, '', listing, onFiles)
      const { paths, files } = listing
      const open = (index: number) =>
        new Promise<File | undefined>((resolve) => {
          const file = files[index]
          // Gone since the folder was listed: the same as a file that is not there.
          if (file) file.file(resolve, () => resolve(undefined))
          else resolve(undefined)
        })
      // The listing is the folder; its handle is an extra. A browser that does not answer
      // (seen in a private window of Chromium) must not keep the drop from arriving.
      const kept = await Promise.race([
        handle,
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), HANDLE_PATIENCE)),
      ])
      folders.push({ kind: 'listing', name: entry.name, paths, open, ...(kept ? { kept } : {}) })
    }
    return folders
  })()
}

/**
 * The folders of a drop that a page is to edit (Chromium hands out a handle for a dropped
 * folder): each as its handle, with what the handle hides from the listing of the drop. Call it
 * inside the `drop` handler, like `foldersFromDrop`.
 */
export function editableFromDrop(
  items: DataTransferItemList,
  onFiles: (count: number) => void = () => {},
): Promise<FolderSource[]> {
  return foldersFromDrop(items, onFiles).then((folders) => folders.map(editable))
}
