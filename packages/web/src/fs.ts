/**
 * The folders a page was given, as the read-only file system livesaver works on. Each folder is
 * mounted at an absolute path; that path is what the sets' stored paths are compared with, so it
 * should be the folder's real place on disk (see `locateFolder`).
 */
import { casefold, type DirEntry, type FileStat, type FsRead, nfc, posix } from '@livesaver/core'
import {
  type DirectoryHandleLike,
  type FileHandleLike,
  type FolderSource,
  hiddenByHandle,
} from './source.js'

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
  /** Behind a handle: the file can be fetched again, as it is by then. */
  readonly live?: boolean
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

/** What a page knows of a file it was handed. */
export function statOf(file: File): FileStat {
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
  /**
   * A folder behind a handle that was also listed in full: it was dropped to be edited, or was
   * given a second time as an upload or a drop. The listing shows what the handle hides (see
   * `find`).
   */
  private readonly twins = new Map<string, DirNode>()
  /** Folders that only exist because a mount lies below them (`/Users` for `/Users/me/Music`). */
  private readonly above = new Map<string, Map<string, string>>()

  constructor(mounts: readonly Mount[]) {
    for (const { path, source } of mounts) {
      const parts = posix.splitPath(posix.normpath(path))
      const key = parts.map(nameKey).join('/')
      const root = rootOf(source)
      const first = this.mounts.get(key)
      if (!first) this.mounts.set(key, root)
      else if (first.handle && !root.handle) this.twins.set(key, root)
      else if (!first.handle && root.handle) {
        this.mounts.set(key, root)
        this.twins.set(key, first)
      }
      // A folder that was dropped to be edited brings what its handle hides.
      if (source.kind === 'handle' && source.hidden && !this.twins.has(key)) {
        const { paths, open } = source.hidden
        this.twins.set(
          key,
          treeOf(paths, (i) => ({ kind: 'file', open: () => open(i) })),
        )
      }
      for (let i = 0; i < parts.length; i++) {
        const parent = parts.slice(0, i).map(nameKey).join('/')
        let names = this.above.get(parent)
        if (!names) {
          names = new Map()
          this.above.set(parent, names)
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
              : { kind: 'file', open: () => handle.getFile(), live: true },
          )
          keys.set(nameKey(entry.name), entry.name)
        }
      }
      dir.keys = keys
      dir.children = children
    })()
    await dir.loading
  }

  /** The entry called `name` in a folder, by its exact name or as macOS compares names. */
  private async childOf(dir: Node | undefined, name: string): Promise<Node | undefined> {
    if (dir?.kind !== 'dir') return undefined
    try {
      await this.load(dir)
    } catch {
      return undefined
    }
    const known = dir.children?.has(name) ? name : dir.keys?.get(nameKey(name))
    return known === undefined ? undefined : dir.children?.get(known)
  }

  /**
   * The node at `path`, and what lies at the same place in another folder that was given: the
   * same folder once more, or one around it (a library folder that holds the project folder,
   * say). A folder behind a handle shows no entry with certain names (`hiddenByHandle`); an
   * upload or a drop shows them all: what the handle hides is taken from there.
   */
  private async find(path: string): Promise<{ node: Node; under: Node | undefined } | undefined> {
    let node: Node = this.mounts.get('') ?? emptyDir()
    let under: Node | undefined
    let key = ''
    for (const part of posix.splitPath(posix.normpath(path))) {
      if (node.kind !== 'dir') return undefined
      const parent: string = key
      key = key ? `${key}/${nameKey(part)}` : nameKey(part)
      const mounted: Node | undefined = this.mounts.get(key)
      const below: Node | undefined = await this.childOf(under, part)
      let next: Node | undefined
      if (mounted) {
        // What the other folder has at this place lies under the mounted folder from here on.
        under = this.twins.get(key) ?? (await this.childOf(node, part)) ?? below
        next = mounted
      } else {
        next = await this.childOf(node, part)
        under = below
        if (!next && below && hiddenByHandle(part)) {
          next = below
          under = undefined
        }
      }
      if (!next && this.above.get(parent)?.has(nameKey(part))) next = emptyDir()
      if (!next) return undefined
      node = next
    }
    return { node, under }
  }

  private async resolve(path: string): Promise<Node | undefined> {
    return (await this.find(path))?.node
  }

  /**
   * Where `path` lies among the folders that were given: behind a handle (the innermost folder
   * it lies in is one), below a name a handle does not show, and in a folder that shows every
   * name (the same folder, or one around it, given as an upload or a drop).
   */
  private placeOf(path: string): { handle: boolean; hidden: boolean; covered: boolean } {
    const parts = posix.splitPath(posix.normpath(path))
    let key = ''
    let handle = false
    let covered = false
    let below = 0
    for (const [i, part] of parts.entries()) {
      key = key ? `${key}/${nameKey(part)}` : nameKey(part)
      const mounted = this.mounts.get(key)
      if (!mounted) continue
      // The folder around was no handle, or this one was also given as an upload or a drop.
      if ((handle === false && below > 0) || this.twins.has(key)) covered = true
      handle = mounted.handle !== undefined
      below = i + 1
    }
    return { handle, hidden: parts.slice(below).some(hiddenByHandle), covered }
  }

  /**
   * In a folder behind a handle, a browser shows no entry with certain names (see
   * `hiddenByHandle`): what lies there is hidden, unless a folder given around it shows it.
   */
  hides(path: string): boolean {
    const at = this.placeOf(path)
    return at.handle && at.hidden && !at.covered
  }

  /** A browser makes no file or folder with such a name in a folder behind a handle either. */
  refuses(path: string): boolean {
    const at = this.placeOf(path)
    return at.handle && at.hidden
  }

  /**
   * What was listed in the folder of `path` is no longer what is there (something was written):
   * the folder is listed again when it is next looked into. Only folders behind a handle are
   * listed on demand; an upload or a drop is a listing that was made once, and cannot change.
   */
  forget(path: string): void {
    const parts = posix.splitPath(posix.normpath(path))
    // The deepest folder on the way to `path` that was listed so far: the folder that holds
    // `path`, or, where folders were made on the way, the last one that was there before.
    let dir: DirNode | undefined
    let key = ''
    for (const part of parts.slice(0, -1)) {
      key = key ? `${key}/${nameKey(part)}` : nameKey(part)
      const mounted = this.mounts.get(key)
      if (mounted) {
        dir = mounted
        continue
      }
      if (!dir) continue // above the folders that were given
      const name: string | undefined = dir.children?.has(part) ? part : dir.keys?.get(nameKey(part))
      const child: Node | undefined = name === undefined ? undefined : dir.children?.get(name)
      if (child?.kind !== 'dir') break
      dir = child
    }
    if (!dir?.handle) return
    dir.children = undefined
    dir.keys = undefined
    dir.loading = undefined
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
    // Behind a handle a file is fetched as it is now, not as it was when it was first read:
    // this is how a set that was saved in the meantime is noticed before it is rewritten.
    if (node.live) node.file = undefined
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
    const found = await this.find(path)
    const node = found?.node
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
    // What the handle of this folder hides, the folder that was given around it shows.
    const under = found?.under
    if (under?.kind === 'dir') {
      await this.load(under).catch(() => {})
      for (const [name, child] of under.children ?? []) {
        if (!hiddenByHandle(name) || seen.has(nameKey(name))) continue
        seen.add(nameKey(name))
        entries.push({ name, isDirectory: child.kind === 'dir', isSymlink: false })
      }
    }
    for (const [key, name] of this.above.get(pathKey(path)) ?? []) {
      if (!seen.has(key)) entries.push({ name, isDirectory: true, isSymlink: false })
    }
    return entries
  }
}
