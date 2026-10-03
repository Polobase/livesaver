/**
 * Parse sets on web workers: gunzip and reference extraction are CPU-bound and independent per
 * set, so they must not block the page (or the worker that makes the decisions).
 */
import {
  documentFromXml,
  type FileRef,
  fileRefs,
  type Host,
  inProcessParser,
  openDocument,
  type ParsedSet,
  type PluginUseCount,
  pluginUsesOf,
  type SetParser,
} from '@livesaver/core'
import { statOf, type WebFs } from './fs.js'
import { webCodec } from './host.js'

interface ParseRequest {
  readonly id: number
  readonly file: File
}

type ParseReply =
  | {
      id: number
      ok: true
      xml: ArrayBuffer
      gzipped: boolean
      refs: FileRef[]
      plugins?: PluginUseCount[]
    }
  | { id: number; ok: false; error: string }

/** The part of a worker's global scope the parser needs. */
export interface ParseScope {
  onmessage: ((event: MessageEvent) => unknown) | null
  postMessage(message: unknown, transfer: Transferable[]): void
}

/** Run inside a worker: read → gunzip → find references and plug-ins for one set per message. */
export function serveParser(scope: ParseScope): void {
  scope.onmessage = async ({ data }: MessageEvent<ParseRequest>) => {
    const { id, file } = data
    try {
      const doc = await openDocument(new Uint8Array(await file.arrayBuffer()), webCodec)
      const refs = fileRefs(doc)
      const { plugins } = pluginUsesOf(doc)
      const xml = doc.xml
      const own = xml.byteOffset === 0 && xml.byteLength === xml.buffer.byteLength
      // Transferred, not copied: a set's XML is tens of megabytes.
      const buffer = (own ? xml.buffer : xml.slice().buffer) as ArrayBuffer
      scope.postMessage({ id, ok: true, xml: buffer, gzipped: doc.gzipped, refs, plugins }, [
        buffer,
      ])
    } catch (error) {
      scope.postMessage({ id, ok: false, error: `unreadable: ${(error as Error).message}` }, [])
    }
  }
}

/** The part of a `Worker` the pool uses. */
export interface ParseWorker {
  onmessage: ((event: MessageEvent) => unknown) | null
  onerror: ((event: unknown) => unknown) | null
  postMessage(message: unknown): void
  terminate(): void
}

export interface WorkerParserOptions {
  readonly host: Host & { readonly fs: WebFs }
  /** Starts one worker whose script calls `serveParser`. */
  readonly spawn: () => ParseWorker
  /** Number of workers; 0 parses on the calling thread. */
  readonly workers: number
}

/** A sensible number of parse workers for this machine (cores − 1, at most 8). */
export function defaultWorkerCount(cores: number): number {
  return Math.max(1, Math.min(8, cores - 1))
}

export function createWorkerParser(options: WorkerParserOptions): SetParser {
  const { host } = options
  const fallback = inProcessParser(host)
  if (options.workers <= 0) return fallback

  const pending = new Map<
    number,
    { resolve: (p: ParsedSet) => void; path: string; worker: number; file: File }
  >()
  const load = new Array<number>(options.workers).fill(0)
  let nextId = 0
  let broken = false

  const workers = Array.from({ length: options.workers }, (_, w) => {
    const worker = options.spawn()
    worker.onmessage = ({ data: reply }: MessageEvent<ParseReply>) => {
      const job = pending.get(reply.id)
      if (!job) return
      pending.delete(reply.id)
      load[w] = (load[w] as number) - 1
      if (!reply.ok) return job.resolve({ ok: false, error: reply.error })
      job.resolve({
        ok: true,
        doc: documentFromXml(new Uint8Array(reply.xml), reply.gzipped, false),
        refs: reply.refs,
        ...(reply.plugins ? { plugins: reply.plugins } : {}),
        // Of the very file that was parsed: a set saved since then is another one.
        stat: statOf(job.file),
      })
    }
    worker.onerror = () => {
      // A crashed worker must not lose sets: finish its jobs on this thread.
      broken = true
      for (const [id, job] of pending) {
        if (job.worker !== w) continue
        pending.delete(id)
        void fallback.parse(job.path).then(job.resolve)
      }
    }
    return worker
  })

  const pick = () => {
    let w = 0
    for (let i = 1; i < workers.length; i++) if ((load[i] as number) < (load[w] as number)) w = i
    load[w] = (load[w] as number) + 1
    return w
  }

  return {
    async parse(path) {
      if (broken) return fallback.parse(path)
      const file = await host.fs.file(path)
      if (!file) return { ok: false, error: `unreadable: No such file or directory: '${path}'` }
      const w = pick()
      const id = nextId++
      return new Promise<ParsedSet>((resolve) => {
        pending.set(id, { resolve, path, worker: w, file })
        workers[w]?.postMessage({ id, file } satisfies ParseRequest)
      })
    },
    async close() {
      for (const worker of workers) worker.terminate()
    },
  }
}
