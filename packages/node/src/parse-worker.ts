/**
 * Worker thread: read → gunzip → find references and plug-ins for one set per message. The
 * decompressed XML goes back as a transferred ArrayBuffer (zero-copy); the rest is plain data.
 */
import { readFile } from 'node:fs/promises'
import { parentPort } from 'node:worker_threads'
import { fileRefs, inspectFile, openDocument, pluginUsesOf } from '@livesaver/core'
import { NodeFs, nodeCodec, nodeSearch } from './host.js'

export interface ParseRequest {
  readonly id: number
  readonly path: string
  /** `inspect`: analysis and references only, no XML sent back (status). */
  readonly mode?: 'parse' | 'inspect'
}

const port = parentPort
const fs = new NodeFs()
if (port) {
  port.on('message', async ({ id, path, mode }: ParseRequest) => {
    if (mode === 'inspect') {
      const stat = await fs.stat(path)
      try {
        if (!stat) throw new Error(`No such file or directory: '${path}'`)
        const file = await readFile(path)
        const { info, refs } = await inspectFile(
          new Uint8Array(file.buffer, file.byteOffset, file.byteLength),
          nodeCodec,
          nodeSearch,
        )
        port.postMessage({ id, ok: true, info, refs, stat })
      } catch (error) {
        port.postMessage({ id, ok: false, error: (error as Error).message, stat })
      }
      return
    }
    try {
      const stat = await fs.stat(path)
      const file = await readFile(path)
      const doc = await openDocument(
        new Uint8Array(file.buffer, file.byteOffset, file.byteLength),
        nodeCodec,
        {
          search: nodeSearch,
        },
      )
      const refs = fileRefs(doc)
      const { plugins } = pluginUsesOf(doc)
      const xml = doc.xml
      const own = xml.byteOffset === 0 && xml.byteLength === xml.buffer.byteLength
      const buffer = (own ? xml.buffer : xml.slice().buffer) as ArrayBuffer
      port.postMessage({ id, ok: true, xml: buffer, gzipped: doc.gzipped, refs, plugins, stat }, [
        buffer,
      ])
    } catch (error) {
      port.postMessage({ id, ok: false, error: `unreadable: ${(error as Error).message}` })
    }
  })
}
