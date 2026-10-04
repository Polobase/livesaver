/**
 * Write access through folder handles (File System Access API): what a page in Chrome or Edge
 * may do in a folder its user chose with "edit" permission. It is the same port the command line
 * writes through, with what a browser cannot do left out or done another way:
 * - a file written through a handle appears when its stream is closed (the browser writes a
 *   swap file and moves it into place), so there is never a half-written file under the name;
 * - a replaced file is a new file to the system: its Finder tags and comment are gone;
 * - a copy gets the time of the copying, not the time of its source;
 * - there is no Trash: what an undo takes out goes to a hidden folder in the folder it was in;
 * - how much room there is, a page cannot see.
 */
import { type FsWrite, posix } from '@livesaver/core'
import type { WebFs } from './fs.js'
import type { DirectoryHandleLike, FileHandleLike } from './source.js'

/** The part of a `FileSystemWritableFileStream` that is used. */
export interface WritableLike {
  write(
    data:
      | Blob
      | Uint8Array
      | string
      | { type: 'write'; position: number; data: Uint8Array | string },
  ): Promise<void>
  close(): Promise<void>
  abort?(): Promise<void>
}

/** The part of a `FileSystemSyncAccessHandle` that is used (workers, a page's own storage). */
export interface SyncAccessLike {
  getSize(): number
  write(data: Uint8Array, options: { at: number }): number
  flush(): void
  close(): void
}

export interface WritableFileHandleLike extends FileHandleLike {
  createWritable(options?: { keepExistingData?: boolean }): Promise<WritableLike>
  createSyncAccessHandle?(): Promise<SyncAccessLike>
}

export interface WritableDirectoryHandleLike extends DirectoryHandleLike {
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<WritableDirectoryHandleLike>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<WritableFileHandleLike>
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
}

/** A folder the page may write to, at the absolute path it is mounted at. */
export interface WritableMount {
  readonly path: string
  readonly handle: WritableDirectoryHandleLike
}

/**
 * Where an undo puts what it takes out of a folder. Hidden, so that neither Live nor a scan
 * takes what lies in it for samples.
 */
export const TRASH_FOLDER = '.livesaver-trash'

const isNamed = (error: unknown, name: string) => (error as { name?: string }).name === name
const encoder = new TextEncoder()

/**
 * A browser makes no file or folder with a name it considers unsafe (a `:`, a space at an end,
 * and more), and refuses with a `TypeError`: said here in words that name the name.
 */
async function allowed<T>(name: string, made: Promise<T>): Promise<T> {
  try {
    return await made
  } catch (error) {
    if (error instanceof TypeError)
      throw new Error(`The browser lets a page make no file or folder named “${name}”.`)
    throw error
  }
}

export class WebFsWrite implements FsWrite {
  private readonly fs: WebFs
  private readonly mounts: readonly WritableMount[]
  /** Names what is moved to the hidden trash folder apart: a time, taken once. */
  private readonly stamp: string

  constructor(fs: WebFs, mounts: readonly WritableMount[], now = new Date()) {
    this.fs = fs
    // The longest path first: a folder mounted inside another one is found before it.
    this.mounts = [...mounts]
      .map((mount) => ({ ...mount, path: posix.normpath(mount.path) }))
      .sort((a, b) => b.path.length - a.path.length)
    this.stamp = now.toISOString().replace(/[:.]/g, '-')
  }

  /** The folder `path` lies in that the page may write to, and the way down from it. */
  private locate(path: string): { mount: WritableMount; parts: string[] } {
    const normal = posix.normpath(path)
    const mount = this.mounts.find((m) => normal === m.path || normal.startsWith(`${m.path}/`))
    if (!mount) throw new Error(`This page may not write here: ${path}`)
    return { mount, parts: posix.splitPath(normal.slice(mount.path.length)) }
  }

  /** The handle of the folder that holds `path`, and the name of `path` in it. */
  private async parent(
    path: string,
    create: boolean,
  ): Promise<{ dir: WritableDirectoryHandleLike; name: string }> {
    const { mount, parts } = this.locate(path)
    const name = parts.pop()
    if (name === undefined)
      throw new Error(`This is the folder itself, not something in it: ${path}`)
    let dir = mount.handle
    for (const part of parts) dir = await allowed(part, dir.getDirectoryHandle(part, { create }))
    return { dir, name }
  }

  /** Whether the name is taken in the folder, by a file or by a folder. */
  private async has(dir: WritableDirectoryHandleLike, name: string): Promise<boolean> {
    try {
      await allowed(name, dir.getFileHandle(name))
      return true
    } catch (error) {
      if (isNamed(error, 'TypeMismatchError')) return true // a folder of that name
      if (isNamed(error, 'NotFoundError')) return false
      throw error
    }
  }

  /** Writes a whole file through its handle: it is there, complete, when this returns. */
  private async put(handle: WritableFileHandleLike, data: Blob | Uint8Array | string) {
    const stream = await handle.createWritable()
    try {
      await stream.write(data)
      await stream.close()
    } catch (error) {
      await stream.abort?.().catch(() => {})
      throw error
    }
  }

  async mkdirp(path: string): Promise<void> {
    const { mount, parts } = this.locate(path)
    let dir = mount.handle
    for (const part of parts)
      dir = await allowed(part, dir.getDirectoryHandle(part, { create: true }))
    this.fs.forget(path)
  }

  async copyFile(source: string, destination: string): Promise<void> {
    const file = await this.fs.file(source)
    if (!file) throw new Error(`No such file: ${source}`)
    const { dir, name } = await this.parent(destination, true)
    if (await this.has(dir, name)) throw new Error(`refusing to overwrite ${destination}`)
    const handle = await allowed(name, dir.getFileHandle(name, { create: true }))
    try {
      await this.put(handle, file)
    } catch (error) {
      // The name was made before its content: without the content it must not stay.
      await dir.removeEntry(name).catch(() => {})
      throw error
    } finally {
      this.fs.forget(destination)
    }
  }

  // (A page cannot set a file's time: what it writes carries the time of the write, always.)
  async replaceFile(path: string, data: Uint8Array): Promise<void> {
    const { dir, name } = await this.parent(path, false)
    // It has to be there: a set is replaced, not made.
    await this.put(await dir.getFileHandle(name), data)
    this.fs.forget(path)
  }

  async writeNew(path: string, data: Uint8Array | string): Promise<void> {
    const { dir, name } = await this.parent(path, true)
    if (await this.has(dir, name)) throw new Error(`refusing to overwrite ${path}`)
    await this.put(await allowed(name, dir.getFileHandle(name, { create: true })), data)
    this.fs.forget(path)
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const { dir, name } = await this.parent(path, true)
    await this.put(await allowed(name, dir.getFileHandle(name, { create: true })), data)
    this.fs.forget(path)
  }

  async appendDurable(path: string, line: string): Promise<void> {
    const { dir, name } = await this.parent(path, true)
    const handle = await allowed(name, dir.getFileHandle(name, { create: true }))
    const bytes = encoder.encode(`${line}\n`)
    if (handle.createSyncAccessHandle) {
      // A page's own storage, in a worker: the line is added in place and flushed.
      const access = await handle.createSyncAccessHandle()
      try {
        access.write(bytes, { at: access.getSize() })
        access.flush()
      } finally {
        access.close()
      }
    } else {
      const { size } = await handle.getFile()
      const stream = await handle.createWritable({ keepExistingData: true })
      await stream.write({ type: 'write', position: size, data: bytes })
      await stream.close()
    }
    this.fs.forget(path)
  }

  async freeBytes(): Promise<number | undefined> {
    return undefined
  }

  /** A file to another place of a folder the page may write to: copied, then taken away. */
  private async move(from: string, to: string): Promise<void> {
    if ((await this.fs.kind(from)) !== 'file')
      throw new Error(`A page can move a file, but not a folder: ${from}`)
    await this.copyFile(from, to)
    const { dir, name } = await this.parent(from, false)
    await dir.removeEntry(name)
    this.fs.forget(from)
  }

  async trash(path: string): Promise<void> {
    const { mount, parts } = this.locate(path)
    await this.move(path, posix.join(mount.path, TRASH_FOLDER, this.stamp, ...parts))
  }

  async rename(from: string, to: string): Promise<void> {
    const { dir, name } = await this.parent(to, true)
    if (await this.has(dir, name)) throw new Error(`refusing to overwrite ${to}`)
    await this.move(from, to)
  }
}
