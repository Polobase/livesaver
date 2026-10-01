/**
 * Parse sets on worker threads (gunzip and reference extraction are CPU-bound and independent per
 * set). Results come back in whatever order workers finish; callers await them in their own order.
 */
import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'
import {
  documentFromXml,
  type FileRef,
  type FileStat,
  type Host,
  type InspectedSet,
  inProcessParser,
  type ParsedSet,
  type SetInfo,
  type SetParser,
} from '@livesaver/core'
import { createNodeHost, nodeSearch } from './host.js'

type Reply =
  | { id: number; ok: true; xml: ArrayBuffer; gzipped: boolean; refs: FileRef[]; stat?: FileStat }
  | { id: number; ok: true; info: SetInfo; refs: FileRef[]; stat?: FileStat; xml?: undefined }
  | { id: number; ok: false; error: string; stat?: FileStat }

type Job =
  | { kind: 'parse'; resolve: (p: ParsedSet) => void; path: string; worker: number }
  | { kind: 'inspect'; resolve: (p: InspectedSet) => void; path: string; worker: number }

export interface WorkerParserOptions {
  /** Number of workers (default: CPU cores − 1, at most 8). 0 parses in-process. */
  readonly workers?: number
  /** Host used for the in-process fallback. */
  readonly host?: Host
}

export function defaultWorkerCount(): number {
  return Math.max(1, Math.min(8, availableParallelism() - 1))
}

export function createWorkerParser(options: WorkerParserOptions = {}): SetParser {
  const count = options.workers ?? defaultWorkerCount()
  const fallback = inProcessParser(options.host ?? createNodeHost())
  if (count <= 0) return fallback

  const source = import.meta.url.endsWith('.ts') ? './parse-worker.ts' : './parse-worker.js'
  const url = new URL(source, import.meta.url)
  const pending = new Map<number, Job>()
  const load = new Array<number>(count).fill(0)
  let nextId = 0
  let broken = false

  const workers = Array.from({ length: count }, (_, w) => {
    const worker = new Worker(url)
    worker.unref()
    worker.on('message', (reply: Reply) => {
      const job = pending.get(reply.id)
      if (!job) return
      pending.delete(reply.id)
      load[w] = (load[w] as number) - 1
      if (job.kind === 'inspect') {
        job.resolve(
          reply.ok && 'info' in reply
            ? {
                ok: true,
                info: reply.info,
                refs: reply.refs,
                ...(reply.stat ? { stat: reply.stat } : {}),
              }
            : {
                ok: false,
                error: reply.ok ? 'unexpected reply' : reply.error,
                ...(reply.stat ? { stat: reply.stat } : {}),
              },
        )
        return
      }
      job.resolve(
        reply.ok && reply.xml
          ? {
              ok: true,
              doc: documentFromXml(new Uint8Array(reply.xml), reply.gzipped, false, nodeSearch),
              refs: reply.refs,
              ...(reply.stat ? { stat: reply.stat } : {}),
            }
          : { ok: false, error: reply.ok ? 'unexpected reply' : reply.error },
      )
    })
    worker.on('error', () => {
      // A crashed worker must not lose sets: finish its jobs in-process.
      broken = true
      for (const [id, job] of pending) {
        if (job.worker !== w) continue
        pending.delete(id)
        if (job.kind === 'inspect')
          void (fallback.inspect as NonNullable<SetParser['inspect']>)(job.path).then(job.resolve)
        else void fallback.parse(job.path).then(job.resolve)
      }
    })
    return worker
  })

  const pick = () => {
    let w = 0
    for (let i = 1; i < count; i++) if ((load[i] as number) < (load[w] as number)) w = i
    load[w] = (load[w] as number) + 1
    return w
  }
  return {
    parse(path) {
      if (broken) return fallback.parse(path)
      const w = pick()
      const id = nextId++
      return new Promise<ParsedSet>((resolve) => {
        pending.set(id, { kind: 'parse', resolve, path, worker: w })
        workers[w]?.postMessage({ id, path })
      })
    },
    inspect(path) {
      if (broken) return (fallback.inspect as NonNullable<SetParser['inspect']>)(path)
      const w = pick()
      const id = nextId++
      return new Promise<InspectedSet>((resolve) => {
        pending.set(id, { kind: 'inspect', resolve, path, worker: w })
        workers[w]?.postMessage({ id, path, mode: 'inspect' })
      })
    },
    async close() {
      await Promise.all(workers.map((w) => w.terminate()))
    },
  }
}
