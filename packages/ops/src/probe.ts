/**
 * Cached file-system probing on top of the Host ports: existence, Live fingerprints (size + CRC of
 * the first 16 KB), content and audio hashes. Cached for the duration of a run; nothing here is
 * persisted.
 */
import {
  CRC_BYTES,
  crc16umts,
  type FileStat,
  type FsRead,
  type HashPort,
  resizedHeaderCrcs,
} from '@livesaver/core'

const CHUNK = 1 << 20

/** (size, Live CRC) as stored in OriginalFileSize/OriginalCrc. */
export type Fingerprint = readonly [size: number, crc: number]

export class Probe {
  readonly fs: FsRead
  readonly hash: HashPort
  private readonly stats = new Map<string, Promise<FileStat | undefined>>()
  private readonly prints = new Map<string, Promise<Fingerprint | undefined>>()
  private readonly resized = new Map<string, Promise<Set<number>>>()
  private readonly hashes = new Map<string, Promise<string>>()
  private readonly audio = new Map<string, Promise<string>>()

  constructor(fs: FsRead, hash: HashPort) {
    this.fs = fs
    this.hash = hash
  }

  stat(path: string): Promise<FileStat | undefined> {
    let s = this.stats.get(path)
    if (!s) {
      s = this.fs.stat(path)
      this.stats.set(path, s)
    }
    return s
  }

  async isFile(path: string): Promise<boolean> {
    return (await this.stat(path))?.isFile ?? false
  }

  async isDir(path: string): Promise<boolean> {
    return (await this.stat(path))?.isDirectory ?? false
  }

  async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) !== undefined
  }

  /** Size in bytes; throws like Python's `os.path.getsize` if the file is missing. */
  async size(path: string): Promise<number> {
    const s = await this.stat(path)
    if (!s) throw new Error(`No such file or directory: '${path}'`)
    return s.size
  }

  /** Forget everything known about `path` (after livesaver created or changed it). */
  forget(path: string): void {
    this.stats.delete(path)
    this.prints.delete(path)
    this.hashes.delete(path)
    this.audio.delete(path)
    for (const key of this.resized.keys())
      if (key.startsWith(`${path}\u0000`)) this.resized.delete(key)
  }

  /** Live's fingerprint of a file, or undefined if it cannot be read. */
  fingerprint(path: string): Promise<Fingerprint | undefined> {
    let p = this.prints.get(path)
    if (!p) {
      p = (async () => {
        const s = await this.stat(path)
        if (!s?.isFile) return undefined
        try {
          const head = await this.fs.read(path, 0, CRC_BYTES)
          return [s.size, crc16umts(head)] as const
        } catch {
          return undefined
        }
      })()
      this.prints.set(path, p)
    }
    return p
  }

  /** CRCs as if the RIFF/FORM header announced `size` bytes (vendor re-saves). */
  resizedCrcs(path: string, size: number): Promise<Set<number>> {
    const key = `${path}\u0000${size}`
    let p = this.resized.get(key)
    if (!p) {
      p = this.fs.read(path, 0, CRC_BYTES).then(
        (head) => resizedHeaderCrcs(head, size),
        () => new Set<number>(),
      )
      this.resized.set(key, p)
    }
    return p
  }

  /** SHA-1 of the whole file. */
  contentHash(path: string): Promise<string> {
    let p = this.hashes.get(path)
    if (!p) {
      p = this.sha1Ranges(path, [[0, Number.POSITIVE_INFINITY]])
      this.hashes.set(path, p)
    }
    return p
  }

  /** SHA-1 of only the audio chunks (WAV fmt+data, AIFF COMM+SSND), ignoring metadata chunks. */
  audioHash(path: string): Promise<string> {
    let p = this.audio.get(path)
    if (!p) {
      p = this.computeAudioHash(path)
      this.audio.set(path, p)
    }
    return p
  }

  /** Same size and same bytes. */
  async sameContent(a: string, b: string): Promise<boolean> {
    if ((await this.size(a)) !== (await this.size(b))) return false
    return (await this.contentHash(a)) === (await this.contentHash(b))
  }

  private async sha1Ranges(
    path: string,
    ranges: readonly (readonly [number, number])[],
  ): Promise<string> {
    const hasher = this.hash.sha1()
    for (const [offset, length] of ranges) {
      let pos = offset
      let remaining = length
      while (remaining > 0) {
        const block = await this.fs.read(path, pos, Math.min(remaining, CHUNK))
        if (block.length === 0) break
        hasher.update(block)
        pos += block.length
        remaining -= block.length
      }
    }
    return hasher.hex()
  }

  private async computeAudioHash(path: string): Promise<string> {
    const header = await this.fs.read(path, 0, 12)
    const tag = String.fromCharCode(...header.subarray(0, 4))
    const layout =
      tag === 'RIFF'
        ? { little: true, wanted: ['fmt ', 'data'] }
        : tag === 'FORM'
          ? { little: false, wanted: ['COMM', 'SSND'] }
          : undefined
    if (!layout) return this.contentHash(path)
    const fileSize = await this.size(path)
    const chunks = new Map<string, [offset: number, size: number]>()
    let pos = 12
    while (pos + 8 <= fileSize) {
      const head = await this.fs.read(path, pos, 8)
      if (head.length < 8) break
      const view = new DataView(head.buffer, head.byteOffset, 8)
      const size = view.getUint32(4, layout.little)
      chunks.set(String.fromCharCode(...head.subarray(0, 4)), [pos + 8, size])
      pos += 8 + size + (size & 1)
    }
    const ranges: [number, number][] = []
    for (const id of layout.wanted) {
      const chunk = chunks.get(id)
      if (!chunk) return this.contentHash(path)
      ranges.push(chunk)
    }
    return this.sha1Ranges(path, ranges)
  }
}
