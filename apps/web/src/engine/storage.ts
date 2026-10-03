/**
 * What a fix in the browser needs of the browser itself, and whether it was switched on. It is
 * off unless the user of this browser said otherwise: a page that writes into project folders
 * has limits livesaver on the computer does not have, and they are to be read first.
 */
import {
  type DirectoryHandleLike,
  type FolderSource,
  folderFromHandle,
  type StateFolder,
  type WritableDirectoryHandleLike,
} from '@livesaver/web'

/**
 * The page's own storage (the private file system of its address), where the runs of a fix are
 * kept. Every page of the same address shares that file system, hence a folder of livesaver's.
 */
export const browserState: StateFolder = async () => {
  const root = await navigator.storage.getDirectory()
  const own = await root.getDirectoryHandle('livesaver', { create: true })
  return own as unknown as WritableDirectoryHandleLike
}

/** The browser hands a page folders it can write to, and gives it a storage of its own. */
export function canWriteHere(): boolean {
  return (
    typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function' &&
    typeof globalThis.navigator?.storage?.getDirectory === 'function'
  )
}

/**
 * Lets the user choose a folder the page may edit, with the browser's own folder dialog; the
 * browser asks whether the page may. `undefined`: the dialog was closed without a folder.
 */
export async function pickFolderToEdit(): Promise<FolderSource | undefined> {
  const browser = globalThis as unknown as {
    showDirectoryPicker(how: { mode: 'readwrite'; id: string }): Promise<DirectoryHandleLike>
  }
  try {
    // (The id makes the dialog open where it was last used for this.)
    return folderFromHandle(
      await browser.showDirectoryPicker({ mode: 'readwrite', id: 'livesaver-projects' }),
    )
  } catch (error) {
    if ((error as Error).name === 'AbortError') return undefined
    throw error
  }
}

const KEY = 'livesaver:fix-in-browser'

/** The settings a browser keeps for the page; it may keep a page from them (private modes do). */
function settings(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export function writingSwitchedOn(): boolean {
  try {
    return canWriteHere() && settings()?.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

export function switchWriting(on: boolean): void {
  try {
    if (on) settings()?.setItem(KEY, 'on')
    else settings()?.removeItem(KEY)
  } catch {} // a browser that keeps nothing: the switch holds until the page is closed at most
}
