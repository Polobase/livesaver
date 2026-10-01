import { createHash } from 'node:crypto'
import { lstat, open, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gunzip as gunzipCb, gzipSync } from 'node:zlib'
import type {
  ByteSearch,
  Codec,
  DirEntry,
  FileStat,
  FinderComments,
  FsRead,
  HashPort,
  Host,
} from '@livesaver/core'
import { FinderScriptComments } from './finder.js'
import { NodeFsWrite } from './write.js'
import { createXattr } from './xattr.js'

const gunzipAsync = promisify(gunzipCb)

/** Bun's native helpers when running under Bun (zlib-ng/libdeflate), else undefined. */
const bun = (globalThis as { Bun?: { gunzipSync(data: Uint8Array): Uint8Array } }).Bun

function fileStat(s: import('node:fs').BigIntStats): FileStat {
  return {
    size: Number(s.size),
    mtimeSec: Number(s.mtimeNs / 1_000_000_000n),
    mtimeNs: s.mtimeNs,
    ctimeNs: s.ctimeNs,
    ino: s.ino,
    dev: s.dev,
    isFile: s.isFile(),
    isDirectory: s.isDirectory(),
  }
}

export class NodeFs implements FsRead {
  async stat(path: string): Promise<FileStat | undefined> {
    try {
      return fileStat(await stat(path, { bigint: true }))
    } catch {
      return undefined
    }
  }

  async lstat(path: string): Promise<FileStat | undefined> {
    try {
      return fileStat(await lstat(path, { bigint: true }))
    } catch {
      return undefined
    }
  }

  async read(path: string, offset: number, length: number): Promise<Uint8Array> {
    const handle = await open(path, 'r')
    try {
      const buffer = new Uint8Array(length)
      let got = 0
      while (got < length) {
        const { bytesRead } = await handle.read(buffer, got, length - got, offset + got)
        if (bytesRead === 0) break
        got += bytesRead
      }
      return got === length ? buffer : buffer.subarray(0, got)
    } finally {
      await handle.close()
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    const data = await readFile(path)
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }

  async listDir(path: string): Promise<DirEntry[] | undefined> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(path, { withFileTypes: true })
    } catch {
      return undefined
    }
    const out: DirEntry[] = []
    for (const e of entries) {
      const isSymlink = e.isSymbolicLink()
      let isDirectory = e.isDirectory()
      if (isSymlink) {
        // Like Python's DirEntry.is_dir(): a link to a directory counts as a directory.
        const target = await this.stat(join(path, e.name))
        isDirectory = target?.isDirectory ?? false
      }
      out.push({ name: e.name, isDirectory, isSymlink })
    }
    return out
  }
}

export const nodeCodec: Codec = {
  async gunzip(data) {
    if (bun) return bun.gunzipSync(data)
    const out = await gunzipAsync(data)
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
  },
  async gzip(data, level) {
    // node:zlib writes a zero mtime in the gzip header (no time stamp inside the set file).
    const out = gzipSync(data, { level })
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
  },
}

export const nodeHash: HashPort = {
  sha1() {
    const h = createHash('sha1')
    return {
      update: (data) => {
        h.update(data)
      },
      hex: () => h.digest('hex'),
    }
  },
}

const needles = new WeakMap<Uint8Array, Buffer>()

/** Buffer#indexOf (SIMD memmem in Bun, Boyer–Moore(-Horspool) in Node) over a zero-copy view. */
export const nodeSearch: ByteSearch = (haystack) => {
  const h = Buffer.from(haystack.buffer, haystack.byteOffset, haystack.byteLength)
  return (needle, from) => {
    let n = needles.get(needle)
    if (!n) {
      n = Buffer.from(needle.buffer, needle.byteOffset, needle.byteLength)
      needles.set(needle, n)
    }
    return h.indexOf(n, from)
  }
}

export interface NodeHostOptions {
  /** Allow writing (only for applied runs). */
  readonly write?: boolean
  /** Move "trashed" files here instead of the user's Trash (tests). */
  readonly trashDir?: string
  /** Finder comments (default: AppleScript on macOS; tests pass a fake). */
  readonly finder?: FinderComments | false
}

export function createNodeHost(options: NodeHostOptions = {}): Host {
  const xattr = createXattr()
  const finder =
    options.finder === false
      ? undefined
      : (options.finder ?? (process.platform === 'darwin' ? new FinderScriptComments() : undefined))
  const host: Host = {
    fs: new NodeFs(),
    codec: nodeCodec,
    hash: nodeHash,
    search: nodeSearch,
    ...(xattr ? { xattr } : {}),
    ...(finder ? { finder } : {}),
  }
  if (!options.write) return host
  return { ...host, write: new NodeFsWrite(options.trashDir ? { trashDir: options.trashDir } : {}) }
}
