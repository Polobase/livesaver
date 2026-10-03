/**
 * The folders a page was given, as the read-only file system livesaver works on. Each folder is
 * mounted at an absolute path; that path is what the sets' stored paths are compared with, so it
 * should be the folder's real place on disk (see `locateFolder`).
 */
import { casefold, type DirEntry, type FileStat, type FsRead, nfc, posix } from '@livesaver/core'
import type { DirectoryHandleLike, FileHandleLike, FolderSource } from './source.js'

export interface Mount {
  /** Absolute POSIX path under which the folder appears. */
  readonly path: string
  readonly source: FolderSource
}

/** What a run asked of the browser (reading a file through a page is not free). */
export interface FsUsage {
  /** Files fetched from the browser. */
  opened: number
  reads: number
  bytes: number
}

/**
 * A file is fetched from the browser only when its size or content is needed: for the files of
 * an upload even reading the size costs a round trip to the browser (about 60 µs each, which
 * adds up to many seconds for a whole library).
 */
interface FileNode {
  readonly kind: 'file'
  readonly open: () => Promise<File | undefined>
  file?: Promise<File | undefined>
}

interface DirNode {
  readonly kind: 'dir'
  readonly handle?: DirectoryHandleLike
  /** Entries by their name on disk; read on first use. */
  children?: Map<string, Node>
  /** The name on disk for a name as macOS compares it. */
  keys?: Map<string, string>
  loading?: Promise<void>
}

type Node = FileNode | DirNode

const DIRECTORY: FileStat = {
  size: 0,
  mtimeSec: 0,
  mtimeNs: 0n,
  ctimeNs: 0n,
  ino: 0n,
  dev: 0n,
  isFile: false,
  isDirectory: true,
}

/** Names as macOS volumes compare them: case- and normalization-insensitive. */
const nameKey = (name: string) => casefold(nfc(name))
const pathKey = (path: string) => posix.splitPath(path).map(nameKey).join('/')

function emptyDir(): DirNode {
  return { kind: 'dir', children: new Map(), keys: new Map() }
}

function addChild(dir: DirNode, name: string, node: Node): void {
  dir.children?.set(name, node)
  dir.keys?.set(nameKey(name), name)
}

/** The tree of a folder whose files are all known up front (an upload or a listing). */
function treeOf(paths: readonly string[], fileAt: (index: number) => FileNode): DirNode {
  const root = emptyDir()
  for (const [index, path] of paths.entries()) {
    const parts = path.split('/').filter((p) => p)
    let dir = root
    for (const [i, part] of parts.entries()) {
      const name = dir.keys?.get(nameKey(part)) ?? part
      const existing = dir.children?.get(name)
      if (i === parts.length - 1) {
        if (!existing) addChild(dir, part, fileAt(index))
      } else if (existing?.kind === 'dir') {
        dir = existing
      } else if (!existing) {
        const next = emptyDir()
        addChild(dir, part, next)
        dir = next
      } else break // a file where a folder is expected: ignore what lies below
    }
  }
  return root
}

function rootOf(source: FolderSource): DirNode {
  if (source.kind === 'handle') return { kind: 'dir', handle: source.handle }
  if (source.kind === 'files') {
    const { files } = source
    return treeOf(
      files.map((f) => f.path),
      (i) => ({ kind: 'file', open: async () => files[i]?.file }),
    )
  }
  const { open } = source
  return treeOf(source.paths, (i) => ({ kind: 'file', open: () => open(i) }))
}

function statOf(file: File): FileStat {
  const modified = file.lastModified
  const ns = BigInt(Math.round(modified)) * 1_000_000n
  return {
    size: file.size,
    mtimeSec: Math.floor(modified / 1000),
    mtimeNs: ns,
    // A page sees neither the change time nor the inode.
    ctimeNs: ns,
    ino: 0n,
    dev: 0n,
    isFile: true,
    isDirectory: false,
  }
}

export class WebFs implements FsRead {
  readonly usage: FsUsage = { opened: 0, reads: 0, bytes: 0 }
  private readonly mounts = new Map<string, DirNode>()
  /** Folders that only exist because a mount lies below them (`/Users` for `/Users/me/Music`). */
  private readonly above = new Map<string, Map<string, string>>()

  constructor(mounts: readonly Mount[]) {
    for (const { path, source } of mounts) {
      const parts = posix.splitPath(posix.normpath(path))
      this.mounts.set(parts.map(nameKey).join('/'), rootOf(source))
      for (let i = 0; i < parts.length; i++) {
        const key = parts.slice(0, i).map(nameKey).join('/')
        let names = this.above.get(key)
        if (!names) {
          names = new Map()
          this.above.set(key, names)
        }
        const name = parts[i] as string
        if (!names.has(nameKey(name))) names.set(nameKey(name), name)
      }
    }
  }

  private async load(dir: DirNode): Promise<void> {
    if (dir.children) return
    dir.loading ??= (async () => {
      const children = new Map<string, Node>()
      const keys = new Map<string, string>()
      if (dir.handle) {
        for await (const entry of dir.handle.values()) {
          const handle = entry as DirectoryHandleLike | FileHandleLike
          children.set(
            entry.name,
            handle.kind === 'directory'
              ? { kind: 'dir', handle }
              : { kind: 'file', open: () => handle.getFile() },
          )
          keys.set(nameKey(entry.name), entry.name)
        }
      }
      dir.keys = keys
      dir.children = children
    })()
    await dir.loading
  }

  private async resolve(path: string): Promise<Node | undefined> {
    let node: Node = this.mounts.get('') ?? emptyDir()
    let key = ''
    for (const part of posix.splitPath(posix.normpath(path))) {
      if (node.kind !== 'dir') return undefined
      const parent: string = key
      key = key ? `${key}/${nameKey(part)}` : nameKey(part)
      let next: Node | undefined = this.mounts.get(key)
      if (!next) {
        try {
          await this.load(node)
        } catch {
          return undefined
        }
        const dir: DirNode = node
        const name: string | undefined = dir.children?.has(part)
          ? part
          : dir.keys?.get(nameKey(part))
        next = name === undefined ? undefined : dir.children?.get(name)
      }
      if (!next && this.above.get(parent)?.has(nameKey(part))) next = emptyDir()
      if (!next) return undefined
      node = next
    }
    return node
  }

  private async fileOf(node: FileNode): Promise<File | undefined> {
    if (!node.file) {
      this.usage.opened++
      node.file = node.open()
    }
    try {
      return await node.file
    } catch {
      node.file = undefined // e.g. deleted since the folder was listed
      return undefined
    }
  }

  /** The file at `path`, as the browser hands it out (read on demand, never copied). */
  async file(path: string): Promise<File | undefined> {
    const node = await this.resolve(path)
    return node?.kind === 'file' ? this.fileOf(node) : undefined
  }

  async stat(path: string): Promise<FileStat | undefined> {
    const node = await this.resolve(path)
    if (!node) return undefined
    if (node.kind === 'dir') return DIRECTORY
    const file = await this.fileOf(node)
    return file ? statOf(file) : undefined
  }

  /** File or directory, from the folder listings alone: no file is fetched. */
  async kind(path: string): Promise<'file' | 'directory' | undefined> {
    const node = await this.resolve(path)
    return node ? (node.kind === 'dir' ? 'directory' : 'file') : undefined
  }

  private async bytes(path: string, range?: readonly [number, number]): Promise<Uint8Array> {
    const file = await this.file(path)
    if (!file) throw new Error(`No such file or directory: '${path}'`)
    const data = new Uint8Array(await (range ? file.slice(...range) : file).arrayBuffer())
    this.usage.reads++
    this.usage.bytes += data.length
    return data
  }

  read(path: string, offset: number, length: number): Promise<Uint8Array> {
    return this.bytes(path, [offset, offset + length])
  }

  readFile(path: string): Promise<Uint8Array> {
    return this.bytes(path)
  }

  async listDir(path: string): Promise<DirEntry[] | undefined> {
    const node = await this.resolve(path)
    if (node?.kind !== 'dir') return undefined
    try {
      await this.load(node)
    } catch {
      return undefined // e.g. the permission for the folder was withdrawn
    }
    const entries: DirEntry[] = []
    const seen = new Set<string>()
    for (const [name, child] of node.children ?? []) {
      seen.add(nameKey(name))
      entries.push({ name, isDirectory: child.kind === 'dir', isSymlink: false })
    }
    for (const [key, name] of this.above.get(pathKey(path)) ?? []) {
      if (!seen.has(key)) entries.push({ name, isDirectory: true, isSymlink: false })
    }
    return entries
  }
}
