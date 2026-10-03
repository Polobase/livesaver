/**
 * A folder in memory behind the handles a browser gives a page (File System Access API,
 * `showDirectoryPicker` with `readwrite`), for tests of code that writes through handles. It
 * behaves as a browser's do where that matters: a write is not there until its stream is closed
 * (a browser writes to a swap file first), names are looked up exactly, and what is missing or
 * of the wrong kind fails with the browser's error names.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

type Chunk = Uint8Array | string | Blob
type Write = Chunk | { type: 'write'; position: number; data: Uint8Array | string }

const fail = (name: string, message: string) => new DOMException(message, name)

async function bytesOf(chunk: Chunk): Promise<Uint8Array> {
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk)
  if (chunk instanceof Uint8Array) return chunk
  return new Uint8Array(await chunk.arrayBuffer())
}

export class MemoryFile {
  readonly kind = 'file' as const
  readonly name: string
  data: Uint8Array
  modified: number
  /** How often the file was written (a set must be written exactly once by a fix). */
  writes = 0

  constructor(name: string, data: Uint8Array = new Uint8Array(0), modified = Date.now()) {
    this.name = name
    this.data = data
    this.modified = modified
  }

  async getFile(): Promise<File> {
    return new File([this.data as Uint8Array<ArrayBuffer>], this.name, {
      lastModified: this.modified,
    })
  }

  async createWritable(options: { keepExistingData?: boolean } = {}) {
    let draft = options.keepExistingData ? this.data.slice() : new Uint8Array(0)
    let at = 0
    let open = true
    const put = (data: Uint8Array, position: number) => {
      const next = new Uint8Array(Math.max(draft.length, position + data.length))
      next.set(draft)
      next.set(data, position)
      draft = next
      at = position + data.length
    }
    return {
      write: async (input: Write) => {
        if (!open) throw fail('InvalidStateError', 'the stream is closed')
        // (A Blob has a `type` of its own: what is written at a position is told by `position`.)
        if (typeof input === 'object' && 'position' in input)
          put(await bytesOf(input.data), input.position)
        else put(await bytesOf(input), at)
      },
      close: async () => {
        open = false
        this.data = draft
        this.modified = Date.now()
        this.writes++
      },
      abort: async () => {
        open = false
      },
    }
  }
}

export class MemoryDirectory {
  readonly kind = 'directory' as const
  readonly name: string
  readonly entries = new Map<string, MemoryDirectory | MemoryFile>()

  constructor(name: string) {
    this.name = name
  }

  async *values(): AsyncIterable<MemoryDirectory | MemoryFile> {
    yield* [...this.entries.values()]
  }

  async getDirectoryHandle(
    name: string,
    options: { create?: boolean } = {},
  ): Promise<MemoryDirectory> {
    const found = this.entries.get(name)
    if (found instanceof MemoryDirectory) return found
    if (found) throw fail('TypeMismatchError', `${name} is a file`)
    if (!options.create) throw fail('NotFoundError', `${name} is not there`)
    const made = new MemoryDirectory(name)
    this.entries.set(name, made)
    return made
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<MemoryFile> {
    const found = this.entries.get(name)
    if (found instanceof MemoryFile) return found
    if (found) throw fail('TypeMismatchError', `${name} is a folder`)
    if (!options.create) throw fail('NotFoundError', `${name} is not there`)
    const made = new MemoryFile(name)
    this.entries.set(name, made)
    return made
  }

  async removeEntry(name: string, options: { recursive?: boolean } = {}): Promise<void> {
    const found = this.entries.get(name)
    if (!found) throw fail('NotFoundError', `${name} is not there`)
    if (found instanceof MemoryDirectory && found.entries.size > 0 && !options.recursive)
      throw fail('InvalidModificationError', `${name} is not empty`)
    this.entries.delete(name)
  }
}

/** A folder of the disk, read into memory (hidden files included, as a handle shows them). */
export function memoryFolder(dir: string, name = basename(dir)): MemoryDirectory {
  const folder = new MemoryDirectory(name)
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) folder.entries.set(entry.name, memoryFolder(path))
    else if (entry.isFile())
      folder.entries.set(
        entry.name,
        new MemoryFile(entry.name, new Uint8Array(readFileSync(path)), statSync(path).mtimeMs),
      )
  }
  return folder
}

/** Every file of a memory folder by its path in it, for assertions. */
export function memoryFiles(folder: MemoryDirectory, prefix = ''): Map<string, MemoryFile> {
  const files = new Map<string, MemoryFile>()
  for (const [name, entry] of [...folder.entries].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (entry instanceof MemoryFile) files.set(prefix + name, entry)
    else for (const [path, file] of memoryFiles(entry, `${prefix}${name}/`)) files.set(path, file)
  }
  return files
}
