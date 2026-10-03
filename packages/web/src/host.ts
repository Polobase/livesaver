/**
 * The browser's side of livesaver's Host ports: gzip through the Streams API, and SHA-1 by the
 * browser where it offers one, else in TypeScript.
 */
import { type Codec, type HashPort, type Host, Sha1 } from '@livesaver/core'
import { type Mount, WebFs } from './fs.js'
import { WebFsWrite, type WritableMount } from './write.js'

async function through(data: Uint8Array, transform: TransformStream): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(transform)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export const webCodec: Codec = {
  gunzip: (data) => through(data, new DecompressionStream('gzip')),
  // The browser picks the compression level; fine for a download, and Live reads any gzip.
  gzip: (data) => through(data, new CompressionStream('gzip')),
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export const webHash: HashPort = {
  sha1() {
    const h = new Sha1()
    return {
      update: (data) => {
        h.update(data)
      },
      hex: () => h.hex(),
    }
  },
  // The browser's own SHA-1 is several times faster and runs off this thread. It exists in
  // secure contexts only (https, localhost); elsewhere the hash above does the work.
  ...(globalThis.crypto?.subtle
    ? {
        async sha1Of(parts) {
          const digest = await crypto.subtle.digest('SHA-1', concat(parts))
          return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
        },
      }
    : {}),
}

export interface WebHost extends Host {
  readonly fs: WebFs
}

/**
 * A host over the folders a page was given: read-only, unless some of them were given for
 * editing (`writable`: folders behind handles with write permission, at their mount paths).
 */
export function createWebHost(
  mounts: readonly Mount[],
  writable: readonly WritableMount[] = [],
): WebHost {
  const fs = new WebFs(mounts)
  return {
    fs,
    codec: webCodec,
    hash: webHash,
    ...(writable.length ? { write: new WebFsWrite(fs, writable) } : {}),
  }
}
